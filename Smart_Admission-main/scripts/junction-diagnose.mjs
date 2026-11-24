#!/usr/bin/env node
/**
 * junction-diagnose.mjs - 路口三类缺陷的只读诊断（与地区无关，可复用）
 *
 *   A 近邻节点：两条（或同一条）线上出现相距 ≤ nearM 的多个节点 —— 只提议分组与基准点，不改几何
 *   B 欠伸    ：端点沿自身方向延长 gapM 米后才落到另一条线的段内 —— 路口前提前收尾
 *   C 过冲    ：端点在本线里程上越过最近路口节点一个小尾巴 —— 三叉口处长出去的一小截
 *
 * 本脚本只读：不修改输入的 roads / intersections，只写报告。
 * 投影原点按输入路网的平均纬度自动确定，阈值均为通用几何量（米、度），可直接用于其他地区。
 *
 * 用法：
 *   node scripts/junction-diagnose.mjs                         # 本项目全量诊断
 *   node scripts/junction-diagnose.mjs --pair 花园路×灵山大街    # 单对逐段追踪
 *   node scripts/junction-diagnose.mjs --roads D:/x/roads.geojson --nodes D:/x/intersections.geojson --out D:/x/reports
 *   node scripts/junction-diagnose.mjs --nodes none            # 没有交点文件时只跑 B / C
 *   node scripts/junction-diagnose.mjs --near 25 --under-max 12
 *
 * 参数：
 *   --roads / --nodes / --out  输入输出（--nodes 传 none 表示跳过 A）
 *   --near / --under-min / --under-max / --under-warn / --pointing-max / --min-angle / --over-min / --over-max
 *   --pair                     名称A×名称B（也接受 roadId）
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  closestPointOnSegment,
  createSegmentIndex,
  cumulativeDistances,
  makeProjector,
  partsOf,
} from "./lib/intersect-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CWD = process.cwd();
const LINE_TYPES = new Set(["LineString", "MultiLineString"]);
const GRID_M = 50;

const DEFAULT_PARAMS = {
  nearM: 30,
  underMinM: 3,
  underAutoM: 15,
  underWarnM: 30,
  pointingMaxDeg: 30,
  minAngleDeg: 30,
  overMinM: 0.3,
  overMaxM: 15,
};

const round7 = (v) => Number(v.toFixed(7));

/**
 * 读路网 → 算 A/B/C 诊断（纯内存，不落盘）
 * @param roadsGeoJson 路网 FeatureCollection
 * @param intersectionsGeoJson 交点 FeatureCollection；传 null 或空集合时 A 自动跳过
 * @param params 阈值，键名与 CLI 参数一一对应（nearM/underMinM/...）
 * @returns 报告对象；source 里的 file/sha256 由调用方回填
 */
export function diagnoseNetwork({
  roadsGeoJson,
  intersectionsGeoJson = null,
  params = {},
}) {
  const P = { ...DEFAULT_PARAMS, ...params };

  const features = roadsGeoJson.features
    .map((f, idx) => ({ f, idx }))
    .filter(
      ({ f }) =>
        f.geometry && LINE_TYPES.has(f.geometry.type) && partsOf(f).length > 0,
    )
    .map(({ f, idx }) => ({
      idx,
      roadId: String(f.properties.roadId),
      name: String(f.properties.name),
      type: String(f.properties.type ?? ""),
      important: f.properties.important === true,
      parts: partsOf(f),
    }));
  const featureById = new Map(features.map((f) => [f.roadId, f]));

  if (!features.length) {
    throw new Error(
      "路网文件里没有可用的线要素（LineString / MultiLineString）",
    );
  }

  const lat0 =
    features.reduce((s, f) => s + f.parts[0][0][1], 0) / features.length;
  const proj = makeProjector(lat0);
  const { toXY } = proj;
  const distXY = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const distM = (a, b) => distXY(toXY(a), toXY(b));

  const nodes = (intersectionsGeoJson?.features ?? []).map((f) => ({
    id: f.properties.id,
    label: f.properties.label,
    kind: f.properties.kind,
    coord: f.geometry.coordinates,
    roads: f.properties.roads,
  }));

  const angleDeg = (v1, v2) => {
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    if (!l1 || !l2) return 0;
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  };

  const foldAngle = (d) => (d > 90 ? 180 - d : d);

  // ---------- 线段索引（50 m 网格，够 30 m 半径检索） ----------
  const entries = [];
  for (const f of features) {
    f.parts.forEach((line, part) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        entries.push({
          roadIdx: f.idx,
          roadId: f.roadId,
          name: f.name,
          part,
          segIndex: i,
          a: line[i],
          b: line[i + 1],
          aXY: toXY(line[i]),
          bXY: toXY(line[i + 1]),
        });
      }
    });
  }
  const { segs, nearest } = createSegmentIndex(entries, {
    gridM: GRID_M,
    projector: proj,
  });

  // ---------- B 欠伸：端点未接到目标线 ----------
  const undershoots = [];
  const seenUnder = new Set();
  for (const f of features) {
    f.parts.forEach((line, part) => {
      if (line.length < 2) return;
      const ends = [
        { v: 0, from: line[1], to: line[0], label: "首" },
        {
          v: line.length - 1,
          from: line[line.length - 2],
          to: line[line.length - 1],
          label: "尾",
        },
      ];
      for (const e of ends) {
        const pXY = toXY(e.to);
        // 端点本身已经是路口（另一条路终止于此）时不能挪动，否则会拆掉既有连接
        if (
          nodes.some((n) => {
            const r = n.roads.find(
              (x) => x.roadId === f.roadId && x.part === part,
            );
            return r && r.vertex === e.v;
          })
        )
          continue;
        const near = nearest(pXY, P.underWarnM, f.idx);
        if (!near) continue;
        const gap = near.dist;
        if (gap <= P.underMinM || gap > P.underWarnM) continue;

        const outward = [pXY[0] - toXY(e.from)[0], pXY[1] - toXY(e.from)[1]];
        const toFoot = [near.foot[0] - pXY[0], near.foot[1] - pXY[1]];
        const pointing = angleDeg(outward, toFoot);
        const lineAngle = foldAngle(
          angleDeg(outward, [
            near.seg.bXY[0] - near.seg.aXY[0],
            near.seg.bXY[1] - near.seg.aXY[1],
          ]),
        );
        if (pointing > P.pointingMaxDeg || lineAngle < P.minAngleDeg) continue;

        const key = `${f.roadId}|${e.label}|${near.seg.roadId}`;
        if (seenUnder.has(key)) continue;
        seenUnder.add(key);

        const foot = proj.toLonLat(near.foot).map(round7);
        undershoots.push({
          type: "under",
          severity: gap <= P.underAutoM ? "auto" : "warn",
          roadId: f.roadId,
          name: f.name,
          end: e.label,
          part,
          targetRoadId: near.seg.roadId,
          targetName: near.seg.name,
          gapM: Number(gap.toFixed(2)),
          pointingDeg: Number(pointing.toFixed(1)),
          lineAngleDeg: Number(lineAngle.toFixed(1)),
          from: e.to.map(round7),
          suggestedCoord: foot,
          targetPart: near.seg.part,
          targetSegIndex: near.seg.segIndex,
        });
      }
    });
  }
  undershoots.sort((a, b) => a.gapM - b.gapM);

  // ---------- C 过冲：端点越过最近的同线节点留下一小截 ----------
  const overshoots = [];
  for (const f of features) {
    f.parts.forEach((line, part) => {
      if (line.length < 2) return;
      const cum = cumulativeDistances(line);
      const last = line.length - 1;
      const mine = nodes.filter((n) =>
        n.roads.some((r) => r.roadId === f.roadId && r.part === part),
      );
      const ends = [
        { label: "首", sEnd: 0, vertex: 0 },
        { label: "尾", sEnd: cum[last], vertex: last },
      ];
      for (const e of ends) {
        let best = null;
        for (const n of mine) {
          const r = n.roads.find(
            (x) => x.roadId === f.roadId && x.part === part,
          );
          if (!r || !Number.isFinite(r.s) || !Number.isInteger(r.vertex))
            continue;
          const stub = Math.abs(r.s - e.sEnd);
          if (stub < P.overMinM || stub > P.overMaxM) continue;
          if (n.kind === "end") continue;
          if (!best || stub < best.stub) best = { n, r, stub };
        }
        if (!best) continue;
        const nodeVertex = best.r.vertex;
        if (!Number.isInteger(nodeVertex)) continue;
        const lo = Math.min(nodeVertex, e.vertex);
        const hi = Math.max(nodeVertex, e.vertex);
        if (hi - lo < 1) continue;
        // 末端顶点本身就是路口（另一条路在此终止）时，这段是两路口之间的真实道路，
        // 不是长出去的尾巴；裁掉会把那个路口剪断
        if (
          mine.some((n) => {
            const r = n.roads.find(
              (x) => x.roadId === f.roadId && x.part === part,
            );
            return r && r.vertex === e.vertex;
          })
        )
          continue;
        overshoots.push({
          type: "over",
          roadId: f.roadId,
          name: f.name,
          end: e.label,
          part,
          stubM: Number(best.stub.toFixed(2)),
          nodeId: best.n.id,
          nodeLabel: best.n.label,
          nodeVertex,
          droppedVertices: hi - lo,
          coord: best.n.coord.map(round7),
          endCoord: line[e.vertex].map(round7),
          stubCoords: line.slice(lo, hi + 1).map((p) => p.map(round7)),
        });
      }
    });
  }
  overshoots.sort((a, b) => b.stubM - a.stubM);

  // ---------- A 近邻节点：30 m 内且共享一条线，种子扩散不链式传递 ----------
  // 基准点（anchor）选点链（用户裁定，2026-10-25）：
  //   0. 距离先量化到 0.01 m，落在最小值 0.5 m 内的成员才算并列
  //   1. 河优先于河畔路（渿河 vs 渿河东路这类）
  //   2. 节点类型 cross > tee > multi > end
  //   3. 实体等级：河流/铁路 > 主干道路 > 普通道路（无宽度与铁路等级数据）
  //   4. 更接近地理标志中心（即最初的距离排序；三点共线时自然取中间）
  //   5. 无特征时南优先于北、西优先于东
  //   6. id 字典序兜底
  const KIND_RANK = { cross: 0, tee: 1, multi: 2, end: 3 };
  const DIR_ORDER = ["南", "西", "北", "东"];

  const entityScore = (f) => {
    if (!f) return 0;
    if (f.type === "河流" || f.type === "铁路") return 3;
    return f.important ? 2 : 1;
  };

  const entitiesOf = (n) =>
    n.roads.map((r) => featureById.get(r.roadId)).filter(Boolean);

  const isRiverside = (road, riverNames) =>
    riverNames.some((rn) =>
      new RegExp(`^${rn}[东南西北中]?路$`).test(road.name),
    );

  const dirOf = (coord, center) => {
    const dx = coord[0] - center[0];
    const dy = coord[1] - center[1];
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return "重合";
    const ax = Math.abs(dx) / d;
    const ay = Math.abs(dy) / d;
    if (ay >= 0.7) return dy > 0 ? "北" : "南";
    if (ax >= 0.7) return dx > 0 ? "东" : "西";
    return "对角";
  };

  const pickAnchor = (members, center) => {
    const dOf = (n) =>
      Number(
        Math.hypot(
          toXY(n.coord)[0] - center[0],
          toXY(n.coord)[1] - center[1],
        ).toFixed(2),
      );
    const dMin = Math.min(...members.map(dOf));
    let pool = members.filter((n) => dOf(n) - dMin <= 0.5);
    if (pool.length === 1) return { anchor: pool[0], reason: "距组中心最近" };

    const rivers = [
      ...new Set(
        members.flatMap((n) =>
          entitiesOf(n)
            .filter((f) => f.type === "河流")
            .map((f) => f.name),
        ),
      ),
    ];
    const riverside = new Set(
      members
        .filter((n) =>
          entitiesOf(n).some(
            (f) => f.type === "道路" && isRiverside(f, rivers),
          ),
        )
        .map((n) => n.id),
    );
    if (riverside.size) {
      const riverOnly = pool.filter((n) =>
        entitiesOf(n).some((f) => f.type === "河流"),
      );
      if (riverOnly.length === 1)
        return { anchor: riverOnly[0], reason: "河优先于河畔路" };
      if (riverOnly.length) pool = riverOnly;
    }

    const kMin = Math.min(...pool.map((n) => KIND_RANK[n.kind] ?? 9));
    const kindPool = pool.filter((n) => (KIND_RANK[n.kind] ?? 9) === kMin);
    if (kindPool.length === 1)
      return {
        anchor: kindPool[0],
        reason: "并列时取节点类型（cross>tee>multi>end）",
      };
    pool = kindPool;

    const sMax = Math.max(
      ...pool.map((n) => Math.max(...entitiesOf(n).map(entityScore), 0)),
    );
    const gradePool = pool.filter(
      (n) => Math.max(...entitiesOf(n).map(entityScore), 0) === sMax,
    );
    if (gradePool.length === 1)
      return {
        anchor: gradePool[0],
        reason: "并列时取实体等级（河流/铁路/主干道路）",
      };
    pool = gradePool;

    const dirPool = pool
      .map((n) => ({ n, dir: dirOf(toXY(n.coord), center) }))
      .filter((x) => DIR_ORDER.includes(x.dir));
    if (dirPool.length) {
      const [best] = [...dirPool].sort(
        (a, b) => DIR_ORDER.indexOf(a.dir) - DIR_ORDER.indexOf(b.dir),
      );
      return { anchor: best.n, reason: `并列时方位兜底（${best.dir}优先）` };
    }

    const [anchor] = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
    return { anchor, reason: "id 字典序兜底" };
  };

  const order = [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const used = new Set();
  const nearGroups = [];
  for (const seed of order) {
    if (used.has(seed.id)) continue;
    used.add(seed.id);
    const members = [seed];
    for (const n of order) {
      if (used.has(n.id)) continue;
      if (distM(seed.coord, n.coord) > P.nearM) continue;
      const shared = n.roads.some((r) =>
        seed.roads.some((s) => s.roadId === r.roadId),
      );
      if (!shared) continue;
      used.add(n.id);
      members.push(n);
    }
    if (members.length < 2) continue;
    const cx =
      members.reduce((s, n) => s + toXY(n.coord)[0], 0) / members.length;
    const cy =
      members.reduce((s, n) => s + toXY(n.coord)[1], 0) / members.length;
    const { anchor, reason } = pickAnchor(members, [cx, cy]);
    const spread = Math.max(
      ...members.map((n) => distM(n.coord, anchor.coord)),
    );
    nearGroups.push({
      type: "near",
      groupId: `g${nearGroups.length + 1}`,
      anchorId: anchor.id,
      anchorReason: reason,
      spreadM: Number(spread.toFixed(2)),
      center: proj.toLonLat([cx, cy]).map(round7),
      members: members.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        coord: n.coord,
        anchor: n.id === anchor.id,
        dCenter: Number(
          Math.hypot(toXY(n.coord)[0] - cx, toXY(n.coord)[1] - cy).toFixed(2),
        ),
        dToAnchor: Number(distM(n.coord, anchor.coord).toFixed(2)),
      })),
    });
  }
  nearGroups.sort((a, b) => b.spreadM - a.spreadM);

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      roads: {
        sha256: null,
        features: features.length,
        segments: segs.length,
      },
      intersections: intersectionsGeoJson
        ? { sha256: null, features: nodes.length }
        : { sha256: null, features: 0, note: "未提供交点文件，A / C 无输入" },
    },
    params: P,
    totals: {
      nearGroups: nearGroups.length,
      nearNodes: nearGroups.reduce((s, g) => s + g.members.length, 0),
      underAuto: undershoots.filter((u) => u.severity === "auto").length,
      underWarn: undershoots.filter((u) => u.severity === "warn").length,
      over: overshoots.length,
    },
    nearGroups,
    under: undershoots,
    over: overshoots,
  };

  return report;
}

// ---------- CLI ----------
const isMain = () =>
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

const displayPath = (p) => {
  const rel = path.relative(ROOT, p);
  return rel.startsWith("..") ? p : rel;
};

const requireFile = (p, label) => {
  if (!fs.existsSync(p)) {
    console.error(`❌ ${label} 不存在: ${p}`);
    process.exit(1);
  }
};

const readJson = (p) =>
  JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));

/**
 * CLI 复用：路网要素表 + 投影器（--pair / --fix 需要）
 */
const roadContext = (roads) => {
  const features = roads.features
    .map((f, idx) => ({ f, idx }))
    .filter(
      ({ f }) =>
        f.geometry && LINE_TYPES.has(f.geometry.type) && partsOf(f).length > 0,
    )
    .map(({ f, idx }) => ({
      idx,
      roadId: String(f.properties.roadId),
      name: String(f.properties.name),
      type: String(f.properties.type ?? ""),
      important: f.properties.important === true,
      parts: partsOf(f),
    }));
  const lat0 =
    features.reduce((s, f) => s + f.parts[0][0][1], 0) / features.length;
  const proj = makeProjector(lat0);
  return {
    features,
    proj,
    featureById: new Map(features.map((f) => [f.roadId, f])),
  };
};

if (isMain()) {
  const argOf = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : process.argv[i + 1];
  };

  const pathArg = (name, dflt) => {
    const raw = argOf(name, null);
    return raw === null ? dflt : path.resolve(CWD, raw);
  };

  const numOf = (name, dflt) => {
    const raw = argOf(name, null);
    if (raw === null) return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      console.error(`❌ --${name} 需要数字，当前: ${raw}`);
      process.exit(1);
    }
    return n;
  };

  const PARAMS = {
    nearM: numOf("near", 30),
    underMinM: numOf("under-min", 3),
    underAutoM: numOf("under-max", 15),
    underWarnM: numOf("under-warn", 30),
    pointingMaxDeg: numOf("pointing-max", 30),
    minAngleDeg: numOf("min-angle", 30),
    overMinM: numOf("over-min", 0.3),
    overMaxM: numOf("over-max", 15),
  };

  const ROADS = pathArg("roads", path.join(ROOT, "data/roads.geojson"));
  const NODES_RAW = argOf("nodes", null);
  const IX =
    NODES_RAW === null
      ? path.join(ROOT, "data/intersections.geojson")
      : NODES_RAW === "none"
        ? null
        : path.resolve(CWD, NODES_RAW);
  const REPORT_DIR = pathArg("out", path.join(ROOT, "reports/junctions"));

  const PAIR = argOf("pair", null);
  const FIX_MODE = argOf("fix", null);
  const WRITE = process.argv.includes("--write");

  if (FIX_MODE !== null && !["under", "over", "all"].includes(FIX_MODE)) {
    console.error(`❌ --fix 只接受 under / over / all，当前: ${FIX_MODE}`);
    process.exit(1);
  }
  if (WRITE && FIX_MODE === null) {
    console.error("❌ --write 只配合 --fix 使用");
    process.exit(1);
  }
  if (FIX_MODE !== null && PAIR) {
    console.error("❌ --pair 与 --fix 不能同时使用");
    process.exit(1);
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  requireFile(ROADS, "路网文件");
  if (IX) requireFile(IX, "交点文件");

  const roads = readJson(ROADS);
  const ROADS_SHA = crypto
    .createHash("sha256")
    .update(fs.readFileSync(ROADS))
    .digest("hex");
  const ix = IX ? readJson(IX) : null;

  let report;
  try {
    report = diagnoseNetwork({
      roadsGeoJson: roads,
      intersectionsGeoJson: ix,
      params: PARAMS,
    });
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  report.source.roads.sha256 = ROADS_SHA;
  if (IX && ix.features.length) {
    report.source.intersections.sha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(IX))
      .digest("hex");
  }

  const { features, proj, featureById } = roadContext(roads);
  const { toXY } = proj;
  const distXY = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const distM = (a, b) => distXY(toXY(a), toXY(b));
  const nodes = ix
    ? ix.features.map((f) => ({
        id: f.properties.id,
        label: f.properties.label,
        kind: f.properties.kind,
        coord: f.geometry.coordinates,
        roads: f.properties.roads,
      }))
    : [];
  const undershoots = report.under;
  const overshoots = report.over;
  const P = report.params;

  // ---------- B / C 修复：默认 dry-run，--write 才落盘 ----------
  // 只改 --roads 指向的文件，顺序固定为"先裁尾（C）再延长（B）"：
  // 裁尾不新增点，延长按裁剪后的最终几何重新求垂足，避免目标线被裁掉后仍按旧垂足拉线。
  const fixApplied = [];
  const fixSkipped = [];
  let roadsDirty = false;

  const geometryOf = (roadId) => {
    const f = featureById.get(roadId);
    return f ? roads.features[f.idx].geometry : null;
  };

  const getLine = (roadId, part) => {
    const g = geometryOf(roadId);
    if (!g) return null;
    return g.type === "MultiLineString" ? g.coordinates[part] : g.coordinates;
  };

  const setLine = (roadId, part, line) => {
    const g = geometryOf(roadId);
    if (!g) return;
    if (g.type === "MultiLineString") g.coordinates[part] = line;
    else g.coordinates = line;
    roadsDirty = true;
  };

  const closestOnRoad = (pXY, roadId) => {
    const g = geometryOf(roadId);
    if (!g) return null;
    const lines =
      g.type === "MultiLineString" ? g.coordinates : [g.coordinates];
    let best = null;
    for (const lb of lines) {
      for (let i = 0; i < lb.length - 1; i += 1) {
        const hit = closestPointOnSegment(pXY, toXY(lb[i]), toXY(lb[i + 1]));
        if (!best || hit.dist < best.dist)
          best = { dist: hit.dist, foot: hit.foot };
      }
    }
    return best;
  };

  if (FIX_MODE) {
    const doUnder = FIX_MODE !== "over";
    const doOver = FIX_MODE !== "under";
    const endKey = (x) => `${x.roadId}|${x.part}|${x.end}`;

    const overTodo = new Map();
    if (doOver) for (const o of overshoots) overTodo.set(endKey(o), o);

    // 同一条线同一端可能同时欠伸到好几条目标线：只修最近的那条
    const underTodo = new Map();
    if (doUnder) {
      for (const u of undershoots) {
        if (u.severity !== "auto") continue;
        const k = endKey(u);
        const prev = underTodo.get(k);
        if (!prev || u.gapM < prev.gapM) {
          if (prev) {
            fixSkipped.push({
              kind: "under",
              roadId: prev.roadId,
              name: prev.name,
              end: prev.end,
              detail: `同端另有一条更近的目标 ${u.targetName}（${u.gapM}m），只修最近一条`,
            });
          }
          underTodo.set(k, u);
        } else {
          fixSkipped.push({
            kind: "under",
            roadId: u.roadId,
            name: u.name,
            end: u.end,
            detail: `同端另有一条更近的目标 ${prev.targetName}（${prev.gapM}m），只修最近一条`,
          });
        }
      }
    }

    // 同一端既欠伸又过冲：两个动作方向相反，交人工判断
    for (const k of [...underTodo.keys()]) {
      if (!overTodo.has(k)) continue;
      const u = underTodo.get(k);
      underTodo.delete(k);
      overTodo.delete(k);
      fixSkipped.push({
        kind: "both",
        roadId: u.roadId,
        name: u.name,
        end: u.end,
        detail: "同一端既欠伸又过冲，需人工判断",
      });
    }

    for (const o of overTodo.values()) {
      const line = getLine(o.roadId, o.part);
      if (!line) {
        fixSkipped.push({
          kind: "over",
          roadId: o.roadId,
          name: o.name,
          end: o.end,
          detail: "找不到对应线段",
        });
        continue;
      }
      const newLine =
        o.end === "首"
          ? line.slice(o.nodeVertex)
          : line.slice(0, o.nodeVertex + 1);
      if (newLine.length < 2) {
        fixSkipped.push({
          kind: "over",
          roadId: o.roadId,
          name: o.name,
          end: o.end,
          detail: "裁剪后不足 2 个顶点",
        });
        continue;
      }
      setLine(o.roadId, o.part, newLine);
      fixApplied.push({
        kind: "over",
        roadId: o.roadId,
        name: o.name,
        end: o.end,
        part: o.part,
        nodeId: o.nodeId,
        stubM: o.stubM,
        droppedVertices: o.droppedVertices,
        from: o.endCoord,
        to: o.coord,
      });
    }

    for (const u of underTodo.values()) {
      const line = getLine(u.roadId, u.part);
      if (!line) {
        fixSkipped.push({
          kind: "under",
          roadId: u.roadId,
          name: u.name,
          end: u.end,
          detail: "找不到对应线段",
        });
        continue;
      }
      const p = u.end === "首" ? line[0] : line[line.length - 1];
      const near = closestOnRoad(toXY(p), u.targetRoadId);
      if (!near || near.dist > P.underMaxM + 1) {
        fixSkipped.push({
          kind: "under",
          roadId: u.roadId,
          name: u.name,
          end: u.end,
          detail: "裁剪后目标线已不在可延伸范围内，需人工复核",
        });
        continue;
      }
      const foot = proj.toLonLat(near.foot).map(round7);
      const newLine = u.end === "首" ? [foot, ...line] : [...line, foot];
      setLine(u.roadId, u.part, newLine);
      fixApplied.push({
        kind: "under",
        roadId: u.roadId,
        name: u.name,
        end: u.end,
        part: u.part,
        targetRoadId: u.targetRoadId,
        targetName: u.targetName,
        gapM: Number(near.dist.toFixed(2)),
        from: p.map(round7),
        to: foot,
      });
    }

    if (WRITE && roadsDirty) {
      const crlf = (obj) =>
        `${JSON.stringify(obj, null, 2)}\n`.replace(/\n/g, "\r\n");
      fs.writeFileSync(ROADS, crlf(roads), "utf8");
    }
  }

  // ---------- 单对追踪 ----------
  const tracePair = (pairArg) => {
    const names = pairArg.split(/[×x*]/).map((s) => s.trim());
    if (names.length !== 2) throw new Error("--pair 需写成 名称A×名称B");
    const pick = (name) =>
      features.filter((f) => f.name === name || f.roadId === name);
    const [listA, listB] = names.map(pick);
    if (!listA.length || !listB.length)
      throw new Error(`找不到线路：${names.join(" / ")}`);
    console.log(`\n=== ${names[0]} × ${names[1]} 逐端点追踪 ===`);
    for (const fa of listA) {
      fa.parts.forEach((line) => {
        [0, line.length - 1].forEach((v) => {
          if (line.length < 2) return;
          const p = line[v];
          const prev = line[v === 0 ? 1 : line.length - 2];
          const pXY = toXY(p);
          let best = null;
          for (const fb of listB) {
            fb.parts.forEach((lb) => {
              for (let i = 0; i < lb.length - 1; i += 1) {
                const hit = closestPointOnSegment(
                  pXY,
                  toXY(lb[i]),
                  toXY(lb[i + 1]),
                );
                if (!best || hit.dist < best.hit.dist)
                  best = { hit, seg: [lb[i], lb[i + 1]], fb };
              }
            });
          }
          if (!best) return;
          const outward = [pXY[0] - toXY(prev)[0], pXY[1] - toXY(prev)[1]];
          const toFoot = [best.hit.foot[0] - pXY[0], best.hit.foot[1] - pXY[1]];
          const tgt = [
            toXY(best.seg[1])[0] - toXY(best.seg[0])[0],
            toXY(best.seg[1])[1] - toXY(best.seg[0])[1],
          ];
          const gap = best.hit.dist;
          const pointing = angleBetween(outward, toFoot);
          const lineAngle = foldAngle(angleBetween(outward, tgt));
          const verdict =
            gap <= P.underMinM
              ? "已接上"
              : gap <= P.underAutoM
                ? "欠伸（可自动修）"
                : gap <= P.underWarnM
                  ? "欠伸（仅告警）"
                  : "超出阈值";
          console.log(
            `${fa.roadId} ${v === 0 ? "首" : "尾"}端 → ${best.fb.name}：${gap.toFixed(2)}m，指向偏 ${pointing.toFixed(1)}°，夹角 ${lineAngle.toFixed(1)}° → ${verdict}`,
          );
          console.log(
            `   端点 ${p.map(round7).join(",")}  垂足 ${proj.toLonLat(best.hit.foot).map(round7).join(",")}`,
          );
          const nearNodes = nodes.filter((n) => distM(n.coord, p) <= 40);
          for (const n of nearNodes)
            console.log(
              `   40m 内节点 ${n.id} ${n.kind} ${n.label} 距端点 ${distM(n.coord, p).toFixed(1)}m`,
            );
        });
      });
    }
    // 过冲候选
    console.log(`\n=== ${names[0]} / ${names[1]} 过冲候选 ===`);
    for (const o of overshoots.filter((x) => names.includes(x.name)))
      console.log(
        `${o.name} ${o.end}端 尾巴 ${o.stubM}m（节点 ${o.nodeId} ${o.nodeLabel}，将删 ${o.droppedVertices} 个顶点）`,
      );
  };

  const angleBetween = (v1, v2) => {
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    if (!l1 || !l2) return 0;
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  };

  const foldAngle = (d) => (d > 90 ? 180 - d : d);

  if (PAIR) {
    console.log(
      `输入：路网 ${displayPath(ROADS)} · 交点 ${IX ? displayPath(IX) : "none"}`,
    );
    try {
      tracePair(PAIR);
    } catch (e) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
  } else {
    if (FIX_MODE) {
      report.fix = {
        mode: FIX_MODE,
        written: Boolean(WRITE && roadsDirty),
        applied: fixApplied,
        skipped: fixSkipped,
      };
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const body = `${JSON.stringify(report, null, 2)}\n`;
    fs.writeFileSync(path.join(REPORT_DIR, `${today}.json`), body, "utf8");
    fs.writeFileSync(path.join(REPORT_DIR, "latest.json"), body, "utf8");

    const t = report.totals;
    console.log(
      `输入：路网 ${displayPath(ROADS)} · 交点 ${IX ? displayPath(IX) : "none"} · 输出 ${displayPath(REPORT_DIR)}`,
    );
    console.log(`[A] 近邻节点 ${t.nearGroups} 组 / ${t.nearNodes} 个节点`);
    for (const g of report.nearGroups.slice(0, 12))
      console.log(
        `    ${g.groupId} 跨度 ${g.spreadM}m 基准 ${g.anchorId}：${g.members.map((m) => m.id).join("、")}`,
      );
    console.log(`[B] 欠伸 ${t.underAuto} 条可自动修 / ${t.underWarn} 条仅告警`);
    for (const u of undershoots.slice(0, 20))
      console.log(
        `    ${u.severity === "auto" ? "修" : "警"} ${u.name} ${u.end}端距 ${u.targetName} ${u.gapM}m（指向偏 ${u.pointingDeg}°，夹角 ${u.lineAngleDeg}°）`,
      );
    console.log(`[C] 过冲 ${t.over} 条`);
    for (const o of overshoots.slice(0, 20))
      console.log(
        `    裁 ${o.name} ${o.end}端尾巴 ${o.stubM}m（节点 ${o.nodeId}，删 ${o.droppedVertices} 个顶点）`,
      );
    if (FIX_MODE) {
      const state = WRITE && roadsDirty ? "已写入路网" : "dry-run，未写入";
      console.log(
        `[修复] ${FIX_MODE}：${fixApplied.length} 处 · 跳过 ${fixSkipped.length} 处 · ${state}`,
      );
      for (const a of fixApplied)
        console.log(
          a.kind === "over"
            ? `    裁 ${a.name} ${a.end}端尾巴 ${a.stubM}m（节点 ${a.nodeId}，删 ${a.droppedVertices} 个顶点）`
            : `    延 ${a.name} ${a.end}端 → ${a.targetName} ${a.gapM}m`,
        );
      for (const s of fixSkipped)
        console.log(`    跳过 ${s.name} ${s.end}端：${s.detail}`);
      console.log(
        WRITE && roadsDirty
          ? "    下一步：node scripts/build-intersections.mjs --write"
          : "    确认无误后加 --write 落盘，再跑 build-intersections 补交点",
      );
    }
    console.log(
      `报告 → ${displayPath(path.join(REPORT_DIR, `${today}.json`))}`,
    );
  }
}
