/**
 * center-dual.mjs - 双幅路中心线校正
 *
 * 背景:
 *   P1 合并上下行双线时，部分道路的中心线直接落在了其中一幅车道（OSM 的
 *   一条 way）上，另一幅仍在其侧 10–30 m，成图上表现为"线压在单侧车道、
 *   在路口处横跨到另一幅"。本脚本把落在单侧的道路改到两幅之间。
 *
 * 判定:
 *   对道路上每个采样点，用道路自身走向作为参考方向，计算同名 OSM 各 way 的
 *   带符号横向距离；若一侧是当前所在线、另一侧 60 m 内还有一条同名 way，
 *   则目标偏移取两者中点。
 *
 * 用法:
 *   node scripts/roads/center-dual.mjs                          # dry-run
 *   node scripts/roads/center-dual.mjs --write                  # 落盘
 *   node scripts/roads/center-dual.mjs --osm <缓存文件>          # 指定 OSM 缓存
 *
 * 只读输入: data/roads.geojson、OSM 抓取缓存（默认 %TEMP%/osm_center.json）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const WRITE = process.argv.includes("--write");
const osmIdx = process.argv.indexOf("--osm");
const OSM =
  osmIdx !== -1 && process.argv[osmIdx + 1]
    ? process.argv[osmIdx + 1]
    : path.join(process.env.TEMP || ".", "osm_center.json");

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const dd = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const round6 = (p) => [+p[0].toFixed(6), +p[1].toFixed(6)];
const len = (p) => p.reduce((s, q, i) => (i ? s + dd(p[i - 1], q) : 0), 0);
const partsOf = (f) =>
  f.geometry.type === "MultiLineString"
    ? f.geometry.coordinates
    : [f.geometry.coordinates];

/** 点 p 到 way 的最近点：返回米制距离与带符号横向距离（沿左法向为正） */
const nearestOnWay = (p, tangent, way, lat0) => {
  const kx = 111320 * Math.cos(rad(lat0));
  const ky = 110574;
  let best = { dist: Infinity, lateral: 0 };
  for (let i = 1; i < way.length; i++) {
    const ax = (way[i - 1][0] - p[0]) * kx;
    const ay = (way[i - 1][1] - p[1]) * ky;
    const bx = (way[i][0] - p[0]) * kx;
    const by = (way[i][1] - p[1]) * ky;
    const vx = bx - ax;
    const vy = by - ay;
    const L2 = vx * vx + vy * vy;
    let t = L2 ? -(ax * vx + ay * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + vx * t;
    const qy = ay + vy * t;
    const dist = Math.hypot(qx, qy);
    if (dist < best.dist) {
      best = { dist, lateral: -qx * tangent[1] + qy * tangent[0] };
    }
  }
  return best;
};

const raw = fs.readFileSync(ROADS, "utf8").replace(/^\uFEFF/, "");
const fc = JSON.parse(raw);

const osm = JSON.parse(fs.readFileSync(OSM, "utf8").replace(/^\uFEFF/, ""));
const byName = new Map();
for (const e of osm.elements || []) {
  if (!e.geometry || !e.tags || !e.tags.name || !e.tags.highway) continue;
  const g = e.geometry.map((q) => [q.lon, q.lat]);
  if (!byName.has(e.tags.name)) byName.set(e.tags.name, []);
  byName.get(e.tags.name).push({ id: e.id, g });
}

const MIN_SHIFT = 3;
const MAX_SHIFT = 25;
const MIN_COVERAGE = 30;

const patches = new Map(); // feature -> [{ pi, coords }]
const rows = [];

for (const f of fc.features) {
  const props = f.properties || {};
  if (props.type !== "道路") continue;
  if (props.dataStatus === "estimated") continue; // 示意线无 OSM 对应
  const ways = byName.get(props.name);
  if (!ways || ways.length < 2) continue;

  const parts = partsOf(f);
  for (const [pi, part] of parts.entries()) {
    const lat0 = part.reduce((s, q) => s + q[1], 0) / part.length;
    const kx = 111320 * Math.cos(rad(lat0));
    const ky = 110574;
    const shifts = [];
    let straddle = 0;
    const pairCount = new Map();

    for (let i = 0; i < part.length; i++) {
      const p = part[i];
      const prev = part[Math.max(0, i - 1)];
      const next = part[Math.min(part.length - 1, i + 1)];
      const tx = (next[0] - prev[0]) * kx;
      const ty = (next[1] - prev[1]) * ky;
      const tl = Math.hypot(tx, ty) || 1;
      const tangent = [tx / tl, ty / tl];

      const cand = ways
        .map((w) => ({ id: w.id, ...nearestOnWay(p, tangent, w.g, lat0) }))
        .filter((c) => c.dist < 60)
        .sort((a, b) => a.dist - b.dist);
      if (!cand.length) {
        shifts.push([0, 0]);
        continue;
      }

      const a = cand[0];
      const sgn = a.lateral > 0.5 ? 1 : a.lateral < -0.5 ? -1 : 0;
      const b = cand.find(
        (c) =>
          c.id !== a.id &&
          Math.abs(c.lateral) >= MIN_SHIFT &&
          Math.abs(c.lateral) <= 60 &&
          (sgn === 0 ? true : Math.sign(c.lateral) !== sgn),
      );
      if (!b || Math.abs(a.lateral) > 12) {
        shifts.push([0, 0]);
        continue;
      }

      // 目标点 = 两幅中点：当前点到中点的横向距离为 (a + b) / 2。
      // 用 (b - a) / 2 只在「线正好压在 a 上」时等价，已居中时会把线推回单侧。
      const apply = (a.lateral + b.lateral) / 2;
      if (Math.abs(apply) < MIN_SHIFT || Math.abs(apply) > MAX_SHIFT) {
        shifts.push([0, 0]);
        continue;
      }
      straddle++;
      const key = `${a.id}↔${b.id}`;
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
      shifts.push([-tangent[1] * apply, tangent[0] * apply]);
    }

    const coverage = (straddle / part.length) * 100;
    if (coverage < MIN_COVERAGE) continue;

    // 平滑，避免双幅分合处中心线抖动
    const win = 5;
    const smooth = shifts.map((_, i) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let k = Math.max(0, i - win); k <= Math.min(shifts.length - 1, i + win); k++) {
        sx += shifts[k][0];
        sy += shifts[k][1];
        n++;
      }
      return [sx / n, sy / n];
    });

    const coords = part.map((p, i) =>
      round6([p[0] + smooth[i][0] / kx, p[1] + smooth[i][1] / ky]),
    );
    const topPair = [...pairCount.entries()].sort((x, y) => y[1] - x[1])[0];
    rows.push({
      name: props.name,
      pi,
      coverage,
      pair: topPair ? topPair[0] : "-",
      meanShift:
        smooth.reduce((s, [mx, my]) => s + Math.hypot(mx, my), 0) / smooth.length,
      maxShift: Math.max(...smooth.map(([mx, my]) => Math.hypot(mx, my))),
    });
    if (!patches.has(f)) patches.set(f, []);
    patches.get(f).push({ pi, coords });
  }
}

console.log(`候选 part：${rows.length} 个，涉及道路 ${patches.size} 条\n`);
rows.sort((a, b) => b.meanShift - a.meanShift);
for (const r of rows) {
  console.log(
    `  ${r.name} part${r.pi}: 双幅覆盖 ${r.coverage.toFixed(0)}% | 平均校正 ${r.meanShift.toFixed(1)} m | 最大 ${r.maxShift.toFixed(1)} m | 主配对 ${r.pair}`,
  );
}

if (WRITE) {
  for (const [f, list] of patches) {
    const parts = partsOf(f).map((p) => p.map(round6));
    for (const c of list) parts[c.pi] = c.coords;
    const total = parts.reduce((s, p) => s + len(p), 0) / 1000;
    f.geometry =
      parts.length === 1
        ? { type: "LineString", coordinates: parts[0] }
        : { type: "MultiLineString", coordinates: parts };
    const note = `中心线按双幅路中点校正（${total.toFixed(2)} km）`;
    f.properties.note = f.properties.note
      ? `${f.properties.note}；${note}`
      : note;
  }
  const text = `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`;
  fs.writeFileSync(ROADS, text);
  console.log(`\n已写入 ${ROADS}（CRLF，${Buffer.byteLength(text)} 字节）`);
} else {
  console.log("\ndry-run：未写盘（加 --write 落盘）");
}
