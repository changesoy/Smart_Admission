/**
 * zone-check-core.mjs - 学区边界检查核心
 *
 * 纯计算：接收已解析的 GeoJSON，返回问题清单，不读写文件、不打印、不退出。
 * 与 validate-core.mjs 的分工：后者查结构与引用，本模块查几何关系。
 */

import {
  BOUNDARY_EPS_M,
  distanceM,
  metersPerDegree,
  pointInRing,
  pointToPolylineDistanceM,
  ringAreaM2,
  ringSelfIntersections,
  ringVertices,
  segmentIntersection,
  vertexKey,
} from "../../js/geo/zone-geometry.js";

/** 默认判定参数；容差只用于归类"近似共边"，不用于修改几何 */
export const DEFAULT_OPTIONS = {
  sharedEdgeToleranceM: 1,
  containmentToleranceM: 1,
  duplicateVertexToleranceM: 0.5,
  maxCrossingsPerPair: 20,
  areaCellSizeM: 1,
  maxAreaCells: 400000,
  areaReportThresholdM2: 250,
  areaNearThresholdM2: 200,
};

/** 参与试点排序的问题类型 */
const GEOMETRIC_TYPES = new Set([
  "overlap-crossing",
  "overlap-containment",
  "shared-edge-overlap",
  "shared-edge-gap",
]);

const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/** 坐标取到 1e-7 度后参与哈希，保证同一问题跨次运行编号稳定 */
const locationKey = (coord) =>
  coord ? `${coord[0].toFixed(7)},${coord[1].toFixed(7)}` : "-";

const issueIdOf = (type, zoneIds, parts) =>
  `${type}:${zoneIds.join("|")}:${fnv1a(parts.join(";"))}`;

const createIssue = ({
  type,
  zoneIds,
  stage,
  year,
  widthM = 0,
  location = null,
  detail = {},
}) => ({
  issueId: issueIdOf(type, zoneIds, [
    locationKey(location),
    widthM.toFixed(2),
    JSON.stringify(detail),
  ]),
  type,
  zoneIds,
  stage,
  year,
  widthM,
  location,
  detail,
});

/** 结构检查：单个学区自身的环问题 */
const checkStructure = (feature, options, issues) => {
  const { properties: props = {} } = feature;
  const zoneIds = [props.zoneId];
  const base = { zoneIds, stage: props.stage, year: props.year };
  const { geometry } = feature;

  if (!geometry || !geometry.type) {
    issues.push(
      createIssue({
        ...base,
        type: "missing-geometry",
        detail: { reason: "缺少几何" },
      }),
    );
    return null;
  }

  if (geometry.type !== "Polygon") {
    issues.push(
      createIssue({
        ...base,
        type: "unsupported-geometry",
        detail: { geometryType: geometry.type },
      }),
    );
    return null;
  }

  const rings = geometry.coordinates ?? [];
  const [outer] = rings;
  if (!Array.isArray(outer) || outer.length === 0) {
    issues.push(
      createIssue({
        ...base,
        type: "missing-geometry",
        detail: { reason: "外环为空" },
      }),
    );
    return null;
  }

  if (rings.length > 1) {
    issues.push(
      createIssue({
        ...base,
        type: "unsupported-geometry",
        location: outer[0],
        detail: { reason: "含内环（孔洞）", holeCount: rings.length - 1 },
      }),
    );
  }

  const points = ringVertices(outer);
  if (points.length < 4) {
    issues.push(
      createIssue({
        ...base,
        type: "degenerate-ring",
        location: points[0] ?? null,
        detail: { reason: "顶点数不足", pointCount: points.length },
      }),
    );
    return null;
  }

  const areaM2 = ringAreaM2(outer);
  if (areaM2 < 1) {
    issues.push(
      createIssue({
        ...base,
        type: "degenerate-ring",
        location: points[0],
        detail: { reason: "面积近似为零", areaM2: Number(areaM2.toFixed(3)) },
      }),
    );
  }

  // 连续重复或近重复顶点会产生零长边与伪自相交，单独报告
  const duplicates = [];
  let maxDuplicateM = 0;
  for (let i = 1; i < points.length; i += 1) {
    const gap = distanceM(points[i - 1], points[i]);
    if (gap > options.duplicateVertexToleranceM) continue;
    duplicates.push([i - 1, i]);
    maxDuplicateM = Math.max(maxDuplicateM, gap);
  }
  if (duplicates.length > 0) {
    issues.push(
      createIssue({
        ...base,
        type: "duplicate-vertex",
        widthM: maxDuplicateM,
        location: points[duplicates[0][1]],
        detail: { count: duplicates.length, pairs: duplicates.slice(0, 10) },
      }),
    );
  }

  // 自相交在折叠近重复顶点后的环上判断，避免把 0.3 m 级折返当成拓扑自交
  const collapsed = [];
  for (const point of points) {
    const previous = collapsed[collapsed.length - 1];
    if (
      !previous ||
      distanceM(previous, point) > options.duplicateVertexToleranceM
    ) {
      collapsed.push(point);
    }
  }

  const selfIntersections = ringSelfIntersections(collapsed);
  if (selfIntersections.length > 0) {
    issues.push(
      createIssue({
        ...base,
        type: "self-intersection",
        location: selfIntersections[0].point ?? collapsed[0],
        detail: {
          count: selfIntersections.length,
          points: selfIntersections
            .slice(0, 3)
            .map((item) => item.point ?? null),
        },
      }),
    );
  }

  return {
    zoneId: props.zoneId,
    zoneName: props.zoneName,
    stage: props.stage,
    year: props.year,
    outer,
    points,
  };
};

/** 从一个环中找出与参考环近似共边的连续顶点段 */
const findSharedRuns = (fromPoints, referenceRing, toleranceM) => {
  const flags = fromPoints.map(
    (point) => pointToPolylineDistanceM(point, referenceRing) <= toleranceM,
  );
  if (!flags.some(Boolean)) return [];
  if (flags.every(Boolean)) return [fromPoints.map((_, index) => index)];

  const startIndex = flags.indexOf(false);
  const runs = [];
  let current = [];
  for (let k = 0; k < fromPoints.length; k += 1) {
    const index = (startIndex + k) % fromPoints.length;
    if (flags[index]) {
      current.push(index);
      continue;
    }
    if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);

  return runs.filter((run) => run.length >= 2);
};

/** 坐标集合的包围盒 [minLng, minLat, maxLng, maxLat] */
const bboxOfCoords = (coords) => {
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
  return [minLng, minLat, maxLng, maxLat];
};

const expandBboxM = (bbox, meters) => {
  const scale = metersPerDegree((bbox[1] + bbox[3]) / 2);
  return [
    bbox[0] - meters / scale.lng,
    bbox[1] - meters / scale.lat,
    bbox[2] + meters / scale.lng,
    bbox[3] + meters / scale.lat,
  ];
};

const intersectBbox = (x, y) => {
  const bbox = [
    Math.max(x[0], y[0]),
    Math.max(x[1], y[1]),
    Math.min(x[2], y[2]),
    Math.min(x[3], y[3]),
  ];
  return bbox[0] <= bbox[2] && bbox[1] <= bbox[3] ? bbox : null;
};

/** 两个学区顶点包围盒的交集 */
const pairBboxOf = (first, second) =>
  intersectBbox(bboxOfCoords(first.points), bboxOfCoords(second.points));

/**
 * 在包围盒内用网格估算两环重叠面积
 * 返回估算面积、实际格距与不确定度；格子数超过上限时逐级放大格距。
 */
const estimateOverlapAreaM2 = (bbox, first, second, options) => {
  const scale = metersPerDegree((bbox[1] + bbox[3]) / 2);
  const widthM = (bbox[2] - bbox[0]) * scale.lng;
  const heightM = (bbox[3] - bbox[1]) * scale.lat;
  let cellSizeM = options.areaCellSizeM;
  let cols = 1;
  let rows = 1;
  for (;;) {
    cols = Math.max(1, Math.ceil(widthM / cellSizeM));
    rows = Math.max(1, Math.ceil(heightM / cellSizeM));
    if (cols * rows <= options.maxAreaCells || cellSizeM >= 64) break;
    cellSizeM *= 2;
  }

  let count = 0;
  const stepLng = (bbox[2] - bbox[0]) / cols;
  const stepLat = (bbox[3] - bbox[1]) / rows;
  for (let i = 0; i < cols; i += 1) {
    const lng = bbox[0] + (i + 0.5) * stepLng;
    for (let j = 0; j < rows; j += 1) {
      const point = [lng, bbox[1] + (j + 0.5) * stepLat];
      if (!pointInRing(point, first.outer).inside) continue;
      if (!pointInRing(point, second.outer).inside) continue;
      count += 1;
    }
  }

  const cellAreaM2 = (widthM / cols) * (heightM / rows);
  const uncertaintyM2 =
    (widthM + heightM) * Math.max(widthM / cols, heightM / rows);
  return {
    areaM2: count * cellAreaM2,
    cellSizeM: Math.max(widthM / cols, heightM / rows),
    areaUncertaintyM2: uncertaintyM2,
  };
};

/** 生成冲突块并标记汇报级别 */
const createBlock = ({
  kind,
  zoneIds,
  bbox,
  location,
  relatedIssueIds,
  first,
  second,
  options,
}) => {
  const estimate = estimateOverlapAreaM2(bbox, first, second, options);
  const areaM2 = Number(estimate.areaM2.toFixed(1));
  const reportLevel =
    areaM2 >= options.areaReportThresholdM2
      ? "required"
      : areaM2 >= options.areaNearThresholdM2
        ? "near-threshold"
        : "info";
  return {
    blockId: `block:${zoneIds.join("|")}:${fnv1a(`${kind};${locationKey(location)};${areaM2.toFixed(0)}`)}`,
    kind,
    zoneIds,
    bbox: bbox.map((value) => Number(value.toFixed(7))),
    location,
    areaM2,
    areaMethod: "grid",
    cellSizeM: Number(estimate.cellSizeM.toFixed(2)),
    areaUncertaintyM2: Number(estimate.areaUncertaintyM2.toFixed(1)),
    reportLevel,
    relatedIssueIds,
  };
};

/** 收集一对学区之间的问题与冲突块 */
const checkPair = (first, second, options, issues, blocks) => {
  const [a, b] = [first, second].sort((x, y) => (x.zoneId < y.zoneId ? -1 : 1));
  const base = { stage: a.stage, year: a.year };
  const zoneIds = [a.zoneId, b.zoneId];
  let overlapBlockCount = 0;

  // 1. 边界交叉：两环的边存在内部相交；同一对学区合并为一条问题
  const crossingPoints = [];
  for (let i = 0; i < a.points.length; i += 1) {
    for (let j = 0; j < b.points.length; j += 1) {
      const result = segmentIntersection(
        a.points[i],
        a.points[(i + 1) % a.points.length],
        b.points[j],
        b.points[(j + 1) % b.points.length],
      );
      if (result.type === "proper") crossingPoints.push(result.point);
    }
  }
  let crossingIssue = null;
  if (crossingPoints.length > 0) {
    crossingIssue = createIssue({
      ...base,
      type: "overlap-crossing",
      zoneIds,
      location: crossingPoints[0],
      detail: {
        count: crossingPoints.length,
        points: crossingPoints
          .slice(0, options.maxCrossingsPerPair)
          .map((point) => point.map((value) => Number(value.toFixed(7)))),
        truncated: crossingPoints.length > options.maxCrossingsPerPair,
      },
    });
    issues.push(crossingIssue);
  }

  // 2. 包含：一方顶点明显落在另一方内部
  const deepestInside = (from, to) => {
    let best = null;
    for (const vertex of from.points) {
      if (!pointInRing(vertex, to.outer).inside) continue;
      const depthM = pointToPolylineDistanceM(vertex, to.outer);
      if (depthM <= options.containmentToleranceM) continue;
      if (!best || depthM > best.depthM) best = { vertex, depthM };
    }
    return best;
  };
  const aInsideB = deepestInside(a, b);
  const bInsideA = deepestInside(b, a);
  const containment =
    (aInsideB?.depthM ?? 0) >= (bInsideA?.depthM ?? 0)
      ? { found: aInsideB, contained: a }
      : { found: bInsideA, contained: b };
  if (containment.found) {
    const issue = createIssue({
      ...base,
      type: "overlap-containment",
      zoneIds,
      widthM: containment.found.depthM,
      location: containment.found.vertex,
      detail: { containedZoneId: containment.contained.zoneId },
    });
    issues.push(issue);

    // 块包围盒取"被包含环上落在对方内部的顶点段（含两端邻点）"，
    // 直接相交整对包围盒会把两侧相距很远的区域一并框入，导致面积严重高估。
    const other = containment.contained === a ? b : a;
    const picks = [];
    const containedPoints = containment.contained.points;
    for (let i = 0; i < containedPoints.length; i += 1) {
      if (!pointInRing(containedPoints[i], other.outer).inside) continue;
      picks.push(
        containedPoints[
          (i - 1 + containedPoints.length) % containedPoints.length
        ],
        containedPoints[i],
        containedPoints[(i + 1) % containedPoints.length],
      );
    }
    const tightBbox =
      picks.length > 0
        ? intersectBbox(bboxOfCoords(picks), pairBboxOf(a, b))
        : null;
    const blockBbox = tightBbox
      ? expandBboxM(tightBbox, options.areaCellSizeM * 2)
      : intersectBbox(bboxOfCoords(a.points), bboxOfCoords(b.points));
    if (blockBbox) {
      blocks.push(
        createBlock({
          kind: "overlap-containment",
          zoneIds,
          bbox: blockBbox,
          location: containment.found.vertex,
          relatedIssueIds: [issue.issueId],
          first: a,
          second: b,
          options,
        }),
      );
      overlapBlockCount += 1;
    }
  }

  // 3. 近似共边但顶点不一致：沿共边方向逐段比对
  const checkSharedEdges = (from, to) => {
    const referenceKeys = new Set(to.points.map(vertexKey));
    const runs = findSharedRuns(
      from.points,
      to.outer,
      options.sharedEdgeToleranceM,
    );
    for (const run of runs) {
      const vertices = run.map((index) => from.points[index]);
      if (vertices.every((vertex) => referenceKeys.has(vertexKey(vertex))))
        continue;

      let worst = { vertex: vertices[0], distanceM: 0 };
      for (const vertex of vertices) {
        const distance = pointToPolylineDistanceM(vertex, to.outer);
        if (distance > worst.distanceM) worst = { vertex, distanceM: distance };
      }
      if (worst.distanceM <= BOUNDARY_EPS_M) continue;

      const { inside } = pointInRing(worst.vertex, to.outer);
      const issue = createIssue({
        ...base,
        type: inside ? "shared-edge-overlap" : "shared-edge-gap",
        zoneIds,
        widthM: worst.distanceM,
        location: worst.vertex,
        detail: {
          modifiedZoneId: from.zoneId,
          referenceZoneId: to.zoneId,
          startIndex: run[0],
          endIndex: run[run.length - 1],
          vertexCount: run.length,
        },
      });
      issues.push(issue);

      // 只有重叠带产生面积块；缝隙按宽度汇报，不参与面积分级
      if (!inside) continue;
      const bandBbox = expandBboxM(
        bboxOfCoords([...vertices, worst.vertex]),
        worst.distanceM + options.areaCellSizeM * 2,
      );
      blocks.push(
        createBlock({
          kind: "shared-edge-overlap",
          zoneIds,
          bbox: bandBbox,
          location: worst.vertex,
          relatedIssueIds: [issue.issueId],
          first: a,
          second: b,
          options,
        }),
      );
      overlapBlockCount += 1;
    }
  };
  checkSharedEdges(a, b);
  checkSharedEdges(b, a);

  // 4. 只有交叉、没有共边带或包含时，按交叉点范围补一个块
  if (overlapBlockCount === 0 && crossingIssue) {
    blocks.push(
      createBlock({
        kind: "overlap-crossing",
        zoneIds,
        bbox: expandBboxM(
          bboxOfCoords(crossingPoints),
          options.areaCellSizeM * 4,
        ),
        location: crossingPoints[0],
        relatedIssueIds: [crossingIssue.issueId],
        first: a,
        second: b,
        options,
      }),
    );
  }
};

/** 由问题与冲突块汇总试点候选（先按面积、再按宽度排序） */
const buildPilotCandidates = (issues, blocks) => {
  const pairs = new Map();
  const ensureEntry = (zoneIds) => {
    const key = [...zoneIds].sort().join("|");
    let entry = pairs.get(key);
    if (!entry) {
      entry = {
        zoneIds: [...zoneIds].sort(),
        issueIds: [],
        blockIds: [],
        types: new Set(),
        maxWidthM: 0,
        maxAreaM2: 0,
        requiredBlocks: 0,
      };
      pairs.set(key, entry);
    }
    return entry;
  };

  for (const issue of issues) {
    if (!GEOMETRIC_TYPES.has(issue.type)) continue;
    const entry = ensureEntry(issue.zoneIds);
    entry.issueIds.push(issue.issueId);
    entry.types.add(issue.type);
    entry.maxWidthM = Math.max(entry.maxWidthM, issue.widthM);
  }
  for (const block of blocks) {
    const entry = ensureEntry(block.zoneIds);
    entry.blockIds.push(block.blockId);
    entry.maxAreaM2 = Math.max(entry.maxAreaM2, block.areaM2);
    if (block.reportLevel === "required") entry.requiredBlocks += 1;
  }

  return [...pairs.values()]
    .map((entry) => ({ ...entry, types: [...entry.types].sort() }))
    .sort(
      (x, y) =>
        y.requiredBlocks - x.requiredBlocks ||
        y.maxAreaM2 - x.maxAreaM2 ||
        y.maxWidthM - x.maxWidthM ||
        x.zoneIds.join("|").localeCompare(y.zoneIds.join("|")),
    )
    .slice(0, 5);
};

/**
 * 执行学区边界检查
 * @param {object} featureCollection 已解析的 zones GeoJSON
 * @param {object} options 判定参数
 */
export const checkZones = (featureCollection, options = {}) => {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const features = featureCollection?.features ?? [];
  const issues = [];
  const blocks = [];
  const groups = new Map();

  for (const feature of features) {
    const info = checkStructure(feature, settings, issues);
    if (!info) continue;
    const key = `${info.stage}|${info.year}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(info);
  }

  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        checkPair(group[i], group[j], settings, issues, blocks);
      }
    }
  }

  issues.sort(
    (x, y) =>
      x.type.localeCompare(y.type) ||
      x.zoneIds.join("|").localeCompare(y.zoneIds.join("|")) ||
      x.issueId.localeCompare(y.issueId),
  );

  const byType = {};
  for (const issue of issues)
    byType[issue.type] = (byType[issue.type] ?? 0) + 1;

  const LEVEL_ORDER = { required: 0, "near-threshold": 1, info: 2 };
  blocks.sort(
    (x, y) =>
      LEVEL_ORDER[x.reportLevel] - LEVEL_ORDER[y.reportLevel] ||
      y.areaM2 - x.areaM2 ||
      x.blockId.localeCompare(y.blockId),
  );

  return {
    options: settings,
    zoneCount: features.length,
    groupKeys: [...groups.keys()],
    summary: {
      total: issues.length,
      requiredBlocks: blocks.filter((block) => block.reportLevel === "required")
        .length,
      byType,
    },
    issues,
    blocks,
    pilotCandidates: buildPilotCandidates(issues, blocks),
  };
};
