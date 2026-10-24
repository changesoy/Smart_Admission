/**
 * fill-northeast.mjs - 补齐东部城区三处缺失路段
 *
 * 1) 环山路：补 117.10398→117.11935（OSM name=环山路东段，即底图标注的「环山东路」）
 * 2) 擂鼓石大街：补 117.14248→117.15424（含东段「擂鼓石东大街」前的缺口），合并为一条
 * 3) 天烛峰路：补南延 36.2002→36.1969（小井村一带）
 *
 * 所有几何取自 OpenStreetMap（out geom），双线按逐点最近点取中点后平滑抽稀。
 * 默认 dry-run，加 --write 落盘。
 */
import fs from "node:fs";

const ROOT = "c:/Users/29114/Desktop/123/Smart_Admission";
const DATA = `${ROOT}/data/roads.geojson`;
const WRITE = process.argv.includes("--write");

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const geoOf = (el) => (el.geometry || []).map((p) => [p.lon ?? p[0], p.lat ?? p[1]]);

const byId = new Map();
for (const file of ["osm_east_highways.json", "osm_psj_small.json"]) {
  const json = read(`C:/Users/29114/AppData/Local/Temp/${file}`);
  for (const el of json.elements) byId.set(el.id, geoOf(el));
}

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const lineLen = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

function orient(id, anchor, tol = 80) {
  const line = byId.get(id);
  if (!line) throw new Error(`缺少 OSM way ${id}`);
  const d0 = dist(line[0], anchor);
  const d1 = dist(line[line.length - 1], anchor);
  if (d1 <= tol && d1 < d0) return line.slice().reverse();
  if (d0 <= tol) return line.slice();
  throw new Error(`way ${id} 端点离锚点 ${Math.min(d0, d1).toFixed(1)}m，超过 ${tol}m`);
}

function build(ids, anchor) {
  const out = [];
  for (const id of ids) {
    const prev = out.length ? out[out.length - 1] : anchor;
    const line = orient(id, prev);
    out.push(...(out.length ? line.slice(1) : line));
  }
  return out;
}

/** 最近点投影（米制近似），返回副线上距离给定点最近的位置 */
function nearestOnLine(pt, line) {
  let best = null;
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
    if (!best || d < best.d) best = { d, q };
  }
  return best.q;
}

/** 双线取中点：沿 a 每 step 米采样，取与 b 最近点的中点 */
function midline(a, b, step = 8) {
  const out = [a[0]];
  let carry = 0;
  for (let i = 1; i < a.length; i++) {
    const p0 = a[i - 1];
    const p1 = a[i];
    const segLen = dist(p0, p1);
    if (segLen === 0) continue;
    let d = step - carry;
    while (d <= segLen) {
      const t = d / segLen;
      const p = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
      const q = nearestOnLine(p, b);
      out.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
      d += step;
    }
    carry = segLen - (d - step);
  }
  out.push(a[a.length - 1]);
  return out;
}

/** 移动平均平滑 */
function smooth(line, win = 5) {
  const half = Math.floor(win / 2);
  return line.map((p, i) => {
    const seg = line.slice(Math.max(0, i - half), Math.min(line.length, i + half + 1));
    return [seg.reduce((s, q) => s + q[0], 0) / seg.length, seg.reduce((s, q) => s + q[1], 0) / seg.length];
  });
}

/** 米制 Douglas-Peucker */
function simplify(line, tol) {
  if (line.length <= 2) return line.slice();
  const a = line[0];
  const b = line[line.length - 1];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const q = nearestOnLine(line[i], [a, b]);
    const d = dist(line[i], q);
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
    if (d < 0.1) {
      out.push(...p.slice(1));
    } else if (d < 60) {
      const mid = [(last[0] + p[0][0]) / 2, (last[1] + p[0][1]) / 2];
      out[out.length - 1] = mid;
      out.push(...p.slice(1));
      seams.push({ label, d: Number(d.toFixed(1)), mid: mid.map((v) => Number(v.toFixed(6))) });
    } else {
      throw new Error(`${label} 接缝 ${d.toFixed(1)}m 超限`);
    }
  }
  return out;
}

const round6 = (pts) => pts.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);

const fc = read(DATA);
const byRoad = new Map(fc.features.map((f) => [f.properties.roadId, f]));
const partsOf = (f) => (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates);

// ---------- 幂等守卫 ----------
const huan = partsOf(byRoad.get("road_004"));
if (byRoad.get("road_003").geometry.type === "LineString") throw new Error("road_003 已是单段，无需重复执行");
if (partsOf(byRoad.get("road_038"))[0].some((p) => p[1] < 36.195)) throw new Error("road_038 已含南延段，无需重复执行");
if (huan.some((part) => part.some((p) => p[0] > 117.11 && p[0] < 117.115))) throw new Error("road_004 已补齐东段，无需重复执行");

const report = [];

// ---------- 1. 环山路 ----------
const huanParts = partsOf(byRoad.get("road_004"));
const huanSorted = huanParts.slice().sort((a, b) => Math.min(...a.map((p) => p[0])) - Math.min(...b.map((p) => p[0])));
// 现有: part0(117.056~117.104) part1(117.024~117.053) part2(117.126~117.173) part3(117.119~117.125)
const p0 = huanSorted.find((p) => Math.max(...p.map((q) => q[0])) < 117.11 && Math.min(...p.map((q) => q[0])) > 117.05);
const p3 = huanSorted.find((p) => Math.max(...p.map((q) => q[0])) < 117.126 && Math.min(...p.map((q) => q[0])) > 117.11);
const p2 = huanSorted.find((p) => Math.max(...p.map((q) => q[0])) > 117.17);
if (!p0 || !p3 || !p2) throw new Error("环山路段落识别失败");

const gapHuan = build([1104558888, 39040021, 1127420829], p0[p0.length - 1]);
report.push({ road: "环山路", gap: "117.10398→117.11935", gapKm: (lineLen(gapHuan) / 1000).toFixed(2), ways: "1104558888/39040021/1127420829" });
const mergedHuan = round6(join([p0, gapHuan, p3, p2], "环山路"));
const huanNewParts = [mergedHuan, huanSorted.find((p) => Math.max(...p.map((q) => q[0])) < 117.056)];
byRoad.get("road_004").geometry = { type: "MultiLineString", coordinates: huanNewParts };

// ---------- 2. 擂鼓石大街 ----------
const psjParts = partsOf(byRoad.get("road_003")).slice().sort((a, b) => Math.min(...a.map((p) => p[0])) - Math.min(...b.map((p) => p[0])));
const [psjW, psjE] = psjParts;
const gapSingle = build([135896227, 136913840, 376040026, 1216150800], psjW[psjW.length - 1]);
const up = orient(1095897368, gapSingle[gapSingle.length - 1]);
const down = orient(1095897369, gapSingle[gapSingle.length - 1]);
const gapDual = midline(up, down, 8);
const gapPsj = round6(simplify(smooth(gapDual, 5), 0.6));
const psjGapKm = (lineLen(gapSingle) + lineLen(gapPsj)) / 1000;
report.push({ road: "擂鼓石大街", gap: "117.14248→117.15424", gapKm: psjGapKm.toFixed(2), ways: "135896227/136913840/376040026/1216150800/1095897368+1095897369(双线取中)" });
const mergedPsj = round6(join([psjW, gapSingle, gapPsj, psjE], "擂鼓石大街"));
byRoad.get("road_003").geometry = { type: "LineString", coordinates: mergedPsj };

// ---------- 3. 天烛峰路 ----------
const tz = partsOf(byRoad.get("road_038"))[0];
const aLine = build([246812259, 136913564], tz[tz.length - 1]); // 北→南
const bLine = build([375335690, 387995106, 1047604509], aLine[0]);
const tzGapRaw = midline(aLine, bLine, 8);
const tzGap = round6(simplify(smooth(tzGapRaw, 3), 0.8));
report.push({ road: "天烛峰路", gap: "36.20016→36.19361（接东岳大街）", gapKm: (lineLen(tzGap) / 1000).toFixed(2), ways: "246812259+136913564 / 375335690+387995106+1047604509（双线取中）" });
const mergedTz = round6(join([tz, tzGap], "天烛峰路"));
byRoad.get("road_038").geometry = { type: "LineString", coordinates: mergedTz };

// ---------- 汇总 ----------
console.log("=== 补线明细 ===");
for (const r of report) console.log(`${r.road}: ${r.gap} ${r.gapKm} km  依据 ${r.ways}`);
console.log("\n=== 接缝归一 ===");
for (const s of seams) console.log(`${s.label}: ${s.d} m -> ${s.mid.join(", ")}`);

for (const id of ["road_003", "road_004", "road_038"]) {
  const f = byRoad.get(id);
  const parts = partsOf(f);
  const total = parts.reduce((s, p) => s + lineLen(p), 0);
  console.log(`\n[${id}] ${f.properties.name} ${f.geometry.type} parts=${parts.length} pts=${parts.flat().length} len=${(total / 1000).toFixed(2)}km`);
  parts.forEach((p, i) => console.log(`  part${i}: ${p.length}pts ${(lineLen(p) / 1000).toFixed(2)}km A=${p[0]} B=${p[p.length - 1]}`));
}

if (!WRITE) {
  console.log("\n(dry-run，未写盘)");
  process.exit(0);
}

const notes = {
  road_004: "；2026-10-25 补齐东段缺口 1.44 km（OSM name=环山路东段，即底图标注的「环山东路」：way 1104558888/39040021/1127420829），并与东段、北段接缝归一",
  road_003: "；2026-10-25 补齐中段缺口 1.14 km（OSM 无名 residential/secondary：135896227/136913840/376040026/1216150800 + 1095897368/1095897369 双线取中），与东段「擂鼓石东大街」合并为一条",
  road_038: "；2026-10-25 补齐南延 0.73 km（OSM 无名 primary/trunk 双线 246812259+136913564 / 375335690+387995106+1047604509 取中点，南端接东岳大街）",
};
for (const [id, note] of Object.entries(notes)) {
  byRoad.get(id).properties.note = (byRoad.get(id).properties.note || "") + note;
}

const backup = `${process.env.TEMP}\\roads_before_northeast.geojson`;
fs.writeFileSync(backup, fs.readFileSync(DATA));
fs.writeFileSync(DATA, `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`);
console.log(`\n已写入 ${DATA}（备份 ${backup}）`);
