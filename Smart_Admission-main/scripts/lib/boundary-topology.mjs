import { approxMeters, eachPart, roundCoord } from "./network-schema.mjs";
import { discoverConnectionCandidates } from "./connection-candidates.mjs";
import { buildNetwork as buildIntersections } from "../build-intersections.mjs";

export const DEFAULT_ANCHOR_RADIUS_METERS = 30;
export const BOUNDARY_TOPOLOGY_RULE_VERSION = 1;

const coordinateKey = (coordinate) =>
  `${roundCoord(coordinate[0])},${roundCoord(coordinate[1])}`;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const candidateKey = (candidate) =>
  [
    candidate.coordinate[0].toFixed(7),
    candidate.coordinate[1].toFixed(7),
    candidate.placements
      .map((placement) =>
        [placement.featureId, placement.partIndex, placement.vertexIndex].join("|"),
      )
      .join(","),
  ].join("|");

const featureMapOf = (features) =>
  new Map(
    (features.features ?? []).map((feature) => [feature.properties.featureId, feature]),
  );

const prepareIntersections = (features) => {
  const originalProperties = new Map(
    (features.features ?? []).map((feature) => [
      feature.properties.featureId,
      structuredClone(feature.properties),
    ]),
  );
  const input = structuredClone(features);
  input.features.forEach((feature) => {
    const props = feature.properties;
    props.roadId = props.featureId;
    props.name = props.canonicalName;
    props.dataStatus =
      props.verificationStatus === "verified" ? "verified" : "reviewed";
  });
  const built = buildIntersections(input, { tol: 3, candidate: 10, clusterM: 1 });
  built.roads.features.forEach((feature) => {
    feature.properties = originalProperties.get(feature.properties.featureId);
  });
  const byId = new Map(
    built.roads.features.map((feature) => [feature.properties.featureId, feature]),
  );
  built.intersections.features.forEach((intersection) => {
    const coordinate = intersection.geometry.coordinates.map(roundCoord);
    intersection.properties.roads.forEach((placement) => {
      const feature = byId.get(placement.roadId);
      const parts = eachPart(feature.geometry);
      parts[placement.part][placement.vertex] = coordinate;
    });
  });
  return built;
};

const buildPlacementRemap = (before, after) => {
  const afterById = featureMapOf(after);
  const remap = [];
  (before.features ?? []).forEach((feature) => {
    const featureId = feature.properties.featureId;
    const next = afterById.get(featureId);
    if (!next) return;
    const beforeParts = eachPart(feature.geometry);
    const afterParts = eachPart(next.geometry);
    beforeParts.forEach((part, partIndex) => {
      const indicesByCoordinate = new Map();
      afterParts[partIndex].forEach((coordinate, vertexIndex) => {
        const key = coordinateKey(coordinate);
        if (!indicesByCoordinate.has(key)) indicesByCoordinate.set(key, []);
        indicesByCoordinate.get(key).push(vertexIndex);
      });
      let cursor = -1;
      part.forEach((coordinate, vertexIndex) => {
        const exact = (indicesByCoordinate.get(coordinateKey(coordinate)) ?? []).find(
          (candidate) => candidate > cursor,
        );
        let nextIndex = exact;
        if (nextIndex === undefined) {
          let best = null;
          afterParts[partIndex].forEach((candidate, candidateIndex) => {
            if (candidateIndex <= cursor) return;
            const distanceM = approxMeters(coordinate, candidate);
            if (!best || distanceM < best.distanceM) {
              best = { candidateIndex, distanceM };
            }
          });
          if (best && best.distanceM <= 2) nextIndex = best.candidateIndex;
        }
        if (nextIndex === undefined) {
          throw new Error(
            `${featureId} part ${partIndex} 顶点 ${vertexIndex} 无法唯一重定位`,
          );
        }
        cursor = nextIndex;
        remap.push({
          featureId,
          partIndex,
          oldVertexIndex: vertexIndex,
          newVertexIndex: nextIndex,
        });
      });
    });
  });
  return { schemaVersion: 1, placements: remap };
};

const sharesFeature = (left, right) => {
  const ids = new Set(left.placements.map((placement) => placement.featureId));
  return right.placements.some((placement) => ids.has(placement.featureId));
};

const nodeKind = (candidate) => {
  if (candidate.placements.length > 2) return "multi";
  const endpoints = candidate.placements.filter(
    (placement) => placement.position === "endpoint",
  ).length;
  if (endpoints === 0) return "cross";
  if (endpoints === candidate.placements.length) return "end";
  return "tee";
};

const kindRank = { cross: 4, tee: 3, multi: 2, end: 1 };

const entityRank = (candidate, featureMap) =>
  Math.max(
    ...candidate.placements.map((placement) => {
      const props = featureMap.get(placement.featureId)?.properties ?? {};
      if (["river", "railway"].includes(props.featureType)) return 3;
      if (props.importance === "primary") return 2;
      return 1;
    }),
  );

const isRiversideRoad = (riverName, roadName) => {
  return new RegExp(`^${riverName}[东南西北中]?路$`).test(roadName);
};

const containsRiver = (candidate, featureMap) =>
  candidate.placements.some(
    (placement) => featureMap.get(placement.featureId)?.properties?.featureType === "river",
  );

const groupHasRiverAndRiversideRoad = (group, featureMap) => {
  const features = new Map();
  group.forEach((candidate) => {
    candidate.placements.forEach((placement) => {
      const feature = featureMap.get(placement.featureId);
      if (feature) features.set(placement.featureId, feature.properties);
    });
  });
  const rivers = [...features.values()].filter((props) => props.featureType === "river");
  const roads = [...features.values()].filter((props) => props.featureType === "road");
  return rivers.some((river) =>
    roads.some((road) => isRiversideRoad(river.canonicalName, road.canonicalName)),
  );
};

const directionRank = (coordinate, center) => {
  const dx = coordinate[0] - center[0];
  const dy = coordinate[1] - center[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  if (Math.abs(dy) / length >= 0.7) return dy < 0 ? 4 : 2;
  if (Math.abs(dx) / length >= 0.7) return dx < 0 ? 3 : 1;
  return 0;
};

const pickAnchor = (group, featureMap) => {
  const center = [
    group.reduce((sum, candidate) => sum + candidate.coordinate[0], 0) / group.length,
    group.reduce((sum, candidate) => sum + candidate.coordinate[1], 0) / group.length,
  ];
  const measured = group.map((candidate) => ({
    candidate,
    distanceM: Math.round(approxMeters(candidate.coordinate, center) * 100) / 100,
  }));
  const minimum = Math.min(...measured.map((item) => item.distanceM));
  let pool = measured.filter((item) => item.distanceM <= minimum + 0.5);
  let reason = "距组中心最近";

  const narrow = (next, nextReason) => {
    if (next.length > 0 && next.length < pool.length) {
      pool = next;
      reason = nextReason;
      return true;
    }
    return false;
  };

  if (pool.length > 1 && groupHasRiverAndRiversideRoad(group, featureMap)) {
    const rivers = pool.filter((item) => containsRiver(item.candidate, featureMap));
    narrow(rivers, "河优先于河畔路");
  }
  if (pool.length > 1) {
    const maximum = Math.max(...pool.map((item) => kindRank[nodeKind(item.candidate)]));
    narrow(
      pool.filter((item) => kindRank[nodeKind(item.candidate)] === maximum),
      "节点类型优先",
    );
  }
  if (pool.length > 1) {
    const maximum = Math.max(...pool.map((item) => entityRank(item.candidate, featureMap)));
    narrow(
      pool.filter((item) => entityRank(item.candidate, featureMap) === maximum),
      "实体等级优先",
    );
  }
  if (pool.length > 1) {
    const maximum = Math.max(...pool.map((item) => directionRank(item.candidate.coordinate, center)));
    const directed = pool.filter(
      (item) => directionRank(item.candidate.coordinate, center) === maximum,
    );
    if (maximum > 0) narrow(directed, "方位优先");
  }
  pool.sort((left, right) => compareText(candidateKey(left.candidate), candidateKey(right.candidate)));
  if (pool.length > 1) reason = "稳定键兜底";
  return { anchor: pool[0].candidate, center: center.map(roundCoord), reason };
};

const groupNearbyIntersections = (candidates, radiusM, featureMap) => {
  const ordered = [...candidates].sort((left, right) => compareText(candidateKey(left), candidateKey(right)));
  const used = new Set();
  const groups = [];
  ordered.forEach((seed, index) => {
    if (used.has(index)) return;
    used.add(index);
    const members = [seed];
    ordered.forEach((candidate, candidateIndex) => {
      if (used.has(candidateIndex)) return;
      if (!sharesFeature(seed, candidate)) return;
      if (approxMeters(seed.coordinate, candidate.coordinate) > radiusM) return;
      used.add(candidateIndex);
      members.push(candidate);
    });
    if (members.length < 2) return;
    const selected = pickAnchor(members, featureMap);
    groups.push({
      groupId: `nag_${String(groups.length + 1).padStart(6, "0")}`,
      center: selected.center,
      radiusM,
      anchorReason: selected.reason,
      anchorKey: candidateKey(selected.anchor),
      anchor: {
        coordinate: selected.anchor.coordinate,
        kind: nodeKind(selected.anchor),
        features: selected.anchor.placements.map((placement) => ({
          featureId: placement.featureId,
          featureName:
            featureMap.get(placement.featureId)?.properties?.canonicalName ??
            placement.featureId,
          featureType:
            featureMap.get(placement.featureId)?.properties?.featureType ?? "unknown",
        })),
      },
      memberKeys: members.map(candidateKey).sort(compareText),
      members: members.map((candidate) => ({
        key: candidateKey(candidate),
        coordinate: candidate.coordinate,
        kind: nodeKind(candidate),
        anchor: candidateKey(candidate) === candidateKey(selected.anchor),
        distanceToAnchorM:
          Math.round(approxMeters(candidate.coordinate, selected.anchor.coordinate) * 100) /
          100,
        features: candidate.placements.map((placement) => ({
          featureId: placement.featureId,
          featureName:
            featureMap.get(placement.featureId)?.properties?.canonicalName ??
            placement.featureId,
          featureType:
            featureMap.get(placement.featureId)?.properties?.featureType ?? "unknown",
        })),
      })),
      spreadM:
        Math.round(
          Math.max(
            ...members.map((candidate) =>
              approxMeters(selected.anchor.coordinate, candidate.coordinate),
            ),
          ) * 100,
        ) / 100,
    });
  });
  return groups;
};

export const buildBoundaryTopologyPlan = ({
  features,
  anchorRadiusMeters = DEFAULT_ANCHOR_RADIUS_METERS,
}) => {
  const before = discoverConnectionCandidates({ features });
  const prepared = prepareIntersections(features);
  const preparedFeatures = prepared.roads;
  const placementRemap = buildPlacementRemap(features, preparedFeatures);
  const after = discoverConnectionCandidates({ features: preparedFeatures });
  const intersections = after.candidates.filter(
    (candidate) => candidate.category === "exactSharedVertex",
  );
  const featureMap = featureMapOf(preparedFeatures);
  const anchorGroups = groupNearbyIntersections(
    intersections,
    anchorRadiusMeters,
    featureMap,
  );
  const suppressed = new Set(
    anchorGroups.flatMap((group) =>
      group.memberKeys.filter((key) => key !== group.anchorKey),
    ),
  );
  const accepted = intersections.filter((candidate) => !suppressed.has(candidateKey(candidate)));
  const decisions = accepted
    .sort((left, right) => compareText(candidateKey(left), candidateKey(right)))
    .map((candidate, index) => ({
      decisionId: `ncd_${String(index + 1).padStart(6, "0")}`,
      connectionType: "connected",
      placements: candidate.placements.map(
        ({ featureId, partIndex, vertexIndex }) => ({ featureId, partIndex, vertexIndex }),
      ),
      rulingIds: [],
      note: `边界几何交点自动连通；规则版本 ${BOUNDARY_TOPOLOGY_RULE_VERSION}`,
    }));

  return {
    features: preparedFeatures,
    placementRemap,
    decisions: { schemaVersion: 1, decisions },
    report: {
      schemaVersion: 1,
      ruleVersion: BOUNDARY_TOPOLOGY_RULE_VERSION,
      anchorRadiusMeters,
      segmentCrossingsInserted: before.counts.segmentCrossing,
      generatedIntersections: prepared.report.totals.nodes,
      gapIntersections: prepared.report.totals.gapNodes,
      intersectionsBefore: before.counts.exactSharedVertex,
      intersectionsAfter: intersections.length,
      anchorGroups,
      suppressedIntersections: suppressed.size,
      acceptedIntersections: accepted.length,
      unresolved: {
        nearMiss: prepared.report.totals.nearMiss,
        collinearOverlap: prepared.report.totals.overlaps,
        segmentCrossing: after.counts.segmentCrossing,
      },
      geometryReport: prepared.report,
    },
  };
};
