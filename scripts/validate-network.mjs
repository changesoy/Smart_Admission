#!/usr/bin/env node
/**
 * validate-network.mjs - 统一边界网络校验入口
 *
 * 契约：docs/planning/统一边界网络数据契约与ID规则.md（第十一章）
 *
 * 当前阶段只校验已存在的文件：
 *   - data/boundary_features.v2.geojson（必需）
 *   - data/id_registry.json（必需）
 *   - data/zone_specs.v2.json（存在则校验）
 *   - data/network_connection_decisions.json（存在则校验）
 *   - data/network_nodes.json / network_edges.json（存在则校验引用）
 *
 * 用法：
 *   node scripts/validate-network.mjs
 *   node scripts/validate-network.mjs --strict    # 坐标精度等警告升级为错误
 *   node scripts/validate-network.mjs --decisions reports/network/decisions.candidate.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ID_SPECS,
  STEP_SOURCE_TYPES,
  STEP_SIDES,
  RING_ROLES,
  createReport,
  isId,
  isZoneId,
  validateBoundaryFeatures,
  validateIdRegistry,
} from "./lib/network-schema.mjs";
import { indexFeatures } from "./lib/network-generator-core.mjs";
import { validateConnectionDecisions } from "./lib/connection-decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  features: "data/boundary_features.v2.geojson",
  registry: "data/id_registry.json",
  zoneSpecs: "data/zone_specs.v2.json",
  decisions: "data/network_connection_decisions.json",
  nodes: "data/network_nodes.json",
  edges: "data/network_edges.json",
};

const USAGE = `统一边界网络校验

用法：
  node scripts/validate-network.mjs [--strict] [--decisions <path>] [--report <path>]

参数：
  --strict             把坐标精度等警告升级为错误
  --decisions <path>   显式校验指定裁定文件；缺省时校验 ${FILES.decisions}（存在才校验）
  --report <path>      输出 JSON 报告
  --help               打印本说明

退出码：0 通过；1 存在数据错误；2 参数或读取失败。`;

class CliError extends Error {}

const VALUE_FLAGS = new Map([
  ["--decisions", "decisions"],
  ["--report", "report"],
]);

const parseArgs = (argv) => {
  const options = {
    strict: false,
    help: false,
    decisions: null,
    decisionsExplicit: false,
    report: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const key = VALUE_FLAGS.get(arg);
    if (!key) throw new CliError(`未知参数: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`参数 ${arg} 缺少值`);
    }
    options[key] = value;
    if (key === "decisions") options.decisionsExplicit = true;
    index += 1;
  }
  return options;
};

const readJson = (relative) => {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null;
};

/** 合并子模块的校验结果 */
const merge = (target, report) => {
  target.errors.push(...report.errors);
  target.warnings.push(...report.warnings);
};

/** 要素与注册表双向核对 */
const crossCheckFeatures = (features, registry, report) => {
  const section = "cross_check";
  if (!features || !registry) return;

  const activeFeatureIds = new Set(
    (features.features ?? []).map((feature) => feature.properties?.featureId),
  );
  const registered = new Map(
    (registry.entries ?? [])
      .filter((entry) => entry.entityType === "boundaryFeature")
      .map((entry) => [entry.id, entry]),
  );

  activeFeatureIds.forEach((featureId) => {
    const entry = registered.get(featureId);
    if (!entry) {
      report.error(section, `${featureId} 存在于要素文件，但注册表无登记`);
      return;
    }
    if (entry.lifecycle !== "active") {
      report.error(section, `${featureId} 已登记为 ${entry.lifecycle}，不应出现在要素文件`);
    }
  });

  registered.forEach((entry) => {
    if (entry.lifecycle === "active" && !activeFeatureIds.has(entry.id)) {
      report.error(section, `${entry.id} 注册为 active，但要素文件中缺失`);
    }
  });
};

/** 学区骨架校验：只检查结构与引用，不检查尚未存在的边 */
const validateZoneSpecs = (zoneSpecs, features, registry, report, options = {}) => {
  const section = "zone_specs_v2";
  if (zoneSpecs?.schemaVersion !== 2) {
    report.error(section, `schemaVersion 应为 2，当前: ${zoneSpecs?.schemaVersion}`);
  }
  if (!Array.isArray(zoneSpecs?.zones)) {
    report.error(section, "缺少 zones 数组");
    return;
  }

  const featureIds = new Set(
    (features?.features ?? []).map((feature) => feature.properties?.featureId),
  );
  const rulingIds = new Set(
    (registry?.entries ?? [])
      .filter((entry) => entry.entityType === "boundaryRuling")
      .map((entry) => entry.id),
  );

  const seenZones = new Set();
  const seenRings = new Set();
  const seenSteps = new Set();

  zoneSpecs.zones.forEach((zone, index) => {
    const at = `第 ${index + 1} 个学区`;
    if (!isZoneId(zone.zoneId)) {
      report.error(section, `${at} zoneId 非法: ${JSON.stringify(zone.zoneId)}`);
    } else if (seenZones.has(zone.zoneId)) {
      report.error(section, `${at} zoneId 重复: ${zone.zoneId}`);
    } else {
      seenZones.add(zone.zoneId);
    }

    if (typeof zone.boundaryText !== "string" || zone.boundaryText.trim() === "") {
      report.error(section, `${at} boundaryText 为空，官方原文不可缺失`);
    }
    if (typeof zone.schoolId !== "string" || zone.schoolId === "") {
      report.error(section, `${at} schoolId 缺失`);
    }

    (zone.boundaryRulings ?? []).forEach((ruling, rulingIndex) => {
      const rulingAt = `${at} 第 ${rulingIndex + 1} 条裁定`;
      if (!isId("boundaryRuling", ruling.rulingId)) {
        report.error(section, `${rulingAt} rulingId 非法: ${JSON.stringify(ruling.rulingId)}`);
      } else if (!rulingIds.has(ruling.rulingId)) {
        report.error(section, `${rulingAt} rulingId 未在注册表登记: ${ruling.rulingId}`);
      }
      (ruling.geometryRefs?.featureIds ?? []).forEach((featureId) => {
        if (!isId("boundaryFeature", featureId) || !featureIds.has(featureId)) {
          report.error(section, `${rulingAt} geometryRefs 引用了不存在的要素: ${featureId}`);
        }
      });
    });

    const rings = zone.rings ?? [];
    const outerRings = rings.filter((ring) => ring.role === "outer");
    if (outerRings.length !== 1) {
      report.error(section, `${at} 必须且只能有一个 outer 环，当前 ${outerRings.length} 个`);
    }
    const outerRingId = outerRings[0]?.ringId;

    rings.forEach((ring, ringIndex) => {
      const ringAt = `${at} 第 ${ringIndex + 1} 个环`;
      if (!isId("zoneRing", ring.ringId)) {
        report.error(section, `${ringAt} ringId 非法: ${JSON.stringify(ring.ringId)}`);
      } else if (seenRings.has(ring.ringId)) {
        report.error(section, `${ringAt} ringId 重复: ${ring.ringId}`);
      } else {
        seenRings.add(ring.ringId);
      }
      if (!RING_ROLES.includes(ring.role)) {
        report.error(section, `${ringAt} role 非法: ${JSON.stringify(ring.role)}`);
      }
      if (ring.role === "hole") {
        if (ring.appliesToRingId !== outerRingId) {
          report.error(
            section,
            `${ringAt} hole 环必须用 appliesToRingId 指向本学区外环 ${outerRingId}`,
          );
        }
        if (!Array.isArray(ring.steps) || ring.steps.length < 3) {
          report.error(section, `${ringAt} hole 环至少需要 3 个步骤才能闭合成环`);
        }
        if ((ring.steps ?? []).some((step) => step.side === "排除")) {
          report.error(
            section,
            `${ringAt} hole 环内不得出现 side=排除 的步骤；与外环相接的排除区应并入外环作凹口`,
          );
        }
      }
      if (!Array.isArray(ring.steps) || ring.steps.length === 0) {
        report.error(section, `${ringAt} 没有 steps，未绑定完成的环不应写入`);
        return;
      }
      let unboundSteps = 0;
      ring.steps.forEach((step, stepIndex) => {
        const stepAt = `${ringAt} 第 ${stepIndex + 1} 步`;
        if (!isId("zoneStep", step.stepId)) {
          report.error(section, `${stepAt} stepId 非法: ${JSON.stringify(step.stepId)}`);
        } else if (seenSteps.has(step.stepId)) {
          report.error(section, `${stepAt} stepId 重复: ${step.stepId}`);
        } else {
          seenSteps.add(step.stepId);
        }
        if (!STEP_SOURCE_TYPES.includes(step.sourceType)) {
          report.error(section, `${stepAt} sourceType 非法: ${JSON.stringify(step.sourceType)}`);
        }
        if (!STEP_SIDES.includes(step.side)) {
          report.error(section, `${stepAt} side 非法: ${JSON.stringify(step.side)}`);
        }
        if (!Array.isArray(step.edgeRefs) || step.edgeRefs.length === 0) {
          unboundSteps += 1;
        }
      });
      if (unboundSteps > 0) {
        const emit = options.strict ? report.error : report.warn;
        emit(
          section,
          `${ringAt} 有 ${unboundSteps}/${ring.steps.length} 个步骤尚未绑定 edgeRefs（绑定完成前允许为空）`,
        );
      }
    });
  });
};

/** 节点与边的基础校验：文件尚不存在时跳过 */
const validateTopology = (nodes, edges, features, report) => {
  const section = "topology";
  const featureIds = new Set(
    (features?.features ?? []).map((feature) => feature.properties?.featureId),
  );

  if (nodes) {
    const nodeList = Array.isArray(nodes) ? nodes : (nodes.nodes ?? []);
    const seen = new Set();
    nodeList.forEach((node) => {
      if (!isId("networkNode", node.nodeId)) {
        report.error(section, `节点 ID 非法: ${JSON.stringify(node.nodeId)}`);
      } else if (seen.has(node.nodeId)) {
        report.error(section, `节点 ID 重复: ${node.nodeId}`);
      } else {
        seen.add(node.nodeId);
      }
      (node.placements ?? []).forEach((placement) => {
        if (!featureIds.has(placement.featureId)) {
          report.error(section, `${node.nodeId} 引用了不存在的要素: ${placement.featureId}`);
        }
      });
    });
  }

  if (edges) {
    const nodeList = Array.isArray(nodes) ? nodes : (nodes?.nodes ?? []);
    const nodeIds = new Set(nodeList.map((node) => node.nodeId));
    const edgeList = Array.isArray(edges) ? edges : (edges.edges ?? []);
    const seen = new Set();
    edgeList.forEach((edge) => {
      if (!isId("networkEdge", edge.edgeId)) {
        report.error(section, `边 ID 非法: ${JSON.stringify(edge.edgeId)}`);
      } else if (seen.has(edge.edgeId)) {
        report.error(section, `边 ID 重复: ${edge.edgeId}`);
      } else {
        seen.add(edge.edgeId);
      }
      if (!featureIds.has(edge.featureId)) {
        report.error(section, `${edge.edgeId} 引用了不存在的要素: ${edge.featureId}`);
      }
      [edge.fromNodeId, edge.toNodeId].forEach((nodeId) => {
        if (nodeIds.size > 0 && !nodeIds.has(nodeId)) {
          report.error(section, `${edge.edgeId} 引用了不存在的节点: ${nodeId}`);
        }
      });
      if (edge.fromNodeId === edge.toNodeId) {
        report.error(section, `${edge.edgeId} 起止节点相同`);
      }
    });
  }
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

  const report = createReport();
  const features = readJson(FILES.features);
  const registry = readJson(FILES.registry);

  if (!features) {
    console.error(`缺少 ${FILES.features}，请先运行 npm run migrate:features`);
    process.exit(1);
  }
  if (!registry) {
    console.error(`缺少 ${FILES.registry}，请先运行 npm run migrate:features`);
    process.exit(1);
  }

  merge(report, validateBoundaryFeatures(features, { strict: options.strict }));
  merge(report, validateIdRegistry(registry));
  crossCheckFeatures(features, registry, report);

  const zoneSpecs = readJson(FILES.zoneSpecs);
  if (zoneSpecs) validateZoneSpecs(zoneSpecs, features, registry, report, { strict: options.strict });

  const decisionsPath = options.decisions ?? FILES.decisions;
  const decisionsFile = readJson(decisionsPath);
  if (options.decisionsExplicit && !decisionsFile) {
    console.error(`缺少显式指定的裁定文件: ${decisionsPath}`);
    process.exit(2);
  }
  if (decisionsFile) {
    const featureIndex = indexFeatures(features, createReport());
    validateConnectionDecisions({ decisionsFile, featureIndex, registry, report });
  }

  const nodes = readJson(FILES.nodes);
  const edges = readJson(FILES.edges);
  if (nodes || edges) validateTopology(nodes, edges, features, report);
  else report.warn("topology", "节点与边文件尚未生成，跳过拓扑校验");

  Object.keys(ID_SPECS).forEach((entityType) => {
    if (!registry.counters?.[entityType]) {
      report.warn("id_registry", `${entityType} 计数器为 0`);
    }
  });

  report.warnings.forEach(({ section, message }) => {
    console.warn(`警告 [${section}] ${message}`);
  });
  report.errors.forEach(({ section, message }) => {
    console.error(`错误 [${section}] ${message}`);
  });

  console.log(
    `校验完成：${features.features.length} 个要素，` +
      `${decisionsFile?.decisions?.length ?? 0} 条裁定，` +
      `${report.errors.length} 个错误，${report.warnings.length} 个警告`,
  );

  if (options.report) {
    const target = path.resolve(ROOT, options.report);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          strict: options.strict,
          featureCount: features.features.length,
          decisionCount: decisionsFile?.decisions?.length ?? 0,
          decisionsPath,
          errors: report.errors,
          warnings: report.warnings,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    console.log(`报告：${path.relative(ROOT, target)}`);
  }

  process.exit(report.errors.length > 0 ? 1 : 0);
};

main();
