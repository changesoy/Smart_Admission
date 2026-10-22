#!/usr/bin/env node
/**
 * repair-zones.mjs - 学区边界修复入口
 *
 * 只负责加载数据、调用预检与执行、写出候选与差异；判定逻辑在 lib/repair-core.mjs。
 * 默认 dry-run：候选写入 reports/repairs/<batchId>/，不修改 data/zones.geojson。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executeBatch, precheckBatch } from "./lib/repair-core.mjs";
import { checkZones } from "./lib/zone-check-core.mjs";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

const readArgument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
};

const relative = (target) =>
  path.relative(ROOT_DIR, target).split(path.sep).join("/");

const formatM2 = (value) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });

const readJson = (target) => JSON.parse(fs.readFileSync(target, "utf-8"));

const sha256Of = (target) =>
  `sha256:${crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;

const listBatchFiles = (batchPath) => {
  if (!fs.existsSync(batchPath)) {
    throw new Error(`修复批次目录不存在: ${relative(batchPath)}`);
  }
  if (fs.statSync(batchPath).isDirectory()) {
    return fs
      .readdirSync(batchPath)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(batchPath, name));
  }
  return [batchPath];
};

const printErrors = (errors) => {
  for (const error of errors) {
    console.error(`  - ${error.recordId ?? "批次"}: ${error.message}`);
  }
};

const main = () => {
  const dataDir = path.resolve(ROOT_DIR, readArgument("data", "data"));
  const batchPath = path.resolve(
    ROOT_DIR,
    readArgument("batch", "data/repairs"),
  );
  const outRoot = path.resolve(
    ROOT_DIR,
    readArgument("out", "reports/repairs"),
  );
  const featuresPath = path.resolve(
    ROOT_DIR,
    readArgument("features", path.join(dataDir, "boundary_features.geojson")),
  );
  const addressPath = path.resolve(
    ROOT_DIR,
    readArgument("address", path.join(dataDir, "address_points.json")),
  );

  let zones;
  let zonesSha256;
  let currentRelease;
  try {
    const zonesPath = path.join(dataDir, "zones.geojson");
    currentRelease = readJson(path.join(dataDir, "current.json")).version;
    zones = readJson(zonesPath);
    zonesSha256 = sha256Of(zonesPath);
  } catch (error) {
    console.error(`[repair:zones] 读取数据失败: ${error.message}`);
    process.exit(2);
  }

  let referenceFeatures = null;
  let featuresSha256 = null;
  if (fs.existsSync(featuresPath)) {
    try {
      referenceFeatures = readJson(featuresPath);
      featuresSha256 = sha256Of(featuresPath);
    } catch (error) {
      console.error(`[repair:zones] 读取骨架线失败: ${error.message}`);
      process.exit(2);
    }
  }

  let addressPoints = [];
  if (fs.existsSync(addressPath)) {
    try {
      const parsed = readJson(addressPath);
      addressPoints = Array.isArray(parsed) ? parsed : (parsed.points ?? []);
    } catch (error) {
      console.error(`[repair:zones] 读取地址点失败: ${error.message}`);
      process.exit(2);
    }
  }

  const checkReport = checkZones(zones);

  let batchFiles;
  try {
    batchFiles = listBatchFiles(batchPath);
  } catch (error) {
    console.error(`[repair:zones] ${error.message}`);
    process.exit(2);
  }

  if (batchFiles.length === 0) {
    console.error(`[repair:zones] 未找到修复批次文件: ${relative(batchPath)}`);
    process.exit(2);
  }

  const parsed = batchFiles.map((file) => {
    try {
      return { file, batch: readJson(file), error: null };
    } catch (error) {
      return { file, batch: null, error: error.message };
    }
  });

  const batchIdCounts = new Map();
  for (const entry of parsed) {
    const batchId = entry.batch?.batchId;
    if (typeof batchId !== "string") continue;
    batchIdCounts.set(batchId, (batchIdCounts.get(batchId) ?? 0) + 1);
  }

  let failed = 0;
  let succeeded = 0;

  console.log(`学区边界修复预检（基线版本 ${currentRelease}）`);
  console.log(`数据: ${relative(path.join(dataDir, "zones.geojson"))}`);

  for (const entry of parsed) {
    const fileName = path.basename(entry.file);
    console.log(`\n批次 ${fileName}`);

    if (entry.error) {
      console.error(`  读取失败: ${entry.error}`);
      failed += 1;
      continue;
    }

    const { batch } = entry;
    const existingBatchIds =
      (batchIdCounts.get(batch?.batchId) ?? 0) > 1 ? [batch?.batchId] : [];

    const precheck = precheckBatch(batch, {
      fileName,
      currentRelease,
      zones,
      zonesSha256,
      checkReport,
      referenceFeatures,
      featuresSha256,
      existingBatchIds,
      addressPoints,
    });

    if (precheck.warnings.length > 0) {
      for (const warning of precheck.warnings) {
        console.warn(`  ⚠ ${warning.recordId ?? "批次"}: ${warning.message}`);
      }
    }

    if (precheck.errors.length > 0) {
      console.error(`  预检失败（${precheck.errors.length} 条），不产出候选：`);
      printErrors(precheck.errors);
      failed += 1;
      continue;
    }

    console.log(`  预检通过：${precheck.plans.length} 条记录`);

    const execution = executeBatch(batch, precheck.plans, {
      zones,
      addressPoints,
    });

    if (execution.errors.length > 0) {
      console.error(
        `  执行失败（${execution.errors.length} 条），不产出候选：`,
      );
      printErrors(execution.errors);
      failed += 1;
      continue;
    }

    for (const diff of execution.diffs) {
      const detail =
        diff.maxDeviationM !== null
          ? `  最大偏离 ${diff.maxDeviationM} m`
          : `  骨架线 ${diff.featureId}  交点偏移 ≤ ${diff.cutOffsetM} m`;
      const start = diff.ringStartChanged ? "  环起点变动" : "";
      console.log(
        `  ${diff.recordId} ${diff.zoneId} ${diff.action}  ` +
          `面积 ${formatM2(diff.areaBeforeM2)} → ${formatM2(diff.areaAfterM2)} m²` +
          `（${diff.areaDeltaM2 >= 0 ? "+" : ""}${formatM2(diff.areaDeltaM2)}）  ` +
          `顶点 ${diff.pointCountBefore} → ${diff.pointCountAfter}${detail}${start}`,
      );
    }
    console.log(`  地址归属变化: ${execution.addressChanges.length} 条`);

    const { batchId } = batch;
    const outDir = path.join(outRoot, batchId);
    fs.mkdirSync(outDir, { recursive: true });

    const candidatePath = path.join(outDir, "zones.candidate.geojson");
    const diffPath = path.join(outDir, "diff.json");
    const addressPathOut = path.join(outDir, "address-changes.json");

    fs.writeFileSync(
      candidatePath,
      `${JSON.stringify(execution.candidate, null, 2)}\n`,
      "utf-8",
    );
    fs.writeFileSync(
      diffPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          batchId,
          baseRelease: batch.baseRelease,
          records: execution.diffs,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    fs.writeFileSync(
      addressPathOut,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          batchId,
          changes: execution.addressChanges,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    console.log(`  候选: ${relative(candidatePath)}`);
    console.log(`  差异: ${relative(diffPath)}`);
    console.log(`  归属: ${relative(addressPathOut)}`);
    succeeded += 1;
  }

  const note =
    succeeded > 0 ? " 当前为 dry-run，未写入 data/zones.geojson。" : "";
  console.log(
    `\n结果: 成功 ${succeeded} 个批次，失败 ${failed} 个批次。${note}`,
  );

  process.exit(failed > 0 ? 2 : 0);
};

main();
