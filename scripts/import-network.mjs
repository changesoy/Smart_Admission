#!/usr/bin/env node
/**
 * import-network.mjs - 导入路网 → 生成节点 → 出诊断报告，一条命令跑完整链
 *
 * 只做转发：参数原样透传给 scripts/network.mjs all，
 * 由 network.mjs 在内存里依次完成 并入新路 → 算交点 → 诊断。
 *
 * 默认预演：不产生任何文件；加 --write 才落盘到 --out（默认 data/roads.geojson）。
 *
 * 用法：
 *   node scripts/import-network.mjs --add 新路.geojson                 # 预演
 *   node scripts/import-network.mjs --add 新路.geojson --write         # 正式并入
 *   node scripts/import-network.mjs --add 新路.geojson --out D:/x/roads.geojson --write
 *   node scripts/import-network.mjs --base none --add 新路.geojson --out D:/x/roads.geojson --write
 *   node scripts/import-network.mjs --write                            # 没有新路，只重建交点+诊断
 *
 * 参数：
 *   --add   待导入的路网（可选；不传表示只重算现有路网）
 *   --base  基线路网，默认 data/roads.geojson；none 表示从空网开始
 *   --out   输出路网，默认等于 --base
 *   --write 真正落盘；不加则只在内存里预演
 */

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CWD = process.cwd();

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const pathArg = (name, dflt) => {
  const raw = argOf(name, null);
  return raw === null ? dflt : path.resolve(CWD, raw);
};

const BASE_RAW = argOf("base", null);
const BASE =
  BASE_RAW === "none"
    ? null
    : pathArg("base", path.join(ROOT, "data/roads.geojson"));
const OUT = BASE_RAW === "none" ? pathArg("out", null) : pathArg("out", BASE);
const WRITE = process.argv.includes("--write");

console.log(
  `模式：${WRITE ? "落盘" : "预演（不产生文件）"} · 基线 ${BASE ?? "空网"} · 新路 ${pathArg("add", null) ?? "无"}`,
);

const r = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/network.mjs"), "all", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (r.status !== 0) {
  console.error("❌ 链路执行失败，已中止");
  process.exit(r.status ?? 1);
}

const served = (p) => {
  if (!p) return null;
  const rel = path.relative(ROOT, p);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `/${rel.replace(/\\/g, "/")}`;
};

if (WRITE && OUT) {
  const ixPath = path.join(path.dirname(OUT), "intersections.geojson");
  const roadsUrl = served(OUT);
  const reportUrl = served(path.join(ROOT, "reports/junctions/latest.json"));
  const ixUrl = served(ixPath);
  const page =
    roadsUrl && reportUrl && ixUrl
      ? `http://localhost:5174/reports/junction-cases.html?roads=${roadsUrl}&report=${reportUrl}&ix=${ixUrl}`
      : null;
  console.log("\n✅ 已落盘");
  console.log(`   路网：${OUT}`);
  console.log(`   交点：${ixPath}`);
  if (page) console.log(`   页面：${page}`);
  else console.log("   （输出在项目目录之外，页面无法直接读取本地文件）");
} else {
  console.log("\n👀 预演完成（data/ 未改动）；确认无误后加 --write 正式落盘");
}
