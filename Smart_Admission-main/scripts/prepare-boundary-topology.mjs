#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBoundaryTopologyPlan } from "./lib/boundary-topology.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const write = args.includes("--write");
const featuresPath = path.resolve(ROOT, valueOf("--features", "data/boundary_features.v2.geojson"));
const decisionsPath = path.resolve(
  ROOT,
  valueOf("--decisions-out", "data/network_connection_decisions.json"),
);
const reportPath = path.resolve(
  ROOT,
  valueOf("--report", "reports/network/boundary-topology-plan.json"),
);
const remapPath = path.resolve(
  ROOT,
  valueOf("--remap-out", "reports/network/boundary-placement-remap.json"),
);
const anchorRadiusMeters = Number(valueOf("--anchor-radius", "30"));

if (!Number.isFinite(anchorRadiusMeters) || anchorRadiusMeters <= 0) {
  console.error("--anchor-radius 必须为正数");
  process.exit(2);
}

const raw = fs.readFileSync(featuresPath);
const features = JSON.parse(raw.toString("utf8"));
const result = buildBoundaryTopologyPlan({ features, anchorRadiusMeters });
const report = {
  ...result.report,
  source: {
    featuresPath: path.relative(ROOT, featuresPath).split(path.sep).join("/"),
    featuresSha256: crypto.createHash("sha256").update(raw).digest("hex").toUpperCase(),
  },
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (write) {
  const targets = [
    [featuresPath, `${JSON.stringify(result.features, null, 2)}\n`],
    [decisionsPath, `${JSON.stringify(result.decisions, null, 2)}\n`],
    [remapPath, `${JSON.stringify(result.placementRemap, null, 2)}\n`],
  ];
  const staged = [];
  const backups = [];
  try {
    targets.forEach(([target, text]) => {
      const temporary = `${target}.tmp-${process.pid}`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(temporary, text, "utf8");
      JSON.parse(fs.readFileSync(temporary, "utf8"));
      staged.push({ target, temporary });
    });
    staged.forEach(({ target }) => {
      if (!fs.existsSync(target)) return;
      const backup = `${target}.bak-${process.pid}`;
      fs.renameSync(target, backup);
      backups.push({ target, backup });
    });
    staged.forEach(({ target, temporary }) => fs.renameSync(temporary, target));
    backups.forEach(({ backup }) => fs.unlinkSync(backup));
  } catch (error) {
    staged.forEach(({ temporary }) => {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    });
    backups.reverse().forEach(({ target, backup }) => {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      if (fs.existsSync(backup)) fs.renameSync(backup, target);
    });
    throw error;
  }
}

console.log(
  JSON.stringify(
    {
      mode: write ? "write" : "dry-run",
      segmentCrossingsInserted: report.segmentCrossingsInserted,
      intersectionsAfter: report.intersectionsAfter,
      anchorGroups: report.anchorGroups.length,
      suppressedIntersections: report.suppressedIntersections,
      acceptedIntersections: report.acceptedIntersections,
      unresolved: report.unresolved,
    },
    null,
    2,
  ),
);
