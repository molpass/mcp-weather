import { fetchForecast } from "../dist/kma.js";
import { fetchAir } from "../dist/airkorea.js";

const KEY = process.env.KMA_SERVICE_KEY ?? "";
const AIR = process.env.AIRKOREA_SERVICE_KEY ?? KEY;
if (!KEY) { console.error("KMA_SERVICE_KEY 미설정 (.env 로드 또는 env 주입 필요)"); process.exit(1); }

const spots = [
  { name: "안양", lat: 37.394, lon: 126.957 },
  { name: "시흥", lat: 37.380, lon: 126.803 },
  { name: "여의도", lat: 37.521, lon: 126.924 },
];
const now = new Date();
for (const s of spots) {
  console.log(`\n=== ${s.name} (${s.lat}, ${s.lon}) ===`);
  try {
    const fc = await fetchForecast(KEY, s.lat, s.lon, now);
    console.log("아침", fc.morning, "\n점심", fc.noon, "\n저녁", fc.evening);
  } catch (e) { console.log("날씨 실패:", e.message); }
  try {
    const air = await fetchAir(AIR, s.lat, s.lon);
    console.log("미세먼지:", air);
  } catch (e) { console.log("미세먼지 실패:", e.message); }
}
