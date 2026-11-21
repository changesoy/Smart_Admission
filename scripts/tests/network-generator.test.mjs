import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildNetwork,
  serializeJson,
} from "../lib/network-generator-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE = path.join(
  ROOT,
  "scripts/fixtures/network-generator/minimal",
);
const SCRIPT = path.join(ROOT, "scripts/generate-network.mjs");
const VALIDATE_SCRIPT = path.join(ROOT, "scripts/validate-network.mjs");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));
const fixture = (name) => readJson(path.join(FIXTURE, name));

const baseInput = () => ({
  features: fixture("boundary_features.geojson"),
  decisions: fixture("connection_decisions.json"),
  previousNodes: fixture("previous_network_nodes.json"),
  previousEdges: fixture("previous_network_edges.json"),
  registry: fixture("id_registry.json"),
  effectiveDate: "2026-11-17",
});

const buildWithDecisions = (decisions) =>
  buildNetwork({
    ...baseInput(),
    decisions: { schemaVersion: 1, decisions },
  });

const decisionErrors = (result) =>
  result.report.errors.map(({ message }) => message).join("\n");

const connectedDecision = (overrides = {}) => ({
  decisionId: "ncd_000001",
  connectionType: "connected",
  placements: [
    { featureId: "bf_900001", partIndex: 0, vertexIndex: 0 },
    { featureId: "bf_900004", partIndex: 0, vertexIndex: 2 },
  ],
  rulingIds: [],
  note: "测试裁定",
  ...overrides,
});

const runScript = (script, args) => {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
};

const runCliResult = (args) => runScript(SCRIPT, args);

const makeTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), "smart-admission-gen-"));

const copyFixture = (temp, name, targetName) => {
  const target = path.join(temp, targetName ?? name);
  fs.copyFileSync(path.join(FIXTURE, name), target);
  return target;
};

const fixtureArgs = (paths) => [
  "--features",
  paths.features,
  "--decisions",
  paths.decisions,
  "--previous-nodes",
  paths.previousNodes,
  "--previous-edges",
  paths.previousEdges,
  "--registry",
  paths.registry,
  "--nodes-out",
  paths.nodesOut,
  "--edges-out",
  paths.edgesOut,
  "--effective-date",
  "2026-11-17",
];

test("生成结果与 B8 最小样例深相等", () => {
  const result = buildNetwork(baseInput());
  assert.deepEqual(result.report.errors, []);
  assert.deepEqual(result.nodes, fixture("expected_network_nodes.json"));
  assert.deepEqual(result.edges, fixture("expected_network_edges.json"));
  assert.deepEqual(result.registry, fixture("expected_id_registry.json"));
});

test("边输出字节与规范化序列化完全一致", () => {
  const result = buildNetwork(baseInput());
  const expected = fixture("expected_network_edges.json");
  assert.equal(serializeJson(result.edges), serializeJson(expected));
});

test("复用 bn_000001，且不因坐标相同复用其他节点", () => {
  const result = buildNetwork(baseInput());
  const reused = result.nodes.nodes.find((node) => node.nodeId === "bn_000001");
  assert.equal(reused.derivationType, "manualControl");
  assert.equal(reused.createdAt, "2026-11-17");
  assert.deepEqual(result.allocations.nodes, [
    "bn_000002",
    "bn_000003",
    "bn_000004",
    "bn_000005",
    "bn_000006",
    "bn_000007",
    "bn_000008",
    "bn_000009",
    "bn_000010",
  ]);
});

test("nonConnectingCrossing 不切分相关要素", () => {
  const result = buildNetwork(baseInput());
  const west = result.edges.edges.filter((edge) => edge.featureId === "bf_900004");
  const audit = result.edges.edges.filter((edge) => edge.featureId === "bf_900006");
  assert.equal(west.length, 1);
  assert.equal(audit.length, 1);
  assert.deepEqual(
    { from: west[0].fromVertexIndex, to: west[0].toVertexIndex },
    { from: 0, to: 2 },
  );
  assert.deepEqual(
    { from: audit[0].fromVertexIndex, to: audit[0].toVertexIndex },
    { from: 0, to: 2 },
  );
});

test("boundaryEligible=false 的要素生成边继承 false", () => {
  const result = buildNetwork(baseInput());
  const auditEdges = result.edges.edges.filter(
    (edge) => edge.featureId === "bf_900006",
  );
  assert.ok(auditEdges.length > 0);
  auditEdges.forEach((edge) => assert.equal(edge.boundaryEligible, false));
});

test("输入数组顺序扰动不改变输出字节", () => {
  const input = baseInput();
  const perturbed = {
    ...input,
    features: {
      ...input.features,
      features: [...input.features.features].reverse(),
    },
    decisions: {
      ...input.decisions,
      decisions: [...input.decisions.decisions].reverse(),
    },
  };
  const normal = buildNetwork(input);
  const shuffled = buildNetwork(perturbed);
  assert.equal(serializeJson(shuffled.nodes), serializeJson(normal.nodes));
  assert.equal(serializeJson(shuffled.edges), serializeJson(normal.edges));
  assert.equal(serializeJson(shuffled.registry), serializeJson(normal.registry));
});

test("连续两次 --write 不分配新 ID，三文件字节不变", () => {
  const temp = makeTemp();
  const paths = {
    features: copyFixture(temp, "boundary_features.geojson"),
    decisions: copyFixture(temp, "connection_decisions.json"),
    previousNodes: copyFixture(temp, "previous_network_nodes.json"),
    previousEdges: copyFixture(temp, "previous_network_edges.json"),
    registry: copyFixture(temp, "id_registry.json"),
    nodesOut: path.join(temp, "network_nodes.json"),
    edgesOut: path.join(temp, "network_edges.json"),
  };

  const first = runCliResult([...fixtureArgs(paths), "--write"]);
  assert.equal(first.status, 0, first.stderr);
  const bytes = {
    nodes: fs.readFileSync(paths.nodesOut, "utf-8"),
    edges: fs.readFileSync(paths.edgesOut, "utf-8"),
    registry: fs.readFileSync(paths.registry, "utf-8"),
  };

  const second = runCliResult([
    ...fixtureArgs({
      ...paths,
      previousNodes: paths.nodesOut,
      previousEdges: paths.edgesOut,
    }),
    "--write",
  ]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(paths.nodesOut, "utf-8"), bytes.nodes);
  assert.equal(fs.readFileSync(paths.edgesOut, "utf-8"), bytes.edges);
  assert.equal(fs.readFileSync(paths.registry, "utf-8"), bytes.registry);
  assert.deepEqual(
    JSON.parse(bytes.registry),
    fixture("expected_id_registry.json"),
  );
});

test("dry-run 不写任何文件", () => {
  const temp = makeTemp();
  const paths = {
    features: copyFixture(temp, "boundary_features.geojson"),
    decisions: copyFixture(temp, "connection_decisions.json"),
    previousNodes: copyFixture(temp, "previous_network_nodes.json"),
    previousEdges: copyFixture(temp, "previous_network_edges.json"),
    registry: copyFixture(temp, "id_registry.json"),
    nodesOut: path.join(temp, "network_nodes.json"),
    edgesOut: path.join(temp, "network_edges.json"),
  };
  const before = Object.fromEntries(
    fs
      .readdirSync(temp)
      .map((name) => [name, fs.readFileSync(path.join(temp, name), "utf-8")]),
  );

  const result = runCliResult(fixtureArgs(paths));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("\"write\": false"));

  const after = Object.fromEntries(
    fs
      .readdirSync(temp)
      .map((name) => [name, fs.readFileSync(path.join(temp, name), "utf-8")]),
  );
  assert.deepEqual(after, before);
});

test("缺少 --effective-date 时以退出码 2 失败", () => {
  const result = runCliResult([
    "--features",
    path.join(FIXTURE, "boundary_features.geojson"),
    "--registry",
    path.join(FIXTURE, "id_registry.json"),
  ]);
  assert.equal(result.status, 2);
});

test("未知参数以退出码 2 失败", () => {
  const result = runCliResult(["--unknown", "x"]);
  assert.equal(result.status, 2);
});

test("新增节点导致旧边拆分时，旧边退役并双向记录替代关系", () => {
  const baseline = buildNetwork(baseInput());
  const input = baseInput();
  const withoutMidCrossing = {
    ...input,
    decisions: {
      ...input.decisions,
      decisions: input.decisions.decisions.filter(
        (decision) => decision.decisionId !== "ncd_000002",
      ),
    },
    previousNodes: { schemaVersion: 1, nodes: baseline.nodes.nodes },
    previousEdges: { schemaVersion: 1, edges: baseline.edges.edges },
    registry: baseline.registry,
  };

  const merged = buildNetwork(withoutMidCrossing);
  assert.deepEqual(merged.report.errors, []);

  const retired = merged.edges.edges.filter((edge) => edge.lifecycle === "retired");
  const replacedIds = retired.map((edge) => edge.edgeId).sort();
  assert.deepEqual(replacedIds, [
    "be_0000001",
    "be_0000002",
    "be_0000006",
    "be_0000007",
  ]);

  const newEdges = merged.edges.edges.filter(
    (edge) => edge.lifecycle === "active" && edge.supersedes.length > 0,
  );
  assert.ok(newEdges.length >= 2);
  newEdges.forEach((edge) => {
    edge.supersedes.forEach((oldId) => {
      const old = merged.edges.edges.find((item) => item.edgeId === oldId);
      assert.ok(old.supersededBy.includes(edge.edgeId), `${oldId} 未回指 ${edge.edgeId}`);
    });
  });

  const retiredNode = merged.nodes.nodes.find((node) => node.nodeId === "bn_000002");
  assert.equal(retiredNode.lifecycle, "retired");
});

test("目标路径不可写时事务失败并恢复其余文件", () => {
  const temp = makeTemp();
  const paths = {
    features: copyFixture(temp, "boundary_features.geojson"),
    decisions: copyFixture(temp, "connection_decisions.json"),
    previousNodes: copyFixture(temp, "previous_network_nodes.json"),
    previousEdges: copyFixture(temp, "previous_network_edges.json"),
    registry: copyFixture(temp, "id_registry.json"),
    nodesOut: path.join(temp, "network_nodes.json"),
    edgesOut: path.join(temp, "network_edges.json"),
  };
  // 让 nodes-out 指向一个已存在目录，备份步骤必然失败
  fs.mkdirSync(paths.nodesOut);
  fs.copyFileSync(paths.previousEdges, paths.edgesOut);
  const edgesBefore = fs.readFileSync(paths.edgesOut, "utf-8");
  const registryBefore = fs.readFileSync(paths.registry, "utf-8");

  const result = runCliResult([...fixtureArgs(paths), "--write"]);
  assert.equal(result.status, 2);
  assert.equal(fs.readFileSync(paths.edgesOut, "utf-8"), edgesBefore);
  assert.equal(fs.readFileSync(paths.registry, "utf-8"), registryBefore);
});

test("报告可在 dry-run 下显式写出", () => {
  const temp = makeTemp();
  const paths = {
    features: copyFixture(temp, "boundary_features.geojson"),
    decisions: copyFixture(temp, "connection_decisions.json"),
    previousNodes: copyFixture(temp, "previous_network_nodes.json"),
    previousEdges: copyFixture(temp, "previous_network_edges.json"),
    registry: copyFixture(temp, "id_registry.json"),
    nodesOut: path.join(temp, "network_nodes.json"),
    edgesOut: path.join(temp, "network_edges.json"),
  };
  const reportPath = path.join(temp, "report.json");
  const result = runCliResult([...fixtureArgs(paths), "--report", reportPath]);
  assert.equal(result.status, 0, result.stderr);
  const report = readJson(reportPath);
  assert.equal(report.counts.nodes, 10);
  assert.equal(report.counts.edges, 8);
  assert.equal(report.errors.length, 0);
});

test("裁定 schemaVersion 错误被拒绝", () => {
  const input = baseInput();
  const result = buildNetwork({
    ...input,
    decisions: { ...input.decisions, schemaVersion: 2 },
  });
  assert.match(decisionErrors(result), /schemaVersion/);
});

test("裁定 ID 必须匹配 ncd_ 六位格式", () => {
  const result = buildWithDecisions([
    connectedDecision({ decisionId: "dec_000001" }),
  ]);
  assert.match(decisionErrors(result), /decisionId 必须匹配/);
});

test("裁定 connectionType 枚举非法被拒绝", () => {
  const result = buildWithDecisions([
    connectedDecision({ connectionType: "crossing" }),
  ]);
  assert.match(decisionErrors(result), /connectionType 非法/);
});

test("rulingIds 必须是数组", () => {
  const result = buildWithDecisions([
    connectedDecision({ rulingIds: "br_000001" }),
  ]);
  assert.match(decisionErrors(result), /rulingIds 必须是数组/);
});

test("rulingId 格式非法被拒绝", () => {
  const result = buildWithDecisions([
    connectedDecision({ connectionType: "conditional", rulingIds: ["br_1"] }),
  ]);
  assert.match(decisionErrors(result), /rulingId 格式非法/);
});

test("rulingId 未在注册表登记被拒绝", () => {
  const result = buildWithDecisions([
    connectedDecision({ connectionType: "conditional", rulingIds: ["br_000001"] }),
  ]);
  assert.match(decisionErrors(result), /未在注册表登记/);
});

test("conditional 缺少有效 rulingId 被拒绝", () => {
  const result = buildWithDecisions([
    connectedDecision({ connectionType: "conditional", rulingIds: [] }),
  ]);
  assert.match(decisionErrors(result), /conditional 裁定必须关联/);
});

test("placement 下标越界被拒绝", () => {
  const result = buildWithDecisions([
    connectedDecision({
      placements: [
        { featureId: "bf_900001", partIndex: 0, vertexIndex: 0 },
        { featureId: "bf_900004", partIndex: 0, vertexIndex: 99 },
      ],
    }),
  ]);
  assert.match(decisionErrors(result), /vertexIndex 99 超出范围/);
});

test("connected 的 placement 不共点被拒绝", () => {
  const result = buildWithDecisions([
    connectedDecision({
      placements: [
        { featureId: "bf_900001", partIndex: 0, vertexIndex: 0 },
        { featureId: "bf_900002", partIndex: 0, vertexIndex: 0 },
      ],
    }),
  ]);
  assert.match(decisionErrors(result), /不完全共点/);
});

test("同一裁定内 placement 重复被拒绝", () => {
  const placement = { featureId: "bf_900001", partIndex: 0, vertexIndex: 0 };
  const result = buildWithDecisions([
    connectedDecision({ placements: [placement, { ...placement }] }),
  ]);
  assert.match(decisionErrors(result), /placement 重复/);
});

test("同一 placement 跨裁定重复占用被拒绝", () => {
  const result = buildWithDecisions([
    connectedDecision(),
    connectedDecision({
      decisionId: "ncd_000002",
      connectionType: "nonConnectingCrossing",
      placements: [
        { featureId: "bf_900001", partIndex: 0, vertexIndex: 0 },
        { featureId: "bf_900002", partIndex: 0, vertexIndex: 0 },
      ],
    }),
  ]);
  assert.match(decisionErrors(result), /同时出现在/);
});

test("note 为空被拒绝", () => {
  const result = buildWithDecisions([connectedDecision({ note: "  " })]);
  assert.match(decisionErrors(result), /note 必须是非空字符串/);
});

test("validate-network 未知参数以退出码 2 失败", () => {
  const result = runScript(VALIDATE_SCRIPT, ["--unknown"]);
  assert.equal(result.status, 2);
});

test("validate-network 显式裁定文件缺失以退出码 2 失败", () => {
  const temp = makeTemp();
  const result = runScript(VALIDATE_SCRIPT, [
    "--decisions",
    path.join(temp, "missing.json"),
  ]);
  assert.equal(result.status, 2);
});
