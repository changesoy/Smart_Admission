#!/usr/bin/env node
/**
 * build-intersections.mjs - L0 交点图谱：道路两两求交 → 交点入库 → 路口顶点写进 roads.geojson
 *
 * 三类路口（口径见 docs/planning/交点图谱构建脚本规划.md）：
 *   cross    两条线严格相交 → 交点插进两条线，成为共用顶点
 *   tee/end  一条（或两条）道路的端点落在另一条线 tol 之内 → 只在被贴合的那条线上插垂足，
 *            端点本身不动，节点坐标取两者中点（两侧顶点可能相差 ≤ tol）
 *   贯通缺口  两条"贯通线"擦肩而过（夹角 ≥ 35°）。最近距离 ≤ tol 视为取整噪声，
 *            按路口入库（只把垂足插成顶点，两端都不挪线）；≤ candidate 但 > tol 的
 *            只进报告：这是路网本身没接上，应在路网层修，不在本层拉线
 *
 * 幂等：插点复用已有顶点，连跑两次 roads.geojson 字节不变；
 *       交点文件用最终几何回填 s/vertex，因此第二次运行起完全稳定。
 *
 * 用法：
 *   node scripts/build-intersections.mjs                      # dry-run：只出报告
 *   node scripts/build-intersections.mjs --write              # 写 data/ 下两个文件
 *   node scripts/build-intersections.mjs --tol 3 --candidate 10
 *   node scripts/build-intersections.mjs --roads D:/x/roads.geojson --out D:/x/intersections.geojson --report D:/x/reports
 *
 * 参数：
 *   --roads    输入路网（默认 data/roads.geojson）
 *   --out      交点输出文件（默认 data/intersections.geojson）
 *   --report   报告目录（默认 reports/intersections）
 *   --tol / --candidate / --cluster
 *
 * --write 时插点写回 --roads 指向的文件（原地更新），交点写 --out；
 * 传入外部副本即等价于"在副本上试改"，不会碰项目内的 data/roads.geojson。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  closestPointOnSegment,
  clusterByRadius,
  createSegmentIndex,
  cumulativeDistances,
  insertPointsIntoLine,
  makeProjector,
  partsOf,
  segmentRelation,
} from "./lib/intersect-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CWD = process.cwd();
const LINE_TYPES = new Set(["LineString", "MultiLineString"]);
const GRID_M = 100;
const MIN_ANGLE_DEG = 35; // 贯通近失要判定为"本该横穿"，否则按平行伴随忽略

const round7 = (v) => Number(v.toFixed(7));

/**
 * 从路网算交点并在内存里把插点写回路网（不落盘）
 * @param roadsGeoJson 路网 FeatureCollection（会被就地更新几何）
 * @param opts.tol 吸附容差（米）
 * @param opts.candidate 贯通近失候选半径（米）
 * @param opts.clusterM 节点聚类半径（米）
 * @returns {{roads:object, intersections:object, report:object}}
 *   report.source.file / sha256 由调用方回填，核心函数不碰文件系统
 */
export function buildNetwork(
  roadsGeoJson,
  { tol = 3, candidate = 10, clusterM = 1 } = {},
) {
  const roads = roadsGeoJson;
  const TOL = tol;
  const CANDIDATE = candidate;
  const CLUSTER_M = clusterM;

  // idx 保留原始下标：写回 roads.features 时，过滤掉的要素不影响映射
  const features = roads.features
    .map((f, idx) => ({
      idx,
      roadId: f.properties.roadId,
      name: f.properties.name,
      dataStatus: f.properties.dataStatus,
      parts: f.geometry && LINE_TYPES.has(f.geometry.type) ? partsOf(f) : null,
    }))
    .filter((f) => f.parts && f.parts.length && f.parts[0].length >= 2);

  const featureByOrigIdx = new Map(features.map((f) => [f.idx, f]));

  if (!features.length) {
    throw new Error(
      "路网文件里没有可用的线要素（LineString / MultiLineString）",
    );
  }

  const lat0 =
    features.reduce((s, f) => s + f.parts[0][0][1], 0) / features.length;
  const proj = makeProjector(lat0);
  const distXY = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // ---------- 线段索引 ----------
  const entries = [];
  for (const f of features) {
    f.parts.forEach((line, part) => {
      const cum = cumulativeDistances(line);
      for (let i = 0; i < line.length - 1; i += 1) {
        entries.push({
          roadIdx: f.idx,
          roadId: f.roadId,
          part,
          segIndex: i,
          aXY: proj.toXY(line[i]),
          bXY: proj.toXY(line[i + 1]),
          s0: cum[i],
        });
      }
    });
  }

  const { segs, buckets, cellsNear } = createSegmentIndex(entries, {
    gridM: GRID_M,
    projector: proj,
  });

  // ---------- 1) 严格相交 ----------
  const seenPair = new Set();
  const rawNodes = []; // {type, coord, gapM, members:[{roadIdx,part,segIndex,t,coord,vertex|null}]}
  const overlaps = [];

  for (const bucket of buckets) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const s = bucket[i];
        const t = bucket[j];
        if (s.roadIdx === t.roadIdx) continue;
        const key = `${s.roadId}|${t.roadId}|${s.part}:${s.segIndex}|${t.part}:${t.segIndex}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        const rel = segmentRelation(s.aXY, s.bXY, t.aXY, t.bXY);
        if (rel?.kind === "collinear") {
          const lenM = distXY(s.aXY, s.bXY);
          const overlapM = Math.max(0, (rel.tA1 - rel.tA0) * lenM);
          if (overlapM > 5) {
            overlaps.push({
              roads: [s.roadId, t.roadId],
              names: [
                featureByOrigIdx.get(s.roadIdx).name,
                featureByOrigIdx.get(t.roadIdx).name,
              ],
              overlapM: Number(overlapM.toFixed(2)),
              from: proj
                .toLonLat([
                  s.aXY[0] + rel.tA0 * (s.bXY[0] - s.aXY[0]),
                  s.aXY[1] + rel.tA0 * (s.bXY[1] - s.aXY[1]),
                ])
                .map(round7),
              to: proj
                .toLonLat([
                  s.aXY[0] + rel.tA1 * (s.bXY[0] - s.aXY[0]),
                  s.aXY[1] + rel.tA1 * (s.bXY[1] - s.aXY[1]),
                ])
                .map(round7),
            });
          }
          continue;
        }
        if (rel?.kind !== "cross") continue;
        const coord = proj.toLonLat(rel.point).map(round7);
        rawNodes.push({
          type: "cross",
          gapM: 0,
          coord,
          members: [
            {
              roadIdx: s.roadIdx,
              part: s.part,
              segIndex: s.segIndex,
              t: rel.tA,
              coord,
              vertex: null,
            },
            {
              roadIdx: t.roadIdx,
              part: t.part,
              segIndex: t.segIndex,
              t: rel.tB,
              coord,
              vertex: null,
            },
          ],
        });
      }
    }
  }

  // ---------- 2) 端点吸附（tee / end） ----------
  // 只有"某条路的端点"才可能吸附；中间顶点贴着另一条线属于平行伴随，不产生路口。
  for (const f of features) {
    f.parts.forEach((line, part) => {
      const ends = line.length > 1 ? [0, line.length - 1] : [0];
      for (const v of ends) {
        const pLL = line[v];
        const pXY = proj.toXY(pLL);
        const perRoad = new Map();
        for (const s of cellsNear(pXY, CANDIDATE)) {
          if (s.roadIdx === f.idx) continue;
          const near = closestPointOnSegment(pXY, s.aXY, s.bXY);
          if (near.dist > CANDIDATE) continue;
          const prev = perRoad.get(s.roadIdx);
          if (prev && prev.near.dist <= near.dist) continue;
          perRoad.set(s.roadIdx, { s, near });
        }
        if (!perRoad.size) continue;
        for (const [otherRoadIdx, { s, near }] of perRoad) {
          const footXY = near.foot;
          const footLL = proj.toLonLat(footXY).map(round7);
          // 节点坐标取"端点 + 已取整垂足"的中点：垂足取整后即成为该路顶点，
          // 第二次运行读到的仍是同一个值，节点坐标因此稳定
          const footXYr = proj.toXY(footLL);
          const midXY = [(pXY[0] + footXYr[0]) / 2, (pXY[1] + footXYr[1]) / 2];
          const members = [
            {
              roadIdx: f.idx,
              part,
              segIndex: Math.max(0, Math.min(v, line.length - 2)),
              t: v === 0 ? 0 : 1,
              coord: pLL,
              vertex: v,
            },
            {
              roadIdx: otherRoadIdx,
              part: s.part,
              segIndex: s.segIndex,
              t: near.t,
              coord: footLL,
              vertex: null,
            },
          ];
          rawNodes.push({
            type: "endpoint",
            gapM: Number(near.dist.toFixed(2)),
            coord: proj.toLonLat(midXY).map(round7),
            members,
          });
        }
      }
    });
  }

  // ---------- 3) 贯通缺口：≤tol 入库为路口，>tol 只进报告 ----------
  // 两条贯通线擦肩而过（夹角 ≥ MIN_ANGLE_DEG）。缺口 ≤ tol 属于取整/拟合噪声，
  // 按路口入库：只把"投影侧"的垂足插成顶点，另一侧本来就是顶点，两端都不挪线；
  // 缺口 > tol 说明路网本身没接上，只在报告里提示，不在本层拉线。
  const throughGaps = [];
  for (const bucket of buckets) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const s = bucket[i];
        const t = bucket[j];
        if (s.roadIdx === t.roadIdx) continue;
        if (segmentRelation(s.aXY, s.bXY, t.aXY, t.bXY)) continue;
        const lineS = featureByOrigIdx.get(s.roadIdx).parts[s.part];
        const lineT = featureByOrigIdx.get(t.roadIdx).parts[t.part];
        // 二维下两条不相交线段的最近点必有一端落在某条线段的端点，
        // 对四个端点各做一次投影取最小，即精确最近对
        const cands = [
          { fixedRoad: "s", fixedIdx: s.segIndex, fixedLL: lineS[s.segIndex] },
          {
            fixedRoad: "s",
            fixedIdx: s.segIndex + 1,
            fixedLL: lineS[s.segIndex + 1],
          },
          { fixedRoad: "t", fixedIdx: t.segIndex, fixedLL: lineT[t.segIndex] },
          {
            fixedRoad: "t",
            fixedIdx: t.segIndex + 1,
            fixedLL: lineT[t.segIndex + 1],
          },
        ];
        let best = null;
        for (const c of cands) {
          const other = c.fixedRoad === "s" ? t : s;
          const pr = closestPointOnSegment(
            proj.toXY(c.fixedLL),
            other.aXY,
            other.bXY,
          );
          if (!best || pr.dist < best.hit.dist) best = { ...c, other, hit: pr };
        }
        if (best.hit.dist > CANDIDATE) continue;
        const angS = Math.atan2(s.bXY[1] - s.aXY[1], s.bXY[0] - s.aXY[0]);
        const angT = Math.atan2(t.bXY[1] - t.aXY[1], t.bXY[0] - t.aXY[0]);
        let diff = (Math.abs(angS - angT) * 180) / Math.PI;
        if (diff > 90) diff = 180 - diff;
        if (diff < MIN_ANGLE_DEG) continue;

        if (best.hit.dist > TOL) {
          throughGaps.push({
            roads: [s.roadId, t.roadId],
            names: [
              featureByOrigIdx.get(s.roadIdx).name,
              featureByOrigIdx.get(t.roadIdx).name,
            ],
            gapM: Number(best.hit.dist.toFixed(2)),
            angleDeg: Number(diff.toFixed(1)),
            coord: proj.toLonLat(best.hit.foot).map(round7),
            from: best.fixedLL.map(round7),
            to: proj.toLonLat(best.hit.foot).map(round7),
          });
          continue;
        }
        // 缺口入 tol：垂足取整后插成顶点，节点坐标取"既有顶点 + 已取整垂足"的中点，
        // 与端点吸附同一套稳定化口径，保证二次运行坐标不漂
        const footLL = proj.toLonLat(best.hit.foot).map(round7);
        const footXYr = proj.toXY(footLL);
        const fixedXY = proj.toXY(best.fixedLL);
        const midXY = [
          (fixedXY[0] + footXYr[0]) / 2,
          (fixedXY[1] + footXYr[1]) / 2,
        ];
        const otherPart = best.other.part;
        const otherSeg = best.other.segIndex;
        const nodeCoord = proj.toLonLat(midXY).map(round7);
        // 同一路对在 tol 内已经有严格相交/端点吸附节点时，这个贯通缺口就是它的重复检测，
        // 不再另立节点（否则同一处路口会出现两个相距 1–3 m 的点）
        const dup = rawNodes.some((n) => {
          const ids = new Set(n.members.map((m) => m.roadIdx));
          return (
            ids.has(s.roadIdx) &&
            ids.has(t.roadIdx) &&
            distXY(proj.toXY(n.coord), proj.toXY(nodeCoord)) <= TOL
          );
        });
        if (dup) continue;
        rawNodes.push({
          type: "through",
          gapM: Number(best.hit.dist.toFixed(2)),
          coord: nodeCoord,
          members: [
            {
              roadIdx: best.fixedRoad === "s" ? s.roadIdx : t.roadIdx,
              part: best.fixedRoad === "s" ? s.part : t.part,
              // 内部顶点既可算作前一段的终点，也可算作后一段的起点，统一取前一段
              segIndex: Math.max(0, best.fixedIdx - 1),
              t: best.fixedIdx === 0 ? 0 : 1,
              coord: best.fixedLL,
              vertex: best.fixedIdx,
            },
            {
              roadIdx: best.fixedRoad === "s" ? t.roadIdx : s.roadIdx,
              part: otherPart,
              segIndex: otherSeg,
              t: best.hit.t,
              coord: footLL,
              vertex: null,
            },
          ],
        });
      }
    }
  }
  // 同一路对的多条线段近失只保留最近一条
  const nearMiss = new Map();
  for (const g of throughGaps.sort((a, b) => a.gapM - b.gapM)) {
    const k = [...g.roads].sort().join("|");
    if (!nearMiss.has(k)) nearMiss.set(k, g);
  }

  // ---------- 聚类 + 只留 tol 内的节点 ----------
  const groups = clusterByRadius(rawNodes, CLUSTER_M, proj);
  const nodes = [];
  for (const idxs of groups) {
    const items = idxs.map((k) => rawNodes[k]);
    const gapM = Math.min(...items.map((it) => it.gapM));
    if (gapM > TOL) continue;
    const members = [];
    for (const it of items) {
      for (const m of it.members) {
        if (!members.some((x) => x.roadIdx === m.roadIdx))
          members.push({ ...m });
      }
    }
    // 同一簇里多种来源时按可信度取坐标：严格相交 > 端点吸附 > 贯通缺口
    const rank = { cross: 0, endpoint: 1, through: 2 };
    const type = items.reduce(
      (m, it) => (rank[it.type] < rank[m] ? it.type : m),
      items[0].type,
    );
    const { coord } = items.find((it) => it.type === type);
    nodes.push({ type, gapM, coord, members });
  }

  // ---------- 插点（只插各条线自己的点，端点不动） ----------
  const inserts = new Map(); // roadIdx -> Map(part -> [{segIndex,t,coord}])
  for (const n of nodes) {
    for (const m of n.members) {
      if (!inserts.has(m.roadIdx)) inserts.set(m.roadIdx, new Map());
      const byPart = inserts.get(m.roadIdx);
      if (!byPart.has(m.part)) byPart.set(m.part, []);
      byPart.get(m.part).push({ segIndex: m.segIndex, t: m.t, coord: m.coord });
    }
  }

  const newLines = new Map();
  for (const f of features) {
    const byPart = inserts.get(f.idx);
    newLines.set(
      f.idx,
      f.parts.map((line, part) => {
        const ins = byPart?.get(part);
        return ins?.length ? insertPointsIntoLine(line, ins).line : line;
      }),
    );
  }

  // 交点坐标回填到路网几何（内存中完成，写盘由调用方决定）
  roads.features.forEach((f, idx) => {
    const parts = newLines.get(idx);
    if (!parts) return; // 非线要素 / 过短要素不参与，原样保留
    f.geometry =
      f.geometry.type === "MultiLineString"
        ? { type: "MultiLineString", coordinates: parts }
        : { type: "LineString", coordinates: parts[0] };
  });

  // ---------- 回填 s / vertex / kind ----------
  const locate = (roadIdx, coord) => {
    const xy = proj.toXY(coord);
    let best = null;
    newLines.get(roadIdx).forEach((line, part) => {
      const cum = cumulativeDistances(line);
      for (let i = 0; i < line.length; i += 1) {
        const d = distXY(proj.toXY(line[i]), xy);
        if (!best || d < best.d)
          best = { d, part, vertex: i, s: cum[i], len: line.length - 1 };
      }
    });
    return best;
  };

  const built = nodes.map((n) => {
    const roadIdxs = [...new Set(n.members.map((m) => m.roadIdx))];
    const placements = roadIdxs.map((roadIdx) => {
      const f = featureByOrigIdx.get(roadIdx);
      const loc = locate(roadIdx, n.coord);
      return {
        roadId: f.roadId,
        name: f.name,
        part: loc.part,
        vertex: loc.vertex,
        s: Number(loc.s.toFixed(2)),
        vertexGapM: Number(loc.d.toFixed(2)),
        confidence: f.dataStatus === "estimated" ? "low" : "high",
        _loc: loc,
      };
    });
    const sorted = [...placements].sort((a, b) =>
      a.roadId < b.roadId ? -1 : 1,
    );
    const interior = sorted.filter(
      (p) => p._loc.vertex !== 0 && p._loc.vertex !== p._loc.len,
    ).length;
    const kind =
      sorted.length > 2
        ? "multi"
        : interior === 2
          ? "cross"
          : interior === 1
            ? "tee"
            : "end";
    return {
      coord: n.coord,
      gapM: n.gapM,
      kind,
      anchorS: sorted[0].s,
      key: sorted.map((p) => p.roadId).join("_"),
      label: sorted.map((p) => p.name).join("×"),
      roads: sorted.map((p) => ({
        roadId: p.roadId,
        name: p.name,
        part: p.part,
        vertex: p.vertex,
        s: p.s,
        vertexGapM: p.vertexGapM,
        confidence: p.confidence,
      })),
    };
  });

  const counter = new Map();
  const ordered = built
    .sort(
      (a, b) =>
        a.anchorS - b.anchorS ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
        a.coord[0] - b.coord[0] ||
        a.coord[1] - b.coord[1],
    )
    .map((item) => {
      const c = (counter.get(item.key) ?? 0) + 1;
      counter.set(item.key, c);
      return { ...item, id: `ix_${item.key}_${c}` };
    });

  const intersections = {
    type: "FeatureCollection",
    params: { tolM: TOL, candidateM: CANDIDATE, clusterM: CLUSTER_M },
    features: ordered.map((it) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: it.coord },
      properties: {
        id: it.id,
        label: it.label,
        kind: it.kind,
        confidence: it.roads.some((r) => r.confidence === "low")
          ? "low"
          : "high",
        roads: it.roads,
      },
    })),
  };

  // ---------- 报告 ----------
  const perPair = {};
  for (const it of ordered) perPair[it.label] = (perPair[it.label] ?? 0) + 1;
  const withNode = new Set(
    ordered.flatMap((it) => it.roads.map((r) => r.roadId)),
  );
  const isolated = features
    .filter((f) => !withNode.has(f.roadId))
    .map((f) => f.name);

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      file: null,
      sha256: null,
      features: features.length,
      segments: segs.length,
    },
    params: {
      tolM: TOL,
      candidateM: CANDIDATE,
      clusterM: CLUSTER_M,
      minAngleDeg: MIN_ANGLE_DEG,
    },
    totals: {
      nodes: ordered.length,
      kind: ordered.reduce(
        (m, it) => ({ ...m, [it.kind]: (m[it.kind] ?? 0) + 1 }),
        {},
      ),
      gapNodes: ordered.filter((it) => it.gapM > 0).length,
      lowConfidence: ordered.filter((it) =>
        it.roads.some((r) => r.confidence === "low"),
      ).length,
      pairs: Object.keys(perPair).length,
      nearMiss: nearMiss.size,
      overlaps: overlaps.length,
      roadsWithNode: withNode.size,
      roadsTotal: features.length,
    },
    perPair,
    nearMiss: [...nearMiss.values()].sort((a, b) => a.gapM - b.gapM),
    isolated,
    overlaps,
  };

  return { roads, intersections, report };
}

// ---------- CLI ----------
const isMain = () =>
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

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

  const ROADS = pathArg("roads", path.join(ROOT, "data/roads.geojson"));
  const OUT = pathArg("out", path.join(ROOT, "data/intersections.geojson"));
  const REPORT_DIR = pathArg(
    "report",
    path.join(ROOT, "reports/intersections"),
  );

  const WRITE = process.argv.includes("--write");
  const TOL = numOf("tol", 3);
  const CANDIDATE = numOf("candidate", 10);
  const CLUSTER_M = numOf("cluster", 1);

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

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  requireFile(ROADS, "路网文件");

  const roads = JSON.parse(
    fs.readFileSync(ROADS, "utf8").replace(/^\uFEFF/, ""),
  );
  const roadsSha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(ROADS))
    .digest("hex");

  let built;
  try {
    built = buildNetwork(roads, {
      tol: TOL,
      candidate: CANDIDATE,
      clusterM: CLUSTER_M,
    });
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  const { roads: outRoads, intersections, report } = built;
  report.source.file = displayPath(ROADS);
  report.source.sha256 = roadsSha;

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${today}.json`);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(reportPath, body, "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "latest.json"), body, "utf8");

  if (WRITE) {
    const crlf = (obj) =>
      `${JSON.stringify(obj, null, 2)}\n`.replace(/\n/g, "\r\n");
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, crlf(intersections), "utf8");
    fs.writeFileSync(ROADS, crlf(outRoads), "utf8");
  }

  const t = report.totals;
  console.log(
    `[${WRITE ? "write" : "dry-run"}] 路网 ${displayPath(ROADS)} · 交点 ${displayPath(OUT)} · 报告 ${displayPath(REPORT_DIR)}`,
  );
  console.log(
    `[${WRITE ? "write" : "dry-run"}] 交点 ${t.nodes}（${JSON.stringify(t.kind)}，其中吸附 ${t.gapNodes}）`,
  );
  console.log(
    `路对 ${t.pairs}；有交点道路 ${t.roadsWithNode}/${t.roadsTotal}；贯通近失 ${t.nearMiss}；共线重叠 ${t.overlaps}；低置信 ${t.lowConfidence}`,
  );
  console.log(`报告 → ${displayPath(reportPath)}`);
  for (const g of report.nearMiss.slice(0, 10))
    console.log(`  近失 ${g.names.join("×")} ${g.gapM}m / ${g.angleDeg}°`);
  if (report.isolated.length)
    console.log(
      `无交点道路 ${report.isolated.length} 条：${report.isolated.join("、")}`,
    );
}
