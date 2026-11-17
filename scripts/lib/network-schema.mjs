/**
 * network-schema.mjs - 统一边界网络的数据契约常量与纯校验
 *
 * 契约全文：docs/planning/统一边界网络数据契约与ID规则.md
 *
 * 本模块只做纯计算：给定已解析的数据，收集问题并返回。
 * 不读文件、不打印、不退出，供迁移脚本与校验入口共用。
 */

/** 边界网络契约版本 */
export const NETWORK_SCHEMA_VERSION = 2;

/** 边界要素类型 */
export const FEATURE_TYPES = [
  "road",
  "river",
  "railway",
  "administrativeBoundary",
  "wall",
  "manualRulingLine",
];

/** 数据来源类型（与可信状态分开表达） */
export const SOURCE_TYPES = [
  "official",
  "osm",
  "manualSurvey",
  "imageryTrace",
  "boundaryDerived",
  "manualRuling",
  "legacy",
];

/** 核验状态 */
export const VERIFICATION_STATUSES = [
  "unreviewed",
  "reviewed",
  "verified",
  "disputed",
  "outdated",
];

/** 几何精度 */
export const GEOMETRY_ACCURACIES = [
  "officialBoundary",
  "surveyedOrMapped",
  "imageryApproximation",
  "boundaryDerived",
  "manualRuling",
  "unknown",
];

/** 生命周期 */
export const LIFECYCLES = ["active", "deprecated", "retired"];

/** 节点类型 */
export const NODE_TYPES = ["intersection", "terminal", "control", "ruling"];

/** 节点连通性 */
export const CONNECTION_TYPES = [
  "connected",
  "nonConnectingCrossing",
  "conditional",
];

/** 节点派生方式（与数据来源无关） */
export const DERIVATION_TYPES = [
  "geometryIntersection",
  "featureEndpoint",
  "manualControl",
  "rulingControl",
];

/** 学区步骤来源 */
export const STEP_SOURCE_TYPES = [
  "officialText",
  "boundaryRuling",
  "legacyMigration",
];

/** 环角色 */
export const RING_ROLES = ["outer", "hole"];

/**
 * ID 规格：前缀 + 固定位数。
 * 序号单调递增、永不回收；格式只做校验，不承载业务语义。
 */
export const ID_SPECS = {
  boundaryFeature: { prefix: "bf", digits: 6, property: "featureId" },
  networkNode: { prefix: "bn", digits: 6, property: "nodeId" },
  networkEdge: { prefix: "be", digits: 7, property: "edgeId" },
  zoneRing: { prefix: "zr", digits: 6, property: "ringId" },
  zoneStep: { prefix: "zs", digits: 7, property: "stepId" },
  boundaryRuling: { prefix: "br", digits: 6, property: "rulingId" },
};

/** 学区 ID 沿用既有业务编号，单独校验 */
export const ZONE_ID_PATTERN = /^zone_\d{3}$/;

/** 坐标合理范围（泰安及周边） */
export const LNG_RANGE = [116.0, 119.0];
export const LAT_RANGE = [35.0, 37.5];

/** 权威几何保留的小数位 */
export const COORD_DECIMALS = 7;

/** 旧 roadId → 新 featureId 时必须保留 JSON 类型，数字与字符串不是同一实体 */
export const LEGACY_ROAD_ID_NAMESPACE = "roadId";

/** 旧 dataStatus → 新来源三元组的迁移口径（仅用于机械迁移） */
export const LEGACY_STATUS_PROFILE = {
  osm: {
    sourceType: "osm",
    geometryAccuracy: "surveyedOrMapped",
    verificationStatus: "reviewed",
  },
  estimated: {
    sourceType: "legacy",
    geometryAccuracy: "unknown",
    verificationStatus: "unreviewed",
  },
  "boundary-derived": {
    sourceType: "boundaryDerived",
    geometryAccuracy: "boundaryDerived",
    verificationStatus: "disputed",
  },
};

/** 旧道路中文类型 → 新 featureType，未收录返回 null 由调用方报错 */
export const LEGACY_FEATURE_TYPE = {
  道路: "road",
  河流: "river",
  铁路: "railway",
};

/** 按规格格式化 ID，如 formatId("boundaryFeature", 7) → "bf_000007" */
export const formatId = (entityType, sequence) => {
  const spec = ID_SPECS[entityType];
  if (!spec) throw new Error(`未登记的实体类型: ${entityType}`);
  return `${spec.prefix}_${String(sequence).padStart(spec.digits, "0")}`;
};

/** 校验 ID 字符串是否符合该实体类型的格式 */
export const isId = (entityType, value) => {
  const spec = ID_SPECS[entityType];
  if (!spec || typeof value !== "string") return false;
  return new RegExp(`^${spec.prefix}_\\d{${spec.digits}}$`).test(value);
};

/** 从 ID 反解序号，格式不合法返回 null */
export const parseIdSequence = (entityType, value) => {
  if (!isId(entityType, value)) return null;
  return Number(value.slice(ID_SPECS[entityType].prefix.length + 1));
};

/** 校验学区 ID */
export const isZoneId = (value) =>
  typeof value === "string" && ZONE_ID_PATTERN.test(value);

/** 把坐标按权威精度取整，保证同输入字节一致 */
export const roundCoord = (value) =>
  Math.round(value * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;

/** 两点间近似距离（米），仅用于报告偏差量级 */
export const approxMeters = (a, b) => {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
};

/** 问题收集器，与 validate-core 保持同一形状 */
export const createReport = () => {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error: (section, message) => errors.push({ section, message }),
    warn: (section, message) => warnings.push({ section, message }),
  };
};

/** 遍历 LineString / MultiLineString 的每个 part */
export const eachPart = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
};

const checkEnum = (value, allowed, label, section, report) => {
  if (!allowed.includes(value)) {
    report.error(section, `${label} 取值非法: ${JSON.stringify(value)}`);
  }
};

/**
 * 校验边界要素集合
 * @param {object} collection boundary_features.geojson 的 FeatureCollection
 * @param {object} [options]
 * @param {boolean} [options.strict] true 时把 7 位小数之外的坐标视为错误
 */
export const validateBoundaryFeatures = (collection, options = {}) => {
  const report = createReport();
  const section = "boundary_features";

  if (collection?.type !== "FeatureCollection") {
    report.error(section, "根节点 type 必须是 FeatureCollection");
    return report;
  }
  if (!Array.isArray(collection.features)) {
    report.error(section, "缺少 features 数组");
    return report;
  }
  if (collection.schemaVersion !== NETWORK_SCHEMA_VERSION) {
    report.error(
      section,
      `schemaVersion 应为 ${NETWORK_SCHEMA_VERSION}，当前: ${collection.schemaVersion}`,
    );
  }

  const seenIds = new Set();
  const seenLegacy = new Set();

  collection.features.forEach((feature, index) => {
    const at = `第 ${index + 1} 个要素`;
    const props = feature?.properties ?? {};
    const {featureId} = props;

    if (!isId("boundaryFeature", featureId)) {
      report.error(section, `${at} featureId 格式非法: ${JSON.stringify(featureId)}`);
    } else if (seenIds.has(featureId)) {
      report.error(section, `${at} featureId 重复: ${featureId}`);
    } else {
      seenIds.add(featureId);
    }

    if (typeof props.canonicalName !== "string" || props.canonicalName.trim() === "") {
      report.error(section, `${at} 缺少 canonicalName`);
    }

    const {aliases} = props;
    if (!Array.isArray(aliases)) {
      report.error(section, `${at} aliases 必须是数组`);
    } else {
      const seenAlias = new Set();
      aliases.forEach((alias) => {
        if (typeof alias !== "string" || alias.trim() === "") {
          report.error(section, `${at} aliases 含空值`);
          return;
        }
        if (seenAlias.has(alias)) {
          report.error(section, `${at} aliases 重复: ${alias}`);
        }
        seenAlias.add(alias);
        if (alias === props.canonicalName) {
          report.warn(section, `${at} aliases 与 canonicalName 重复: ${alias}`);
        }
      });
    }

    checkEnum(props.featureType, FEATURE_TYPES, `${at} featureType`, section, report);
    checkEnum(props.sourceType, SOURCE_TYPES, `${at} sourceType`, section, report);
    checkEnum(
      props.verificationStatus,
      VERIFICATION_STATUSES,
      `${at} verificationStatus`,
      section,
      report,
    );
    checkEnum(
      props.geometryAccuracy,
      GEOMETRY_ACCURACIES,
      `${at} geometryAccuracy`,
      section,
      report,
    );
    checkEnum(props.lifecycle, LIFECYCLES, `${at} lifecycle`, section, report);

    if (typeof props.boundaryEligible !== "boolean") {
      report.error(section, `${at} boundaryEligible 必须是布尔值`);
    }

    const parts = eachPart(feature.geometry);
    if (parts.length === 0) {
      report.error(
        section,
        `${at} 几何类型非法: ${feature.geometry?.type ?? "缺失"}，仅接受 LineString / MultiLineString`,
      );
      return;
    }

    let maxExcessDecimals = 0;
    parts.forEach((part, partIndex) => {
      if (!Array.isArray(part) || part.length < 2) {
        report.error(section, `${at} 第 ${partIndex} 段顶点不足 2 个`);
        return;
      }
      part.forEach((coord, vi) => {
        if (!Array.isArray(coord) || coord.length < 2) {
          report.error(section, `${at} 第 ${partIndex} 段第 ${vi} 个顶点非法`);
          return;
        }
        const [lng, lat] = coord;
        if (lng < LNG_RANGE[0] || lng > LNG_RANGE[1]) {
          report.error(section, `${at} 经度越界: ${lng}`);
        }
        if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
          report.error(section, `${at} 纬度越界: ${lat}`);
        }
        [lng, lat].forEach((value) => {
          const decimals = (String(value).split(".")[1] ?? "").length;
          maxExcessDecimals = Math.max(maxExcessDecimals, decimals - COORD_DECIMALS);
        });
        if (vi > 0) {
          const prev = part[vi - 1];
          if (prev[0] === lng && prev[1] === lat) {
            report.error(
              section,
              `${at} 第 ${partIndex} 段第 ${vi} 个顶点与前一点重复（退化段）`,
            );
          }
        }
      });
    });

    if (maxExcessDecimals > 0) {
      const emit = options.strict ? report.error : report.warn;
      emit(
        section,
        `${at} 坐标小数位超过 ${COORD_DECIMALS} 位（最多多出 ${maxExcessDecimals} 位）`,
      );
    }

    (props.legacyRefs ?? []).forEach((ref) => {
      const key = `${ref?.namespace}|${ref?.jsonType}|${ref?.value}`;
      if (seenLegacy.has(key)) {
        report.error(section, `${at} legacyRefs 重复: ${key}`);
      }
      seenLegacy.add(key);
    });
  });

  return report;
};

/** 校验 ID 注册表：计数器不得落后于已分配序号，条目不得重复 */
export const validateIdRegistry = (registry) => {
  const report = createReport();
  const section = "id_registry";

  if (registry?.schemaVersion !== 1) {
    report.error(section, `schemaVersion 应为 1，当前: ${registry?.schemaVersion}`);
    return report;
  }

  const counters = registry.counters ?? {};
  Object.keys(ID_SPECS).forEach((entityType) => {
    if (!Number.isInteger(counters[entityType]) || counters[entityType] < 0) {
      report.error(section, `计数器 ${entityType} 缺失或非整数`);
    }
    if (!registry.entries?.some((entry) => entry.entityType === entityType)) {
      report.warn(section, `实体 ${entityType} 暂无登记条目`);
    }
  });

  const seenIds = new Set();
  const seenLegacy = new Set();
  const maxSeq = {};

  (registry.entries ?? []).forEach((entry, index) => {
    const at = `第 ${index + 1} 条`;
    const entityType = entry?.entityType;
    if (!ID_SPECS[entityType]) {
      report.error(section, `${at} entityType 未知: ${JSON.stringify(entityType)}`);
      return;
    }
    if (!isId(entityType, entry.id)) {
      report.error(section, `${at} id 与类型不匹配: ${entry.id}`);
    }
    if (seenIds.has(entry.id)) {
      report.error(section, `${at} id 重复: ${entry.id}`);
    }
    seenIds.add(entry.id);

    const seq = parseIdSequence(entityType, entry.id);
    if (seq !== null) {
      maxSeq[entityType] = Math.max(maxSeq[entityType] ?? 0, seq);
    }

    checkEnum(entry.lifecycle, LIFECYCLES, `${at} lifecycle`, section, report);

    (entry.legacyRefs ?? []).forEach((ref) => {
      if (!ref?.namespace || !ref?.jsonType || ref.value === undefined) {
        report.error(section, `${at} legacyRefs 缺少 namespace / jsonType / value`);
        return;
      }
      const key = `${ref.namespace}|${ref.jsonType}|${ref.value}`;
      if (seenLegacy.has(key)) {
        report.error(section, `${at} legacyRefs 与已有条目重复: ${key}`);
      }
      seenLegacy.add(key);
    });
  });

  Object.entries(maxSeq).forEach(([entityType, seq]) => {
    if ((counters[entityType] ?? 0) < seq) {
      report.error(
        section,
        `计数器 ${entityType} = ${counters[entityType]}，但已分配到 ${seq}`,
      );
    }
  });

  return report;
};
