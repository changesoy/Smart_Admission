/**
 * zone-draft-schema.test.mjs - 草稿校验核心（B5 后半）
 *
 * 覆盖冻结清单 D01–D17 的关键分支：结构、步骤集合与顺序、边引用、
 * 连续性、闭合、洞环、禁止字段与操作审计。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateZoneDraft } from "../lib/zone-draft-schema.mjs";

const step = (stepId, side, text) => ({
  stepId,
  side,
  text,
  sourceType: "officialText",
  rulingIds: [],
  edgeRefs: [],
});

const zoneSpec = {
  zoneId: "zone_006",
  boundaryText: "东至甲路，南至乙路。",
  rings: [
    {
      ringId: "zr_000001",
      role: "outer",
      steps: [step("zs_0000001", "东", "东至甲路"), step("zs_0000002", "南", "南至乙路")],
    },
  ],
};

const holeZoneSpec = {
  zoneId: "zone_006",
  boundaryText: "东至甲路，南至乙路（不含丙区）。",
  rings: [
    {
      ringId: "zr_000001",
      role: "outer",
      steps: [step("zs_0000001", "东", "东至甲路"), step("zs_0000002", "南", "南至乙路")],
    },
    {
      ringId: "zr_000002",
      role: "hole",
      steps: [
        step("zs_0000003", "内嵌", "丙区西"),
        step("zs_0000004", "内嵌", "丙区北"),
        step("zs_0000005", "内嵌", "丙区东"),
      ],
    },
  ],
};

const node = (nodeId, connectionType = "connected") => ({
  nodeId,
  connectionType,
  lifecycle: "active",
});

const nodes = [
  node("bn_000001"),
  node("bn_000002"),
  node("bn_000003"),
  node("bn_000004"),
  node("bn_000005"),
  node("bn_000006"),
];

const edge = (edgeId, from, to, overrides = {}) => ({
  edgeId,
  fromNodeId: from,
  toNodeId: to,
  boundaryEligible: true,
  lifecycle: "active",
  ...overrides,
});

const edges = [
  edge("be_0000001", "bn_000001", "bn_000002"),
  edge("be_0000002", "bn_000002", "bn_000003"),
  edge("be_0000003", "bn_000003", "bn_000001"),
  edge("be_0000004", "bn_000004", "bn_000005"),
  edge("be_0000005", "bn_000005", "bn_000006"),
  edge("be_0000006", "bn_000006", "bn_000004"),
];

const ring = (steps, overrides = {}) => ({
  role: "outer",
  appliesToRingId: null,
  steps,
  ...overrides,
});

const draftOf = (overrides = {}) => ({
  draftId: "draft_zone_006_20261117_01",
  schemaVersion: 1,
  zoneId: "zone_006",
  boundaryText: zoneSpec.boundaryText,
  status: "readyForReview",
  createdBy: "测试",
  createdAt: "2026-11-17",
  updatedAt: "2026-11-17",
  rings: [
    ring([
      { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
      {
        stepId: "zs_0000002",
        edgeRefs: [
          { edgeId: "be_0000002", direction: "forward" },
          { edgeId: "be_0000003", direction: "forward" },
        ],
      },
    ]),
  ],
  operations: [],
  rejectReason: null,
  ...overrides,
});

const run = (draft, context = {}) =>
  validateZoneDraft(draft, { zoneSpec, nodes, edges, ...context });

const messages = (report) => report.errors.map((item) => item.message);

test("闭合且完整的草稿通过", () => {
  const report = run(draftOf());
  assert.deepEqual(report.errors, []);
});

test("editing 允许步骤未绑定边", () => {
  const draft = draftOf({
    status: "editing",
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [] },
        { stepId: "zs_0000002", edgeRefs: [] },
      ]),
    ],
  });
  assert.deepEqual(run(draft).errors, []);
});

test("readyForReview 不允许空步骤", () => {
  const draft = draftOf({
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
        { stepId: "zs_0000002", edgeRefs: [] },
      ]),
    ],
  });
  assert.ok(messages(run(draft)).some((text) => text.includes("未绑定边")));
});

test("缺少正式步骤被拒绝", () => {
  const draft = draftOf({
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
      ]),
    ],
  });
  const text = messages(run(draft)).join("\n");
  assert.match(text, /缺少 zs_0000002/);
});

test("步骤顺序被调换被拒绝", () => {
  const draft = draftOf({
    rings: [
      ring([
        {
          stepId: "zs_0000002",
          edgeRefs: [
            { edgeId: "be_0000002", direction: "forward" },
            { edgeId: "be_0000003", direction: "forward" },
          ],
        },
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
      ]),
    ],
  });
  assert.ok(messages(run(draft)).some((text) => text.includes("步骤顺序")));
});

test("引用不存在的边被拒绝", () => {
  const draft = draftOf({
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000099", direction: "forward" }] },
        {
          stepId: "zs_0000002",
          edgeRefs: [
            { edgeId: "be_0000002", direction: "forward" },
            { edgeId: "be_0000003", direction: "forward" },
          ],
        },
      ]),
    ],
  });
  assert.ok(messages(run(draft)).some((text) => text.includes("不存在的边 be_0000099")));
});

test("不可作边界的边被拒绝", () => {
  const draft = draftOf();
  const context = {
    edges: edges.map((item) =>
      item.edgeId === "be_0000001" ? { ...item, boundaryEligible: false } : item,
    ),
  };
  assert.ok(
    messages(run(draft, context)).some((text) => text.includes("不可作为学区边界")),
  );
});

test("方向错误导致断链被拒绝", () => {
  const draft = draftOf({
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
        {
          stepId: "zs_0000002",
          edgeRefs: [
            { edgeId: "be_0000002", direction: "forward" },
            { edgeId: "be_0000003", direction: "reverse" },
          ],
        },
      ]),
    ],
  });
  assert.ok(messages(run(draft)).some((text) => text.includes("断链")));
});

test("未闭合被拒绝", () => {
  const draft = draftOf({
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
        { stepId: "zs_0000002", edgeRefs: [{ edgeId: "be_0000002", direction: "forward" }] },
      ]),
    ],
  });
  assert.ok(messages(run(draft)).some((text) => text.includes("未闭合")));
});

test("同一环内重复引用同一条边被拒绝", () => {
  const draft = draftOf({
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
        {
          stepId: "zs_0000002",
          edgeRefs: [
            { edgeId: "be_0000002", direction: "forward" },
            { edgeId: "be_0000003", direction: "forward" },
            { edgeId: "be_0000002", direction: "forward" },
          ],
        },
      ]),
    ],
  });
  assert.ok(messages(run(draft)).some((text) => text.includes("重复引用同一条边")));
});

test("节点不可通行时被拒绝", () => {
  const draft = draftOf();
  const context = {
    nodes: nodes.map((item) =>
      item.nodeId === "bn_000002"
        ? { ...item, connectionType: "nonConnectingCrossing" }
        : item,
    ),
  };
  assert.ok(messages(run(draft, context)).some((text) => text.includes("不可通行")));
});

test("出现坐标字段被拒绝", () => {
  const draft = draftOf();
  draft.rings[0].coordinates = [[117.1, 36.1]];
  assert.ok(messages(run(draft)).some((text) => text.includes("禁止字段")));
});

test("draftId 与 zoneId 不一致被拒绝", () => {
  const draft = draftOf({ draftId: "draft_zone_007_20261117_01" });
  assert.ok(messages(run(draft)).some((text) => text.includes("不一致")));
});

test("boundaryText 被改写被拒绝", () => {
  const draft = draftOf({ boundaryText: "改写后的原文" });
  assert.ok(messages(run(draft)).some((text) => text.includes("boundaryText")));
});

test("operations 的 textRef 必须与正式原文一致", () => {
  const draft = draftOf({
    operations: [
      {
        type: "selectEdge",
        stepId: "zs_0000001",
        edgeId: "be_0000001",
        decidedBy: "测试",
        decidedAt: "2026-11-17",
        textRef: "东至甲路（改）",
      },
    ],
  });
  assert.ok(messages(run(draft)).some((text) => text.includes("textRef")));
});

test("rejected 状态必须填写 rejectReason", () => {
  const draft = draftOf({ status: "rejected", rejectReason: null });
  assert.ok(messages(run(draft)).some((text) => text.includes("rejectReason")));
});

test("洞环缺少 appliesToRingId 被拒绝", () => {
  const holeDraft = {
    ...draftOf(),
    boundaryText: holeZoneSpec.boundaryText,
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
        {
          stepId: "zs_0000002",
          edgeRefs: [
            { edgeId: "be_0000002", direction: "forward" },
            { edgeId: "be_0000003", direction: "forward" },
          ],
        },
      ]),
      ring(
        [
          { stepId: "zs_0000003", edgeRefs: [{ edgeId: "be_0000004", direction: "forward" }] },
          { stepId: "zs_0000004", edgeRefs: [{ edgeId: "be_0000005", direction: "forward" }] },
          { stepId: "zs_0000005", edgeRefs: [{ edgeId: "be_0000006", direction: "forward" }] },
        ],
        { role: "hole", appliesToRingId: null },
      ),
    ],
  };
  const report = validateZoneDraft(holeDraft, {
    zoneSpec: holeZoneSpec,
    nodes,
    edges,
  });
  assert.ok(messages(report).some((text) => text.includes("appliesToRingId")));
});

test("洞环带正确 appliesToRingId 且闭合时通过", () => {
  const holeDraft = {
    ...draftOf(),
    boundaryText: holeZoneSpec.boundaryText,
    rings: [
      ring([
        { stepId: "zs_0000001", edgeRefs: [{ edgeId: "be_0000001", direction: "forward" }] },
        {
          stepId: "zs_0000002",
          edgeRefs: [
            { edgeId: "be_0000002", direction: "forward" },
            { edgeId: "be_0000003", direction: "forward" },
          ],
        },
      ]),
      ring(
        [
          { stepId: "zs_0000003", edgeRefs: [{ edgeId: "be_0000004", direction: "forward" }] },
          { stepId: "zs_0000004", edgeRefs: [{ edgeId: "be_0000005", direction: "forward" }] },
          { stepId: "zs_0000005", edgeRefs: [{ edgeId: "be_0000006", direction: "forward" }] },
        ],
        { role: "hole", appliesToRingId: "zr_000001" },
      ),
    ],
  };
  const report = validateZoneDraft(holeDraft, {
    zoneSpec: holeZoneSpec,
    nodes,
    edges,
  });
  assert.deepEqual(report.errors, []);
});
