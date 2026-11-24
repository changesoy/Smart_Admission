/**
 * draft-core.mjs - 学区草稿的纯逻辑：边可用性、图搜索、共边复用、编辑与确定性序列化
 *
 * 契约：docs/planning/草稿字段冻结清单.md
 *       docs/planning/地图点选式学区边界工具实施方案.md 2.2–3.5
 *
 * 本模块不读文件、不访问 DOM、不使用 Node API，浏览器与 Node 测试共用。
 * 所有选择只产生 edgeRefs，任何函数都不产生经纬度字段。
 */

/** 草稿结构版本（与 zone-draft-schema.mjs 保持一致） */
export const DRAFT_SCHEMA_VERSION = 1;

const clone = (value) => JSON.parse(JSON.stringify(value));

const collectStepTexts = (zoneSpec) => {
  const map = {};
  (zoneSpec?.rings ?? []).forEach((ring) =>
    (ring.steps ?? []).forEach((step) => {
      map[step.stepId] = step.text ?? "";
    }),
  );
  return map;
};

/** 判断边能否被学区引用，返回 {selectable, reason} */
export const edgeAvailability = (edge, nodeMap) => {
  if (!edge) return { selectable: false, reason: "边不存在" };
  if (edge.lifecycle !== "active") {
    return { selectable: false, reason: `边已${edge.lifecycle === "retired" ? "退役" : "停用"}` };
  }
  if (edge.boundaryEligible !== true) {
    return { selectable: false, reason: "所属要素不可作为学区边界" };
  }
  for (const nodeId of [edge.fromNodeId, edge.toNodeId]) {
    const node = nodeMap.get(nodeId);
    if (!node) return { selectable: false, reason: `端点节点 ${nodeId} 缺失` };
    if (node.lifecycle && node.lifecycle !== "active") {
      return { selectable: false, reason: `端点节点 ${nodeId} 已退役` };
    }
    if (node.connectionType && node.connectionType !== "connected") {
      return {
        selectable: false,
        reason: `端点节点 ${nodeId} 不可通行（${node.connectionType}）`,
      };
    }
  }
  return { selectable: true, reason: null };
};

export const nodeMapOf = (nodes) =>
  new Map((nodes ?? []).map((node) => [node.nodeId, node]));

export const edgeMapOf = (edges) =>
  new Map((edges ?? []).map((edge) => [edge.edgeId, edge]));

/** 边的规范方向端点 */
export const edgeEndpoints = (edge, direction) => {
  if (direction === "reverse") {
    return { startNodeId: edge.toNodeId, endNodeId: edge.fromNodeId };
  }
  return { startNodeId: edge.fromNodeId, endNodeId: edge.toNodeId };
};

/**
 * 建立边占用索引：edgeId → [{zoneId, ringId, ringRole, stepId, direction}]
 * 只读取正式 zone_specs 的步骤 edgeRefs，不推断业务含义。
 */
export const buildUsageIndex = (zoneSpecs) => {
  const index = new Map();
  (zoneSpecs?.zones ?? []).forEach((zone) => {
    (zone.rings ?? []).forEach((ring) => {
      (ring.steps ?? []).forEach((step) => {
        (step.edgeRefs ?? []).forEach((ref) => {
          if (!ref?.edgeId) return;
          if (!index.has(ref.edgeId)) index.set(ref.edgeId, []);
          index.get(ref.edgeId).push({
            zoneId: zone.zoneId,
            zoneName: zone.zoneName ?? zone.zoneId,
            ringId: ring.ringId,
            ringRole: ring.role,
            stepId: step.stepId,
            direction: ref.direction,
          });
        });
      });
    });
  });
  index.forEach((list) =>
    list.sort((left, right) =>
      `${left.zoneId}|${left.ringId}|${left.stepId}` <
      `${right.zoneId}|${right.ringId}|${right.stepId}`
        ? -1
        : 1,
    ),
  );
  return index;
};

const compareEdge = (left, right) =>
  left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0;

/**
 * 枚举两个节点之间的全部简单路径（按 edgeId 字典序确定性输出）。
 * 零条、一条、多条都原样返回，绝不自动选择。
 *
 * @returns {{paths: Array, truncated: boolean, reason: string|null}}
 */
export const findCandidatePaths = ({
  fromNodeId,
  toNodeId,
  edges,
  nodes,
  maxPaths = 20,
  maxDepth = 64,
}) => {
  const nodeMap = nodeMapOf(nodes);
  const usable = [];
  (edges ?? []).forEach((edge) => {
    if (edgeAvailability(edge, nodeMap).selectable) usable.push(edge);
  });
  usable.sort(compareEdge);
  const usableMap = edgeMapOf(usable);

  const adjacency = new Map();
  usable.forEach((edge) => {
    const push = (from, to, direction) => {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from).push({ edge, toNodeId: to, direction });
    };
    push(edge.fromNodeId, edge.toNodeId, "forward");
    push(edge.toNodeId, edge.fromNodeId, "reverse");
  });
  adjacency.forEach((list) =>
    list.sort((left, right) =>
      left.edge.edgeId === right.edge.edgeId
        ? 0
        : left.edge.edgeId < right.edge.edgeId
          ? -1
          : 1,
    ),
  );

  if (!nodeMap.has(fromNodeId) || !nodeMap.has(toNodeId)) {
    return { paths: [], truncated: false, reason: "起点或终点节点不存在" };
  }
  if (fromNodeId === toNodeId) {
    return { paths: [], truncated: false, reason: "起点与终点相同，不构成路径" };
  }

  const paths = [];
  let truncated = false;

  const walk = (currentNodeId, visited, refs) => {
    if (truncated) return;
    if (refs.length > maxDepth) {
      truncated = true;
      return;
    }
    if (currentNodeId === toNodeId) {
      if (refs.length > 0) {
        const lengthM = refs.reduce(
          (sum, ref) => sum + (usableMap.get(ref.edgeId)?.lengthM ?? 0),
          0,
        );
        paths.push({
          edgeRefs: refs.map((ref) => ({ ...ref })),
          nodeIds: [fromNodeId, ...refs.map((ref) => ref.endNodeId)],
          lengthM: Math.round(lengthM * 10) / 10,
          featureIds: [...new Set(refs.map((ref) => usableMap.get(ref.edgeId)?.featureId))],
        });
        if (paths.length >= maxPaths) truncated = true;
      }
      return;
    }

    const nextEdges = adjacency.get(currentNodeId) ?? [];
    for (const { edge, toNodeId: nextNodeId, direction } of nextEdges) {
      if (visited.has(nextNodeId)) continue;
      visited.add(nextNodeId);
      refs.push({ edgeId: edge.edgeId, direction, endNodeId: nextNodeId });
      walk(nextNodeId, visited, refs);
      refs.pop();
      visited.delete(nextNodeId);
      if (truncated) return;
    }
  };

  walk(fromNodeId, new Set([fromNodeId]), []);

  const pathsSorted = paths.sort((left, right) =>
    left.edgeRefs.map((ref) => ref.edgeId).join("|") <
    right.edgeRefs.map((ref) => ref.edgeId).join("|")
      ? -1
      : 1,
  );

  return {
    paths: pathsSorted,
    truncated,
    reason: pathsSorted.length === 0 ? "无符合条件的通路" : null,
  };
};

/** 把正式学区中已绑定的连续边整理成可复用链 */
export const buildZoneEdgeChains = (zoneSpecs, edges) => {
  const edgeMap = edgeMapOf(edges);
  const chains = [];
  (zoneSpecs?.zones ?? []).forEach((zone) => {
    (zone.rings ?? []).forEach((ring) => {
      const refs = [];
      (ring.steps ?? []).forEach((step) => {
        (step.edgeRefs ?? []).forEach((ref) => {
          if (edgeMap.has(ref.edgeId)) refs.push({ ...ref, stepId: step.stepId });
        });
      });
      if (refs.length === 0) return;

      let lengthM = 0;
      let contiguous = true;
      let previousEnd = null;
      const nodeIds = [];
      refs.forEach((ref, index) => {
        const edge = edgeMap.get(ref.edgeId);
        const { startNodeId, endNodeId } = edgeEndpoints(edge, ref.direction);
        if (index === 0) nodeIds.push(startNodeId);
        else if (previousEnd !== startNodeId) contiguous = false;
        nodeIds.push(endNodeId);
        previousEnd = endNodeId;
        lengthM += edge.lengthM ?? 0;
      });
      chains.push({
        zoneId: zone.zoneId,
        zoneName: zone.zoneName ?? zone.zoneId,
        ringId: ring.ringId,
        ringRole: ring.role,
        contiguous,
        refs,
        nodeIds,
        lengthM: Math.round(lengthM * 10) / 10,
      });
    });
  });
  return chains.sort((left, right) =>
    `${left.zoneId}|${left.ringId}` < `${right.zoneId}|${right.ringId}` ? -1 : 1,
  );
};

/**
 * 候选共边复用链：其他学区已用过的连续边。
 * atNodeId 给定时只返回经过该节点的链，方便“从当前终点继续”。
 */
export const findReuseOptions = ({
  zoneSpecs,
  edges,
  excludeZoneId = null,
  atNodeId = null,
}) =>
  buildZoneEdgeChains(zoneSpecs, edges).filter((chain) => {
    if (!chain.contiguous) return false;
    if (excludeZoneId && chain.zoneId === excludeZoneId) return false;
    if (atNodeId && !chain.nodeIds.includes(atNodeId)) return false;
    return true;
  });

/** 展开 edgeRefs 为坐标序列；reverse 时倒序，接缝去重 */
export const expandRefsToCoordinates = (refs, edges, featureMap) => {
  const edgeMap = edgeMapOf(edges);
  const coordinates = [];
  refs.forEach((ref) => {
    const edge = edgeMap.get(ref.edgeId);
    if (!edge) return;
    const feature = featureMap.get(edge.featureId);
    const geometry = feature?.geometry ?? feature;
    const parts =
      geometry?.type === "LineString"
        ? [geometry.coordinates]
        : geometry?.type === "MultiLineString"
          ? geometry.coordinates
          : [];
    const part = parts[edge.partIndex];
    if (!part) return;
    let segment = part.slice(edge.fromVertexIndex, edge.toVertexIndex + 1);
    if (ref.direction === "reverse") segment = [...segment].reverse();
    segment.forEach((coordinate, index) => {
      if (coordinates.length > 0 && index === 0) {
        const last = coordinates[coordinates.length - 1];
        if (last[0] === coordinate[0] && last[1] === coordinate[1]) return;
      }
      coordinates.push([coordinate[0], coordinate[1]]);
    });
  });
  return coordinates;
};

/** 环几何指标：顶点数、bbox、面积、质心、方向 */
export const ringMetrics = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    return {
      vertexCount: coordinates?.length ?? 0,
      bbox: null,
      areaM2: 0,
      centroid: null,
      orientation: null,
    };
  }
  const lngs = coordinates.map((coordinate) => coordinate[0]);
  const lats = coordinates.map((coordinate) => coordinate[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const metersPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const metersPerLat = 110540;
  const originLng = lngs[0];
  const originLat = lats[0];
  const points = coordinates.map(([lng, lat]) => [
    (lng - originLng) * metersPerLng,
    (lat - originLat) * metersPerLat,
  ]);

  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    centroidX += (x1 + x2) * cross;
    centroidY += (y1 + y2) * cross;
  }
  const areaM2 = Math.abs(twiceArea / 2);
  const centroid =
    twiceArea === 0
      ? null
      : [
          Math.round((originLng + centroidX / (3 * twiceArea) / metersPerLng) * 1e7) / 1e7,
          Math.round((originLat + centroidY / (3 * twiceArea) / metersPerLat) * 1e7) / 1e7,
        ];

  return {
    vertexCount: coordinates.length,
    bbox: [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ],
    areaM2: Math.round(areaM2),
    centroid,
    orientation: twiceArea > 0 ? "ccw" : "cw",
  };
};

const centroidDistance = (left, right) => {
  if (!left || !right) return null;
  const lat = ((left[1] + right[1]) / 2) * (Math.PI / 180);
  const dx = (left[0] - right[0]) * 111320 * Math.cos(lat);
  const dy = (left[1] - right[1]) * 110540;
  return Math.round(Math.hypot(dx, dy));
};

const orientation = (a, b, c) => {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : -1;
};

const onSegment = (a, b, c) =>
  Math.min(a[0], b[0]) <= c[0] &&
  c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] &&
  c[1] <= Math.max(a[1], b[1]);

const segmentsIntersect = (p1, p2, p3, p4) => {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
};

/**
 * 检查派生环自交（含闭合段）；相邻段共享端点不算自交。
 * 返回 [{ segmentA, segmentB }]，为空表示无自交。
 */
export const findSelfIntersections = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return [];
  const points =
    coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
    coordinates[0][1] === coordinates[coordinates.length - 1][1]
      ? coordinates.slice(0, -1)
      : coordinates;
  if (points.length < 3) return [];
  const segments = points.map((point, index) => [
    point,
    points[(index + 1) % points.length],
  ]);
  const hits = [];
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const adjacent =
        right === left + 1 || (left === 0 && right === segments.length - 1);
      if (adjacent) continue;
      if (segmentsIntersect(segments[left][0], segments[left][1], segments[right][0], segments[right][1])) {
        hits.push({ segmentA: left, segmentB: right });
      }
    }
  }
  return hits;
};
/** 新旧环指标差异 */
export const diffRingMetrics = (derived, existing) => ({
  areaM2Delta: (derived?.areaM2 ?? 0) - (existing?.areaM2 ?? 0),
  areaRatio:
    existing?.areaM2 > 0
      ? Math.round(((derived?.areaM2 ?? 0) / existing.areaM2) * 1000) / 1000
      : null,
  vertexCountDelta: (derived?.vertexCount ?? 0) - (existing?.vertexCount ?? 0),
  centroidDistanceM: centroidDistance(derived?.centroid, existing?.centroid),
  bboxDelta: {
    minLng:
      Math.round(((derived?.bbox?.[0] ?? 0) - (existing?.bbox?.[0] ?? 0)) * 1e7) / 1e7,
    minLat:
      Math.round(((derived?.bbox?.[1] ?? 0) - (existing?.bbox?.[1] ?? 0)) * 1e7) / 1e7,
    maxLng:
      Math.round(((derived?.bbox?.[2] ?? 0) - (existing?.bbox?.[2] ?? 0)) * 1e7) / 1e7,
    maxLat:
      Math.round(((derived?.bbox?.[3] ?? 0) - (existing?.bbox?.[3] ?? 0)) * 1e7) / 1e7,
  },
});

/** 创建 empty 环结构（沿用正式 ring 与步骤顺序） */
export const ringsFromZoneSpec = (zoneSpec) => {
  const formalOuter = (zoneSpec?.rings ?? []).find((ring) => ring.role === "outer");
  return (zoneSpec?.rings ?? []).map((ring) => ({
    role: ring.role,
    appliesToRingId: ring.role === "hole" ? formalOuter?.ringId ?? null : null,
    steps: (ring.steps ?? []).map((step) => ({ stepId: step.stepId, edgeRefs: [] })),
  }));
};

export const createDraftId = ({ zoneId, date, sequence }) =>
  `draft_${zoneId}_${date.replace(/-/g, "")}_${String(sequence).padStart(2, "0")}`;

/** 同区同日下一个草稿序号 */
export const nextDraftSequence = (draftIds, { zoneId, date }) => {
  const prefix = createDraftId({ zoneId, date, sequence: 0 }).slice(0, -2);
  const used = (draftIds ?? [])
    .filter((id) => typeof id === "string" && id.startsWith(prefix))
    .map((id) => Number(id.slice(-2)))
    .filter((value) => Number.isInteger(value));
  return (used.length > 0 ? Math.max(...used) : 0) + 1;
};

/** 编辑器初始状态：可新建，也可从已有草稿恢复 */
export const createEditorState = ({
  zoneSpec,
  draft = null,
  draftId = null,
  createdBy = "用户",
  date = null,
}) => {
  const today = date ?? new Date().toISOString().slice(0, 10);
  if (draft) {
    return {
      zoneId: draft.zoneId,
      boundaryText: draft.boundaryText,
      draftId: draft.draftId,
      schemaVersion: DRAFT_SCHEMA_VERSION,
      status: draft.status,
      createdBy: draft.createdBy,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      rejectReason: draft.rejectReason ?? null,
      rings: clone(draft.rings ?? []),
      operations: clone(draft.operations ?? []),
      stepTexts: collectStepTexts(zoneSpec),
      undoStack: [],
      redoStack: [],
    };
  }
  if (!zoneSpec) throw new Error("创建编辑器状态需要 zoneSpec 或已有草稿");
  return {
    zoneId: zoneSpec.zoneId,
    boundaryText: zoneSpec.boundaryText,
    draftId: draftId ?? createDraftId({ zoneId: zoneSpec.zoneId, date: today, sequence: 1 }),
    schemaVersion: DRAFT_SCHEMA_VERSION,
    status: "editing",
    createdBy,
    createdAt: today,
    updatedAt: today,
    rejectReason: null,
    rings: ringsFromZoneSpec(zoneSpec),
    operations: [],
    stepTexts: collectStepTexts(zoneSpec),
    undoStack: [],
    redoStack: [],
  };
};

const ringOf = (state, ringIndex) => state.rings[ringIndex] ?? null;

const stepOf = (ring, stepId) => (ring?.steps ?? []).find((step) => step.stepId === stepId) ?? null;

/** 环内已绑定边的有序展开（按步骤顺序） */
export const flattenRingRefs = (ring) =>
  (ring?.steps ?? []).flatMap((step) => (step.edgeRefs ?? []).map((ref) => ({ ...ref })));

/** 环的最后一条已绑定边终点 */
const lastEndNode = (edgeMap, ring) => {
  const refs = flattenRingRefs(ring);
  if (refs.length === 0) return null;
  const edge = edgeMap.get(refs[refs.length - 1].edgeId);
  if (!edge) return null;
  return edgeEndpoints(edge, refs[refs.length - 1].direction).endNodeId;
};

const pushOperation = (state, operation) => {
  state.operations.push(operation);
};

const recordMutation = (state, operation, previousRings) => {
  state.undoStack.push({ operation, previousRings });
  state.redoStack = [];
  state.updatedAt = operation.decidedAt;
  pushOperation(state, operation);
};

const textOfStep = (state, stepId) => state.stepTexts?.[stepId] ?? "";

const makeOperation = ({ type, stepId, edgeId, decidedBy, decidedAt, textRef }) => {
  const operation = { type, stepId, edgeId, decidedBy, decidedAt };
  if (textRef !== undefined) operation.textRef = textRef;
  return operation;
};

/**
 * 选择一条边：
 * - 只接受 active、boundaryEligible、两端 connected 的边；
 * - 方向由上一条已绑定边的终点自动判定，无法衔接时显式返回错误；
 * - 同一环内禁止重复引用。
 */
export const selectEdge = (state, { edges, nodes }, options) => {
  const { ringIndex, stepId, edgeId, decidedBy = state.createdBy, decidedAt = state.updatedAt } =
    options;
  const ring = ringOf(state, ringIndex);
  if (!ring) return { ok: false, error: "环不存在" };
  const step = stepOf(ring, stepId);
  if (!step) return { ok: false, error: `步骤 ${stepId} 不存在于该环` };

  const edgeMap = edgeMapOf(edges);
  const nodeMap = nodeMapOf(nodes);
  const edge = edgeMap.get(edgeId);
  const availability = edgeAvailability(edge, nodeMap);
  if (!availability.selectable) return { ok: false, error: availability.reason };

  const duplicates = flattenRingRefs(ring).some((ref) => ref.edgeId === edgeId);
  if (duplicates) return { ok: false, error: `边 ${edgeId} 已在该环中使用` };

  let expectedStart = null;
  if ((step.edgeRefs ?? []).length > 0) {
    expectedStart = lastEndNode(edgeMap, { steps: [step] });
  } else {
    const stepIndex = ring.steps.indexOf(step);
    expectedStart = lastEndNode(edgeMap, { steps: ring.steps.slice(0, stepIndex) });
  }

  let direction = "forward";
  if (expectedStart) {
    if (edge.fromNodeId === expectedStart) direction = "forward";
    else if (edge.toNodeId === expectedStart) direction = "reverse";
    else {
      return {
        ok: false,
        error: `断链：${edgeId} 的端点为 ${edge.fromNodeId}/${edge.toNodeId}，当前终点是 ${expectedStart}`,
      };
    }
  }

  const previousRings = clone(state.rings);
  step.edgeRefs.push({ edgeId, direction });
  recordMutation(
    state,
    makeOperation({
      type: "selectEdge",
      stepId,
      edgeId,
      decidedBy,
      decidedAt,
      textRef: textOfStep(state, stepId),
    }),
    previousRings,
  );
  return { ok: true, direction };
};

export const unselectEdge = (state, options) => {
  const {
    ringIndex,
    stepId,
    edgeId,
    decidedBy = state.createdBy,
    decidedAt = state.updatedAt,
  } = options;
  const ring = ringOf(state, ringIndex);
  const step = stepOf(ring, stepId);
  if (!step) return { ok: false, error: `步骤 ${stepId} 不存在于该环` };
  const index = (step.edgeRefs ?? []).findIndex((ref) => ref.edgeId === edgeId);
  if (index < 0) return { ok: false, error: `边 ${edgeId} 不在该步骤中` };

  const previousRings = clone(state.rings);
  step.edgeRefs.splice(index, 1);
  recordMutation(
    state,
    makeOperation({
      type: "unselectEdge",
      stepId,
      edgeId,
      decidedBy,
      decidedAt,
      textRef: textOfStep(state, stepId),
    }),
    previousRings,
  );
  return { ok: true };
};

export const reverseEdge = (state, options) => {
  const {
    ringIndex,
    stepId,
    edgeId,
    decidedBy = state.createdBy,
    decidedAt = state.updatedAt,
  } = options;
  const ring = ringOf(state, ringIndex);
  const step = stepOf(ring, stepId);
  if (!step) return { ok: false, error: `步骤 ${stepId} 不存在于该环` };
  const ref = (step.edgeRefs ?? []).find((item) => item.edgeId === edgeId);
  if (!ref) return { ok: false, error: `边 ${edgeId} 不在该步骤中` };

  const previousRings = clone(state.rings);
  ref.direction = ref.direction === "forward" ? "reverse" : "forward";
  recordMutation(
    state,
    makeOperation({
      type: "reverseEdge",
      stepId,
      edgeId,
      decidedBy,
      decidedAt,
      textRef: textOfStep(state, stepId),
    }),
    previousRings,
  );
  return { ok: true, direction: ref.direction };
};

export const clearStep = (state, options) => {
  const { ringIndex, stepId, decidedBy = state.createdBy, decidedAt = state.updatedAt } =
    options;
  const ring = ringOf(state, ringIndex);
  const step = stepOf(ring, stepId);
  if (!step) return { ok: false, error: `步骤 ${stepId} 不存在于该环` };
  if ((step.edgeRefs ?? []).length === 0) return { ok: true };
  const previousRings = clone(state.rings);
  step.edgeRefs = [];
  recordMutation(
    state,
    makeOperation({
      type: "clearStep",
      stepId,
      edgeId: null,
      decidedBy,
      decidedAt,
      textRef: textOfStep(state, stepId),
    }),
    previousRings,
  );
  return { ok: true };
};

export const clearRing = (state, options) => {
  const { ringIndex, decidedBy = state.createdBy, decidedAt = state.updatedAt } = options;
  const ring = ringOf(state, ringIndex);
  if (!ring) return { ok: false, error: "环不存在" };
  if (flattenRingRefs(ring).length === 0) return { ok: true };
  const previousRings = clone(state.rings);
  ring.steps.forEach((step) => {
    step.edgeRefs = [];
  });
  recordMutation(
    state,
    makeOperation({
      type: "clearRing",
      stepId: null,
      edgeId: null,
      decidedBy,
      decidedAt,
    }),
    previousRings,
  );
  return { ok: true };
};

const compensationOperations = (state, entry, decidedBy, decidedAt) => {
  const { operation, previousRings } = entry;
  const textFor = (stepId) => textOfStep(state, stepId);
  if (operation.type === "selectEdge") {
    return [
      makeOperation({
        type: "unselectEdge",
        stepId: operation.stepId,
        edgeId: operation.edgeId,
        decidedBy,
        decidedAt,
        textRef: textFor(operation.stepId),
      }),
    ];
  }
  if (operation.type === "unselectEdge") {
    return [
      makeOperation({
        type: "selectEdge",
        stepId: operation.stepId,
        edgeId: operation.edgeId,
        decidedBy,
        decidedAt,
        textRef: textFor(operation.stepId),
      }),
    ];
  }
  if (operation.type === "reverseEdge") {
    return [
      makeOperation({
        type: "reverseEdge",
        stepId: operation.stepId,
        edgeId: operation.edgeId,
        decidedBy,
        decidedAt,
        textRef: textFor(operation.stepId),
      }),
    ];
  }
  // clearStep / clearRing：恢复被清掉的边，逐条写 selectEdge
  const restored = [];
  previousRings.forEach((ring) => {
    (ring.steps ?? []).forEach((step) => {
      if (operation.type === "clearStep" && step.stepId !== operation.stepId) return;
      (step.edgeRefs ?? []).forEach((ref) => {
        restored.push({ stepId: step.stepId, edgeId: ref.edgeId });
      });
    });
  });
  return restored.map((item) =>
    makeOperation({
      type: "selectEdge",
      stepId: item.stepId,
      edgeId: item.edgeId,
      decidedBy,
      decidedAt,
      textRef: textFor(item.stepId),
    }),
  );
};

/** 撤销：恢复上一份环快照，并追加补偿操作（不删除历史） */
export const undo = (state, { decidedBy = state.createdBy, decidedAt = state.updatedAt } = {}) => {
  if (state.undoStack.length === 0) return { ok: false, error: "没有可撤销的操作" };
  const entry = state.undoStack.pop();
  state.redoStack.push({ operation: entry.operation, afterRings: clone(state.rings) });
  state.rings = entry.previousRings;
  compensationOperations(state, entry, decidedBy, decidedAt).forEach((operation) =>
    pushOperation(state, operation),
  );
  state.updatedAt = decidedAt;
  return { ok: true };
};

/** 重做：恢复撤销前的环快照，并重新记录原操作 */
export const redo = (state, { decidedBy = state.createdBy, decidedAt = state.updatedAt } = {}) => {
  if (state.redoStack.length === 0) return { ok: false, error: "没有可重做的操作" };
  const entry = state.redoStack.pop();
  state.undoStack.push({ operation: entry.operation, previousRings: clone(state.rings) });
  state.rings = entry.afterRings;
  pushOperation(state, { ...entry.operation, decidedBy, decidedAt });
  state.updatedAt = decidedAt;
  return { ok: true };
};

/** 环诊断：断链、未绑定、重复边、闭合 */
export const ringDiagnostics = (ring, edges) => {
  const edgeMap = edgeMapOf(edges);
  const breaks = [];
  let unboundSteps = 0;
  let previous = null;
  const seen = new Set();
  const duplicateEdgeIds = [];

  (ring?.steps ?? []).forEach((step) => {
    if ((step.edgeRefs ?? []).length === 0) unboundSteps += 1;
    (step.edgeRefs ?? []).forEach((ref) => {
      if (seen.has(ref.edgeId)) duplicateEdgeIds.push(ref.edgeId);
      seen.add(ref.edgeId);
      const edge = edgeMap.get(ref.edgeId);
      if (!edge) {
        breaks.push({ afterStepId: step.stepId, reason: `边 ${ref.edgeId} 不存在` });
        previous = null;
        return;
      }
      const { startNodeId, endNodeId } = edgeEndpoints(edge, ref.direction);
      if (previous && previous.endNodeId !== startNodeId) {
        breaks.push({
          afterStepId: previous.stepId,
          reason: `${previous.endNodeId} ≠ ${startNodeId}`,
        });
      }
      previous = { stepId: step.stepId, endNodeId };
    });
  });

  let closed = false;
  if (previous) {
    const refs = flattenRingRefs(ring);
    const firstEdge = edgeMap.get(refs[0].edgeId);
    const firstStart = firstEdge
      ? edgeEndpoints(firstEdge, refs[0].direction).startNodeId
      : null;
    closed = firstStart !== null && previous.endNodeId === firstStart;
    if (!closed) {
      breaks.push({
        afterStepId: previous.stepId,
        reason: `未闭合：${previous.endNodeId} ≠ ${firstStart}`,
      });
    }
  }

  return {
    role: ring?.role ?? null,
    unboundSteps,
    duplicateEdgeIds,
    breaks,
    closed,
  };
};

const OPERATION_KEY_ORDER = [
  "type",
  "stepId",
  "edgeId",
  "decidedBy",
  "decidedAt",
  "textRef",
];

/** 确定性草稿序列化：固定字段顺序、两空格缩进、末尾换行 */
export const serializeDraft = (draft) => {
  const ordered = {
    draftId: draft.draftId,
    schemaVersion: DRAFT_SCHEMA_VERSION,
    zoneId: draft.zoneId,
    boundaryText: draft.boundaryText,
    status: draft.status,
    createdBy: draft.createdBy,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    rings: (draft.rings ?? []).map((ring) => ({
      role: ring.role,
      appliesToRingId: ring.appliesToRingId ?? null,
      steps: (ring.steps ?? []).map((step) => ({
        stepId: step.stepId,
        edgeRefs: (step.edgeRefs ?? []).map((ref) => ({
          edgeId: ref.edgeId,
          direction: ref.direction,
        })),
      })),
    })),
    operations: (draft.operations ?? []).map((operation) => {
      const entry = {};
      OPERATION_KEY_ORDER.forEach((key) => {
        if (operation[key] !== undefined) entry[key] = operation[key];
      });
      return entry;
    }),
    rejectReason: draft.rejectReason ?? null,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

/** 从编辑器状态导出草稿对象（可直接交给 validateZoneDraft） */
export const draftFromState = (state, overrides = {}) => ({
  draftId: state.draftId,
  schemaVersion: DRAFT_SCHEMA_VERSION,
  zoneId: state.zoneId,
  boundaryText: state.boundaryText,
  status: state.status,
  createdBy: state.createdBy,
  createdAt: state.createdAt,
  updatedAt: state.updatedAt,
  rings: clone(state.rings),
  operations: clone(state.operations),
  rejectReason: state.rejectReason ?? null,
  ...overrides,
});

/** 为环追加/移除洞环（仅当正式数据存在 hole 步骤时可用） */
export const holeSupport = (zoneSpec) => {
  const holes = (zoneSpec?.rings ?? []).filter((ring) => ring.role === "hole");
  return {
    supported: holes.length > 0,
    holes: holes.map((ring) => ({ ringId: ring.ringId, stepCount: (ring.steps ?? []).length })),
  };
};
