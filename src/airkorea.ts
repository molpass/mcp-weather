import proj4 from "proj4";
import { gradePm } from "./kma.js";

// EPSG:5181 (KGD2002 Central Belt) — AirKorea 근접측정소 TM 좌표.
// 검증점 A: 측정소가 엉뚱하면 5174/5179로 교체.
const EPSG5181 =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs";

export function toTM(lat: number, lon: number): { tmX: number; tmY: number } {
  const [tmX, tmY] = proj4("EPSG:4326", EPSG5181, [lon, lat]);
  return { tmX, tmY };
}

export interface AirResult {
  station: string;
  pm10: number | null;
  pm25: number | null;
  pm10Grade: string;
  pm25Grade: string;
}

export async function fetchAir(serviceKey: string, lat: number, lon: number): Promise<AirResult> {
  const { tmX, tmY } = toTM(lat, lon);
  // 1) 근접 측정소
  const u1 = new URL("https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList");
  u1.searchParams.set("serviceKey", serviceKey);
  u1.searchParams.set("returnType", "json");
  u1.searchParams.set("tmX", String(Math.round(tmX)));
  u1.searchParams.set("tmY", String(Math.round(tmY)));
  u1.searchParams.set("ver", "1.1");
  const r1 = await fetch(u1);
  const t1 = await r1.text();
  if (t1.includes("SERVICE_KEY") || t1.includes("SERVICE ERROR"))
    throw new Error(`AirKorea serviceKey 오류(발급 직후면 동기화 대기 후 재시도): ${t1.slice(0, 200)}`);
  let j1: any;
  try { j1 = JSON.parse(t1); } catch { throw new Error(`AirKorea 측정소 응답 파싱 실패: ${t1.slice(0, 200)}`); }
  const station = j1?.response?.body?.items?.[0]?.stationName;
  if (!station) throw new Error(`근접 측정소 없음 (TM ${Math.round(tmX)},${Math.round(tmY)})`);

  // 2) 실시간 측정
  const u2 = new URL("https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty");
  u2.searchParams.set("serviceKey", serviceKey);
  u2.searchParams.set("returnType", "json");
  u2.searchParams.set("stationName", station);
  u2.searchParams.set("dataTerm", "DAILY");
  u2.searchParams.set("ver", "1.3");
  u2.searchParams.set("numOfRows", "1");
  u2.searchParams.set("pageNo", "1");
  const r2 = await fetch(u2);
  const t2 = await r2.text();
  let j2: any;
  try { j2 = JSON.parse(t2); } catch { throw new Error(`AirKorea 실시간 응답 파싱 실패: ${t2.slice(0, 200)}`); }
  const it = j2?.response?.body?.items?.[0] ?? {};
  const pm10 = it.pm10Value && it.pm10Value !== "-" ? Number(it.pm10Value) : null;
  const pm25 = it.pm25Value && it.pm25Value !== "-" ? Number(it.pm25Value) : null;
  return {
    station,
    pm10,
    pm25,
    pm10Grade: pm10 == null ? "정보없음" : gradePm("PM10", pm10),
    pm25Grade: pm25 == null ? "정보없음" : gradePm("PM25", pm25),
  };
}
