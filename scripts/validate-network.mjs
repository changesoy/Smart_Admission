#!/usr/bin/env node
/**
 * validate-network.mjs - 统一边界网络校验入口
 *
 * 契约：docs/planning/统一边界网络数据契约与ID规则.md（第十一章）
 *
 * 当前阶段只校验已存在的文件：
 *   - data/boundary_features.geojson（必需）
 *   - data/id_registry.json（必需）
 *   - data/zone_specs.v2.json（存在则校验）
 *   - data/network_nodes.json / network_edges.json（存在则校验引用）
 *
 * 用法：
 *   node scripts/validate-network.mjs
 *   node scripts/validate-network.mjs --strict    # 坐标精度等警告升级为错误
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ID_SPECS,
  STEP_SOURCE_TYPES,
  RING_ROLES,
  createReport,
  isId,
  isZoneId,
  validateBoundaryFeatures,
  validateIdRegistry,
} from "./lib/network-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");

const FILES = {
  features: "data/boundary_features.v2.geojson",
  registry: "data/id_registry.json",
  zoneSpecs: "data/zone_specs.v2.json",
  nodes: "data/network_nodes.json",
  edges: "data/network_edges.json",
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

    (zone.rings ?? []).forEach((ring, ringIndex) => {
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

  merge(report, validateBoundaryFeatures(features, { strict: STRICT }));
  merge(report, validateIdRegistry(registry));
  crossCheckFeatures(features, registry, report);

  const zoneSpecs = readJson(FILES.zoneSpecs);
  if (zoneSpecs) validateZoneSpecs(zoneSpecs, features, registry, report, { strict: STRICT });

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
    `校验完成：${features.features.length} 个要素，${report.errors.length} 个错误，${report.warnings.length} 个警告`,
  );

  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0 && process.argv[reportIndex + 1]) {
    const target = path.resolve(ROOT, process.argv[reportIndex + 1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          strict: STRICT,
          featureCount: features.features.length,
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
