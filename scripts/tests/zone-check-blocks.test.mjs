/**
 * zone-check-blocks.test.mjs - 冲突块与 250 m² 汇报分级（A9）
 *
 * 用少量构造数据验证：块面积能分级到 required / near-threshold / info，
 * 且 required 块不会被候选列表的数量上限折叠。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { checkZones } from "../lib/zone-check-core.mjs";

const BASE_LNG = 117.13;
const BASE_LAT = 36.17;
const LNG_PER_M = 111320 * Math.cos((BASE_LAT * Math.PI) / 180);
const LAT_PER_M = 110574;

const lngOf = (meters) => meters / LNG_PER_M;
const latOf = (meters) => meters / LAT_PER_M;

/** 生成一个以 (westM, southM) 为左下角的矩形学区，偏移量以米计 */
const rect = (zoneId, westM, southM, widthM, heightM) => {
  const west = BASE_LNG + lngOf(westM);
  const south = BASE_LAT + latOf(southM);
  const east = BASE_LNG + lngOf(westM + widthM);
  const north = BASE_LAT + latOf(southM + heightM);
  return {
    type: "Feature",
    properties: { zoneId, zoneName: zoneId, stage: "初中", year: 2025 },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
};

const featureCollection = (features) => ({ type: "FeatureCollection", features });

test("块面积按 250 m² 分级为 required / near-threshold / info", () => {
  const report = checkZones(
    featureCollection([
      rect("zone_base", 0, 0, 300, 300),
      rect("zone_required", 50, 50, 20, 20),
      rect("zone_near", 150, 150, 15, 15),
      rect("zone_info", 250, 250, 10, 10),
    ]),
  );

  const levels = report.blocks.map((block) => block.reportLevel);
  assert.equal(levels.length, 3);
  assert.deepEqual(
    [...levels].sort(),
    ["info", "near-threshold", "required"],
  );
  assert.equal(report.summary.requiredBlocks, 1);

  const required = report.blocks.find(
    (block) => block.reportLevel === "required",
  );
  assert.ok(required.areaM2 >= 250);
  assert.equal(required.areaMethod, "grid");
  assert.equal(required.zoneIds.join("|"), "zone_base|zone_required");
});

test("多个 required 块全部保留，不被候选上限折叠", () => {
  const spots = [
    [40, 40],
    [140, 40],
    [240, 40],
    [40, 140],
    [140, 140],
    [240, 140],
  ];
  const features = [rect("zone_base", 0, 0, 300, 300)];
  spots.forEach(([westM, southM], index) => {
    features.push(rect(`zone_small_${index}`, westM, southM, 20, 20));
  });

  const report = checkZones(featureCollection(features));
  const requiredBlocks = report.blocks.filter(
    (block) => block.reportLevel === "required",
  );

  assert.equal(requiredBlocks.length, 6);
  assert.equal(report.summary.requiredBlocks, 6);
  assert.ok(report.pilotCandidates.length <= 5);
});
