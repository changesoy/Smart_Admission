import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildUsageIndex,
  buildZoneEdgeChains,
  clearRing,
  clearStep,
  createDraftId,
  createEditorState,
  diffRingMetrics,
  draftFromState,
  edgeAvailability,
  expandRefsToCoordinates,
  findCandidatePaths,
  findReuseOptions,
  findSelfIntersections,
  flattenRingRefs,
  holeSupport,
  nextDraftSequence,
  nodeMapOf,
  redo,
  reverseEdge,
  ringDiagnostics,
  ringMetrics,
  selectEdge,
  serializeDraft,
  undo,
  unselectEdge,
} from "../lib/draft-core.mjs";
import { validateZoneDraft } from "../lib/zone-draft-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE = path.join(ROOT, "scripts/fixtures/network-generator/minimal");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

const nodes = readJson(path.join(FIXTURE, "expected_network_nodes.json")).nodes;
const edges = readJson(path.join(FIXTURE, "expected_network_edges.json")).edges;
const features = readJson(path.join(FIXTURE, "boundary_features.geojson"));
const featureMap = new Map(
  features.features.map((feature) => [feature.properties.featureId, feature]),
);

const mockZoneSpec = () => ({
  zoneId: "zone_900",
  zoneName: "测试学区",
  schoolId: "school_test",
  boundaryText: "东至测试东界，南至测试南界，西至测试西界，北至测试北界。",
  rings: [
    {
      ringId: "zr_900001",
      role: "outer",
      steps: [
        { stepId: "zs_9000001", side: "南", text: "南至测试南界", sourceType: "officialText", rulingIds: [], edgeRefs: [] },
        { stepId: "zs_9000002", side: "东", text: "东至测试东界", sourceType: "officialText", rulingIds: [], edgeRefs: [] },
        { stepId: "zs_9000003", side: "北", text: "北至测试北界", sourceType: "officialText", rulingIds: [], edgeRefs: [] },
        { stepId: "zs_9000004", side: "西", text: "西至测试西界", sourceType: "officialText", rulingIds: [], edgeRefs: [] },
      ],
    },
  ],
});

const selectionPlan = [
  { ringIndex: 0, stepId: "zs_9000001", edgeId: "be_0000001" },
  { ringIndex: 0, stepId: "zs_9000001", edgeId: "be_0000002" },
  { ringIndex: 0, stepId: "zs_9000002", edgeId: "be_0000003" },
  { ringIndex: 0, stepId: "zs_9000003", edgeId: "be_0000004" },
  { ringIndex: 0, stepId: "zs_9000004", edgeId: "be_0000005" },
];

const selectAll = (state) => {
  selectionPlan.forEach((selection) => {
    const result = selectEdge(state, { edges, nodes }, {
      ...selection,
      decidedBy: "用户",
      decidedAt: "2026-11-17",
    });
    assert.equal(result.ok, true, result.error);
  });
};

test("不可用边被显式拒绝：退役、不可作边界、非连通节点", () => {
  const nodeMap = nodeMapOf(nodes);
  assert.equal(
    edgeAvailability(edges.find((edge) => edge.edgeId === "be_0000008"), nodeMap).selectable,
    false,
  );
  assert.equal(
    edgeAvailability({ ...edges[0], lifecycle: "retired" }, nodeMap).selectable,
    false,
  );
  assert.equal(
    edgeAvailability(
      { ...edges[0], fromNodeId: "bn_000006" },
      nodeMap,
    ).selectable,
    false,
  );
});

test("候选路径：唯一解、多解、无解都原样返回", () => {
  const unique = findCandidatePaths({
    fromNodeId: "bn_000007",
    toNodeId: "bn_000008",
    edges,
    nodes,
  });
  assert.equal(unique.paths.length, 1);
  assert.equal(unique.reason, null);
  assert.deepEqual(
    unique.paths[0].edgeRefs.map((ref) => ref.edgeId),
    ["be_0000006", "be_0000007"],
  );

  const multiple = findCandidatePaths({
    fromNodeId: "bn_000001",
    toNodeId: "bn_000003",
    edges,
    nodes,
  });
  assert.ok(multiple.paths.length >= 2, "矩形两角之间应有多条候选路径");

  const none = findCandidatePaths({
    fromNodeId: "bn_000009",
    toNodeId: "bn_000001",
    edges,
    nodes,
  });
  assert.equal(none.paths.length, 0);
  assert.ok(none.reason);
});

test("nonConnectingCrossing 节点不参与路径", () => {
  // bn_000009 与 bn_000010 之间唯一的边属于不可作边界的要素
  const ineligible = findCandidatePaths({
    fromNodeId: "bn_000009",
    toNodeId: "bn_000010",
    edges,
    nodes,
  });
  assert.equal(ineligible.paths.length, 0);

  const forbidden = findCandidatePaths({
    fromNodeId: "bn_000006",
    toNodeId: "bn_000007",
    edges,
    nodes,
  });
  assert.equal(forbidden.paths.length, 0);
});

test("共用边索引与连续共边复用链", () => {
  const zoneSpecs = {
    schemaVersion: 2,
    zones: [
      {
        zoneId: "zone_006",
        zoneName: "测试共用学区",
        rings: [
          {
            ringId: "zr_000002",
            role: "outer",
            steps: [
              {
                stepId: "zs_0000009",
                edgeRefs: [
                  { edgeId: "be_0000003", direction: "forward" },
                  { edgeId: "be_0000004", direction: "forward" },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const usage = buildUsageIndex(zoneSpecs);
  assert.equal(usage.get("be_0000003")[0].zoneId, "zone_006");
  assert.equal(usage.get("be_0000003")[0].direction, "forward");

  const chains = buildZoneEdgeChains(zoneSpecs, edges);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].contiguous, true);
  assert.deepEqual(chains[0].nodeIds, ["bn_000003", "bn_000004", "bn_000005"]);

  const reuse = findReuseOptions({
    zoneSpecs,
    edges,
    excludeZoneId: "zone_031",
    atNodeId: "bn_000004",
  });
  assert.equal(reuse.length, 1);
});

test("点选闭合环、导出确定性草稿并通过 D01–D17 校验", () => {
  const zoneSpec = mockZoneSpec();
  const state = createEditorState({
    zoneSpec,
    draftId: "draft_zone_900_20261117_01",
    date: "2026-11-17",
  });
  selectAll(state);

  const diagnostics = ringDiagnostics(state.rings[0], edges);
  assert.equal(diagnostics.closed, true);
  assert.equal(diagnostics.unboundSteps, 0);
  assert.deepEqual(diagnostics.breaks, []);

  const draft = draftFromState(state, { status: "readyForReview" });
  const validation = validateZoneDraft(draft, { zoneSpec, nodes, edges });
  assert.deepEqual(validation.errors, []);

  const text = serializeDraft(draft);
  assert.equal(text.includes("coordinates"), false);
  assert.equal(text.includes("117.1"), false);

  const second = createEditorState({
    zoneSpec,
    draftId: "draft_zone_900_20261117_01",
    date: "2026-11-17",
  });
  selectionPlan.forEach((selection) => {
    selectEdge(second, { edges, nodes }, {
      ...selection,
      decidedBy: "用户",
      decidedAt: "2026-11-17",
    });
  });
  assert.equal(
    serializeDraft(draftFromState(second, { status: "readyForReview" })),
    text,
  );
});

test("断链、重复边和不可用边都阻断选择", () => {
  const state = createEditorState({
    zoneSpec: mockZoneSpec(),
    draftId: "draft_zone_900_20261117_01",
    date: "2026-11-17",
  });
  const first = selectEdge(state, { edges, nodes }, {
    ringIndex: 0,
    stepId: "zs_9000001",
    edgeId: "be_0000001",
    decidedBy: "用户",
  });
  assert.equal(first.ok, true);

  const broken = selectEdge(state, { edges, nodes }, {
    ringIndex: 0,
    stepId: "zs_9000001",
    edgeId: "be_0000003",
    decidedBy: "用户",
  });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /断链/);

  const duplicate = selectEdge(state, { edges, nodes }, {
    ringIndex: 0,
    stepId: "zs_9000001",
    edgeId: "be_0000001",
    decidedBy: "用户",
  });
  assert.equal(duplicate.ok, false);

  const unavailable = selectEdge(state, { edges, nodes }, {
    ringIndex: 0,
    stepId: "zs_9000001",
    edgeId: "be_0000008",
    decidedBy: "用户",
  });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /不可作为学区边界/);
});

test("取消、反向、清空、撤销与重做保持一致性", () => {
  const state = createEditorState({
    zoneSpec: mockZoneSpec(),
    draftId: "draft_zone_900_20261117_01",
    date: "2026-11-17",
  });
  selectAll(state);
  const beforeRefs = JSON.stringify(state.rings[0].steps);

  const undoResult = undo(state, { decidedBy: "用户", decidedAt: "2026-11-17" });
  assert.equal(undoResult.ok, true);
  assert.equal(state.rings[0].steps[3].edgeRefs.length, 0);
  assert.equal(state.operations[state.operations.length - 1].type, "unselectEdge");

  const redoResult = redo(state, { decidedBy: "用户", decidedAt: "2026-11-17" });
  assert.equal(redoResult.ok, true);
  assert.equal(JSON.stringify(state.rings[0].steps), beforeRefs);

  const reversed = reverseEdge(state, {
    ringIndex: 0,
    stepId: "zs_9000004",
    edgeId: "be_0000005",
    decidedBy: "用户",
  });
  assert.equal(reversed.ok, true);
  assert.equal(state.rings[0].steps[3].edgeRefs[0].direction, "reverse");
  assert.equal(ringDiagnostics(state.rings[0], edges).closed, false);

  assert.equal(
    reverseEdge(state, {
      ringIndex: 0,
      stepId: "zs_9000004",
      edgeId: "be_0000005",
      decidedBy: "用户",
    }).ok,
    true,
  );
  assert.equal(ringDiagnostics(state.rings[0], edges).closed, true);

  assert.equal(
    unselectEdge(state, {
      ringIndex: 0,
      stepId: "zs_9000001",
      edgeId: "be_0000002",
      decidedBy: "用户",
    }).ok,
    true,
  );
  assert.equal(state.rings[0].steps[0].edgeRefs.length, 1);

  assert.equal(clearStep(state, { ringIndex: 0, stepId: "zs_9000002", decidedBy: "用户" }).ok, true);
  assert.equal(state.rings[0].steps[1].edgeRefs.length, 0);

  assert.equal(clearRing(state, { ringIndex: 0, decidedBy: "用户" }).ok, true);
  assert.equal(flattenRingRefs(state.rings[0]).length, 0);
});

test("从已有草稿恢复编辑器状态", () => {
  const zoneSpec = mockZoneSpec();
  const state = createEditorState({
    zoneSpec,
    draftId: "draft_zone_900_20261117_01",
    date: "2026-11-17",
  });
  selectAll(state);
  const draft = draftFromState(state, { status: "editing" });
  const restored = createEditorState({ zoneSpec, draft });
  assert.deepEqual(restored.rings, draft.rings);
  assert.deepEqual(restored.operations, draft.operations);
});

test("草稿 ID 序号递增", () => {
  assert.equal(
    createDraftId({ zoneId: "zone_006", date: "2026-11-17", sequence: 3 }),
    "draft_zone_006_20261117_03",
  );
  assert.equal(
    nextDraftSequence(["draft_zone_006_20261117_01", "draft_zone_006_20261117_03"], {
      zoneId: "zone_006",
      date: "2026-11-17",
    }),
    4,
  );
});

test("洞环支持依据正式步骤判定，并带 appliesToRingId", () => {
  const base = mockZoneSpec();
  assert.equal(holeSupport(base).supported, false);

  const withHole = {
    ...base,
    rings: [
      base.rings[0],
      {
        ringId: "zr_900002",
        role: "hole",
        appliesToRingId: "zr_900001",
        steps: [
          { stepId: "zs_9000010", side: "排除", text: "不含某区域", sourceType: "boundaryRuling", rulingIds: [], edgeRefs: [] },
          { stepId: "zs_9000011", side: "说明", text: "某区域南界", sourceType: "boundaryRuling", rulingIds: [], edgeRefs: [] },
          { stepId: "zs_9000012", side: "说明", text: "某区域西界", sourceType: "boundaryRuling", rulingIds: [], edgeRefs: [] },
        ],
      },
    ],
  };
  assert.equal(holeSupport(withHole).supported, true);
  const state = createEditorState({
    zoneSpec: withHole,
    draftId: "draft_zone_900_20261117_01",
    date: "2026-11-17",
  });
  assert.equal(state.rings[1].role, "hole");
  assert.equal(state.rings[1].appliesToRingId, "zr_900001");
});

test("派生环坐标、面积、方向和差异报告", () => {
  const refs = [
    { edgeId: "be_0000001", direction: "forward" },
    { edgeId: "be_0000002", direction: "forward" },
    { edgeId: "be_0000003", direction: "forward" },
    { edgeId: "be_0000004", direction: "forward" },
    { edgeId: "be_0000005", direction: "forward" },
  ];
  const coordinates = expandRefsToCoordinates(refs, edges, featureMap);
  assert.equal(coordinates.length, 7);
  assert.deepEqual(coordinates[0], coordinates[coordinates.length - 1]);

  const metrics = ringMetrics(coordinates);
  assert.equal(metrics.orientation, "ccw");
  assert.ok(metrics.areaM2 > 0);
  assert.equal(metrics.vertexCount, 7);

  const diff = diffRingMetrics(metrics, metrics);
  assert.equal(diff.areaM2Delta, 0);
  assert.equal(diff.centroidDistanceM, 0);
  assert.equal(diff.vertexCountDelta, 0);
});

test("派生环自交检测", () => {
  const bowtie = [
    [117.1, 36.1],
    [117.2, 36.2],
    [117.2, 36.1],
    [117.1, 36.2],
    [117.1, 36.1],
  ];
  assert.ok(findSelfIntersections(bowtie).length > 0);
  const square = [
    [117.1, 36.1],
    [117.2, 36.1],
    [117.2, 36.2],
    [117.1, 36.2],
    [117.1, 36.1],
  ];
  assert.deepEqual(findSelfIntersections(square), []);
});
