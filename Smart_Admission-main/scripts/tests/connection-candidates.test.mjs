import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverConnectionCandidates } from "../lib/connection-candidates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts/build-connection-candidates.mjs");

const makeTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sa-candidates-"));

const feature = (featureId, canonicalName, coordinates, featureType = "road") => ({
  type: "Feature",
  properties: {
    featureId,
    canonicalName,
    featureType,
    lifecycle: "active",
  },
  geometry: { type: "LineString", coordinates },
});

const makeFeatures = () => ({
  type: "FeatureCollection",
  features: [
    feature("bf_900101", "甲路", [
      [117.0, 36.0],
      [117.01, 36.0],
    ]),
    feature("bf_900102", "乙路", [
      [117.01, 36.0],
      [117.01, 36.01],
    ]),
    feature("bf_900103", "丙河", [
      [117.002, 35.998],
      [117.002, 36.002],
    ], "river"),
    feature("bf_900104", "丁路", [
      [117.02, 36.0],
      [117.03, 36.0],
    ]),
    feature("bf_900105", "戊路", [
      [117.02, 36.00005],
      [117.03, 36.00005],
    ]),
    feature("bf_900106", "己路", [
      [117.04, 36.01],
      [117.05, 36.01],
    ]),
    feature("bf_900107", "庚路", [
      [117.042, 36.01],
      [117.052, 36.01],
    ]),
  ],
});

const runScript = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

const candidateFeatureIds = (candidate) =>
  [...candidate.placements.map((placement) => placement.featureId), ...candidate.segments.map(
    (segment) => segment.featureId,
  )].sort();

test("识别不同要素在 7 位小数下完全共点", () => {
  const { candidates } = discoverConnectionCandidates({ features: makeFeatures() });
  const shared = candidates.filter((candidate) => candidate.category === "exactSharedVertex");
  const target = shared.find((candidate) =>
    candidateFeatureIds(candidate).includes("bf_900101"),
  );
  assert.ok(target);
  assert.deepEqual(target.coordinate, [117.01, 36]);
  assert.deepEqual(candidateFeatureIds(target), ["bf_900101", "bf_900102"]);
  assert.equal(target.placements.length, 2);
});

test("识别没有共同顶点的线段相交", () => {
  const { candidates } = discoverConnectionCandidates({ features: makeFeatures() });
  const crossing = candidates.find(
    (candidate) =>
      candidate.category === "segmentCrossing" &&
      candidateFeatureIds(candidate).includes("bf_900103"),
  );
  assert.ok(crossing);
  assert.deepEqual(crossing.coordinate, [117.002, 36]);
  assert.equal(crossing.placements.length, 0);
  assert.equal(crossing.segments.length, 2);
});

test("识别近邻但不共点并记录距离", () => {
  const { candidates } = discoverConnectionCandidates({ features: makeFeatures() });
  const near = candidates.find(
    (candidate) =>
      candidate.category === "nearMiss" &&
      candidateFeatureIds(candidate).join("|") === "bf_900104|bf_900105",
  );
  assert.ok(near);
  assert.ok(near.distanceM > 4 && near.distanceM < 7, `distanceM=${near.distanceM}`);
});

test("识别共线重叠并记录重叠长度", () => {
  const { candidates } = discoverConnectionCandidates({ features: makeFeatures() });
  const overlap = candidates.find(
    (candidate) =>
      candidate.category === "collinearOverlap" &&
      candidateFeatureIds(candidate).join("|") === "bf_900106|bf_900107",
  );
  assert.ok(overlap);
  assert.ok(overlap.overlapLengthM > 700, `overlapLengthM=${overlap.overlapLengthM}`);
});

test("候选默认是待审状态且不推断连接类型", () => {
  const { candidates } = discoverConnectionCandidates({ features: makeFeatures() });
  assert.ok(candidates.length > 0);
  candidates.forEach((candidate) => {
    assert.match(candidate.candidateId, /^ncc_\d{6}$/);
    assert.equal(candidate.reviewStatus, "pending");
    assert.equal(candidate.proposedConnectionType, null);
    assert.deepEqual(candidate.rulingIds, []);
    assert.equal(candidate.reviewer, null);
    assert.equal(candidate.reviewNote, "");
  });
});

test("输入要素顺序扰动不改变候选结果", () => {
  const features = makeFeatures();
  const reversed = {
    ...features,
    features: [...features.features].reverse(),
  };
  assert.deepEqual(
    discoverConnectionCandidates({ features }).candidates,
    discoverConnectionCandidates({ features: reversed }).candidates,
  );
});

test("CLI 拒绝把候选报告写入 data/", () => {
  const result = runScript(["--out", "data/connection-candidates.json"]);
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(path.join(ROOT, "data/connection-candidates.json")), false);
});

test("CLI 默认打印报告且带坐标源指纹", () => {
  const temp = makeTemp();
  const featuresPath = path.join(temp, "features.geojson");
  fs.writeFileSync(featuresPath, JSON.stringify(makeFeatures()), "utf-8");
  const result = runScript(["--features", featuresPath]);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.match(report.source.featuresSha256, /^[A-F0-9]{64}$/);
  assert.ok(report.candidates.length > 0);
});

test("CLI help 返回 0", () => {
  const result = runScript(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /near-miss-meters/);
});
