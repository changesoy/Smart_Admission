import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDecisionsFromReview } from "../lib/connection-decision-build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "scripts/build-connection-decisions.mjs");

const candidate = (overrides = {}) => ({
  candidateId: "ncc_000002",
  category: "exactSharedVertex",
  coordinate: [117.0, 36.0],
  placements: [
    { featureId: "bf_000002", partIndex: 0, vertexIndex: 4 },
    { featureId: "bf_000001", partIndex: 0, vertexIndex: 1 },
  ],
  segments: [],
  reviewStatus: "connected",
  proposedConnectionType: "connected",
  rulingIds: ["br_000002", "br_000001"],
  reviewNote: "",
  ...overrides,
});

const normalized = (candidates) => ({
  schemaVersion: 1,
  reviewId: "ncr_0123abcd",
  source: { featuresSha256: "A".repeat(64), gitCommit: "abc123" },
  reviewer: "测试",
  reviewedAt: "2026-11-21",
  counts: {},
  candidates,
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
    return { status: error.status, stderr: error.stderr ?? "" };
  }
};

test("只转换已明确连接语义的审核项", () => {
  const result = buildDecisionsFromReview(
    normalized([
      candidate({ candidateId: "ncc_000003", reviewStatus: "pending", proposedConnectionType: null }),
      candidate({ candidateId: "ncc_000002" }),
      candidate({
        candidateId: "ncc_000001",
        reviewStatus: "nonConnectingCrossing",
        proposedConnectionType: "nonConnectingCrossing",
      }),
      candidate({
        candidateId: "ncc_000004",
        reviewStatus: "needsGeometryFix",
        proposedConnectionType: null,
      }),
    ]),
  );

  assert.deepEqual(
    result.decisions.map((decision) => decision.decisionId),
    ["ncd_000001", "ncd_000002"],
  );
  assert.equal(result.decisions[0].connectionType, "nonConnectingCrossing");
  assert.equal(result.decisions[1].connectionType, "connected");
  assert.deepEqual(result.decisions[1].placements, [
    { featureId: "bf_000001", partIndex: 0, vertexIndex: 1 },
    { featureId: "bf_000002", partIndex: 0, vertexIndex: 4 },
  ]);
  assert.deepEqual(result.decisions[1].rulingIds, ["br_000001", "br_000002"]);
  assert.equal(result.source.reviewId, "ncr_0123abcd");
});

test("审核说明为空时生成可审计的默认说明", () => {
  const result = buildDecisionsFromReview(normalized([candidate()]));
  assert.equal(result.decisions[0].note, "ncc_000002 exactSharedVertex 经审核为 connected");
});

test("CLI 拒绝写入 data/ 并拒绝未知参数", () => {
  const toData = runCli(["reports/network/review.json", "--out", "data/network_connection_decisions.json"]);
  assert.equal(toData.status, 2);
  assert.match(toData.stderr, /拒绝写入 data\//);

  const unknown = runCli(["--unknown"]);
  assert.equal(unknown.status, 2);
});
