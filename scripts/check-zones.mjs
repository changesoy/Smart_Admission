#!/usr/bin/env node
/**
 * check-zones.mjs - 学区边界几何检查入口
 *
 * 只负责加载、调用核心、输出报告与退出码；判定逻辑全部在 lib/zone-check-core.mjs。
 * 报告模式：v1 始终以退出码 0 结束，不阻断开发或发布流程。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkZones } from "./lib/zone-check-core.mjs";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

const TYPE_LABELS = {
  "missing-geometry": "缺少几何",
  "unsupported-geometry": "不支持的几何类型",
  "degenerate-ring": "退化环",
  "ring-not-closed": "环未闭合",
  "duplicate-vertex": "重复顶点",
  "self-intersection": "自相交",
  "overlap-crossing": "边界交叉重叠",
  "overlap-containment": "完全包含",
  "shared-edge-overlap": "共边重叠带",
  "shared-edge-gap": "共边缝隙",
};

const readArgument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
};

const relative = (target) =>
  path.relative(ROOT_DIR, target).split(path.sep).join("/");

const dateStamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const main = () => {
  const dataDir = path.resolve(ROOT_DIR, readArgument("data", "data"));
  const outDir = path.resolve(ROOT_DIR, readArgument("out", "reports/zones"));
  const zonesPath = path.join(dataDir, "zones.geojson");

  let featureCollection;
  try {
    featureCollection = JSON.parse(fs.readFileSync(zonesPath, "utf-8"));
  } catch (error) {
    console.error(
      `[check:zones] 读取失败: ${relative(zonesPath)} (${error.message})`,
    );
    process.exit(2);
  }

  const report = checkZones(featureCollection);
  const stamp = dateStamp();
  const jsonPath = path.join(outDir, `issues-${stamp}.json`);
  const geojsonPath = path.join(outDir, `issues-${stamp}.geojson`);

  const zoneNames = new Map(
    (featureCollection.features ?? []).map((feature) => [
      feature.properties?.zoneId,
      feature.properties?.zoneName,
    ]),
  );

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), dataFile: relative(zonesPath), ...report }, null, 2)}\n`,
    "utf-8",
  );

  const issueFeatures = report.issues
    .filter((issue) => Array.isArray(issue.location))
    .map((issue) => ({
      type: "Feature",
      properties: {
        issueId: issue.issueId,
        type: issue.type,
        typeLabel: TYPE_LABELS[issue.type] ?? issue.type,
        zoneIds: issue.zoneIds,
        zoneNames: issue.zoneIds.map(
          (zoneId) => zoneNames.get(zoneId) ?? zoneId,
        ),
        widthM: Number(issue.widthM.toFixed(2)),
        detail: issue.detail,
      },
      geometry: { type: "Point", coordinates: issue.location },
    }));

  fs.writeFileSync(
    geojsonPath,
    `${JSON.stringify({ type: "FeatureCollection", features: issueFeatures }, null, 2)}\n`,
    "utf-8",
  );

  console.log(`学区边界检查报告（${stamp}）`);
  console.log(`数据: ${relative(zonesPath)}  学区数: ${report.zoneCount}`);
  console.log(`分组: ${report.groupKeys.join(" / ")}`);
  console.log(`问题总数: ${report.summary.total}`);
  for (const [type, count] of Object.entries(report.summary.byType)) {
    console.log(`  - ${TYPE_LABELS[type] ?? type}: ${count}`);
  }

  const requiredBlocks = report.blocks.filter(
    (block) => block.reportLevel === "required",
  );
  const nearBlocks = report.blocks.filter(
    (block) => block.reportLevel === "near-threshold",
  );
  const describeBlock = (block) =>
    `    ${block.zoneIds.map((id) => zoneNames.get(id) ?? id).join(" / ")}  ` +
    `${block.areaM2.toFixed(1)} m²（${block.kind}，网格 ${block.cellSizeM} m，` +
    `不确定度 ±${block.areaUncertaintyM2.toFixed(1)} m²）  @ ` +
    `[${block.location?.[0]?.toFixed(6) ?? "-"}, ${block.location?.[1]?.toFixed(6) ?? "-"}]`;

  console.log(
    `冲突块: 共 ${report.blocks.length} 块，其中必须汇报（≥250 m²）${requiredBlocks.length} 块`,
  );
  if (requiredBlocks.length > 0) {
    console.log("必须汇报的冲突块（按面积降序）:");
    for (const block of requiredBlocks) console.log(describeBlock(block));
  }
  if (nearBlocks.length > 0) {
    console.log("阈值附近（200–250 m²，需复核）:");
    for (const block of nearBlocks) console.log(describeBlock(block));
  }

  if (report.pilotCandidates.length === 0) {
    console.log("试点候选: 无（未发现几何问题）");
  } else {
    console.log("试点候选（按必须汇报块数 / 面积 / 宽度排序）:");
    report.pilotCandidates.forEach((candidate, index) => {
      console.log(
        `  ${index + 1}. ${candidate.zoneIds.join(" / ")}  最大面积 ${candidate.maxAreaM2.toFixed(1)} m²  必须汇报块 ${candidate.requiredBlocks}  最大偏离 ${candidate.maxWidthM.toFixed(2)} m  问题 ${candidate.issueIds.length} 条  [${candidate.types.join(", ")}]`,
      );
    });
  }

  console.log("报告已写入:");
  console.log(`  ${relative(jsonPath)}`);
  console.log(`  ${relative(geojsonPath)}`);
};

main();
