import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createReport } from "../lib/network-schema.mjs";
import { indexFeatures } from "../lib/network-generator-core.mjs";
import { validateCandidateReview } from "../lib/candidate-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "scripts/validate-candidate-review.mjs");

const features = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        featureId: "bf_910001",
        canonicalName: "测试甲路",
        featureType: "road",
        lifecycle: "active",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [117.0, 36.0],
          [117.01, 36.0],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        featureId: "bf_910002",
        canonicalName: "测试乙路",
        featureType: "road",
        lifecycle: "active",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [117.01, 36.0],
          [117.01, 36.01],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        featureId: "bf_910003",
        canonicalName: "测试丙河",
        featureType: "river",
        lifecycle: "active",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [117.02, 36.0],
          [117.03, 36.0],
        ],
      },
    },
  ],
};

const registry = { schemaVersion: 1, counters: {}, entries: [] };

const featureIndex = () => indexFeatures(features, createReport());

const validate = (review) => {
  const report = createReport();
  const normalized = validateCandidateReview({
    review,
    registry,
    featureIndex: featureIndex(),
    report,
  });
  return { normalized, report };
};

const baseReview = (overrides = {}) => ({
  schemaVersion: 1,
  reviewId: "ncr_0123abcd",
  source: { featuresSha256: "A".repeat(64), gitCommit: "abc123" },
  reviewer: "测试",
  candidates: [],
  ...overrides,
});

const baseCandidate = (overrides = {}) => ({
  candidateId: "ncc_000001",
  category: "exactSharedVertex",
  coordinate: [117.01, 36],
  placements: [
    { featureId: "bf_910001", partIndex: 0, vertexIndex: 1 },
    { featureId: "bf_910002", partIndex: 0, vertexIndex: 0 },
  ],
  segments: [],
  reviewStatus: "pending",
  proposedConnectionType: null,
  rulingIds: [],
  reviewer: "",
  reviewNote: "",
  ...overrides,
});

const runCli = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

const findRealSharedPlacements = () => {
  const collection = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/boundary_features.v2.geojson"), "utf-8"),
  );
  const groups = new Map();
  collection.features.forEach((feature) => {
    const props = feature.properties;
    if ((props.lifecycle ?? "active") !== "active") return;
    const parts =
      feature.geometry.type === "LineString"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    parts.forEach((part, partIndex) => {
      part.forEach((coordinate, vertexIndex) => {
        const key = `${coordinate[0]},${coordinate[1]}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({
          featureId: props.featureId,
          partIndex,
          vertexIndex,
          coordinate,
        });
      });
    });
  });
  for (const placements of groups.values()) {
    const featureIds = new Set(placements.map((placement) => placement.featureId));
    if (featureIds.size >= 2) {
      return placements.slice(0, 2);
    }
  }
  throw new Error("真实数据中没有找到跨要素共点");
};

test("pending 候选通过审核文档校验", () => {
  const { normalized, report } = validate(
    baseReview({ candidates: [baseCandidate()] }),
  );
  assert.equal(report.errors.length, 0);
  assert.equal(normalized.counts.pending, 1);
  assert.equal(normalized.candidates[0].proposedConnectionType, null);
});

test("connected 候选要求共点并记录语义", () => {
  const { normalized, report } = validate(
    baseReview({
      candidates: [
        baseCandidate({
          reviewStatus: "connected",
          proposedConnectionType: "connected",
          reviewer: "测试",
        }),
      ],
    }),
  );
  assert.equal(report.errors.length, 0);
  assert.equal(normalized.counts.connected, 1);
  assert.equal(normalized.candidates[0].proposedConnectionType, "connected");
});

test("不共点的 connected 被拒绝", () => {
  const { normalized, report } = validate(
    baseReview({
      candidates: [
        baseCandidate({
          placements: [
            { featureId: "bf_910001", partIndex: 0, vertexIndex: 0 },
            { featureId: "bf_910002", partIndex: 0, vertexIndex: 0 },
          ],
          reviewStatus: "connected",
          proposedConnectionType: "connected",
          reviewer: "测试",
        }),
      ],
    }),
  );
  assert.equal(normalized, null);
  assert.match(report.errors.map((item) => item.message).join("\n"), /不完全共点/);
});

test("pending 不得携带 proposedConnectionType", () => {
  const { normalized, report } = validate(
    baseReview({
      candidates: [baseCandidate({ proposedConnectionType: "connected" })],
    }),
  );
  assert.equal(normalized, null);
  assert.match(report.errors.map((item) => item.message).join("\n"), /必须为 null/);
});

test("needsGeometryFix 必须填写说明", () => {
  const { normalized, report } = validate(
    baseReview({
      candidates: [
        baseCandidate({
          reviewStatus: "needsGeometryFix",
          proposedConnectionType: null,
          reviewer: "测试",
        }),
      ],
    }),
  );
  assert.equal(normalized, null);
  assert.match(report.errors.map((item) => item.message).join("\n"), /必须填写 reviewNote/);
});

test("非 pending 审核必须填写 reviewer", () => {
  const { normalized, report } = validate(
    baseReview({
      candidates: [
        baseCandidate({
          reviewStatus: "nonConnectingCrossing",
          proposedConnectionType: "nonConnectingCrossing",
          segments: [
            {
              featureId: "bf_910001",
              partIndex: 0,
              fromVertexIndex: 0,
              toVertexIndex: 1,
            },
            {
              featureId: "bf_910003",
              partIndex: 0,
              fromVertexIndex: 0,
              toVertexIndex: 1,
            },
          ],
          placements: [],
        }),
      ],
    }),
  );
  assert.equal(normalized, null);
  assert.match(report.errors.map((item) => item.message).join("\n"), /必须填写 reviewer/);
});

test("非法 reviewId 与越界下标被拒绝", () => {
  const badId = validate(baseReview({ reviewId: "ncr_xyz", candidates: [baseCandidate()] }));
  assert.equal(badId.normalized, null);
  assert.match(
    badId.report.errors.map((item) => item.message).join("\n"),
    /reviewId 必须匹配/,
  );

  const badIndex = validate(
    baseReview({
      candidates: [
        baseCandidate({
          placements: [
            { featureId: "bf_910001", partIndex: 0, vertexIndex: 99 },
            { featureId: "bf_910002", partIndex: 0, vertexIndex: 0 },
          ],
        }),
      ],
    }),
  );
  assert.equal(badIndex.normalized, null);
  assert.match(
    badIndex.report.errors.map((item) => item.message).join("\n"),
    /vertexIndex 超出范围/,
  );
});

test("未登记的 rulingId 被拒绝", () => {
  const { normalized, report } = validate(
    baseReview({
      candidates: [
        baseCandidate({ rulingIds: ["br_000001"] }),
      ],
    }),
  );
  assert.equal(normalized, null);
  assert.match(report.errors.map((item) => item.message).join("\n"), /未在注册表登记/);
});

test("CLI 校验真实数据上的合法审核文档", () => {
  const placements = findRealSharedPlacements();
  const coordinate = [placements[0].coordinate[0], placements[0].coordinate[1]];
  const review = baseReview({
    candidates: [
      baseCandidate({
        coordinate,
        placements: placements.map((placement) => ({
          featureId: placement.featureId,
          partIndex: placement.partIndex,
          vertexIndex: placement.vertexIndex,
        })),
      }),
    ],
  });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-review-"));
  const reviewPath = path.join(temp, "review.json");
  fs.writeFileSync(reviewPath, JSON.stringify(review), "utf-8");

  const ok = runCli([reviewPath]);
  assert.equal(ok.status, 0, ok.stderr);

  const broken = { ...review, reviewId: "bad" };
  fs.writeFileSync(reviewPath, JSON.stringify(broken), "utf-8");
  const failed = runCli([reviewPath]);
  assert.equal(failed.status, 1);
});
