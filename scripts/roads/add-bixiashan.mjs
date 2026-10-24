/**
 * add-bixiashan.mjs - 新增安家林水库一带缺失的两条主干路
 *
 * 1) 泰明路（S103）：环山路东端路口 → 沿安家林水库西岸向北，上下行双线取中点
 * 2) 碧霞大街（S103，天地图标注「环山东路」）：环山路东端路口 → 东至博阳路，含东段无名 primary 双线
 *
 * 几何全部取自 OpenStreetMap（out geom），双线按逐点最近点取中点后平滑抽稀。
 * 默认 dry-run，加 --write 落盘。
 */
import fs from "node:fs";

const ROOT = "c:/Users/29114/Desktop/123/Smart_Admission";
const DATA = `${ROOT}/data/roads.geojson`;
const WRITE = process.argv.includes("--write");

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const json = read("C:/Users/29114/AppData/Local/Temp/osm_east_highways.json");
const byId = new Map();
for (const el of json.elements) byId.set(el.id, (el.geometry || []).map((p) => [p.lon, p.lat]));

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
    const d = Math.hypot(px - ax * t, py - ay * t);
    if (!best || d < best.d) best = { d, q: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
  }
  return best.q;
}

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
    const d = dist(line[i], nearestOnLine(line[i], [a, b]));
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

const fc = read(DATA);
if (fc.features.some((f) => f.properties.name === "泰明路" || f.properties.name === "碧霞大街")) {
  throw new Error("泰明路或碧霞大街已存在，无需重复执行");
}
const IDs = fc.features.map((f) => f.properties.roadId).filter((id) => /^road_\d+$/.test(id));
let next = Math.max(...IDs.map((id) => Number(id.slice(5)))) + 1;
const junction = [117.17258, 36.22928];

// ---------- 1. 泰明路（上下行双线取中点） ----------
const tmWest = build([39040022], junction, "泰明路西幅");
const tmEast = build([1111922369, 246812265], junction, "泰明路东幅");
const tmLine = round6(simplify(smooth(midline(tmWest, tmEast, 8), 5), 0.8));
tmLine[0] = [117.172585, 36.22928];

// ---------- 2. 碧霞大街（含东段无名 primary 双线） ----------
const bxNamed = build([1095937431, 377410899, 1095897350, 676825213, 676825217], junction, "碧霞大街");
const unnamedNorth = build([1085631678], bxNamed[bxNamed.length - 1], "碧霞大街东延北幅");
const unnamedSouth = build([1085631677], bxNamed[bxNamed.length - 1], "碧霞大街东延南幅");
const bxTail = midline(unnamedNorth, unnamedSouth, 8);
const bxLine = round6(simplify(smooth([...bxNamed, ...bxTail.slice(1)], 3), 0.8));
bxLine[0] = [117.172585, 36.22928];

const mkFeature = (id, name, coords, note) => ({
  type: "Feature",
  properties: {
    roadId: id,
    name,
    type: "道路",
    important: true,
    dataStatus: "osm",
    note,
  },
  geometry: { type: "LineString", coordinates: coords },
});

const tmFeature = mkFeature(next++, "泰明路", tmLine,
  "OSM primary（S103）上下行双线（39040022/1111922369 与 246812265）逐 8 m 取中点合并为中心线，南起环山路东端路口 36.2293、北至 36.2472 (© OpenStreetMap contributors, ODbL)");
const bxFeature = mkFeature(next++, "碧霞大街", bxLine,
  "OSM primary（S103，天地图标注为「环山东路」）1095937431/377410899/1095897350/676825213/676825217 + 东段无名 primary 双线 1085631677/1085631678 取中点，西起环山路东端路口、东至博阳路 (© OpenStreetMap contributors, ODbL)");

for (const f of [tmFeature, bxFeature]) {
  const p = f.geometry.coordinates;
  console.log(`[${f.properties.roadId}] ${f.properties.name}: ${p.length} 点 / ${(lineLen(p) / 1000).toFixed(2)} km  A=${p[0]} B=${p[p.length - 1]}`);
}

if (!WRITE) {
  console.log("\n(dry-run，未写盘)");
  process.exit(0);
}

fc.features.push(tmFeature, bxFeature);
const backup = `${process.env.TEMP}\\roads_before_bixiashan.geojson`;
fs.writeFileSync(backup, fs.readFileSync(DATA));
fs.writeFileSync(DATA, `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`);
console.log(`\n已写入 ${DATA}（备份 ${backup}）`);
