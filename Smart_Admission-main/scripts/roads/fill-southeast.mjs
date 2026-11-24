/**
 * fill-southeast.mjs - 补齐东南角（泮河大街东延 + 上高东路）
 *
 * 背景:
 *   页面右下角（万官大街以东、华益路以西）在天地图底图上有一条连续主干路，
 *   但在我们的路网里只画到泮河大街东端（117.1394），往东 2.9 km 一片空白。
 *   OSM 里这段是「无名 primary」上下行双线，天地图标注为「泮河大街 → 上高东路」。
 *
 * 处理:
 *   1. 泮河大街：把东端 117.13941 → 拐点 117.1648 的无名 primary 中心线并入原要素；
 *   2. 新增 road_059「上高东路」：拐点 117.1648,36.1618 → 117.1762,36.1737 的
 *      NE 斜段（OSM 无名 primary，天地图标注名）。
 *   两条都由上下行双线逐 8 m 取中点后抽稀，接缝归一到同一点。
 *
 * 用法:
 *   node scripts/roads/fill-southeast.mjs            # dry-run
 *   node scripts/roads/fill-southeast.mjs --write    # 落盘
 *   node scripts/roads/fill-southeast.mjs --osm <缓存文件>
 *
 * 只读输入: data/roads.geojson、OSM 抓取缓存（默认 %TEMP%/osm_se_corridor.json）
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
    : path.join(process.env.TEMP || ".", "osm_se_corridor.json");

// 由西向东：北幅、南幅各自的 way 链（Overpass 抓取时按 node 顺序，脚本内再统一朝向）
const NORTH = [135895818, 1121158955, 135895815, 1121158956, 982445435, 982445436, 1215907816, 135895817];
const SOUTH = [1121158958, 135895820, 135895816, 982445437, 1121158957, 982445438, 1215907812, 135895814];

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

/** 把若干 way 串成一条链，逐段修正方向 */
const chain = (ids, byId) => {
  const out = [];
  for (const id of ids) {
    const w = byId.get(id);
    if (!w) throw new Error(`OSM 缓存缺少 way ${id}`);
    let g = w.slice();
    if (out.length) {
      const last = out[out.length - 1];
      if (dd(last, g[g.length - 1]) < dd(last, g[0])) g = g.reverse();
      out.push(...g.slice(1));
    } else {
      // 首条 way 从西端出发（整条走廊自西向东），否则后面的 way 会被串成往返
      if (g[0][0] > g[g.length - 1][0]) g = g.reverse();
      out.push(...g);
    }
  }
  return out;
};

/** 沿 A 每 step 米取点，与 B 最近点取中点 */
const midline = (a, b, step = 8) => {
  const out = [a[0]];
  let carry = 0;
  for (let i = 1; i < a.length; i++) {
    const seg = dd(a[i - 1], a[i]);
    let t = step - carry;
    while (t <= seg) {
      const r = t / seg;
      const p = [a[i - 1][0] + (a[i][0] - a[i - 1][0]) * r, a[i - 1][1] + (a[i][1] - a[i - 1][1]) * r];
      let best = null;
      let bd = Infinity;
      for (let j = 1; j < b.length; j++) {
        const [x1, y1] = b[j - 1];
        const [x2, y2] = b[j];
        const kx = 111320 * Math.cos(rad(p[1]));
        const ky = 110574;
        const ax = (x1 - p[0]) * kx, ay = (y1 - p[1]) * ky;
        const bx = (x2 - p[0]) * kx, by = (y2 - p[1]) * ky;
        const vx = bx - ax, vy = by - ay;
        const L2 = vx * vx + vy * vy;
        let s = L2 ? -(ax * vx + ay * vy) / L2 : 0;
        s = Math.max(0, Math.min(1, s));
        const qx = ax + vx * s, qy = ay + vy * s;
        const d2 = qx * qx + qy * qy;
        if (d2 < bd) { bd = d2; best = [x1 + (x2 - x1) * s, y1 + (y2 - y1) * s]; }
      }
      out.push([(p[0] + best[0]) / 2, (p[1] + best[1]) / 2]);
      t += step;
    }
    carry = (carry + seg) % step;
  }
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
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx !== -1) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
};

const raw = fs.readFileSync(ROADS, "utf8").replace(/^\uFEFF/, "");
const fc = JSON.parse(raw);
const osm = JSON.parse(fs.readFileSync(OSM, "utf8").replace(/^\uFEFF/, ""));
const byId = new Map();
for (const e of osm.elements || []) {
  if (!e.geometry) continue;
  byId.set(e.id, e.geometry.map((q) => [q.lon, q.lat]));
}

const north = chain(NORTH, byId);
const south = chain(SOUTH, byId);
const mids = midline(north, south, 8);

// 拐点：北幅 1215907816 的终点（117.1648, 36.16181）
const CORNER = [117.16480, 36.16181];
let cornerIdx = 0, cornerD = Infinity;
for (let i = 0; i < mids.length; i++) {
  const d = dd(mids[i], CORNER);
  if (d < cornerD) { cornerD = d; cornerIdx = i; }
}

const horiz = simplify(mids.slice(0, cornerIdx + 1), 1.5).map(round6);
const diag = simplify(mids.slice(cornerIdx), 1.5).map(round6);

// 接缝：泮河大街现东端与水平段起点归一
const panhe = fc.features.find((f) => f.properties.name === "泮河大街");
const panheParts = panhe.geometry.type === "MultiLineString" ? panhe.geometry.coordinates : [panhe.geometry.coordinates];
if (panheParts.length !== 1) throw new Error("泮河大街不是单段，需人工处理");
const base = panheParts[0].map((p) => [...p]);
const oldEnd = base[base.length - 1];
horiz[0] = round6(oldEnd); // 起点直接沿用原终点，避免出现 2 m 接缝台阶

const mergedPanhe = simplify([...base, ...horiz.slice(1)], 0.8).map(round6);

console.log(`OSM 北幅 ${north.length} 点 / 南幅 ${south.length} 点`);
console.log(`水平段 ${horiz.length} 点 / ${(len(horiz) / 1000).toFixed(2)} km，起 ${oldEnd} 末 ${horiz[horiz.length - 1]}`);
console.log(`斜段    ${diag.length} 点 / ${(len(diag) / 1000).toFixed(2)} km，起 ${diag[0]} 末 ${diag[diag.length - 1]}`);
console.log(`泮河大街合并后 ${mergedPanhe.length} 点 / ${(len(mergedPanhe) / 1000).toFixed(2)} km`);

const newFeature = {
  type: "Feature",
  properties: {
    roadId: "road_059",
    name: "上高东路",
    type: "道路",
    important: true,
    dataStatus: "osm",
    note: "OSM 无名 primary 走廊（天地图标注为上高东路），上下行双线逐点取中点合并；西起万官大街东端/泮河大街拐点，东北接灵山大街东端 (© OpenStreetMap contributors, ODbL)",
  },
  geometry: { type: "LineString", coordinates: diag },
};

if (WRITE) {
  panhe.geometry = { type: "LineString", coordinates: mergedPanhe };
  panhe.properties.note = `${panhe.properties.note}；东南角补齐：东延 117.1394→117.1648 共 2.05 km（OSM 无名 primary 中心线）`;
  fc.features.push(newFeature);
  const text = `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`;
  fs.writeFileSync(ROADS, text);
  console.log(`\n已写入 ${ROADS}（CRLF，${Buffer.byteLength(text)} 字节，要素 ${fc.features.length} 个）`);
} else {
  console.log("\ndry-run：未写盘（加 --write 落盘）");
}
