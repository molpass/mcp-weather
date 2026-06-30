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
const OK_BODY = JSON.stringify({
  response: { body: { items: { item: [
    { category: "TMP", fcstTime: "0600", fcstValue: "18" },
    { category: "SKY", fcstTime: "1200", fcstValue: "1" },
    { category: "PTY", fcstTime: "1200", fcstValue: "0" },
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
  assert.equal(b.morning.tempMin, 18);
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
