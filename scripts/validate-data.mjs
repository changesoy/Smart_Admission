import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const readJson = (relPath) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf-8"));

const zones = readJson("data/zones.geojson");
const schools = readJson("data/schools.json");
const policies = readJson("data/policies.json");
const addressPoints = readJson("data/address_points.json");
const keywordsIndex = readJson("data/keywords_index.json");

let hasError = false;
let warnCount = 0;

const error = (msg) => {
  hasError = true;
  console.error(`❌ ${msg}`);
};

const warn = (msg) => {
  warnCount++;
  console.warn(`⚠️  ${msg}`);
};

const assertUnique = (list, getId, label) => {
  const seen = new Set();
  list.forEach((item, index) => {
    const id = getId(item);
    if (!id) {
      error(`${label}[${index}] 缺少 id`);
      return;
    }
    if (seen.has(id)) {
      error(`${label} 存在重复 id: ${id}`);
    }
    seen.add(id);
  });
  return seen;
};

const LNG_RANGE = [116.0, 119.0];
const LAT_RANGE = [35.0, 37.5];

const checkCoordinate = (lng, lat, label) => {
  if (typeof lng !== "number" || typeof lat !== "number") return;
  if (lng < LNG_RANGE[0] || lng > LNG_RANGE[1]) {
    warn(`${label} 经度超出合理范围 [${LNG_RANGE}], 当前: ${lng}`);
  }
  if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
    warn(`${label} 纬度超出合理范围 [${LAT_RANGE}], 当前: ${lat}`);
  }
};

console.log("=== 数据校验开始 ===\n");

const zoneFeatures = zones.features || [];
const zoneIds = assertUnique(
  zoneFeatures,
  (f) => f.properties && f.properties.zoneId,
  "zones.geojson"
);

const schoolIds = assertUnique(schools, (s) => s.schoolId, "schools.json");

const policyIds = assertUnique(
  policies,
  (p) => p.policyId,
  "policies.json"
);

const addressIds = assertUnique(
  addressPoints,
  (a) => a.addressId,
  "address_points.json"
);

console.log("\n--- zones.geojson 校验 ---");

zoneFeatures.forEach((feature) => {
  const props = feature.properties || {};
  const zoneId = props.zoneId || "未知学区";

  if (!props.zoneName) {
    error(`${zoneId} 缺少 zoneName`);
  }

  if (!["小学", "初中"].includes(props.stage)) {
    error(`${zoneId} 的 stage 非法: ${props.stage}`);
  }

  if (props.schoolId && !schoolIds.has(props.schoolId)) {
    error(`${zoneId} 关联的 schoolId 不存在: ${props.schoolId}`);
  }

  (props.policyIds || []).forEach((pid) => {
    if (!policyIds.has(pid)) {
      error(`${zoneId} 关联的 policyId 不存在: ${pid}`);
    }
  });

  const geomType = feature.geometry && feature.geometry.type;
  if (!["Polygon", "MultiPolygon"].includes(geomType)) {
    warn(`${zoneId} geometry.type 不常用: ${geomType}`);
  }

  if (geomType === "Polygon" && feature.geometry.coordinates) {
    const ring = feature.geometry.coordinates[0];
    if (ring && ring.length > 0) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (
        first[0] !== last[0] ||
        first[1] !== last[1]
      ) {
        warn(`${zoneId} Polygon 首尾点未闭合`);
      }
      checkCoordinate(first[0], first[1], `${zoneId} 首点`);
    }
  }

  if (geomType === "MultiPolygon" && feature.geometry.coordinates) {
    feature.geometry.coordinates.forEach((polygon, i) => {
      const ring = polygon[0];
      if (ring && ring.length > 0) {
        const first = ring[0];
        checkCoordinate(first[0], first[1], `${zoneId} MultiPolygon[${i}] 首点`);
      }
    });
  }
});

console.log("\n--- schools.json 校验 ---");

schools.forEach((s) => {
  const id = s.schoolId || "未知学校";
  if (!s.name) {
    error(`学校 ${id} 缺少 name`);
  }
  if (!s.type) {
    error(`学校 ${id} 缺少 type`);
  }
  if (!s.address) {
    warn(`学校 ${id} 缺少 address`);
  }
  if (s.schoolStage && s.schoolStage.length > 0) {
    s.schoolStage.forEach((stage) => {
      if (!["小学", "初中"].includes(stage)) {
        warn(`学校 ${id} schoolStage 包含非常见值: ${stage}`);
      }
    });
  }
});

console.log("\n--- address_points.json 校验 ---");

addressPoints.forEach((item) => {
  const label = item.name || item.addressId || "未知地址点";

  if (item.lng === null || item.lat === null) {
    warn(`地址点 ${label} 经纬度为 null（坐标待补）`);
  } else {
    if (typeof item.lng !== "number" || typeof item.lat !== "number") {
      error(`地址点 ${label} 经纬度不是数字`);
    } else {
      checkCoordinate(item.lng, item.lat, `地址点 ${label}`);
    }
  }

  if (item.matchedZoneId && !zoneIds.has(item.matchedZoneId)) {
    error(`地址点 ${label} matchedZoneId 不存在: ${item.matchedZoneId}`);
  }
});

console.log("\n--- keywords_index.json 校验 ---");

keywordsIndex.forEach((item) => {
  const label = item.keyword || "未知关键词";
  (item.matchedZoneIds || []).forEach((zoneId) => {
    if (!zoneIds.has(zoneId)) {
      error(`关键词 ${label} 关联了不存在的 zoneId: ${zoneId}`);
    }
  });
});

console.log("\n=== 校验结果 ===");

if (hasError) {
  console.error(`\n❌ 数据校验失败（${warnCount} 条警告）`);
  process.exit(1);
}

console.log(`✅ 数据校验通过（${warnCount} 条警告）`);
