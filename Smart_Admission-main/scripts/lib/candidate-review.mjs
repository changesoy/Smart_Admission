/**
 * candidate-review.mjs - 连接候选审核文档校验
 *
 * 审核结果只写入 reports/network/，不等同于正式 ncd_* 裁定：
 *   - pending / needsGeometryFix 不产生 proposedConnectionType
 *   - connected / nonConnectingCrossing 才会携带正式连接语义
 *   - 浏览器只能保存审核结果，不能直接改 data/
 *
 * 纯计算：不读文件、不打印、不退出。
 */
import { CANDIDATE_CATEGORIES } from "./connection-candidates.mjs";
import { sameCoordinate, validateRulingIds } from "./connection-decisions.mjs";

export const CANDIDATE_REVIEW_SCHEMA_VERSION = 1;

export const CANDIDATE_REVIEW_ID_PATTERN = /^ncr_[0-9a-f]{8}$/;

export const REVIEW_STATUS_TYPES = {
  pending: null,
  connected: "connected",
  nonConnectingCrossing: "nonConnectingCrossing",
  needsGeometryFix: null,
};

export const REVIEW_STATUSES = Object.keys(REVIEW_STATUS_TYPES);

const placementKeyOf = (placement) =>
  `${placement.featureId}|${placement.partIndex}|${placement.vertexIndex}`;

const coordinatedAt = (featureIndex, placement) =>
  featureIndex.get(placement.featureId)?.parts?.[placement.partIndex]?.[
    placement.vertexIndex
  ] ?? null;

const validatePlacement = ({ placement, featureIndex, report, context }) => {
  const feature = featureIndex.get(placement?.featureId);
  if (!feature) {
    report.error("candidate_review", `${context} placement 引用了不存在的要素`);
    return null;
  }
  if (feature.lifecycle !== "active") {
    report.error("candidate_review", `${context} placement 引用了非 active 要素: ${feature.featureId}`);
    return null;
  }
  if (!Number.isInteger(placement.partIndex) || placement.partIndex < 0) {
    report.error("candidate_review", `${context} partIndex 非法`);
    return null;
  }
  const part = feature.parts[placement.partIndex];
  if (!part) {
    report.error("candidate_review", `${context} partIndex 超出范围`);
    return null;
  }
  if (
    !Number.isInteger(placement.vertexIndex) ||
    placement.vertexIndex < 0 ||
    !part[placement.vertexIndex]
  ) {
    report.error("candidate_review", `${context} vertexIndex 超出范围`);
    return null;
  }
  return {
    featureId: placement.featureId,
    featureName: typeof placement.featureName === "string" ? placement.featureName : "",
    featureType: typeof placement.featureType === "string" ? placement.featureType : "unknown",
    partIndex: placement.partIndex,
    vertexIndex: placement.vertexIndex,
    position: placement.position === "endpoint" ? "endpoint" : "interior",
    coordinate: part[placement.vertexIndex],
  };
};

const validateSegment = ({ segment, featureIndex, report, context }) => {
  const feature = featureIndex.get(segment?.featureId);
  if (!feature) {
    report.error("candidate_review", `${context} segment 引用了不存在的要素`);
    return null;
  }
  const part = feature.parts[segment.partIndex];
  if (!part) {
    report.error("candidate_review", `${context} segment partIndex 超出范围`);
    return null;
  }
  if (
    !Number.isInteger(segment.fromVertexIndex) ||
    !Number.isInteger(segment.toVertexIndex) ||
    segment.toVertexIndex !== segment.fromVertexIndex + 1 ||
    !part[segment.fromVertexIndex] ||
    !part[segment.toVertexIndex]
  ) {
    report.error("candidate_review", `${context} segment 顶点范围非法`);
    return null;
  }
  return {
    featureId: segment.featureId,
    featureName: typeof segment.featureName === "string" ? segment.featureName : "",
    featureType: typeof segment.featureType === "string" ? segment.featureType : "unknown",
    partIndex: segment.partIndex,
    fromVertexIndex: segment.fromVertexIndex,
    toVertexIndex: segment.toVertexIndex,
    from: part[segment.fromVertexIndex],
    to: part[segment.toVertexIndex],
  };
};

/**
 * 校验候选审核文档。
 * @returns {object|null} 规范化文档；存在错误时返回 null
 */
export const validateCandidateReview = ({ review, registry, featureIndex, report }) => {
  const section = "candidate_review";

  if (review?.schemaVersion !== CANDIDATE_REVIEW_SCHEMA_VERSION) {
    report.error(
      section,
      `schemaVersion 应为 ${CANDIDATE_REVIEW_SCHEMA_VERSION}，当前: ${review?.schemaVersion}`,
    );
  }
  if (typeof review?.reviewId !== "string" || !CANDIDATE_REVIEW_ID_PATTERN.test(review.reviewId)) {
    report.error(section, `reviewId 必须匹配 ^ncr_[0-9a-f]{8}$: ${JSON.stringify(review?.reviewId)}`);
  }
  if (
    typeof review?.source?.featuresSha256 !== "string" ||
    !/^[A-Fa-f0-9]{64}$/.test(review.source.featuresSha256)
  ) {
    report.error(section, "source.featuresSha256 必须是 64 位十六进制");
  }
  if (typeof review?.source?.gitCommit !== "string") {
    report.error(section, "source.gitCommit 必须是字符串");
  }
  if (typeof review?.reviewer !== "string" || review.reviewer.trim() === "") {
    report.error(section, "reviewer 必须是非空字符串");
  }
  if (!Array.isArray(review?.candidates) || review.candidates.length === 0) {
    report.error(section, "candidates 必须是非空数组");
    return null;
  }

  const seen = new Set();
  const counts = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0]));
  const normalized = [];

  review.candidates.forEach((candidate, index) => {
    const at = `第 ${index + 1} 项`;
    const candidateId = candidate?.candidateId;
    if (typeof candidateId !== "string" || !/^ncc_\d{6}$/.test(candidateId)) {
      report.error(section, `${at} candidateId 必须匹配 ^ncc_\\d{6}$: ${JSON.stringify(candidateId)}`);
      return;
    }
    if (seen.has(candidateId)) {
      report.error(section, `${at} candidateId 重复: ${candidateId}`);
      return;
    }
    seen.add(candidateId);

    let bad = false;

    if (!CANDIDATE_CATEGORIES.includes(candidate.category)) {
      report.error(section, `${at} category 非法: ${JSON.stringify(candidate.category)}`);
      bad = true;
    }

    if (
      !Array.isArray(candidate.coordinate) ||
      candidate.coordinate.length !== 2 ||
      !candidate.coordinate.every((value) => Number.isFinite(value))
    ) {
      report.error(section, `${at} coordinate 必须是两个有限数字`);
      bad = true;
    }

    if (!Array.isArray(candidate.placements)) {
      report.error(section, `${at} placements 必须是数组`);
      bad = true;
    }
    if (!Array.isArray(candidate.segments)) {
      report.error(section, `${at} segments 必须是数组`);
      bad = true;
    }

    const placements = [];
    const localPlacements = new Set();
    (candidate.placements ?? []).forEach((placement) => {
      const normalizedPlacement = validatePlacement({
        placement,
        featureIndex,
        report,
        context: `${at} ${candidateId}`,
      });
      if (!normalizedPlacement) {
        bad = true;
        return;
      }
      const key = placementKeyOf(normalizedPlacement);
      if (localPlacements.has(key)) {
        report.error(section, `${at} placement 重复: ${key}`);
        bad = true;
        return;
      }
      localPlacements.add(key);
      placements.push(normalizedPlacement);
    });

    const segments = [];
    (candidate.segments ?? []).forEach((segment) => {
      const normalizedSegment = validateSegment({
        segment,
        featureIndex,
        report,
        context: `${at} ${candidateId}`,
      });
      if (!normalizedSegment) {
        bad = true;
        return;
      }
      segments.push(normalizedSegment);
    });

    if (placements.length + segments.length === 0) {
      report.error(section, `${at} 至少需要 1 个 placement 或 segment`);
      bad = true;
    }

    const reviewStatus = candidate.reviewStatus;
    if (!REVIEW_STATUSES.includes(reviewStatus)) {
      report.error(section, `${at} reviewStatus 非法: ${JSON.stringify(reviewStatus)}`);
      bad = true;
    } else {
      counts[reviewStatus] += 1;
    }

    const expectedType = REVIEW_STATUS_TYPES[reviewStatus] ?? null;
    if ((candidate.proposedConnectionType ?? null) !== expectedType) {
      report.error(
        section,
        `${at} ${reviewStatus} 的 proposedConnectionType 必须为 ${JSON.stringify(expectedType)}`,
      );
      bad = true;
    }

    if (
      reviewStatus !== "pending" &&
      (typeof candidate.reviewer !== "string" || candidate.reviewer.trim() === "")
    ) {
      report.error(section, `${at} 非 pending 审核必须填写 reviewer`);
      bad = true;
    }
    if (
      reviewStatus === "needsGeometryFix" &&
      (typeof candidate.reviewNote !== "string" || candidate.reviewNote.trim() === "")
    ) {
      report.error(section, `${at} needsGeometryFix 必须填写 reviewNote`);
      bad = true;
    }

    const rulingResult = validateRulingIds({
      rulingIds: candidate.rulingIds ?? [],
      registry,
      report,
      section,
      context: `${at} ${candidateId}`,
    });
    if (!rulingResult.ok) bad = true;

    const featureIds = new Set([
      ...placements.map((placement) => placement.featureId),
      ...segments.map((segment) => segment.featureId),
    ]);

    if (reviewStatus === "connected") {
      if (placements.length < 2 || featureIds.size < 2) {
        report.error(section, `${at} connected 至少需要两个不同要素的 placement`);
        bad = true;
      } else {
        const base = coordinatedAt(featureIndex, placements[0]);
        const collocated = placements.every((placement) =>
          sameCoordinate(coordinatedAt(featureIndex, placement), base),
        );
        if (!collocated) {
          report.error(section, `${at} connected 的 placement 在 7 位小数下不完全共点`);
          bad = true;
        }
      }
    }

    if (reviewStatus === "nonConnectingCrossing" && featureIds.size < 2) {
      report.error(section, `${at} nonConnectingCrossing 至少需要两个不同要素`);
      bad = true;
    }

    if (bad) return;

    normalized.push({
      candidateId,
      category: candidate.category,
      coordinate: candidate.coordinate,
      placements: placements.map((placement) => ({
        featureId: placement.featureId,
        featureName: placement.featureName,
        featureType: placement.featureType,
        partIndex: placement.partIndex,
        vertexIndex: placement.vertexIndex,
        position: placement.position,
      })),
      segments: segments.map((segment) => ({
        featureId: segment.featureId,
        featureName: segment.featureName,
        featureType: segment.featureType,
        partIndex: segment.partIndex,
        fromVertexIndex: segment.fromVertexIndex,
        toVertexIndex: segment.toVertexIndex,
      })),
      distanceM: Number.isFinite(candidate.distanceM) ? candidate.distanceM : null,
      overlapLengthM: Number.isFinite(candidate.overlapLengthM)
        ? candidate.overlapLengthM
        : null,
      reviewStatus,
      proposedConnectionType: expectedType,
      rulingIds: rulingResult.ids,
      evidence: Array.isArray(candidate.evidence)
        ? candidate.evidence.filter((item) => typeof item === "string")
        : [],
      reviewer: typeof candidate.reviewer === "string" ? candidate.reviewer : "",
      reviewNote: typeof candidate.reviewNote === "string" ? candidate.reviewNote : "",
    });
  });

  if (report.errors.some(({ section: name }) => name === section)) return null;

  return {
    schemaVersion: CANDIDATE_REVIEW_SCHEMA_VERSION,
    reviewId: review.reviewId,
    source: {
      featuresSha256: review.source.featuresSha256.toUpperCase(),
      gitCommit: review.source.gitCommit,
      candidatesPath: review.source.candidatesPath ?? "",
    },
    reviewer: review.reviewer,
    reviewedAt: typeof review.reviewedAt === "string" ? review.reviewedAt : "",
    counts: { total: normalized.length, ...counts },
    candidates: normalized,
  };
};
