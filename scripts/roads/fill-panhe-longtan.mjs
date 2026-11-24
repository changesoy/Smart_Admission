/**
 * fill-panhe-longtan.mjs - 补齐泮河大街西段（含沿河斜段）与龙潭路缺口
 *
 * 背景:
 *   截图区域（lng 117.104–117.125 / lat 36.160–36.177）里:
 *   1) 泮河大街在 OSM 中只有 117.1254 以东的水平段，以西的「水平段 + 沿泮河东南斜段」
 *      是同一走廊的**无名 primary** 上下行双线，之前按 name 组装时被漏掉；
 *   2) 龙潭路在 36.1689–36.1830 之间是一段**无名**（secondary/primary）走廊，
 *      之前同样按 name 组装，所以出现 1.4 km 断口。
 *
 * 处理:
 *   - 两组走廊各自按 way 链串成上下行两条线，逐 8 m 取中点得中心线，再抽稀；
 *   - 泮河大街西段中心线并入 road_007（西端为迎胜高架路交叉口 117.0863）；
 *   - 龙潭路缺口段并入 road_019，接缝端点归一到原有端点。
 *
 * 用法:
 *   node scripts/roads/fill-panhe-longtan.mjs            # dry-run
 *   node scripts/roads/fill-panhe-longtan.mjs --write    # 落盘
 *   node scripts/roads/fill-panhe-longtan.mjs --osm <a> --osm2 <b>
 *
 * 只读输入: data/roads.geojson、%TEMP%/osm_panhe_gap.json、%TEMP%/osm_panhe_west.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const WRITE = process.argv.includes("--write");
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OSM_A = argOf("--osm", path.join(process.env.TEMP || ".", "osm_panhe_gap.json"));
const OSM_B = argOf("--osm2", path.join(process.env.TEMP || ".", "osm_panhe_west.json"));

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

/** 按 way 链串线：首条朝 startAnchor 方向，后续逐段取近端；缝隙 > tol 时直线补齐 */
const chain = (ids, byId, startAnchor, tol = 60) => {
  const out = [];
  let head = startAnchor;
  for (const id of ids) {
    const w = byId.get(id);
    if (!w) throw new Error(`OSM 缓存缺少 way ${id}`);
    let g = w.slice();
    if (dd(head, g[g.length - 1]) < dd(head, g[0])) g = g.reverse();
    const gap = dd(head, g[0]);
    if (out.length && gap > tol) {
      console.warn(`  ⚠️ 接缝偏大 ${gap.toFixed(1)} m（way ${id}）`);
    }
    out.push(...g);
    head = out[out.length - 1];
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
      const p = [
        a[i - 1][0] + (a[i][0] - a[i - 1][0]) * r,
        a[i - 1][1] + (a[i][1] - a[i - 1][1]) * r,
      ];
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

/** 移动平均平滑：消除立交范围内两幅错位造成的锯齿 */
const smooth = (line, win = 5) => {
  if (line.length < win) return line;
  const h = Math.floor(win / 2);
  return line.map((_, i) => {
    const s = Math.max(0, i - h), e = Math.min(line.length - 1, i + h);
    let x = 0, y = 0, n = 0;
    for (let j = s; j <= e; j++) { x += line[j][0]; y += line[j][1]; n++; }
    return [x / n, y / n];
  });
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

const byId = new Map();
for (const file of [OSM_A, OSM_B]) {
  const j = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  for (const e of j.elements || []) {
    if (!e.geometry || e.type !== "way") continue;
    byId.set(e.id, e.geometry.map((q) => [q.lon, q.lat]));
  }
}

// ---------- 泮河大街西段（无名 primary 上下行双线） ----------
// 北幅：迎胜高架路口 → 水平东行 → 沿泮河东南斜段 → 36.1618 水平段 → 117.1255
const PH_N = [1046783991, 1104558863, 1046783992, 1104558865, 1104558864, 375478646,
  1126948818, 1127420802, 228469372, 228469371];
// 南幅：与北幅并行
const PH_S = [387995089, 1104558892, 1046783996, 1104558891, 1215907813, 1104558897, 1215907815,
  135999739, 1126948819, 135999759, 1127420826, 1127420825, 135999743];

const PH_WEST = [117.08630, 36.17130];   // 迎胜高架路交叉口（走廊西端）
const PH_EAST = [117.12548, 36.16186];   // 与既有 road_007 西端衔接

const phN = chain(PH_N, byId, PH_WEST);
const phS = chain(PH_S, byId, PH_WEST);
const phMid = smooth(midline(phN, phS, 8), 5);
phMid[0] = PH_WEST;
phMid[phMid.length - 1] = PH_EAST;

// ---------- 龙潭路缺口（36.1689 → 36.1830 的无名走廊） ----------
const LT_W = [1086979939, 429675595, 1104558890, 676046816, 1112427990, 1216379168,
  1047600192, 1047600187, 311029580, 1216183436, 1216183437, 670455163, 676280787];
const LT_E = [135999738, 1086979938, 1104558867, 387995096, 1112656386, 1112427970,
  1343333873, 676046843, 311030132, 59993263, 670455151];

const LT_S = [117.11043, 36.16891];   // 与 road_019 南段北端衔接
const LT_N = [117.10447, 36.18305];   // 与 road_019 北段南端衔接

const ltW = chain(LT_W, byId, LT_S);
const ltE = chain(LT_E, byId, LT_S);
const ltMid = smooth(midline(ltW, ltE, 8), 5);
ltMid[0] = LT_S;
ltMid[ltMid.length - 1] = LT_N;

const phSimp = simplify(phMid, 1.2).map(round6);
const ltSimp = simplify(ltMid, 1.0).map(round6);

console.log(`泮河大街西段: 北幅 ${phN.length} 点 / 南幅 ${phS.length} 点 → 中心线 ${phMid.length} → 抽稀 ${phSimp.length} 点 / ${(len(phSimp) / 1000).toFixed(2)} km`);
console.log(`  起 ${phSimp[0]} 末 ${phSimp[phSimp.length - 1]}`);
console.log(`龙潭路缺口: 西幅 ${ltW.length} 点 / 东幅 ${ltE.length} 点 → 中心线 ${ltMid.length} → 抽稀 ${ltSimp.length} 点 / ${(len(ltSimp) / 1000).toFixed(2)} km`);
console.log(`  起 ${ltSimp[0]} 末 ${ltSimp[ltSimp.length - 1]}`);
console.log(`  最大偏距检查: 中线到西幅 ${Math.max(...ltSimp.map((p) => Math.min(...ltW.map((q) => dd(p, q))))).toFixed(1)} m`);
console.log(`  泮河大街中心线: ${phSimp.map((p) => p.join(",")).join(" | ")}`);
console.log(`  龙潭路中心线: ${ltSimp.map((p) => p.join(",")).join(" | ")}`);

const raw = fs.readFileSync(ROADS, "utf8").replace(/^\uFEFF/, "");
const fc = JSON.parse(raw);
const panhe = fc.features.find((f) => f.properties.roadId === "road_007");
const longtan = fc.features.find((f) => f.properties.roadId === "road_019");
if (!panhe || !longtan) throw new Error("缺少 road_007 / road_019");

// 幂等守卫：泮河大街西端已到 117.087 则说明已补过
const phParts = panhe.geometry.type === "MultiLineString" ? panhe.geometry.coordinates : [panhe.geometry.coordinates];
if (phParts.length !== 1) throw new Error("road_007 不是单段");
const phBase = phParts[0].map((p) => [...p]);
if (Math.min(...phBase.map((p) => p[0])) < 117.1) throw new Error("road_007 已包含西段，无需重复执行");

const mergedPh = [...phSimp.slice(0, -1), ...phBase];
if (dd(mergedPh[phSimp.length - 1], phBase[0]) > 1) {
  throw new Error(`泮河大街接缝偏大: ${dd(mergedPh[phSimp.length - 1], phBase[0]).toFixed(2)} m`);
}

const ltParts = longtan.geometry.type === "MultiLineString" ? longtan.geometry.coordinates : [longtan.geometry.coordinates];
if (ltParts.length !== 2) throw new Error(`road_019 段数 ${ltParts.length}，预期 2`);
const ltNorth = ltParts[0].map((p) => [...p]);
const ltSouth = ltParts[1].map((p) => [...p]);
if (dd(ltNorth[ltNorth.length - 1], LT_N) > 1 || dd(ltSouth[0], LT_S) > 1) {
  throw new Error("road_019 接缝位置与预期不符");
}
const ltGap = [...ltSimp].reverse(); // 北 → 南
const mergedLt = [...ltNorth.slice(0, -1), ...ltGap, ...ltSouth.slice(1)];
const mergedLtSimp = simplify(mergedLt, 0.4).map(round6);

console.log(`\n泮河大街合并后 ${mergedPh.length} 点 / ${(len(mergedPh) / 1000).toFixed(2)} km`);
console.log(`龙潭路合并后 ${mergedLtSimp.length} 点 / ${(len(mergedLtSimp) / 1000).toFixed(2)} km（原 2 段 → 1 段）`);

if (WRITE) {
  panhe.geometry = { type: "LineString", coordinates: mergedPh };
  panhe.properties.note =
    `${panhe.properties.note}；截图区补齐：西延至迎胜高架路口（117.0863）+ 沿泮河东南斜段，共 2.62 km（OSM 无名 primary 上下行双线取中点）`;
  longtan.geometry = { type: "LineString", coordinates: mergedLtSimp };
  longtan.properties.note =
    `${longtan.properties.note}；补齐 36.1689→36.1830 断口 1.44 km（OSM 无名 secondary/primary 双线取中点）`;
  const text = `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`;
  fs.writeFileSync(ROADS, text);
  console.log(`\n已写入 ${ROADS}（CRLF，${Buffer.byteLength(text)} 字节，要素 ${fc.features.length} 个）`);
} else {
  console.log("\ndry-run：未写盘（加 --write 落盘）");
}
