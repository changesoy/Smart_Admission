import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildBoundaryTopologyPlan } from "../lib/boundary-topology.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const feature = (featureId, name, coordinates, featureType = "road") => ({
  type: "Feature",
  properties: {
    featureId,
    canonicalName: name,
    featureType,
    lifecycle: "active",
    importance: "normal",
  },
  geometry: { type: "LineString", coordinates },
});

test("线段交叉自动插点并生成 connected 裁定", () => {
  const features = {
    type: "FeatureCollection",
    features: [
      feature("bf_000001", "横路", [[117, 36], [117.002, 36]]),
      feature("bf_000002", "竖路", [[117.001, 35.999], [117.001, 36.001]]),
    ],
  };
  const result = buildBoundaryTopologyPlan({ features, anchorRadiusMeters: 10 });
  assert.equal(result.report.segmentCrossingsInserted, 1);
  assert.equal(result.report.acceptedIntersections, 1);
  assert.equal(result.decisions.decisions[0].connectionType, "connected");
  assert.deepEqual(result.features.features[0].geometry.coordinates[1], [117.001, 36]);
});

test("共享同一边界且过近的两个交点只保留一个 anchor", () => {
  const features = {
    type: "FeatureCollection",
    features: [
      feature("bf_000001", "横路", [[117, 36], [117.0001, 36], [117.001, 36]]),
      feature("bf_000002", "测试河", [[117, 35.999], [117, 36], [117, 36.001]], "river"),
      feature("bf_000003", "测试河东路", [[117.0001, 35.999], [117.0001, 36], [117.0001, 36.001]]),
    ],
  };
  const result = buildBoundaryTopologyPlan({ features, anchorRadiusMeters: 30 });
  assert.equal(result.report.anchorGroups.length, 1);
  assert.equal(result.report.suppressedIntersections, 1);
  assert.equal(result.report.acceptedIntersections, 1);
  assert.equal(result.report.anchorGroups[0].anchorReason, "河优先于河畔路");
});

test("相同输入重复执行保持结果深相等", () => {
  const features = {
    type: "FeatureCollection",
    features: [
      feature("bf_000001", "甲", [[117, 36], [117.002, 36]]),
      feature("bf_000002", "乙", [[117.001, 35.999], [117.001, 36.001]]),
    ],
  };
  const first = buildBoundaryTopologyPlan({ features });
  const second = buildBoundaryTopologyPlan({ features: first.features });
  assert.deepEqual(second.features, first.features);
  assert.deepEqual(second.decisions, first.decisions);
});

test("真实边界数据保持冻结的交点与 anchor 基线", () => {
  const features = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/boundary_features.v2.geojson"), "utf8"),
  );
  const result = buildBoundaryTopologyPlan({ features });
  assert.equal(result.report.generatedIntersections, 218);
  assert.equal(result.report.anchorGroups.length, 16);
  assert.equal(result.report.suppressedIntersections, 20);
  assert.equal(result.report.acceptedIntersections, 198);
  assert.equal(result.report.unresolved.nearMiss, 92);
  assert.equal(result.report.unresolved.collinearOverlap, 1);
  assert.equal(result.report.unresolved.segmentCrossing, 0);
});
