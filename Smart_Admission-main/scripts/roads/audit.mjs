#!/usr/bin/env node
/**
 * roads/audit.mjs - 路网数据体检（P0）
 *
 * 只读脚本：不修改 data/roads.geojson，按《路网数据补全清单-交付版》的判定方法
 * 统计 A/B/C/D/E/F/G 七类问题，输出到 reports/roads-audit-<日期>.json。
 *
 * 用法：
 *   node scripts/roads/audit.mjs            # 打印汇总 + 写报告
 *   node scripts/roads/audit.mjs --check    # 按验收标准 I-1~I-7 判定，失败则退出码 1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ROADS = path.join(ROOT, "data/roads.geojson");
const REPORT_DIR = path.join(ROOT, "reports");
const CHECK = process.argv.includes("--check");

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
const len = (p) => p.reduce((s, q, i) => (i ? s + dd(p[i - 1], q) : 0), 0);
const densify = (line, step) => {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const d = dd(line[i - 1], line[i]);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([
        line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
        line[i - 1][1] + t * (line[i][1] - line[i - 1][1]),
      ]);
    }
  }
  return out;
};

/** 文档 C 类的基准名称表（清单有、数据缺失的线） */
const REQUIRED_LINES = [
  "白玉堂街",
  "大官庄街",
  "岱阳大街",
  "法院街",
  "韩家结庄村委西路",
  "惠丰园西小路",
  "金山东街",
  "金山东巷",
  "金山西街",
  "三里北街",
  "上高东路",
  "盛和路",
  "十五号路",
  "堰东路",
  "堰岭环路",
  "迎暄大街",
  "优山美地西邻路",
  "大众桥",
  "下河桥",
];
/** 文档 A1/A2/A3 基准（用于比对实际断口是否与清单一致） */
const BOUNDS = { minLng: 116.85, maxLng: 117.3, minLat: 35.85, maxLat: 36.35 };
const EXPECTED = {
  A: 11,
  BIntra: 13,
  BCross: 3,
  C: 19,
  D: 13,
  E: 4,
  F: 2,
  G: 48,
};

const fc = JSON.parse(fs.readFileSync(ROADS, "utf8"));
const feats = fc.features.map((f, index) => {
  const segs =
    f.geometry.type === "MultiLineString"
      ? f.geometry.coordinates
      : [f.geometry.coordinates];
  return {
    index,
    name: f.properties.name,
    type: f.properties.type,
    dataStatus: f.properties.dataStatus,
    segs,
    props: f.properties,
  };
});

/* ---------- 空间网格（索引采样点与顶点） ---------- */
const CELL = 0.0005; // 约 50m
const key = (p) => `${Math.floor(p[0] / CELL)}:${Math.floor(p[1] / CELL)}`;
const buildIndex = (items) => {
  const grid = new Map();
  for (const it of items) {
    const k = key(it.p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(it);
  }
  return grid;
};
const neighbors = (grid, p) => {
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  const out = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(`${cx + dx}:${cy + dy}`);
      if (arr) out.push(...arr);
    }
  return out;
};

/* ---------- A. 线中断：同一要素内部端点 30m 聚类 ---------- */
const A = [];
for (const f of feats) {
  if (f.segs.length < 2) continue;
  const eps = [];
  f.segs.forEach((s, si) => {
    eps.push({ si, p: s[0] });
    eps.push({ si, p: s[s.length - 1] });
  });
  const parent = eps.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < eps.length; i++)
    for (let j = i + 1; j < eps.length; j++) {
      if (dd(eps[i].p, eps[j].p) <= 30) parent[find(i)] = find(j);
    }
  const groups = new Map();
  eps.forEach((e, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(e.p);
  });
  if (groups.size < 2) continue;
  let minGap = Infinity;
  const roots = [...groups.keys()];
  for (let i = 0; i < roots.length; i++)
    for (let j = i + 1; j < roots.length; j++) {
      for (const a of groups.get(roots[i]))
        for (const b of groups.get(roots[j]))
          minGap = Math.min(minGap, dd(a, b));
    }
  A.push({ name: f.name, clusters: groups.size, minGap: Math.round(minGap) });
}
A.sort((a, b) => b.minGap - a.minGap);

/* ---------- B. 重复双线：20m 采样，40m 邻域 ---------- */
const samples = [];
const partCount = new Map();
const featCount = new Map();
for (const f of feats) {
  f.segs.forEach((s, si) => {
    if (s.length < 2) return;
    const pts = densify(s, 20);
    for (const p of pts)
      samples.push({ p, fi: f.index, si, name: f.name, type: f.type });
    partCount.set(`${f.index}|${si}`, pts.length);
    featCount.set(f.index, (featCount.get(f.index) || 0) + pts.length);
  });
}
const sampleGrid = buildIndex(samples.map((s, i) => ({ p: s.p, iid: i })));
const pairMap = new Map();
for (let i = 0; i < samples.length; i++) {
  const smp = samples[i];
  for (const nb of neighbors(sampleGrid, smp.p)) {
    if (nb.iid === i) continue;
    const other = samples[nb.iid];
    if (other.type !== smp.type) continue;
    const d = dd(smp.p, other.p);
    if (d > 40) continue;
    let kk, meta;
    if (smp.fi === other.fi) {
      const [a, b] = [Math.min(smp.si, other.si), Math.max(smp.si, other.si)];
      if (a === b) continue;
      kk = `i|${smp.fi}|${a}|${b}`;
      meta = {
        cross: false,
        fiA: smp.fi,
        siA: a,
        fiB: smp.fi,
        siB: b,
        nameA: smp.name,
        nameB: other.name,
      };
    } else {
      const [a, b] = [Math.min(smp.fi, other.fi), Math.max(smp.fi, other.fi)];
      kk = `c|${a}|${b}`;
      meta = {
        cross: true,
        fiA: a,
        siA: -1,
        fiB: b,
        siB: -1,
        nameA: feats[a].name,
        nameB: feats[b].name,
      };
    }
    if (!pairMap.has(kk))
      pairMap.set(kk, {
        ...meta,
        dsum: 0,
        cnt: 0,
        dmin: Infinity,
        hitA: new Set(),
        hitB: new Set(),
      });
    const rec = pairMap.get(kk);
    rec.dsum += d;
    rec.cnt += 1;
    rec.dmin = Math.min(rec.dmin, d);
    const myKey = `${smp.fi}|${smp.si}`;
    const isA =
      `${rec.fiA}|${rec.siA}` === myKey || (rec.cross && smp.fi === rec.fiA);
    (isA ? rec.hitA : rec.hitB).add(i);
  }
}
const B = [];
for (const rec of pairMap.values()) {
  const denA = rec.cross
    ? featCount.get(rec.fiA)
    : partCount.get(`${rec.fiA}|${rec.siA}`);
  const denB = rec.cross
    ? featCount.get(rec.fiB)
    : partCount.get(`${rec.fiB}|${rec.siB}`);
  const ratio = Math.max(
    rec.hitA.size / Math.max(1, denA),
    rec.hitB.size / Math.max(1, denB),
  );
  const overlapM = 20 * Math.min(rec.hitA.size, rec.hitB.size);
  if (ratio < 0.3 || overlapM < 300) continue;
  B.push({
    a: rec.nameA,
    b: rec.nameB,
    cross: rec.cross,
    ratio: Math.round(ratio * 100),
    avgGap: Math.round(rec.dsum / Math.max(1, rec.cnt)),
    minGap: Math.round(rec.dmin),
    overlapM: Math.round(overlapM),
    overlapKm: rec.cross
      ? null
      : +(
          Math.min(
            len(feats[rec.fiA].segs[rec.siA]),
            len(feats[rec.fiB].segs[rec.siB]),
          ) / 1000
        ).toFixed(2),
  });
}
B.sort((a, b) => b.ratio - a.ratio);
const BIntra = B.filter((b) => !b.cross);
const BCross = B.filter((b) => b.cross);

/* ---------- C. 清单有、数据缺失 ---------- */
const names = new Set(feats.map((f) => f.name));
const C = REQUIRED_LINES.filter((n) => !names.has(n));

/* ---------- D. 示意线 / E. 退化线 ---------- */
const D = feats
  .filter((f) => f.dataStatus === "estimated")
  .map((f) => ({
    name: f.name,
    vertices: f.segs.reduce((s, p) => s + p.length, 0),
    km: +(f.segs.reduce((s, p) => s + len(p), 0) / 1000).toFixed(2),
  }));
/* 等距模板线：3–10 个顶点、长度 >300m、相邻段长变异系数 <0.05。
   真实 OSM 几何即使顶点稀疏，段长差异也远大于此阈值（实测 ≥0.47）。 */
const segStats = (pts) => {
  if (pts.length < 3) return null;
  const ds = [];
  for (let i = 1; i < pts.length; i++) ds.push(dd(pts[i - 1], pts[i]));
  const total = ds.reduce((s, d) => s + d, 0);
  const avg = total / ds.length;
  if (!avg) return null;
  const cv =
    Math.sqrt(ds.reduce((s, d) => s + (d - avg) ** 2, 0) / ds.length) / avg;
  return { total, cv };
};
const templateLines = [];
const longSegments = [];
for (const f of feats) {
  for (const [pi, s] of f.segs.entries()) {
    const st = segStats(s);
    if (st && st.total > 300 && st.cv < 0.05) {
      templateLines.push({
        name: f.name,
        dataStatus: f.dataStatus,
        pi,
        vertices: s.length,
        km: +(st.total / 1000).toFixed(2),
        cv: +st.cv.toFixed(4),
      });
    }
    if (f.type === "道路") {
      let maxSeg = 0;
      for (let i = 1; i < s.length; i++)
        maxSeg = Math.max(maxSeg, dd(s[i - 1], s[i]));
      if (maxSeg > 400)
        longSegments.push({
          name: f.name,
          pi,
          maxSeg: Math.round(maxSeg),
          vertices: s.length,
        });
    }
  }
}
const templateLike = templateLines;
const E = feats
  .filter((f) => f.segs.reduce((s, p) => s + p.length, 0) === 2)
  .map((f) => f.name);

/* ---------- F. 坐标越界 ---------- */
const F = [];
for (const f of feats) {
  let out = 0;
  let far = 0;
  for (const s of f.segs)
    for (const [lng, lat] of s) {
      if (
        lng < BOUNDS.minLng ||
        lng > BOUNDS.maxLng ||
        lat < BOUNDS.minLat ||
        lat > BOUNDS.maxLat
      ) {
        out++;
        far = Math.max(
          far,
          Math.abs(lng - (BOUNDS.minLng + BOUNDS.maxLng) / 2),
        );
      }
    }
  if (out)
    F.push({
      name: f.name,
      outPoints: out,
      farthestLngOffset: +far.toFixed(4),
    });
}

/* ---------- G. 端点悬空（40m 内接不上其他要素的线） ---------- */
const vertexGrid = buildIndex(
  feats.flatMap((f) =>
    f.segs.flatMap((s) => s.map((p) => ({ p, fi: f.index }))),
  ),
);
let G = 0;
const GD = [];
for (const f of feats) {
  let dangling = 0;
  for (const s of f.segs)
    for (const p of [s[0], s[s.length - 1]]) {
      const near = neighbors(vertexGrid, p).some(
        (v) => v.fi !== f.index && dd(v.p, p) <= 40,
      );
      if (!near) dangling++;
    }
  if (dangling) {
    G++;
    GD.push({ name: f.name, dangling });
  }
}

/* ---------- 汇总 ---------- */
const summary = {
  generatedAt: new Date().toISOString(),
  file: "data/roads.geojson",
  features: feats.length,
  segments: feats.reduce((s, f) => s + f.segs.length, 0),
  points: feats.reduce(
    (s, f) => s + f.segs.reduce((t, p) => t + p.length, 0),
    0,
  ),
  counts: {
    A: A.length,
    BIntra: BIntra.length,
    BCross: BCross.length,
    C: C.length,
    D: D.length,
    E: E.length,
    F: F.length,
    G,
  },
  expected: EXPECTED,
  A,
  BIntra,
  BCross,
  C,
  D,
  templateLike,
  longSegments,
  E,
  F,
  G: GD,
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
const stamp = summary.generatedAt.slice(0, 10).replace(/-/g, "");
const outFile = path.join(REPORT_DIR, `roads-audit-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n", "utf8");

const rows = [
  ["A 线中断", EXPECTED.A, A.length],
  ["B1 要素内双线组", EXPECTED.BIntra, BIntra.length],
  ["B2 跨要素双线组", EXPECTED.BCross, BCross.length],
  ["C 清单缺线", EXPECTED.C, C.length],
  ["D 示意线", EXPECTED.D, D.length],
  ["E 两点退化线", EXPECTED.E, E.length],
  ["F 坐标越界", EXPECTED.F, F.length],
  ["G 端点悬空线", EXPECTED.G, G],
];
console.log(
  `文件 ${summary.features} 要素 / ${summary.segments} 段 / ${summary.points} 点`,
);
console.log("类别            清单  实际  偏差");
for (const [label, exp, act] of rows) {
  const dev = exp ? Math.round(((act - exp) / exp) * 100) : 0;
  const flag = Math.abs(dev) > 20 ? " ⚠️超20%" : "";
  console.log(
    `${label.padEnd(14)} ${String(exp).padStart(4)} ${String(act).padStart(5)} ${String(dev).padStart(5)}%${flag}`,
  );
}
console.log(`\n报告：${path.relative(ROOT, outFile)}`);
console.log("\nA 类前 6 条（断口）:");
A.slice(0, 6).forEach((x) =>
  console.log(`  ${x.name}: ${x.clusters} 簇，最近 ${x.minGap} m`),
);
console.log("\nB 类重合度前 8 组:");
B.slice(0, 8).forEach((x) =>
  console.log(
    `  ${x.a} ↔ ${x.b}${x.cross ? "（跨要素）" : ""}: ${x.ratio}% 平均 ${x.avgGap}m`,
  ),
);
if (C.length) console.log(`\nC 类仍缺失 ${C.length} 条: ${C.join("、")}`);
if (templateLike.length)
  console.log(
    `\n等距模板线（硬门禁对象）: ${templateLike.map((x) => `${x.name}(${x.vertices}点/${x.km}km)`).join("、")}`,
  );
if (longSegments.length)
  console.log(
    `\n单段 >400m 告警: ${longSegments.map((x) => `${x.name} ${x.maxSeg}m`).join("、")}`,
  );

if (CHECK) {
  const fail = [];
  if (BIntra.length || BCross.length)
    fail.push(`I-2 仍有 ${BIntra.length + BCross.length} 组双线`);
  if (A.some((x) => x.minGap > 30))
    fail.push(
      `I-1 有 ${A.filter((x) => x.minGap > 30).length} 条同要素多段间距 >30m`,
    );
  if (F.length) fail.push(`I-4 ${F.length} 条坐标越界`);
  if (templateLike.length)
    fail.push(
      `I-7 有 ${templateLike.length} 条等距模板线：${templateLike.map((x) => x.name).join("、")}`,
    );
  if (fail.length) {
    console.error(`\n❌ 验收未通过：\n- ${fail.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\n✅ I-1/I-2/I-4/I-7 验收通过");
}
