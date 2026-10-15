import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// MCP 서버(dist/index.js)를 실제로 띄워 get_weather 응답 문장을 검사한다. fetch·시각은 stub-fetch.mjs 가 바꾼다.
async function getWeather(env) {
  const p = spawn(process.execPath, ["--import", "./test-support/stub-fetch.mjs", "dist/index.js"], {
    env: { ...process.env, KMA_SERVICE_KEY: "TESTKEY", AIRKOREA_SERVICE_KEY: "TESTKEY", ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rl = createInterface({ input: p.stdout });
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
  const reply = new Promise((resolve) => rl.on("line", (l) => { const m = JSON.parse(l); if (m.id === 2) resolve(m); }));
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_weather", arguments: { locations: [{ name: "안양", lat: 37.394, lon: 126.957 }] } } });
  const m = await reply;
  p.kill();
  return m.result.content[0].text;
}

const NOW_13 = "2026-06-20T04:00:00Z"; // 13:00 KST, 최신 발표 1100
const ok = (items) => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { items: { item: items } } } });
const NO_DATA_BODY = JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } });

test("get_weather: 기상청 실패 사유를 그 지역 결과에 담고, 미세먼지는 그대로 돌려준다", async () => {
  const text = await getWeather({ STUB_NOW: NOW_13, STUB_KMA: "{}", STUB_AIR_PM10: "20" });
  assert.match(text, /날씨 조회 실패: KMA 오류 03 NO_DATA/);
  assert.doesNotMatch(text, /정보없음 · 강수/);
  assert.match(text, /미세먼지 PM10 20 \(좋음\)/);
});

test("get_weather: 미세먼지가 실패하면 사유를 남기고, 기상청 결과는 그대로 돌려준다", async () => {
  const kma = { "1100": ok([{ category: "TMP", fcstDate: "20260620", fcstTime: "1300", fcstValue: "25" }]) };
  const text = await getWeather({ STUB_NOW: NOW_13, STUB_KMA: JSON.stringify(kma), STUB_AIR_GW: "22" });
  assert.match(text, /미세먼지 조회 실패: 에어코리아 오류 22 /);
  assert.doesNotMatch(text, /근접 측정소 없음/);
  assert.match(text, /점심\(12-15\) 25°C/);
});

test("get_weather: 지난 시간대는 '지난 시간대'로 쓰고, 실제로 쓴 발표 시각을 밝힌다", async () => {
  const kma = { "1100": NO_DATA_BODY, "0800": ok([
    { category: "TMP", fcstDate: "20260620", fcstTime: "1300", fcstValue: "25" },
    { category: "TMP", fcstDate: "20260621", fcstTime: "0600", fcstValue: "13" },
  ]) };
  const text = await getWeather({ STUB_NOW: NOW_13, STUB_KMA: JSON.stringify(kma) });
  assert.match(text, /아침\(06-09\) 지난 시간대/);
  assert.match(text, /점심\(12-15\) 25°C/);
  assert.match(text, /기상청 06-20 08:00 발표/);
});
