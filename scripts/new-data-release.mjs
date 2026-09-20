/**
 * new-data-release.mjs - 生成不可变数据发布包
 *
 * ⚠️ 用法与约束见 CONTRIBUTING.md / 数据维护说明
 *
 * 用法:
 *   node scripts/new-data-release.mjs <版本号> [--effective-year <年>]
 *
 * 例:
 *   node scripts/new-data-release.mjs 2026.09.1
 *   node scripts/new-data-release.mjs 2026.10.1 --effective-year 2026
 *
 * 行为:
 *   1. 以 js/config.js 的 dataPaths 作为「应纳入发布的数据文件」的单一来源，
 *      避免脚本与前端各维护一份清单而互相脱节；
 *   2. 复制到 data/releases/<版本>/，逐文件记录 bytes 与 sha256，写出 manifest.json;
 *   3. 不修改 data/current.json —— 切换版本必须是显式动作，便于审阅与回滚;
 *   4. 已存在的版本目录会直接报错退出，保证「已发布目录不可原地修改」。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AppConfig from "../js/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const RELEASES_DIR = path.join(DATA_DIR, "releases");

const VERSION_PATTERN = /^\d{4}\.\d{2}\.\d+$/;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const [version, ...rest] = argv;
  if (!version) {
    fail(
      "缺少版本号。用法: node scripts/new-data-release.mjs <版本号>，例 2026.09.1",
    );
  }
  if (!VERSION_PATTERN.test(version)) {
    fail(`版本号格式应为 YYYY.MM.N，当前: ${version}`);
  }

  const flagIndex = rest.indexOf("--effective-year");
  if (flagIndex === -1) {
    return { version, effectiveYear: null };
  }

  const raw = rest[flagIndex + 1];
  const year = Number(raw);
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
    fail(
      `--effective-year 需要 ${YEAR_MIN}-${YEAR_MAX} 之间的整数，当前: ${raw}`,
    );
  }
  return { version, effectiveYear: year };
};

/** 未显式指定时，回退到自查规则 meta 声明的招生年度 */
const readFallbackEffectiveYear = () => {
  const relativePath = AppConfig.dataPaths.simulatorRules;
  const payload = JSON.parse(
    readFileSync(path.join(DATA_DIR, relativePath), "utf-8"),
  );
  const year = payload.meta ? payload.meta.effectiveYear : null;
  return Number.isInteger(year) ? year : null;
};

const sha256Of = (buffer) => createHash("sha256").update(buffer).digest("hex");

const { version, effectiveYear: yearArg } = parseArgs(process.argv.slice(2));

const targetDir = path.join(RELEASES_DIR, version);
if (existsSync(targetDir)) {
  fail(
    `版本 ${version} 已存在: ${path.relative(ROOT, targetDir)}。` +
      "已发布的数据目录不可原地修改，请改用新的版本号。",
  );
}

const effectiveYear = yearArg || readFallbackEffectiveYear();
if (!Number.isInteger(effectiveYear)) {
  fail(
    "无法确定 effectiveYear：请在 simulator_rules.json 的 meta 中声明，或显式传入 --effective-year",
  );
}

const fileNames = [...new Set(Object.values(AppConfig.dataPaths))];

const missing = fileNames.filter(
  (name) => !existsSync(path.join(DATA_DIR, name)),
);
if (missing.length > 0) {
  fail(`以下数据文件缺失，未创建发布包: ${missing.join(", ")}`);
}

mkdirSync(targetDir, { recursive: true });

const files = fileNames.map((name) => {
  const buffer = readFileSync(path.join(DATA_DIR, name));
  writeFileSync(path.join(targetDir, name), buffer);
  return { name, bytes: buffer.length, sha256: sha256Of(buffer) };
});

const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  effectiveYear,
  files,
};

writeFileSync(
  path.join(targetDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf-8",
);

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const totalKb = (totalBytes / 1024).toFixed(0);

console.log(`✅ 已生成数据发布包 ${version}`);
console.log(`   目录     : ${path.relative(ROOT, targetDir)}`);
console.log(`   文件数   : ${files.length}`);
console.log(`   总大小   : ${totalKb} KB`);
console.log(`   招生年度 : ${effectiveYear}`);
console.log(
  `   切换版本 : 手动把 data/current.json 的 version 改为 ${version}`,
);
