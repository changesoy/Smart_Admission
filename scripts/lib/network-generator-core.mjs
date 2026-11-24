/**
 * network-generator-core.mjs - 边界要素 → 拓扑节点/边 的纯生成核心
 *
 * 契约：
 *   docs/planning/统一边界网络数据契约与ID规则.md（第七、八、十一章）
 *   docs/planning/节点边生成器规格与样例交接.md（第三至七章）
 *
 * 本模块不读文件、不打印、不退出。输入已是解析后的对象，
 * 输出节点、边、注册表副本与问题报告，由 generate-network.mjs 决定是否落盘。
 */
import {
  approxMeters,
  createReport,
  eachPart,
  isId,
} from "./network-schema.mjs";
import {
  DECISION_SCHEMA_VERSION,
  normalizePlacements,
  placementKey,
  placementSetKey,
  sameCoordinate,
  validateConnectionDecisions,
} from "./connection-decisions.mjs";
import { addEntry, allocateIds, retireEntry } from "./id-registry.mjs";

/** 输出文件结构版本 */
export const NETWORK_FILE_SCHEMA_VERSION = 1;

export { DECISION_SCHEMA_VERSION, normalizePlacements, placementKey, placementSetKey };

/** 可信状态高低（越低越不可信），用于“不得高于最低可信状态” */
const VERIFICATION_RANK = {
  outdated: 0,
  disputed: 1,
  unreviewed: 2,
  reviewed: 3,
  verified: 4,
};

const lowestVerification = (statuses) =>
  statuses.reduce(
    (lowest, status) =>
      (VERIFICATION_RANK[status] ?? VERIFICATION_RANK.unreviewed) <
      (VERIFICATION_RANK[lowest] ?? VERIFICATION_RANK.unreviewed)
        ? status
        : lowest,
    "verified",
  );

/** 规范 JSON：UTF-8、LF、两空格缩进、末尾一个换行 */
export const serializeJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** 建立 active 要素索引，并返回按要素顺序排列的 part 数量 */
export const indexFeatures = (collection, report) => {
  const section = "boundary_features";
  const map = new Map();
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    report.error(section, "boundary_features 根节点必须是 FeatureCollection 且包含 features 数组");
    return map;
  }

  collection.features.forEach((feature, featureIndex) => {
    const props = feature?.properties ?? {};
    const at = `第 ${featureIndex + 1} 个要素`;
    if (!isId("boundaryFeature", props.featureId)) {
      report.error(section, `${at} featureId 格式非法: ${JSON.stringify(props.featureId)}`);
      return;
    }
    if (map.has(props.featureId)) {
      report.error(section, `${at} featureId 重复: ${props.featureId}`);
      return;
    }
    const parts = eachPart(feature.geometry);
    if (parts.length === 0) {
      report.error(section, `${props.featureId} 既不是 LineString 也不是 MultiLineString`);
      return;
    }
    parts.forEach((part, partIndex) => {
      if (part.length < 2) {
        report.error(section, `${props.featureId} part ${partIndex} 顶点不足 2 个`);
      }
      for (let index = 1; index < part.length; index += 1) {
        if (sameCoordinate(part[index - 1], part[index])) {
          report.error(
            section,
            `${props.featureId} part ${partIndex} 顶点 ${index - 1}→${index} 为重复坐标，形成零长度段`,
          );
        }
      }
    });
    map.set(props.featureId, {
      featureId: props.featureId,
      feature,
      props,
      parts,
      lifecycle: props.lifecycle ?? "active",
      boundaryEligible: props.boundaryEligible !== false,
      verificationStatus: props.verificationStatus ?? "unreviewed",
    });
  });

  return map;
};

/** 构造节点候选（不含 ID） */
const buildNodeCandidates = (featureIndex, decisions, report) => {
  const section = "network_nodes";
  const candidates = [];
  const decisionPlacements = new Set();

  decisions.forEach((decision) => {
    decision.placements.forEach((placement) =>
      decisionPlacements.add(placementKey(placement)),
    );
    const featureIds = [...new Set(decision.placements.map((item) => item.featureId))];
    const nodeType = featureIds.length >= 2 ? "intersection" : "control";
    const names = decision.placements.map(
      (placement) => featureIndex.get(placement.featureId)?.props.canonicalName ?? placement.featureId,
    );
    candidates.push({
      nodeType,
      connectionType: decision.connectionType,
      derivationType: "geometryIntersection",
      placements: decision.placements,
      label: names.join("×"),
      verificationStatus: lowestVerification(
        decision.placements.map(
          (placement) =>
            featureIndex.get(placement.featureId)?.verificationStatus ?? "unreviewed",
        ),
      ),
      decisionId: decision.decisionId,
    });
  });

  featureIndex.forEach((feature) => {
    if (feature.lifecycle !== "active") return;
    feature.parts.forEach((part, partIndex) => {
      [0, part.length - 1].forEach((vertexIndex) => {
        const placement = { featureId: feature.featureId, partIndex, vertexIndex };
        if (decisionPlacements.has(placementKey(placement))) return;
        candidates.push({
          nodeType: "terminal",
          connectionType: "connected",
          derivationType: "featureEndpoint",
          placements: [placement],
          label: `${feature.props.canonicalName}端点`,
          verificationStatus: feature.verificationStatus,
          decisionId: null,
        });
      });
    });
  });

  // 同一 placement 不应产生两个 terminal 候选（闭合 part 首尾同一点的情况另行报错）
  const seen = new Map();
  const unique = [];
  candidates.forEach((candidate) => {
    const key = placementSetKey(candidate.placements);
    if (seen.has(key)) {
      report.warn(section, `节点候选 ${key} 重复，已合并`);
      return;
    }
    seen.set(key, candidate);
    unique.push(candidate);
  });

  return unique;
};

const candidateSortKey = (candidate) =>
  [
    candidate.nodeType,
    candidate.connectionType,
    placementSetKey(candidate.placements),
  ].join("|");

const compareNodeCandidates = (left, right) => {
  const leftKey = candidateSortKey(left);
  const rightKey = candidateSortKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

const nodePlacementSetKey = (node) => placementSetKey(node.placements ?? []);

/**
 * 生成节点与边。
 *
 * @param {object} input
 * @param {object} input.features boundary_features FeatureCollection
 * @param {object|null} input.decisions network_connection_decisions
 * @param {object|null} input.previousNodes 上一版 network_nodes
 * @param {object|null} input.previousEdges 上一版 network_edges
 * @param {object} input.registry 注册表（会被深拷贝）
 * @param {string} input.effectiveDate 新实体 createdAt，YYYY-MM-DD
 */
export const buildNetwork = (input) => {
  const report = createReport();
  const section = "network_generator";
  const {
    features,
    decisions = null,
    previousNodes = null,
    previousEdges = null,
    placementRemap = null,
    registry,
    effectiveDate,
  } = input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate ?? "")) {
    report.error(section, "--effective-date 必须是 YYYY-MM-DD");
    return {
      nodes: { schemaVersion: NETWORK_FILE_SCHEMA_VERSION, nodes: [] },
      edges: { schemaVersion: NETWORK_FILE_SCHEMA_VERSION, edges: [] },
      registry: registry ?? null,
      report,
      allocations: { nodes: [], edges: [] },
    };
  }
  if (!registry || typeof registry !== "object" || !registry.counters) {
    report.error(section, "缺少注册表，无法分配 ID");
    return {
      nodes: { schemaVersion: NETWORK_FILE_SCHEMA_VERSION, nodes: [] },
      edges: { schemaVersion: NETWORK_FILE_SCHEMA_VERSION, edges: [] },
      registry: registry ?? null,
      report,
      allocations: { nodes: [], edges: [] },
    };
  }

  const remapIndex = new Map(
    (placementRemap?.placements ?? []).map((entry) => [
      `${entry.featureId}|${entry.partIndex}|${entry.oldVertexIndex}`,
      entry.newVertexIndex,
    ]),
  );
  const remapPlacement = (placement) => {
    const newVertexIndex = remapIndex.get(
      `${placement.featureId}|${placement.partIndex}|${placement.vertexIndex}`,
    );
    return newVertexIndex === undefined
      ? placement
      : { ...placement, vertexIndex: newVertexIndex };
  };
  const remappedDecisions = decisions
    ? {
        ...decisions,
        decisions: (decisions.decisions ?? []).map((decision) => ({
          ...decision,
          placements: (decision.placements ?? []).map(remapPlacement),
        })),
      }
    : decisions;
  const featureIndex = indexFeatures(features, report);
  const normalizedDecisions = validateConnectionDecisions({
    decisionsFile: remappedDecisions,
    featureIndex,
    registry,
    report,
  });

  const candidates = buildNodeCandidates(featureIndex, normalizedDecisions, report);
  const previousNodeList = (previousNodes?.nodes ?? []).map((node) => ({
    ...node,
    placements: (node.placements ?? []).map(remapPlacement),
  }));
  const previousEdgeList = (previousEdges?.edges ?? []).map((edge) => ({
    ...edge,
    fromVertexIndex:
      remapIndex.get(`${edge.featureId}|${edge.partIndex}|${edge.fromVertexIndex}`) ??
      edge.fromVertexIndex,
    toVertexIndex:
      remapIndex.get(`${edge.featureId}|${edge.partIndex}|${edge.toVertexIndex}`) ??
      edge.toVertexIndex,
  }));

  // 上一版 active 节点按 placement 集合建索引，仅用于稳定身份匹配
  const previousByPlacementSet = new Map();
  previousNodeList.forEach((node) => {
    if ((node.lifecycle ?? "active") !== "active") return;
    const key = nodePlacementSetKey(node);
    if (!previousByPlacementSet.has(key)) previousByPlacementSet.set(key, []);
    previousByPlacementSet.get(key).push(node);
  });

  const workingRegistry = structuredClone(registry);
  const reusedNodeIds = new Set();
  const activeNodes = [];

  const candidatesNeedingId = [];
  candidates.forEach((candidate) => {
    const key = placementSetKey(candidate.placements);
    const matches = previousByPlacementSet.get(key) ?? [];
    if (matches.length > 1) {
      report.error(
        section,
        `上一版存在多个节点使用相同 placement 集合 ${key}，无法确定复用哪个 nodeId`,
      );
      return;
    }
    if (matches.length === 1) {
      const previous = matches[0];
      reusedNodeIds.add(previous.nodeId);
      activeNodes.push({
        nodeId: previous.nodeId,
        nodeType: candidate.nodeType,
        connectionType: candidate.connectionType,
        label: candidate.label,
        placements: normalizePlacements(candidate.placements),
        derivationType: previous.derivationType ?? candidate.derivationType,
        verificationStatus: candidate.verificationStatus,
        lifecycle: "active",
        supersedes: [...(previous.supersedes ?? [])].sort(),
        supersededBy: [],
        createdAt: previous.createdAt,
        retiredAt: null,
      });
      return;
    }
    candidatesNeedingId.push(candidate);
  });

  candidatesNeedingId.sort(compareNodeCandidates);
  const newNodeIds = allocateIds(workingRegistry, "networkNode", candidatesNeedingId.length);
  candidatesNeedingId.forEach((candidate, index) => {
    activeNodes.push({
      nodeId: newNodeIds[index],
      nodeType: candidate.nodeType,
      connectionType: candidate.connectionType,
      label: candidate.label,
      placements: normalizePlacements(candidate.placements),
      derivationType: candidate.derivationType,
      verificationStatus: candidate.verificationStatus,
      lifecycle: "active",
      supersedes: [],
      supersededBy: [],
      createdAt: effectiveDate,
      retiredAt: null,
    });
  });

  newNodeIds.forEach((nodeId) => {
    addEntry(workingRegistry, {
      id: nodeId,
      entityType: "networkNode",
      createdAt: effectiveDate,
    });
  });

  // 退役上一版中未复用的节点，并按 placement 交集记录替代关系
  const activePlacementIndex = new Map();
  activeNodes.forEach((node) => {
    node.placements.forEach((placement) => {
      const key = placementKey(placement);
      if (!activePlacementIndex.has(key)) activePlacementIndex.set(key, new Set());
      activePlacementIndex.get(key).add(node.nodeId);
    });
  });

  const retiredNodes = [];
  const retiredNodeIds = [];
  previousNodeList.forEach((previous) => {
    if (reusedNodeIds.has(previous.nodeId)) return;
    if ((previous.lifecycle ?? "active") !== "active") {
      retiredNodes.push(previous);
      return;
    }
    const supersededBy = [
      ...new Set(
        (previous.placements ?? []).flatMap((placement) => [
          ...(activePlacementIndex.get(placementKey(placement)) ?? []),
        ]),
      ),
    ].sort();
    const retired = {
      ...structuredClone(previous),
      lifecycle: "retired",
      supersededBy,
      retiredAt: effectiveDate,
    };
    retiredNodes.push(retired);
    retiredNodeIds.push(previous.nodeId);
    retireEntry(workingRegistry, previous.nodeId, {
      retiredAt: effectiveDate,
      supersededBy,
    });
  });

  const nodeById = new Map(activeNodes.map((node) => [node.nodeId, node]));
  const nodeLocations = new Map();
  activeNodes.forEach((node) => {
    node.placements.forEach((placement) => {
      nodeLocations.set(`${node.nodeId}|${placementKey(placement)}`, placement);
    });
  });

  const placementToNode = new Map();
  activeNodes.forEach((node) => {
    if (node.lifecycle !== "active") return;
    node.placements.forEach((placement) => {
      if (!placementToNode.has(placementKey(placement))) {
        placementToNode.set(placementKey(placement), []);
      }
      placementToNode.get(placementKey(placement)).push(node);
    });
  });

  // 按 part 切边
  const edgeCandidates = [];
  featureIndex.forEach((feature) => {
    if (feature.lifecycle !== "active") return;
    feature.parts.forEach((part, partIndex) => {
      const cutNodes = [];
      activeNodes.forEach((node) => {
        if (node.connectionType !== "connected") return;
        if (node.lifecycle !== "active") return;
        node.placements.forEach((placement) => {
          if (placement.featureId !== feature.featureId) return;
          if (placement.partIndex !== partIndex) return;
          cutNodes.push({ node, vertexIndex: placement.vertexIndex });
        });
      });
      cutNodes.sort((left, right) => left.vertexIndex - right.vertexIndex);
      const deduped = [];
      cutNodes.forEach((item) => {
        if (deduped.length === 0 || deduped[deduped.length - 1].vertexIndex !== item.vertexIndex) {
          deduped.push(item);
        } else if (deduped[deduped.length - 1].node.nodeId !== item.node.nodeId) {
          report.error(
            section,
            `${feature.featureId} part ${partIndex} 顶点 ${item.vertexIndex} 上有两个 connected 节点`,
          );
        }
      });

      if (deduped.length < 2) {
        report.warn(
          section,
          `${feature.featureId} part ${partIndex} 只有 ${deduped.length} 个 connected 节点，未生成边`,
        );
        return;
      }

      for (let index = 0; index + 1 < deduped.length; index += 1) {
        const from = deduped[index];
        const to = deduped[index + 1];
        let lengthM = 0;
        for (let vertex = from.vertexIndex; vertex < to.vertexIndex; vertex += 1) {
          lengthM += approxMeters(part[vertex], part[vertex + 1]);
        }
        const fromNode = nodeById.get(from.node.nodeId);
        const toNode = nodeById.get(to.node.nodeId);
        edgeCandidates.push({
          featureId: feature.featureId,
          partIndex,
          fromNodeId: from.node.nodeId,
          toNodeId: to.node.nodeId,
          fromVertexIndex: from.vertexIndex,
          toVertexIndex: to.vertexIndex,
          lengthM: Math.round(lengthM * 10) / 10,
          boundaryEligible: feature.boundaryEligible,
          verificationStatus: lowestVerification([
            feature.verificationStatus,
            fromNode?.verificationStatus ?? "unreviewed",
            toNode?.verificationStatus ?? "unreviewed",
          ]),
        });
      }
    });
  });

  const edgeKey = (edge) =>
    `${edge.featureId}|${edge.partIndex}|${edge.fromNodeId}|${edge.toNodeId}`;
  const previousEdgeByKey = new Map();
  previousEdgeList.forEach((edge) => {
    if ((edge.lifecycle ?? "active") !== "active") return;
    if (!previousEdgeByKey.has(edgeKey(edge))) previousEdgeByKey.set(edgeKey(edge), edge);
  });

  const activeEdges = [];
  const edgesNeedingId = [];
  const reusedEdgeIds = new Set();
  edgeCandidates.forEach((candidate) => {
    const previous = previousEdgeByKey.get(edgeKey(candidate));
    if (previous) {
      reusedEdgeIds.add(previous.edgeId);
      activeEdges.push({
        edgeId: previous.edgeId,
        featureId: candidate.featureId,
        partIndex: candidate.partIndex,
        fromNodeId: candidate.fromNodeId,
        toNodeId: candidate.toNodeId,
        fromVertexIndex: candidate.fromVertexIndex,
        toVertexIndex: candidate.toVertexIndex,
        lengthM: candidate.lengthM,
        boundaryEligible: candidate.boundaryEligible,
        verificationStatus: candidate.verificationStatus,
        lifecycle: "active",
        supersedes: [...(previous.supersedes ?? [])].sort(),
        supersededBy: [],
        createdAt: previous.createdAt,
        retiredAt: null,
      });
      return;
    }
    edgesNeedingId.push(candidate);
  });

  const compareEdgeCandidates = (left, right) => {
    const leftKey = [
      left.featureId,
      String(left.partIndex).padStart(4, "0"),
      String(left.fromVertexIndex).padStart(6, "0"),
      String(left.toVertexIndex).padStart(6, "0"),
      left.fromNodeId,
      left.toNodeId,
    ].join("|");
    const rightKey = [
      right.featureId,
      String(right.partIndex).padStart(4, "0"),
      String(right.fromVertexIndex).padStart(6, "0"),
      String(right.toVertexIndex).padStart(6, "0"),
      right.fromNodeId,
      right.toNodeId,
    ].join("|");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };

  edgesNeedingId.sort(compareEdgeCandidates);
  const newEdgeIds = allocateIds(workingRegistry, "networkEdge", edgesNeedingId.length);
  edgesNeedingId.forEach((candidate, index) => {
    activeEdges.push({
      edgeId: newEdgeIds[index],
      featureId: candidate.featureId,
      partIndex: candidate.partIndex,
      fromNodeId: candidate.fromNodeId,
      toNodeId: candidate.toNodeId,
      fromVertexIndex: candidate.fromVertexIndex,
      toVertexIndex: candidate.toVertexIndex,
      lengthM: candidate.lengthM,
      boundaryEligible: candidate.boundaryEligible,
      verificationStatus: candidate.verificationStatus,
      lifecycle: "active",
      supersedes: [],
      supersededBy: [],
      createdAt: effectiveDate,
      retiredAt: null,
    });
  });

  newEdgeIds.forEach((edgeId) => {
    addEntry(workingRegistry, {
      id: edgeId,
      entityType: "networkEdge",
      createdAt: effectiveDate,
    });
  });

  // 退役上一版中不再匹配的边；按“旧跨度包含新边跨度”记录替代
  const retiredEdges = [];
  const retiredEdgeIds = [];
  const newSupersedes = new Map();
  previousEdgeList.forEach((previous) => {
    if (reusedEdgeIds.has(previous.edgeId)) return;
    if ((previous.lifecycle ?? "active") !== "active") {
      retiredEdges.push(previous);
      return;
    }
    const replacements = activeEdges
      .filter((edge) => {
        if (edge.featureId !== previous.featureId) return false;
        if (edge.partIndex !== previous.partIndex) return false;
        const newInsideOld =
          edge.fromVertexIndex >= previous.fromVertexIndex &&
          edge.toVertexIndex <= previous.toVertexIndex &&
          (edge.fromVertexIndex > previous.fromVertexIndex ||
            edge.toVertexIndex < previous.toVertexIndex);
        const oldInsideNew =
          edge.fromVertexIndex <= previous.fromVertexIndex &&
          edge.toVertexIndex >= previous.toVertexIndex &&
          (edge.fromVertexIndex < previous.fromVertexIndex ||
            edge.toVertexIndex > previous.toVertexIndex);
        return newInsideOld || oldInsideNew;
      })
      .map((edge) => edge.edgeId)
      .sort();
    replacements.forEach((edgeId) => {
      const set = newSupersedes.get(edgeId) ?? new Set();
      set.add(previous.edgeId);
      newSupersedes.set(edgeId, set);
    });
    retiredEdges.push({
      ...structuredClone(previous),
      lifecycle: "retired",
      supersededBy: replacements,
      retiredAt: effectiveDate,
    });
    retiredEdgeIds.push(previous.edgeId);
    retireEntry(workingRegistry, previous.edgeId, {
      retiredAt: effectiveDate,
      supersededBy: replacements,
    });
  });

  activeEdges.forEach((edge) => {
    const supersedes = [...(newSupersedes.get(edge.edgeId) ?? [])].sort();
    if (supersedes.length > 0) {
      edge.supersedes = [...new Set([...edge.supersedes, ...supersedes])].sort();
    }
  });

  const nodesOutput = [...activeNodes, ...retiredNodes].sort((left, right) =>
    left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0,
  );
  const edgesOutput = [...activeEdges, ...retiredEdges].sort((left, right) =>
    left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0,
  );

  validateGeneratedNetwork({ nodes: nodesOutput, edges: edgesOutput, registry: workingRegistry, featureIndex }, report);

  return {
    nodes: { schemaVersion: NETWORK_FILE_SCHEMA_VERSION, nodes: nodesOutput },
    edges: { schemaVersion: NETWORK_FILE_SCHEMA_VERSION, edges: edgesOutput },
    registry: workingRegistry,
    report,
    allocations: {
      nodes: newNodeIds,
      edges: newEdgeIds,
      reusedNodes: [...reusedNodeIds].sort(),
      reusedEdges: [...reusedEdgeIds].sort(),
      retiredNodes: [...retiredNodeIds].sort(),
      retiredEdges: [...retiredEdgeIds].sort(),
    },
  };
};

/** 写入前门禁：与 validate-network 使用同一套契约规则 */
export const validateGeneratedNetwork = ({ nodes, edges, registry, featureIndex }, report) => {
  const section = "network_gate";
  const nodeList = nodes ?? [];
  const edgeList = edges ?? [];
  const nodeById = new Map();
  const edgeIds = new Set();
  const nodeIds = new Set();

  const registered = new Map(
    (registry?.entries ?? []).map((entry) => [entry.id, entry]),
  );

  nodeList.forEach((node) => {
    if (!isId("networkNode", node.nodeId)) {
      report.error(section, `节点 ID 非法: ${JSON.stringify(node.nodeId)}`);
      return;
    }
    if (nodeIds.has(node.nodeId)) report.error(section, `节点 ID 重复: ${node.nodeId}`);
    nodeIds.add(node.nodeId);
    nodeById.set(node.nodeId, node);
    if (!registered.has(node.nodeId)) {
      report.error(section, `节点 ${node.nodeId} 未在注册表登记`);
    }

    if (!Array.isArray(node.placements) || node.placements.length === 0) {
      report.error(section, `节点 ${node.nodeId} 缺少 placements`);
      return;
    }
    const coordinates = [];
    const featureIds = new Set();
    node.placements.forEach((placement) => {
      const feature = featureIndex?.get(placement.featureId);
      if (!feature) {
        report.error(section, `${node.nodeId} 引用了不存在的要素 ${placement.featureId}`);
        return;
      }
      if ((feature.props.lifecycle ?? "active") !== "active") {
        report.error(section, `${node.nodeId} 引用了非 active 要素 ${placement.featureId}`);
      }
      const part = feature.parts[placement.partIndex];
      if (!part || !part[placement.vertexIndex]) {
        report.error(
          section,
          `${node.nodeId} placement ${placementKey(placement)} 超出要素范围`,
        );
        return;
      }
      featureIds.add(placement.featureId);
      coordinates.push(part[placement.vertexIndex]);
    });
    if (node.connectionType === "connected" && coordinates.length > 0) {
      const base = coordinates[0];
      if (!coordinates.every((coordinate) => sameCoordinate(coordinate, base))) {
        report.error(section, `connected 节点 ${node.nodeId} 的 placement 不完全共点`);
      }
    }
    if (node.nodeType === "intersection" && featureIds.size < 2) {
      report.error(section, `intersection 节点 ${node.nodeId} 少于两个不同要素`);
    }
  });

  edgeList.forEach((edge) => {
    if (!isId("networkEdge", edge.edgeId)) {
      report.error(section, `边 ID 非法: ${JSON.stringify(edge.edgeId)}`);
      return;
    }
    if (edgeIds.has(edge.edgeId)) report.error(section, `边 ID 重复: ${edge.edgeId}`);
    edgeIds.add(edge.edgeId);
    if (!registered.has(edge.edgeId)) {
      report.error(section, `边 ${edge.edgeId} 未在注册表登记`);
    }
    if (edge.lifecycle !== "active") return;
    const feature = featureIndex?.get(edge.featureId);
    if (!feature) {
      report.error(section, `${edge.edgeId} 引用了不存在的要素 ${edge.featureId}`);
      return;
    }
    const part = feature.parts[edge.partIndex];
    if (!part) {
      report.error(section, `${edge.edgeId} partIndex ${edge.partIndex} 超出范围`);
      return;
    }
    const fromNode = nodeById.get(edge.fromNodeId);
    const toNode = nodeById.get(edge.toNodeId);
    if (!fromNode || !toNode) {
      report.error(section, `${edge.edgeId} 引用了不存在的节点`);
      return;
    }
    if (edge.fromNodeId === edge.toNodeId) {
      report.error(section, `${edge.edgeId} 起止节点相同`);
    }
    if (!(edge.fromVertexIndex < edge.toVertexIndex)) {
      report.error(section, `${edge.edgeId} 未满足 fromVertexIndex < toVertexIndex`);
    }
    if (!part[edge.toVertexIndex]) {
      report.error(section, `${edge.edgeId} toVertexIndex 超出范围`);
      return;
    }
    const fromMatches = fromNode.placements.some(
      (placement) =>
        placement.featureId === edge.featureId &&
        placement.partIndex === edge.partIndex &&
        placement.vertexIndex === edge.fromVertexIndex,
    );
    const toMatches = toNode.placements.some(
      (placement) =>
        placement.featureId === edge.featureId &&
        placement.partIndex === edge.partIndex &&
        placement.vertexIndex === edge.toVertexIndex,
    );
    if (!fromMatches) {
      report.error(section, `${edge.edgeId} fromNode 与 fromVertexIndex 不一致`);
    }
    if (!toMatches) {
      report.error(section, `${edge.edgeId} toNode 与 toVertexIndex 不一致`);
    }

    let lengthM = 0;
    for (let vertex = edge.fromVertexIndex; vertex < edge.toVertexIndex; vertex += 1) {
      lengthM += approxMeters(part[vertex], part[vertex + 1]);
    }
    if (Math.abs(Math.round(lengthM * 10) / 10 - edge.lengthM) > 0.1) {
      report.error(section, `${edge.edgeId} lengthM 与坐标重算不一致`);
    }

    nodeList.forEach((node) => {
      if (node.lifecycle !== "active" || node.connectionType !== "connected") return;
      node.placements.forEach((placement) => {
        if (placement.featureId !== edge.featureId) return;
        if (placement.partIndex !== edge.partIndex) return;
        if (
          placement.vertexIndex > edge.fromVertexIndex &&
          placement.vertexIndex < edge.toVertexIndex
        ) {
          report.error(
            section,
            `${edge.edgeId} 内部存在未切分的 connected 节点 ${node.nodeId}`,
          );
        }
      });
    });
  });

  // 每个 active part 必须被 active 边完整覆盖
  featureIndex?.forEach((feature) => {
    if ((feature.props.lifecycle ?? "active") !== "active") return;
    feature.parts.forEach((part, partIndex) => {
      const partEdges = edgeList
        .filter(
          (edge) =>
            edge.lifecycle === "active" &&
            edge.featureId === feature.featureId &&
            edge.partIndex === partIndex,
        )
        .sort((left, right) => left.fromVertexIndex - right.fromVertexIndex);
      if (partEdges.length === 0) {
        report.error(section, `${feature.featureId} part ${partIndex} 没有任何 active 边`);
        return;
      }
      if (partEdges[0].fromVertexIndex !== 0) {
        report.error(section, `${feature.featureId} part ${partIndex} 起点未被边覆盖`);
      }
      if (partEdges[partEdges.length - 1].toVertexIndex !== part.length - 1) {
        report.error(section, `${feature.featureId} part ${partIndex} 终点未被边覆盖`);
      }
      for (let index = 1; index < partEdges.length; index += 1) {
        if (partEdges[index].fromVertexIndex !== partEdges[index - 1].toVertexIndex) {
          report.error(
            section,
            `${feature.featureId} part ${partIndex} 边 ${partEdges[index - 1].edgeId} 与 ${partEdges[index].edgeId} 之间存在遗漏或重叠`,
          );
        }
      }
    });
  });

  // lifecycle 与 supersedes/supersededBy 双向一致
  const allEntries = [...nodeList, ...edgeList];
  const byId = new Map(allEntries.map((entry) => [entry.nodeId ?? entry.edgeId, entry]));
  allEntries.forEach((entry) => {
    (entry.supersedes ?? []).forEach((oldId) => {
      const old = byId.get(oldId);
      if (!old) {
        report.warn(section, `${entry.nodeId ?? entry.edgeId} 的 supersedes 引用了不在本次输出中的 ${oldId}`);
        return;
      }
      if (!(old.supersededBy ?? []).includes(entry.nodeId ?? entry.edgeId)) {
        report.error(
          section,
          `${entry.nodeId ?? entry.edgeId} supersedes ${oldId}，但 ${oldId}.supersededBy 未回指`,
        );
      }
    });
    if (entry.lifecycle === "active" && (entry.supersededBy ?? []).length > 0) {
      report.error(section, `${entry.nodeId ?? entry.edgeId} 为 active 但存在 supersededBy`);
    }
  });

  if (registry?.counters) {
    Object.entries(registry.counters).forEach(([entityType, counter]) => {
      const maxFromEntries = (registry.entries ?? []).reduce((max, entry) => {
        if (entityType === "networkNode" && entry.entityType === "networkNode") {
          return Math.max(max, Number(entry.id.slice(3)));
        }
        if (entityType === "networkEdge" && entry.entityType === "networkEdge") {
          return Math.max(max, Number(entry.id.slice(3)));
        }
        if (entityType === "boundaryFeature" && entry.entityType === "boundaryFeature") {
          return Math.max(max, Number(entry.id.slice(3)));
        }
        if (entityType === "zoneRing" && entry.entityType === "zoneRing") {
          return Math.max(max, Number(entry.id.slice(3)));
        }
        if (entityType === "zoneStep" && entry.entityType === "zoneStep") {
          return Math.max(max, Number(entry.id.slice(3)));
        }
        if (entityType === "boundaryRuling" && entry.entityType === "boundaryRuling") {
          return Math.max(max, Number(entry.id.slice(3)));
        }
        return max;
      }, 0);
      if (counter !== maxFromEntries) {
        report.error(
          section,
          `注册表 ${entityType} 计数器 ${counter} 不等于登记最大序号 ${maxFromEntries}`,
        );
      }
    });
  }
};
