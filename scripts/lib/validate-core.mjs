/**
 * validate-core.mjs - 数据校验公共核心
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 目的: 同一套「结构 / 引用 / 几何」校验被开发期与发布期两个入口共用,避免抄两份后互相漂移。
 *   - scripts/validate-data.mjs   开发期: 只查结构合法,允许 estimated 与占位数据
 *   - scripts/check-release.mjs   发布期: 在其上启用 strict 规则,再追加发布专属检查
 *
 * 纳入校验的数据文件取自 js/config.js 的 dataPaths(与前端加载、与发布脚本同一来源)。
 * 本模块只做纯计算: 收集问题并返回,不打印、不退出、不读环境变量。
 */
import fs from "node:fs";
import path from "node:path";

import AppConfig from "../../js/config.js";

/** 坐标合理范围(泰安及周边):开发期仅提示,strict 下升级为拒发问题 */
export const LNG_RANGE = [116.0, 119.0];
export const LAT_RANGE = [35.0, 37.5];

/** 参与结构校验的文件键名,与 config.js 的 dataPaths 键一致 */
export const DATASET_KEYS = [
  "zones",
  "schools",
  "policies",
  "addressPoints",
  "keywordsIndex",
  "simulatorRules",
];

/** 按 config.js 的文件名映射,从指定目录加载参与结构校验的数据 */
export const loadDataset = (dir) =>
  Object.fromEntries(
    DATASET_KEYS.map((key) => [
      key,
      JSON.parse(
        fs.readFileSync(path.join(dir, AppConfig.dataPaths[key]), "utf-8"),
      ),
    ]),
  );

/** 问题收集器:统一为 { section, message },section 标识出问题的是哪个数据文件 */
const createReport = () => {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error: (section, message) => errors.push({ section, message }),
    warn: (section, message) => warnings.push({ section, message }),
  };
};

/** 校验 id 唯一性,返回已出现的 id 集合 */
const assertUnique = (items, getId, section, report) => {
  const seen = new Set();
  items.forEach((item, index) => {
    const id = getId(item);
    if (!id) {
      report.error(section, `第 ${index} 项缺少 id`);
      return;
    }
    if (seen.has(id)) {
      report.error(section, `存在重复 id: ${id}`);
    }
    seen.add(id);
  });
  return seen;
};

/** 校验单点坐标范围;strict 下越界视为拒发问题 */
const checkCoordinate = (lng, lat, label, section, report, strict) => {
  if (typeof lng !== "number" || typeof lat !== "number") return;
  const emit = strict ? report.error : report.warn;
  if (lng < LNG_RANGE[0] || lng > LNG_RANGE[1]) {
    emit(section, `${label} 经度超出合理范围 [${LNG_RANGE}], 当前: ${lng}`);
  }
  if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
    emit(section, `${label} 纬度超出合理范围 [${LAT_RANGE}], 当前: ${lat}`);
  }
};

/** 校验单个外环的闭合性与首点坐标;未闭合在 strict 下视为拒发问题 */
const checkRing = (ring, label, section, report, strict) => {
  if (!ring || ring.length === 0) return;
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    const emit = strict ? report.error : report.warn;
    emit(section, `${label} 首尾点未闭合`);
  }
  checkCoordinate(first[0], first[1], `${label} 首点`, section, report, strict);
};

/** 取几何体的各个外环:Polygon 一个,MultiPolygon 多个 */
const outerRingsOf = (geometry) => {
  const coordinates = geometry && geometry.coordinates;
  if (!coordinates) return [];
  if (geometry.type === "Polygon") {
    return [{ label: "Polygon", ring: coordinates[0] }];
  }
  if (geometry.type === "MultiPolygon") {
    return coordinates.map((polygon, index) => ({
      label: `MultiPolygon[${index}]`,
      ring: polygon[0],
    }));
  }
  return [];
};

/** 递归遍历 JSON,对每个字符串值回调(value, jsonPath) */
const walkStrings = (node, visit, jsonPath = "$") => {
  if (typeof node === "string") {
    visit(node, jsonPath);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      walkStrings(item, visit, `${jsonPath}[${index}]`),
    );
    return;
  }
  if (node && typeof node === "object") {
    Object.entries(node).forEach(([key, value]) =>
      walkStrings(value, visit, `${jsonPath}.${key}`),
    );
  }
};

/**
 * 扫描占位/示例数据。
 * 每个字符串值只记首个命中的词,避免同一处重复报多次。
 */
export const scanPlaceholders = (node, terms) => {
  const hits = [];
  walkStrings(node, (value, jsonPath) => {
    const lowered = value.toLowerCase();
    const term = terms.find((item) => lowered.includes(item.toLowerCase()));
    if (term) {
      hits.push({ path: jsonPath, term });
    }
  });
  return hits;
};

/**
 * 收集若干字段的取值分布,用于暴露年份混用、数据状态构成等。
 * 返回按出现次数降序排列的 { value, count, samplePath }。
 */
export const collectFieldValues = (node, fieldNames) => {
  const counts = new Map();
  const samples = new Map();

  const collect = (current, jsonPath) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => collect(item, `${jsonPath}[${index}]`));
      return;
    }
    if (!current || typeof current !== "object") return;
    Object.entries(current).forEach(([key, value]) => {
      const childPath = `${jsonPath}.${key}`;
      if (fieldNames.includes(key) && typeof value !== "object") {
        const label = String(value);
        counts.set(label, (counts.get(label) || 0) + 1);
        if (!samples.has(label)) samples.set(label, childPath);
      }
      collect(value, childPath);
    });
  };

  collect(node, "$");
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, samplePath: samples.get(value) }));
};

/**
 * 校验数据集结构与引用完整性。
 *
 * @param {object} dataset 由 loadDataset 加载,或等价的同构对象
 * @param {{ strict?: boolean }} [options] strict 开启发布期规则(环未闭合、坐标越界升级为错误)
 * @returns {{ errors: Array<{section: string, message: string}>, warnings: Array<{section: string, message: string}> }}
 */
export const validateDataset = (dataset, options = {}) => {
  const strict = Boolean(options.strict);
  const report = createReport();

  const sections = AppConfig.dataPaths;
  const zoneSection = sections.zones;
  const schoolSection = sections.schools;
  const addressSection = sections.addressPoints;
  const keywordsSection = sections.keywordsIndex;
  const simSection = sections.simulatorRules;

  const zoneFeatures = (dataset.zones && dataset.zones.features) || [];
  const zoneIds = assertUnique(
    zoneFeatures,
    (feature) => feature.properties && feature.properties.zoneId,
    zoneSection,
    report,
  );
  const schoolIds = assertUnique(
    dataset.schools || [],
    (school) => school.schoolId,
    schoolSection,
    report,
  );
  const policyIds = assertUnique(
    dataset.policies || [],
    (policy) => policy.policyId,
    sections.policies,
    report,
  );
  assertUnique(
    dataset.addressPoints || [],
    (item) => item.addressId,
    addressSection,
    report,
  );

  zoneFeatures.forEach((feature) => {
    const props = feature.properties || {};
    const zoneId = props.zoneId || "未知学区";

    if (!props.zoneName) {
      report.error(zoneSection, `${zoneId} 缺少 zoneName`);
    }
    if (!["小学", "初中"].includes(props.stage)) {
      report.error(zoneSection, `${zoneId} 的 stage 非法: ${props.stage}`);
    }
    if (props.schoolId && !schoolIds.has(props.schoolId)) {
      report.error(
        zoneSection,
        `${zoneId} 关联的 schoolId 不存在: ${props.schoolId}`,
      );
    }
    (props.policyIds || []).forEach((pid) => {
      if (!policyIds.has(pid)) {
        report.error(zoneSection, `${zoneId} 关联的 policyId 不存在: ${pid}`);
      }
    });

    const geomType = feature.geometry && feature.geometry.type;
    if (!["Polygon", "MultiPolygon"].includes(geomType)) {
      report.warn(zoneSection, `${zoneId} geometry.type 不常用: ${geomType}`);
    }
    outerRingsOf(feature.geometry).forEach(({ label, ring }) => {
      checkRing(ring, `${zoneId} ${label}`, zoneSection, report, strict);
    });
  });

  (dataset.schools || []).forEach((school) => {
    const id = school.schoolId || "未知学校";
    if (!school.name) {
      report.error(schoolSection, `学校 ${id} 缺少 name`);
    }
    if (!school.type) {
      report.error(schoolSection, `学校 ${id} 缺少 type`);
    }
    if (!school.address) {
      report.warn(schoolSection, `学校 ${id} 缺少 address`);
    }
    if (school.schoolStage && school.schoolStage.length > 0) {
      school.schoolStage.forEach((stage) => {
        if (!["小学", "初中"].includes(stage)) {
          report.warn(schoolSection, `学校 ${id} schoolStage 包含非常见值: ${stage}`);
        }
      });
    }
  });

  (dataset.addressPoints || []).forEach((item) => {
    const label = item.name || item.addressId || "未知地址点";

    if (item.lng === null || item.lat === null) {
      report.warn(addressSection, `地址点 ${label} 经纬度为 null（坐标待补）`);
    } else if (typeof item.lng !== "number" || typeof item.lat !== "number") {
      report.error(addressSection, `地址点 ${label} 经纬度不是数字`);
    } else {
      checkCoordinate(
        item.lng,
        item.lat,
        `地址点 ${label}`,
        addressSection,
        report,
        strict,
      );
    }

    if (item.matchedZoneId && !zoneIds.has(item.matchedZoneId)) {
      report.error(
        addressSection,
        `地址点 ${label} matchedZoneId 不存在: ${item.matchedZoneId}`,
      );
    }
  });

  (dataset.keywordsIndex || []).forEach((item) => {
    const label = item.keyword || "未知关键词";
    (item.matchedZoneIds || []).forEach((zoneId) => {
      if (!zoneIds.has(zoneId)) {
        report.error(
          keywordsSection,
          `关键词 ${label} 关联了不存在的 zoneId: ${zoneId}`,
        );
      }
    });
  });

  const simulatorRules = dataset.simulatorRules || {};
  const simRules = simulatorRules.rules || [];
  assertUnique(simRules, (rule) => rule.ruleId, simSection, report);

  const simMaterials = simulatorRules.materials || {};
  const materialIds = new Set(Object.keys(simMaterials));
  materialIds.forEach((materialId) => {
    const item = simMaterials[materialId] || {};
    if (!item.name) {
      report.error(simSection, `materials.${materialId} 缺少 name`);
    }
  });

  const simForm = simulatorRules.form || [];
  const knownFields = new Set(simForm.map((field) => field.field));
  simForm.forEach((field) => {
    if (!field.field) {
      report.error(simSection, "form 存在缺少 field 的项");
    }
    if (!field.label) {
      report.error(simSection, `表单字段 ${field.field || "?"} 缺少 label`);
    }
    if (!field.options || field.options.length === 0) {
      report.error(simSection, `表单字段 ${field.field || "?"} 缺少 options`);
    }
  });

  simRules.forEach((rule) => {
    const id = rule.ruleId || "未知规则";

    if (!rule.resultType) {
      report.error(simSection, `规则 ${id} 缺少 resultType`);
    }
    if (!rule.resultSummary) {
      report.error(simSection, `规则 ${id} 缺少 resultSummary`);
    }
    if (!rule.conditions || rule.conditions.length === 0) {
      report.error(simSection, `规则 ${id} 缺少 conditions`);
    }

    (rule.conditions || []).forEach((condition, index) => {
      if (!knownFields.has(condition.field)) {
        report.error(
          simSection,
          `规则 ${id} conditions[${index}] 引用了未知字段: ${condition.field}`,
        );
      }
    });

    (rule.requiredMaterialIds || []).forEach((materialId) => {
      if (!materialIds.has(materialId)) {
        report.error(
          simSection,
          `规则 ${id} requiredMaterialIds 引用了 materials 字典中不存在的材料: ${materialId}`,
        );
      }
    });

    (rule.policyIds || []).forEach((policyId) => {
      if (!policyIds.has(policyId)) {
        report.error(
          simSection,
          `规则 ${id} policyIds 引用了不存在的政策: ${policyId}`,
        );
      }
    });
  });

  return { errors: report.errors, warnings: report.warnings };
};
