/**
 * connection-candidates.mjs - 只读连接候选发现
 *
 * 契约：docs/planning/节点边生成器规格与样例交接.md（第三章）
 *       docs/planning/统一边界网络数据契约与ID规则.md（第八章）
 *
 * 候选用于几何质量审核，不直接作为正式裁定：
 *   - candidateId 使用 ncc_*，与正式 ncd_* 分离
 *   - proposedConnectionType 恒为 null，避免只读报告隐式写入正式语义
 *   - 有效边界交点由 topology prepare 统一自动连通
 *   - 人工只处理近邻 anchor、共线重叠和无法自动修复的几何缺口
 *
 * 纯计算：不读文件、不打印、不退出。输出按几何内容稳定排序。
 */
import { approxMeters, eachPart, roundCoord } from "./network-schema.mjs";

export const CANDIDATE_SCHEMA_VERSION = 1;

export const CANDIDATE_CATEGORIES = [
  "exactSharedVertex",
  "segmentCrossing",
  "nearMiss",
  "collinearOverlap",
];

export const DEFAULT_NEAR_MISS_METERS = 10;

const COLLINEAR_TOLERANCE_METERS = 1;
const MIN_OVERLAP_METERS = 0.5;
const NEAR_MISS_MIN_METERS = 0.01;
const PARALLEL_EPSILON = 1e-15;
const INTERSECTION_EPSILON = 1e-9;

const coordinateKey = (coordinate) =>
  `${roundCoord(coordinate[0])},${roundCoord(coordinate[1])}`;

const roundedCoordinate = (coordinate) => [
  roundCoord(coordinate[0]),
  roundCoord(coordinate[1]),
];

const placementKeyOf = (placement) =>
  `${placement.featureId}|${placement.partIndex}|${placement.vertexIndex}`;

const segmentKeyOf = (segment) =>
  `${segment.featureId}|${segment.partIndex}|${segment.fromVertexIndex}|${segment.toVertexIndex}`;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const comparePlacement = (left, right) => {
  const feature = compareText(left.featureId, right.featureId);
  if (feature !== 0) return feature;
  if (left.partIndex !== right.partIndex) return left.partIndex - right.partIndex;
  return left.vertexIndex - right.vertexIndex;
};

const positionOf = (part, vertexIndex) =>
  vertexIndex === 0 || vertexIndex === part.length - 1 ? "endpoint" : "interior";

const buildFeatureRecords = (collection) => {
  const records = [];
  (collection?.features ?? []).forEach((feature) => {
    const props = feature?.properties ?? {};
    if (!props.featureId) return;
    if ((props.lifecycle ?? "active") !== "active") return;
    const parts = eachPart(feature.geometry);
    if (parts.length === 0) return;
    records.push({
      featureId: props.featureId,
      featureName: props.canonicalName ?? props.featureId,
      featureType: props.featureType ?? "unknown",
      parts,
    });
  });
  return records.sort((left, right) => compareText(left.featureId, right.featureId));
};

const buildSegments = (records) => {
  const segments = [];
  records.forEach((record) => {
    record.parts.forEach((part, partIndex) => {
      for (let vertexIndex = 0; vertexIndex + 1 < part.length; vertexIndex += 1) {
        const from = part[vertexIndex];
        const to = part[vertexIndex + 1];
        segments.push({
          featureId: record.featureId,
          featureName: record.featureName,
          featureType: record.featureType,
          partIndex,
          fromVertexIndex: vertexIndex,
          toVertexIndex: vertexIndex + 1,
          from,
          to,
          minLng: Math.min(from[0], to[0]),
          maxLng: Math.max(from[0], to[0]),
          minLat: Math.min(from[1], to[1]),
          maxLat: Math.max(from[1], to[1]),
        });
      }
    });
  });
  return segments.sort((left, right) =>
    compareText(segmentKeyOf(left), segmentKeyOf(right)),
  );
};

const collectExactSharedVertices = (records) => {
  const groups = new Map();
  records.forEach((record) => {
    record.parts.forEach((part, partIndex) => {
      part.forEach((coordinate, vertexIndex) => {
        const key = coordinateKey(coordinate);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({
          featureId: record.featureId,
          featureName: record.featureName,
          featureType: record.featureType,
          partIndex,
          vertexIndex,
          position: positionOf(part, vertexIndex),
          coordinate: roundedCoordinate(coordinate),
        });
      });
    });
  });

  const candidates = [];
  const sharedCoordinates = new Map();
  groups.forEach((placements, key) => {
    const featureIds = [...new Set(placements.map((placement) => placement.featureId))].sort();
    if (featureIds.length < 2) return;
    sharedCoordinates.set(key, new Set(featureIds));
    candidates.push({
      category: "exactSharedVertex",
      coordinate: placements[0].coordinate,
      placements: [...placements].sort(comparePlacement),
      segments: [],
      distanceM: null,
      overlapLengthM: null,
      evidence: [`${featureIds.length} 个要素在 7 位小数下完全共点`],
    });
  });
  return { candidates, sharedCoordinates };
};

const computeIntersection = (left, right) => {
  const rx = left.to[0] - left.from[0];
  const ry = left.to[1] - left.from[1];
  const sx = right.to[0] - right.from[0];
  const sy = right.to[1] - right.from[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < PARALLEL_EPSILON) return null;
  const qpx = right.from[0] - left.from[0];
  const qpy = right.from[1] - left.from[1];
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  if (
    t < -INTERSECTION_EPSILON ||
    t > 1 + INTERSECTION_EPSILON ||
    u < -INTERSECTION_EPSILON ||
    u > 1 + INTERSECTION_EPSILON
  ) {
    return null;
  }
  return { t, u, coordinate: [left.from[0] + t * rx, left.from[1] + t * ry] };
};

const measureCollinearOverlap = (left, right) => {
  const rx = left.to[0] - left.from[0];
  const ry = left.to[1] - left.from[1];
  const length2 = rx * rx + ry * ry;
  if (length2 === 0) return null;
  const lengthM = approxMeters(left.from, left.to);
  if (lengthM === 0) return null;

  const project = (coordinate) => {
    const t =
      ((coordinate[0] - left.from[0]) * rx + (coordinate[1] - left.from[1]) * ry) /
      length2;
    return {
      t,
      distanceM: approxMeters(coordinate, [
        left.from[0] + t * rx,
        left.from[1] + t * ry,
      ]),
    };
  };

  const from = project(right.from);
  const to = project(right.to);
  if (
    from.distanceM > COLLINEAR_TOLERANCE_METERS ||
    to.distanceM > COLLINEAR_TOLERANCE_METERS
  ) {
    return null;
  }

  const low = Math.min(from.t, to.t);
  const high = Math.max(from.t, to.t);
  const overlapLow = Math.max(0, low);
  const overlapHigh = Math.min(1, high);
  const overlapMeters = (overlapHigh - overlapLow) * lengthM;
  if (overlapMeters < MIN_OVERLAP_METERS) return null;

  const middle = (overlapLow + overlapHigh) / 2;
  return {
    overlapLengthM: Math.round(overlapMeters * 10) / 10,
    coordinate: [left.from[0] + middle * rx, left.from[1] + middle * ry],
  };
};

const collectSegmentPairs = (segments) => {
  const pairs = [];
  const sorted = [...segments].sort((left, right) => left.minLng - right.minLng);
  for (let outer = 0; outer < sorted.length; outer += 1) {
    const left = sorted[outer];
    for (let inner = outer + 1; inner < sorted.length; inner += 1) {
      const right = sorted[inner];
      if (right.minLng > left.maxLng) break;
      if (left.featureId === right.featureId) continue;
      if (right.minLat > left.maxLat || left.minLat > right.maxLat) continue;
      pairs.push([left, right]);
    }
  }
  return pairs;
};

const segmentDescriptor = (segment) => ({
  featureId: segment.featureId,
  featureName: segment.featureName,
  featureType: segment.featureType,
  partIndex: segment.partIndex,
  fromVertexIndex: segment.fromVertexIndex,
  toVertexIndex: segment.toVertexIndex,
});

const compareSegments = (left, right) =>
  compareText(segmentKeyOf(left), segmentKeyOf(right));

const collectSegmentEvents = (segments, sharedCoordinates) => {
  const crossings = new Map();
  const overlaps = new Map();

  collectSegmentPairs(segments).forEach(([left, right]) => {
    const pairKey = [left.featureId, right.featureId].sort().join("|");
    const intersection = computeIntersection(left, right);
    if (intersection) {
      const key = coordinateKey(intersection.coordinate);
      const shared = sharedCoordinates.get(key);
      const isSharedVertex = shared && shared.has(left.featureId) && shared.has(right.featureId);
      if (!isSharedVertex) {
        const candidateKey = `${key}|${pairKey}`;
        if (!crossings.has(candidateKey)) {
          crossings.set(candidateKey, {
            category: "segmentCrossing",
            coordinate: roundedCoordinate(intersection.coordinate),
            placements: [],
            segments: [segmentDescriptor(left), segmentDescriptor(right)].sort(
              compareSegments,
            ),
            distanceM: null,
            overlapLengthM: null,
            evidence: ["线段相交，双方没有共同顶点"],
          });
        }
      }
    }

    const overlap = measureCollinearOverlap(left, right);
    if (overlap) {
      const key = [segmentKeyOf(left), segmentKeyOf(right)].sort().join("|");
      if (!overlaps.has(key)) {
        overlaps.set(key, {
          category: "collinearOverlap",
          coordinate: roundedCoordinate(overlap.coordinate),
          placements: [],
          segments: [segmentDescriptor(left), segmentDescriptor(right)].sort(
            compareSegments,
          ),
          distanceM: null,
          overlapLengthM: overlap.overlapLengthM,
          evidence: [`共线重叠约 ${overlap.overlapLengthM} 米`],
        });
      }
    }
  });

  return { crossings: [...crossings.values()], overlaps: [...overlaps.values()] };
};

const cellKey = (coordinate, cellSize) =>
  `${Math.floor(coordinate[0] / cellSize)},${Math.floor(coordinate[1] / cellSize)}`;

const collectNearMisses = (records, segments, nearMissMeters) => {
  const cellSize = nearMissMeters / 100000;
  const vertexGrid = new Map();
  const vertices = [];

  records.forEach((record) => {
    record.parts.forEach((part, partIndex) => {
      part.forEach((coordinate, vertexIndex) => {
        const vertex = {
          featureId: record.featureId,
          featureName: record.featureName,
          featureType: record.featureType,
          partIndex,
          vertexIndex,
          position: positionOf(part, vertexIndex),
          coordinate: roundedCoordinate(coordinate),
        };
        vertices.push(vertex);
        const key = cellKey(vertex.coordinate, cellSize);
        if (!vertexGrid.has(key)) vertexGrid.set(key, []);
        vertexGrid.get(key).push(vertex);
      });
    });
  });

  const candidates = new Map();

  vertices.forEach((vertex) => {
    const cx = Math.floor(vertex.coordinate[0] / cellSize);
    const cy = Math.floor(vertex.coordinate[1] / cellSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        (vertexGrid.get(`${cx + dx},${cy + dy}`) ?? []).forEach((other) => {
          if (other.featureId === vertex.featureId) return;
          const key = [placementKeyOf(vertex), placementKeyOf(other)].sort().join("|");
          if (candidates.has(key)) return;
          const distanceM = approxMeters(vertex.coordinate, other.coordinate);
          if (distanceM <= NEAR_MISS_MIN_METERS || distanceM > nearMissMeters) return;
          const rounded = Math.round(distanceM * 100) / 100;
          candidates.set(key, {
            category: "nearMiss",
            coordinate: roundedCoordinate([
              (vertex.coordinate[0] + other.coordinate[0]) / 2,
              (vertex.coordinate[1] + other.coordinate[1]) / 2,
            ]),
            placements: [vertex, other].sort(comparePlacement),
            segments: [],
            distanceM: rounded,
            overlapLengthM: null,
            evidence: [`两要素最近顶点相距约 ${rounded} 米`],
          });
        });
      }
    }
  });

  segments.forEach((segment) => {
    const rx = segment.to[0] - segment.from[0];
    const ry = segment.to[1] - segment.from[1];
    const length2 = rx * rx + ry * ry;
    if (length2 === 0) return;
    const minX = Math.floor((segment.minLng - cellSize) / cellSize);
    const maxX = Math.floor((segment.maxLng + cellSize) / cellSize);
    const minY = Math.floor((segment.minLat - cellSize) / cellSize);
    const maxY = Math.floor((segment.maxLat + cellSize) / cellSize);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        (vertexGrid.get(`${cx},${cy}`) ?? []).forEach((vertex) => {
          if (vertex.featureId === segment.featureId) return;
          const t =
            ((vertex.coordinate[0] - segment.from[0]) * rx +
              (vertex.coordinate[1] - segment.from[1]) * ry) /
            length2;
          if (t <= 0.01 || t >= 0.99) return;
          const projection = [
            segment.from[0] + t * rx,
            segment.from[1] + t * ry,
          ];
          const distanceM = approxMeters(vertex.coordinate, projection);
          if (distanceM <= NEAR_MISS_MIN_METERS || distanceM > nearMissMeters) return;
          const key = `${placementKeyOf(vertex)}|${segmentKeyOf(segment)}`;
          if (candidates.has(key)) return;
          const rounded = Math.round(distanceM * 100) / 100;
          candidates.set(key, {
            category: "nearMiss",
            coordinate: roundedCoordinate(projection),
            placements: [vertex],
            segments: [segmentDescriptor(segment)],
            distanceM: rounded,
            overlapLengthM: null,
            evidence: [`顶点距线段约 ${rounded} 米`],
          });
        });
      }
    }
  });

  return [...candidates.values()];
};

const categoryRank = (category) => CANDIDATE_CATEGORIES.indexOf(category);

const candidateSortKey = (candidate) => [
  String(categoryRank(candidate.category)).padStart(2, "0"),
  candidate.coordinate[0].toFixed(7),
  candidate.coordinate[1].toFixed(7),
  candidate.placements.map(placementKeyOf).join(","),
  candidate.segments.map(segmentKeyOf).join(","),
];

const compareCandidates = (left, right) =>
  compareText(candidateSortKey(left).join("|"), candidateSortKey(right).join("|"));

/**
 * 发现连接候选。
 * @param {object} input
 * @param {object} input.features boundary_features FeatureCollection
 * @param {number} [input.nearMissMeters] 近邻容差（米）
 */
export const discoverConnectionCandidates = ({
  features,
  nearMissMeters = DEFAULT_NEAR_MISS_METERS,
}) => {
  const records = buildFeatureRecords(features);
  const segments = buildSegments(records);
  const { candidates: shared, sharedCoordinates } = collectExactSharedVertices(records);
  const { crossings, overlaps } = collectSegmentEvents(segments, sharedCoordinates);
  const nearMisses = collectNearMisses(records, segments, nearMissMeters);

  const candidates = [...shared, ...crossings, ...nearMisses, ...overlaps]
    .sort(compareCandidates)
    .map((candidate, index) => ({
      candidateId: `ncc_${String(index + 1).padStart(6, "0")}`,
      category: candidate.category,
      coordinate: candidate.coordinate,
      placements: candidate.placements,
      segments: candidate.segments,
      distanceM: candidate.distanceM,
      overlapLengthM: candidate.overlapLengthM,
      reviewStatus: "pending",
      proposedConnectionType: null,
      rulingIds: [],
      evidence: candidate.evidence,
      reviewer: null,
      reviewNote: "",
    }));

  const counts = Object.fromEntries(
    CANDIDATE_CATEGORIES.map((category) => [
      category,
      candidates.filter((candidate) => candidate.category === category).length,
    ]),
  );

  return {
    candidates,
    counts: { total: candidates.length, ...counts },
    summary: {
      featureCount: records.length,
      vertexCount: records.reduce(
        (total, record) =>
          total + record.parts.reduce((sum, part) => sum + part.length, 0),
        0,
      ),
      segmentCount: segments.length,
      nearMissMeters,
    },
  };
};
