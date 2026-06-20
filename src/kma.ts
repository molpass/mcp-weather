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
