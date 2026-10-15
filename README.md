# mcp-weather

여러 위치의 **오늘 아침/점심/저녁 날씨**(기상청 단기예보)와 **미세먼지**(에어코리아)를 반환하는 MCP 서버.

> 출력은 구조화 텍스트(데일리 리포트용). LLM이 사실로 소비하도록 설계됨.

## 도구

### `get_weather`

입력: `{ locations: [{ name, lat, lon }] }` (여러 곳 한 번에)

| 필드 | 타입 | 설명 |
|---|---|---|
| `name` | string | 위치 이름 |
| `lat` | number | 위도 (WGS84) |
| `lon` | number | 경도 (WGS84) |

**출력**(위치별): 아침(06-09)·점심(12-15)·저녁(18-21) 기온·하늘상태·강수확률 + 미세먼지 PM10/PM2.5 수치·등급(좋음/보통/나쁨/매우나쁨)·측정소명.

예시:
```
📍 안양 (37.394, 126.957)
아침(06-09) 지난 시간대
점심(12-15) 22~30°C · 비 · 강수 60%
저녁(18-21) 21~27°C · 비 · 강수 60%
(기상청 10-15 08:00 발표 기준)
미세먼지 PM10 11 (좋음) · PM2.5 6 (좋음)  [측정소: 부림동]
```

### 날짜 처리

- 기상청 응답에는 2~5일치 예보가 들어 있다. 오늘(KST) `fcstDate` 값만 쓴다.
- 이미 지난 시간대(아침은 10시부터, 점심은 16시부터, 저녁은 22시부터)는 다음 날 값으로 채우지 않고 `지난 시간대` 로 표시한다.
- 실제로 쓴 발표 시각을 `(기상청 MM-DD HH:00 발표 기준)` 줄로 밝힌다.

### 오류 표시

기상청은 오류도 HTTP 200 과 정상 형식 JSON 으로 준다(`response.header.resultCode`). `00` 이 아니면 그 지역 결과에 사유를 적는다. 미세먼지는 따로 조회하므로 그대로 나온다.

```
날씨 조회 실패: KMA 오류 22 LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR
```

| 코드 | 처리 |
|---|---|
| `03` NO_DATA | 이전 발표 시각(3시간 전)으로 내려가 다시 요청한다. 최대 3단계. 모두 없으면 `KMA 오류 03 NO_DATA (발표 … 모두 자료 없음)` |
| `01` `02` `04` `05` `99`, 게이트웨이 `23` | 일시 오류. 같은 발표분으로 2.5초 간격 최대 2회 재시도 |
| `10` `11` `12`, `20` `21` `22` `30`~`33` | 요청·키·권한·일일 한도 오류. 재시도하지 않고 바로 실패 |

최근 발표분 1~2개는 기상청 서버가 요청마다 `03` 을 섞어 돌려주는 경우가 있다(2026-10-15 측정). 그래서 `03` 은 같은 발표분 재시도가 아니라 이전 발표분 사용으로 처리한다.

미세먼지(에어코리아)도 결과 코드를 확인한다. 실패하면 그 지역에 `미세먼지 조회 실패: <사유>` 줄을 남기고, 날씨 줄은 그대로 둔다.

| 경우 | 처리 |
|---|---|
| `01` `02` `04` `05`, 게이트웨이 `23` `99`, 응답 없음(요청당 20초 제한) | 일시 오류. 같은 요청으로 5초 간격 최대 2회 재시도. 계속되면 `에어코리아 오류 05 SERVICETIMEOUT_ERROR` 처럼 실패 |
| `03`, `10` `11` `12`, `20` `22` `30`~`34` | 재시도하지 않고 바로 실패 |
| 측정값이 `-`·빈 값이거나 상태 플래그(점검및교정·장비점검·자료이상·통신장애)가 있음 | 다음으로 가까운 측정소를 쓴다(근접 측정소 목록 전부, 보통 3곳). 실제로 쓴 측정소 이름을 표시한다. 모두 비면 `근접 측정소 3곳 모두 측정값 없음 (측정소별 사유)` |

2026-10-15 측정에서 에어코리아 요청의 약 30% 가 게이트웨이 504(`05`)로 30초 뒤에 끝났다. 이 응답을 예전에는 "근접 측정소 없음"·"정보없음"으로 잘못 표시했다.

공공데이터포털 게이트웨이는 JSON 요청에 오류를 JSON(`OpenAPI_ServiceResponse`)으로도 준다. 이 형식에는 `response.header` 가 없으므로 기상청·에어코리아 모두 게이트웨이 오류 코드를 먼저 확인한다(`src/gateway.ts`).

## 환경변수 (키)

data.go.kr 일반 인증키 1개로 KMA + AirKorea 모두 사용. `.env`(커밋 금지, `.env.example` 참고):

```
KMA_SERVICE_KEY=YOUR_DATA_GO_KR_KEY
AIRKOREA_SERVICE_KEY=YOUR_DATA_GO_KR_KEY
```

> 키는 절대 커밋하지 않는다(`.env`는 .gitignore). 발급 직후 ~1시간 동기화 지연이 있을 수 있다.

## 설치

```bash
git clone https://github.com/molpass/mcp-weather.git
cd mcp-weather
npm install && npm run build
```

예제(세 좌표 라이브, 키 필요):

```bash
KMA_SERVICE_KEY=... AIRKOREA_SERVICE_KEY=... npm run example
```

## Hermes / MCP 등록

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/abs/path/mcp-weather/dist/index.js"],
      "env": { "KMA_SERVICE_KEY": "...", "AIRKOREA_SERVICE_KEY": "..." }
    }
  }
}
```

> `/abs/path` 는 클론한 실제 절대경로로 바꾼다. Windows 예: `"C:/Users/<you>/mcp-weather/dist/index.js"`.

## 스택

- Node 20+ / TypeScript · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (stdio) · [`proj4`](https://www.npmjs.com/package/proj4) (WGS84→TM 변환)
- 소스: 기상청 단기예보 `getVilageFcst` · 에어코리아 `getNearbyMsrstnList` + `getMsrstnAcctoRltmMesureDnsty`
- 좌표: lat/lon → KMA LCC 격자(nx/ny) · lat/lon → TM(EPSG:5181, 근접 측정소용)

## 스킬

페어링 스킬: [`skill/weather.skill.md`](skill/weather.skill.md) — 의도를 `get_weather` 파라미터로 매핑한다.

## About / 제작

**Hermes Agent용 MCP** — molpass의 바이브 코딩(vibe coding) 프로젝트.

- 아이디어·방향: **molpass (이정훈)** · https://zeolinex.com
- 기획: **Claude (Chat)**
- 개발: **Claude Code**

자가 호스팅 [Hermes Agent](https://github.com/NousResearch/hermes-agent)에 도구로 붙여 쓰는 MCP 서버입니다.

같은 모음:
- [mcp-saju](https://github.com/molpass/mcp-saju) — 사주명리 만세력
- [mcp-qr](https://github.com/molpass/mcp-qr) — QR 코드 생성
- [mcp-biorhythm](https://github.com/molpass/mcp-biorhythm) — 바이오리듬
- [mcp-astrology](https://github.com/molpass/mcp-astrology) — 서양 점성술 네이탈 차트
- [mcp-ziwei](https://github.com/molpass/mcp-ziwei) — 자미두수 명반
- [mcp-numerology](https://github.com/molpass/mcp-numerology) — 수비학
- [mcp-liuren](https://github.com/molpass/mcp-liuren) — 대육임
- [mcp-qimen](https://github.com/molpass/mcp-qimen) — 기문둔갑
- [mcp-taiyi](https://github.com/molpass/mcp-taiyi) — 태을신수
- [mcp-weather](https://github.com/molpass/mcp-weather) — 한국 날씨·미세먼지
- [mcp-newsfeed](https://github.com/molpass/mcp-newsfeed) — 한국 주요뉴스

## License

MIT
