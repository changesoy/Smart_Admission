/**
 * repair-core.test.mjs - 修复记录预检与 L1/L2 执行
 *
 * 覆盖：分侧锚点替换（首批试点的真实形态）、同锚点经典替换、L2 交点裁剪，
 * 以及 A5 的各类负例。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { executeBatch, precheckBatch } from "../lib/repair-core.mjs";
import { checkZones } from "../lib/zone-check-core.mjs";

const BASE_LNG = 117.13;
const BASE_LAT = 36.17;
const LNG_PER_M = 111320 * Math.cos((BASE_LAT * Math.PI) / 180);
const LAT_PER_M = 110574;

const lngOf = (meters) => Number((BASE_LNG + meters / LNG_PER_M).toFixed(9));
const latOf = (meters) => Number((BASE_LAT + meters / LAT_PER_M).toFixed(9));

const point = (x, y) => [lngOf(x), latOf(y)];

const polygon = (zoneId, coords) => ({
  type: "Feature",
  properties: { zoneId, zoneName: zoneId, stage: "初中", year: 2025 },
  geometry: {
    type: "Polygon",
    coordinates: [[...coords, coords[0]]],
  },
});

const featureCollection = (features) => ({
  type: "FeatureCollection",
  features,
});

/** 参照学区：0..110 × 0..100 的矩形 */
const referenceZone = () =>
  polygon("zone_a", [
    point(0, 0),
    point(110, 0),
    point(110, 100),
    point(0, 100),
  ]);

/** 经典 L1 的参照学区：0..100 × 0..100 的矩形 */
const sharedReferenceZone = () =>
  polygon("zone_a", [
    point(0, 0),
    point(100, 0),
    point(100, 100),
    point(0, 100),
  ]);

/** 被修改学区：西界带一个 35 m × 100 m 的楔形，伸入参照学区 */
const wedgeZone = () =>
  polygon("zone_b", [
    point(200, 0),
    point(115, 0),
    point(80, 60),
    point(115, 100),
    point(200, 100),
  ]);

/** 两侧共享锚点、中间顶点偏离 0.5 m 的经典 L1 场景 */
const sharedZone = () =>
  polygon("zone_b", [
    point(200, 0),
    point(100, 0),
    point(100.5, 40),
    point(100, 100),
    point(200, 100),
  ]);

const issuesOf = (features) => checkZones(featureCollection(features));

const ZONES_SHA = `sha256:${"0".repeat(64)}`;
const FEATURES_SHA = `sha256:${"2".repeat(64)}`;

/** 测试骨架线：x = 110 的南北向道路，中间带一个顶点 */
const roadFeatures = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        featureId: "bf_test_road",
        name: "测试路",
        lineType: "道路",
        geometryStatus: "ready",
      },
      geometry: {
        type: "LineString",
        coordinates: [point(110, -20), point(110, 50), point(110, 120)],
      },
    },
  ],
});

const baseRecord = (issueId, overrides = {}) => ({
  recordId: "r-001",
  issueId,
  zoneId: "zone_b",
  action: "snap-shared-boundary",
  referenceZoneId: "zone_a",
  anchors: { from: point(115, 0), to: point(115, 100) },
  referenceAnchors: { from: point(110, 0), to: point(110, 100) },
  guards: { maxDeviationM: 31 },
  expected: { areaDeltaM2: [-1300, -1200], pointCount: 4 },
  ruling: { basis: "same-feature", note: "两侧同指一条界线" },
  evidence: { sourceName: "测试四至表", excerpt: "沿测试路向北" },
  confirmedBy: "测试",
  confirmedAt: "2026-10-22",
  ...overrides,
});

const baseBatch = (issueId, overrides = {}) => ({
  schemaVersion: 1,
  batchId: "test-batch",
  createdAt: "2026-10-22",
  baseRelease: "2026.09.5",
  baseZonesSha256: ZONES_SHA,
  records: [baseRecord(issueId, overrides)],
});

const contextOf = (features, overrides = {}) => ({
  fileName: "test-batch.json",
  currentRelease: "2026.09.5",
  zonesSha256: ZONES_SHA,
  zones: featureCollection(features),
  checkReport: issuesOf(features),
  referenceFeatures: null,
  featuresSha256: null,
  addressPoints: [],
  ...overrides,
});

test("分侧锚点：用参照环顶点替换楔形，属性不变且面积/顶点数符合预期", () => {
  const features = [referenceZone(), wedgeZone()];
  const report = issuesOf(features);
  const issue = report.issues.find(
    (item) =>
      item.type === "overlap-containment" &&
      item.zoneIds.join("|") === "zone_a|zone_b",
  );
  assert.ok(issue, "夹具应产生完全包含问题");

  const batch = baseBatch(issue.issueId);
  const context = contextOf(features);
  const precheck = precheckBatch(batch, context);
  assert.deepEqual(precheck.errors, []);
  assert.equal(precheck.plans.length, 1);
  assert.ok(Math.abs(precheck.plans[0].maxDeviationM - 30) < 0.1);

  const execution = executeBatch(batch, precheck.plans, context);
  assert.deepEqual(execution.errors, []);

  const before = features.find((f) => f.properties.zoneId === "zone_b");
  const after = execution.candidate.features.find(
    (f) => f.properties.zoneId === "zone_b",
  );
  assert.deepEqual(after.properties, before.properties);
  assert.equal(after.geometry.coordinates[0].length - 1, 4);
  assert.deepEqual(after.geometry.coordinates[0], [
    point(200, 0),
    point(110, 0),
    point(110, 100),
    point(200, 100),
    point(200, 0),
  ]);
  assert.equal(execution.diffs[0].pointCountAfter, 4);
  assert.ok(
    execution.diffs[0].areaDeltaM2 > -1260 &&
      execution.diffs[0].areaDeltaM2 < -1240,
  );
  assert.deepEqual(execution.addressChanges, []);
});

test("共享锚点：经典 L1 替换仍可用", () => {
  const features = [sharedReferenceZone(), sharedZone()];
  const report = issuesOf(features);
  const issue = report.issues.find((item) =>
    item.issueId.startsWith("shared-edge-gap:zone_a|zone_b"),
  );
  assert.ok(issue, "夹具应产生共边缝隙问题");

  const batch = baseBatch(issue.issueId, {
    anchors: { from: point(100, 0), to: point(100, 100) },
    referenceAnchors: undefined,
    guards: { maxDeviationM: 1 },
    expected: { areaDeltaM2: [20, 30], pointCount: 4 },
  });
  const context = contextOf(features);
  const precheck = precheckBatch(batch, context);
  assert.deepEqual(precheck.errors, []);

  const execution = executeBatch(batch, precheck.plans, context);
  assert.deepEqual(execution.errors, []);
  assert.equal(execution.diffs[0].pointCountAfter, 4);
  assert.ok(execution.diffs[0].areaDeltaM2 > 0);
});

test("空批次、非法 action、缺学区、锚点缺失/重复、基线不符、记录过期均失败", () => {
  const features = [referenceZone(), wedgeZone()];
  const report = issuesOf(features);
  const { issueId } = report.issues.find((item) =>
    item.issueId.startsWith("overlap-containment"),
  );
  const context = contextOf(features);

  const empty = precheckBatch({ ...baseBatch(issueId), records: [] }, context);
  assert.ok(empty.errors.some((item) => item.message.includes("records")));

  const badAction = precheckBatch(
    baseBatch(issueId, { action: "clip" }),
    context,
  );
  assert.ok(badAction.errors.some((item) => item.message.includes("action")));

  const missingZone = precheckBatch(
    baseBatch(issueId, { zoneId: "zone_missing" }),
    context,
  );
  assert.ok(
    missingZone.errors.some((item) => item.message.includes("zoneId 不存在")),
  );

  const missingAnchor = precheckBatch(
    baseBatch(issueId, {
      anchors: { from: point(999, 999), to: point(115, 100) },
    }),
    context,
  );
  assert.ok(
    missingAnchor.errors.some((item) => item.message.includes("不在环上")),
  );

  const duplicateZone = polygon("zone_b", [
    point(200, 0),
    point(115, 0),
    point(80, 60),
    point(115, 0),
    point(115, 100),
    point(200, 100),
  ]);
  const duplicateContext = contextOf([referenceZone(), duplicateZone]);
  const duplicate = precheckBatch(baseBatch(issueId), duplicateContext);
  assert.ok(
    duplicate.errors.some((item) => item.message.includes("出现 2 次")),
  );

  const staleBatch = { ...baseBatch(issueId), baseRelease: "v2025.1" };
  const stale = precheckBatch(staleBatch, context);
  assert.ok(stale.errors.some((item) => item.message.includes("baseRelease")));

  const expired = precheckBatch(
    baseBatch("overlap-containment:zone_a|zone_b:deadbeef"),
    context,
  );
  assert.ok(expired.errors.some((item) => item.message.includes("已过期")));

  const badReferenceAnchor = precheckBatch(
    baseBatch(issueId, {
      referenceAnchors: { from: point(999, 999), to: point(110, 100) },
    }),
    context,
  );
  assert.ok(
    badReferenceAnchor.errors.some((item) =>
      item.message.includes("referenceAnchors.from 不在环上"),
    ),
  );

  const tooStrict = precheckBatch(
    baseBatch(issueId, { guards: { maxDeviationM: 1 } }),
    context,
  );
  assert.ok(
    tooStrict.errors.some((item) => item.message.includes("超过 guards")),
  );
});

test("同一学区的两条记录锚点区间重叠时失败", () => {
  const features = [referenceZone(), wedgeZone()];
  const report = issuesOf(features);
  const { issueId } = report.issues.find((item) =>
    item.issueId.startsWith("overlap-containment"),
  );
  const context = contextOf(features);

  const batch = {
    ...baseBatch(issueId),
    records: [
      baseRecord(issueId),
      baseRecord(issueId, {
        recordId: "r-002",
        anchors: { from: point(115, 0), to: point(80, 60) },
        referenceAnchors: { from: point(110, 0), to: point(110, 100) },
        expected: { areaDeltaM2: [-1300, -1200], pointCount: 4 },
      }),
    ],
  };

  const precheck = precheckBatch(batch, context);
  assert.ok(precheck.errors.some((item) => item.message.includes("区间重叠")));
});

test("baseZonesSha256 缺失、格式错误或与当前快照不符时失败", () => {
  const features = [referenceZone(), wedgeZone()];
  const report = issuesOf(features);
  const { issueId } = report.issues.find((item) =>
    item.issueId.startsWith("overlap-containment"),
  );
  const context = contextOf(features);

  const missing = precheckBatch(
    { ...baseBatch(issueId), baseZonesSha256: undefined },
    context,
  );
  assert.ok(
    missing.errors.some((item) =>
      item.message.includes("baseZonesSha256 必填"),
    ),
  );

  const malformed = precheckBatch(
    { ...baseBatch(issueId), baseZonesSha256: "sha256:xyz" },
    context,
  );
  assert.ok(malformed.errors.some((item) => item.message.includes("64 位")));

  const stale = precheckBatch(
    { ...baseBatch(issueId), baseZonesSha256: `sha256:${"1".repeat(64)}` },
    context,
  );
  assert.ok(stale.errors.some((item) => item.message.includes("不一致")));

  const noHash = precheckBatch(
    baseBatch(issueId),
    contextOf(features, { zonesSha256: null }),
  );
  assert.ok(
    noHash.errors.some((item) =>
      item.message.includes("未提供 zones.geojson 哈希"),
    ),
  );
});

test("L2 记录缺少骨架线时预检失败", () => {
  const features = [referenceZone(), wedgeZone()];
  const report = issuesOf(features);
  const { issueId } = report.issues.find((item) =>
    item.issueId.startsWith("overlap-containment"),
  );
  const context = contextOf(features);

  const batch = baseBatch(issueId, {
    action: "replace-with-feature",
    referenceZoneId: undefined,
    referenceAnchors: undefined,
    featureId: "bf_missing",
  });
  batch.featuresSha256 = "sha256:deadbeef";

  const precheck = precheckBatch(batch, context);
  assert.ok(
    precheck.errors.some((item) => item.message.includes("骨架线文件不存在")),
  );
});

const l2Batch = (issueId, overrides = {}) => {
  const batch = baseBatch(issueId, {
    action: "replace-with-feature",
    anchors: undefined,
    referenceZoneId: undefined,
    referenceAnchors: undefined,
    featureId: "bf_test_road",
    cuts: { from: point(110, -10), to: point(110, 110) },
    guards: { maxCutOffsetM: 0.5 },
    expected: { areaDeltaM2: [-610, -590], pointCount: 5 },
    ...overrides,
  });
  batch.featuresSha256 = FEATURES_SHA;
  return batch;
};

const l2Context = (features, overrides = {}) =>
  contextOf(features, {
    referenceFeatures: roadFeatures(),
    featuresSha256: FEATURES_SHA,
    ...overrides,
  });

/** 西界在 x=105，横穿 x=110 的测试路；两交点即道路与上下边界的交点 */
const cutZone = () =>
  polygon("zone_b", [
    point(200, -10),
    point(105, -10),
    point(105, 110),
    point(200, 110),
  ]);

const ISSUE_OF_CUT_ZONE = () =>
  issuesOf([referenceZone(), cutZone()]).issues.find((item) =>
    item.issueId.startsWith("overlap-crossing:zone_a|zone_b"),
  );

test("L2 交点裁剪：两交点之间的边界整段换成骨架线折线", () => {
  const features = [referenceZone(), cutZone()];
  const issue = ISSUE_OF_CUT_ZONE();
  assert.ok(issue, "夹具应产生两环交叉问题");

  const batch = l2Batch(issue.issueId);
  const context = l2Context(features);
  const precheck = precheckBatch(batch, context);
  assert.deepEqual(precheck.errors, []);
  assert.equal(precheck.plans[0].ringForward, true);
  assert.ok(precheck.plans[0].maxCutOffsetM < 0.01);

  const execution = executeBatch(batch, precheck.plans, context);
  assert.deepEqual(execution.errors, []);
  assert.deepEqual(execution.diffs[0].featureId, "bf_test_road");
  assert.equal(execution.diffs[0].ringStartChanged, true);

  const after = execution.candidate.features.find(
    (feature) => feature.properties.zoneId === "zone_b",
  );
  assert.deepEqual(after.geometry.coordinates[0], [
    point(110, -10),
    point(110, 50),
    point(110, 110),
    point(200, 110),
    point(200, -10),
    point(110, -10),
  ]);
});

test("L2 交点裁剪：环反向时自动选择另一段弧，结果与正向一致", () => {
  const reversedZone = () =>
    polygon("zone_b", [
      point(200, -10),
      point(200, 110),
      point(105, 110),
      point(105, -10),
    ]);
  const features = [referenceZone(), reversedZone()];
  const issue = ISSUE_OF_CUT_ZONE();
  assert.ok(issue, "夹具应产生两环交叉问题");

  const batch = l2Batch(issue.issueId);
  const context = l2Context(features);
  const precheck = precheckBatch(batch, context);
  assert.deepEqual(precheck.errors, []);
  assert.equal(precheck.plans[0].ringForward, false);

  const execution = executeBatch(batch, precheck.plans, context);
  assert.deepEqual(execution.errors, []);

  const after = execution.candidate.features.find(
    (feature) => feature.properties.zoneId === "zone_b",
  );
  // 环向不变，起点仍是交点，只是从另一侧进入骨架线
  assert.deepEqual(after.geometry.coordinates[0], [
    point(110, 110),
    point(110, 50),
    point(110, -10),
    point(200, -10),
    point(200, 110),
    point(110, 110),
  ]);
});

test("L2 交点裁剪：缺 cuts、交点偏离环/骨架线、缺 maxCutOffsetM 时失败", () => {
  const features = [referenceZone(), cutZone()];
  const issue = ISSUE_OF_CUT_ZONE();
  assert.ok(issue);

  const context = l2Context(features);

  const noCuts = precheckBatch(
    l2Batch(issue.issueId, { cuts: undefined }),
    context,
  );
  assert.ok(noCuts.errors.some((item) => item.message.includes("cuts 必须")));

  const offRing = precheckBatch(
    l2Batch(issue.issueId, {
      cuts: { from: point(90, 0), to: point(110, 100) },
    }),
    context,
  );
  assert.ok(offRing.errors.some((item) => item.message.includes("距环")));

  const offFeature = precheckBatch(
    l2Batch(issue.issueId, {
      cuts: { from: point(105, 0), to: point(110, 110) },
    }),
    context,
  );
  assert.ok(
    offFeature.errors.some((item) => item.message.includes("距骨架线")),
  );

  const noGuard = precheckBatch(
    l2Batch(issue.issueId, { guards: {} }),
    context,
  );
  assert.ok(
    noGuard.errors.some((item) => item.message.includes("maxCutOffsetM")),
  );
});
