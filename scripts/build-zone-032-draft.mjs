#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const nodes = read("data/network_nodes.json").nodes.filter(
  (node) => node.lifecycle === "active" && node.connectionType === "connected",
);
const edges = read("data/network_edges.json").edges.filter(
  (edge) => edge.lifecycle === "active",
);
const zone = read("data/zone_specs.v2.json").zones.find(
  (item) => item.zoneId === "zone_032",
);

const findCorner = (left, right) => {
  const node = nodes.find((candidate) => {
    const features = new Set(candidate.placements.map((placement) => placement.featureId));
    return features.has(left) && features.has(right);
  });
  if (!node) throw new Error(`找不到 ${left}×${right} 的 active connected 节点`);
  const placement = (featureId) =>
    node.placements.find((item) => item.featureId === featureId);
  return { nodeId: node.nodeId, placement };
};

const corners = {
  northwest: findCorner("bf_000023", "bf_000012"),
  northeast: findCorner("bf_000023", "bf_000040"),
  southeast: findCorner("bf_000040", "bf_000022"),
  southwest: findCorner("bf_000022", "bf_000012"),
};

const pathOnFeature = (featureId, start, end) => {
  const startPlacement = start.placement(featureId);
  const endPlacement = end.placement(featureId);
  if (startPlacement.partIndex !== endPlacement.partIndex) {
    throw new Error(`${featureId} 的角点跨 part，不能直接构造路径`);
  }
  const low = Math.min(startPlacement.vertexIndex, endPlacement.vertexIndex);
  const high = Math.max(startPlacement.vertexIndex, endPlacement.vertexIndex);
  const forward = startPlacement.vertexIndex < endPlacement.vertexIndex;
  const selected = edges
    .filter(
      (edge) =>
        edge.featureId === featureId &&
        edge.partIndex === startPlacement.partIndex &&
        edge.fromVertexIndex >= low &&
        edge.toVertexIndex <= high,
    )
    .sort((left, right) => left.fromVertexIndex - right.fromVertexIndex);
  if (!forward) selected.reverse();
  if (selected.length === 0) throw new Error(`${featureId} 角点之间没有 active 边`);
  let currentNode = start.nodeId;
  const refs = selected.map((edge) => {
    const direction = edge.fromNodeId === currentNode ? "forward" : "reverse";
    const nextNode = direction === "forward" ? edge.toNodeId : edge.fromNodeId;
    if (currentNode !== edge.fromNodeId && currentNode !== edge.toNodeId) {
      throw new Error(`${featureId} 的 ${edge.edgeId} 与前一条边不连续`);
    }
    currentNode = nextNode;
    return { edgeId: edge.edgeId, direction };
  });
  if (currentNode !== end.nodeId) {
    throw new Error(`${featureId} 路径终点 ${currentNode} 不等于 ${end.nodeId}`);
  }
  return refs;
};

const refsByStep = new Map([
  ["zs_0000042", pathOnFeature("bf_000023", corners.northeast, corners.northwest)],
  ["zs_0000044", pathOnFeature("bf_000012", corners.northwest, corners.southwest)],
  ["zs_0000043", pathOnFeature("bf_000022", corners.southwest, corners.southeast)],
  ["zs_0000045", pathOnFeature("bf_000040", corners.southeast, corners.northeast)],
]);

const draft = {
  draftId: "draft_zone_032_20261121_01",
  schemaVersion: 1,
  zoneId: "zone_032",
  boundaryText: zone.boundaryText,
  status: "readyForReview",
  createdBy: "边界拓扑自动化",
  createdAt: "2026-11-21",
  updatedAt: "2026-11-21",
  rings: zone.rings.map((ring) => ({
    role: ring.role,
    appliesToRingId: null,
    steps: ring.steps.map((step) => ({
      stepId: step.stepId,
      edgeRefs: refsByStep.get(step.stepId),
    })),
  })),
  operations: [],
  rejectReason: null,
};

const target = path.join(ROOT, "reports/network/zone_032-formal-draft.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      target: path.relative(ROOT, target).split(path.sep).join("/"),
      corners: Object.fromEntries(
        Object.entries(corners).map(([name, corner]) => [name, corner.nodeId]),
      ),
      steps: Object.fromEntries(
        [...refsByStep].map(([stepId, refs]) => [stepId, refs.length]),
      ),
    },
    null,
    2,
  ),
);
