﻿/**
 * fill-m2.mjs — 第二批目视复核（7 项）路网修正
 *
 * 1/2. 泮河大街（road_007）西北弯道斜穿 + 龙潭路路口跳变：按 OSM 上下行双线重新取中点，整段重铺至 117.12529
 * 3/4. 泮河大街西端缺线：自 117.0863 西延至天平湖路路口 117.0585（含宏成园立交一带）
 * 5.   天烛峰路（road_038）南延：自东岳大街 36.1936 南延至灵山大街 36.1779
 * 6.   环山东路（碧霞大街 road_063）东延：自 117.20205 沿 S243 至 117.26036
 * 7.   唐王街（road_058）东延：自 117.17104 沿 G341 至华益路口 117.19961
 *
 * 几何全部取自 OpenStreetMap（out geom），双幅路按逐点最近点取中点后平滑抽稀。
 * 默认 dry-run，加 --write 落盘。
 */
import fs from "node:fs";

const ROOT = "c:/Users/29114/Desktop/123/Smart_Admission";
const DATA = `${ROOT}/data/roads.geojson`;
const WRITE = process.argv.includes("--write");

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const lineLen = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
const bearing = (a, b) => {
  const y = (b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const x = b[1] - a[1];
  return (Math.atan2(y, x) * 180) / Math.PI;
};

// ---------- OSM 缓存 ----------
const FILES = ["osm_m2_panhe", "osm_m2_panhe_w", "osm_m2_tz", "osm_m2_tangwang", "osm_m2_huanshan", "osm_m2_east"];
const byId = new Map();
for (const f of FILES) {
  const p = `C:/Users/29114/AppData/Local/Temp/${f}.json`;
  if (!fs.existsSync(p)) throw new Error(`缺少 OSM 缓存 ${p}`);
  for (const el of JSON.parse(fs.readFileSync(p, "utf8")).elements) {
    if (!el.geometry || el.geometry.length < 2) continue;
    byId.set(el.id, el.geometry.map((q) => [q.lon, q.lat]));
  }
}
const ALL = [...byId].map(([id, pts]) => ({ id, pts }));

function orient(id, anchor, tol = 60) {
  const line = byId.get(id);
  if (!line) throw new Error(`缺少 OSM way ${id}`);
  const d0 = dist(line[0], anchor);
  const d1 = dist(line[line.length - 1], anchor);
  if (d1 <= tol && d1 < d0) return line.slice().reverse();
  if (d0 <= tol) return line.slice();
  throw new Error(`way ${id} 端点离锚点 ${Math.min(d0, d1).toFixed(1)}m，超过 ${tol}m`);
}

/** 按给定 way 顺序串成一条线，返回 { pts, ids } */
function build(ids, anchor, label) {
  const out = [];
  for (const id of ids) {
    const prev = out.length ? out[out.length - 1] : anchor;
    const line = orient(id, prev);
    out.push(...(out.length ? line.slice(1) : line));
  }
  if (out.length < 2) throw new Error(`${label} 组装失败`);
  return { pts: out, ids: new Set(ids) };
}

/** 在给定点集/线段集中找最近点（跳过指定 way 自身） */
function nearestAcross(pt, exclude, bearingAt) {
  let best = null;
  for (const w of ALL) {
    if (exclude.has(w.id)) continue;
    const line = w.pts;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const kx = Math.cos(rad((a[1] + b[1]) / 2)) * 111320;
      const ky = 111320;
      const ax = (b[0] - a[0]) * kx;
      const ay = (b[1] - a[1]) * ky;
      const px = (pt[0] - a[0]) * kx;
      const py = (pt[1] - a[1]) * ky;
      const len2 = ax * ax + ay * ay;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ax + py * ay) / len2)) : 0;
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const d = Math.hypot(px - ax * t, py - ay * t);
      if (d < 4 || d > 38) continue;
      if (best && d >= best.d) continue;
      const brg = bearing(pt, q);
      let diff = Math.abs(brg - bearingAt) % 180;
      if (diff > 90) diff = 180 - diff;
      if (diff > 35) continue; // 只接受近似垂直的横向偏移，排除顺向/交叉道路
      best = { d, q };
    }
  }
  return best;
}

/** 沿 path 逐 8 m 采样，与相邻平行线取中点 */
function midlineAlong(path, exclude, step = 8) {
  const out = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const p0 = path[i - 1];
    const p1 = path[i];
    const segLen = dist(p0, p1);
    if (segLen === 0) continue;
    const brg = bearing(p0, p1);
    let d = step - carry;
    while (d <= segLen) {
      const t = d / segLen;
      const p = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
      const hit = nearestAcross(p, exclude, brg);
      out.push(hit ? [(p[0] + hit.q[0]) / 2, (p[1] + hit.q[1]) / 2] : p);
      d += step;
    }
    carry = segLen - (d - step);
  }
  out.push(path[path.length - 1]);
  return out;
}

function smooth(line, win = 5) {
  const half = Math.floor(win / 2);
  return line.map((p, i) => {
    const seg = line.slice(Math.max(0, i - half), Math.min(line.length, i + half + 1));
    return [seg.reduce((s, q) => s + q[0], 0) / seg.length, seg.reduce((s, q) => s + q[1], 0) / seg.length];
  });
}

function simplify(line, tol) {
  if (line.length <= 2) return line.slice();
  const a = line[0];
  const b = line[line.length - 1];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const kx = Math.cos(rad((a[1] + b[1]) / 2)) * 111320;
    const ky = 111320;
    const ax = (b[0] - a[0]) * kx;
    const ay = (b[1] - a[1]) * ky;
    const px = (line[i][0] - a[0]) * kx;
    const py = (line[i][1] - a[1]) * ky;
    const len2 = ax * ax + ay * ay;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * ax + py * ay) / len2)) : 0;
    const d = Math.hypot(px - ax * t, py - ay * t);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tol) {
    const left = simplify(line.slice(0, idx + 1), tol);
    const right = simplify(line.slice(idx), tol);
    return [...left.slice(0, -1), ...right];
  }
  return [a, b];
}

const round6 = (pts) => pts.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);
const seams = [];
function join(parts, label) {
  const out = [];
  for (const p of parts) {
    if (!out.length) {
      out.push(...p);
      continue;
    }
    const last = out[out.length - 1];
    const d = dist(last, p[0]);
    if (d < 0.1) out.push(...p.slice(1));
    else if (d < 80) {
      const mid = [(last[0] + p[0][0]) / 2, (last[1] + p[0][1]) / 2];
      out[out.length - 1] = mid;
      out.push(...p.slice(1));
      seams.push({ label, d: Number(d.toFixed(1)), mid: mid.map((v) => Number(v.toFixed(6))) });
    } else throw new Error(`${label} 接缝 ${d.toFixed(1)}m 超限`);
  }
  return out;
}

const fc = JSON.parse(fs.readFileSync(DATA, "utf8"));
const byRoad = new Map(fc.features.map((f) => [Number(String(f.properties.roadId).replace(/\D/g, "")) || f.properties.roadId, f]));
const get = (id) => {
  const f = fc.features.find((x) => String(x.properties.roadId) === String(id));
  if (!f) throw new Error(`缺少要素 ${id}`);
  return f;
};
const partsOf = (f) => (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates);

// ---------- 幂等守卫 ----------
if (get("road_007").geometry.coordinates[0][0] < 117.07) throw new Error("road_007 已西延，无需重复执行");
if (get("road_038").geometry.coordinates[0][1] < 36.19) throw new Error("road_038 已南延，无需重复执行");
if (get("road_058").geometry.coordinates.slice(-1)[0][0] > 117.18) throw new Error("road_058 已东延，无需重复执行");
if (get(63).geometry.coordinates.slice(-1)[0][0] > 117.21) throw new Error("碧霞大街已东延，无需重复执行");

const report = [];

// ---------- 1+2+3+4. 泮河大街 ----------
const PANHE_OLD = get("road_007").geometry.coordinates;
const panheKeepFrom = PANHE_OLD.findIndex((p) => p[0] >= 117.1252);
if (panheKeepFrom < 0) throw new Error("泮河大街东段基准点缺失");

const panheChain = build(
  [
    94177001, 830649786, 1096688286, 387995081, 1096688233, 1137148330, 1112649295,
    272517699, 1112656373, 1126948856, 387995101, 1046783991, 1104558863,
    1046783992, 1104558865, 1104558864,
    1215907815, 135999739, 1126948818, 1127420802, 1127420826, 1127420825,
  ],
  [117.05891, 36.16799],
  "泮河大街",
);
const panheNew = round6(simplify(smooth(midlineAlong(panheChain.pts, panheChain.ids), 5), 0.8));
console.log("DEBUG panheNew end", panheNew[panheNew.length-1], "keepFrom", PANHE_OLD[panheKeepFrom], "idx", panheKeepFrom);
const panheMerged = round6(join([panheNew, PANHE_OLD.slice(panheKeepFrom)], "泮河大街"));
get("road_007").geometry = { type: "LineString", coordinates: panheMerged };
report.push({ road: "泮河大街", what: "西延+弯道重铺", km: ((lineLen(panheNew) / 1000)).toFixed(2), pts: panheMerged.length });

// ---------- 5. 天烛峰路南延 ----------
const TZ_OLD = get("road_038").geometry.coordinates;
const tzChain = build(
  [1112427997, 246812244, 1121228449, 1112427996, 565058289],
  TZ_OLD[TZ_OLD.length - 1],
  "天烛峰路",
);
const tzExt = round6(simplify(smooth(midlineAlong(tzChain.pts, tzChain.ids), 5), 0.8));
const tzMerged = round6(join([TZ_OLD, tzExt], "天烛峰路"));
get("road_038").geometry = { type: "LineString", coordinates: tzMerged };
report.push({ road: "天烛峰路", what: "南延至灵山大街", km: (lineLen(tzExt) / 1000).toFixed(2), pts: tzMerged.length });

// ---------- 6. 环山东路（碧霞大街东延，S243） ----------
const BX = get(63);
const bxOld = BX.geometry.coordinates;
const s243Chain = build(
  [1085631676, 1085631674, 1085741201, 1085741200, 1085741197, 1085741194, 225025647],
  bxOld[bxOld.length - 1],
  "环山东路",
);
const s243Ext = round6(simplify(smooth(midlineAlong(s243Chain.pts, s243Chain.ids), 5), 0.8));
const bxMerged = round6(join([bxOld, s243Ext], "环山东路"));
BX.geometry = { type: "LineString", coordinates: bxMerged };
report.push({ road: "碧霞大街（环山东路）", what: "东延 S243", km: (lineLen(s243Ext) / 1000).toFixed(2), pts: bxMerged.length });

// ---------- 7. 唐王街东延 ----------
const TW = get("road_058");
const twOld = TW.geometry.coordinates;
const twChain = build([387995095, 1097854233, 1097854234, 355560606, 1121173980], twOld[twOld.length - 1], "唐王街");
const twExt = round6(simplify(smooth(twChain.pts, 5), 0.8));
const twMerged = round6(join([twOld, twExt], "唐王街"));
TW.geometry = { type: "LineString", coordinates: twMerged };
report.push({ road: "唐王街", what: "东延 G341", km: (lineLen(twExt) / 1000).toFixed(2), pts: twMerged.length });

// ---------- 汇总 ----------
console.log("=== 改动明细 ===");
for (const r of report) console.log(`${r.road}: ${r.what} +${r.km} km，合并后 ${r.pts} 点`);
console.log("\n=== 接缝归一 ===");
for (const s of seams) console.log(`${s.label}: ${s.d} m -> ${s.mid.join(", ")}`);

if (!WRITE) {
  console.log("\n(dry-run，未写盘)");
  process.exit(0);
}

const notes = {
  road_007: "；2026-10-25 按 OSM 双线重铺 117.0585–117.1253 段（西延至天平湖路口 2.41 km，弯道与龙潭路路口按上下行取中点消除跳变）",
  road_038: "；2026-10-25 南延 1.73 km 至灵山大街（OSM 无名 secondary 双线 1112427997/246812244/1121228449/1112427996/565058289 取中点）",
  63: "；2026-10-25 东延 5.31 km 沿 S243 至 117.26036（天地图标注「环山东路」，OSM 无名 primary 双线取中点）",
  road_058: "；2026-10-25 东延 2.88 km 沿 G341 至华益路口（387995095/1097854233/1097854234/355560606/1121173980）",
};
for (const [id, note] of Object.entries(notes)) get(id).properties.note = (get(id).properties.note || "") + note;

const backup = `${process.env.TEMP}\\roads_before_m2.geojson`;
fs.writeFileSync(backup, fs.readFileSync(DATA));
fs.writeFileSync(DATA, `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`);
console.log(`\n已写入 ${DATA}（备份 ${backup}）`);



