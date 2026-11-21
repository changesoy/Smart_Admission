#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COMMANDS = {
  "network:generate": {
    script: "scripts/generate-network.mjs",
    desc: "节点/边生成（默认 dry-run，--write 单事务落盘）",
  },
  "network:validate": {
    script: "scripts/validate-network.mjs",
    desc: "统一边界网络校验（--strict 将警告升级为错误）",
  },
  "network:export-refs": {
    script: "scripts/export-network-refs.mjs",
    desc: "导出要素清单与学区绑定待办",
  },
  "network:candidates": {
    script: "scripts/build-connection-candidates.mjs",
    desc: "连接候选只读报告（ncc_*，不写 data/）",
  },
  "draft:validate": {
    script: "scripts/validate-zone-draft.mjs",
    desc: "校验学区草稿（D01–D17，只读）",
  },
  "draft:import": {
    script: "scripts/import-zone-draft.mjs",
    desc: "把通过的草稿回写正式 zone_specs",
  },
  "ui": {
    script: "node_modules/vite/bin/vite.js",
    args: ["--open", "/tools/index.html"],
    desc: "数据工具台：编辑器 + 路网 / 边界可视化",
  },
  "ui:editor": {
    script: "node_modules/vite/bin/vite.js",
    args: ["--open", "/tools/boundary-editor/index.html"],
    desc: "直接打开学区边界点选编辑器",
  },
  "legacy:intersections": {
    script: "scripts/build-intersections.mjs",
    desc: "旧 L0 交点图谱（产 ix_*，非正式生成器）",
    legacy: true,
  },
  "legacy:network": {
    script: "scripts/network.mjs",
    desc: "旧交点单入口 build / diagnose / all",
    legacy: true,
  },
};

const ROAD_SCRIPTS = [
  "audit",
  "center-dual",
  "connect-tyzf-junction",
  "connect",
  "fill-panhe-longtan",
  "fill-southeast",
  "fill-tongtian",
  "fix-joints",
  "fix-rivers-and-streets",
  "merge-dual",
  "rebuild-tianzhu",
];

for (const name of ROAD_SCRIPTS) {
  COMMANDS[`legacy:roads:${name}`] = {
    script: `scripts/roads/${name}.mjs`,
    desc: "旧路网修补脚本（一次性修复，B14 计划退役）",
    legacy: true,
  };
}

const usage = () => {
  const rows = Object.entries(COMMANDS);
  const width = Math.max(...rows.map(([name]) => name.length));
  const block = (list) =>
    list
      .map(([name, item]) => `  ${name.padEnd(width)}  ${item.desc}`)
      .join("\n");
  const primary = rows.filter(([, item]) => !item.legacy);
  const legacy = rows.filter(([, item]) => item.legacy);
  return `统一命令行入口

用法：
  node scripts/main.mjs <command> [args...]
  npm run cli -- <command> [args...]

正式流水线：
${block(primary)}

旧脚本（产物不是正式数据，计划于 B14 退役）：
${block(legacy)}

说明：
  每个子命令的参数与退出码由被调用的脚本决定，用 --help 查看，例如
    node scripts/main.mjs network:generate --help
  主入口不改写参数，也不吞掉子命令的退出码。
`;
};

const main = () => {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h" || command === "--list") {
    process.stdout.write(usage());
    return 0;
  }

  const entry = COMMANDS[command];
  if (!entry) {
    process.stderr.write(`未知子命令: ${command}\n\n${usage()}`);
    return 2;
  }

  if (entry.legacy) {
    process.stderr.write(`[legacy] ${command} 将在 B14 退役，产物不作为正式数据\n`);
  }

  const target = path.join(ROOT, entry.script);
  const result = spawnSync(process.execPath, [target, ...(entry.args ?? []), ...args], {
    stdio: "inherit",
  });

  if (result.error) {
    process.stderr.write(`启动子命令失败: ${result.error.message}\n`);
    return 2;
  }

  return result.status ?? 2;
};

process.exit(main());
