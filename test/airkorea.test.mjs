import { test } from "node:test";
import assert from "node:assert/strict";
import { toTM } from "../dist/airkorea.js";

test("toTM 안양(37.394,126.957) → TM 좌표 합리적 범위(EPSG:5181)", () => {
  const { tmX, tmY } = toTM(37.394, 126.957);
  // 수도권 EPSG:5181 TM은 대략 x 180000~210000, y 430000~470000 범위
  assert.ok(tmX > 150000 && tmX < 230000, `tmX=${tmX}`);
  assert.ok(tmY > 400000 && tmY < 500000, `tmY=${tmY}`);
});
