/**
 * fix-rivers-and-streets.mjs - 河流校正 + 补齐凤台路/双龙路
 *
 * 背景:
 *   1. 截图反馈「蓝色河流线没有落在河道上」。核对 OSM 与官方水网名单后确认：
 *      - river_005「芝田河」原为 5 点模板直线（117.2088–117.2110），实际河道在
 *        其东侧 600 m 左右，OSM 无名 river（way 485399549）即底图那条河；
 *      - river_004「唐王河」原为 4 点模板直线（117.174–117.176），该位置前后
 *        1 km 内没有任何河道，OSM 亦无同名水道；底图上那条真实河道是
 *        「明堂河」（way 398414525，流经省庄镇/冯家庄）。
 *      经确认，把 river_004 改到明堂河实测河道并改名。
 *   2. 截图标注了「凤台路」「双龙路」，但两条街在路网里都不存在，本次按 OSM
 *      实测几何补全；双龙路为上下行双线，逐 8 m 取中点合并为单条中心线。
 *   3. road_011「北上高大街」在历史重建中丢了 important 标志，被渲染成支路
 *      灰细线（几乎不可见），本次恢复。
 *
 * 用法:
 *   node scripts/roads/fix-rivers-and-streets.mjs           # dry-run
 *   node scripts/roads/fix-rivers-and-streets.mjs --write   # 落盘
 *   node scripts/roads/fix-rivers-and-streets.mjs --osm <缓存文件>  # 追加 OSM 缓存
 *
 * 只读输入: data/roads.geojson、%TEMP%/osm_water_w.json、osm_fengtai.json、
 *           osm_near.json、osm_bsg.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const WRITE = process.argv.includes("--write");

const cacheArgs = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--osm" && process.argv[i + 1]) cacheArgs.push(process.argv[i + 1]);
}
const CACHES = [
  "osm_water_w.json",
  "osm_fengtai.json",
  "osm_near.json",
  "osm_bsg.json",
  ...cacheArgs,
].map((p) => (path.isAbsolute(p) ? p : path.join(process.env.TEMP || ".", p)));

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

/** 把若干 way 串成一条链，逐段修正方向；firstFrom="south"|"north"|"west"|"east" */
const chain = (ids, byId, firstFrom = "south") => {
  const out = [];
  for (const id of ids) {
    const w = byId.get(id);
    if (!w) throw new Error(`OSM 缓存缺少 way ${id}`);
    let g = w.slice();
    if (!out.length) {
      const a = g[0];
      const b = g[g.length - 1];
      const flip =
        firstFrom === "south"
          ? a[1] > b[1]
          : firstFrom === "north"
            ? a[1] < b[1]
            : firstFrom === "west"
              ? a[0] > b[0]
              : a[0] < b[0];
      if (flip) g = g.reverse();
      out.push(...g);
    } else {
      const last = out[out.length - 1];
      if (dd(last, g[g.length - 1]) < dd(last, g[0])) g = g.reverse();
      if (dd(last, g[0]) < 1) out.push(...g.slice(1));
      else out.push(...g);
    }
  }
  // 去掉相邻重复点
  return out.filter((p, i) => i === 0 || dd(out[i - 1], p) > 0.5);
};

/** 沿 A 每 step 米取点，与 B 最近点取中点 */
const midline = (a, b, step = 8) => {
  const out = [a[0]];
  let carry = 0;
  for (let i = 1; i < a.length; i++) {
    const seg = dd(a[i - 1], a[i]);
    let t = step - carry;
    while (t <= seg && seg > 0) {
      const r = t / seg;
      const p = [
        a[i - 1][0] + (a[i][0] - a[i - 1][0]) * r,
        a[i - 1][1] + (a[i][1] - a[i - 1][1]) * r,
      ];
      let best = null;
      let bd = Infinity;
      const kx = 111320 * Math.cos(rad(p[1]));
      const ky = 110574;
      for (let j = 1; j < b.length; j++) {
        const [x1, y1] = b[j - 1];
        const [x2, y2] = b[j];
        const ax = (x1 - p[0]) * kx, ay = (y1 - p[1]) * ky;
        const bx = (x2 - p[0]) * kx, by = (y2 - p[1]) * ky;
        const vx = bx - ax, vy = by - ay;
        const L2 = vx * vx + vy * vy;
        let s = L2 ? -(ax * vx + ay * vy) / L2 : 0;
        s = Math.max(0, Math.min(1, s));
        const qx = ax + vx * s, qy = ay + vy * s;
        const d2 = qx * qx + qy * qy;
        if (d2 < bd) {
          bd = d2;
          best = [x1 + (x2 - x1) * s, y1 + (y2 - y1) * s];
        }
      }
      out.push([(p[0] + best[0]) / 2, (p[1] + best[1]) / 2]);
      t += step;
    }
    carry = (carry + seg) % step;
  }
  out.push(a[a.length - 1]);
  return out;
};

/** 米制 Douglas-Peucker */
const simplify = (line, tol) => {
  if (line.length <= 2) return line;
  const kx = 111320 * Math.cos(rad(line[0][1]));
  const ky = 110574;
  const mx = line.map((p) => [p[0] * kx, p[1] * ky]);
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = mx[s];
    const [x2, y2] = mx[e];
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    let idx = -1, max = 0;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = mx[i];
      const d = Math.abs((x - x1) * dy - (y - y1) * dx) / L;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx !== -1) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
};

// ---- 读取 ----------------------------------------------------------------
const fc = JSON.parse(fs.readFileSync(ROADS, "utf8").replace(/^\uFEFF/, ""));
const byId = new Map();
const loaded = [];
for (const file of CACHES) {
  if (!fs.existsSync(file)) continue;
  const j = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  for (const e of j.elements || []) {
    if (!e.geometry) continue;
    byId.set(e.id, e.geometry.map((q) => [q.lon, q.lat]));
  }
  loaded.push(path.basename(file));
}
console.log(`OSM 缓存：${loaded.join("、")}（way ${byId.size} 条）\n`);

const featureOf = (name) => {
  const f = fc.features.find((x) => x.properties.name === name);
  if (!f) throw new Error(`未找到要素：${name}`);
  return f;
};

// ---- 1. 河流校正 ---------------------------------------------------------
const zhiTian = chain([485399549], byId, "north").map(round6);
const mingTang = chain([398414525], byId, "north").map(round6);

// ---- 2. 凤台路 -----------------------------------------------------------
const fengtai = simplify(
  chain([136913560, 1095897370, 136913557, 374511466], byId, "south"),
  1.0,
).map(round6);

// ---- 3. 双龙路（上下行双线取中点） ---------------------------------------
const SL_WEST = [1112177901, 1164699989, 1164699990, 1138708412, 1138708413, 1342185429, 1138708414, 1342185425, 1138708411];
const SL_EAST = [563084462, 1164699995, 1164699996, 1138708410, 1138708415, 1138708416, 1342185432, 1138708409];
const west = chain(SL_WEST, byId, "south");
const east = chain(SL_EAST, byId, "south");
const shuanglong = simplify(midline(west, east, 8), 1.5).map(round6);

const rep = (label, c) => {
  const lons = c.map((p) => p[0]);
  const lats = c.map((p) => p[1]);
  console.log(
    `${label}: ${c.length} 点 / ${(len(c) / 1000).toFixed(2)} km | lng ${Math.min(...lons).toFixed(5)}~${Math.max(...lons).toFixed(5)} lat ${Math.min(...lats).toFixed(5)}~${Math.max(...lats).toFixed(5)}`,
  );
};
rep("芝田河（OSM 485399549）", zhiTian);
rep("明堂河（OSM 398414525）", mingTang);
rep("凤台路（OSM 双线串链）", fengtai);
console.log(
  `双龙路：西幅 ${west.length} 点 / 东幅 ${east.length} 点 → 中心线 ${shuanglong.length} 点`,
);
rep("双龙路中心线", shuanglong);

// ---- 4. 落盘内容 ---------------------------------------------------------
const zhi = featureOf("芝田河");
const tang = featureOf("唐王河");
const bsg = featureOf("北上高大街");

if (zhi.properties.dataStatus === "osm") throw new Error("芝田河已是 osm 数据，避免重复执行");
if (tang.properties.dataStatus === "osm") throw new Error("唐王河已是 osm 数据，避免重复执行");
if (fc.features.some((f) => f.properties.name === "凤台路")) throw new Error("凤台路已存在");
if (fc.features.some((f) => f.properties.name === "双龙路")) throw new Error("双龙路已存在");

if (WRITE) {
  // 芝田河
  zhi.geometry = { type: "LineString", coordinates: zhiTian };
  zhi.properties.dataStatus = "osm";
  zhi.properties.note =
    "原为 5 点模板示意直线（117.2088–117.2110，偏西约 0.6 km）；按 OSM 无名 river way 485399549 实测河道重绘 (© OpenStreetMap contributors, ODbL)";

  // 唐王河 → 明堂河
  tang.properties.name = "明堂河";
  tang.properties.dataStatus = "osm";
  tang.geometry = { type: "LineString", coordinates: mingTang };
  tang.properties.note =
    "原为 4 点模板示意直线（117.174–117.176），该位置前后 1 km 无任何河道，OSM 亦无「唐王河」水道；按底图真实河道「明堂河」OSM way 398414525 实测线重绘并更名 (© OpenStreetMap contributors, ODbL)";

  // 北上高大街：恢复主干标志
  bsg.properties.important = true;
  bsg.properties.note = `${bsg.properties.note}；恢复 important 标志（历史重建时丢失，导致被渲染为支路灰细线）`;

  fc.features.push({
    type: "Feature",
    properties: {
      roadId: "road_060",
      name: "凤台路",
      type: "道路",
      important: true,
      dataStatus: "osm",
      note: "OSM way 136913560 + 1095897370 + 136913557 + 374511466 串链（南起灵山大街侧 36.1933，北至 36.2153），接缝点已归一 (© OpenStreetMap contributors, ODbL)",
    },
    geometry: { type: "LineString", coordinates: fengtai },
  });

  fc.features.push({
    type: "Feature",
    properties: {
      roadId: "road_061",
      name: "双龙路",
      type: "道路",
      important: true,
      dataStatus: "osm",
      note: "OSM secondary 上下行双线（西幅 9 段 + 东幅 8 段）逐 8 m 取中点合并为中心线，南起 36.1798、北至 36.2259 (© OpenStreetMap contributors, ODbL)",
    },
    geometry: { type: "LineString", coordinates: shuanglong },
  });

  const text = `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`;
  fs.writeFileSync(ROADS, text);
  console.log(`\n已写入 ${ROADS}（CRLF，${Buffer.byteLength(text)} 字节，要素 ${fc.features.length} 个）`);
} else {
  console.log("\ndry-run：未写盘（加 --write 落盘）");
}
