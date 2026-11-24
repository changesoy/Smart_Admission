/**
 * zone-geometry.js - 学区几何计算基元
 *
 * 零依赖、无 DOM、无 Node API，脚本与浏览器端可共用。
 * 坐标统一为 [经度, 纬度]（WGS84）；长度与面积按当地纬度投影到米制平面计算。
 * 本文件只做纯计算，不读写文件、不打印。
 */

const EARTH_RADIUS_M = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;

/** 判定点是否落在边界上的距离阈值（米） */
export const BOUNDARY_EPS_M = 1e-6;

/** 交叉积判为零的阈值（以度为单位，仅用于判断共线与端点接触） */
const CROSS_EPS = 1e-15;

/** 每条经度、纬度对应的米数（按给定纬度） */
export const metersPerDegree = (lat) => {
  const phi = lat * DEG_TO_RAD;
  return {
    lng: DEG_TO_RAD * EARTH_RADIUS_M * Math.cos(phi),
    lat: DEG_TO_RAD * EARTH_RADIUS_M,
  };
};

/** 环是否闭合（首尾坐标严格相等） */
export const isRingClosed = (ring) =>
  Array.isArray(ring) &&
  ring.length > 1 &&
  ring[0][0] === ring[ring.length - 1][0] &&
  ring[0][1] === ring[ring.length - 1][1];

/** 去掉闭合环末尾的重复点；未闭合环原样返回 */
export const ringVertices = (ring) =>
  isRingClosed(ring) ? ring.slice(0, -1) : ring.slice();

/** 两点间距离（米） */
export const distanceM = (a, b) => {
  const { lng, lat } = metersPerDegree((a[1] + b[1]) / 2);
  return Math.hypot((a[0] - b[0]) * lng, (a[1] - b[1]) * lat);
};

/** 点到线段的距离（米） */
export const pointToSegmentDistanceM = (p, a, b) => {
  const { lng, lat } = metersPerDegree((p[1] + a[1] + b[1]) / 3);
  const bx = (b[0] - a[0]) * lng;
  const by = (b[1] - a[1]) * lat;
  const px = (p[0] - a[0]) * lng;
  const py = (p[1] - a[1]) * lat;
  const lengthSquared = bx * bx + by * by;
  if (lengthSquared === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
  return Math.hypot(px - t * bx, py - t * by);
};

/** 点到折线（顶点序列）的距离（米） */
export const pointToPolylineDistanceM = (p, line) => {
  if (!Array.isArray(line) || line.length === 0)
    return Number.POSITIVE_INFINITY;
  if (line.length === 1) return distanceM(p, line[0]);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i += 1) {
    min = Math.min(min, pointToSegmentDistanceM(p, line[i], line[i + 1]));
  }
  return min;
};

/** 环的有向面积（平方米）；闭合方向为顺时针时结果为负 */
export const ringSignedAreaM2 = (ring) => {
  const points = ringVertices(ring);
  if (points.length < 3) return 0;
  const [origin] = points;
  const { lng, lat } = metersPerDegree(
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  );
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum +=
      (current[0] - origin[0]) * lng * ((next[1] - origin[1]) * lat) -
      (next[0] - origin[0]) * lng * ((current[1] - origin[1]) * lat);
  }
  return sum / 2;
};

/** 环的面积（平方米，无符号） */
export const ringAreaM2 = (ring) => Math.abs(ringSignedAreaM2(ring));

/** 点是否在环内；返回 { inside, onBoundary } */
export const pointInRing = (point, ring) => {
  const points = ringVertices(ring);
  if (points.length < 3) return { inside: false, onBoundary: false };
  const [x, y] = point;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (pointToSegmentDistanceM(point, a, b) <= BOUNDARY_EPS_M) {
      return { inside: false, onBoundary: true };
    }
  }

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const crossesRay =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crossesRay) inside = !inside;
  }
  return { inside, onBoundary: false };
};

/** 交叉积：向量 ab 与 ac 的叉乘（度²，仅用于符号判断） */
const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const isWithinBox = (p, a, b) =>
  p[0] >= Math.min(a[0], b[0]) - CROSS_EPS &&
  p[0] <= Math.max(a[0], b[0]) + CROSS_EPS &&
  p[1] >= Math.min(a[1], b[1]) - CROSS_EPS &&
  p[1] <= Math.max(a[1], b[1]) + CROSS_EPS;

/**
 * 线段相交判定
 * 返回 { type: "none" | "touch" | "proper" | "collinear", point? }
 * proper 表示两条线段的内部相交（即边交叉）。
 */
export const segmentIntersection = (a, b, c, d) => {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  const oppositeSigns = (x, y) => (x > 0 && y < 0) || (x < 0 && y > 0);

  if (oppositeSigns(d1, d2) && oppositeSigns(d3, d4)) {
    // d3/d4 是 a、b 相对 CD 的符号，比例对应 AB 上的位置，必须在 AB 上插值
    const t = d3 / (d3 - d4);
    return {
      type: "proper",
      point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    };
  }

  const allCollinear =
    Math.abs(d1) <= CROSS_EPS &&
    Math.abs(d2) <= CROSS_EPS &&
    Math.abs(d3) <= CROSS_EPS &&
    Math.abs(d4) <= CROSS_EPS;

  if (allCollinear) {
    const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
    const [a0, a1] = [Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis])];
    const [c0, c1] = [Math.min(c[axis], d[axis]), Math.max(c[axis], d[axis])];
    const overlap = Math.min(a1, c1) - Math.max(a0, c0);
    if (overlap > CROSS_EPS) return { type: "collinear" };
  }

  if (Math.abs(d1) <= CROSS_EPS && isWithinBox(c, a, b))
    return { type: "touch", point: c };
  if (Math.abs(d2) <= CROSS_EPS && isWithinBox(d, a, b))
    return { type: "touch", point: d };
  if (Math.abs(d3) <= CROSS_EPS && isWithinBox(a, c, d))
    return { type: "touch", point: a };
  if (Math.abs(d4) <= CROSS_EPS && isWithinBox(b, c, d))
    return { type: "touch", point: b };

  return { type: "none" };
};

/**
 * 环的自相交检查
 * 返回 [{ type, point?, segmentA, segmentB }]，只报非相邻边的相交。
 */
export const ringSelfIntersections = (ring) => {
  const points = ringVertices(ring);
  const count = points.length;
  if (count < 4) return [];
  const results = [];
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === count - 1);
      if (adjacent) continue;
      const result = segmentIntersection(
        points[i],
        points[(i + 1) % count],
        points[j],
        points[(j + 1) % count],
      );
      if (result.type === "none") continue;
      results.push({
        type: result.type,
        point: result.point,
        segmentA: i,
        segmentB: j,
      });
    }
  }
  return results;
};

/** 顶点的精确匹配键；用于判断两环是否使用同一份坐标 */
export const vertexKey = (coord) => `${coord[0]},${coord[1]}`;
