import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  approxMeters,
  validateBoundaryFeatures,
  validateIdRegistry,
} from "../lib/network-schema.mjs";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/network-generator/minimal",
);

const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf-8"));

const features = readJson("boundary_features.geojson");
const decisions = readJson("connection_decisions.json");
const previousNodes = readJson("previous_network_nodes.json");
const registry = readJson("id_registry.json");
const expectedNodes = readJson("expected_network_nodes.json");
const expectedEdges = readJson("expected_network_edges.json");
const expectedRegistry = readJson("expected_id_registry.json");

const featureMap = new Map(
  features.features.map((feature) => [feature.properties.featureId, feature]),
);
const nodeMap = new Map(
  expectedNodes.nodes.map((node) => [node.nodeId, node]),
);

const coordinateAt = ({ featureId, partIndex, vertexIndex }) => {
  const geometry = featureMap.get(featureId)?.geometry;
  const parts = geometry?.type === "LineString"
    ? [geometry.coordinates]
    : geometry?.coordinates;
  return parts?.[partIndex]?.[vertexIndex] ?? null;
};

const placementFor = (node, featureId, partIndex, vertexIndex) =>
  node.placements.some(
    (placement) =>
      placement.featureId === featureId &&
      placement.partIndex === partIndex &&
      placement.vertexIndex === vertexIndex,
  );

test("B8 边界要素 fixture 通过契约校验", () => {
  const report = validateBoundaryFeatures(features, { strict: true });
  assert.deepEqual(report.errors, []);
});

test("B8 初始和预期注册表通过契约校验", () => {
  assert.deepEqual(validateIdRegistry(registry).errors, []);
  assert.deepEqual(validateIdRegistry(expectedRegistry).errors, []);
});

test("B8 边界要素全部登记在初始和预期注册表", () => {
  const featureIds = features.features.map(
    (feature) => feature.properties.featureId,
  );
  for (const candidate of [registry, expectedRegistry]) {
    const registered = new Set(
      candidate.entries
        .filter((entry) => entry.entityType === "boundaryFeature")
        .map((entry) => entry.id),
    );
    assert.deepEqual([...registered].sort(), [...featureIds].sort());
  }
});

test("连接裁定的 placement 存在且 connected 完全共点", () => {
  for (const decision of decisions.decisions) {
    const coordinates = decision.placements.map(coordinateAt);
    assert.ok(coordinates.every(Boolean), decision.decisionId);
    if (decision.connectionType === "connected") {
      assert.ok(
        coordinates.every(
          (coordinate) =>
            coordinate[0] === coordinates[0][0] &&
            coordinate[1] === coordinates[0][1],
        ),
        decision.decisionId,
      );
    }
  }
});

test("预期节点 ID 连续且复用 bn_000001", () => {
  assert.deepEqual(
    expectedNodes.nodes.map((node) => node.nodeId),
    Array.from({ length: 10 }, (_, index) =>
      `bn_${String(index + 1).padStart(6, "0")}`,
    ),
  );
  assert.deepEqual(expectedNodes.nodes[0], previousNodes.nodes[0]);
});

test("预期边完整引用节点、端点和规范顶点范围", () => {
  for (const edge of expectedEdges.edges) {
    assert.ok(edge.fromVertexIndex < edge.toVertexIndex, edge.edgeId);
    const fromNode = nodeMap.get(edge.fromNodeId);
    const toNode = nodeMap.get(edge.toNodeId);
    assert.ok(fromNode, edge.edgeId);
    assert.ok(toNode, edge.edgeId);
    assert.ok(
      placementFor(
        fromNode,
        edge.featureId,
        edge.partIndex,
        edge.fromVertexIndex,
      ),
      `${edge.edgeId} from placement`,
    );
    assert.ok(
      placementFor(
        toNode,
        edge.featureId,
        edge.partIndex,
        edge.toVertexIndex,
      ),
      `${edge.edgeId} to placement`,
    );
  }
});

test("预期边长度按冻结算法重算到 0.1 米", () => {
  for (const edge of expectedEdges.edges) {
    const { geometry } = featureMap.get(edge.featureId);
    const part = geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates[edge.partIndex];
    let lengthM = 0;
    for (
      let index = edge.fromVertexIndex;
      index < edge.toVertexIndex;
      index += 1
    ) {
      lengthM += approxMeters(part[index], part[index + 1]);
    }
    assert.equal(Math.round(lengthM * 10) / 10, edge.lengthM, edge.edgeId);
  }
});

test("nonConnectingCrossing 不切分相关要素", () => {
  const westEdges = expectedEdges.edges.filter(
    (edge) => edge.featureId === "bf_900004",
  );
  const auditEdges = expectedEdges.edges.filter(
    (edge) => edge.featureId === "bf_900006",
  );
  assert.equal(westEdges.length, 1);
  assert.equal(auditEdges.length, 1);
  assert.equal(westEdges[0].fromVertexIndex, 0);
  assert.equal(westEdges[0].toVertexIndex, 2);
  assert.equal(auditEdges[0].fromVertexIndex, 0);
  assert.equal(auditEdges[0].toVertexIndex, 2);
});

test("预期注册表覆盖全部预期节点和边", () => {
  const registered = new Set(expectedRegistry.entries.map((entry) => entry.id));
  for (const node of expectedNodes.nodes) assert.ok(registered.has(node.nodeId));
  for (const edge of expectedEdges.edges) assert.ok(registered.has(edge.edgeId));
  assert.equal(expectedRegistry.counters.networkNode, 10);
  assert.equal(expectedRegistry.counters.networkEdge, 8);
});
