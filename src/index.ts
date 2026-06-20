#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchForecast, type Bucket } from "./kma.js";
import { fetchAir } from "./airkorea.js";

const KMA_KEY = process.env.KMA_SERVICE_KEY ?? "";
const AIR_KEY = process.env.AIRKOREA_SERVICE_KEY ?? KMA_KEY;

function fmtBucket(label: string, b: Bucket): string {
  const temp = b.tempMin == null ? "--" : b.tempMin === b.tempMax ? `${b.tempMin}°C` : `${b.tempMin}~${b.tempMax}°C`;
  const pop = b.pop == null ? "--" : `${b.pop}%`;
  return `${label} ${temp} · ${b.sky} · 강수 ${pop}`;
}

async function oneLocation(name: string, lat: number, lon: number, now: Date): Promise<string> {
  const head = `📍 ${name} (${lat}, ${lon})`;
  const [fc, air] = await Promise.allSettled([
    fetchForecast(KMA_KEY, lat, lon, now),
    fetchAir(AIR_KEY, lat, lon),
  ]);
  const lines: string[] = [head];
  if (fc.status === "fulfilled") {
    lines.push(fmtBucket("아침(06-09)", fc.value.morning));
    lines.push(fmtBucket("점심(12-15)", fc.value.noon));
    lines.push(fmtBucket("저녁(18-21)", fc.value.evening));
  } else {
    lines.push(`날씨 조회 실패: ${fc.reason?.message ?? fc.reason}`);
  }
  if (air.status === "fulfilled") {
    const a = air.value;
    const pm10 = a.pm10 == null ? "--" : a.pm10;
    const pm25 = a.pm25 == null ? "--" : a.pm25;
    lines.push(`미세먼지 PM10 ${pm10} (${a.pm10Grade}) · PM2.5 ${pm25} (${a.pm25Grade})  [측정소: ${a.station}]`);
  } else {
    lines.push(`미세먼지 조회 실패: ${air.reason?.message ?? air.reason}`);
  }
  return lines.join("\n");
}

const server = new McpServer({ name: "weather", version: "1.0.0" });

server.registerTool(
  "get_weather",
  {
    title: "Get Weather + Air Quality",
    description:
      "여러 위치의 오늘 아침/점심/저녁 기온·하늘상태·강수확률(기상청 단기예보)과 미세먼지 PM10/PM2.5(에어코리아)를 반환한다.",
    inputSchema: {
      locations: z
        .array(
          z.object({
            name: z.string().min(1).describe("위치 이름"),
            lat: z.number().describe("위도(WGS84)"),
            lon: z.number().describe("경도(WGS84)"),
          })
        )
        .min(1)
        .describe("조회할 위치 목록"),
    },
  },
  async ({ locations }) => {
    if (!KMA_KEY) throw new Error("KMA_SERVICE_KEY 환경변수가 비어 있습니다(.env 확인).");
    const now = new Date();
    const blocks = await Promise.all(locations.map((l) => oneLocation(l.name, l.lat, l.lon, now)));
    return { content: [{ type: "text", text: blocks.join("\n\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
