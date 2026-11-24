#!/usr/bin/env node
/**
 * migrate-boundary-features.mjs - 把 roads.geojson 机械迁移为边界要素草稿
 *
 * 契约：docs/planning/统一边界网络数据契约与ID规则.md（第六章、第十二章）
 *
 * 本脚本只换壳不换内容：
 *   - 几何保持不变，坐标按权威精度取 7 位小数，并报告最大偏移量；
 *   - 旧 roadId 完整登记为 legacyRefs（含 JSON 类型，数字与字符串不是同一实体）；
 *   - 新增 featureId 由注册表分配，重复执行时复用已有 ID。
 *
 * 迁移期双轨：输出为草稿 data/boundary_features.v2.geojson，
 * 不覆盖 L2 修复流程仍在使用的 data/boundary_features.geojson；
 * 后者中的旧 featureId 一并登记为 legacyRefs，整批切换时再提升为正式文件名。
 *
 * 用法：
 *   node scripts/migrate-boundary-features.mjs                 # dry-run，只报告
 *   node scripts/migrate-boundary-features.mjs --write         # 落盘要素与注册表
 *   node scripts/migrate-boundary-features.mjs --write --out data/boundary_features.v2.geojson
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEGACY_FEATURE_TYPE,
  LEGACY_ROAD_ID_NAMESPACE,
  LEGACY_STATUS_PROFILE,
  NETWORK_SCHEMA_VERSION,
  approxMeters,
  eachPart,
  roundCoord,
} from "./lib/network-schema.mjs";
import {
  addLegacyRef,
  ensureIdForLegacyRef,
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
const SOURCE = path.resolve(ROOT, getOption("--source", "data/roads.geojson"));
const OUT = path.resolve(
  ROOT,
  getOption("--out", "data/boundary_features.v2.geojson"),
);
const LEGACY_FEATURES = path.resolve(
  ROOT,
  getOption("--legacy-features", "data/boundary_features.geojson"),
);
const REGISTRY = path.resolve(ROOT, getOption("--registry", "data/id_registry.json"));
const REPORT = path.resolve(
  ROOT,
  getOption("--report", "reports/network/migration-features.json"),
);
const TODAY = new Date().toISOString().slice(0, 10);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** 旧 roadId 排序键：先类型后值，保证同输入分配顺序一致 */
const legacyKey = (roadId) =>
  `${typeof roadId === "number" ? "number" : "string"}|${String(roadId)}`;

/** 取整并返回该 part 的最大偏移量（米） */
const roundPart = (part) => {
  let maxShift = 0;
  const rounded = part.map(([lng, lat]) => {
    const next = [roundCoord(lng), roundCoord(lat)];
    maxShift = Math.max(maxShift, approxMeters([lng, lat], next));
    return next;
  });
  return { rounded, maxShift };
};

const main = () => {
  const source = readJson(SOURCE);
  const errors = [];

  if (source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    console.error("源文件不是 FeatureCollection，已中止");
    process.exit(1);
  }

  const registry = loadRegistry(REGISTRY);
  const ordered = [...source.features].sort((a, b) => {
    const ka = legacyKey(a.properties?.roadId);
    const kb = legacyKey(b.properties?.roadId);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  let maxShift = 0;
  let vertexCount = 0;
  const idMap = [];

  const features = ordered.map((feature, index) => {
    const at = `第 ${index + 1} 个要素`;
    const props = feature.properties ?? {};
    const {roadId} = props;

    if (roadId === undefined || roadId === null || String(roadId).trim() === "") {
      errors.push(`${at} 缺少 roadId`);
      return null;
    }
    if (!["number", "string"].includes(typeof roadId)) {
      errors.push(`${at} roadId 类型非法: ${typeof roadId}`);
      return null;
    }
    if (typeof props.name !== "string" || props.name.trim() === "") {
      errors.push(`${at}（roadId=${roadId}）缺少 name`);
      return null;
    }

    const featureType = LEGACY_FEATURE_TYPE[props.type];
    if (!featureType) {
      errors.push(`${at}（roadId=${roadId}）type 未收录: ${JSON.stringify(props.type)}`);
      return null;
    }

    const parts = eachPart(feature.geometry);
    if (parts.length === 0) {
      errors.push(`${at}（roadId=${roadId}）几何不可用`);
      return null;
    }

    const converted = parts.map((part) => {
      const { rounded, maxShift: shift } = roundPart(part);
      maxShift = Math.max(maxShift, shift);
      vertexCount += rounded.length;
      return rounded;
    });

    const legacyRef = {
      namespace: LEGACY_ROAD_ID_NAMESPACE,
      jsonType: typeof roadId,
      value: roadId,
    };
    const featureId = ensureIdForLegacyRef(registry, "boundaryFeature", legacyRef, TODAY);
    idMap.push({ featureId, ...legacyRef, name: props.name });

    const profile = LEGACY_STATUS_PROFILE[String(props.dataStatus)] ?? {
      sourceType: "legacy",
      geometryAccuracy: "unknown",
      verificationStatus: "unreviewed",
    };

    return {
      type: "Feature",
      geometry: {
        type: converted.length === 1 ? "LineString" : "MultiLineString",
        coordinates: converted.length === 1 ? converted[0] : converted,
      },
      properties: {
        featureId,
        canonicalName: props.name.trim(),
        aliases: [],
        featureType,
        boundaryEligible: true,
        importance: props.important === true ? "primary" : "normal",
        sourceType: profile.sourceType,
        sourceName: profile.sourceType === "osm" ? "OpenStreetMap" : null,
        sourceUrl: null,
        verifiedDate: null,
        verificationStatus: profile.verificationStatus,
        geometryAccuracy: profile.geometryAccuracy,
        lifecycle: "active",
        supersedes: [],
        supersededBy: [],
        createdAt: TODAY,
        retiredAt: null,
        note: typeof props.note === "string" ? props.note : "",
      },
    };
  });

  if (errors.length > 0) {
    console.error(`迁移中止，共 ${errors.length} 个阻断问题：`);
    errors.slice(0, 20).forEach((message) => console.error(`  - ${message}`));
    process.exit(1);
  }

  // 旧 L2 骨架线文件使用 bf_mingtang_road 这类手写 ID，按名称映射登记为 legacyRefs，
  // 使 repair 记录在切换后仍能追溯；已是 v2 输出则跳过。
  const legacyFeatureCarryOver = [];
  if (fs.existsSync(LEGACY_FEATURES)) {
    const legacyFile = readJson(LEGACY_FEATURES);
    if (legacyFile.schemaVersion !== NETWORK_SCHEMA_VERSION) {
      (legacyFile.features ?? []).forEach((legacyFeature) => {
        const legacyId = legacyFeature.properties?.featureId;
        const legacyName = legacyFeature.properties?.name;
        if (!legacyId || !legacyName) return;
        const target = features.find(
          (feature) => feature.properties.canonicalName === legacyName,
        );
        if (!target) {
          legacyFeatureCarryOver.push({ legacyId, legacyName, featureId: null });
          return;
        }
        addLegacyRef(registry, target.properties.featureId, {
          namespace: "featureId",
          jsonType: "string",
          value: legacyId,
        });
        legacyFeatureCarryOver.push({
          legacyId,
          legacyName,
          featureId: target.properties.featureId,
        });
      });
    }
  }

  const collection = {
    type: "FeatureCollection",
    schemaVersion: NETWORK_SCHEMA_VERSION,
    features,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, SOURCE).replaceAll("\\", "/"),
    sourceHash: sha256(SOURCE),
    output: path.relative(ROOT, OUT).replaceAll("\\", "/"),
    writable: WRITE,
    featureCount: features.length,
    vertexCount,
    maxCoordinateShiftM: Number(maxShift.toFixed(4)),
    idMap,
    legacyFeatureCarryOver,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  if (!WRITE) {
    console.log(`dry-run：将迁移 ${features.length} 个要素、${vertexCount} 个顶点`);
    console.log(`坐标最大偏移 ${maxShift.toFixed(4)} m`);
    console.log(`报告已写入 ${path.relative(ROOT, REPORT)}`);
    console.log("加 --write 才会写入要素文件与 ID 注册表");
    return;
  }

  fs.writeFileSync(OUT, `${JSON.stringify(collection, null, 2)}\n`, "utf-8");
  saveRegistry(REGISTRY, registry);

  console.log(`已写入 ${path.relative(ROOT, OUT)}：${features.length} 个要素`);
  console.log(`已更新 ${path.relative(ROOT, REGISTRY)}`);
  console.log(`坐标最大偏移 ${maxShift.toFixed(4)} m`);
  console.log(`报告：${path.relative(ROOT, REPORT)}`);
};

main();
