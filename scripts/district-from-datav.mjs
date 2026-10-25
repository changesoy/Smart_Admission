#!/usr/bin/env node
/**
 * district-from-datav.mjs - 用阿里云 DataV 区界替换 district.geojson
 *
 * 背景：DataV 的 370902 边界来自高德，坐标是 GCJ-02；天地图底图、路网与学区
 *       均为 WGS84。直接叠加会整体东偏约 545 m，必须先做 GCJ-02 → WGS84 反算。
 *
 * 用法：
 *   node scripts/district-from-datav.mjs           # dry-run：只打印统计与偏差
 *   node scripts/district-from-datav.mjs --write   # 写 data/district.geojson
 *
 * 网络不通时回退读取 reports/datav-370902.json（本地缓存，reports/ 已被 gitignore）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/district.geojson");
const CACHE = path.join(ROOT, "reports/datav-370902.json");
const URL_DATA = "https://geo.datav.aliyun.com/areas_v3/bound/370902.json";
const WRITE = process.argv.includes("--write");

const GCJ_A = 6378245.0;
const EE = 0.006693421622965943;

const tLat = (x, y) => {
  let r =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  r +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r +=
    ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) *
      2) /
    3;
  return r;
};

const tLng = (x, y) => {
  let r =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r +=
    ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) *
      2) /
    3;
  return r;
};

const wgs2gcj = (lng, lat) => {
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLat0 = tLat(lng - 105, lat - 35);
  const dLng0 = tLng(lng - 105, lat - 35);
  const dLat =
    (dLat0 * 180) / (((GCJ_A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  const dLng =
    (dLng0 * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
};

const gcj02ToWgs84 = (lng, lat) => {
  let wl = lng;
  let wa = lat;
  for (let i = 0; i < 12; i += 1) {
    const [gl, ga] = wgs2gcj(wl, wa);
    const dl = lng - gl;
    const da = lat - ga;
    wl += dl;
    wa += da;
    if (Math.abs(dl) < 1e-10 && Math.abs(da) < 1e-10) break;
  }
  return [wl, wa];
};

const round7 = (v) => Number(v.toFixed(7));
const convert = (p) => gcj02ToWgs84(p[0], p[1]).map(round7);

// ---------- 几何小工具（与前端比对页同口径） ----------
const rad = (d) => (d * Math.PI) / 180;
const LAT0 = 36.19;
const KX = 111320 * Math.cos(rad(LAT0));
const KY = 111320;
const toXY = (p) => [p[0] * KX, p[1] * KY];

const segDist = (p, a, b) => {
  const P = toXY(p);
  const A = toXY(a);
  const B = toXY(b);
  const vx = B[0] - A[0];
  const vy = B[1] - A[1];
  const l2 = vx * vx + vy * vy;
  const t =
    l2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / l2),
        );
  return Math.hypot(P[0] - (A[0] + t * vx), P[1] - (A[1] + t * vy));
};

const distToRing = (p, ring) => {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const d = segDist(p, ring[i], ring[i + 1]);
    if (d < best) best = d;
  }
  return best;
};

const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = toXY(ring[i]);
    const [x2, y2] = toXY(ring[i + 1]);
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

const ringLength = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = toXY(ring[i]);
    const [x2, y2] = toXY(ring[i + 1]);
    sum += Math.hypot(x2 - x1, y2 - y1);
  }
  return sum;
};

const quantile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

const readJson = (p) =>
  JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const crlf = (obj) =>
  `${JSON.stringify(obj, null, 2)}\n`.replace(/\n/g, "\r\n");

const loadDataV = async () => {
  try {
    const res = await fetch(URL_DATA);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    fs.writeFileSync(CACHE, JSON.stringify(json), "utf8");
    console.log("数据源 : DataV 在线获取");
    return json;
  } catch (e) {
    console.log(`数据源 : 在线获取失败（${e.message}），回退本地缓存`);
    return readJson(CACHE);
  }
};

const main = async () => {
  const dv = await loadDataV();
  const feature = dv.features.find(
    (f) => f.properties && Number(f.properties.adcode) === 370902,
  );
  if (!feature) throw new Error("DataV 响应里找不到 adcode=370902 的要素");

  const geom = feature.geometry;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const wgsPolys = polys.map((rings) => rings.map((ring) => ring.map(convert)));

  const [[outer]] = wgsPolys;
  const totalArea = wgsPolys.reduce(
    (sum, rings) =>
      sum +
      ringArea(rings[0]) -
      rings.slice(1).reduce((h, r) => h + ringArea(r), 0),
    0,
  );

  const openRing = outer.find(
    (p, i) => i > 0 && p[0] === outer[0][0] && p[1] === outer[0][1],
  );
  if (!openRing) throw new Error("外环首尾未闭合");

  const out = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          areaId: "taishan_district",
          name: "泰山区",
          adcode: "370902",
          level: "district",
          dataStatus: "datav",
          note:
            "泰山区行政区划边界，取自阿里云 DataV areas_v3/bound/370902.json（高德 GCJ-02），" +
            "已按标准算法反算为 WGS84 并与天地图底图对齐。仅作区县示意与交点计算基准，不作勘界依据。",
        },
        geometry: {
          type: polys.length === 1 ? "Polygon" : "MultiPolygon",
          coordinates: polys.length === 1 ? wgsPolys[0] : wgsPolys,
        },
      },
    ],
  };

  // ---------- 与现行 district.geojson 比对 ----------
  const cur = readJson(OUT);
  const [curRing] = cur.features[0].geometry.coordinates;
  const devs = curRing.map((p) => distToRing(p, outer)).sort((a, b) => a - b);

  console.log(
    `顶点   : ${outer.length}（闭合环），面积 ${(totalArea / 1e6).toFixed(2)} km²，周长 ${(ringLength(outer) / 1000).toFixed(2)} km`,
  );
  console.log(
    `现行环 : ${curRing.length} 顶点，面积 ${(ringArea(curRing) / 1e6).toFixed(2)} km²`,
  );
  console.log(
    `现行顶点到新环：p50 ${quantile(devs, 0.5).toFixed(0)}m / p90 ${quantile(devs, 0.9).toFixed(0)}m / max ${devs[devs.length - 1].toFixed(0)}m`,
  );
  const lngs = outer.map((p) => p[0]);
  const lats = outer.map((p) => p[1]);
  console.log(
    `范围   : 经 ${Math.min(...lngs).toFixed(5)} ~ ${Math.max(...lngs).toFixed(5)} / 纬 ${Math.min(...lats).toFixed(5)} ~ ${Math.max(...lats).toFixed(5)}`,
  );

  if (!WRITE) {
    console.log("dry-run：未写入。加 --write 落盘到 data/district.geojson");
    return;
  }
  fs.writeFileSync(OUT, crlf(out), "utf8");
  console.log(`✅ 已写入 ${path.relative(ROOT, OUT)}（CRLF）`);
};

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
