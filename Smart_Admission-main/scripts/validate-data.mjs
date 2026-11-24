/**
 * validate-data.mjs - 开发期数据校验
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 校验对象是 data/ 下的**工作副本**(不是发布包),允许 estimated 与占位数据存在,
 * 只关心结构是否合法、引用是否成立。发布前的严格检查见 scripts/check-release.mjs。
 *
 * 校验规则全部来自 scripts/lib/validate-core.mjs,本文件只负责加载与呈现。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDataset, validateDataset } from "./lib/validate-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");

console.log("=== 数据校验开始 ===\n");

const dataset = loadDataset(DATA_DIR);
const { errors, warnings } = validateDataset(dataset);

/** 按数据文件分组打印,便于定位到具体文件 */
const printGrouped = (items, format) => {
  const grouped = new Map();
  items.forEach((item) => {
    if (!grouped.has(item.section)) {
      grouped.set(item.section, []);
    }
    grouped.get(item.section).push(item.message);
  });
  grouped.forEach((messages, section) => {
    console.log(`\n--- ${section} 校验 ---`);
    messages.forEach((message) => format(message));
  });
};

printGrouped(errors, (message) => console.error(`❌ ${message}`));
printGrouped(warnings, (message) => console.warn(`⚠️  ${message}`));

console.log("\n=== 校验结果 ===");

if (errors.length > 0) {
  console.error(`\n❌ 数据校验失败（${warnings.length} 条警告）`);
  process.exit(1);
}

console.log(`✅ 数据校验通过（${warnings.length} 条警告）`);
