import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createEditorState,
  draftFromState,
  selectEdge,
  serializeDraft,
} from "../lib/draft-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MOCK = path.join(ROOT, "tools/boundary-editor/mock");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

const nodesFile = readJson(path.join(MOCK, "network_nodes.json"));
const edgesFile = readJson(path.join(MOCK, "network_edges.json"));
const nodes = nodesFile.nodes;
const edges = edgesFile.edges;
const mockSpecs = readJson(path.join(MOCK, "mock-zone-spec.json"));
const zoneSpec = mockSpecs.zones.find((zone) => zone.zoneId === "zone_900");

const selectionPlan = [
  { stepId: "zs_9000001", edgeId: "be_0000001" },
  { stepId: "zs_9000001", edgeId: "be_0000002" },
  { stepId: "zs_9000002", edgeId: "be_0000003" },
  { stepId: "zs_9000003", edgeId: "be_0000004" },
  { stepId: "zs_9000004", edgeId: "be_0000005" },
];

const buildDraft = (status) => {
  const state = createEditorState({
    zoneSpec,
    draftId: "draft_zone_900_20261117_01",
    date: "2026-11-17",
  });
  selectionPlan.forEach((selection) => {
    const result = selectEdge(state, { edges, nodes }, {
      ...selection,
      ringIndex: 0,
      decidedBy: "测试",
      decidedAt: "2026-11-17",
    });
    assert.equal(result.ok, true, result.error);
  });
  return draftFromState(state, { status });
};

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf-8",
  });

const makeWorkspace = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-admission-draft-"));
  const zoneSpecsPath = path.join(dir, "zone_specs.v2.json");
  // 故意使用非 canonical 空格，验证导入只做定点替换
  const specsText = JSON.stringify(
    {
      schemaVersion: 2,
      zones: mockSpecs.zones.map((zone) => ({ ...zone })),
    },
    null,
    2,
  ).replace('"schemaVersion": 2', '"schemaVersion":2');
  fs.writeFileSync(zoneSpecsPath, specsText, "utf-8");

  const draftPath = path.join(dir, "draft.json");
  fs.writeFileSync(draftPath, serializeDraft(buildDraft("readyForReview")), "utf-8");

  return { dir, zoneSpecsPath, draftPath, specsText };
};

const commonArgs = (workspace, { features = true } = {}) => [
  "--zone-specs",
  workspace.zoneSpecsPath,
  "--nodes",
  path.join(MOCK, "network_nodes.json"),
  "--edges",
  path.join(MOCK, "network_edges.json"),
  ...(features ? ["--features", path.join(MOCK, "boundary_features.geojson")] : []),
];

test("validate-zone-draft：合法草稿退出 0，editing 缺绑定退出 1", () => {
  const workspace = makeWorkspace();
  try {
    const ok = run("validate-zone-draft.mjs", [
      workspace.draftPath,
      ...commonArgs(workspace, { features: false }),
    ]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /0 个错误/);

    const partial = path.join(workspace.dir, "partial.json");
    // 构造一个缺边的 readyForReview 草稿
    const brokenDraft = buildDraft("editing");
    brokenDraft.status = "readyForReview";
    brokenDraft.rings[0].steps[3].edgeRefs = [];
    fs.writeFileSync(partial, serializeDraft(brokenDraft), "utf-8");
    const failed = run("validate-zone-draft.mjs", [
      partial,
      ...commonArgs(workspace, { features: false }),
    ]);
    assert.equal(failed.status, 1, failed.stderr);
  } finally {
    fs.rmSync(workspace.dir, { recursive: true, force: true });
  }
});

test("import-zone-draft：dry-run 不写文件，--write 需要正确 --confirm", () => {
  const workspace = makeWorkspace();
  try {
    const dry = run("import-zone-draft.mjs", [workspace.draftPath, ...commonArgs(workspace)]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stderr, /dry-run/);
    assert.equal(fs.readFileSync(workspace.zoneSpecsPath, "utf-8"), workspace.specsText);

    const wrong = run("import-zone-draft.mjs", [
      workspace.draftPath,
      ...commonArgs(workspace),
      "--write",
      "--confirm",
      "draft_zone_900_20261117_99",
    ]);
    assert.equal(wrong.status, 2, wrong.stderr);
    assert.equal(fs.readFileSync(workspace.zoneSpecsPath, "utf-8"), workspace.specsText);
  } finally {
    fs.rmSync(workspace.dir, { recursive: true, force: true });
  }
});

test("import-zone-draft：--write 只替换 edgeRefs，保留原格式与未改动学区", () => {
  const workspace = makeWorkspace();
  try {
    const reportPath = path.join(workspace.dir, "report.json");
    const written = run("import-zone-draft.mjs", [
      workspace.draftPath,
      ...commonArgs(workspace),
      "--report",
      reportPath,
      "--write",
      "--confirm",
      "draft_zone_900_20261117_01",
    ]);
    assert.equal(written.status, 0, written.stderr);

    const patchedText = fs.readFileSync(workspace.zoneSpecsPath, "utf-8");
    assert.ok(patchedText.includes('"schemaVersion":2'), "原文件空格格式应保留");
    const marker = '"zoneId": "zone_901"';
    assert.equal(
      patchedText.slice(patchedText.indexOf(marker)),
      workspace.specsText.slice(workspace.specsText.indexOf(marker)),
      "zone_901 及其后的文本应逐字保留",
    );
    assert.equal(
      patchedText.slice(0, patchedText.indexOf('"zoneId": "zone_900"')),
      workspace.specsText.slice(0, workspace.specsText.indexOf('"zoneId": "zone_900"')),
      "头部文本应逐字保留",
    );

    const patched = JSON.parse(patchedText);
    const zone = patched.zones.find((item) => item.zoneId === "zone_900");
    const refs = zone.rings[0].steps.map((step) => step.edgeRefs);
    assert.deepEqual(refs, [
      [
        { edgeId: "be_0000001", direction: "forward" },
        { edgeId: "be_0000002", direction: "forward" },
      ],
      [{ edgeId: "be_0000003", direction: "forward" }],
      [{ edgeId: "be_0000004", direction: "forward" }],
      [{ edgeId: "be_0000005", direction: "forward" }],
    ]);
    assert.equal(zone.boundaryText, zoneSpec.boundaryText);

    const report = readJson(reportPath);
    assert.equal(report.write, true);
    assert.equal(report.stepsUpdated, 4);
    assert.deepEqual(report.errors, []);
    assert.equal(report.rings[0].closed, true);
  } finally {
    fs.rmSync(workspace.dir, { recursive: true, force: true });
  }
});

test("import-zone-draft：非 readyForReview 草稿退出 1 且不写文件", () => {
  const workspace = makeWorkspace();
  try {
    const editingPath = path.join(workspace.dir, "editing.json");
    fs.writeFileSync(editingPath, serializeDraft(buildDraft("editing")), "utf-8");
    const result = run("import-zone-draft.mjs", [
      editingPath,
      ...commonArgs(workspace),
      "--write",
      "--confirm",
      "draft_zone_900_20261117_01",
    ]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.readFileSync(workspace.zoneSpecsPath, "utf-8"), workspace.specsText);
  } finally {
    fs.rmSync(workspace.dir, { recursive: true, force: true });
  }
});
