/**
 * fill-tongtian.mjs — 补齐通天街南端缺线
 *
 * 通天街（road_032）南端止于 117.12641,36.18331，OSM 上无名 secondary 双线
 * （1087914567 / 1087914568）继续向南至南关大街北端 117.12696,36.17651，缺 0.76 km。
 * 几何取自 OpenStreetMap（out geom），双线逐 8 m 取中点后平滑抽稀。
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

const osm = JSON.parse(fs.readFileSync("C:/Users/29114/AppData/Local/Temp/osm_tongtian.json", "utf8"));
const geo = (id) => {
  const el = osm.elements.find((e) => e.id === id);
  if (!el) throw new Error(`缺少 OSM way ${id}`);
  return el.geometry.map((p) => [p.lon, p.lat]);
};

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

const round6 = (pts) => pts.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);

const fc = JSON.parse(fs.readFileSync(DATA, "utf8"));
const road = fc.features.find((f) => String(f.properties.roadId) === "road_032");
if (!road) throw new Error("缺少 road_032 通天街");
const old = road.geometry.coordinates;
const south = old[0];
if (south[1] < 36.18) throw new Error("通天街已南延，无需重复执行");

const up = geo(1087914567); // 南→北
const down = geo(1087914568).slice().reverse(); // 北→南，统一成南→北
const ext = round6(simplify(smooth(midline(up, down, 8), 5), 0.8));

// 接缝：ext 北端应等于通天街南端；南端落到南关大街北端
const seamN = dist(ext[ext.length - 1], south);
const mergedNorth = ext.slice(0, -1);
const seam = [(ext[ext.length - 1][0] + south[0]) / 2, (ext[ext.length - 1][1] + south[1]) / 2];
const merged = round6([...mergedNorth, seam, ...old.slice(1)]);
const mergedSouth = merged[0];

console.log(`通天街南延 ${(lineLen(ext) / 1000).toFixed(2)} km，合并后 ${merged.length} 点`);
console.log(`  南端 ${mergedSouth}  →  南关大街北端 117.12696, 36.17651（相距 ${dist(mergedSouth, [117.12696, 36.17651]).toFixed(1)} m）`);
console.log(`  接缝 ${seamN.toFixed(1)} m -> ${seam.map((v) => v.toFixed(6)).join(", ")}`);

if (!WRITE) {
  console.log("\n(dry-run，未写盘)");
  process.exit(0);
}

road.geometry = { type: "LineString", coordinates: merged };
road.properties.note = (road.properties.note || "") +
  "；2026-10-25 南延 0.76 km 接南关大街（OSM 无名 secondary 双线 1087914567/1087914568 取中点）";

const backup = `${process.env.TEMP}\\roads_before_tongtian.geojson`;
fs.writeFileSync(backup, fs.readFileSync(DATA));
fs.writeFileSync(DATA, `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`);
console.log(`\n已写入 ${DATA}（备份 ${backup}）`);
