/**
 * check-release.mjs - 发布门禁
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 用法: npm run check:release
 *
 * 与开发期校验的分工:
 *   - scripts/validate-data.mjs  只查结构合法,允许 estimated / 占位数据,用于日常提交
 *   - scripts/check-release.mjs  在其上启用 strict,并追加发布专属检查:
 *                                manifest 完整性、版本一致性、sha256、占位数据扫描
 *
 * 检查对象是「data/current.json 指向的那个发布包」,不是 data/ 下的工作副本。
 *
 * 退出码: 存在拒发问题 → 1;仅有提示项 → 0。
 *
 * ⚠️ 当前数据状态下属预期失败: 现存数据含【待补…】占位与 estimated 标记,
 *    门禁建立后即会命中。真正通过依赖数据清理批次(见 CONTRIBUTING 4.6)。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectFieldValues,
  loadDataset,
  scanPlaceholders,
  validateDataset,
} from "./lib/validate-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const RELEASES_DIR = path.join(DATA_DIR, "releases");
const POINTER_FILE = path.join(DATA_DIR, "current.json");
const MANIFEST_FILE = "manifest.json";

/** 占位/示例数据黑名单,命中即拒发 */
const PLACEHOLDER_TERMS = [
  "example.gov.cn",
  "待补",
  "【待",
  "TODO",
  "示例电话",
  "000000",
  "XXXXXXXX",
  "fake",
  "mock",
];

/** manifest 必填字段 */
const REQUIRED_MANIFEST_FIELDS = [
  "version",
  "generatedAt",
  "effectiveYear",
  "files",
];

/** 提示项清单里最多列出的 id 个数,超出只报总数 */
const MAX_LISTED_IDS = 10;

/** 拒发问题与提示项,分别累计 */
const blockers = [];
const notices = [];

const relative = (filePath) => path.relative(ROOT, filePath);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf-8"));

const sha256Of = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** 执行一个检查阶段,打印标题与结果,并把问题汇总到全局 */
const phase = (title, run) => {
  const result = { blockers: [], notices: [] };
  run(result);

  console.log(`\n--- ${title} ---`);
  if (result.blockers.length === 0 && result.notices.length === 0) {
    console.log("  ✅ 通过");
  }
  result.blockers.forEach((message) => console.log(`  ❌ ${message}`));
  result.notices.forEach((message) => console.log(`  ⚠️  ${message}`));

  blockers.push(...result.blockers);
  notices.push(...result.notices);
};

console.log("=== 发布门禁检查 ===");

// ---------- 1. 版本指针与发布目录 ----------
let releaseDir = null;

phase("1. 版本指针与发布目录", (result) => {
  if (!fs.existsSync(POINTER_FILE)) {
    result.blockers.push(`缺少版本指针 ${relative(POINTER_FILE)}`);
    return;
  }

  const pointer = readJson(POINTER_FILE);
  if (!pointer.version) {
    result.blockers.push(`${relative(POINTER_FILE)} 缺少 version 字段`);
    return;
  }

  releaseDir = path.join(RELEASES_DIR, pointer.version);
  if (!fs.existsSync(releaseDir)) {
    result.blockers.push(
      `指针指向的版本目录不存在: ${relative(releaseDir)}（version = ${pointer.version}）`,
    );
    releaseDir = null;
    return;
  }

  result.notices.push(`当前发布版本: ${pointer.version}`);
});

if (!releaseDir) {
  console.log("\n=== 结果 ===");
  blockers.forEach((message) => console.log(`❌ ${message}`));
  console.error(`\n❌ 发布门禁未通过:无法定位发布包(${blockers.length} 项)`);
  process.exit(1);
}

const version = path.basename(releaseDir);
const releaseFiles = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);
const dataFiles = releaseFiles.filter((name) => name !== MANIFEST_FILE);

// ---------- 2. manifest 完整性 ----------
let manifest = null;

phase("2. manifest 完整性", (result) => {
  const manifestPath = path.join(releaseDir, MANIFEST_FILE);

  if (!fs.existsSync(manifestPath)) {
    result.blockers.push(`缺少 ${MANIFEST_FILE}`);
    return;
  }

  try {
    manifest = readJson(manifestPath);
  } catch (err) {
    result.blockers.push(`${MANIFEST_FILE} 不是合法 JSON: ${err.message}`);
    return;
  }

  REQUIRED_MANIFEST_FIELDS.forEach((field) => {
    if (manifest[field] === undefined || manifest[field] === null) {
      result.blockers.push(`${MANIFEST_FILE} 缺少必填字段: ${field}`);
    }
  });

  if (manifest.version && manifest.version !== version) {
    result.blockers.push(
      `${MANIFEST_FILE} 的 version (${manifest.version}) 与所在目录名 (${version}) 不一致`,
    );
  }

  if (!Number.isInteger(manifest.effectiveYear)) {
    result.blockers.push(
      `${MANIFEST_FILE} 的 effectiveYear 必须是整数, 当前: ${manifest.effectiveYear}`,
    );
  }

  if (Number.isNaN(Date.parse(manifest.generatedAt))) {
    result.blockers.push(
      `${MANIFEST_FILE} 的 generatedAt 不是可解析的时间, 当前: ${manifest.generatedAt}`,
    );
  }

  if (!Array.isArray(manifest.files)) {
    result.blockers.push(`${MANIFEST_FILE} 的 files 必须是数组`);
    return;
  }

  manifest.files.forEach((entry, index) => {
    if (!entry || !entry.name) {
      result.blockers.push(`${MANIFEST_FILE} files[${index}] 缺少 name`);
      return;
    }
    if (typeof entry.bytes !== "number") {
      result.blockers.push(`${MANIFEST_FILE} files[${index}] 缺少 bytes`);
    }
    if (typeof entry.sha256 !== "string" || entry.sha256.length !== 64) {
      result.blockers.push(`${MANIFEST_FILE} files[${index}] 的 sha256 非法`);
    }
  });

  const declared = new Set(manifest.files.map((entry) => entry && entry.name));
  const actual = new Set(dataFiles);
  const missing = dataFiles.filter((name) => !declared.has(name));
  const extra = [...declared].filter((name) => !actual.has(name));

  if (missing.length > 0) {
    result.blockers.push(
      `manifest 未收录实际存在的文件: ${missing.join(", ")}`,
    );
  }
  if (extra.length > 0) {
    result.blockers.push(
      `manifest 记录了目录中不存在的文件: ${extra.join(", ")}`,
    );
  }
});

// ---------- 3. 文件 sha256 校验 ----------
phase("3. 文件完整性 (sha256)", (result) => {
  if (!manifest || !Array.isArray(manifest.files)) {
    result.notices.push("manifest 不可用,跳过");
    return;
  }

  manifest.files.forEach((entry) => {
    if (!entry || !entry.name || typeof entry.sha256 !== "string") return;

    const filePath = path.join(releaseDir, entry.name);
    if (!fs.existsSync(filePath)) return;

    const buffer = fs.readFileSync(filePath);
    const actual = sha256Of(buffer);
    if (actual !== entry.sha256) {
      result.blockers.push(
        `${entry.name} 内容与 manifest 不符: 期望 ${entry.sha256.slice(0, 12)}…, 实际 ${actual.slice(0, 12)}…`,
      );
    }
  });
});

// ---------- 4. 占位数据扫描 ----------
phase("4. 占位数据扫描", (result) => {
  dataFiles.forEach((name) => {
    let parsed = null;
    try {
      parsed = readJson(path.join(releaseDir, name));
    } catch (err) {
      result.blockers.push(`${name} 不是合法 JSON: ${err.message}`);
      return;
    }

    const grouped = new Map();
    scanPlaceholders(parsed, PLACEHOLDER_TERMS).forEach((hit) => {
      // 把数组下标归一为 [*],让「全部命中位置」按字段聚合后仍然完整可读
      const template = hit.path.replace(/\[\d+\]/g, "[*]");
      const key = `${hit.term}\u0000${template}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });

    [...grouped.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, count]) => {
        const [term, template] = key.split("\u0000");
        result.blockers.push(`${name} 「${term}」× ${count}: ${template}`);
      });
  });
});

// ---------- 5. 结构与引用完整性 (strict) ----------
phase("5. 结构与引用完整性 (strict)", (result) => {
  let dataset = null;
  try {
    dataset = loadDataset(releaseDir);
  } catch (err) {
    result.blockers.push(`读取发布包数据失败: ${err.message}`);
    return;
  }

  const { errors, warnings } = validateDataset(dataset, { strict: true });
  errors.forEach((item) =>
    result.blockers.push(`${item.section}: ${item.message}`),
  );
  warnings.forEach((item) =>
    result.notices.push(`${item.section}: ${item.message}`),
  );
});

// ---------- 6. 提示项 ----------
phase("6. 提示项", (result) => {
  let dataset = null;
  try {
    dataset = loadDataset(releaseDir);
  } catch {
    result.notices.push("读取发布包数据失败,跳过");
    return;
  }

  // 年份分布:用于暴露 zones 2025 / policies 2026 这类混用
  dataFiles.forEach((name) => {
    const parsed = readJson(path.join(releaseDir, name));
    const years = collectFieldValues(parsed, ["year", "effectiveYear"]);
    const statuses = collectFieldValues(parsed, ["dataStatus"]);
    const accuracy = collectFieldValues(parsed, ["geometryAccuracy"]);

    const describe = (items) =>
      items.map((item) => `${item.value}×${item.count}`).join(", ");

    if (years.length > 0) {
      result.notices.push(`${name} 年份分布: ${describe(years)}`);
    }
    if (statuses.length > 0) {
      result.notices.push(`${name} dataStatus 分布: ${describe(statuses)}`);
    }
    if (accuracy.length > 0) {
      result.notices.push(
        `${name} geometryAccuracy 分布: ${describe(accuracy)}`,
      );
    }
  });

  // 孤立引用:未被任何学区引用的学校 / 未被任何地方引用的政策
  const referencedSchools = new Set(
    ((dataset.zones && dataset.zones.features) || [])
      .map((feature) => feature.properties && feature.properties.schoolId)
      .filter(Boolean),
  );
  const orphanSchools = (dataset.schools || [])
    .map((school) => school.schoolId)
    .filter((id) => id && !referencedSchools.has(id));

  const referencedPolicies = new Set([
    ...((dataset.zones && dataset.zones.features) || []).flatMap(
      (feature) => (feature.properties && feature.properties.policyIds) || [],
    ),
    ...((dataset.simulatorRules && dataset.simulatorRules.rules) || []).flatMap(
      (rule) => rule.policyIds || [],
    ),
  ]);
  const orphanPolicies = (dataset.policies || [])
    .map((policy) => policy.policyId)
    .filter((id) => id && !referencedPolicies.has(id));

  const listIds = (ids) =>
    ids.length <= MAX_LISTED_IDS
      ? ids.join(", ")
      : `${ids.slice(0, MAX_LISTED_IDS).join(", ")} 等 ${ids.length} 个`;

  result.notices.push(
    orphanSchools.length > 0
      ? `未被任何学区引用的学校 ${orphanSchools.length} 个: ${listIds(orphanSchools)}`
      : "所有学校均被学区引用",
  );
  result.notices.push(
    orphanPolicies.length > 0
      ? `未被任何学区或自查规则引用的政策 ${orphanPolicies.length} 个: ${listIds(orphanPolicies)}`
      : "所有政策均被引用",
  );
});

// ---------- 结果 ----------
console.log("\n=== 结果 ===");
console.log(`发布版本: ${version}`);
console.log(`拒发问题: ${blockers.length} 项`);
console.log(`提示项  : ${notices.length} 项`);

if (blockers.length > 0) {
  console.error(
    `\n❌ 发布门禁未通过。注意: 当前数据含占位内容,该失败属预期状态,详见 CONTRIBUTING 4.6。`,
  );
  process.exit(1);
}

console.log(`\n✅ 发布门禁通过(另有 ${notices.length} 项提示)`);
