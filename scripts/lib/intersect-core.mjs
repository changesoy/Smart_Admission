/**
 * intersect-core.mjs - 交点图谱的几何内核（纯函数，无 I/O）
 *
 * 坐标约定：传入/返回都是 GeoJSON 的 [lon, lat]；内部距离计算走米制平面投影。
 * 投影方式：以泰安纬度为中心的等距圆柱（1 度纬度 ≈ 111320 m），
 * 误差在城区 20 km 范围内 < 0.1%，足够判定 1–10 m 级容差。
 */

const EARTH_R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** 两点球面距离（米），与 scripts/roads 下各脚本口径一致 */
export function distanceM(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** 等距圆柱投影器：toXY 只做线性缩放，toLonLat 为其逆 */
export function makeProjector(lat0) {
  const kx = 111320 * Math.cos(rad(lat0));
  const ky = 111320;
  return {
    toXY: (p) => [p[0] * kx, p[1] * ky],
    toLonLat: (p) => [p[0] / kx, p[1] / ky],
  };
}

/** 把 Feature 拆成 part 数组（每个 part 是 [lon,lat] 数组） */
export function partsOf(feature) {
  const g = feature.geometry;
  return g.type === "MultiLineString" ? g.coordinates : [g.coordinates];
}

/** 逐顶点累计里程（米），长度与 line 一致，首项为 0 */
export function cumulativeDistances(line) {
  const out = [0];
  for (let i = 1; i < line.length; i += 1)
    out.push(out[i - 1] + distanceM(line[i - 1], line[i]));
  return out;
}

/**
 * 线段最近点（XY 空间）
 * @returns {{dist:number, t:number, foot:[number,number]}}
 */
export function closestPointOnSegment(p, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const foot = [a[0] + t * vx, a[1] + t * vy];
  return { dist: Math.hypot(p[0] - foot[0], p[1] - foot[1]), t, foot };
}

const crossZ = (o, a, b) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** 点到直线（无限长）的有符号距离（米） */
const signedDistToLine = (p, a, b) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return crossZ(a, b, p) / len;
};

/**
 * 两线段关系（XY 空间）
 * @returns
 *   {kind:"cross", point:[x,y], tA:number, tB:number} |
 *   {kind:"collinear", tA0:number, tA1:number, tB0:number, tB1:number} |
 *   null
 * 端点落在另一段上算 cross（tA/tB 取 0 或 1）。
 */
export function segmentRelation(a1, a2, b1, b2, epsM = 1e-6) {
  const den =
    (a2[1] - a1[1]) * (b2[0] - b1[0]) - (a2[0] - a1[0]) * (b2[1] - b1[1]);
  const dA1 = signedDistToLine(a1, b1, b2);
  const dA2 = signedDistToLine(a2, b1, b2);
  const dB1 = signedDistToLine(b1, a1, a2);
  const dB2 = signedDistToLine(b2, a1, a2);

  if (den !== 0) {
    // 快速排除：两段各自落在对方直线同侧
    const sameA = (dA1 > epsM && dA2 > epsM) || (dA1 < -epsM && dA2 < -epsM);
    const sameB = (dB1 > epsM && dB2 > epsM) || (dB1 < -epsM && dB2 < -epsM);
    if (sameA || sameB) return null;
    const vx = a2[0] - a1[0];
    const vy = a2[1] - a1[1];
    const wx = b1[0] - a1[0];
    const wy = b1[1] - a1[1];
    // 解 a1 + tA·(a2-a1) = b1 + tB·(b2-b1)；den = -(r×s)
    const tA = (wx * (b2[1] - b1[1]) - wy * (b2[0] - b1[0])) / -den;
    const tB = (wx * vy - wy * vx) / -den;
    if (tA < -epsM || tA > 1 + epsM || tB < -epsM || tB > 1 + epsM) return null;
    return { kind: "cross", point: [a1[0] + tA * vx, a1[1] + tA * vy], tA, tB };
  }

  // 平行：先判共线（a1 到 b 线的距离够近），再看区间是否重叠
  if (Math.abs(dA1) > 0.01) return null;
  const lenA = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]);
  if (lenA === 0) return null;
  const ux = (a2[0] - a1[0]) / lenA;
  const uy = (a2[1] - a1[1]) / lenA;
  const proj = (p) => (p[0] - a1[0]) * ux + (p[1] - a1[1]) * uy;
  const b0 = proj(b1);
  const b1p = proj(b2);
  const lo = Math.min(b0, b1p);
  const hi = Math.max(b0, b1p);
  if (hi < 0 || lo > lenA) return null;
  return {
    kind: "collinear",
    tA0: Math.max(0, lo) / lenA,
    tA1: Math.min(lenA, hi) / lenA,
    tB0: b0 <= b1p ? Math.max(0, (Math.max(0, lo) - b0) / (b1p - b0)) : 0,
    tB1: 1,
  };
}

/**
 * 在 part 里按 (segIndex, t) 批量插点
 * @param line 原坐标数组
 * @param inserts [{segIndex, t, coord}]，coord 为 [lon,lat]
 * @returns {{line:Array, reused:boolean[]}} reused[i] 表示该点原本就有顶点
 * t≈0 / t≈1 时复用既有顶点，不重复插入（幂等的基础）。
 * 复用判据按距离：coord 距该段任一端点 ≤ reuseM 米即复用，不看参数 t，
 * 以免零长度段/重复顶点导致"贴着重插一次"。
 */
export function insertPointsIntoLine(line, inserts, reuseM = 0.05) {
  const sorted = [...inserts].sort(
    (p, q) => p.segIndex - q.segIndex || p.t - q.t,
  );
  const out = [line[0]];
  const reused = [];
  let k = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    while (k < sorted.length && sorted[k].segIndex === i) {
      const ins = sorted[k];
      const nearEnd =
        distanceM(ins.coord, line[i]) <= reuseM ||
        distanceM(ins.coord, line[i + 1]) <= reuseM;
      if (nearEnd) {
        reused.push(true); // 端点已存在，交给下面的统一 push
      } else {
        reused.push(false);
        out.push([
          Number(ins.coord[0].toFixed(7)),
          Number(ins.coord[1].toFixed(7)),
        ]);
      }
      k += 1;
    }
    out.push(line[i + 1]);
  }
  return { line: out, reused };
}

/**
 * 线段网格索引：按线段中点所在网格（含长度一半的 pad）建桶，供最近段查询与两两求交复用
 * @param entries 段数组，至少含 {roadIdx, part, segIndex, aXY, bXY}；额外字段原样保留
 * @param opts.gridM 网格边长（米），build 用 100、diagnose 用 50
 * @param opts.projector 可选投影器，段上没带 aXY/bXY 时用来补算
 * @returns {{segs:Array, buckets:Array, cellsNear:Function, nearest:Function}}
 *   buckets 为 grid.values() 的数组快照，顺序与旧实现一致
 */
export function createSegmentIndex(
  entries,
  { gridM = 100, projector = null } = {},
) {
  const cellKey = (x, y) => `${x}_${y}`;
  const cellRange = (p, pad) => ({
    x0: Math.floor((p[0] - pad) / gridM),
    x1: Math.floor((p[0] + pad) / gridM),
    y0: Math.floor((p[1] - pad) / gridM),
    y1: Math.floor((p[1] + pad) / gridM),
  });

  const grid = new Map();
  const segs = [];
  for (const entry of entries) {
    const seg =
      entry.aXY && entry.bXY
        ? entry
        : {
            ...entry,
            aXY: projector.toXY(entry.a),
            bXY: projector.toXY(entry.b),
          };
    segs.push(seg);
    const r = cellRange(
      [(seg.aXY[0] + seg.bXY[0]) / 2, (seg.aXY[1] + seg.bXY[1]) / 2],
      Math.hypot(seg.bXY[0] - seg.aXY[0], seg.bXY[1] - seg.aXY[1]) / 2,
    );
    for (let x = r.x0; x <= r.x1; x += 1) {
      for (let y = r.y0; y <= r.y1; y += 1) {
        const k = cellKey(x, y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(seg);
      }
    }
  }

  // 允许跨格重复，与旧实现的 cellsNear 行为一致
  const cellsNear = (p, pad) => {
    const r = cellRange(p, pad);
    const out = [];
    for (let x = r.x0; x <= r.x1; x += 1) {
      for (let y = r.y0; y <= r.y1; y += 1) {
        const bucket = grid.get(cellKey(x, y));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  };

  // 最近段：跳过 excludeRoadIdx，返回 {seg, dist, t, foot}
  const nearest = (p, pad, excludeRoadIdx = null) => {
    const r = cellRange(p, pad);
    let best = null;
    for (let x = r.x0; x <= r.x1; x += 1) {
      for (let y = r.y0; y <= r.y1; y += 1) {
        const bucket = grid.get(cellKey(x, y));
        if (!bucket) continue;
        for (const seg of bucket) {
          if (excludeRoadIdx !== null && seg.roadIdx === excludeRoadIdx)
            continue;
          const hit = closestPointOnSegment(p, seg.aXY, seg.bXY);
          if (!best || hit.dist < best.dist)
            best = { seg, dist: hit.dist, t: hit.t, foot: hit.foot };
        }
      }
    }
    return best;
  };

  return { segs, buckets: [...grid.values()], cellsNear, nearest };
}

/**
 * 半径聚类（XY 空间，贪心 + 坐标排序保证确定性）
 * @param items [{coord:[lon,lat]}]
 * @returns 分组下标数组
 */
export function clusterByRadius(items, radiusM, projector) {
  const pts = items.map((it) => projector.toXY(it.coord));
  const order = pts
    .map((p, i) => i)
    .sort((i, j) => pts[i][0] - pts[j][0] || pts[i][1] - pts[j][1] || i - j);
  const groups = [];
  const used = new Set();
  for (const i of order) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    for (const j of order) {
      if (used.has(j)) continue;
      if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) <= radiusM) {
        group.push(j);
        used.add(j);
      }
    }
    groups.push(group.sort((x, y) => x - y));
  }
  return groups;
}
