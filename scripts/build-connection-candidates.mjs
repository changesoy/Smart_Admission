#!/usr/bin/env node
/**
 * build-connection-candidates.mjs - 连接候选只读报告
 *
 * 默认不写任何文件：未给出 --out 时把报告打印到 stdout。
 * 正式裁定仍只能由人工审核后写入 data/network_connection_decisions.json，
 * 本脚本拒绝写入 data/ 目录。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_SCHEMA_VERSION,
  DEFAULT_NEAR_MISS_METERS,
  discoverConnectionCandidates,
} from "./lib/connection-candidates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_FEATURES = "data/boundary_features.v2.geojson";
const DEFAULT_OUT = "reports/network/connection-candidates.json";

const USAGE = `连接候选只读报告

用法：
  node scripts/build-connection-candidates.mjs [--features <path>] [--out <path>]
                                                [--near-miss-meters <number>]

参数：
  --features <path>        坐标源，默认 ${DEFAULT_FEATURES}
  --out <path>             显式输出路径；缺省只打印到 stdout，建议 ${DEFAULT_OUT}
  --near-miss-meters <n>   近邻容差（米），默认 ${DEFAULT_NEAR_MISS_METERS}
  --help                   打印本说明

说明：
  候选使用 ncc_*，reviewStatus 恒为 pending，proposedConnectionType 恒为 null。
  脚本只读，不会写入 data/，也不会生成正式 ncd_* 裁定。
退出码：0 成功；1 读取或解析失败；2 参数或输出路径非法。`;

class CliError extends Error {}

const parseArgs = (argv) => {
  const options = {
    features: DEFAULT_FEATURES,
    out: null,
    nearMissMeters: DEFAULT_NEAR_MISS_METERS,
    help: false,
  };
  const withValue = new Map([
    ["--features", "features"],
    ["--out", "out"],
    ["--near-miss-meters", "nearMissMeters"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const key = withValue.get(arg);
    if (!key) throw new CliError(`未知参数: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`参数 ${arg} 缺少值`);
    }
    index += 1;
    if (key === "nearMissMeters") {
      const meters = Number(value);
      if (!Number.isFinite(meters) || meters <= 0) {
        throw new CliError(`--near-miss-meters 必须是正数: ${value}`);
      }
      options.nearMissMeters = meters;
      continue;
    }
    options[key] = value;
  }
  return options;
};

const resolveInsideRoot = (target) => path.resolve(ROOT, target);

const isInsideData = (target) => {
  const relative = path.relative(path.join(ROOT, "data"), target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const gitCommit = () => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
};

const main = () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return 2;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const featuresPath = resolveInsideRoot(options.features);
  let raw;
  try {
    raw = fs.readFileSync(featuresPath);
  } catch (error) {
    console.error(`读取坐标源失败: ${path.relative(ROOT, featuresPath)} (${error.message})`);
    return 1;
  }

  let features;
  try {
    features = JSON.parse(raw.toString("utf-8"));
  } catch (error) {
    console.error(`解析坐标源失败: ${error.message}`);
    return 1;
  }

  const outTarget = options.out ? resolveInsideRoot(options.out) : null;
  if (outTarget && isInsideData(outTarget)) {
    console.error("拒绝写入 data/：候选报告只能输出到 reports/ 或其他非正式目录");
    return 2;
  }

  const { candidates, counts, summary } = discoverConnectionCandidates({
    features,
    nearMissMeters: options.nearMissMeters,
  });

  const report = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    source: {
      featuresPath: path.relative(ROOT, featuresPath).split(path.sep).join("/"),
      featuresSha256: createHash("sha256").update(raw).digest("hex").toUpperCase(),
      gitCommit: gitCommit(),
    },
    thresholds: { nearMissMeters: options.nearMissMeters },
    summary,
    counts,
    candidates,
  };

  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (outTarget) {
    fs.mkdirSync(path.dirname(outTarget), { recursive: true });
    fs.writeFileSync(outTarget, serialized, "utf-8");
    console.error(`候选报告：${path.relative(ROOT, outTarget)}`);
  } else {
    process.stdout.write(serialized);
  }

  console.error(
    `候选统计：共 ${counts.total} 项（共点 ${counts.exactSharedVertex}，` +
      `线段相交 ${counts.segmentCrossing}，近邻 ${counts.nearMiss}，` +
      `共线重叠 ${counts.collinearOverlap}）`,
  );
  return 0;
};

process.exit(main());
