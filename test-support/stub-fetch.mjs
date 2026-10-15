// 테스트 전용 preload: `node --import ./test-support/stub-fetch.mjs dist/index.js`
// test/ 밖에 두는 이유: `node --test` 는 test/ 안의 .mjs 를 모두 테스트 파일로 실행한다.
// 네트워크 없이 MCP 서버의 get_weather 응답 문장을 검사하기 위해 fetch 와 현재 시각을 바꾼다.
//   STUB_NOW  — 고정할 현재 시각(ISO)
//   STUB_KMA  — { "<base_time>": "<응답 본문>" } JSON. 없는 base_time 은 03 NO_DATA.
//   STUB_AIR_PM10 — 미세먼지 응답의 pm10 값
//   STUB_AIR_GW   — 지정하면 미세먼지 요청에 그 코드의 게이트웨이 오류(JSON)를 돌려준다
const RealDate = Date;
if (process.env.STUB_NOW) {
  const fixed = new RealDate(process.env.STUB_NOW).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  };
}
const kma = JSON.parse(process.env.STUB_KMA ?? "{}");
const NO_DATA = JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } });
globalThis.fetch = async (url) => {
  const u = new URL(url);
  let body;
  if (u.pathname.includes("VilageFcstInfoService")) body = kma[u.searchParams.get("base_time")] ?? NO_DATA;
  else if (process.env.STUB_AIR_GW) body = JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICETIMEOUT_ERROR", returnAuthMsg: "서비스 연결실패 에러", returnReasonCode: process.env.STUB_AIR_GW } } });
  else if (u.pathname.includes("getNearbyMsrstnList")) body = JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL_CODE" }, body: { items: [{ stationName: "시험측정소" }] } } });
  else body = JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL_CODE" }, body: { items: [{ pm10Value: process.env.STUB_AIR_PM10 ?? "20", pm25Value: "10" }] } } });
  return { text: async () => body };
};
