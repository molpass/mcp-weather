import { test } from "node:test";
import assert from "node:assert/strict";
import { toTM, fetchAir } from "../dist/airkorea.js";

test("toTM 안양(37.394,126.957) → TM 좌표 합리적 범위(EPSG:5181)", () => {
  const { tmX, tmY } = toTM(37.394, 126.957);
  // 수도권 EPSG:5181 TM은 대략 x 180000~210000, y 430000~470000 범위
  assert.ok(tmX > 150000 && tmX < 230000, `tmX=${tmX}`);
  assert.ok(tmY > 400000 && tmY < 500000, `tmY=${tmY}`);
});

// ── fetchAir: 결과 코드 확인 · 재시도 · 다음 측정소 사용 (2026-10-15) ──────────
// 2026-10-15 측정: 공공데이터포털 게이트웨이가 약 30초 뒤 HTTP 504 와 함께 이 JSON 을 돌려준다.
// 기존 코드는 이것을 정상 JSON 으로 읽어 측정소 없음 → "근접 측정소 없음"으로 처리했다.
const gwJson = (code, msg) => JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: msg, returnAuthMsg: "서비스 연결실패 에러", returnReasonCode: code } } });
const GW05 = gwJson("05", "SERVICETIMEOUT_ERROR");
const hdr = (code, msg, items) => JSON.stringify({ response: { header: { resultCode: code, resultMsg: msg }, ...(items ? { body: { items, totalCount: items.length } } : {}) } });
const STATIONS = hdr("00", "NORMAL_CODE", [
  { stationName: "부림동", tm: 0.7 }, { stationName: "안양8동", tm: 2.1 }, { stationName: "호계3동", tm: 2.1 },
]);
const meas = (pm10, pm25, flag = null) => hdr("00", "NORMAL_CODE", [{ dataTime: "2026-10-15 15:00", pm10Value: pm10, pm25Value: pm25, pm10Flag: flag, pm25Flag: flag }]);

// 요청 종류(측정소 목록 / 측정값)와 측정소 이름별로 응답을 정한다. 값이 배열이면 호출 순서대로 쓴다.
function airFetch({ list, byStation = {} }) {
  const calls = [], seen = {};
  const pick = (key, v) => { const i = seen[key] = (seen[key] ?? -1) + 1; return Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v; };
  const fn = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("getNearbyMsrstnList")) { calls.push("목록"); return { text: async () => pick("목록", list) }; }
    const st = u.searchParams.get("stationName");
    calls.push(st);
    return { text: async () => pick(st, byStation[st] ?? meas("-", "-", "통신장애")) };
  };
  fn.calls = calls;
  return fn;
}
const sleep = () => { const f = async () => { f.count++; }; f.count = 0; return f; };
const LAT = 37.3866, LON = 126.9522;

test("fetchAir 정상: 가장 가까운 측정소 값을 쓰고 요청은 2번", async () => {
  const f = airFetch({ list: STATIONS, byStation: { 부림동: meas("27", "7") } });
  const a = await fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep() });
  assert.deepEqual(f.calls, ["목록", "부림동"]);
  assert.equal(a.station, "부림동");
  assert.equal(a.pm10, 27);
  assert.equal(a.pm25Grade, "좋음");
});

test("게이트웨이 05(JSON)는 일시 오류로 재시도해서 회복한다 — '근접 측정소 없음'으로 바꾸지 않는다", async () => {
  const s = sleep();
  const f = airFetch({ list: [GW05, STATIONS], byStation: { 부림동: meas("27", "7") } });
  const a = await fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: s, retries: 1 });
  assert.deepEqual(f.calls, ["목록", "목록", "부림동"]);
  assert.equal(s.count, 1);
  assert.equal(a.station, "부림동");
});

test("게이트웨이 05 가 재시도 상한까지 이어지면 '에어코리아 오류 05 …' 로 실패한다", async () => {
  const f = airFetch({ list: GW05 });
  await assert.rejects(
    fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep(), retries: 1 }),
    /에어코리아 오류 05 SERVICETIMEOUT_ERROR/,
  );
  assert.deepEqual(f.calls, ["목록", "목록"]);
});

test("측정값 단계의 일시 오류도 같은 측정소로 재시도한다", async () => {
  const f = airFetch({ list: STATIONS, byStation: { 부림동: [GW05, meas("27", "7")] } });
  const a = await fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep(), retries: 1 });
  assert.deepEqual(f.calls, ["목록", "부림동", "부림동"]);
  assert.equal(a.station, "부림동");
});

test("일시 오류(01·02·04·05, 응답 헤더 코드)는 재시도한다", async () => {
  for (const code of ["01", "02", "04", "05"]) {
    const s = sleep();
    const f = airFetch({ list: [hdr(code, "ERR"), STATIONS], byStation: { 부림동: meas("27", "7") } });
    const a = await fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: s, retries: 1 });
    assert.equal(s.count, 1, `code ${code}`);
    assert.equal(a.station, "부림동", `code ${code}`);
  }
});

test("요청·키·권한·한도 오류는 재시도하지 않는다(응답 헤더 코드·게이트웨이 코드 모두)", async () => {
  for (const body of [hdr("22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR"), hdr("30", "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"),
    hdr("10", "INVALID_REQUEST_PARAMETER_ERROR"), gwJson("22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR"),
    gwJson("30", "SERVICE_KEY_IS_NOT_REGISTERED_ERROR")]) {
    const s = sleep();
    const f = airFetch({ list: body });
    await assert.rejects(fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: s, retries: 2 }), /에어코리아 오류 (22|30|10) /);
    assert.equal(f.calls.length, 1);
    assert.equal(s.count, 0);
  }
});

test("응답 헤더 03(데이터 없음)은 재시도하지 않고 사유를 남긴다", async () => {
  const f = airFetch({ list: hdr("03", "NO_DATA") });
  await assert.rejects(fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep(), retries: 2 }), /에어코리아 오류 03/);
  assert.equal(f.calls.length, 1);
});

test("정상 응답인데 측정소 목록이 비면 '근접 측정소 없음' (기존 문구 유지)", async () => {
  const f = airFetch({ list: hdr("00", "NORMAL_CODE", []) });
  await assert.rejects(fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep() }), /근접 측정소 없음/);
});

test("가장 가까운 측정소 값이 비었거나(통신장애 등) 점검 중이면 다음으로 가까운 측정소를 쓴다", async () => {
  const f = airFetch({ list: STATIONS, byStation: { 부림동: meas("-", "-", "통신장애"), 안양8동: meas("21", "10") } });
  const a = await fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep() });
  assert.deepEqual(f.calls, ["목록", "부림동", "안양8동"]);
  assert.equal(a.station, "안양8동");
  assert.equal(a.pm10, 21);
});

test("값은 있어도 상태 플래그(점검및교정 등)가 붙은 측정소는 건너뛴다", async () => {
  const f = airFetch({ list: STATIONS, byStation: { 부림동: meas("13", "5", "점검및교정"), 안양8동: meas("21", "10") } });
  const a = await fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep() });
  assert.equal(a.station, "안양8동");
});

test("근접 측정소 3곳 모두 값이 없으면 측정소별 사유를 담아 실패한다", async () => {
  const f = airFetch({ list: STATIONS, byStation: {
    부림동: meas("-", "-", "통신장애"), 안양8동: meas("-", "-", "점검및교정"), 호계3동: meas("", ""),
  } });
  await assert.rejects(
    fetchAir("KEY", LAT, LON, { fetchImpl: f, sleepImpl: sleep() }),
    /근접 측정소 3곳 모두 측정값 없음 \(부림동 통신장애, 안양8동 점검및교정, 호계3동 값 없음\)/,
  );
  assert.deepEqual(f.calls, ["목록", "부림동", "안양8동", "호계3동"]);
});

// 응답하지 않는 fetch. AbortSignal.timeout 의 타이머는 이벤트 루프를 붙잡지 않으므로
// 테스트 프로세스가 먼저 끝나지 않게 타이머 하나를 abort 될 때까지 걸어 둔다.
const never = (init) => new Promise((_, rej) => {
  const keep = setInterval(() => {}, 1000);
  init.signal.addEventListener("abort", () => { clearInterval(keep); rej(init.signal.reason); });
});

test("응답이 제한 시간 안에 오지 않으면 일시 오류로 보고 재시도한다", async () => {
  let n = 0;
  const hang = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith("getNearbyMsrstnList") && n++ === 0) return never(init);
    return { text: async () => (u.pathname.endsWith("getNearbyMsrstnList") ? STATIONS : meas("27", "7")) };
  };
  const a = await fetchAir("KEY", LAT, LON, { fetchImpl: hang, sleepImpl: sleep(), retries: 1, timeoutMs: 30 });
  assert.equal(a.station, "부림동");
  assert.equal(n, 2);
});

test("제한 시간 초과가 재시도 상한까지 이어지면 '에어코리아 응답 없음' 으로 실패한다", async () => {
  const hang = async (url, init) => never(init);
  await assert.rejects(
    fetchAir("KEY", LAT, LON, { fetchImpl: hang, sleepImpl: sleep(), retries: 1, timeoutMs: 30 }),
    /에어코리아 응답 없음/,
  );
});
