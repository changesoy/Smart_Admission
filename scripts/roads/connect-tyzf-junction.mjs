#!/usr/bin/env node
/**
 * roads/connect-tyzf-junction.mjs - 天烛峰路北端接入环山路东端路口
 *
 * 现状：天烛峰路（road_038）北端止于 117.172686,36.228904，
 * 距环山路（road_004）东端 / 泰明路 / 碧霞大街共用路口 117.172585,36.229280 约 42.9 m，
 * 视觉上停在路口以南，既不成节点，也无法参与交点计算。
 *
 * 做法：取 road_004 上距天烛峰路北端最近的顶点（即路口共用点），
 * 作为新顶点插到 road_038 首端。只补一个顶点，不横向挪线。
 *
 * 用法：
 *   node scripts/roads/connect-tyzf-junction.mjs            # dry-run
 *   node scripts/roads/connect-tyzf-junction.mjs --write    # 落盘
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const TARGET_ROAD = "road_038"; // 天烛峰路
const ANCHOR_ROAD = "road_004"; // 环山路
const MAX_SNAP_M = 100;
const WRITE = process.argv.includes("--write");

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const fc = JSON.parse(fs.readFileSync(ROADS, "utf8"));
const target = fc.features.find((f) => f.properties.roadId === TARGET_ROAD);
const anchor = fc.features.find((f) => f.properties.roadId === ANCHOR_ROAD);
if (!target || !anchor) {
  console.error(`❌ 找不到 ${!target ? TARGET_ROAD : ANCHOR_ROAD}`);
  process.exit(1);
}
if (target.geometry.type !== "LineString") {
  console.error(`❌ ${TARGET_ROAD} 不是 LineString，需人工处理`);
  process.exit(1);
}

const line = target.geometry.coordinates;
const anchorPts = anchor.geometry.type === "MultiLineString" ? anchor.geometry.coordinates.flat() : anchor.geometry.coordinates;

const head = line[0];
let best = null;
for (const p of anchorPts) {
  const d = dist(head, p);
  if (!best || d < best.d) best = { d, p };
}
if (best.d > MAX_SNAP_M) {
  console.error(`❌ 最近锚点 ${best.d.toFixed(1)} m 超出 ${MAX_SNAP_M} m 上限`);
  process.exit(1);
}

const already = dist(head, best.p) < 0.5;
const addedM = already ? 0 : best.d;

console.log(`${TARGET_ROAD} 北端 ${head.map((v) => v.toFixed(6)).join(",")}`);
console.log(`锚点 ${best.p.map((v) => v.toFixed(6)).join(",")}（距 ${best.d.toFixed(1)} m）`);
if (already) {
  console.log("已接上，无需改动");
} else {
  console.log(`将插入顶点，延长 ${addedM.toFixed(1)} m；顶点数 ${line.length} → ${line.length + 1}`);
}

if (!WRITE) {
  console.log("dry-run：未修改数据，确认后加 --write 落盘");
  process.exit(0);
}
if (already) process.exit(0);

line.unshift([best.p[0], best.p[1]]);
const note = target.properties.note || "";
target.properties.note = `${note}；2026-10-26 北端接入环山路东端路口（+${addedM.toFixed(0)} m）`;
fs.writeFileSync(ROADS, JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n") + "\r\n", "utf8");
console.log("✅ 已写入 data/roads.geojson");
