/**
 * connection-decision-build.mjs - 审核结果到候选裁定的纯转换
 *
 * 只把已明确连接语义的审核项转换为 ncd_* 裁定；
 * pending / needsGeometryFix 不进入裁定，避免把未决问题伪装成正式结论。
 *
 * 纯计算：不读文件、不打印、不退出。
 */
import {
  DECISION_SCHEMA_VERSION,
  normalizePlacements,
} from "./connection-decisions.mjs";

export const REVIEW_STATUS_DECISION_TYPES = {
  connected: "connected",
  nonConnectingCrossing: "nonConnectingCrossing",
};

const compareText = (left, right) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/**
 * 把规范化审核文档转换为候选裁定文件。
 * @param {object} normalized validateCandidateReview 的返回值
 * @returns {{ schemaVersion: number, source: object, decisions: Array }}
 */
export const buildDecisionsFromReview = (normalized) => {
  const selected = normalized.candidates
    .filter((candidate) => REVIEW_STATUS_DECISION_TYPES[candidate.reviewStatus])
    .sort((left, right) => compareText(left.candidateId, right.candidateId));

  const decisions = selected.map((candidate, index) => ({
    decisionId: `ncd_${String(index + 1).padStart(6, "0")}`,
    connectionType: REVIEW_STATUS_DECISION_TYPES[candidate.reviewStatus],
    placements: normalizePlacements(candidate.placements).map(
      ({ featureId, partIndex, vertexIndex }) => ({ featureId, partIndex, vertexIndex }),
    ),
    rulingIds: [...candidate.rulingIds].sort(compareText),
    note:
      candidate.reviewNote.trim() ||
      `${candidate.candidateId} ${candidate.category} 经审核为 ${candidate.reviewStatus}`,
  }));

  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    source: {
      reviewId: normalized.reviewId,
      featuresSha256: normalized.source.featuresSha256,
      gitCommit: normalized.source.gitCommit,
      reviewer: normalized.reviewer,
      reviewedAt: normalized.reviewedAt,
    },
    decisions,
  };
};
