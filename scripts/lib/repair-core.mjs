/**
 * repair-core.mjs - 学区边界修复记录预检与执行
 *
 * 纯计算：接收已解析的数据，返回预检结果、候选数据与差异；不读写文件、不打印、不退出。
 * 与 zone-check-core.mjs 的分工：后者发现问题，本模块按人工修复记录生成候选。
 */

import {
  metersPerDegree,
  pointInRing,
  pointToPolylineDistanceM,
  ringAreaM2,
  ringSelfIntersections,
  ringSignedAreaM2,
  ringVertices,
  vertexKey,
} from "../../js/geo/zone-geometry.js";

export const SCHEMA_VERSION = 1;

export const ACTIONS = ["snap-shared-boundary", "replace-with-feature"];

const RULING_BASES = ["same-feature", "text-detail", "manual"];

/** 跨学区边界问题视为"有争议"，记录必须写明裁决依据 */
const CONTESTED_ISSUE = /^(overlap-|shared-edge-)/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const isCoord = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  isFiniteNumber(value[0]) &&
  isFiniteNumber(value[1]);

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const isDateLike = (value) => typeof value === "string" && DATE_RE.test(value);

const coordEq = (a, b) => vertexKey(a) === vertexKey(b);

const pushError = (errors, recordId, message) => {
  errors.push({ recordId: recordId ?? null, message });
};

const pushWarning = (warnings, recordId, message) => {
  warnings.push({ recordId: recordId ?? null, message });
};

const zoneIndex = (featureCollection) => {
  const map = new Map();
  for (const feature of featureCollection?.features ?? []) {
    const zoneId = feature?.properties?.zoneId;
    if (zoneId) map.set(zoneId, feature);
  }
  return map;
};

/** 取出单个学区的闭合外环与去重后的顶点序列 */
const ringOf = (feature) => {
  if (feature?.geometry?.type !== "Polygon") return null;
  const ring = feature.geometry.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  return { ring, points: ringVertices(ring) };
};

/** 锚点在顶点序列中出现的全部下标；要求恰好一次 */
const indicesOfCoord = (points, coord) => {
  const key = vertexKey(coord);
  const hits = [];
  for (let i = 0; i < points.length; i += 1) {
    if (vertexKey(points[i]) === key) hits.push(i);
  }
  return hits;
};

const locateAnchors = (points, anchors, label, recordId, errors) => {
  if (!isObject(anchors) || !isCoord(anchors.from) || !isCoord(anchors.to)) {
    pushError(
      errors,
      recordId,
      `${label} 必须是 { from: [经度, 纬度], to: [经度, 纬度] }`,
    );
    return null;
  }
  if (coordEq(anchors.from, anchors.to)) {
    pushError(errors, recordId, `${label} 的 from 与 to 不能是同一坐标`);
    return null;
  }

  const result = {};
  for (const side of ["from", "to"]) {
    const hits = indicesOfCoord(points, anchors[side]);
    if (hits.length === 0) {
      pushError(
        errors,
        recordId,
        `${label}.${side} 不在环上：${vertexKey(anchors[side])}（必须与数据顶点坐标完全一致）`,
      );
      return null;
    }
    if (hits.length > 1) {
      pushError(
        errors,
        recordId,
        `${label}.${side} 在环上出现 ${hits.length} 次，无法唯一寻址，请人工改写`,
      );
      return null;
    }
    const [hit] = hits;
    result[side] = hit;
  }
  return result;
};

/** 沿环的某一方向取出包含两端点的子路径 */
const arcOf = (points, fromIndex, toIndex, forward) => {
  const output = [];
  const count = points.length;
  let index = fromIndex;
  for (;;) {
    output.push(points[index]);
    if (index === toIndex) break;
    index = forward ? (index + 1) % count : (index - 1 + count) % count;
  }
  return output;
};

/** 子路径内部顶点到对方折线的最大距离；锚点本身不参与（由连接边承担） */
const maxDeviationM = (firstRun, secondRun) => {
  let max = 0;
  for (const point of firstRun.slice(1, -1)) {
    max = Math.max(max, pointToPolylineDistanceM(point, secondRun));
  }
  for (const point of secondRun.slice(1, -1)) {
    max = Math.max(max, pointToPolylineDistanceM(point, firstRun));
  }
  return max;
};

/** 校验批次的通用字段；返回 null 表示批次层已经不可继续 */
const checkBatchHeader = (batch, context, errors, warnings) => {
  if (!isObject(batch)) {
    pushError(errors, null, "批次文件必须是 JSON 对象");
    return false;
  }

  if (batch.schemaVersion !== SCHEMA_VERSION) {
    pushError(
      errors,
      null,
      `schemaVersion 必须为 ${SCHEMA_VERSION}（当前为 ${String(batch.schemaVersion)}）`,
    );
  }

  if (typeof batch.batchId !== "string" || batch.batchId.length === 0) {
    pushError(errors, null, "batchId 必须是非空字符串");
  } else if (
    context.fileName &&
    batch.batchId !== context.fileName.replace(/\.json$/i, "")
  ) {
    pushError(
      errors,
      null,
      `batchId 必须与文件名一致：${batch.batchId} != ${context.fileName}`,
    );
  }

  if (batch.createdAt !== undefined && !isDateLike(batch.createdAt)) {
    pushError(errors, null, "createdAt 必须是 YYYY-MM-DD");
  }

  if (batch.baseRelease !== context.currentRelease) {
    pushError(
      errors,
      null,
      `baseRelease 与当前生效版本不一致：${String(batch.baseRelease)} != ${String(context.currentRelease)}`,
    );
  }

  // 版本号可能对应多份内容（发布目录被原地追加文件），必须锁定到具体哈希
  if (typeof batch.baseZonesSha256 !== "string") {
    pushError(
      errors,
      null,
      "baseZonesSha256 必填：记录所依据的 zones.geojson 哈希",
    );
  } else if (!SHA256_RE.test(batch.baseZonesSha256)) {
    pushError(
      errors,
      null,
      "baseZonesSha256 必须形如 sha256:<64 位小写十六进制>",
    );
  } else if (typeof context.zonesSha256 !== "string") {
    pushError(
      errors,
      null,
      "无法校验 baseZonesSha256：当前快照未提供 zones.geojson 哈希",
    );
  } else if (batch.baseZonesSha256 !== context.zonesSha256) {
    pushError(
      errors,
      null,
      `baseZonesSha256 与当前 zones.geojson 不一致：${batch.baseZonesSha256} != ${context.zonesSha256}`,
    );
  }

  const existing = context.existingBatchIds ?? [];
  if (typeof batch.batchId === "string" && existing.includes(batch.batchId)) {
    pushError(errors, null, `batchId 与其他批次重复：${batch.batchId}`);
  }

  if (!Array.isArray(batch.records) || batch.records.length === 0) {
    pushError(errors, null, "records 必须是非空数组");
  }

  if (batch.note !== undefined && typeof batch.note !== "string") {
    pushError(errors, null, "note 必须是字符串");
  }

  if (batch.expectedAddressChanges !== undefined) {
    if (!Array.isArray(batch.expectedAddressChanges)) {
      pushError(errors, null, "expectedAddressChanges 必须是数组");
    } else {
      batch.expectedAddressChanges.forEach((entry, index) => {
        const label = `expectedAddressChanges[${index}]`;
        if (!isObject(entry) || typeof entry.addressId !== "string") {
          pushError(errors, null, `${label}.addressId 必须是字符串`);
          return;
        }
        for (const side of ["from", "to"]) {
          if (
            !Array.isArray(entry[side]) ||
            entry[side].some((zoneId) => typeof zoneId !== "string")
          ) {
            pushError(errors, null, `${label}.${side} 必须是学区 ID 数组`);
          }
        }
      });
    }
  }

  if (
    batch.featuresSha256 !== undefined &&
    typeof batch.featuresSha256 !== "string"
  ) {
    pushError(errors, null, "featuresSha256 必须是字符串");
  }

  if (
    batch.records?.some?.((record) => record?.action === "replace-with-feature")
  ) {
    if (typeof batch.featuresSha256 !== "string") {
      pushError(errors, null, "含 L2 记录的批次必须提供 featuresSha256");
    } else if (
      context.featuresSha256 &&
      batch.featuresSha256 !== context.featuresSha256
    ) {
      pushError(
        errors,
        null,
        `featuresSha256 与当前骨架线不一致：${batch.featuresSha256} != ${context.featuresSha256}`,
      );
    }
  } else if (
    batch.featuresSha256 &&
    context.featuresSha256 &&
    batch.featuresSha256 !== context.featuresSha256
  ) {
    pushWarning(
      warnings,
      null,
      "批次声明的 featuresSha256 与当前骨架线不一致（本批无 L2 记录）",
    );
  }

  return Array.isArray(batch.records) && batch.records.length > 0;
};

const issueIndex = (checkReport) => {
  const map = new Map();
  for (const issue of checkReport?.issues ?? []) map.set(issue.issueId, issue);
  return map;
};

const checkRecordCommon = (record, context, errors) => {
  const recordId = record?.recordId;
  if (!isObject(record)) {
    pushError(errors, null, "record 必须是对象");
    return null;
  }
  if (typeof recordId !== "string" || recordId.length === 0) {
    pushError(errors, null, "recordId 必须是非空字符串");
    return null;
  }
  if (!ACTIONS.includes(record.action)) {
    pushError(
      errors,
      recordId,
      `action 非法：${String(record.action)}（允许 ${ACTIONS.join(" / ")}）`,
    );
    return null;
  }
  if (typeof record.issueId !== "string" || record.issueId.length === 0) {
    pushError(errors, recordId, "issueId 必须是非空字符串");
    return null;
  }
  if (typeof record.zoneId !== "string" || record.zoneId.length === 0) {
    pushError(errors, recordId, "zoneId 必须是非空字符串");
    return null;
  }
  if (!context.zones.has(record.zoneId)) {
    pushError(errors, recordId, `zoneId 不存在：${record.zoneId}`);
    return null;
  }

  const issue = context.issues.get(record.issueId);
  if (!issue) {
    pushError(
      errors,
      recordId,
      `issueId 已过期或不存在：${record.issueId}（请重新运行 check:zones）`,
    );
  } else if (!issue.zoneIds?.includes(record.zoneId)) {
    pushError(
      errors,
      recordId,
      `issueId 不涉及 zoneId：${record.issueId} 不含 ${record.zoneId}`,
    );
  }

  if (
    CONTESTED_ISSUE.test(issue?.type ?? "") ||
    CONTESTED_ISSUE.test(record.issueId)
  ) {
    if (!isObject(record.ruling)) {
      pushError(errors, recordId, "跨学区边界问题必须提供 ruling");
    } else if (!RULING_BASES.includes(record.ruling.basis)) {
      pushError(
        errors,
        recordId,
        `ruling.basis 非法：${String(record.ruling.basis)}（允许 ${RULING_BASES.join(" / ")}）`,
      );
    }
  }

  if (
    !isObject(record.evidence) ||
    typeof record.evidence.sourceName !== "string"
  ) {
    pushError(errors, recordId, "evidence.sourceName 必填");
  }
  if (
    !isObject(record.evidence) ||
    typeof record.evidence.excerpt !== "string"
  ) {
    pushError(errors, recordId, "evidence.excerpt 必填");
  }
  if (
    typeof record.confirmedBy !== "string" ||
    record.confirmedBy.length === 0
  ) {
    pushError(errors, recordId, "confirmedBy 必填");
  }
  if (!isDateLike(record.confirmedAt)) {
    pushError(errors, recordId, "confirmedAt 必须是 YYYY-MM-DD");
  }

  const { expected } = record;
  if (!isObject(expected)) {
    pushError(errors, recordId, "expected 必填");
  } else {
    const delta = expected.areaDeltaM2;
    if (
      !Array.isArray(delta) ||
      delta.length !== 2 ||
      !delta.every(isFiniteNumber) ||
      delta[0] > delta[1]
    ) {
      pushError(
        errors,
        recordId,
        "expected.areaDeltaM2 必须是 [下限, 上限] 且下限不大于上限",
      );
    }
    if (!isPositiveInteger(expected.pointCount)) {
      pushError(errors, recordId, "expected.pointCount 必须是正整数");
    }
  }

  return record;
};

const checkL1 = (record, context, errors) => {
  const { recordId } = record;
  if (typeof record.referenceZoneId !== "string") {
    pushError(errors, recordId, "L1 记录必须提供 referenceZoneId");
    return null;
  }
  if (record.referenceZoneId === record.zoneId) {
    pushError(errors, recordId, "referenceZoneId 不能与 zoneId 相同");
    return null;
  }
  const referenceFeature = context.zones.get(record.referenceZoneId);
  if (!referenceFeature) {
    pushError(
      errors,
      recordId,
      `referenceZoneId 不存在：${record.referenceZoneId}`,
    );
    return null;
  }

  const targetFeature = context.zones.get(record.zoneId);
  if (
    targetFeature.properties?.stage !== referenceFeature.properties?.stage ||
    targetFeature.properties?.year !== referenceFeature.properties?.year
  ) {
    pushError(errors, recordId, "参照学区必须与被修改学区同 stage、同 year");
    return null;
  }

  if (
    !isObject(record.guards) ||
    !isFiniteNumber(record.guards.maxDeviationM)
  ) {
    pushError(errors, recordId, "L1 记录必须提供 guards.maxDeviationM");
    return null;
  }
  if (record.guards.maxDeviationM < 0) {
    pushError(errors, recordId, "guards.maxDeviationM 不能为负数");
    return null;
  }

  const target = ringOf(targetFeature);
  const reference = ringOf(referenceFeature);
  if (!target) {
    pushError(errors, recordId, `被修改学区几何不可编辑：${record.zoneId}`);
    return null;
  }
  if (!reference) {
    pushError(
      errors,
      recordId,
      `参照学区几何不可编辑：${record.referenceZoneId}`,
    );
    return null;
  }

  const targetAnchors = locateAnchors(
    target.points,
    record.anchors,
    "anchors",
    recordId,
    errors,
  );
  if (!targetAnchors) return null;

  const referenceAnchors = record.referenceAnchors ?? record.anchors;
  const referenceLocated = locateAnchors(
    reference.points,
    referenceAnchors,
    "referenceAnchors",
    recordId,
    errors,
  );
  if (!referenceLocated) return null;

  const { from: fromIndex, to: toIndex } = targetAnchors;
  const { from: refFrom, to: refTo } = referenceLocated;

  // 被替换子路径不能包含环首点，保证环起点不变
  if (Math.min(fromIndex, toIndex) === 0) {
    pushError(
      errors,
      recordId,
      "被替换子路径包含环首点（ring[0]），v1 不支持；请调整记录锚点或数据起点",
    );
    return null;
  }

  const forward = fromIndex < toIndex;
  const targetRun = arcOf(target.points, fromIndex, toIndex, forward);

  // 参照子路径有两个方向，取与被替换路径偏离更小的一侧
  const candidates = [
    { forward: true, run: arcOf(reference.points, refFrom, refTo, true) },
    { forward: false, run: arcOf(reference.points, refFrom, refTo, false) },
  ].map((candidate) => ({
    ...candidate,
    deviationM: maxDeviationM(targetRun, candidate.run),
  }));
  const chosenReference =
    candidates[0].deviationM <= candidates[1].deviationM
      ? candidates[0]
      : candidates[1];

  if (chosenReference.deviationM > record.guards.maxDeviationM) {
    pushError(
      errors,
      recordId,
      `实测最大偏离 ${chosenReference.deviationM.toFixed(2)} m 超过 guards.maxDeviationM ${record.guards.maxDeviationM} m`,
    );
    return null;
  }

  return {
    recordId,
    action: record.action,
    zoneId: record.zoneId,
    referenceZoneId: record.referenceZoneId,
    issueId: record.issueId,
    expected: record.expected,
    forward,
    fromIndex,
    toIndex,
    targetRun,
    zoneAnchors: { from: targetRun[0], to: targetRun[targetRun.length - 1] },
    referenceRun: chosenReference.run,
    referenceForward: chosenReference.forward,
    maxDeviationM: chosenReference.deviationM,
  };
};

/**
 * 骨架线上的交点裁剪（replace-with-feature）
 * 与 L1 的区别：L2 的端点是"环边 × 骨架线"的交点，是记录里写明的精确坐标；
 * 中间整段复用骨架线折线，因此会引入新坐标，且两侧学区共用同一交点与同一条折线。
 */

/** 点到折线的最近点：返回段号、段内参数与偏移（米） */
const nearestOnPolyline = (line, target) => {
  if (!Array.isArray(line) || line.length < 2) return null;
  let best = null;
  for (let seg = 0; seg < line.length - 1; seg += 1) {
    const a = line[seg];
    const b = line[seg + 1];
    const { lng, lat } = metersPerDegree((target[1] + a[1] + b[1]) / 3);
    const bx = (b[0] - a[0]) * lng;
    const by = (b[1] - a[1]) * lat;
    const px = (target[0] - a[0]) * lng;
    const py = (target[1] - a[1]) * lat;
    const lengthSquared = bx * bx + by * by;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
    const offsetM = Math.hypot(px - t * bx, py - t * by);
    if (!best || offsetM < best.offsetM) best = { seg, t, offsetM };
  }
  return best;
};

/** 点到环（闭合折线）的最近点：seg 为边的起点下标 */
const nearestOnRing = (points, target) => {
  const count = points.length;
  let best = null;
  for (let seg = 0; seg < count; seg += 1) {
    const near = nearestOnPolyline(
      [points[seg], points[(seg + 1) % count]],
      target,
    );
    if (!near) continue;
    if (!best || near.offsetM < best.offsetM) {
      best = { seg, t: near.t, offsetM: near.offsetM };
    }
  }
  return best;
};

/** 骨架线上的位置；落在顶点上时吸附为整数，避免同一顶点被当成两段的中点 */
const featurePosition = (line, cut) => {
  const near = nearestOnPolyline(line, cut);
  if (!near) return null;
  if (near.t < 1e-9) return { order: near.seg, offsetM: near.offsetM };
  if (near.t > 1 - 1e-9) {
    return { order: near.seg + 1, offsetM: near.offsetM };
  }
  return { order: near.seg + near.t, offsetM: near.offsetM };
};

/** 沿环按分数位置取弧：从 startPos 前进 distance，返回途经顶点（不含两端） */
const arcVertices = (points, startPos, distance) => {
  const count = points.length;
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const offset = (i - startPos + count) % count;
    if (offset > 0 && offset < distance)
      entries.push({ offset, point: points[i] });
  }
  entries.sort((a, b) => a.offset - b.offset);
  return entries.map((entry) => entry.point);
};

/** 骨架线在两个交点之间的顶点（不含交点本身），按 from→to 的顺序 */
const interiorBetween = (line, fromOrder, toOrder) => {
  const low = Math.min(fromOrder, toOrder);
  const high = Math.max(fromOrder, toOrder);
  const indices = [];
  for (let i = 0; i < line.length; i += 1) {
    if (i > low && i < high) indices.push(i);
  }
  if (fromOrder > toOrder) indices.reverse();
  return indices.map((i) => line[i]);
};

/** 候选环弧上各顶点到骨架线折线的最大距离 */
const arcDeviationM = (arc, line) => {
  let max = 0;
  for (const point of arc) {
    max = Math.max(max, pointToPolylineDistanceM(point, line));
  }
  return max;
};

const checkL2 = (record, context, errors) => {
  const { recordId } = record;
  if (typeof record.featureId !== "string") {
    pushError(errors, recordId, "L2 记录必须提供 featureId");
    return null;
  }
  if (!context.referenceFeatures) {
    pushError(errors, recordId, "骨架线文件不存在，无法校验 L2 记录");
    return null;
  }

  const feature = (context.referenceFeatures.features ?? []).find(
    (item) => item.properties?.featureId === record.featureId,
  );
  if (!feature) {
    pushError(errors, recordId, `featureId 不存在：${record.featureId}`);
    return null;
  }
  if (feature.properties?.geometryStatus !== "ready") {
    pushError(
      errors,
      recordId,
      `骨架线未就绪：${record.featureId}（geometryStatus=${String(feature.properties?.geometryStatus)}）`,
    );
    return null;
  }
  if (feature.geometry?.type !== "LineString") {
    pushError(
      errors,
      recordId,
      `v1 只支持 LineString 骨架线，当前为 ${String(feature.geometry?.type)}`,
    );
    return null;
  }

  if (
    !isObject(record.guards) ||
    !isFiniteNumber(record.guards.maxCutOffsetM)
  ) {
    pushError(errors, recordId, "L2 记录必须提供 guards.maxCutOffsetM");
    return null;
  }
  if (record.guards.maxCutOffsetM < 0) {
    pushError(errors, recordId, "guards.maxCutOffsetM 不能为负数");
    return null;
  }
  const toleranceM = record.guards.maxCutOffsetM;

  if (
    !isObject(record.cuts) ||
    !isCoord(record.cuts.from) ||
    !isCoord(record.cuts.to)
  ) {
    pushError(
      errors,
      recordId,
      "cuts 必须是 { from: [经度, 纬度], to: [经度, 纬度] }（环边与骨架线的交点）",
    );
    return null;
  }
  if (coordEq(record.cuts.from, record.cuts.to)) {
    pushError(errors, recordId, "cuts 的 from 与 to 不能是同一坐标");
    return null;
  }

  const target = ringOf(context.zones.get(record.zoneId));
  if (!target) {
    pushError(errors, recordId, `被修改学区几何不可编辑：${record.zoneId}`);
    return null;
  }
  const line = feature.geometry.coordinates ?? [];
  if (line.length < 2) {
    pushError(errors, recordId, `骨架线没有有效坐标：${record.featureId}`);
    return null;
  }

  const located = {};
  const featureOrders = {};
  let maxCutOffsetM = 0;
  for (const side of ["from", "to"]) {
    const cut = record.cuts[side];
    const onRing = nearestOnRing(target.points, cut);
    if (!onRing) {
      pushError(errors, recordId, `无法定位 cuts.${side}：环顶点不足`);
      return null;
    }
    if (onRing.offsetM > toleranceM) {
      pushError(
        errors,
        recordId,
        `cuts.${side} 距环 ${onRing.offsetM.toFixed(2)} m，超过 guards.maxCutOffsetM ${toleranceM} m`,
      );
      return null;
    }
    const onFeature = featurePosition(line, cut);
    if (!onFeature || onFeature.offsetM > toleranceM) {
      pushError(
        errors,
        recordId,
        `cuts.${side} 距骨架线 ${(onFeature?.offsetM ?? Number.NaN).toFixed(2)} m，超过 guards.maxCutOffsetM ${toleranceM} m`,
      );
      return null;
    }
    located[side] = onRing;
    featureOrders[side] = onFeature.order;
    maxCutOffsetM = Math.max(maxCutOffsetM, onRing.offsetM, onFeature.offsetM);
  }

  if (located.from.seg === located.to.seg) {
    pushError(
      errors,
      recordId,
      "两个交点落在同一条环边上，v1 不支持；请检查交点坐标",
    );
    return null;
  }

  const featureInterior = interiorBetween(
    line,
    featureOrders.from,
    featureOrders.to,
  );
  const run = [record.cuts.from, ...featureInterior, record.cuts.to];

  // 两个交点把环分成两段，取更贴近骨架线的一段替换；另一端原样保留
  const count = target.points.length;
  const fromPos = located.from.seg + located.from.t;
  const toPos = located.to.seg + located.to.t;
  const forwardDistance = (toPos - fromPos + count) % count;
  const forwardArc = arcVertices(target.points, fromPos, forwardDistance);
  const backwardArc = arcVertices(
    target.points,
    toPos,
    count - forwardDistance,
  );
  const ringForward =
    arcDeviationM(forwardArc, run) <= arcDeviationM(backwardArc, run);
  if (forwardDistance < 1e-9 || count - forwardDistance < 1e-9) {
    pushError(errors, recordId, "两个交点在环上位置重合，无法裁剪");
    return null;
  }

  return {
    recordId,
    action: record.action,
    zoneId: record.zoneId,
    featureId: record.featureId,
    issueId: record.issueId,
    expected: record.expected,
    cuts: { from: record.cuts.from, to: record.cuts.to },
    featureInterior,
    ringForward,
    cutToleranceM: toleranceM,
    maxCutOffsetM,
    fromIndex: located.from.seg,
    toIndex: located.to.seg,
    targetRun: run,
  };
};

/** 同一 zone 的多条记录：被替换区间不得重叠 */
const checkIntervalOverlap = (plans, errors) => {
  const byZone = new Map();
  for (const plan of plans) {
    if (!byZone.has(plan.zoneId)) byZone.set(plan.zoneId, []);
    byZone.get(plan.zoneId).push(plan);
  }

  for (const [zoneId, zonePlans] of byZone) {
    const intervals = zonePlans
      .map((plan) => ({
        plan,
        start: Math.min(plan.fromIndex, plan.toIndex),
        end: Math.max(plan.fromIndex, plan.toIndex),
      }))
      .sort((x, y) => x.start - y.start || x.end - y.end);

    for (let i = 0; i < intervals.length; i += 1) {
      for (let j = i + 1; j < intervals.length; j += 1) {
        const a = intervals[i];
        const b = intervals[j];
        if (b.start < a.end) {
          pushError(
            errors,
            b.plan.recordId,
            `同一学区 ${zoneId} 的记录锚点区间重叠：${a.plan.recordId} 与 ${b.plan.recordId}`,
          );
        }
      }
    }
  }
};

/**
 * 批次预检
 * @param {object} batch 已解析的修复记录
 * @param {object} context 当前数据快照与报告
 * @returns {{ errors: Array, warnings: Array, plans: Array }}
 */
export const precheckBatch = (batch, context = {}) => {
  const errors = [];
  const warnings = [];
  const plans = [];

  const normalized = {
    fileName: context.fileName,
    currentRelease: context.currentRelease,
    existingBatchIds: context.existingBatchIds ?? [],
    zones: zoneIndex(context.zones),
    issues: issueIndex(context.checkReport),
    referenceFeatures: context.referenceFeatures ?? null,
    featuresSha256: context.featuresSha256 ?? null,
    zonesSha256: context.zonesSha256 ?? null,
  };

  if (!checkBatchHeader(batch, normalized, errors, warnings)) {
    return { errors, warnings, plans };
  }

  const recordIds = new Set();
  for (const record of batch.records) {
    const checked = checkRecordCommon(record, normalized, errors);
    if (!checked) continue;

    if (recordIds.has(checked.recordId)) {
      pushError(errors, checked.recordId, `recordId 重复：${checked.recordId}`);
      continue;
    }
    recordIds.add(checked.recordId);

    const plan =
      checked.action === "snap-shared-boundary"
        ? checkL1(checked, normalized, errors)
        : checkL2(checked, normalized, errors);
    if (plan) plans.push(plan);
  }

  checkIntervalOverlap(plans, errors);

  // 参照学区若在同一批次内也被修改，替换路径会与最终几何不一致
  const modifiedZones = new Set(plans.map((plan) => plan.zoneId));
  for (const plan of plans) {
    if (plan.referenceZoneId && modifiedZones.has(plan.referenceZoneId)) {
      pushError(
        errors,
        plan.recordId,
        `参照学区 ${plan.referenceZoneId} 在同一批次内也被修改，v1 不支持`,
      );
    }
  }

  return { errors, warnings, plans };
};

/** L1：按环顶点区间替换；返回新环（含闭合点） */
const spliceRing = (plan, points) => {
  const { forward, fromIndex, toIndex, referenceRun } = plan;
  const replacement = forward ? referenceRun : [...referenceRun].reverse();

  const next = forward
    ? [
        ...points.slice(0, fromIndex),
        ...replacement,
        ...points.slice(toIndex + 1),
      ]
    : [
        ...points.slice(0, toIndex),
        ...replacement,
        ...points.slice(fromIndex + 1),
      ];

  return {
    points: next,
    ring: [...next, next[0]],
  };
};

/** L2：用两个交点裁掉环上的一段，中间整段换成骨架线折线 */
const spliceCutRing = (plan, points, located) => {
  const { cuts, featureInterior, ringForward } = plan;
  const count = points.length;
  const fromPos = located.from.seg + located.from.t;
  const toPos = located.to.seg + located.to.t;
  const forwardDistance = (toPos - fromPos + count) % count;

  // 环是定向的：替换段必须按环的前进方向书写，否则环绕向会翻转
  if (ringForward) {
    const kept = arcVertices(points, toPos, count - forwardDistance);
    const next = [cuts.from, ...featureInterior, cuts.to, ...kept];
    return { points: next, ring: [...next, next[0]] };
  }

  const kept = arcVertices(points, fromPos, forwardDistance);
  const next = [cuts.to, ...[...featureInterior].reverse(), cuts.from, ...kept];
  return { points: next, ring: [...next, next[0]] };
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const zonesContaining = (featureCollection, point) => {
  const hits = [];
  for (const feature of featureCollection.features ?? []) {
    if (feature?.geometry?.type !== "Polygon") continue;
    if (pointInRing(point, feature.geometry.coordinates[0]).inside) {
      hits.push(feature.properties?.zoneId);
    }
  }
  return hits.filter(Boolean).sort();
};

const addressChangesOf = (before, after, addressPoints) => {
  const changes = [];
  for (const address of addressPoints ?? []) {
    if (!isFiniteNumber(address.lng) || !isFiniteNumber(address.lat)) continue;
    const point = [address.lng, address.lat];
    const from = zonesContaining(before, point);
    const to = zonesContaining(after, point);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ addressId: address.addressId, from, to });
  }
  return changes;
};

/**
 * 执行已通过预检的批次
 * @returns {{ candidate: object | null, diffs: Array, addressChanges: Array, errors: Array }}
 */
export const executeBatch = (batch, plans, context = {}) => {
  const errors = [];
  const diffs = [];
  const candidate = deepClone(context.zones);

  const sorted = [...plans].sort(
    (x, y) =>
      x.zoneId.localeCompare(y.zoneId) || x.recordId.localeCompare(y.recordId),
  );

  for (const plan of sorted) {
    const feature = candidate.features.find(
      (item) => item.properties?.zoneId === plan.zoneId,
    );
    const current = ringOf(feature);
    if (!current) {
      pushError(errors, plan.recordId, `候选数据中找不到学区：${plan.zoneId}`);
      continue;
    }

    const beforeArea = ringAreaM2(current.ring);
    const beforeCount = current.points.length;
    const beforeSign = Math.sign(ringSignedAreaM2(current.ring));

    let spliced;
    if (plan.action === "replace-with-feature") {
      // 同一批次内前序记录可能改变环下标，交点按坐标重新定位
      const locatedCuts = {};
      for (const side of ["from", "to"]) {
        const near = nearestOnRing(current.points, plan.cuts[side]);
        if (!near || near.offsetM > plan.cutToleranceM) {
          pushError(
            errors,
            plan.recordId,
            `执行时 cuts.${side} 距环 ${near ? near.offsetM.toFixed(2) : "未知"} m，超过 guards.maxCutOffsetM ${plan.cutToleranceM} m`,
          );
          break;
        }
        locatedCuts[side] = near;
      }
      if (!locatedCuts.from || !locatedCuts.to) continue;
      if (locatedCuts.from.seg === locatedCuts.to.seg) {
        pushError(
          errors,
          plan.recordId,
          "执行时两个交点落在同一条环边上，拒绝生成候选",
        );
        continue;
      }
      spliced = spliceCutRing(plan, current.points, locatedCuts);
    } else {
      // 同一批次内前序记录可能改变下标，按锚点坐标重新定位
      const located = locateAnchors(
        current.points,
        plan.zoneAnchors,
        "anchors（执行）",
        plan.recordId,
        errors,
      );
      if (!located) continue;
      spliced = spliceRing(
        {
          ...plan,
          forward: located.from < located.to,
          fromIndex: located.from,
          toIndex: located.to,
        },
        current.points,
      );
    }
    const { points, ring } = spliced;

    const afterArea = ringAreaM2(ring);
    const deltaArea = afterArea - beforeArea;
    const [low, high] = plan.expected.areaDeltaM2;

    if (ringSelfIntersections(ring).length > 0) {
      pushError(errors, plan.recordId, "替换后环出现自相交，拒绝生成候选");
      continue;
    }
    if (Math.sign(ringSignedAreaM2(ring)) !== beforeSign) {
      pushError(errors, plan.recordId, "替换后环绕向改变，拒绝生成候选");
      continue;
    }
    if (points.length !== plan.expected.pointCount) {
      pushError(
        errors,
        plan.recordId,
        `替换后顶点数 ${points.length} 与 expected.pointCount ${plan.expected.pointCount} 不符`,
      );
      continue;
    }
    if (deltaArea < low || deltaArea > high) {
      pushError(
        errors,
        plan.recordId,
        `面积变化 ${deltaArea.toFixed(2)} m² 不在 expected.areaDeltaM2 [${low}, ${high}] 内`,
      );
      continue;
    }

    feature.geometry.coordinates[0] = ring;
    diffs.push({
      recordId: plan.recordId,
      zoneId: plan.zoneId,
      referenceZoneId: plan.referenceZoneId ?? null,
      featureId: plan.featureId ?? null,
      action: plan.action,
      issueId: plan.issueId,
      areaBeforeM2: Number(beforeArea.toFixed(2)),
      areaAfterM2: Number(afterArea.toFixed(2)),
      areaDeltaM2: Number(deltaArea.toFixed(2)),
      pointCountBefore: beforeCount,
      pointCountAfter: points.length,
      ringStartChanged: vertexKey(current.points[0]) !== vertexKey(points[0]),
      maxDeviationM:
        plan.maxDeviationM === undefined
          ? null
          : Number(plan.maxDeviationM.toFixed(2)),
      cutOffsetM:
        plan.maxCutOffsetM === undefined
          ? null
          : Number(plan.maxCutOffsetM.toFixed(2)),
      changedBbox: bboxOf(
        plan.action === "replace-with-feature"
          ? plan.targetRun
          : [...plan.targetRun, ...plan.referenceRun],
      ),
    });
  }

  if (errors.length > 0) {
    return { candidate: null, diffs, addressChanges: [], errors };
  }

  const addressChanges = addressChangesOf(
    context.zones,
    candidate,
    context.addressPoints,
  );
  const expected = batch.expectedAddressChanges ?? [];
  for (const change of addressChanges) {
    const entry = expected.find((item) => item.addressId === change.addressId);
    if (!entry) {
      pushError(
        errors,
        null,
        `地址 ${change.addressId} 归属发生变化但未在 expectedAddressChanges 登记`,
      );
      continue;
    }
    if (
      JSON.stringify([...(entry.from ?? [])].sort()) !==
        JSON.stringify(change.from) ||
      JSON.stringify([...(entry.to ?? [])].sort()) !== JSON.stringify(change.to)
    ) {
      pushError(
        errors,
        null,
        `地址 ${change.addressId} 的归属变化与登记不一致`,
      );
    }
  }
  if (errors.length > 0) {
    return { candidate: null, diffs, addressChanges, errors };
  }

  return { candidate, diffs, addressChanges, errors };
};

/** 坐标集合的包围盒（保留 7 位小数） */
const bboxOf = (coords) => {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat].map((value) =>
    Number(value.toFixed(7)),
  );
};
