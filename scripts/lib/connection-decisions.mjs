/**
 * connection-decisions.mjs - 连接裁定的共享严格校验
 *
 * 契约：docs/planning/节点边生成器规格与样例交接.md（第三、五章）
 *       docs/planning/统一边界网络数据契约与ID规则.md（第八、十一章）
 *
 * 纯计算：不读文件、不打印、不退出。
 * 生成器与 validate-network 共用本模块，避免两套裁定规则分裂。
 */
import { CONNECTION_TYPES, isId, roundCoord } from "./network-schema.mjs";

/** 连接裁定结构版本 */
export const DECISION_SCHEMA_VERSION = 1;

/** 正式裁定 ID：ncd_ + 六位序号 */
export const DECISION_ID_PATTERN = /^ncd_\d{6}$/;

export const placementKey = (placement) =>
  `${placement.featureId}|${placement.partIndex}|${placement.vertexIndex}`;

export const placementSetKey = (placements) =>
  [...placements]
    .map(placementKey)
    .sort()
    .join(",");

const compareNumber = (left, right) => left - right;

export const comparePlacement = (left, right) => {
  if (left.featureId !== right.featureId) {
    return left.featureId < right.featureId ? -1 : 1;
  }
  if (left.partIndex !== right.partIndex) {
    return compareNumber(left.partIndex, right.partIndex);
  }
  return compareNumber(left.vertexIndex, right.vertexIndex);
};

/** 按 featureId/partIndex/vertexIndex 升序规范化 placement 集合 */
export const normalizePlacements = (placements) =>
  [...placements].sort(comparePlacement);

/** 七位小数下是否为同一坐标 */
export const sameCoordinate = (left, right) =>
  roundCoord(left[0]) === roundCoord(right[0]) &&
  roundCoord(left[1]) === roundCoord(right[1]);

const coordinateAt = (featureIndex, placement) => {
  const feature = featureIndex.get(placement.featureId);
  const part = feature?.parts?.[placement.partIndex];
  return part?.[placement.vertexIndex] ?? null;
};

const indexRulings = (registry) => {
  const index = new Map();
  (registry?.entries ?? []).forEach((entry) => {
    if (entry?.entityType === "boundaryRuling") index.set(entry.id, entry);
  });
  return index;
};

/**
 * 校验并规范化连接裁定。
 * @param {object} input
 * @param {object|null} input.decisionsFile network_connection_decisions 原始对象
 * @param {Map} input.featureIndex featureId → { parts, lifecycle, ... }
 * @param {object} input.registry id_registry 原始对象
 * @param {object} input.report createReport() 收集器
 * @returns {Array} 按 decisionId 升序的规范裁定
 */
export const validateConnectionDecisions = ({
  decisionsFile,
  featureIndex,
  registry,
  report,
}) => {
  const section = "connection_decisions";
  const decisions = [];
  if (!decisionsFile) return decisions;

  if (decisionsFile.schemaVersion !== DECISION_SCHEMA_VERSION) {
    report.error(
      section,
      `schemaVersion 应为 ${DECISION_SCHEMA_VERSION}，当前: ${decisionsFile.schemaVersion}`,
    );
  }
  if (!Array.isArray(decisionsFile.decisions)) {
    report.error(section, "缺少 decisions 数组");
    return decisions;
  }

  const rulingIndex = indexRulings(registry);
  const seenDecisionIds = new Set();
  const placementOwners = new Map();

  decisionsFile.decisions.forEach((decision, index) => {
    const at = `第 ${index + 1} 条裁定`;
    const decisionId = decision?.decisionId;

    if (typeof decisionId !== "string" || !DECISION_ID_PATTERN.test(decisionId)) {
      report.error(
        section,
        `${at} decisionId 必须匹配 ^ncd_\\d{6}$: ${JSON.stringify(decisionId)}`,
      );
      return;
    }
    if (seenDecisionIds.has(decisionId)) {
      report.error(section, `${at} decisionId 重复: ${decisionId}`);
      return;
    }
    seenDecisionIds.add(decisionId);

    let bad = false;

    if (!CONNECTION_TYPES.includes(decision.connectionType)) {
      report.error(
        section,
        `${at} connectionType 非法: ${JSON.stringify(decision.connectionType)}`,
      );
      bad = true;
    }

    if (typeof decision.note !== "string" || decision.note.trim() === "") {
      report.error(section, `${at} note 必须是非空字符串`);
      bad = true;
    }

    const rulingIds = [];
    if (!Array.isArray(decision.rulingIds)) {
      report.error(section, `${at} rulingIds 必须是数组`);
      bad = true;
    } else {
      const seenRulings = new Set();
      decision.rulingIds.forEach((rulingId) => {
        if (!isId("boundaryRuling", rulingId)) {
          report.error(section, `${at} rulingId 格式非法: ${JSON.stringify(rulingId)}`);
          bad = true;
          return;
        }
        if (seenRulings.has(rulingId)) {
          report.error(section, `${at} rulingId 重复: ${rulingId}`);
          bad = true;
          return;
        }
        seenRulings.add(rulingId);
        const entry = rulingIndex.get(rulingId);
        if (!entry) {
          report.error(section, `${at} rulingId 未在注册表登记: ${rulingId}`);
          bad = true;
          return;
        }
        if (entry.lifecycle !== "active") {
          report.error(section, `${at} rulingId ${rulingId} 生命周期为 ${entry.lifecycle}`);
          bad = true;
          return;
        }
        rulingIds.push(rulingId);
      });
    }

    if (decision.connectionType === "conditional" && rulingIds.length === 0) {
      report.error(section, `${at} conditional 裁定必须关联至少一个有效 rulingId`);
      bad = true;
    }

    if (!Array.isArray(decision.placements) || decision.placements.length < 2) {
      report.error(section, `${at} placements 至少需要 2 个位置`);
      return;
    }

    const placements = [];
    const localKeys = new Set();
    decision.placements.forEach((placement) => {
      const feature = featureIndex.get(placement?.featureId);
      if (!feature) {
        report.error(
          section,
          `${at} placement 引用了不存在的要素: ${JSON.stringify(placement?.featureId)}`,
        );
        bad = true;
        return;
      }
      if (feature.lifecycle !== "active") {
        report.error(
          section,
          `${at} placement 引用了非 active 要素: ${feature.featureId}`,
        );
        bad = true;
        return;
      }
      if (!Number.isInteger(placement.partIndex) || placement.partIndex < 0) {
        report.error(section, `${at} partIndex 非法: ${JSON.stringify(placement.partIndex)}`);
        bad = true;
        return;
      }
      const part = feature.parts[placement.partIndex];
      if (!part) {
        report.error(section, `${at} partIndex ${placement.partIndex} 超出范围`);
        bad = true;
        return;
      }
      if (
        !Number.isInteger(placement.vertexIndex) ||
        placement.vertexIndex < 0 ||
        !part[placement.vertexIndex]
      ) {
        report.error(section, `${at} vertexIndex ${placement.vertexIndex} 超出范围`);
        bad = true;
        return;
      }
      const normalized = {
        featureId: placement.featureId,
        partIndex: placement.partIndex,
        vertexIndex: placement.vertexIndex,
      };
      const key = placementKey(normalized);
      if (localKeys.has(key)) {
        report.error(section, `${at} placement 重复: ${key}`);
        bad = true;
        return;
      }
      localKeys.add(key);
      placements.push(normalized);
    });

    if (bad) return;

    if (decision.connectionType === "connected") {
      const base = coordinateAt(featureIndex, placements[0]);
      const collocated = placements.every((placement) =>
        sameCoordinate(coordinateAt(featureIndex, placement), base),
      );
      if (!collocated) {
        report.error(
          section,
          `${at} 声明 connected，但各 placement 在 7 位小数下不完全共点`,
        );
        return;
      }
    }

    const occupied = placements
      .map((placement) => placementKey(placement))
      .find((key) => placementOwners.has(key));
    if (occupied) {
      report.error(
        section,
        `placement ${occupied} 同时出现在 ${placementOwners.get(occupied)} 与 ${decisionId}`,
      );
      return;
    }
    placements.forEach((placement) => {
      placementOwners.set(placementKey(placement), decisionId);
    });

    decisions.push({
      decisionId,
      connectionType: decision.connectionType,
      placements: normalizePlacements(placements),
      rulingIds: [...rulingIds].sort(),
      note: decision.note,
    });
  });

  return decisions.sort((left, right) =>
    left.decisionId < right.decisionId ? -1 : left.decisionId > right.decisionId ? 1 : 0,
  );
};
