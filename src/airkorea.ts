import proj4 from "proj4";
import { gradePm } from "./kma.js";
import { gatewayError } from "./gateway.js";

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

export interface FetchAirOpts {
  fetchImpl?: (url: URL, init: { signal: AbortSignal }) => Promise<{ text(): Promise<string> }>; // 테스트 주입용
  sleepImpl?: (ms: number) => Promise<void>;
  retries?: number;    // 요청마다 재시도 횟수(최초 시도 제외)
  backoffMs?: number;  // 재시도 간 대기
  timeoutMs?: number;  // 요청 하나의 제한 시간
}

const _sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// 같은 요청으로 재시도할 일시 오류. 에어코리아 OpenAPI 기술문서(2026-06-30) 오류 코드 표의 01·02·04·05
// ("서비스 제공 상태가 원활하지 않습니다") + 게이트웨이 23(초당 한도)·99. 그 밖의 코드(03 데이터 없음,
// 10·11·12 요청 오류, 20·22·30·31·32·34 권한·한도·키)는 재시도해도 같으므로 바로 실패한다.
const RETRYABLE = new Set(["01", "02", "04", "05", "23", "99"]);

export async function fetchAir(serviceKey: string, lat: number, lon: number, opts: FetchAirOpts = {}): Promise<AirResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const doSleep = opts.sleepImpl ?? _sleep;
  // 2026-10-15 측정(요청 120회): 약 30% 가 게이트웨이 504 + 05 로 30초 뒤에 끝났고(한 번은 57초 503),
  // 성공은 95% 가 1초 안, 가장 느린 것이 15.8초였다. 그래서 요청 제한 시간 20초로 30초 대기를 끊고,
  // 실패가 몰려 나는 구간이 있어 5초 간격으로 2회 재시도한다. 최악은 단계당 70초, 두 단계 140초로
  // 헤르메스 MCP 호출 제한(기본 300초) 안이다.
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 20000;

  // 결과 코드가 00 인 응답 JSON. 게이트웨이 오류·응답 헤더 오류·제한 시간 초과를 사유와 함께 실패로 올린다.
  async function getJson(url: URL, label: string): Promise<any> {
    let lastErr: Error = new Error(`에어코리아 ${label} 응답 파싱 실패`);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await doSleep(backoffMs);
      let text: string;
      try {
        text = await (await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) })).text();
      } catch (e: any) {
        lastErr = e?.name === "TimeoutError" || e?.name === "AbortError"
          ? new Error(`에어코리아 응답 없음(${label}, ${Math.round(timeoutMs / 1000)}초 제한)`)
          : new Error(`에어코리아 연결 실패(${label}): ${e?.message ?? e}`);
        continue;
      }
      const gw = gatewayError(text);
      if (gw) {
        lastErr = new Error(`에어코리아 오류 ${gw.code} ${gw.msg}`.trim());
        if (RETRYABLE.has(gw.code)) continue;
        throw lastErr;
      }
      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        // 문자열 검사는 JSON 이 아닐 때만 한다. JSON 응답 헤더의 키 오류 메시지(SERVICE_KEY_…)는 아래에서 코드로 가른다.
        if (text.includes("SERVICE_KEY") || text.includes("SERVICE ERROR"))
          throw new Error(`AirKorea serviceKey 오류(발급 직후면 동기화 대기 후 재시도): ${text.slice(0, 200)}`);
        lastErr = new Error(`에어코리아 ${label} 응답 파싱 실패: ${text.slice(0, 200)}`);
        continue;
      }
      const code: string | undefined = j?.response?.header?.resultCode;
      if (code !== "00") {
        lastErr = new Error(`에어코리아 오류 ${code ?? "?"} ${j?.response?.header?.resultMsg ?? "응답 형식이 다름"}`.trim());
        if (code && RETRYABLE.has(code)) continue;
        throw lastErr;
      }
      return j;
    }
    throw lastErr;
  }

  const { tmX, tmY } = toTM(lat, lon);
  // 1) 근접 측정소 (가까운 순서)
  const u1 = new URL("https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getNearbyMsrstnList");
  u1.searchParams.set("serviceKey", serviceKey);
  u1.searchParams.set("returnType", "json");
  u1.searchParams.set("tmX", String(Math.round(tmX)));
  u1.searchParams.set("tmY", String(Math.round(tmY)));
  u1.searchParams.set("ver", "1.1");
  const j1 = await getJson(u1, "측정소");
  const stations: string[] = (j1?.response?.body?.items ?? []).map((i: any) => i?.stationName).filter(Boolean);
  if (!stations.length) throw new Error(`근접 측정소 없음 (TM ${Math.round(tmX)},${Math.round(tmY)})`);

  // 2) 실시간 측정. 값이 비었거나('-'·빈 값) 상태 플래그(점검및교정·장비점검·자료이상·통신장애)가 붙은
  // 측정소는 건너뛰고 다음으로 가까운 측정소를 쓴다. 근접 측정소 목록(측정 결과 3곳, 0.5~3.8km) 전부를 본다.
  // 2026-10-15 측정: 서울 근접 3곳 중 종로가 '-'·통신장애였고 나머지 2곳은 값이 있었다.
  const skipped: string[] = [];
  for (const station of stations) {
    const u2 = new URL("https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty");
    u2.searchParams.set("serviceKey", serviceKey);
    u2.searchParams.set("returnType", "json");
    u2.searchParams.set("stationName", station);
    u2.searchParams.set("dataTerm", "DAILY");
    u2.searchParams.set("ver", "1.3");
    u2.searchParams.set("numOfRows", "1");
    u2.searchParams.set("pageNo", "1");
    const it = (await getJson(u2, "측정값"))?.response?.body?.items?.[0] ?? {};
    const num = (v: unknown) => (v != null && v !== "" && v !== "-" ? Number(v) : null);
    const pm10 = num(it.pm10Value), pm25 = num(it.pm25Value);
    const flag = it.pm10Flag || it.pm25Flag;
    if (pm10 == null || pm25 == null || flag) {
      skipped.push(`${station} ${flag || "값 없음"}`);
      continue;
    }
    return {
      station,
      pm10,
      pm25,
      pm10Grade: gradePm("PM10", pm10),
      pm25Grade: gradePm("PM25", pm25),
    };
  }
  throw new Error(`근접 측정소 ${stations.length}곳 모두 측정값 없음 (${skipped.join(", ")})`);
}
