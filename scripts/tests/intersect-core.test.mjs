import test from "node:test";
import assert from "node:assert/strict";
import {
  closestPointOnSegment,
  clusterByRadius,
  cumulativeDistances,
  insertPointsIntoLine,
  makeProjector,
  segmentRelation,
} from "../lib/intersect-core.mjs";

const proj = makeProjector(36.2);

test("segmentRelation: 十字相交取中点", () => {
  const rel = segmentRelation([0, 0], [10, 10], [0, 10], [10, 0]);
  assert.equal(rel.kind, "cross");
  assert.ok(Math.abs(rel.point[0] - 5) < 1e-9);
  assert.ok(Math.abs(rel.point[1] - 5) < 1e-9);
  assert.equal(rel.tA, 0.5);
  assert.equal(rel.tB, 0.5);
});

test("segmentRelation: 端点落在另一段上也算相交", () => {
  const rel = segmentRelation([0, 0], [10, 0], [5, 0], [5, 6]);
  assert.equal(rel.kind, "cross");
  assert.equal(rel.tA, 0.5);
  assert.equal(rel.tB, 0);
});

test("segmentRelation: 延长线相交但不在段内返回 null", () => {
  assert.equal(segmentRelation([0, 0], [1, 1], [0, 10], [10, 0]), null);
});

test("segmentRelation: 平行不共线返回 null", () => {
  assert.equal(segmentRelation([0, 0], [10, 0], [0, 2], [10, 2]), null);
});

test("segmentRelation: 共线重叠给出重叠区间", () => {
  const rel = segmentRelation([0, 0], [10, 0], [4, 0], [14, 0]);
  assert.equal(rel.kind, "collinear");
  assert.ok(Math.abs(rel.tA0 - 0.4) < 1e-9);
  assert.ok(Math.abs(rel.tA1 - 1) < 1e-9);
});

test("closestPointOnSegment: 投影落在线段内", () => {
  const r = closestPointOnSegment([5, 3], [0, 0], [10, 0]);
  assert.equal(r.dist, 3);
  assert.equal(r.t, 0.5);
  assert.deepEqual(r.foot, [5, 0]);
});

test("closestPointOnSegment: 投影落在端点外时夹紧", () => {
  const r = closestPointOnSegment([-4, 0], [0, 0], [10, 0]);
  assert.equal(r.dist, 4);
  assert.equal(r.t, 0);
});

test("insertPointsIntoLine: 中间插点、端点复用", () => {
  const line = [
    [0, 0],
    [1, 0],
  ];
  const { line: out, reused } = insertPointsIntoLine(line, [
    { segIndex: 0, t: 0.5, coord: [0.5, 0] },
    { segIndex: 0, t: 0, coord: [0, 0] },
    { segIndex: 0, t: 1, coord: [1, 0] },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[1], [0.5, 0]);
  // t=0 与 t=1 都复用既有顶点，不新增
  assert.equal(reused.filter(Boolean).length, 2);
});

test("insertPointsIntoLine: 重复插同一点即幂等", () => {
  const once = insertPointsIntoLine(
    [
      [0, 0],
      [1, 0],
    ],
    [{ segIndex: 0, t: 0.5, coord: [0.5, 0] }],
  ).line;
  const twice = insertPointsIntoLine(once, [
    { segIndex: 1, t: 0, coord: [0.5, 0] },
  ]).line;
  // 第二次运行会在新几何上重新定位到"下一段的 t=0"，复用该顶点，不再新增
  assert.equal(twice.length, once.length);
});

test("cumulativeDistances: 首项为 0 且累计单调", () => {
  const cum = cumulativeDistances([
    [117, 36],
    [117.001, 36],
    [117.001, 36.001],
  ]);
  assert.equal(cum[0], 0);
  assert.ok(cum[1] > 80 && cum[1] < 95);
  assert.ok(cum[2] > cum[1]);
});

test("clusterByRadius: 1 m 内的点并为一组", () => {
  const items = [
    { coord: [117.0, 36.0] },
    { coord: [117.000005, 36.0] },
    { coord: [117.01, 36.0] },
  ];
  const groups = clusterByRadius(items, 1, proj);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], [0, 1]);
});
