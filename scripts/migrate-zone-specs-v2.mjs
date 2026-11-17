#!/usr/bin/env node
/**
 * migrate-zone-specs-v2.mjs - 生成 zone_specs v2 骨架（学区语义层）
 *
 * 契约：docs/planning/统一边界网络数据契约与ID规则.md（第九章、第十二章）
 *
 * 本脚本只搭骨架，不做绑定：
 *   - 保留官方 boundaryText 原文，不改写；
 *   - 迁移既有裁定到 rulingId + geometryRefs，旧 roadId 转成 featureId；
 *   - rings 留空，等 C 绑定 edgeRefs 后由后续工具生成。
 *
 * 输出为草稿 data/zone_specs.v2.json，现有 data/zone_specs.json 不动；
 * 整批切换时再把 v2 提升为正式文件名。
 *
 * 用法：
 *   node scripts/migrate-zone-specs-v2.mjs           # dry-run
 *   node scripts/migrate-zone-specs-v2.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NETWORK_SCHEMA_VERSION, isZoneId } from "./lib/network-schema.mjs";
import {
  allocateIds,
  addEntry,
  findIdByLegacyRef,
  loadRegistry,
  saveRegistry,
} from "./lib/id-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getOption = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const WRITE = hasFlag("--write");
const ZONES = path.resolve(ROOT, getOption("--zones", "data/zones.geojson"));
const LEGACY_SPECS = path.resolve(ROOT, getOption("--specs", "data/zone_specs.json"));
const OUT = path.resolve(ROOT, getOption("--out", "data/zone_specs.v2.json"));
const REGISTRY = path.resolve(ROOT, getOption("--registry", "data/id_registry.json"));
const REPORT = path.resolve(
  ROOT,
  getOption("--report", "reports/network/migration-zone-specs.json"),
);
const TODAY = new Date().toISOString().slice(0, 10);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

/** 裁定去重键：同一学区同一边、同原文同采用对象视为同一条裁定 */
const rulingKey = (zoneId, ruling) =>
  [zoneId, ruling.edge ?? "", ruling.original ?? "", ruling.adopted ?? ""].join("|");

/** 旧 roadId 字符串转 featureId；找不到返回 null 由调用方记录告警 */
const resolveFeatureId = (registry, legacyValue) => {
  if (legacyValue === undefined || legacyValue === null) return null;
  return findIdByLegacyRef(registry, {
    namespace: "roadId",
    jsonType: typeof legacyValue,
    value: legacyValue,
  });
};

const main = () => {
  if (!fs.existsSync(ZONES)) {
    console.error(`找不到 ${path.relative(ROOT, ZONES)}`);
    process.exit(1);
  }

  const zonesFile = readJson(ZONES);
  const legacySpecs = fs.existsSync(LEGACY_SPECS) ? readJson(LEGACY_SPECS) : { zones: [] };
  const registry = loadRegistry(REGISTRY);
  const legacyById = new Map((legacySpecs.zones ?? []).map((zone) => [zone.zoneId, zone]));

  const warnings = [];
  let rulingCount = 0;

  const zones = (zonesFile.features ?? []).map((feature, index) => {
    const props = feature.properties ?? {};
    const {zoneId} = props;
    if (!isZoneId(zoneId)) {
      throw new Error(`第 ${index + 1} 个学区 zoneId 非法: ${JSON.stringify(zoneId)}`);
    }

    const legacy = legacyById.get(zoneId);
    const rawRulings = [
      ...(props.boundaryRulings ?? []),
      ...((legacy?.rulings ?? []).map((ruling) => ({
        ...ruling,
        decidedAt: ruling.decidedAt ?? legacySpecs.generatedAt ?? TODAY,
        decider: ruling.decider ?? "未记录",
      }))),
    ];

    const seenRulings = new Set();
    const boundaryRulings = rawRulings
      .filter((ruling) => {
        const key = rulingKey(zoneId, ruling);
        if (seenRulings.has(key)) return false;
        seenRulings.add(key);
        return true;
      })
      .map((ruling) => {
        const legacyRef = {
          namespace: "legacyRuling",
          jsonType: "string",
          value: rulingKey(zoneId, ruling),
        };
        let rulingId = findIdByLegacyRef(registry, legacyRef);
        if (!rulingId) {
          [rulingId] = allocateIds(registry, "boundaryRuling", 1);
          addEntry(registry, {
            id: rulingId,
            entityType: "boundaryRuling",
            legacyRefs: [legacyRef],
            createdAt: ruling.decidedAt ?? TODAY,
          });
        }
        rulingCount += 1;

        const {geometryRef} = ruling;
        const featureId = resolveFeatureId(registry, geometryRef);
        if (geometryRef !== undefined && geometryRef !== null && !featureId) {
          warnings.push(
            `${zoneId} 裁定「${ruling.edge}」的 geometryRef=${JSON.stringify(geometryRef)} 未在注册表中找到`,
          );
        }

        return {
          rulingId,
          edge: ruling.edge ?? "",
          original: ruling.original ?? "",
          adopted: ruling.adopted ?? "",
          geometryRefs: {
            featureIds: featureId ? [featureId] : [],
            edgeIds: [],
          },
          reason: ruling.reason ?? "",
          decidedAt: ruling.decidedAt ?? TODAY,
          decider: ruling.decider ?? "未记录",
          lifecycle: "active",
          supersedes: [],
          supersededBy: [],
          createdAt: ruling.decidedAt ?? TODAY,
          retiredAt: null,
        };
      });

    return {
      zoneId,
      zoneName: props.zoneName ?? "",
      schoolId: props.schoolId ?? "",
      stage: props.stage ?? "",
      year: props.year ?? null,
      boundaryText: props.boundaryText ?? props.description ?? "",
      policyIds: props.policyIds ?? [],
      boundaryRulings,
      rings: [],
    };
  });

  const result = { schemaVersion: NETWORK_SCHEMA_VERSION, zones };
  const report = {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, ZONES).replaceAll("\\", "/"),
    legacySpecs: path.relative(ROOT, LEGACY_SPECS).replaceAll("\\", "/"),
    output: path.relative(ROOT, OUT).replaceAll("\\", "/"),
    writable: WRITE,
    zoneCount: zones.length,
    rulingCount,
    boundZoneCount: zones.filter((zone) => zone.rings.length > 0).length,
    warnings,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  if (warnings.length > 0) {
    console.log(`告警 ${warnings.length} 条：`);
    warnings.slice(0, 10).forEach((message) => console.log(`  - ${message}`));
  }

  if (!WRITE) {
    console.log(`dry-run：将生成 ${zones.length} 个学区骨架、迁移 ${rulingCount} 条裁定`);
    console.log(`报告已写入 ${path.relative(ROOT, REPORT)}`);
    return;
  }

  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  saveRegistry(REGISTRY, registry);
  console.log(`已写入 ${path.relative(ROOT, OUT)}：${zones.length} 个学区，${rulingCount} 条裁定`);
  console.log(`已更新 ${path.relative(ROOT, REGISTRY)}`);
};

main();
