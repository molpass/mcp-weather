// KMA 단기예보 LCC 격자 변환 (기상청 공식 공식)
export function dfs_xy_conv(lat: number, lon: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0;
  const OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136, DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

// KST 부품 추출
function kstParts(now: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(now)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +(p.hour === "24" ? "0" : p.hour), mm: +p.minute };
}

const BASES = [2, 5, 8, 11, 14, 17, 20, 23];

// 발표 02·05·08·11·14·17·20·23시(KST), 발표+10분 후 가용. 직전 base 선택, 새벽이면 전일 2300.
export function selectBaseDateTime(now: Date): { base_date: string; base_time: string } {
  const { y, m, d, hh, mm } = kstParts(now);
  const nowMin = hh * 60 + mm;
  let chosen = -1;
  for (const b of BASES) {
    if (nowMin >= b * 60 + 10) chosen = b;
  }
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (chosen === -1) {
    // 전일 2300
    const prev = new Date(Date.UTC(y, m - 1, d));
    prev.setUTCDate(prev.getUTCDate() - 1);
    const py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1, pd = prev.getUTCDate();
    return { base_date: `${py}${pad2(pm)}${pad2(pd)}`, base_time: "2300" };
  }
  return { base_date: `${y}${pad2(m)}${pad2(d)}`, base_time: `${pad2(chosen)}00` };
}

// PM 등급 (환경부 기준). kind: "PM10" | "PM25"
export function gradePm(kind: "PM10" | "PM25", value: number): string {
  if (Number.isNaN(value) || value < 0) return "정보없음";
  const t = kind === "PM10" ? [30, 80, 150] : [15, 35, 75];
  if (value <= t[0]) return "좋음";
  if (value <= t[1]) return "보통";
  if (value <= t[2]) return "나쁨";
  return "매우나쁨";
}

export interface FcstItem { category: string; fcstTime: string; fcstValue: string }
export interface Bucket { tempMin: number | null; tempMax: number | null; sky: string; pop: number | null }
export interface Buckets { morning: Bucket; noon: Bucket; evening: Bucket }

const WINDOWS: Record<keyof Buckets, string[]> = {
  morning: ["0600", "0700", "0800", "0900"],
  noon: ["1200", "1300", "1400", "1500"],
  evening: ["1800", "1900", "2000", "2100"],
};

// SKY(1맑음/3구름많음/4흐림) + PTY(0없음/1비/2비눈/3눈/4소나기) → 한글 라벨
function skyLabel(sky?: string, pty?: string): string {
  const p = pty ?? "0";
  if (p !== "0") {
    return ({ "1": "비", "2": "비/눈", "3": "눈", "4": "소나기" } as Record<string, string>)[p] ?? "강수";
  }
  return ({ "1": "맑음", "3": "구름많음", "4": "흐림" } as Record<string, string>)[sky ?? ""] ?? "정보없음";
}

function pickWindow(items: FcstItem[], times: string[]): Bucket {
  const inWin = items.filter((it) => times.includes(it.fcstTime));
  const temps = inWin.filter((i) => i.category === "TMP").map((i) => Number(i.fcstValue)).filter((n) => !Number.isNaN(n));
  const pops = inWin.filter((i) => i.category === "POP").map((i) => Number(i.fcstValue)).filter((n) => !Number.isNaN(n));
  const firstSky = inWin.find((i) => i.category === "SKY")?.fcstValue;
  const anyPty = inWin.find((i) => i.category === "PTY" && i.fcstValue !== "0")?.fcstValue
    ?? inWin.find((i) => i.category === "PTY")?.fcstValue;
  return {
    tempMin: temps.length ? Math.min(...temps) : null,
    tempMax: temps.length ? Math.max(...temps) : null,
    sky: skyLabel(firstSky, anyPty),
    pop: pops.length ? Math.max(...pops) : null,
  };
}

export function bucketize(items: FcstItem[]): Buckets {
  return {
    morning: pickWindow(items, WINDOWS.morning),
    noon: pickWindow(items, WINDOWS.noon),
    evening: pickWindow(items, WINDOWS.evening),
  };
}

export interface FetchForecastOpts {
  fetchImpl?: typeof fetch;            // 테스트 주입용 (기본 = 전역 fetch)
  sleepImpl?: (ms: number) => Promise<void>;
  retries?: number;                    // 재시도 횟수(최초 시도 제외). 기본 2 → 최대 3회 시도.
  backoffMs?: number;                  // 재시도 간 대기. 기본 2500ms.
}

const _sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchForecast(
  serviceKey: string, lat: number, lon: number, now: Date,
  opts: FetchForecastOpts = {},
): Promise<Buckets> {
  const doFetch = opts.fetchImpl ?? fetch;
  const doSleep = opts.sleepImpl ?? _sleep;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 2500;

  const { nx, ny } = dfs_xy_conv(lat, lon);
  const { base_date, base_time } = selectBaseDateTime(now);
  const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", base_date);
  url.searchParams.set("base_time", base_time);
  url.searchParams.set("nx", String(nx));
  url.searchParams.set("ny", String(ny));

  // 비-JSON 응답 바디(=data.go.kr 순간 rate limit 신호)면 백오프 후 재시도.
  // serviceKey 오류는 재시도해도 무의미하므로 즉시 throw. 재시도 소진 시 기존 문구 유지.
  let lastErr: Error = new Error("KMA 응답 파싱 실패");
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await doSleep(backoffMs);
    const res = await doFetch(url);
    const text = await res.text();
    if (text.includes("SERVICE_KEY") || text.includes("SERVICE ERROR"))
      throw new Error(`KMA serviceKey 오류(발급 직후면 동기화 ~1시간 대기 후 재시도): ${text.slice(0, 200)}`);
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      lastErr = new Error(`KMA 응답 파싱 실패: ${text.slice(0, 200)}`);
      continue;
    }
    const items: FcstItem[] = json?.response?.body?.items?.item ?? [];
    return bucketize(items);
  }
  throw lastErr;
}
