#!/usr/bin/env node
/**
 * merge-roads.mjs - 把新导入的路网并入现有 roads.geojson（校验 + 追加，默认 dry-run）
 *
 * 只做合并，不算交点。合并完成后按提示跑 build-intersections 即可从零生成节点。
 * 输入要求与项目一致：每个要素是 LineString / MultiLineString，
 * properties 至少含 roadId（全局唯一）与 name。
 *
 * 用法：
 *   node scripts/merge-roads.mjs --add D:/x/新路.geojson                 # dry-run 只校验
 *   node scripts/merge-roads.mjs --add D:/x/新路.geojson --write         # 追加写回 data/roads.geojson
 *   node scripts/merge-roads.mjs --add D:/x/新路.geojson --out D:/x/roads.geojson --write
 *   node scripts/merge-roads.mjs --base none --add D:/x/新路.geojson --out D:/x/roads.geojson --write
 *
 * 参数：
 *   --base  基线路网，默认 data/roads.geojson；传 none 表示从空网开始
 *   --add   待并入的路网（必填）
 *   --out   输出路径，默认等于 --base；--base none 时必须显式指定
 *   --write 真正落盘；不加只打印校验结果
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
const ADD_RAW = argOf("add", null);
const OUT_RAW = argOf("out", null);
const WRITE = process.argv.includes("--write");

if (ADD_RAW === null) {
  console.error("❌ 缺少 --add（待并入的路网文件）");
  process.exit(1);
}
const ADD = path.resolve(CWD, ADD_RAW);
if (OUT_RAW === null && BASE === null) {
  console.error("❌ --base none 时必须用 --out 指定输出路径");
  process.exit(1);
}
const OUT = OUT_RAW === null ? BASE : path.resolve(CWD, OUT_RAW);

const displayPath = (p) => {
  const rel = path.relative(ROOT, p);
  return rel.startsWith("..") ? p : rel;
};

const readJson = (p) =>
  JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));

const requireFile = (p, label) => {
  if (!p || !fs.existsSync(p)) {
    console.error(`❌ ${label} 不存在: ${p}`);
    process.exit(1);
  }
};

const LINE_TYPES = ["LineString", "MultiLineString"];

if (BASE) requireFile(BASE, "基线路网");
requireFile(ADD, "待并入路网");

const base = BASE
  ? readJson(BASE)
  : { type: "FeatureCollection", features: [] };
const add = readJson(ADD);

if (!Array.isArray(base.features) || !Array.isArray(add.features)) {
  console.error("❌ 输入不是 FeatureCollection（缺少 features 数组）");
  process.exit(1);
}

const baseIds = new Set();
for (const f of base.features) {
  const id = f.properties?.roadId;
  if (id !== undefined && id !== null) baseIds.add(String(id));
}

const errors = [];
const seen = new Set();
const incoming = [];

add.features.forEach((f, i) => {
  const at = `新增第 ${i + 1} 条`;
  const geom = f.geometry;
  if (!geom || !LINE_TYPES.includes(geom.type)) {
    errors.push(`${at}：几何类型 ${geom?.type ?? "缺失"}，只接受 LineString / MultiLineString`);
    return;
  }
  const coords =
    geom.type === "MultiLineString" ? geom.coordinates.flat() : geom.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    errors.push(`${at}：顶点不足 2 个`);
    return;
  }
  const roadId = f.properties?.roadId;
  const name = f.properties?.name;
  if (roadId === undefined || roadId === null || String(roadId).trim() === "") {
    errors.push(`${at}：缺少 properties.roadId`);
    return;
  }
  if (typeof name !== "string" || name.trim() === "") {
    errors.push(`${at}（roadId=${roadId}）：缺少 properties.name`);
    return;
  }
  const id = String(roadId);
  if (baseIds.has(id)) {
    errors.push(`${at}（roadId=${id}）：与基线已有 roadId 重复`);
    return;
  }
  if (seen.has(id)) {
    errors.push(`${at}（roadId=${id}）：新增文件内部 roadId 重复`);
    return;
  }
  seen.add(id);
  incoming.push(f);
});

const byType = {};
for (const f of incoming) {
  const t = String(f.properties.type ?? "未标注");
  byType[t] = (byType[t] ?? 0) + 1;
}

console.log(
  `基线 ${displayPath(BASE ?? OUT)} ${base.features.length} 条 · 新增 ${ADD_RAW} ${add.features.length} 条（可用 ${incoming.length} 条）`,
);
if (Object.keys(byType).length) {
  console.log(
    `新增类型：${Object.entries(byType)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
  );
}
const preview = incoming
  .slice(0, 20)
  .map((f) => `${f.properties.roadId} ${f.properties.name}`);
if (preview.length) {
  console.log(`新增 ID：${preview.join(" · ")}${incoming.length > 20 ? " …" : ""}`);
}

if (errors.length) {
  console.error(`\n❌ 校验未通过（${errors.length} 处）：`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

const merged = {
  ...base,
  type: "FeatureCollection",
  features: [...base.features, ...incoming],
};

if (!WRITE) {
  console.log(
    `\n（dry-run）合并后 ${merged.features.length} 条；加 --write 写到 ${displayPath(OUT)}`,
  );
  console.log(
    `下一步：node scripts/build-intersections.mjs --roads ${displayPath(OUT)} --write`,
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const body = `${JSON.stringify(merged, null, 2).replace(/\n/g, "\r\n")}`;
fs.writeFileSync(OUT, body, "utf8");

const sha = crypto.createHash("sha256").update(body).digest("hex");
console.log(
  `\n✅ 已写入 ${displayPath(OUT)} · ${merged.features.length} 条 · ${body.length} 字节 · sha256 ${sha.slice(0, 12)}…`,
);
console.log(
  `下一步：node scripts/build-intersections.mjs --roads ${displayPath(OUT)} --write`,
);
console.log("然后：node scripts/junction-diagnose.mjs  （有交点文件后 A 才会启用）");
