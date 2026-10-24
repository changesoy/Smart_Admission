#!/usr/bin/env node
/**
 * roads/connect.mjs - 断口接续（P3）
 *
 * 处理《路网数据补全清单-交付版》A 类：同一要素被拆成多段、段间留有空档。
 * 做法：端点聚类 → 取最近的一对端点 → 校验两端走向与连线夹角 → 拼接成一条连续线。
 *
 * 阈值（与方案 P3 一致）：
 *   - 聚类半径 30m（端点相距 30m 内视为同一节点，不重复连）
 *   - 自动接续上限 300m（A3 <30m、A2 30–300m 走自动）
 *   - 走向夹角 ≤60°（两端外侧方向都要朝向对方，防止折返尖刺）
 *   >300m 的 A1 断口不自动接，输出到报告等人工/影像确认。
 *
 * 用法：
 *   node scripts/roads/connect.mjs            # dry-run，只出报告
 *   node scripts/roads/connect.mjs --write    # 落盘
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const REPORT_DIR = path.join(ROOT, "reports");

const WRITE = process.argv.includes("--write");
const CLUSTER_M = 30;
const AUTO_MAX_M = 300;
const MAX_ANGLE_DEG = 60;
const DIR_WINDOW_M = 100;

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const dd = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const len = (p) => p.reduce((s, q, i) => (i ? s + dd(p[i - 1], q) : 0), 0);

/** 端点外侧单位方向：从端点向线内走 100m，取反向向量 */
const outwardDir = (line, atStart) => {
  const n = line.length;
  const p0 = atStart ? line[0] : line[n - 1];
  let acc = 0;
  let i = atStart ? 1 : n - 2;
  let ref = p0;
  while (i >= 0 && i < n) {
    acc += dd(ref, line[i]);
    ref = line[i];
    if (acc >= DIR_WINDOW_M) break;
    i += atStart ? 1 : -1;
  }
  const vx = p0[0] - ref[0];
  const vy = p0[1] - ref[1];
  const norm = Math.hypot(vx, vy);
  return norm ? [vx / norm, vy / norm] : [0, 0];
};
/** 连线方向的两端夹角（度）：outward 与 p→q 的夹角 */
const connectorAngle = (outward, from, to) => {
  const vx = to[0] - from[0];
  const vy = to[1] - from[1];
  const norm = Math.hypot(vx, vy);
  if (!norm || (outward[0] === 0 && outward[1] === 0)) return 180;
  const cos = (outward[0] * vx + outward[1] * vy) / norm;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};

const fc = JSON.parse(fs.readFileSync(ROADS, "utf8"));
const feats = fc.features.map((f, index) => ({
  index,
  feature: f,
  name: f.properties.name,
  type: f.properties.type,
  segs: f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates],
}));

/** 端点记录：part 下标 + 是否起点 */
const endpointsOf = (parts) => {
  const eps = [];
  parts.forEach((line, pi) => {
    eps.push({ pi, atStart: true, p: line[0] });
    eps.push({ pi, atStart: false, p: line[line.length - 1] });
  });
  return eps;
};

/** 端点聚类的连通分量（并查集，半径 30m） */
const clustersOf = (eps) => {
  const parent = eps.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < eps.length; i++) {
    for (let j = i + 1; j < eps.length; j++) {
      if (dd(eps[i].p, eps[j].p) <= CLUSTER_M) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  eps.forEach((e, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(e);
  });
  return [...groups.values()];
};

/** 把两段按最近端点拼成一条线 */
const mergeParts = (a, b, aAtStart, bAtStart) => {
  const seqA = aAtStart ? [...a].reverse() : [...a];
  const seqB = bAtStart ? [...b] : [...b].reverse();
  const out = [...seqA];
  for (const p of seqB) {
    const last = out[out.length - 1];
    if (dd(last, p) < 0.5) continue;
    out.push(p);
  }
  return out;
};

const merges = [];
const blocked = [];
const pendingA1 = [];
const changedFeatures = new Set();

for (const f of feats) {
  if (f.segs.length < 2) continue;
  const parts = f.segs.map((s) => [...s]);
  let changed = true;
  let guard = 0;
  while (changed && guard < parts.length * 4) {
    changed = false;
    guard++;
    const eps = endpointsOf(parts);
    const groups = clustersOf(eps);
    if (groups.length < 2) break;

    // 所有跨簇端点对，按距离升序
    const cands = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        for (const ea of groups[i]) {
          for (const eb of groups[j]) {
            if (ea.pi === eb.pi) continue;
            const d = dd(ea.p, eb.p);
            if (d > AUTO_MAX_M) continue;
            cands.push({ d, ea, eb, gapClusters: groups.length });
          }
        }
      }
    }
    cands.sort((x, y) => x.d - y.d);

    let done = false;
    for (const c of cands) {
      const angA = connectorAngle(outwardDir(parts[c.ea.pi], c.ea.atStart), c.ea.p, c.eb.p);
      const angB = connectorAngle(outwardDir(parts[c.eb.pi], c.eb.atStart), c.eb.p, c.ea.p);
      const key = `${f.name}|${c.ea.pi}|${c.eb.pi}|${Math.round(c.d)}`;
      const blockedHit = blocked.find((b) => b.key === key);
      if (blockedHit) continue;
      if (angA > MAX_ANGLE_DEG || angB > MAX_ANGLE_DEG) {
        blocked.push({ key, name: f.name, gapM: Math.round(c.d), angA: Math.round(angA), angB: Math.round(angB) });
        continue;
      }
      // 拼接：把 eb 并入 ea
      const merged = mergeParts(parts[c.ea.pi], parts[c.eb.pi], c.ea.atStart, c.eb.atStart);
      merges.push({
        name: f.name,
        gapM: +c.d.toFixed(1),
        angleA: Math.round(angA),
        angleB: Math.round(angB),
        from: [c.ea.p[1], c.ea.p[0]],
        to: [c.eb.p[1], c.eb.p[0]],
      });
      parts[c.ea.pi] = merged;
      parts.splice(c.eb.pi, 1);
      changedFeatures.add(f.index);
      done = true;
      changed = true;
      break;
    }
    if (!done) break;
  }

  // 收尾：剩余跨簇 >300m 的断口，报告给人工确认
  if (parts.length > 1) {
    const eps = endpointsOf(parts);
    const groups = clustersOf(eps);
    let best = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        for (const ea of groups[i]) {
          for (const eb of groups[j]) {
            if (ea.pi === eb.pi) continue;
            const d = dd(ea.p, eb.p);
            if (!best || d < best.d) best = { d, ea, eb };
          }
        }
      }
    }
    if (best) {
      const angA = connectorAngle(outwardDir(parts[best.ea.pi], best.ea.atStart), best.ea.p, best.eb.p);
      const angB = connectorAngle(outwardDir(parts[best.eb.pi], best.eb.atStart), best.eb.p, best.ea.p);
      pendingA1.push({
        name: f.name,
        type: f.type,
        partsLeft: parts.length,
        nearestGapM: Math.round(best.d),
        angleA: Math.round(angA),
        angleB: Math.round(angB),
        from: [best.ea.p[1], best.ea.p[0]],
        to: [best.eb.p[1], best.eb.p[0]],
      });
    }
  }

  f.segs = parts;
}

/* ---------- 报告 ---------- */
const summary = {
  generatedAt: new Date().toISOString(),
  file: "data/roads.geojson",
  mode: WRITE ? "write" : "dry-run",
  params: { clusterM: CLUSTER_M, autoMaxM: AUTO_MAX_M, maxAngleDeg: MAX_ANGLE_DEG },
  before: {
    features: fc.features.length,
    segments: fc.features.reduce(
      (s, f) => s + (f.geometry.type === "MultiLineString" ? f.geometry.coordinates.length : 1),
      0,
    ),
  },
  mergedCount: merges.length,
  mergedKm: +(merges.reduce((s, m) => s + m.gapM, 0) / 1000).toFixed(2),
  merges,
  blocked,
  pendingA1,
};
fs.mkdirSync(REPORT_DIR, { recursive: true });
const stamp = summary.generatedAt.slice(0, 10).replace(/-/g, "");
const reportFile = path.join(REPORT_DIR, `roads-connect-${stamp}.json`);
fs.writeFileSync(reportFile, JSON.stringify(summary, null, 2) + "\n", "utf8");

if (WRITE) {
  for (const f of feats) {
    if (!changedFeatures.has(f.index)) continue;
    f.feature.geometry = {
      type: f.segs.length === 1 ? "LineString" : "MultiLineString",
      coordinates: f.segs.length === 1 ? f.segs[0] : f.segs,
    };
    const note = f.feature.properties.note || "";
    if (!note.includes("P3 接续断口")) f.feature.properties.note = `${note}；P3 接续断口`;
  }
  fs.writeFileSync(ROADS, JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n") + "\r\n", "utf8");
}

/* ---------- 控制台摘要 ---------- */
console.log(`${summary.before.features} 要素 / ${summary.before.segments} 段（${summary.mode}）`);
console.log(`自动接续 ${merges.length} 处，共补 ${summary.mergedKm} km：`);
const byName = new Map();
merges.forEach((m) => byName.set(m.name, (byName.get(m.name) || 0) + 1));
[...byName.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${n}: ${c} 处`));
if (blocked.length) {
  console.log(`\n夹角超限未接 ${blocked.length} 处（防折返）：`);
  blocked.forEach((b) => console.log(`  ${b.name} ${b.gapM}m 夹角 ${b.angA}°/${b.angB}°`));
}
console.log(`\n>300m 待人工确认 ${pendingA1.length} 条：`);
pendingA1.forEach((p) =>
  console.log(`  ${p.name}(${p.type}) 剩 ${p.partsLeft} 段，最近断口 ${p.nearestGapM}m，夹角 ${p.angleA}°/${p.angleB}°`),
);
console.log(`\n报告：${path.relative(ROOT, reportFile)}`);
if (!WRITE) console.log("dry-run：未修改数据，确认后加 --write 落盘");
