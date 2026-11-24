#!/usr/bin/env node
/**
 * build-connection-decisions.mjs - 审核文档转候选裁定
 *
 * 输入必须是 validate-candidate-review 通过的审核文档；
 * 只输出 connected / nonConnectingCrossing，pending / needsGeometryFix 被忽略。
 * 输出写入 reports/ 或其他非正式目录，拒绝直接写 data/。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReport } from "./lib/network-schema.mjs";
import { indexFeatures } from "./lib/network-generator-core.mjs";
import { validateCandidateReview } from "./lib/candidate-review.mjs";
import { buildDecisionsFromReview } from "./lib/connection-decision-build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `审核文档转候选裁定

用法：
  node scripts/build-connection-decisions.mjs <review.json> --out <path>

参数：
  --out <path>   输出路径；必须位于 reports/ 或其他非正式目录
  --help         打印本说明

说明：
  只转换 connected / nonConnectingCrossing；pending / needsGeometryFix 不进入裁定。
  脚本不会写入 data/，正式 decisions 仍需人工确认后再落盘。
退出码：0 成功；1 审核文档错误或无可转换项；2 参数或输出去向非法。`;

class CliError extends Error {}

const parseArgs = (argv) => {
  const options = { reviewPath: null, out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliError("--out 缺少路径");
      options.out = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new CliError(`未知参数: ${arg}`);
    if (options.reviewPath) throw new CliError(`多余的参数: ${arg}`);
    options.reviewPath = arg;
  }
  return options;
};

const isInsideData = (target) => {
  const relative = path.relative(path.join(ROOT, "data"), target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
  if (!options.reviewPath || !options.out) {
    console.error("缺少审核文档路径或 --out");
    console.error(USAGE);
    return 2;
  }

  const outTarget = path.resolve(ROOT, options.out);
  if (isInsideData(outTarget)) {
    console.error("拒绝写入 data/：候选裁定只能输出到 reports/ 或其他非正式目录");
    return 2;
  }

  let review;
  let features;
  let registry;
  try {
    review = readJson(path.resolve(ROOT, options.reviewPath));
    features = readJson(path.join(ROOT, "data/boundary_features.v2.geojson"));
    registry = readJson(path.join(ROOT, "data/id_registry.json"));
  } catch (error) {
    console.error(`读取失败: ${error.message}`);
    return 1;
  }

  const report = createReport();
  const featureIndex = indexFeatures(features, createReport());
  const normalized = validateCandidateReview({ review, registry, featureIndex, report });

  report.errors.forEach(({ message }) => console.error(`错误 ${message}`));
  if (report.errors.length > 0 || !normalized) {
    console.error(`审核文档校验失败：${report.errors.length} 个错误`);
    return 1;
  }

  const decisionsFile = buildDecisionsFromReview(normalized);
  if (decisionsFile.decisions.length === 0) {
    console.error("审核文档没有 connected / nonConnectingCrossing 项，未生成裁定");
    return 1;
  }

  fs.mkdirSync(path.dirname(outTarget), { recursive: true });
  fs.writeFileSync(outTarget, `${JSON.stringify(decisionsFile, null, 2)}\n`, "utf-8");

  const connected = decisionsFile.decisions.filter(
    (decision) => decision.connectionType === "connected",
  ).length;
  console.log(
    `候选裁定：${decisionsFile.decisions.length} 条（connected ${connected}，` +
      `nonConnectingCrossing ${decisionsFile.decisions.length - connected}）；` +
      `输出 ${path.relative(ROOT, outTarget).split(path.sep).join("/")}`,
  );
  return 0;
};

process.exit(main());
