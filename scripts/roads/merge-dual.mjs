#!/usr/bin/env node
/**
 * roads/merge-dual.mjs - 台帐双线合并（P1）
 *
 * 处理《路网数据补全清单-交付版》B 类问题：
 *   B1 同一要素内部两条并行副本（同一条路被拆成上下行两条线）
 *   B2 跨要素整体重合（同一模板线画了两遍）
 *
 * 默认 dry-run：只分析并输出 reports/roads-merge-dual-<日期>.json，不改数据。
 * 加 --write 才落盘；跨要素删除需显式给出名字（--delete=环山东路），避免误删。
 *
 * 用法：
 *   node scripts/roads/merge-dual.mjs
 *   node scripts/roads/merge-dual.mjs --write
 *   node scripts/roads/merge-dual.mjs --write --delete=环山东路
 *
 * 判定口径与 audit.mjs 的 B 类一致：每 20m 采样、40m 邻域；覆盖率 ≥85% 判副本。
 * 保留策略：整段删除被完全覆盖的一侧（single-side），不做中点平均，
 * 避免新线整体偏移导致与交叉道路的接点错位。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const REPORT_DIR = path.join(ROOT, "reports");

const WRITE = process.argv.includes("--write");
const DELETE_ARG = process.argv.find((a) => a.startsWith("--delete="));
const DELETE_NAMES = DELETE_ARG
  ? DELETE_ARG.slice("--delete=".length).split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const STEP = 20; // 采样间距（m）
const NEAR = 40; // 邻域半径（m）
const MIN_COVER = 0.85; // 判为副本的覆盖率阈值
const CELL = 0.0005; // 网格边长（约 50m）

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const dd = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
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
const cellKey = (p) => `${Math.floor(p[0] / CELL)}:${Math.floor(p[1] / CELL)}`;
const buildGrid = (items) => {
  const grid = new Map();
  for (const it of items) {
    const k = cellKey(it.p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(it);
  }
  return grid;
};
const neighbors = (grid, p) => {
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(`${cx + dx}:${cy + dy}`);
      if (arr) out.push(...arr);
    }
  }
  return out;
};

const fc = JSON.parse(fs.readFileSync(ROADS, "utf8"));
const feats = fc.features.map((f) => ({
  feature: f,
  name: f.properties.name,
  type: f.properties.type,
  dataStatus: f.properties.dataStatus,
  segs: f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates],
}));

/* ---------- 要素内：逐段采样，统计两两覆盖率 ---------- */
const computePairs = (parts, dens) => {
  const items = [];
  dens.forEach((pts, pi) => pts.forEach((p, ii) => items.push({ p, pi, ii })));
  const grid = buildGrid(items);
  const rec = new Map();
  dens.forEach((pts, pi) => {
    pts.forEach((p, ii) => {
      for (const c of neighbors(grid, p)) {
        if (c.pi === pi) continue;
        const d = dd(p, c.p);
        if (d > NEAR) continue;
        const a = Math.min(pi, c.pi);
        const b = Math.max(pi, c.pi);
        const k = `${a}|${b}`;
        if (!rec.has(k)) rec.set(k, { a, b, hitA: new Set(), hitB: new Set(), dsum: 0, cnt: 0, dmin: Infinity });
        const r = rec.get(k);
        r.dsum += d;
        r.cnt += 1;
        r.dmin = Math.min(r.dmin, d);
        if (pi === a) {
          r.hitA.add(ii);
          r.hitB.add(c.ii);
        } else {
          r.hitB.add(ii);
          r.hitA.add(c.ii);
        }
      }
    });
  });
  return [...rec.values()].map((r) => ({
    a: r.a,
    b: r.b,
    coverA: r.hitA.size / Math.max(1, dens[r.a].length),
    coverB: r.hitB.size / Math.max(1, dens[r.b].length),
    avgGap: Math.round(r.dsum / Math.max(1, r.cnt)),
    minGap: Math.round(r.dmin),
  }));
};

/* ---------- 要素内：迭代剔除被完全覆盖的一侧 ---------- */
const planIntra = (f) => {
  if (f.segs.length < 2) return null;
  const parts = f.segs;
  const lengths = parts.map((p) => Math.round(len(p)));
  const active = new Set(parts.map((_, i) => i));
  const drops = [];

  for (let round = 0; round < parts.length; round++) {
    const ids = [...active];
    const dens = ids.map((i) => densify(parts[i], STEP));
    // computePairs 使用 active 内的局部索引，需要映射回原始下标
    const pairs = computePairs(ids.map((i) => parts[i]), dens);
    let best = null;
    for (const pr of pairs) {
      for (const side of ["a", "b"]) {
        const myLocal = side === "a" ? pr.a : pr.b;
        const otherLocal = side === "a" ? pr.b : pr.a;
        const cover = side === "a" ? pr.coverA : pr.coverB;
        const otherCover = side === "a" ? pr.coverB : pr.coverA;
        const myLen = lengths[ids[myLocal]];
        const otherLen = lengths[ids[otherLocal]];
        if (cover < MIN_COVER) continue;
        // 两侧互为副本时保留较长的一侧；长度相同则保留下标小的
        if (myLen > otherLen) continue;
        if (myLen === otherLen && ids[myLocal] < ids[otherLocal]) continue;
        if (!best || cover > best.cover || (cover === best.cover && myLen < best.len)) {
          best = {
            pi: ids[myLocal],
            cover: +cover.toFixed(3),
            refPi: ids[otherLocal],
            refCover: +otherCover.toFixed(3),
            avgGap: pr.avgGap,
            minGap: pr.minGap,
            lenM: myLen,
          };
        }
      }
    }
    if (!best) break;
    active.delete(best.pi);
    drops.push(best);
  }

  if (!drops.length) return null;
  return {
    name: f.name,
    type: f.type,
    partsBefore: parts.length,
    partsAfter: active.size,
    totalKm: +(lengths.reduce((s, x) => s + x, 0) / 1000).toFixed(2),
    drops,
    keep: [...active],
  };
};

const intra = [];
for (const f of feats) {
  if (f.type === "铁路") continue; // 双线铁路属真实并行轨道，交人工确认，不自动删
  const plan = planIntra(f);
  if (plan) intra.push(plan);
}

/* ---------- 跨要素：全量采样，按要素统计覆盖率 ---------- */
const allSamples = [];
feats.forEach((f, fi) => {
  f.segs.forEach((s, si) => {
    densify(s, STEP).forEach((p) => allSamples.push({ p, fi, si }));
  });
});
const globalGrid = buildGrid(allSamples.map((s, i) => ({ p: s.p, iid: i })));
const featCount = new Map();
allSamples.forEach((s) => featCount.set(s.fi, (featCount.get(s.fi) || 0) + 1));
const crossRec = new Map();
for (let i = 0; i < allSamples.length; i++) {
  const smp = allSamples[i];
  for (const c of neighbors(globalGrid, smp.p)) {
    if (c.iid === i) continue;
    const other = allSamples[c.iid];
    if (other.fi === smp.fi) continue;
    if (feats[other.fi].type !== feats[smp.fi].type) continue;
    const d = dd(smp.p, other.p);
    if (d > NEAR) continue;
    const a = Math.min(smp.fi, other.fi);
    const b = Math.max(smp.fi, other.fi);
    const k = `${a}|${b}`;
    if (!crossRec.has(k)) crossRec.set(k, { a, b, hitA: new Set(), hitB: new Set(), dsum: 0, cnt: 0, dmin: Infinity });
    const r = crossRec.get(k);
    r.dsum += d;
    r.cnt += 1;
    r.dmin = Math.min(r.dmin, d);
    if (smp.fi === a) {
      r.hitA.add(i);
      r.hitB.add(c.iid);
    } else {
      r.hitB.add(i);
      r.hitA.add(c.iid);
    }
  }
}
const cross = [];
for (const r of crossRec.values()) {
  const coverA = r.hitA.size / Math.max(1, featCount.get(r.a));
  const coverB = r.hitB.size / Math.max(1, featCount.get(r.b));
  const overlapM = STEP * Math.min(r.hitA.size, r.hitB.size);
  if (Math.max(coverA, coverB) < 0.3 || overlapM < 300) continue;
  const fa = feats[r.a];
  const fb = feats[r.b];
  const suggestion =
    coverA >= MIN_COVER && coverB >= MIN_COVER
      ? "两侧几乎完全重合：保留 osm 一侧，另一条待人工确认后删除"
      : coverA >= MIN_COVER
        ? `建议删除 ${fb.name}（被 ${fa.name} 覆盖）`
        : coverB >= MIN_COVER
          ? `建议删除 ${fa.name}（被 ${fb.name} 覆盖）`
          : "部分重合：需按影像确认是否真是并行两条街";
  cross.push({
    a: fa.name,
    b: fb.name,
    aStatus: fa.dataStatus,
    bStatus: fb.dataStatus,
    coverA: Math.round(coverA * 100),
    coverB: Math.round(coverB * 100),
    avgGap: Math.round(r.dsum / r.cnt),
    overlapM: Math.round(overlapM),
    suggestion,
  });
}
cross.sort((x, y) => y.overlapM - x.overlapM);

/* ---------- 报告 ---------- */
const summary = {
  generatedAt: new Date().toISOString(),
  file: "data/roads.geojson",
  mode: WRITE ? "write" : "dry-run",
  params: { stepM: STEP, nearM: NEAR, minCover: MIN_COVER },
  before: {
    features: feats.length,
    segments: feats.reduce((s, f) => s + f.segs.length, 0),
    points: feats.reduce((s, f) => s + f.segs.reduce((t, p) => t + p.length, 0), 0),
  },
  intra,
  cross,
  deletedFeatures: DELETE_NAMES,
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
const stamp = summary.generatedAt.slice(0, 10).replace(/-/g, "");
const reportFile = path.join(REPORT_DIR, `roads-merge-dual-${stamp}.json`);
fs.writeFileSync(reportFile, JSON.stringify(summary, null, 2) + "\n", "utf8");

/* ---------- 落盘 ---------- */
if (WRITE) {
  for (const plan of intra) {
    const f = feats.find((x) => x.name === plan.name && x.segs.length === plan.partsBefore);
    if (!f) continue;
    const kept = plan.keep.map((i) => f.segs[i]);
    const removedKm = (plan.drops.reduce((s, d) => s + d.lenM, 0) / 1000).toFixed(2);
    f.feature.geometry = { type: "MultiLineString", coordinates: kept };
    f.feature.properties.note = `${f.feature.properties.note}；P1 去除同路并行副本 ${plan.drops.length} 段（${removedKm} km）`;
  }
  if (DELETE_NAMES.length) {
    const keptFeatures = [];
    for (const feature of fc.features) {
      if (DELETE_NAMES.includes(feature.properties.name)) {
        console.log(`删除要素：${feature.properties.name}`);
        continue;
      }
      keptFeatures.push(feature);
    }
    fc.features = keptFeatures;
  }
  fs.writeFileSync(
    ROADS,
    JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n") + "\r\n",
    "utf8",
  );
}

/* ---------- 控制台摘要 ---------- */
console.log(
  `${summary.before.features} 要素 / ${summary.before.segments} 段 / ${summary.before.points} 点（${summary.mode}）`,
);
let droppedParts = 0;
let droppedKm = 0;
for (const plan of intra) {
  droppedParts += plan.drops.length;
  droppedKm += plan.drops.reduce((s, d) => s + d.lenM, 0) / 1000;
  console.log(
    `  ${plan.name}: ${plan.partsBefore} → ${plan.partsAfter} 段，删 ${plan.drops.length} 段 (${(
      plan.drops.reduce((s, d) => s + d.lenM, 0) / 1000
    ).toFixed(2)} km)`,
  );
  plan.drops.forEach((d) =>
    console.log(
      `      删 #${d.pi}  ${(d.lenM / 1000).toFixed(2)} km  覆盖 ${Math.round(d.cover * 100)}%  平均间距 ${d.avgGap} m`,
    ),
  );
}
console.log(
  `\n要素内：${intra.length} 条路涉及双线，共删 ${droppedParts} 段（${droppedKm.toFixed(2)} km）`,
);
if (intra.length) {
  const afterSegs =
    summary.before.segments - droppedParts + 0; // 段数减少量
  console.log(`段数 ${summary.before.segments} → ${afterSegs}`);
}

console.log(`\n跨要素双线 ${cross.length} 组（需人工确认）：`);
cross.forEach((c) =>
  console.log(
    `  ${c.a}(${c.aStatus}) ↔ ${c.b}(${c.bStatus})  重合 ${c.overlapM} m  覆盖 ${c.coverA}%/${c.coverB}%  平均 ${c.avgGap} m  → ${c.suggestion}`,
  ),
);

console.log(`\n报告：${path.relative(ROOT, reportFile)}`);
if (!WRITE) console.log("dry-run：未修改数据，确认后加 --write 落盘");
