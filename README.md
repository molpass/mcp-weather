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
아침(06-09) 18~23°C · 맑음 · 강수 30%
점심(12-15) 22~30°C · 비 · 강수 60%
저녁(18-21) 21~27°C · 비 · 강수 60%
미세먼지 PM10 11 (좋음) · PM2.5 6 (좋음)  [측정소: 부림동]
```

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

## License

MIT
