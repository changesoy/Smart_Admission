/**
 * rebuild-tianzhu.mjs - 天烛峰路按 OSM 全量节点重建
 *
 * 背景:
 *   旧几何 3.21 km 只有 14 个顶点, 含一段 2.37 km 的直线弦, 与底图弯曲道路
 *   明显偏离; 且有名段与南延无名段之间以 4.8 m 短横杆相连, 成图上出现台阶。
 *
 * 做法:
 *   北段取 136913568 / 246812271(上下行), 南段取 246812260 / 375335691(上下行),
 *   逐点取两幅最近点中点得到中心线, 再在 36.20537 接缝处归一到同一点,
 *   Douglas-Peucker(1.5 m) 抽稀后写回 road_038。
 *
 * 用法:
 *   node scripts/roads/rebuild-tianzhu.mjs                 # dry-run
 *   node scripts/roads/rebuild-tianzhu.mjs --write         # 落盘
 *   node scripts/roads/rebuild-tianzhu.mjs --osm <缓存>    # 指定 OSM 缓存
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const WRITE = process.argv.includes("--write");
const osmIdx = process.argv.indexOf("--osm");
const OSM = osmIdx !== -1 && process.argv[osmIdx + 1]
  ? process.argv[osmIdx + 1]
  : path.join(process.env.TEMP || ".", "osm_tianzhu.json");

const NORTH = [136913568, 246812271];
const SOUTH = [246812260, 375335691];
const JOIN_LAT = 36.20537;

const rad = (d) => (d * Math.PI) / 180;
const R = 6371000;
const dd = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const len = (p) => p.reduce((s, q, i) => (i ? s + dd(p[i - 1], q) : 0), 0);
const round6 = (p) => [+p[0].toFixed(6), +p[1].toFixed(6)];

const cache = JSON.parse(fs.readFileSync(OSM, "utf8").replace(/^\uFEFF/, ""));
const wayOf = (id) => {
  const el = (cache.elements || []).find((e) => e.id === id);
  if (!el || !Array.isArray(el.geometry)) throw new Error(`OSM 缓存缺少 way ${id}`);
  return el.geometry.map((p) => [p.lon, p.lat]);
};

const KMX = 111320 * Math.cos(rad(36.21));
const KMY = 110574;
const nearestOn = (p, line) => {
  const px = p[0] * KMX;
  const py = p[1] * KMY;
  let best = { d: Infinity, q: null };
  for (let i = 1; i < line.length; i++) {
    const ax = line[i - 1][0] * KMX;
    const ay = line[i - 1][1] * KMY;
    const bx = line[i][0] * KMX;
    const by = line[i][1] * KMY;
    const vx = bx - ax;
    const vy = by - ay;
    const L2 = vx * vx + vy * vy;
    let t = L2 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + vx * t;
    const qy = ay + vy * t;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best.d) best = { d, q: [qx / KMX, qy / KMY] };
  }
  return best;
};

/** 沿 A 每 step 米取一点, 与 B 的最近点取中点 */
const midline = (a, b, step = 8) => {
  const out = [];
  for (let i = 1; i < a.length; i++) {
    const segLen = dd(a[i - 1], a[i]);
    const n = Math.max(1, Math.round(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const p = [a[i - 1][0] + (a[i][0] - a[i - 1][0]) * t, a[i - 1][1] + (a[i][1] - a[i - 1][1]) * t];
      const r = nearestOn(p, b);
      if (!r.q || r.d > 60) { out.push(p); continue; }
      out.push([(p[0] + r.q[0]) / 2, (p[1] + r.q[1]) / 2]);
    }
  }
  out.push(a.at(-1));
  return out;
};

/** Douglas-Peucker(米制) */
const simplify = (line, tol) => {
  if (line.length < 3) return line;
  const xy = line.map((p) => [p[0] * KMX, p[1] * KMY]);
  const keep = new Array(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1;
    let idx = -1;
    const [ax, ay] = xy[s];
    const [bx, by] = xy[e];
    const vx = bx - ax;
    const vy = by - ay;
    const L = Math.hypot(vx, vy) || 1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((xy[i][0] - ax) * vy - (xy[i][1] - ay) * vx) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
};

// ---------- 构建 ----------
const northMid = midline(wayOf(NORTH[0]), wayOf(NORTH[1])).reverse(); // 北 → 南
const southMid = midline(wayOf(SOUTH[0]), wayOf(SOUTH[1])); // 北 → 南

// 接缝归一：两个端点取中点，接缝两侧各用该点
const joinGap = dd(northMid.at(-1), southMid[0]);
const seam = round6([
  (northMid.at(-1)[0] + southMid[0][0]) / 2,
  (northMid.at(-1)[1] + southMid[0][1]) / 2,
]);
northMid[northMid.length - 1] = seam;
southMid[0] = seam;

const merged = simplify([...northMid, ...southMid.slice(1)], 1.5).map(round6);

// 只保留接缝以南、以北各一段，避免重复端点
const coords = merged.filter((p, i) => i === 0 || dd(merged[i - 1], p) > 0.2);

console.log("=== 天烛峰路重建 ===");
console.log(`  北段 ${NORTH.join("↔")}: 采样 ${northMid.length} 点`);
console.log(`  南段 ${SOUTH.join("↔")}: 采样 ${southMid.length} 点`);
console.log(`  接缝间距 ${joinGap.toFixed(1)} m（已归一到同一点）`);
console.log(`  抽稀后 ${coords.length} 点 / ${(len(coords) / 1000).toFixed(2)} km`);
console.log(`  首 ${coords[0][0].toFixed(6)},${coords[0][1].toFixed(6)}  末 ${coords.at(-1)[0].toFixed(6)},${coords.at(-1)[1].toFixed(6)}`);

const fc = JSON.parse(fs.readFileSync(ROADS, "utf8").replace(/^\uFEFF/, ""));
const target = fc.features.find((f) => f.properties && f.properties.roadId === "road_038");
if (!target) throw new Error("未找到 road_038（天烛峰路）");

const before = target.geometry.type === "LineString"
  ? target.geometry.coordinates
  : target.geometry.coordinates[0];
console.log(`  原几何 ${before.length} 点 / ${(len(before) / 1000).toFixed(2)} km，最长段 ${Math.max(
  ...before.map((p, i) => (i ? dd(before[i - 1], p) : 0)),
).toFixed(1)} m`);

if (WRITE) {
  target.geometry = { type: "LineString", coordinates: coords };
  target.properties.note =
    "坐标取自 OpenStreetMap（2026-10 抓取），上下行双线取中线 (© OpenStreetMap contributors, ODbL)；" +
    "2026-10-24 按 OSM 全量节点重建（上下行逐点取中点，去掉 2.37 km 直线弦，接缝归一到同一点）";
  const text = `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`;
  fs.writeFileSync(ROADS, text);
  console.log(`\n已写入 ${ROADS}（CRLF，${Buffer.byteLength(text)} 字节）`);
} else {
  console.log("\ndry-run：未写盘（加 --write 落盘）");
}
