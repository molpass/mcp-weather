---
name: weather
description: Use when the user asks about today's weather or air quality for one or more places — "오늘 안양 날씨", "여의도 미세먼지", "출근길 날씨". Maps intent to the get_weather MCP tool.
---

# weather

`mcp-weather` 서버의 `get_weather` 도구를 호출해 여러 위치의 오늘 아침/점심/저녁 날씨 + 미세먼지를 가져온다.
도구는 "사실"(예보·측정값), 이 스킬은 "의미"(위치 추출 + 좌표 매핑 + 요약)를 담당한다.

## 트리거

- "오늘 ○○ 날씨 / 미세먼지"
- "출근길/저녁 날씨", 여러 지역 동시 질의
- 데일리 리포트용 날씨·미세먼지 수집

## 동작

1. 메시지에서 위치 이름을 뽑고 각 위치의 lat/lon(WGS84)을 채운다(알려진 좌표 또는 사용자 제공).
2. `get_weather` 에 `locations` 배열로 한 번에 전달한다.
3. 위치별 아침/점심/저녁 + 미세먼지를 요약해 보여준다.

## 주의

- lat/lon은 WGS84. 좌표를 모르면 사용자에게 확인하거나 대표 좌표를 사용한다.
- 결과 일부 실패(날씨 또는 미세먼지)는 해당 줄만 실패로 표기되고 나머지는 정상 출력된다.
- API 키(`KMA_SERVICE_KEY`/`AIRKOREA_SERVICE_KEY`)는 서버 env로 주입된다. 발급 직후면 동기화 지연으로 일시적 키 오류가 날 수 있다.
