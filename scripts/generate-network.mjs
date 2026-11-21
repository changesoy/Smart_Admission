#!/usr/bin/env node
/**
 * generate-network.mjs - 节点/边生成器入口
 *
 * 契约：docs/planning/节点边生成器规格与样例交接.md
 *
 * 默认严格 dry-run：不写任何文件；带 --write 时以单个事务提交
 * network_nodes.json、network_edges.json 与 id_registry.json。
 *
 * 退出码：0 成功（可有 warning）；1 数据/拓扑/裁定规则错误；2 参数、读取、解析或写入失败。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildNetwork, serializeJson } from "./lib/network-generator-core.mjs";
import { validateIdRegistry } from "./lib/network-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  features: "data/boundary_features.v2.geojson",
  decisions: "data/network_connection_decisions.json",
  previousNodes: "data/network_nodes.json",
  previousEdges: "data/network_edges.json",
  registry: "data/id_registry.json",
  nodesOut: "data/network_nodes.json",
  edgesOut: "data/network_edges.json",
};

const VALUE_FLAGS = new Map([
  ["--features", "features"],
  ["--decisions", "decisions"],
  ["--previous-nodes", "previousNodes"],
  ["--previous-edges", "previousEdges"],
  ["--registry", "registry"],
  ["--nodes-out", "nodesOut"],
  ["--edges-out", "edgesOut"],
  ["--report", "report"],
  ["--effective-date", "effectiveDate"],
]);

const BOOLEAN_FLAGS = new Set(["--write", "--help", "-h"]);

const USAGE = `节点/边生成器

用法：
  node scripts/generate-network.mjs --effective-date 2026-11-17 [--write]

参数：
  --features <path>        边界要素，默认 ${DEFAULTS.features}
  --decisions <path>       连接裁定，默认 ${DEFAULTS.decisions}（默认路径不存在时只从端点建点）
  --previous-nodes <path>  上一版节点，默认 ${DEFAULTS.previousNodes}
  --previous-edges <path>  上一版边，默认 ${DEFAULTS.previousEdges}
  --registry <path>        注册表，默认 ${DEFAULTS.registry}（必须存在）
  --nodes-out <path>       节点输出，默认 ${DEFAULTS.nodesOut}
  --edges-out <path>       边输出，默认 ${DEFAULTS.edgesOut}
  --report <path>          报告输出（dry-run 下唯一允许的写操作）
  --effective-date <date>  新实体 createdAt（必填，YYYY-MM-DD）
  --write                  以单事务写入三个目标文件
  --help                   打印本说明

退出码：0 成功；1 数据/拓扑/裁定错误；2 参数、读取、解析或写入失败。`;

class CliError extends Error {}

const parseArgs = (argv) => {
  const options = { ...DEFAULTS, write: false, help: false, explicit: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === "--write") options.write = true;
      else options.help = true;
      continue;
    }
    const key = VALUE_FLAGS.get(arg);
    if (!key) throw new CliError(`未知参数: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`参数 ${arg} 缺少值`);
    }
    options[key] = value;
    options.explicit.add(key);
    index += 1;
  }
  return options;
};

const resolve = (target) => (path.isAbsolute(target) ? target : path.join(ROOT, target));

const readSnapshot = (file, { required }) => {
  if (!fs.existsSync(file)) {
    if (required) throw new CliError(`缺少必需文件: ${file}`);
    return { exists: false, bytes: null, text: null, sha256: null, json: null };
  }
  const bytes = fs.readFileSync(file);
  let json;
  try {
    json = JSON.parse(bytes.toString("utf-8"));
  } catch (error) {
    throw new CliError(`无法解析 ${file}: ${error.message}`);
  }
  return {
    exists: true,
    bytes,
    text: bytes.toString("utf-8"),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    json,
  };
};

const assertUnchanged = (file, snapshot) => {
  const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!snapshot.exists && current === null) return;
  if (!snapshot.exists || current === null || !current.equals(snapshot.bytes)) {
    throw new CliError(`输入文件在生成过程中发生变化: ${file}`);
  }
};

const writeAtomic = (files, reportFile) => {
  const staged = [];
  const backups = [];
  try {
    files.forEach(({ target, text }) => {
      const temp = `${target}.${process.pid}.tmp`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(temp, text, "utf-8");
      staged.push({ target, temp, text });
    });

    staged.forEach(({ temp, text }) => {
      const parsed = JSON.parse(fs.readFileSync(temp, "utf-8"));
      const expectedHash = crypto.createHash("sha256").update(text).digest("hex");
      const actualHash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(temp))
        .digest("hex");
      if (expectedHash !== actualHash) throw new CliError(`临时文件校验失败: ${temp}`);
      if (!parsed || typeof parsed !== "object") {
        throw new CliError(`临时文件不是 JSON 对象: ${temp}`);
      }
    });

    staged.forEach(({ target }) => {
      if (!fs.existsSync(target)) {
        backups.push({ target, temp: null });
        return;
      }
      const backup = `${target}.${process.pid}.bak`;
      fs.copyFileSync(target, backup);
      backups.push({ target, temp: backup });
    });

    staged.forEach(({ target, temp }) => {
      fs.renameSync(temp, target);
    });

    if (reportFile) {
      fs.mkdirSync(path.dirname(reportFile.target), { recursive: true });
      fs.writeFileSync(reportFile.target, reportFile.text, "utf-8");
    }

    backups.forEach(({ temp }) => {
      if (temp) fs.rmSync(temp, { force: true });
    });
  } catch (error) {
    staged.forEach(({ temp }) => fs.rmSync(temp, { force: true }));
    backups.forEach(({ target, temp }) => {
      if (temp && fs.existsSync(temp)) {
        fs.copyFileSync(temp, target);
        fs.rmSync(temp, { force: true });
      } else if (!temp) {
        fs.rmSync(target, { force: true });
      }
    });
    throw error;
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

  if (!options.effectiveDate) {
    console.error("缺少 --effective-date（禁止读取系统当前日期）");
    process.exit(2);
  }

  let report;
  try {
    const features = readSnapshot(resolve(options.features), { required: true });
    const decisionsExplicit = options.explicit.has("decisions");
    const decisions = readSnapshot(resolve(options.decisions), {
      required: decisionsExplicit,
    });
    const previousNodes = readSnapshot(resolve(options.previousNodes), { required: false });
    const previousEdges = readSnapshot(resolve(options.previousEdges), { required: false });
    const registry = readSnapshot(resolve(options.registry), { required: true });

    const registryReport = validateIdRegistry(registry.json);
    if (registryReport.errors.length > 0) {
      registryReport.errors.forEach(({ section, message }) =>
        console.error(`错误 [${section}] ${message}`),
      );
      process.exit(1);
    }

    const result = buildNetwork({
      features: features.json,
      decisions: decisions.json,
      previousNodes: previousNodes.json,
      previousEdges: previousEdges.json,
      registry: registry.json,
      effectiveDate: options.effectiveDate,
    });

    if (!decisions.exists) {
      result.report.warn(
        "connection_decisions",
        `未找到 ${options.decisions}，仅从要素端点建点，跨要素共点不会自动连通`,
      );
    }

    assertUnchanged(resolve(options.features), features);
    assertUnchanged(resolve(options.decisions), decisions);
    assertUnchanged(resolve(options.previousNodes), previousNodes);
    assertUnchanged(resolve(options.previousEdges), previousEdges);
    assertUnchanged(resolve(options.registry), registry);

    const nodesText = serializeJson(result.nodes);
    const edgesText = serializeJson(result.edges);
    const registryText = serializeJson(result.registry);

    report = {
      generatedAt: new Date().toISOString(),
      effectiveDate: options.effectiveDate,
      write: options.write,
      inputs: {
        features: { path: options.features, sha256: features.sha256 },
        decisions: { path: options.decisions, sha256: decisions.sha256 },
        previousNodes: { path: options.previousNodes, sha256: previousNodes.sha256 },
        previousEdges: { path: options.previousEdges, sha256: previousEdges.sha256 },
        registry: { path: options.registry, sha256: registry.sha256 },
      },
      counts: {
        nodes: result.nodes.nodes.length,
        edges: result.edges.edges.length,
        activeNodes: result.nodes.nodes.filter((node) => node.lifecycle === "active").length,
        activeEdges: result.edges.edges.filter((edge) => edge.lifecycle === "active").length,
      },
      allocations: result.allocations,
      errors: result.report.errors,
      warnings: result.report.warnings,
      outputs: {
        nodes: options.nodesOut,
        edges: options.edgesOut,
        registry: options.registry,
        nodesSha256: crypto.createHash("sha256").update(nodesText).digest("hex"),
        edgesSha256: crypto.createHash("sha256").update(edgesText).digest("hex"),
        registrySha256: crypto.createHash("sha256").update(registryText).digest("hex"),
      },
    };

    const reportText = serializeJson(report);

    result.report.errors.forEach(({ section, message }) =>
      console.error(`错误 [${section}] ${message}`),
    );
    result.report.warnings.forEach(({ section, message }) =>
      console.warn(`警告 [${section}] ${message}`),
    );

    if (result.report.errors.length > 0) {
      console.log(reportText);
      console.error(`生成失败：${result.report.errors.length} 个错误，未写入任何文件`);
      if (options.report) {
        const target = resolve(options.report);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, reportText, "utf-8");
        console.error(`报告：${options.report}`);
      }
      process.exit(1);
    }

    if (!options.write) {
      console.log(reportText);
      console.error(
        `dry-run：将写入 ${result.nodes.nodes.length} 个节点、${result.edges.edges.length} 条边；未修改任何文件`,
      );
      if (options.report) {
        const target = resolve(options.report);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, reportText, "utf-8");
        console.error(`报告：${options.report}`);
      }
      process.exit(0);
    }

    writeAtomic(
      [
        { target: resolve(options.nodesOut), text: nodesText },
        { target: resolve(options.edgesOut), text: edgesText },
        { target: resolve(options.registry), text: registryText },
      ],
      options.report ? { target: resolve(options.report), text: reportText } : null,
    );

    console.log(reportText);
    console.error(
      `已写入 ${options.nodesOut}、${options.edgesOut}、${options.registry}；` +
        `新增节点 ${result.allocations.nodes.length}、边 ${result.allocations.edges.length}`,
    );
    process.exit(0);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`失败：${error.message}`);
      process.exit(2);
    }
    console.error(`写入事务失败，已尝试恢复旧文件：${error.stack ?? error.message}`);
    process.exit(2);
  }
};

main();
