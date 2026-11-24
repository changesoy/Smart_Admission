/**
 * zone-draft-schema.mjs - 学区草稿（zone_draft）的字段常量与纯校验
 *
 * 契约：docs/planning/草稿字段冻结清单.md（D01–D17）
 *
 * 本模块只做纯计算：给定已解析的草稿、正式学区与网络数据，收集问题并返回。
 * 不读文件、不打印、不退出。C 的 validate-zone-draft CLI 直接调用本模块，
 * 不得另抄一套规则。
 */
import { createReport, isId } from "./network-schema.mjs";

/** 草稿结构版本 */
export const DRAFT_SCHEMA_VERSION = 1;

/** 草稿状态 */
export const DRAFT_STATUSES = [
  "editing",
  "readyForReview",
  "rejected",
  "imported",
];

/** 边使用方向 */
export const DRAFT_DIRECTIONS = ["forward", "reverse"];

/** 操作类型 */
export const DRAFT_OPERATION_TYPES = [
  "selectEdge",
  "unselectEdge",
  "reverseEdge",
  "clearStep",
  "clearRing",
];

/** 环角色 */
export const DRAFT_RING_ROLES = ["outer", "hole"];

/** 草稿中禁止出现的坐标类字段 */
export const DRAFT_FORBIDDEN_KEYS = [
  "coordinates",
  "geometry",
  "ring",
  "vertices",
  "from",
  "to",
  "ringVertexSpan",
  "polyline",
  "latlng",
];

/** draft_zone_006_20261117_01 */
const DRAFT_ID_PATTERN = /^draft_(zone_\d{3})_(\d{8})_(\d{2})$/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim() !== "";

const isDate = (value) => typeof value === "string" && DATE_PATTERN.test(value);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** 深度扫描禁止字段，返回命中路径 */
const findForbiddenFields = (value, path, hits) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findForbiddenFields(item, `${path}[${index}]`, hits),
    );
    return;
  }
  if (!isObject(value)) return;

  DRAFT_FORBIDDEN_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      hits.push(`${path}.${key}`);
    }
  });

  if (
    Object.prototype.hasOwnProperty.call(value, "featureId") &&
    Object.prototype.hasOwnProperty.call(value, "fromNodeId") &&
    Object.prototype.hasOwnProperty.call(value, "toNodeId")
  ) {
    hits.push(`${path}.{featureId, fromNodeId, toNodeId}`);
  }

  Object.entries(value).forEach(([key, child]) =>
    findForbiddenFields(child, `${path}.${key}`, hits),
  );
};

const stepIdsOf = (ring) =>
  (Array.isArray(ring?.steps) ? ring.steps : []).map((step) => step?.stepId);

const sameSet = (left, right) =>
  left.length === right.length &&
  left.every((id) => right.includes(id));

/** 在正式学区中按步骤集合定位草稿环，返回 { ring, reason } */
const matchFormalRing = (formalRings, stepIds) => {
  const candidates = formalRings.filter((ring) =>
    sameSet(stepIdsOf(ring), stepIds),
  );
  if (candidates.length === 1) return { ring: candidates[0], reason: null };
  if (candidates.length > 1) {
    return { ring: null, reason: "多个正式环的步骤集合相同，无法定位" };
  }

  let best = null;
  let bestScore = -1;
  formalRings.forEach((ring) => {
    const ids = stepIdsOf(ring);
    const score = ids.filter((id) => stepIds.includes(id)).length;
    if (score > bestScore) {
      best = ring;
      bestScore = score;
    }
  });

  const formalIds = best ? stepIdsOf(best) : [];
  const missing = formalIds.filter((id) => !stepIds.includes(id));
  const extra = stepIds.filter((id) => !formalIds.includes(id));
  const detail = [
    missing.length > 0 ? `缺少 ${missing.join("、")}` : "",
    extra.length > 0 ? `多出 ${extra.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("；");
  return { ring: null, reason: detail || "未找到步骤集合匹配的正式环" };
};

/**
 * 校验草稿结构、引用与闭合。
 *
 * @param {object} draft 草稿 JSON
 * @param {object} context
 * @param {object} context.zoneSpec 对应学区的正式对象（zone_specs.v2 中的一项）
 * @param {Array} [context.nodes] 拓扑节点；缺省时跳过节点可通行性检查
 * @param {Array} [context.edges] 拓扑边
 */
export const validateZoneDraft = (draft, context = {}) => {
  const report = createReport();
  const section = "zone_draft";

  if (!isObject(draft)) {
    report.error(section, "草稿根节点必须是对象");
    return report;
  }

  const { zoneSpec, nodes = [], edges = [] } = context;
  const status = draft.status;

  if (draft.schemaVersion !== DRAFT_SCHEMA_VERSION) {
    report.error(
      section,
      `schemaVersion 应为 ${DRAFT_SCHEMA_VERSION}，当前: ${draft.schemaVersion}`,
    );
  }
  if (!DRAFT_STATUSES.includes(status)) {
    report.error(section, `status 取值非法: ${JSON.stringify(status)}`);
  }
  if (!isDate(draft.createdAt)) {
    report.error(section, `createdAt 必须是 YYYY-MM-DD，当前: ${JSON.stringify(draft.createdAt)}`);
  }
  if (!isDate(draft.updatedAt)) {
    report.error(section, `updatedAt 必须是 YYYY-MM-DD，当前: ${JSON.stringify(draft.updatedAt)}`);
  }
  if (!isNonEmptyString(draft.createdBy)) {
    report.error(section, "createdBy 必须是非空字符串");
  }
  if (!Array.isArray(draft.rings)) {
    report.error(section, "rings 必须是数组");
  }
  if (!Array.isArray(draft.operations)) {
    report.error(section, "operations 必须是数组");
  }

  if (status === "rejected") {
    if (!isNonEmptyString(draft.rejectReason)) {
      report.error(section, "status=rejected 时必须填写 rejectReason");
    }
  } else if (draft.rejectReason !== null && draft.rejectReason !== undefined) {
    report.error(section, "仅 status=rejected 时允许 rejectReason");
  }

  const idMatch = DRAFT_ID_PATTERN.exec(draft.draftId ?? "");
  if (!idMatch) {
    report.error(
      section,
      `draftId 格式应为 draft_<zoneId>_<YYYYMMDD>_<NN>，当前: ${JSON.stringify(draft.draftId)}`,
    );
  } else if (idMatch[1] !== draft.zoneId) {
    report.error(section, `draftId 中的学区 ${idMatch[1]} 与 zoneId ${draft.zoneId} 不一致`);
  }

  if (!isObject(zoneSpec)) {
    report.error(section, "缺少 zoneSpec 上下文，无法校验步骤与原文");
    return report;
  }

  if (draft.zoneId !== zoneSpec.zoneId) {
    report.error(section, `zoneId ${draft.zoneId} 与正式学区 ${zoneSpec.zoneId} 不一致`);
  }
  if (draft.boundaryText !== zoneSpec.boundaryText) {
    report.error(section, "boundaryText 与正式原文不一致，草稿不得改写原文");
  }

  const forbidden = [];
  findForbiddenFields(draft, "draft", forbidden);
  forbidden.forEach((path) => {
    report.error(section, `出现禁止字段: ${path}`);
  });

  const formalRings = Array.isArray(zoneSpec.rings) ? zoneSpec.rings : [];
  const formalStepMap = new Map();
  formalRings.forEach((ring) =>
    (ring.steps ?? []).forEach((step) => formalStepMap.set(step.stepId, step)),
  );
  const edgeMap = new Map(edges.map((edge) => [edge.edgeId, edge]));
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));

  const rings = Array.isArray(draft.rings) ? draft.rings : [];
  const outerRings = rings.filter((ring) => ring?.role === "outer");
  if (status !== "editing" && outerRings.length !== 1) {
    report.error(section, `readyForReview 起必须恰有 1 个 outer 环，当前 ${outerRings.length} 个`);
  }
  if (outerRings.length > 1) {
    report.error(section, `一个草稿最多 1 个 outer 环，当前 ${outerRings.length} 个`);
  }

  const formalOuter = formalRings.find((ring) => ring.role === "outer");
  const seenStepIds = new Set();

  rings.forEach((ring, ringIndex) => {
    const label = `第 ${ringIndex + 1} 个环（${ring?.role ?? "未知角色"}）`;

    if (!DRAFT_RING_ROLES.includes(ring?.role)) {
      report.error(section, `${label} role 取值非法: ${JSON.stringify(ring?.role)}`);
      return;
    }
    if (!Array.isArray(ring.steps)) {
      report.error(section, `${label} steps 必须是数组`);
      return;
    }
    if (ring.role === "outer") {
      if (ring.appliesToRingId !== null && ring.appliesToRingId !== undefined) {
        report.error(section, `${label} outer 环的 appliesToRingId 必须为 null`);
      }
    } else {
      if (!isNonEmptyString(ring.appliesToRingId)) {
        report.error(section, `${label} hole 环必须填写 appliesToRingId`);
      } else if (formalOuter && ring.appliesToRingId !== formalOuter.ringId) {
        report.error(
          section,
          `${label} appliesToRingId ${ring.appliesToRingId} 不是本学区 outer 环 ${formalOuter.ringId}`,
        );
      }
      if (ring.steps.length < 3) {
        report.error(section, `${label} hole 环至少需要 3 个步骤`);
      }
    }

    const stepIds = stepIdsOf(ring);
    stepIds.forEach((stepId) => {
      if (!stepId) {
        report.error(section, `${label} 存在缺少 stepId 的步骤`);
        return;
      }
      if (!formalStepMap.has(stepId)) {
        report.error(section, `${label} stepId ${stepId} 不属于本学区`);
      }
      if (seenStepIds.has(stepId)) {
        report.error(section, `步骤 ${stepId} 在草稿中重复出现`);
      }
      seenStepIds.add(stepId);
    });

    const { ring: formalRing, reason } = matchFormalRing(formalRings, stepIds);
    if (!formalRing) {
      report.error(section, `${label} 步骤集合与正式数据不一致：${reason}`);
    } else {
      if (formalRing.role !== ring.role) {
        report.error(section, `${label} role 应为 ${formalRing.role}`);
      }
      const draftOrder = stepIds;
      const formalOrder = stepIdsOf(formalRing);
      if (draftOrder.join("|") !== formalOrder.join("|")) {
        report.error(section, `${label} 步骤顺序与正式数据不一致`);
      }
    }

    const segments = [];
    const seenEdges = new Set();
    ring.steps.forEach((step) => {
      const stepLabel = `${label} 步骤 ${step?.stepId ?? "?"}`;
      if (!Array.isArray(step?.edgeRefs)) {
        report.error(section, `${stepLabel} edgeRefs 必须是数组`);
        return;
      }
      if (ring.role === "hole" && formalStepMap.get(step.stepId)?.side === "排除") {
        report.error(section, `${stepLabel} 为排除步骤，不得放入 hole 环`);
      }
      if (status !== "editing" && step.edgeRefs.length === 0) {
        report.error(section, `${stepLabel} 未绑定边`);
      }

      step.edgeRefs.forEach((ref, refIndex) => {
        const refLabel = `${stepLabel} 第 ${refIndex + 1} 条边`;
        if (!isObject(ref)) {
          report.error(section, `${refLabel} 不是对象`);
          segments.push(null);
          return;
        }
        if (!isId("networkEdge", ref.edgeId)) {
          report.error(section, `${refLabel} edgeId 格式非法: ${JSON.stringify(ref.edgeId)}`);
          segments.push(null);
          return;
        }
        if (!DRAFT_DIRECTIONS.includes(ref.direction)) {
          report.error(section, `${refLabel} direction 取值非法: ${JSON.stringify(ref.direction)}`);
          segments.push(null);
          return;
        }
        if (seenEdges.has(ref.edgeId)) {
          report.error(section, `${label} 重复引用同一条边 ${ref.edgeId}`);
        }
        seenEdges.add(ref.edgeId);

        const edge = edgeMap.get(ref.edgeId);
        if (!edge) {
          report.error(section, `${refLabel} 引用了不存在的边 ${ref.edgeId}`);
          segments.push(null);
          return;
        }
        if (edge.lifecycle !== "active") {
          report.error(section, `${refLabel} 边 ${ref.edgeId} 生命周期为 ${edge.lifecycle}`);
        }
        if (edge.boundaryEligible !== true) {
          report.error(section, `${refLabel} 边 ${ref.edgeId} 不可作为学区边界`);
        }

        const forward = ref.direction === "forward";
        const startNodeId = forward ? edge.fromNodeId : edge.toNodeId;
        const endNodeId = forward ? edge.toNodeId : edge.fromNodeId;

        [startNodeId, endNodeId].forEach((nodeId) => {
          const node = nodeMap.get(nodeId);
          if (!node) return;
          if (node.lifecycle && node.lifecycle !== "active") {
            report.error(section, `${refLabel} 经过的节点 ${nodeId} 已退役`);
          }
          if (node.connectionType && node.connectionType !== "connected") {
            report.error(
              section,
              `${refLabel} 经过的节点 ${nodeId} 不可通行（${node.connectionType}）`,
            );
          }
        });

        segments.push({ stepId: step.stepId, startNodeId, endNodeId });
      });
    });

    const allBound =
      ring.steps.length > 0 &&
      ring.steps.every((step) => (step.edgeRefs ?? []).length > 0);
    const allResolved = allBound && segments.every(Boolean);
    if (allResolved) {
      for (let index = 1; index < segments.length; index += 1) {
        const previous = segments[index - 1];
        const current = segments[index];
        if (previous.endNodeId !== current.startNodeId) {
          report.error(
            section,
            `${label} 在 ${previous.stepId} 与 ${current.stepId} 之间断链：` +
              `${previous.endNodeId} ≠ ${current.startNodeId}`,
          );
        }
      }
      const first = segments[0];
      const last = segments[segments.length - 1];
      if (last.endNodeId !== first.startNodeId) {
        report.error(
          section,
          `${label} 未闭合：末边终点 ${last.endNodeId} ≠ 首边起点 ${first.startNodeId}`,
        );
      }
    } else if (status !== "editing") {
      report.warn(section, `${label} 存在未绑定或无法解析的边，未做连续性校验`);
    }
  });

  if (status !== "editing") {
    formalStepMap.forEach((step, stepId) => {
      if (!seenStepIds.has(stepId)) {
        report.error(section, `缺少正式步骤 ${stepId}（${step.text}）`);
      }
    });
  }

  const operations = Array.isArray(draft.operations) ? draft.operations : [];
  operations.forEach((operation, index) => {
    const label = `第 ${index + 1} 条操作`;
    if (!isObject(operation)) {
      report.error(section, `${label} 不是对象`);
      return;
    }
    if (!DRAFT_OPERATION_TYPES.includes(operation.type)) {
      report.error(section, `${label} type 取值非法: ${JSON.stringify(operation.type)}`);
    }
    if (!isNonEmptyString(operation.decidedBy)) {
      report.error(section, `${label} 缺少 decidedBy`);
    }
    if (!isDate(operation.decidedAt)) {
      report.error(section, `${label} decidedAt 必须是 YYYY-MM-DD`);
    }

    const needsStep = operation.type !== "clearRing";
    if (needsStep) {
      if (!isNonEmptyString(operation.stepId)) {
        report.error(section, `${label} 缺少 stepId`);
      } else if (!formalStepMap.has(operation.stepId)) {
        report.error(section, `${label} stepId ${operation.stepId} 不属于本学区`);
      }
    } else if (operation.stepId !== null && operation.stepId !== undefined) {
      if (!formalStepMap.has(operation.stepId)) {
        report.error(section, `${label} stepId ${operation.stepId} 不属于本学区`);
      }
    }

    const needsEdge = ["selectEdge", "unselectEdge", "reverseEdge"].includes(
      operation.type,
    );
    if (needsEdge) {
      if (!isId("networkEdge", operation.edgeId)) {
        report.error(section, `${label} edgeId 格式非法`);
      }
      if (!edgeMap.has(operation.edgeId)) {
        report.error(section, `${label} 引用了不存在的边 ${operation.edgeId}`);
      }
    } else if (operation.edgeId !== null && operation.edgeId !== undefined) {
      report.error(section, `${label} 该操作类型不得带 edgeId`);
    }

    if (operation.textRef !== undefined && operation.textRef !== null) {
      const formalStep = formalStepMap.get(operation.stepId);
      if (!formalStep) {
        report.error(section, `${label} 无法校验 textRef：步骤不存在`);
      } else if (operation.textRef !== formalStep.text) {
        report.error(section, `${label} textRef 与正式步骤原文不一致`);
      }
    }
  });

  return report;
};
