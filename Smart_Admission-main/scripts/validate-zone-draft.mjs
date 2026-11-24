#!/usr/bin/env node
/**
 * validate-zone-draft.mjs - 学区草稿校验入口（只读，不写任何文件）
 *
 * 契约：docs/planning/草稿字段冻结清单.md 第七节
 *
 * 本脚本只负责读文件、组装 zoneSpec/nodes/edges 上下文与格式化输出；
 * D01–D17 全部由 scripts/lib/zone-draft-schema.mjs 的 validateZoneDraft 实现。
 *
 * 退出码：0 无错误；1 草稿校验失败；2 参数、读取或解析失败。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateZoneDraft } from "./lib/zone-draft-schema.mjs";
import { serializeJson } from "./lib/network-generator-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  zoneSpecs: "data/zone_specs.v2.json",
  nodes: "data/network_nodes.json",
  edges: "data/network_edges.json",
};

const USAGE = `学区草稿校验

用法：
  node scripts/validate-zone-draft.mjs <draft.json> [选项]

选项：
  --zone-specs <path>  正式学区，默认 ${DEFAULTS.zoneSpecs}
  --nodes <path>       网络节点，默认 ${DEFAULTS.nodes}
  --edges <path>       网络边，默认 ${DEFAULTS.edges}
  --json               输出机器可读报告
  --help               打印本说明

退出码：0 无错误；1 草稿校验失败；2 参数、读取或解析失败。`;

class CliError extends Error {}

const resolve = (target) => (path.isAbsolute(target) ? target : path.join(ROOT, target));

const parseArgs = (argv) => {
  const options = { draft: null, ...DEFAULTS, json: false, help: false };
  const valueFlags = new Map([
    ["--zone-specs", "zoneSpecs"],
    ["--nodes", "nodes"],
    ["--edges", "edges"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
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

const readJson = (file, label) => {
  const target = resolve(file);
  if (!fs.existsSync(target)) throw new CliError(`缺少${label}: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(target, "utf-8"));
  } catch (error) {
    throw new CliError(`无法解析${label} ${file}: ${error.message}`);
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
  if (!options.draft) {
    console.error("缺少草稿文件路径");
    console.error(USAGE);
    process.exit(2);
  }

  let draft;
  let zoneSpecs;
  let nodesFile;
  let edgesFile;
  try {
    draft = readJson(options.draft, "草稿");
    zoneSpecs = readJson(options.zoneSpecs, "正式学区");
    nodesFile = readJson(options.nodes, "网络节点");
    edgesFile = readJson(options.edges, "网络边");
  } catch (error) {
    console.error(`失败：${error.message}`);
    process.exit(2);
  }

  const zones = Array.isArray(zoneSpecs?.zones) ? zoneSpecs.zones : [];
  const zoneSpec = zones.find((zone) => zone.zoneId === draft?.zoneId) ?? null;
  if (!zoneSpec) {
    console.error(
      `失败：zoneId ${JSON.stringify(draft?.zoneId)} 不在 ${options.zoneSpecs} 中（D03）`,
    );
    process.exit(1);
  }

  const report = validateZoneDraft(draft, {
    zoneSpec,
    nodes: nodesFile?.nodes ?? [],
    edges: edgesFile?.edges ?? [],
  });

  const output = {
    draft: options.draft,
    zoneId: draft.zoneId,
    draftId: draft.draftId,
    status: draft.status,
    checked: {
      zoneSpecs: options.zoneSpecs,
      nodes: options.nodes,
      edges: options.edges,
    },
    errors: report.errors,
    warnings: report.warnings,
  };

  if (options.json) {
    console.log(serializeJson(output));
  } else {
    report.errors.forEach(({ section, message }) =>
      console.error(`错误 [${section}] ${message}`),
    );
    report.warnings.forEach(({ section, message }) =>
      console.warn(`警告 [${section}] ${message}`),
    );
    console.log(
      `${draft.draftId ?? "(draftId 缺失)"} · ${draft.zoneId} · ${draft.status}：` +
        `${report.errors.length} 个错误，${report.warnings.length} 个警告`,
    );
  }

  process.exit(report.errors.length > 0 ? 1 : 0);
};

main();
