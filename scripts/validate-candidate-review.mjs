#!/usr/bin/env node
/**
 * validate-candidate-review.mjs - 候选审核文档只读校验
 *
 * 与开发服务器保存接口共用 scripts/lib/candidate-review.mjs，
 * 避免浏览器路径与 CLI 路径出现两套规则。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReport } from "./lib/network-schema.mjs";
import { indexFeatures } from "./lib/network-generator-core.mjs";
import { validateCandidateReview } from "./lib/candidate-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `候选审核文档校验

用法：
  node scripts/validate-candidate-review.mjs <review.json> [--report <path>]

退出码：0 通过；1 审核内容错误；2 参数或读取失败。`;

const parseArgs = (argv) => {
  const options = { reviewPath: null, report: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--report") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--report 缺少路径");
      options.report = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`未知参数: ${arg}`);
    if (options.reviewPath) throw new Error(`多余的参数: ${arg}`);
    options.reviewPath = arg;
  }
  return options;
};

const readJson = (target) => JSON.parse(fs.readFileSync(target, "utf-8"));

const main = () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!options.reviewPath) {
    console.error("缺少审核文档路径");
    console.error(USAGE);
    return 2;
  }

  let review;
  let features;
  let registry;
  try {
    review = readJson(path.resolve(ROOT, options.reviewPath));
    features = readJson(path.resolve(ROOT, "data/boundary_features.v2.geojson"));
    registry = readJson(path.resolve(ROOT, "data/id_registry.json"));
  } catch (error) {
    console.error(`读取失败: ${error.message}`);
    return 2;
  }

  const report = createReport();
  const featureIndex = indexFeatures(features, createReport());
  const normalized = validateCandidateReview({ review, registry, featureIndex, report });

  report.errors.forEach(({ message }) => console.error(`错误 ${message}`));
  report.warnings.forEach(({ message }) => console.warn(`警告 ${message}`));

  if (options.report) {
    const target = path.resolve(ROOT, options.report);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `${JSON.stringify(
        {
          reviewPath: options.reviewPath,
          counts: normalized?.counts ?? null,
          errors: report.errors,
          warnings: report.warnings,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    console.error(`报告：${path.relative(ROOT, target)}`);
  }

  if (report.errors.length > 0 || !normalized) {
    console.error(`审核文档校验失败：${report.errors.length} 个错误`);
    return 1;
  }

  console.log(
    `审核文档通过：${normalized.counts.total} 项（connected ${normalized.counts.connected}，` +
      `nonConnectingCrossing ${normalized.counts.nonConnectingCrossing}，` +
      `pending ${normalized.counts.pending}，needsGeometryFix ${normalized.counts.needsGeometryFix}）`,
  );
  return 0;
};

process.exit(main());
