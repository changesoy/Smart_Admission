#!/usr/bin/env node
/**
 * create-zone.mjs - 从学校与四至原文创建学区骨架
 *
 * 契约：
 * - 只追加 zone_specs.v2.json 的一个 zone，并登记 zoneRing / zoneStep ID；
 * - 不改动已有学区、步骤或 boundaryText；
 * - 缺省 dry-run，只有 --write 才落盘；
 * - zone_specs 与 id_registry 同事务写入，失败整体回滚。
 *
 * 退出码：0 成功（dry-run 亦为 0）；1 校验错误；2 参数、读取、解析或写入失败。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendZoneToSpecsText, planZoneCreation } from "./lib/zone-creation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  zoneSpecs: "data/zone_specs.v2.json",
  registry: "data/id_registry.json",
  schools: "data/schools.json",
};

const USAGE = `新建学区骨架

用法：
  node scripts/create-zone.mjs <payload.json> [选项]

payload 字段：
  schoolId      必填，必须存在于 schools.json
  stage         小学 / 初中；缺省取学校学段
  zoneName      缺省为“学校名 + 学区”
  boundaryText  必填，官方四至原文
  year          缺省取学校核验年份
  policyIds     缺省沿用同年份已有学区
  steps         可选，[{ "side": "东", "text": "东界：..." }]；缺省自动拆分

选项：
  --zone-specs <path>  正式学区，默认 ${DEFAULTS.zoneSpecs}
  --registry <path>    ID 注册表，默认 ${DEFAULTS.registry}
  --schools <path>     学校表，默认 ${DEFAULTS.schools}
  --report <path>      报告输出
  --write              实际写入；缺省为 dry-run
  --help               打印本说明

退出码：0 成功；1 校验错误；2 参数、读取、解析或写入失败。`;

class CliError extends Error {}

const resolve = (target) => (path.isAbsolute(target) ? target : path.join(ROOT, target));

const parseArgs = (argv) => {
  const options = { payload: null, ...DEFAULTS, report: null, write: false, help: false };
  const valueFlags = new Map([
    ["--zone-specs", "zoneSpecs"],
    ["--registry", "registry"],
    ["--schools", "schools"],
    ["--report", "report"],
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
    if (options.payload) throw new CliError(`多余的参数: ${arg}`);
    options.payload = arg;
  }
  return options;
};

const readJson = (file, label) => {
  const target = resolve(file);
  if (!fs.existsSync(target)) throw new CliError(`缺少${label}: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(target, "utf-8"));
  } catch (error) {
    throw new CliError(`无法解析${label} ${file}: ${error.message}`);
  }
};

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const writeAtomicPair = (items) => {
  const staged = items.map((item) => ({
    ...item,
    temp: `${item.path}.${process.pid}.tmp`,
    backup: `${item.path}.${process.pid}.bak`,
    existed: fs.existsSync(item.path),
  }));
  try {
    staged.forEach((item) => {
      fs.writeFileSync(item.temp, item.text, "utf-8");
      if (sha256(fs.readFileSync(item.temp)) !== sha256(item.text)) {
        throw new CliError(`临时文件校验失败: ${item.path}`);
      }
    });
    staged.forEach((item) => {
      if (item.existed) fs.copyFileSync(item.path, item.backup);
    });
    staged.forEach((item) => fs.renameSync(item.temp, item.path));
    staged.forEach((item) => fs.rmSync(item.backup, { force: true }));
  } catch (error) {
    staged.forEach((item) => fs.rmSync(item.temp, { force: true }));
    staged.forEach((item) => {
      if (item.existed && fs.existsSync(item.backup)) {
        fs.copyFileSync(item.backup, item.path);
        fs.rmSync(item.backup, { force: true });
      }
    });
    throw error;
  }
};

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
};

const writeReport = (file, report) => {
  if (!file) return;
  const target = resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
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
  if (!options.payload) {
    console.error("缺少 payload 文件路径");
    console.error(USAGE);
    process.exit(2);
  }

  let payload;
  let zoneSpecsText;
  let zoneSpecs;
  let registry;
  let schoolsFile;
  try {
    payload = readJson(options.payload, "payload");
    zoneSpecsText = fs.readFileSync(resolve(options.zoneSpecs), "utf-8");
    zoneSpecs = JSON.parse(zoneSpecsText);
    registry = readJson(options.registry, "ID 注册表");
    schoolsFile = readJson(options.schools, "学校表");
  } catch (error) {
    console.error(`失败：${error.message}`);
    process.exit(2);
  }

  const zones = Array.isArray(zoneSpecs?.zones) ? zoneSpecs.zones : null;
  const schools = Array.isArray(schoolsFile) ? schoolsFile : schoolsFile?.schools;
  if (!zones) {
    console.error("失败：zone_specs 缺少 zones 数组");
    process.exit(2);
  }
  if (!Array.isArray(schools)) {
    console.error("失败：schools.json 缺少学校数组");
    process.exit(2);
  }

  const nextRegistry = JSON.parse(JSON.stringify(registry));
  const plan = planZoneCreation({
    payload,
    zones,
    schools,
    registry: nextRegistry,
    today: today(),
  });

  const report = {
    ok: plan.errors.length === 0,
    mode: options.write ? "write" : "dry-run",
    zoneId: plan.zoneId,
    zoneName: plan.zone?.zoneName ?? null,
    ringId: plan.zone?.rings?.[0]?.ringId ?? null,
    stepCount: plan.steps.length,
    steps: plan.steps,
    zoneSpecs: options.zoneSpecs,
    registry: options.registry,
    errors: plan.errors,
  };

  if (plan.errors.length > 0) {
    writeReport(options.report, report);
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const patchedText = appendZoneToSpecsText(zoneSpecsText, plan.zone);
  const expectedZones = [...zones, plan.zone];
  let patched;
  try {
    patched = JSON.parse(patchedText);
  } catch (error) {
    console.error(`失败：追加后 JSON 无法解析: ${error.message}`);
    process.exit(2);
  }
  if (JSON.stringify(patched.zones) !== JSON.stringify(expectedZones)) {
    console.error("失败：追加结果与预期不一致，已放弃写入");
    process.exit(2);
  }

  if (options.write) {
    try {
      writeAtomicPair([
        { path: resolve(options.zoneSpecs), text: patchedText },
        { path: resolve(options.registry), text: `${JSON.stringify(nextRegistry, null, 2)}\n` },
      ]);
    } catch (error) {
      console.error(`失败：写入未完成，已回滚: ${error.message}`);
      process.exit(2);
    }
  }

  writeReport(options.report, report);
  console.log(JSON.stringify(report, null, 2));
};

main();
