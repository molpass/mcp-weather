import { test } from "node:test";
import assert from "node:assert/strict";
import { dfs_xy_conv, selectBaseDateTime, gradePm } from "../dist/kma.js";

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
