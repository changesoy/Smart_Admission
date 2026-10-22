/**
 * zone-geometry.test.mjs - 几何基元的回归用例
 *
 * 重点：proper 相交的交点必须落在两条线段上（曾因参数取自错误线段而坐标偏移）。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  pointToSegmentDistanceM,
  segmentIntersection,
} from "../../js/geo/zone-geometry.js";

test("proper 相交的交点落在两条线段上", () => {
  const a = [117.13, 36.17];
  const b = [117.14, 36.18];
  const c = [117.13, 36.18];
  const d = [117.14, 36.17];

  const result = segmentIntersection(a, b, c, d);
  assert.equal(result.type, "proper");
  assert.ok(Math.abs(result.point[0] - 117.135) < 1e-12);
  assert.ok(Math.abs(result.point[1] - 36.175) < 1e-12);
  assert.ok(pointToSegmentDistanceM(result.point, a, b) < 1e-6);
  assert.ok(pointToSegmentDistanceM(result.point, c, d) < 1e-6);
});

test("两条线段长度不等时交点依然落在两条线段上", () => {
  const a = [0, 0];
  const b = [0.01, 0.01];
  const c = [0, 0.01];
  const d = [0.02, 0];

  const result = segmentIntersection(a, b, c, d);
  assert.equal(result.type, "proper");
  assert.ok(pointToSegmentDistanceM(result.point, a, b) < 0.01);
  assert.ok(pointToSegmentDistanceM(result.point, c, d) < 0.01);
  assert.ok(Math.abs(result.point[0] - 0.02 / 3) < 1e-12);
});
