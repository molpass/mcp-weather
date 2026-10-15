// 공공데이터포털 게이트웨이(apis.data.go.kr) 오류 해석. 게이트웨이는 기관 API 앞에서 자체 오류를 낸다.
// 형식은 XML(<returnReasonCode>)이고, JSON 을 요청(dataType/returnType=json)하면 JSON
// (OpenAPI_ServiceResponse.cmmMsgHeader)으로도 온다. JSON 형식에는 response.header 가 없으므로
// 코드로 가르지 않으면 "빈 정상 응답"으로 읽힌다.
// 2026-10-15 측정: 에어코리아 요청 일부가 약 30초 뒤 HTTP 504 + JSON 05 SERVICETIMEOUT_ERROR 로 끝났다.
export interface GatewayError { code: string; msg: string }

export function gatewayError(text: string): GatewayError | null {
  const xml = text.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/)?.[1];
  if (xml) return { code: xml, msg: text.match(/<returnAuthMsg>([^<]*)</)?.[1] ?? "" };
  if (!text.includes("OpenAPI_ServiceResponse")) return null;
  try {
    const h = JSON.parse(text)?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (h?.returnReasonCode) return { code: String(h.returnReasonCode), msg: String(h.errMsg ?? h.returnAuthMsg ?? "") };
  } catch {
    // JSON 이 아니면 게이트웨이 오류로 보지 않는다(호출부의 파싱 실패 처리로 넘긴다)
  }
  return null;
}
