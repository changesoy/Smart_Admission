#!/usr/bin/env node
/**
 * import-zone-draft.mjs - 把已通过校验的草稿导入正式 zone_specs.v2.json
 *
 * 契约：docs/planning/草稿字段冻结清单.md 第七节导入规则
 *
 * 只回写目标步骤的 edgeRefs：
 * - 不改步骤定义、不改 boundaryText、不分配新 ID；
 * - 只做文本级定点替换，保留原文件其余格式；
 * - 校验或几何检查失败时整体不落盘；
 * - 需要 --write 且 --confirm <draftId> 才允许写入。
 *
 * 退出码：0 成功（dry-run 亦为 0）；1 校验/几何错误；2 参数、读取、解析或写入失败。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildUsageIndex,
  diffRingMetrics,
  expandRefsToCoordinates,
  findSelfIntersections,
  ringMetrics,
} from "./lib/draft-core.mjs";
import { validateZoneDraft } from "./lib/zone-draft-schema.mjs";
import { serializeJson } from "./lib/network-generator-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  zoneSpecs: "data/zone_specs.v2.json",
  nodes: "data/network_nodes.json",
  edges: "data/network_edges.json",
  features: "data/boundary_features.v2.geojson",
  zonesGeojson: "data/zones.geojson",
};

const USAGE = `学区草稿导入

用法：
  node scripts/import-zone-draft.mjs <draft.json> [选项]

选项：
  --zone-specs <path>    正式学区，默认 ${DEFAULTS.zoneSpecs}
  --nodes <path>         网络节点，默认 ${DEFAULTS.nodes}
  --edges <path>         网络边，默认 ${DEFAULTS.edges}
  --features <path>      边界要素几何，默认 ${DEFAULTS.features}
  --zones-geojson <path> 现有环几何，默认 ${DEFAULTS.zonesGeojson}（缺失时差异报告为空）
  --report <path>        差异报告输出
  --confirm <draftId>    --write 时必填，必须与草稿 draftId 完全一致
  --write                实际写入 zone_specs；缺省为 dry-run
  --help                 打印本说明

退出码：0 成功；1 校验/几何错误；2 参数、读取、解析或写入失败。`;

class CliError extends Error {}

const resolve = (target) => (path.isAbsolute(target) ? target : path.join(ROOT, target));

const parseArgs = (argv) => {
  const options = {
    draft: null,
    ...DEFAULTS,
    report: null,
    confirm: null,
    write: false,
    help: false,
  };
  const valueFlags = new Map([
    ["--zone-specs", "zoneSpecs"],
    ["--nodes", "nodes"],
    ["--edges", "edges"],
    ["--features", "features"],
    ["--zones-geojson", "zonesGeojson"],
    ["--report", "report"],
    ["--confirm", "confirm"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      const key = valueFlags.get(arg);
      if (!key) throw new CliError(`未知参数: ${arg}`);
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new CliError(`参数 ${arg} 缺少值`);
      options[key] = value;
      index += 1;
      continue;
    }
    if (options.draft) throw new CliError(`多余的参数: ${arg}`);
    options.draft = arg;
  }
  return options;
};

const readJson = (file, label, { optional = false } = {}) => {
  const target = resolve(file);
  if (!fs.existsSync(target)) {
    if (optional) return null;
    throw new CliError(`缺少${label}: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(target, "utf-8"));
  } catch (error) {
    throw new CliError(`无法解析${label} ${file}: ${error.message}`);
  }
};

/* ----------------------------- 定点文本替换 ----------------------------- */

const findStringEnd = (text, start) => {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === '"') return index;
  }
  throw new CliError("JSON 字符串未闭合");
};

const findMatching = (text, start) => {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      index = findStringEnd(text, index);
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new CliError("JSON 结构未闭合");
};

const findZoneBlock = (text, zoneId) => {
  const pattern = /"zoneId"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1] !== zoneId) continue;
    const start = text.lastIndexOf("{", match.index);
    if (start < 0) break;
    return { start, end: findMatching(text, start) };
  }
  throw new CliError(`zone_specs 文本中找不到 zoneId=${zoneId}`);
};

const formatEdgeRefs = (refs, indent) => {
  if (refs.length === 0) return "[]";
  const lines = refs.map(
    (ref) =>
      `${indent}  { "edgeId": ${JSON.stringify(ref.edgeId)}, "direction": ${JSON.stringify(ref.direction)} }`,
  );
  return `[\n${lines.join(",\n")}\n${indent}]`;
};

const patchZoneSpecsText = (text, zoneId, stepRefs) => {
  const block = findZoneBlock(text, zoneId);
  const replacements = [];

  stepRefs.forEach((refs, stepId) => {
    const stepPattern = new RegExp(`"stepId"\\s*:\\s*"${stepId}"`, "g");
    stepPattern.lastIndex = block.start;
    const match = stepPattern.exec(text);
    if (!match || match.index > block.end) {
      throw new CliError(`zone_specs 文本中找不到步骤 ${stepId}`);
    }
    const stepStart = text.lastIndexOf("{", match.index);
    const stepEnd = findMatching(text, stepStart);
    const keyPattern = /"edgeRefs"\s*:/g;
    keyPattern.lastIndex = match.index;
    const key = keyPattern.exec(text);
    if (!key || key.index > stepEnd) {
      throw new CliError(`步骤 ${stepId} 缺少 edgeRefs 字段`);
    }
    let cursor = keyPattern.lastIndex;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (text[cursor] !== "[") throw new CliError(`步骤 ${stepId} 的 edgeRefs 不是数组`);
    const arrayEnd = findMatching(text, cursor);
    const lineStart = text.lastIndexOf("\n", key.index) + 1;
    const indent = (text.slice(lineStart, key.index).match(/^\s*/) ?? [""])[0];
    replacements.push({
      start: cursor,
      end: arrayEnd + 1,
      text: formatEdgeRefs(refs, indent),
    });
  });

  let patched = text;
  replacements
    .sort((left, right) => right.start - left.start)
    .forEach(({ start, end, text: replacement }) => {
      patched = `${patched.slice(0, start)}${replacement}${patched.slice(end)}`;
    });
  return patched;
};

const verifyPatched = (original, patchedText, zoneId, stepRefs) => {
  const expected = JSON.parse(original);
  const zone = expected.zones.find((item) => item.zoneId === zoneId);
  if (!zone) throw new CliError(`原文中找不到学区 ${zoneId}`);
  zone.rings.forEach((ring) => {
    ring.steps.forEach((step) => {
      if (stepRefs.has(step.stepId)) {
        step.edgeRefs = stepRefs.get(step.stepId);
      }
    });
  });
  let actual;
  try {
    actual = JSON.parse(patchedText);
  } catch (error) {
    throw new CliError(`定点替换后 JSON 无法解析: ${error.message}`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new CliError("定点替换结果与预期不一致，已放弃写入");
  }
};

const writeAtomic = (target, text) => {
  const temp = `${target}.${process.pid}.tmp`;
  const backup = `${target}.${process.pid}.bak`;
  const existed = fs.existsSync(target);
  try {
    fs.writeFileSync(temp, text, "utf-8");
    if (crypto.createHash("sha256").update(fs.readFileSync(temp)).digest("hex") !==
        crypto.createHash("sha256").update(text).digest("hex")) {
      throw new CliError("临时文件校验失败");
    }
    if (existed) fs.copyFileSync(target, backup);
    fs.renameSync(temp, target);
    if (existed) fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (existed && fs.existsSync(backup)) {
      fs.copyFileSync(backup, target);
      fs.rmSync(backup, { force: true });
    }
    throw error;
  }
};

/* ------------------------------- 主流程 ------------------------------- */

const polygonOf = (feature) => {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  if (geometry.type === "Polygon") return geometry.coordinates;
  return null;
};

const main = () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!options.draft) {
    console.error("缺少草稿文件路径");
    console.error(USAGE);
    process.exit(2);
  }

  let draft;
  let zoneSpecs;
  let zoneSpecsText;
  let nodesFile;
  let edgesFile;
  let zonesGeo;
  try {
    draft = readJson(options.draft, "草稿");
    zoneSpecsText = fs.readFileSync(resolve(options.zoneSpecs), "utf-8");
    zoneSpecs = JSON.parse(zoneSpecsText);
    nodesFile = readJson(options.nodes, "网络节点");
    edgesFile = readJson(options.edges, "网络边");
    zonesGeo = readJson(options.zonesGeojson, "现有环几何", { optional: true });
  } catch (error) {
    console.error(`失败：${error.message}`);
    process.exit(2);
  }

  const zones = Array.isArray(zoneSpecs?.zones) ? zoneSpecs.zones : [];
  const zoneSpec = zones.find((zone) => zone.zoneId === draft?.zoneId) ?? null;
  if (!zoneSpec) {
    console.error(`失败：zoneId ${JSON.stringify(draft?.zoneId)} 不在正式学区中`);
    process.exit(1);
  }

  const nodes = nodesFile?.nodes ?? [];
  const edges = edgesFile?.edges ?? [];
  const validation = validateZoneDraft(draft, { zoneSpec, nodes, edges });
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (!Array.isArray(draft?.rings) || draft.rings.length === 0) {
    errors.push({ section: "import", message: "草稿没有可导入的环" });
  }
  if (draft.status !== "readyForReview") {
    errors.push({
      section: "import",
      message: `只有 readyForReview 的草稿允许导入，当前为 ${draft.status}`,
    });
  }
  if (options.write) {
    if (!options.confirm) {
      console.error("失败：--write 必须同时提供 --confirm <draftId>");
      process.exit(2);
    }
    if (options.confirm !== draft.draftId) {
      console.error(
        `失败：--confirm ${options.confirm} 与草稿 ${draft.draftId} 不一致，拒绝写入`,
      );
      process.exit(2);
    }
  }

  const features = readFeaturesForEdges(edges, options.features);
  const featureIndex = new Map(features.map((feature) => [feature.featureId, feature]));

  const geoZone = (zonesGeo?.features ?? []).find(
    (feature) => feature.properties?.zoneId === draft.zoneId,
  );
  const geoRings = polygonOf(geoZone) ?? [];

  const stepRefs = new Map();
  const sharedEdges = new Map();
  const usage = buildUsageIndex(zoneSpecs);
  const geometryRings = [];

  (draft.rings ?? []).forEach((ring, ringIndex) => {
    const refs = (ring.steps ?? []).flatMap((step) =>
      (step.edgeRefs ?? []).map((ref) => ({ ...ref, stepId: step.stepId })),
    );
    refs.forEach((ref) => {
      if (!stepRefs.has(ref.stepId)) stepRefs.set(ref.stepId, []);
      stepRefs.get(ref.stepId).push({ edgeId: ref.edgeId, direction: ref.direction });
      const others = usage
        .get(ref.edgeId)
        ?.filter((entry) => entry.zoneId !== draft.zoneId) ?? [];
      if (others.length > 0) {
        const current = sharedEdges.get(ref.edgeId) ?? [];
        sharedEdges.set(ref.edgeId, [
          ...current,
          ...others.map((entry) => ({
            zoneId: entry.zoneId,
            ringRole: entry.ringRole,
            stepId: entry.stepId,
          })),
        ]);
      }
    });

    const coordinates = expandRefsToCoordinates(refs, edges, featureIndex);
    const metrics = ringMetrics(coordinates);
    const selfIntersections = findSelfIntersections(coordinates);
    const closed =
      coordinates.length > 2 &&
      coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
      coordinates[0][1] === coordinates[coordinates.length - 1][1];

    if (coordinates.length < 3) {
      errors.push({
        section: "geometry",
        message: `${ring.role} 环派生坐标不足 3 个点`,
      });
    }
    if (!closed) {
      errors.push({ section: "geometry", message: `${ring.role} 环派生坐标未闭合` });
    }
    if (selfIntersections.length > 0) {
      errors.push({
        section: "geometry",
        message: `${ring.role} 环自交：${selfIntersections
          .map((hit) => `段 ${hit.segmentA} × 段 ${hit.segmentB}`)
          .join("、")}`,
      });
    }

    if (ring.role === "outer" && metrics.orientation === "cw") {
      warnings.push({ section: "geometry", message: "外环为顺时针，契约要求外环逆时针" });
    }
    if (ring.role === "hole" && metrics.orientation === "ccw") {
      warnings.push({ section: "geometry", message: "洞环为逆时针，契约要求洞环顺时针" });
    }

    const existingCoordinates =
      ring.role === "outer" ? geoRings[0] : geoRings[ringIndex];
    const existing = existingCoordinates ? ringMetrics(existingCoordinates) : null;
    geometryRings.push({
      role: ring.role,
      appliesToRingId: ring.appliesToRingId ?? null,
      stepCount: ring.steps.length,
      edgeRefCount: refs.length,
      closed,
      selfIntersections,
      metrics,
      existing,
      diff: existing ? diffRingMetrics(metrics, existing) : null,
    });

    ring.steps.forEach((step) => {
      const formal = (zoneSpec.rings ?? [])
        .flatMap((item) => item.steps ?? [])
        .find((item) => item.stepId === step.stepId);
      if (formal?.sourceType === "boundaryRuling" && (formal.rulingIds ?? []).length === 0) {
        warnings.push({
          section: "ruling",
          message: `步骤 ${step.stepId} 来源为 boundaryRuling 但没有 rulingIds`,
        });
      }
    });
  });

  const report = {
    draftId: draft.draftId,
    zoneId: draft.zoneId,
    zoneName: zoneSpec.zoneName ?? null,
    status: draft.status,
    importedAt: draft.updatedAt,
    write: options.write,
    stepsUpdated: stepRefs.size,
    rings: geometryRings,
    sharedEdges: [...sharedEdges.entries()].map(([edgeId, usedBy]) => ({
      edgeId,
      usedBy,
    })),
    errors,
    warnings,
  };

  const reportText = serializeJson(report);
  errors.forEach(({ section, message }) => console.error(`错误 [${section}] ${message}`));
  warnings.forEach(({ section, message }) => console.warn(`警告 [${section}] ${message}`));

  if (errors.length > 0) {
    console.log(reportText);
    console.error(`导入失败：${errors.length} 个错误，未写入任何文件`);
    if (options.report) {
      const target = resolve(options.report);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, reportText, "utf-8");
    }
    process.exit(1);
  }

  let patched;
  try {
    patched = patchZoneSpecsText(zoneSpecsText, draft.zoneId, stepRefs);
    verifyPatched(zoneSpecsText, patched, draft.zoneId, stepRefs);
  } catch (error) {
    console.error(`失败：${error.message}`);
    process.exit(2);
  }

  if (!options.write) {
    console.log(reportText);
    console.error(
      `dry-run：将更新 ${stepRefs.size} 个步骤的 edgeRefs；未修改 ${options.zoneSpecs}`,
    );
    if (options.report) {
      const target = resolve(options.report);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, reportText, "utf-8");
    }
    process.exit(0);
  }

  try {
    writeAtomic(resolve(options.zoneSpecs), patched);
    if (options.report) {
      const target = resolve(options.report);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, reportText, "utf-8");
    }
  } catch (error) {
    console.error(`写入失败，已尝试恢复：${error.message}`);
    process.exit(2);
  }

  console.log(reportText);
  console.error(
    `已导入 ${draft.draftId}：更新 ${stepRefs.size} 个步骤的 edgeRefs；` +
      `${options.zoneSpecs} 已原子替换`,
  );
  process.exit(0);
};

/**
 * 从 network_edges 反查需要的要素几何。
 * 正式数据里 edges 只有 featureId，这里按需读取 boundary_features；
 * 由调用方传入的 nodesFile 不含几何，因此单独读取。
 */
const readFeaturesForEdges = (edges, featuresPath) => {
  const file = resolve(featuresPath);
  if (!fs.existsSync(file)) {
    return [];
  }
  const collection = JSON.parse(fs.readFileSync(file, "utf-8"));
  const needed = new Set(edges.map((edge) => edge.featureId));
  return (collection.features ?? [])
    .filter((feature) => needed.has(feature.properties?.featureId))
    .map((feature) => ({ featureId: feature.properties.featureId, ...feature }));
};

main();
