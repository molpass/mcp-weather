import { test } from "node:test";
import assert from "node:assert/strict";
import { dfs_xy_conv, selectBaseDateTime, gradePm, bucketize, fetchForecast } from "../dist/kma.js";

test("dfs_xy_conv 서울(37.5665,126.9780) → nx 60, ny 127 (KMA 공식 레퍼런스)", () => {
  const { nx, ny } = dfs_xy_conv(37.5665, 126.978);
  assert.equal(nx, 60);
  assert.equal(ny, 127);
});

test("dfs_xy_conv 안양(37.394,126.957) 격자 합리적 범위", () => {
  const { nx, ny } = dfs_xy_conv(37.394, 126.957);
  assert.ok(nx > 50 && nx < 65, `nx=${nx}`);
  assert.ok(ny > 115 && ny < 130, `ny=${ny}`);
});

test("selectBaseDateTime 13:00 KST → base 1100", () => {
  const r = selectBaseDateTime(new Date("2026-06-20T04:00:00Z")); // 13:00 KST
  assert.equal(r.base_time, "1100");
  assert.equal(r.base_date, "20260620");
});

test("selectBaseDateTime 02:05 KST(발표+10분 전) → 전일 2300", () => {
  const r = selectBaseDateTime(new Date("2026-06-19T17:05:00Z")); // 02:05 KST 6/20
  assert.equal(r.base_time, "2300");
  assert.equal(r.base_date, "20260619");
});

test("gradePm 등급 경계", () => {
  assert.equal(gradePm("PM10", 30), "좋음");
  assert.equal(gradePm("PM10", 81), "나쁨");
  assert.equal(gradePm("PM10", 151), "매우나쁨");
  assert.equal(gradePm("PM25", 15), "좋음");
  assert.equal(gradePm("PM25", 36), "나쁨");
  assert.equal(gradePm("PM25", 76), "매우나쁨");
});

test("bucketize 아침06-09 / 점심12-15 / 저녁18-21 집계", () => {
  const items = [
    { category: "TMP", fcstTime: "0600", fcstValue: "18" },
    { category: "TMP", fcstTime: "0900", fcstValue: "21" },
    { category: "SKY", fcstTime: "0600", fcstValue: "3" },
    { category: "PTY", fcstTime: "0600", fcstValue: "0" },
    { category: "POP", fcstTime: "0600", fcstValue: "30" },
    { category: "POP", fcstTime: "0900", fcstValue: "20" },
    { category: "TMP", fcstTime: "1200", fcstValue: "24" },
    { category: "SKY", fcstTime: "1200", fcstValue: "1" },
    { category: "PTY", fcstTime: "1200", fcstValue: "0" },
    { category: "POP", fcstTime: "1200", fcstValue: "10" },
  ];
  const b = bucketize(items);
  assert.equal(b.morning.tempMin, 18);
  assert.equal(b.morning.tempMax, 21);
  assert.equal(b.morning.pop, 30); // 구간 최대
  assert.equal(b.morning.sky, "구름많음");
  assert.equal(b.noon.sky, "맑음");
  assert.equal(b.noon.tempMax, 24);
});

// ── fetchForecast 재시도 (순간 rate limit 회복) ──────────────────────
// 실제 응답처럼 header(resultCode) 와 fcstDate 를 담는다. WHEN(6/20 13:00 KST) 기준 점심은 아직 지나지 않았다.
const OK_BODY = JSON.stringify({
  response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { items: { item: [
    { category: "TMP", fcstDate: "20260620", fcstTime: "1300", fcstValue: "18" },
    { category: "SKY", fcstDate: "20260620", fcstTime: "1200", fcstValue: "1" },
    { category: "PTY", fcstDate: "20260620", fcstTime: "1200", fcstValue: "0" },
  ] } } },
});
// data.go.kr 한도초과 = 비-JSON 에러 바디(현 "응답 파싱 실패" 경로)
const RATE_BODY = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>";

function mkFetch(bodies) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return { text: async () => bodies[Math.min(calls.length - 1, bodies.length - 1)] };
  };
  fn.calls = calls;
  return fn;
}
function mkSleep() {
  const fn = async () => { fn.count++; };
  fn.count = 0;
  return fn;
}
const WHEN = new Date("2026-06-20T04:00:00Z"); // 13:00 KST

test("fetchForecast 정상 응답 → 재시도 0회 즉시 통과(회귀 없음)", async () => {
  const f = mkFetch([OK_BODY]), s = mkSleep();
  const b = await fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s });
  assert.equal(f.calls.length, 1);
  assert.equal(s.count, 0);
  assert.equal(b.noon.tempMin, 18);
  assert.equal(b.noon.sky, "맑음");
});

test("fetchForecast 순간 rate-limit 1회 후 성공 → 재시도 1회(백오프 1회)", async () => {
  const f = mkFetch([RATE_BODY, OK_BODY]), s = mkSleep();
  const b = await fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 });
  assert.equal(f.calls.length, 2);
  assert.equal(s.count, 1);
  assert.equal(b.noon.sky, "맑음");
});

test("fetchForecast 계속 rate-limit → 상한(retries=2 → 3시도) 후 기존 문구 throw", async () => {
  const f = mkFetch([RATE_BODY]), s = mkSleep();
  await assert.rejects(
    fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 }),
    /KMA 응답 파싱 실패/,
  );
  assert.equal(f.calls.length, 3); // 최초 1 + 재시도 2
  assert.equal(s.count, 2);
});

test("fetchForecast serviceKey 에러는 재시도 안 함(즉시 throw)", async () => {
  const f = mkFetch(["SERVICE ERROR: invalid key"]), s = mkSleep();
  await assert.rejects(
    fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 }),
    /serviceKey/,
  );
  assert.equal(f.calls.length, 1);
  assert.equal(s.count, 0);
});

// ── 기상청 resultCode 확인 · 이전 발표분 사용 · 날짜 필터 (2026-10-15) ──────
// 기상청은 오류도 HTTP 200 + 정상 형식 JSON 으로 준다. 오류는 response.header.resultCode 에 있다.
const kmaBody = (code, msg, items = []) => JSON.stringify({
  response: { header: { resultCode: code, resultMsg: msg }, ...(code === "00" ? { body: { items: { item: items }, totalCount: items.length } } : {}) },
});
const NO_DATA = kmaBody("03", "NO_DATA");
const T = (date, time, cat, v) => ({ category: cat, fcstDate: date, fcstTime: time, fcstValue: String(v) });
const OK_TODAY = kmaBody("00", "NORMAL_SERVICE", [T("20260620", "1300", "TMP", 25)]);
// 공공데이터포털 게이트웨이 오류(XML). 실제 응답은 errMsg 에 늘 "SERVICE ERROR" 가 들어 있다.
const gwXml = (code, msg) => `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>${msg}</returnAuthMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

// base_time 별로 응답을 정한다. 값이 배열이면 그 발표분에 대한 호출 순서대로 쓴다.
function fetchByBase(map) {
  const calls = [], seen = {};
  const fn = async (url) => {
    const u = new URL(url);
    const bt = u.searchParams.get("base_time");
    calls.push(`${u.searchParams.get("base_date")} ${bt}`);
    const v = map[bt] ?? NO_DATA;
    const i = seen[bt] = (seen[bt] ?? -1) + 1;
    return { text: async () => (Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v) };
  };
  fn.calls = calls;
  return fn;
}

test("03 NO_DATA 면 이전 발표 시각으로 내려가 성공한 발표분을 쓴다(같은 발표분 재시도·대기 없음)", async () => {
  const f = fetchByBase({ "1100": NO_DATA, "0800": OK_TODAY }), s = mkSleep();
  const b = await fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s });
  assert.deepEqual(f.calls, ["20260620 1100", "20260620 0800"]);
  assert.equal(s.count, 0);
  assert.equal(b.base_date, "20260620");
  assert.equal(b.base_time, "0800");
  assert.equal(b.noon.tempMin, 25);
});

test("발표분 4개(최신 + 이전 3단계)가 모두 03 이면 'KMA 오류 03' 으로 실패한다", async () => {
  const f = fetchByBase({}), s = mkSleep();
  await assert.rejects(
    fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s }),
    /KMA 오류 03 NO_DATA/,
  );
  assert.deepEqual(f.calls, ["20260620 1100", "20260620 0800", "20260620 0500", "20260620 0200"]);
});

test("02시 발표분에서 한 단계 내려가면 전날 23시 발표분이다", async () => {
  const at0530 = new Date("2026-06-19T20:30:00Z"); // 05:30 KST 6/20 → 최신 0500
  const f = fetchByBase({ "0500": NO_DATA, "0200": NO_DATA, "2300": kmaBody("00", "NORMAL_SERVICE", [T("20260620", "0600", "TMP", 17)]) });
  const b = await fetchForecast("KEY", 37.394, 126.957, at0530, { fetchImpl: f, sleepImpl: mkSleep() });
  assert.deepEqual(f.calls, ["20260620 0500", "20260620 0200", "20260619 2300"]);
  assert.equal(b.base_date, "20260619");
  assert.equal(b.morning.tempMin, 17);
});

test("일시 오류(01·02·04·05·99)는 같은 발표분으로 재시도해서 회복한다", async () => {
  for (const code of ["01", "02", "04", "05", "99"]) {
    const f = fetchByBase({ "1100": [kmaBody(code, "ERR"), OK_TODAY] }), s = mkSleep();
    const b = await fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 });
    assert.deepEqual(f.calls, ["20260620 1100", "20260620 1100"], `code ${code}`);
    assert.equal(s.count, 1, `code ${code}`);
    assert.equal(b.noon.tempMin, 25, `code ${code}`);
  }
});

test("일시 오류가 재시도 상한까지 이어지면 'KMA 오류 <코드> <메시지>' 로 실패한다", async () => {
  const f = fetchByBase({ "1100": kmaBody("01", "APPLICATION_ERROR") }), s = mkSleep();
  await assert.rejects(
    fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 }),
    /KMA 오류 01 APPLICATION_ERROR/,
  );
  assert.equal(f.calls.length, 3);
});

test("키·권한·한도·요청 오류(JSON)는 재시도하지 않고 이전 발표분으로도 내려가지 않는다", async () => {
  for (const code of ["10", "11", "12", "20", "21", "22", "30", "31", "32", "33"]) {
    const f = fetchByBase({ "1100": kmaBody(code, "MSG" + code) }), s = mkSleep();
    await assert.rejects(
      fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 }),
      new RegExp(`KMA 오류 ${code} MSG${code}`),
    );
    assert.equal(f.calls.length, 1, `code ${code}`);
    assert.equal(s.count, 0, `code ${code}`);
  }
});

test("게이트웨이 XML 22(일일 한도 초과)는 재시도하지 않는다", async () => {
  const f = fetchByBase({ "1100": gwXml("22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR") }), s = mkSleep();
  await assert.rejects(
    fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 }),
    /KMA 오류 22 LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR/,
  );
  assert.equal(f.calls.length, 1);
});

test("게이트웨이 XML 23(초당 한도 초과)은 'SERVICE ERROR' 문구가 있어도 재시도한다", async () => {
  const f = fetchByBase({ "1100": [gwXml("23", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR"), OK_TODAY] }), s = mkSleep();
  const b = await fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: s, retries: 2 });
  assert.equal(f.calls.length, 2);
  assert.equal(s.count, 1);
  assert.equal(b.noon.tempMin, 25);
});

test("오늘(KST) fcstDate 만 쓴다 — 다음 날 같은 시간대 값을 섞지 않는다", async () => {
  const f = fetchByBase({ "1100": kmaBody("00", "NORMAL_SERVICE", [
    T("20260620", "1200", "TMP", 20), T("20260620", "1500", "TMP", 22),
    T("20260621", "1200", "TMP", 30), T("20260622", "1500", "TMP", 5),
    T("20260620", "1200", "POP", 10), T("20260621", "1200", "POP", 90),
  ]) });
  const b = await fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: mkSleep() });
  assert.equal(b.noon.tempMin, 20);
  assert.equal(b.noon.tempMax, 22);
  assert.equal(b.noon.pop, 10);
});

test("이미 지난 시간대는 다음 날 값으로 채우지 않고 past 로 표시한다", async () => {
  const f = fetchByBase({ "1100": kmaBody("00", "NORMAL_SERVICE", [
    T("20260621", "0600", "TMP", 13), T("20260621", "0900", "TMP", 19), T("20260621", "0600", "POP", 60),
    T("20260620", "1300", "TMP", 25),
  ]) });
  const b = await fetchForecast("KEY", 37.394, 126.957, WHEN, { fetchImpl: f, sleepImpl: mkSleep() }); // 13:00 KST
  assert.equal(b.morning.past, true);
  assert.equal(b.morning.tempMin, null);
  assert.equal(b.morning.pop, null);
  assert.equal(b.noon.past, false);
  assert.equal(b.evening.past, false);
});

test("시간대 경계: 09시대까지는 아침이 지나지 않았고 10:00 부터 지난 시간대다", async () => {
  const body = kmaBody("00", "NORMAL_SERVICE", [T("20260620", "0900", "TMP", 16)]);
  const at0959 = new Date("2026-06-20T00:59:00Z"), at1000 = new Date("2026-06-20T01:00:00Z");
  const b1 = await fetchForecast("KEY", 37.394, 126.957, at0959, { fetchImpl: fetchByBase({ "0800": body }), sleepImpl: mkSleep() });
  const b2 = await fetchForecast("KEY", 37.394, 126.957, at1000, { fetchImpl: fetchByBase({ "0800": body }), sleepImpl: mkSleep() });
  assert.equal(b1.morning.past, false);
  assert.equal(b1.morning.tempMin, 16);
  assert.equal(b2.morning.past, true);
});
