import { gatewayError } from "./gateway.js";

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
const pad2 = (n: number) => String(n).padStart(2, "0");

export interface BaseDateTime { base_date: string; base_time: string }

// 발표 02·05·08·11·14·17·20·23시(KST), 발표+10분 후 가용. 직전 base 선택, 새벽이면 전일 2300.
export function selectBaseDateTime(now: Date): BaseDateTime {
  const { y, m, d, hh, mm } = kstParts(now);
  const nowMin = hh * 60 + mm;
  let chosen = -1;
  for (const b of BASES) {
    if (nowMin >= b * 60 + 10) chosen = b;
  }
  if (chosen === -1) {
    // 전일 2300
    const prev = new Date(Date.UTC(y, m - 1, d));
    prev.setUTCDate(prev.getUTCDate() - 1);
    const py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1, pd = prev.getUTCDate();
    return { base_date: `${py}${pad2(pm)}${pad2(pd)}`, base_time: "2300" };
  }
  return { base_date: `${y}${pad2(m)}${pad2(d)}`, base_time: `${pad2(chosen)}00` };
}

// 한 단계 이전 발표 시각(3시간 전). 02시의 이전은 전날 23시.
export function previousBase({ base_date, base_time }: BaseDateTime): BaseDateTime {
  const h = Number(base_time.slice(0, 2));
  if (h >= 5) return { base_date, base_time: `${pad2(h - 3)}00` };
  const prev = new Date(Date.UTC(+base_date.slice(0, 4), +base_date.slice(4, 6) - 1, +base_date.slice(6, 8) - 1));
  return { base_date: `${prev.getUTCFullYear()}${pad2(prev.getUTCMonth() + 1)}${pad2(prev.getUTCDate())}`, base_time: "2300" };
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

export interface FcstItem { category: string; fcstDate?: string; fcstTime: string; fcstValue: string }
// past: 오늘 이미 지난 시간대(값을 비운다). bucketize 에 now 를 넘겼을 때만 정해진다.
export interface Bucket { tempMin: number | null; tempMax: number | null; sky: string; pop: number | null; past?: boolean }
export interface Buckets { morning: Bucket; noon: Bucket; evening: Bucket }
export interface Forecast extends Buckets, BaseDateTime {}

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

// now 를 넘기면 오늘(KST) fcstDate 만 쓰고, 이미 지난 시간대는 다음 날 값으로 채우지 않고 past 로 비운다.
// (응답에는 2~5일치가 들어 있어 fcstTime 만으로 고르면 여러 날이 섞인다.)
export function bucketize(items: FcstItem[], now?: Date): Buckets {
  if (!now) {
    return {
      morning: pickWindow(items, WINDOWS.morning),
      noon: pickWindow(items, WINDOWS.noon),
      evening: pickWindow(items, WINDOWS.evening),
    };
  }
  const { y, m, d, hh } = kstParts(now);
  const today = items.filter((i) => i.fcstDate === `${y}${pad2(m)}${pad2(d)}`);
  const one = (times: string[]): Bucket =>
    hh > Number(times[times.length - 1].slice(0, 2))
      ? { tempMin: null, tempMax: null, sky: "지난 시간대", pop: null, past: true }
      : { ...pickWindow(today, times), past: false };
  return { morning: one(WINDOWS.morning), noon: one(WINDOWS.noon), evening: one(WINDOWS.evening) };
}

export interface FetchForecastOpts {
  fetchImpl?: typeof fetch;            // 테스트 주입용 (기본 = 전역 fetch)
  sleepImpl?: (ms: number) => Promise<void>;
  retries?: number;                    // 재시도 횟수(최초 시도 제외). 기본 2 → 최대 3회 시도.
  backoffMs?: number;                  // 재시도 간 대기. 기본 2500ms.
}

const _sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 같은 발표분으로 재시도할 일시 오류. 기상청 활용가이드(2609판) 오류 코드 표 + 공공데이터포털 게이트웨이 23(초당 한도).
// 그 밖의 코드(10·11·12 요청 오류, 20·21·22·30~33 키·권한·일일 한도)는 재시도해도 같으므로 바로 실패한다.
const RETRYABLE = new Set(["01", "02", "04", "05", "23", "99"]);
// 03 NO_DATA 면 이전 발표분으로 내려가는 최대 단계 수. 2026-10-15 측정: 최근 발표분 2개는 요청마다
// NO_DATA 가 섞여 나오고(30~100%), 두 단계 이전부터는 모두 정상이었다.
const MAX_BASE_STEPS = 3;

export async function fetchForecast(
  serviceKey: string, lat: number, lon: number, now: Date,
  opts: FetchForecastOpts = {},
): Promise<Forecast> {
  const doFetch = opts.fetchImpl ?? fetch;
  const doSleep = opts.sleepImpl ?? _sleep;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 2500;

  const { nx, ny } = dfs_xy_conv(lat, lon);

  // 한 발표분의 items. 03 NO_DATA 면 null. 일시 오류·비-JSON 응답(=data.go.kr 순간 rate limit 신호)은
  // 백오프 후 재시도, 그 밖의 오류는 바로 throw. 기상청은 오류도 HTTP 200 + 정상 형식 JSON 으로 주므로
  // response.header.resultCode 를 반드시 본다.
  async function fetchItems({ base_date, base_time }: BaseDateTime): Promise<FcstItem[] | null> {
    const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst");
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("dataType", "JSON");
    url.searchParams.set("base_date", base_date);
    url.searchParams.set("base_time", base_time);
    url.searchParams.set("nx", String(nx));
    url.searchParams.set("ny", String(ny));

    let lastErr: Error = new Error("KMA 응답 파싱 실패");
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await doSleep(backoffMs);
      const res = await doFetch(url);
      const text = await res.text();
      // 게이트웨이 오류 XML 은 errMsg 에 늘 "SERVICE ERROR" 가 있으므로 코드로 먼저 가른다.
      // JSON 형식 게이트웨이 오류는 response.header 가 없어 아래에서 성공으로 읽히므로 여기서 가른다.
      const gw = gatewayError(text);
      if (gw) {
        lastErr = new Error(`KMA 오류 ${gw.code} ${gw.msg}`.trim());
        if (RETRYABLE.has(gw.code)) continue;
        throw lastErr;
      }
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        // 문자열 검사는 JSON 이 아닐 때만 한다. JSON 응답 헤더의 키 오류 메시지(SERVICE_KEY_…)는 아래에서 코드로 가른다.
        if (text.includes("SERVICE_KEY") || text.includes("SERVICE ERROR"))
          throw new Error(`KMA serviceKey 오류(발급 직후면 동기화 ~1시간 대기 후 재시도): ${text.slice(0, 200)}`);
        lastErr = new Error(`KMA 응답 파싱 실패: ${text.slice(0, 200)}`);
        continue;
      }
      const code: string | undefined = json?.response?.header?.resultCode;
      if (code === "03") return null;
      if (code !== undefined && code !== "00") {
        lastErr = new Error(`KMA 오류 ${code} ${json?.response?.header?.resultMsg ?? ""}`.trim());
        if (RETRYABLE.has(code)) continue;
        throw lastErr;
      }
      return json?.response?.body?.items?.item ?? [];
    }
    throw lastErr;
  }

  let base = selectBaseDateTime(now);
  const tried: string[] = [];
  for (let step = 0; step <= MAX_BASE_STEPS; step++) {
    if (step > 0) base = previousBase(base);
    tried.push(`${base.base_date.slice(4, 6)}-${base.base_date.slice(6)} ${base.base_time.slice(0, 2)}:00`);
    const items = await fetchItems(base);
    if (items) return { ...bucketize(items, now), ...base };
  }
  throw new Error(`KMA 오류 03 NO_DATA (발표 ${tried.join(", ")} 모두 자료 없음)`);
}
