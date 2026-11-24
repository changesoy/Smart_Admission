#!/usr/bin/env node
/**
 * export-network-refs.mjs - 导出边界要素与学区绑定待办清单
 *
 * 契约：docs/planning/统一边界网络数据契约与ID规则.md
 *
 * 产出 reports/network/reference-list.md，供角色 A（数据维护）与角色 C（学区绑定）查阅：
 *   - 要素清单：featureId、名称、类型、旧 roadId、来源与核验状态
 *   - 学区待办：官方四至中提及但尚未确认的要素候选
 *   - 几何待修正：会阻断拓扑生成的数据问题
 *
 * 名称匹配只作为候选提示，不构成绑定结论。
 *
 * 用法：
 *   node scripts/export-network-refs.mjs
 *   node scripts/export-network-refs.mjs --out reports/network/reference-list.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { eachPart, validateBoundaryFeatures } from "./lib/network-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const getOption = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const FEATURES = path.resolve(
  ROOT,
  getOption("--features", "data/boundary_features.v2.geojson"),
);
const ZONE_SPECS = path.resolve(ROOT, getOption("--zones", "data/zone_specs.v2.json"));
const OUT = path.resolve(ROOT, getOption("--out", "reports/network/reference-list.md"));

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null);

const escapeCell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

const main = () => {
  const features = readJson(FEATURES);
  if (!features) {
    console.error(`缺少 ${path.relative(ROOT, FEATURES)}，请先运行 npm run migrate:features`);
    process.exit(1);
  }

  const registry = readJson(path.resolve(ROOT, "data/id_registry.json"));
  const legacyByFeatureId = new Map(
    (registry?.entries ?? [])
      .filter((entry) => entry.entityType === "boundaryFeature")
      .map((entry) => [
        entry.id,
        (entry.legacyRefs ?? []).map((ref) => `${ref.jsonType}:${ref.value}`).join("、"),
      ]),
  );

  const featureList = features.features.map((feature) => {
    const props = feature.properties;
    const parts = eachPart(feature.geometry);
    return {
      featureId: props.featureId,
      name: props.canonicalName,
      aliases: props.aliases ?? [],
      featureType: props.featureType,
      legacy: legacyByFeatureId.get(props.featureId) ?? "",
      sourceType: props.sourceType,
      verificationStatus: props.verificationStatus,
      geometryAccuracy: props.geometryAccuracy,
      boundaryEligible: props.boundaryEligible,
      partCount: parts.length,
      vertexCount: parts.reduce((sum, part) => sum + part.length, 0),
    };
  });

  const nameIndex = new Map();
  featureList.forEach((item) => {
    [item.name, ...item.aliases].forEach((name) => {
      if (!name) return;
      if (!nameIndex.has(name)) nameIndex.set(name, []);
      nameIndex.get(name).push(item.featureId);
    });
  });

  const zoneSpecs = readJson(ZONE_SPECS);
  const zoneRows = (zoneSpecs?.zones ?? []).map((zone) => {
    const matched = [...nameIndex.entries()]
      .filter(([name]) => zone.boundaryText.includes(name))
      .map(([name, ids]) => `${name}(${ids.join("/")})`);
    return {
      zoneId: zone.zoneId,
      zoneName: zone.zoneName,
      stage: zone.stage,
      rulingCount: (zone.boundaryRulings ?? []).length,
      matched: matched.join("、"),
    };
  });

  const geometryReport = validateBoundaryFeatures(features);
  const geometryIssues = geometryReport.errors;

  const lines = [
    "# 边界网络引用清单",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "> 本文件由 `npm run export:network-refs` 生成，名称匹配仅作候选提示，不构成绑定结论。",
    "",
    "## 一、边界要素",
    "",
    "| featureId | 名称 | 类型 | 旧 roadId | 来源 | 核验 | 精度 | 可作边界 | 段/顶点 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...featureList.map(
      (item) =>
        `| ${item.featureId} | ${escapeCell(item.name)} | ${item.featureType} | ${escapeCell(item.legacy)} | ${item.sourceType} | ${item.verificationStatus} | ${item.geometryAccuracy} | ${item.boundaryEligible ? "是" : "否"} | ${item.partCount}/${item.vertexCount} |`,
    ),
    "",
    `共 ${featureList.length} 个要素。`,
    "",
    "## 二、学区绑定待办",
    "",
    "| zoneId | 学区 | 学段 | 已有裁定 | 四至中命中的要素候选 |",
    "| --- | --- | --- | --- | --- |",
    ...zoneRows.map(
      (row) =>
        `| ${row.zoneId} | ${escapeCell(row.zoneName)} | ${row.stage} | ${row.rulingCount} | ${escapeCell(row.matched) || "（未命中，需人工核对）"} |`,
    ),
    "",
    "## 三、几何待修正（阻断拓扑生成）",
    "",
  ];

  if (geometryIssues.length === 0) {
    lines.push("暂无。");
  } else {
    lines.push("| 位置 | 问题 |", "| --- | --- |");
    geometryIssues.forEach(({ section, message }) => {
      lines.push(`| ${section} | ${escapeCell(message)} |`);
    });
  }

  lines.push("");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"), "utf-8");
  console.log(`已生成 ${path.relative(ROOT, OUT)}`);
  console.log(`要素 ${featureList.length} 个，学区 ${zoneRows.length} 个，几何问题 ${geometryIssues.length} 条`);
};

main();
