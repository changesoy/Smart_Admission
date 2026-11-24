#!/usr/bin/env node
/**
 * extract-zone-specs.mjs - L1 四至段序列抽取：把现状学区环逐顶点反查「最贴近的具名要素」，
 * 写成「从某交点出发 → 沿某路 → 到某交点 → …… → 回到起点」的可执行段序列。
 *
 * 为什么需要这一步：官方四至原文存在错别字、复制粘贴过时文件的问题
 * （已实例：zone_006 东界、zone_031 西界原文写「双龙河」，实际环贴的是唐王河）。
 * 因此以「环上连续线段的中点到具名要素的距离 ≤ tol」为准，
 * 原文只作为对照，不直接当真。
 *
 * 每条边给出三态来源：
 *   text      原文点名了该要素，且环确实连续贴它
 *   ring-snap 原文没点名（或点名错了），环连续贴某具名要素 → 以该要素为准
 *   legacy    环附近容差内没有任何具名要素 → 保留旧环几何，登记待补线
 * 原文点名但环找不到对应要素的，进入 textGaps，不静默丢弃。
 *
 * 用法：
 *   node scripts/extract-zone-specs.mjs                       # dry-run：只打印摘要
 *   node scripts/extract-zone-specs.mjs --write               # 写 data/zone_specs/<zoneId>.json
 *   node scripts/extract-zone-specs.mjs --all --write         # 14 个学区全量抽取
 *   node scripts/extract-zone-specs.mjs --only zone_031,zone_032 --write
 *
 * 参数：
 *   --only      指定 zoneId（逗号分隔），默认 4 所试点
 *   --all       抽取全部学区
 *   --tol       线段中点到具名要素的容差（米），默认 30
 *   --minLen    短于此长度的有名碎段并入前一段（米），默认 200
 *   --out       输出目录，默认 data/zone_specs
 *   --write     落盘；缺省只打印
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { partsOf } from "./lib/intersect-core.mjs";
import {
  distanceM,
  isRingClosed,
  pointToPolylineDistanceM,
  pointToSegmentDistanceM,
  ringVertices,
} from "../js/geo/zone-geometry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_ONLY = ["zone_031", "zone_032", "zone_040", "zone_006"];

/** 段端点离最近路口超过该距离，视为该段起止点无法落到真实路口上，需人工裁定 */
const REACH_M = 25;

/** 试点学区对应的学校名，仅用于打印时人能看懂 */
const PILOT_NAMES = {
  zone_031: "泰安市泰山区凤台学校（初中部）",
  zone_032: "泰安市泰山区凤台小学",
  zone_040: "山东省泰安东岳中学兴隆校区",
  zone_006: "山东省泰安第六中学新校区",
};

const parseArgs = (argv) => {
  const opts = {
    zones: path.join(ROOT, "data/zones.geojson"),
    roads: path.join(ROOT, "data/roads.geojson"),
    intersections: path.join(ROOT, "data/intersections.geojson"),
    out: path.join(ROOT, "data/zone_specs.json"),
    tol: 30,
    minLen: 200,
    write: false,
    all: false,
    only: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[i + 1];
    if (arg === "--write") {
      opts.write = true;
    } else if (arg === "--all") {
      opts.all = true;
    } else if (arg === "--only") {
      opts.only = String(next())
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === "--tol") {
      opts.tol = Number(next());
      i += 1;
    } else if (arg === "--minLen") {
      opts.minLen = Number(next());
      i += 1;
    } else if (arg === "--out") {
      opts.out = path.resolve(next());
      i += 1;
    } else if (arg === "--zones") {
      opts.zones = path.resolve(next());
      i += 1;
    } else if (arg === "--roads") {
      opts.roads = path.resolve(next());
      i += 1;
    } else if (arg === "--intersections") {
      opts.intersections = path.resolve(next());
      i += 1;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return opts;
};

const loadJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));

/** 把要素几何拆成若干条折线 */
const linesOf = (feature) => {
  if (!feature.geometry) return [];
  if (feature.geometry.type === "LineString")
    return [feature.geometry.coordinates];
  if (feature.geometry.type === "MultiLineString") return partsOf(feature);
  return [];
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.floor((sorted.length - 1) * p),
  );
  return sorted[index];
};

const round = (v, digits = 1) => Number(v.toFixed(digits));

const numberOrNull = (v) => (Number.isInteger(v) ? v : null);

/** 依据边长中点相对环重心的方位给出东/南/西/北标签，仅用于展示 */
const sideOf = (from, to, centroid) => {
  const midX = (from[0] + to[0]) / 2 - centroid[0];
  const midY = (from[1] + to[1]) / 2 - centroid[1];
  const { lng, lat } = {
    lng: Math.cos((centroid[1] * Math.PI) / 180) * 111320,
    lat: 111320,
  };
  if (Math.abs(midX * lng) >= Math.abs(midY * lat)) {
    return midX > 0 ? "东" : "西";
  }
  return midY > 0 ? "北" : "南";
};

const centroidOf = (vertices) => {
  const sum = vertices.reduce(
    (acc, c) => [acc[0] + c[0], acc[1] + c[1]],
    [0, 0],
  );
  return [sum[0] / vertices.length, sum[1] / vertices.length];
};

/** 单个顶点最近的具名要素（线段级最近，再取该线段较近的端点作为道路顶点号） */
const nearestFeature = (coord, roadFeatures, tol) => {
  let best = null;
  for (const feature of roadFeatures) {
    for (let part = 0; part < feature.lines.length; part += 1) {
      const line = feature.lines[part];
      for (let i = 0; i < line.length - 1; i += 1) {
        const d = pointToSegmentDistanceM(coord, line[i], line[i + 1]);
        if (best && d >= best.distM) continue;
        const dv0 = distanceM(coord, line[i]);
        const dv1 = distanceM(coord, line[i + 1]);
        best = {
          roadId: feature.roadId,
          name: feature.name,
          type: feature.type,
          distM: d,
          part,
          roadVertex: dv0 <= dv1 ? i : i + 1,
          withinTol: d <= tol,
        };
      }
    }
  }
  return best;
};

/** 逐线段（取中点）最近要素 → 连续同要素的线段组成一段 */
const buildRuns = (nearestAt) => {
  const runs = [];
  let current = null;
  nearestAt.forEach((near, index) => {
    const key = near.withinTol ? near.roadId : null;
    if (!current || current.roadId !== key) {
      current = { roadId: key, name: near.name, segments: [], dists: [] };
      runs.push(current);
    }
    current.segments.push(index);
    current.dists.push(near.distM);
    current.name = current.name || near.name;
  });
  // 环首尾同要素要合并成一段（起点任意，不能把同一条边拆成两段）
  if (
    runs.length > 1 &&
    runs[0].roadId &&
    runs[0].roadId === runs[runs.length - 1].roadId
  ) {
    const first = runs.shift();
    const last = runs.pop();
    runs.unshift({
      roadId: last.roadId,
      name: last.name || first.name,
      segments: [...last.segments, ...first.segments],
      dists: [...last.dists, ...first.dists],
    });
  }
  return runs;
};

/**
 * 把「过短」的有名段并入其前一段：路口附近常有一两段线段与横穿道路更近，
 * 若单列会把手绘环切成一堆碎块。并入时把被吞并要素记进 absorbed，不静默丢。
 * 无名段（legacy）不吸收——它是真实缺口，必须留在表里。
 */
const absorbShortRuns = (runs, minLenM) => {
  const out = runs.map((run) => ({
    ...run,
    segments: [...run.segments],
    dists: [...run.dists],
  }));
  let guard = 0;
  while (out.length > 1 && guard < 50) {
    guard += 1;
    const index = out.findIndex((run) => run.roadId && run.lengthM < minLenM);
    if (index === -1) break;
    const run = out[index];
    // 一律并入环上的前一段，保证合并后顶点顺序不颠倒（i=0 时前一段是环尾）
    const prevIndex = index > 0 ? index - 1 : out.length - 1;
    const prev = out[prevIndex];
    prev.absorbed = [
      ...(prev.absorbed || []),
      ...(run.absorbed || []),
      {
        roadId: run.roadId,
        name: run.name,
        lengthM: round(run.lengthM),
        maxDistM: round(Math.max(...run.dists)),
      },
    ];
    prev.segments = [...prev.segments, ...run.segments];
    prev.lengthM += run.lengthM;
    out.splice(index, 1);
  }
  return out;
};

/**
 * 段序列契约自检：环必须闭合、线段不重不漏、段与段之间接缝为 0。
 * 只要有一项不成立，这张表就不能拿去派生环。
 */
const verifyRing = (ring, vertices, runs) => {
  const covered = runs.flatMap((run) => run.segments);
  const maxSeamM = runs.reduce((max, run, index) => {
    const prev = runs[(index + runs.length - 1) % runs.length];
    const prevTo =
      vertices[(prev.segments[prev.segments.length - 1] + 1) % vertices.length];
    return Math.max(max, distanceM(prevTo, vertices[run.segments[0]]));
  }, 0);
  const result = {
    closed: isRingClosed(ring),
    vertexCount: vertices.length,
    segmentsCovered: covered.length,
    segmentsDeduped: new Set(covered).size,
    maxSeamM: round(maxSeamM, 3),
  };
  return {
    ...result,
    ok:
      result.closed &&
      result.segmentsCovered === vertices.length &&
      result.segmentsDeduped === vertices.length &&
      result.maxSeamM === 0,
  };
};

/** 把四至原文切成「东至某要素」这样的子句；原文存在错别字，仅用于对照 */
const parseClauses = (text) => {
  const clauses = [];
  const pattern =
    /([东南西北])\s*(?:至|临|界|靠|接|止)\s*([^、。；，（）()]+)/g;
  let match = pattern.exec(text);
  while (match) {
    clauses.push({
      dir: match[1],
      raw: match[0].trim(),
      body: match[2].trim(),
    });
    match = pattern.exec(text);
  }
  return clauses;
};

/** 子句里是否点名了某要素（取最长匹配，避免「明堂河」被「明堂路」抢走） */
const clauseOfName = (clauses, name) =>
  clauses.find((clause) => clause.body.includes(name)) || null;

/** 在该要素的所有路口里，找离给定坐标最近且不超过 REACH_M 的那个；找不到就是「这个拐点没落在真实路口上」 */
const pickNodeNear = (nodes, coord) => {
  let best = null;
  for (const node of nodes) {
    const d = distanceM(coord, node.coord);
    if (d > REACH_M) continue;
    if (!best || d < best.d) best = { ...node, d };
  }
  return best;
};

/**
 * 抽取单个学区
 * @param {object} zone zones.geojson 的单个 Feature
 * @param {{roadFeatures: Array, nodesByRoad: Map, roadNames: string[], tol: number, minLen: number}} ctx
 */
const buildSpec = (zone, ctx) => {
  const props = zone.properties || {};
  const polygons =
    zone.geometry.type === "Polygon"
      ? [zone.geometry.coordinates]
      : zone.geometry.coordinates || [];
  const text = props.boundaryText || "";
  const clauses = parseClauses(text);
  const textNames = [
    ...new Set(
      clauses.flatMap((clause) =>
        ctx.roadNames.filter((name) => clause.body.includes(name)),
      ),
    ),
  ];

  const rings = polygons.map((polygon, polygonIndex) => {
    const [ring] = polygon;
    const vertices = ringVertices(ring);
    const centroid = centroidOf(vertices);
    // 以线段中点为探针：手绘环的顶点稀疏，只看顶点会漏掉「整段贴着某条河」的边
    const vertexCount = vertices.length;
    const midpoints = vertices.map((coord, idx) => {
      const next = vertices[(idx + 1) % vertexCount];
      return [(coord[0] + next[0]) / 2, (coord[1] + next[1]) / 2];
    });
    const nearestAt = midpoints.map((coord) =>
      nearestFeature(coord, ctx.roadFeatures, ctx.tol),
    );
    const runs = absorbShortRuns(
      buildRuns(nearestAt).map((run) => ({
        ...run,
        lengthM: run.segments.reduce(
          (sum, idx) =>
            sum + distanceM(vertices[idx], vertices[(idx + 1) % vertexCount]),
          0,
        ),
      })),
      ctx.minLen,
    );

    const steps = runs.map((run, seq) => {
      const [firstSeg] = run.segments;
      const lastSeg = run.segments[run.segments.length - 1];
      const closing = (idx) => vertices[(idx + 1) % vertexCount];
      const fromCoord = vertices[firstSeg];
      const toCoord = closing(lastSeg);
      const lengthM = run.segments.reduce(
        (sum, idx) => sum + distanceM(vertices[idx], closing(idx)),
        0,
      );
      const roadVertices = run.segments
        .map((idx) => nearestAt[idx].roadVertex)
        .filter((v) => Number.isInteger(v));
      const source = !run.roadId
        ? "legacy"
        : textNames.includes(run.name)
          ? "text"
          : "ring-snap";
      const nodes = run.roadId ? ctx.nodesByRoad.get(run.roadId) || [] : [];
      const span = roadVertices.length
        ? [Math.min(...roadVertices), Math.max(...roadVertices)]
        : null;

      const fromNode = roadVertices.length
        ? pickNodeNear(nodes, fromCoord)
        : null;
      const toNode = roadVertices.length ? pickNodeNear(nodes, toCoord) : null;

      // 端点既给坐标（环上的拐点），也给最接近的路口引用（便于人读）
      const describe = (node, coord, roadVertex) => ({
        coord,
        roadVertex: numberOrNull(roadVertex),
        viaNode: node
          ? {
              nodeId: node.id,
              label: node.label,
              vertex: node.vertex,
              offsetM: round(distanceM(coord, node.coord)),
            }
          : null,
      });

      const clause = run.roadId ? clauseOfName(clauses, run.name) : null;
      const nodeOffset = fromNode ? distanceM(fromCoord, fromNode.coord) : null;
      const toOffset = toNode ? distanceM(toCoord, toNode.coord) : null;

      return {
        seq: seq + 1,
        side: clause ? clause.dir : sideOf(fromCoord, toCoord, centroid),
        sideSource: clause ? "text" : "geometry",
        along: run.roadId
          ? {
              roadId: run.roadId,
              name: run.name,
              type: nearestAt[firstSeg].type,
            }
          : null,
        vertexSpan: span,
        from: describe(fromNode, fromCoord, roadVertices[0]),
        to: describe(toNode, toCoord, roadVertices[roadVertices.length - 1]),
        ringVertexSpan: [firstSeg, lastSeg + 1],
        ringVertices: run.segments.length + 1,
        lengthM: round(lengthM),
        snap: {
          p50M: round(percentile(run.dists, 0.5)),
          p90M: round(percentile(run.dists, 0.9)),
          maxM: round(Math.max(...run.dists)),
        },
        source,
        // 被并入本段的短段（路口附近的碎块）记在这里，不静默丢
        absorbed: run.absorbed || [],
        // 端点偏离最近路口 > REACH_M，或该段内根本没有路口 → 派生时需要人工确认
        reachM: Math.max(nodeOffset || 0, toOffset || 0) || null,
        needsRuling:
          !fromNode ||
          !toNode ||
          fromNode.id === toNode.id ||
          (nodeOffset || 0) > REACH_M ||
          (toOffset || 0) > REACH_M,
        text: clause ? clause.raw : "",
      };
    });

    // 原文点名、但环上没有对应要素 → 必须登记，不能静默丢
    const covered = new Set(
      steps.map((s) => s.along && s.along.name).filter(Boolean),
    );
    const textGaps = textNames
      .filter((name) => !covered.has(name))
      .map((name) => {
        const feature = ctx.roadFeatures.find((f) => f.name === name);
        // 量化「原文点名但环没用它」到底差多远：取环各线段中点到该要素的最近距离
        const nearestRingM = feature
          ? round(
              Math.min(
                ...midpoints.map((mid) =>
                  Math.min(
                    ...feature.lines.map((line) =>
                      pointToPolylineDistanceM(mid, line),
                    ),
                  ),
                ),
              ),
            )
          : null;
        return {
          name,
          inRoadNetwork: Boolean(feature),
          nearestRingM,
          note: feature
            ? `路网有该要素（${feature.roadId}），但环上没有连续贴合段，最近处 ${nearestRingM} m`
            : "路网缺少该要素，该边只能沿用旧环几何（legacy），待补线",
        };
      });

    return {
      polygonIndex,
      steps,
      textGaps,
      needsRulingSteps: steps.filter((s) => s.needsRuling).map((s) => s.seq),
      absorbedSteps: steps.filter((s) => s.absorbed.length).map((s) => s.seq),
      ringVertexCount: vertices.length,
      verification: verifyRing(ring, vertices, runs),
      ring,
    };
  });

  const rulings = (props.boundaryRulings || []).map((r) => ({
    edge: r.edge,
    original: r.original,
    adopted: r.adopted,
    geometryRef: r.geometryRef,
    reason: r.reason,
    decidedAt: r.decidedAt,
    decider: r.decider,
  }));

  return {
    schemaVersion: 1,
    zoneId: props.zoneId,
    zoneName: props.zoneName,
    schoolName: PILOT_NAMES[props.zoneId] || props.zoneName,
    stage: props.stage,
    schoolId: props.schoolId,
    sourceOfTruth: "逐线段反查现状环 → 最贴近具名要素；官方原文仅作对照",
    originText: text,
    rulings,
    textNames,
    changeLog: [
      {
        date: "2026-10-26",
        action: "生成逐边来源表",
        detail:
          "对现状环逐线段（取中点）反查最近具名要素，连续贴合段写成「从节点出发沿该要素到下一节点」；原文点名但环未贴合的登记进 textGaps",
      },
      ...rulings.map((r) => ({
        date: r.decidedAt,
        action: `${r.edge}界采信 ${r.adopted}`,
        detail: `原文写 ${r.original}，环实际贴合 ${r.geometryRef}；${r.reason}`,
      })),
    ],
    rings,
  };
};

const main = () => {
  const opts = parseArgs(process.argv);
  const zones = loadJson(opts.zones);
  const roads = loadJson(opts.roads);
  const intersections = loadJson(opts.intersections);

  const roadFeatures = roads.features
    .filter((f) => f.properties && f.properties.roadId)
    .map((f) => ({
      roadId: f.properties.roadId,
      name: f.properties.name,
      type: f.properties.type,
      lines: linesOf(f),
    }))
    .filter((f) => f.lines.length);

  const roadNames = [
    ...new Set(roadFeatures.map((f) => f.name).filter(Boolean)),
  ];

  // 节点按要素归组，附带该要素上的顶点号，供「从某节点到某节点」引用
  const nodesByRoad = new Map();
  intersections.features.forEach((feature) => {
    const props = feature.properties || {};
    (props.roads || []).forEach((member) => {
      if (!nodesByRoad.has(member.roadId)) nodesByRoad.set(member.roadId, []);
      nodesByRoad.get(member.roadId).push({
        id: props.id,
        label: props.label,
        part: member.part,
        vertex: member.vertex,
        coord: feature.geometry.coordinates,
      });
    });
  });

  const wanted = opts.all
    ? zones.features.map((f) => f.properties.zoneId)
    : opts.only || DEFAULT_ONLY;
  const selected = zones.features.filter((f) =>
    wanted.includes(f.properties.zoneId),
  );

  if (!selected.length)
    throw new Error("没有匹配到任何学区，请检查 --only / --all");

  const specs = selected.map((zone) =>
    buildSpec(zone, {
      roadFeatures,
      nodesByRoad,
      roadNames,
      tol: opts.tol,
      minLen: opts.minLen,
    }),
  );

  // ---------- 摘要 ----------
  specs.forEach((spec) => {
    const [ring] = spec.rings;
    const name = spec.schoolName || spec.zoneName;
    console.log(`\n${spec.zoneId}  ${name}  ring=${ring.ringVertexCount} 点`);
    ring.steps.forEach((step) => {
      const along = step.along
        ? `${step.along.roadId} ${step.along.name}`
        : "（无具名要素 legacy）";
      const endpoint = (point) =>
        point.viaNode
          ? `${point.viaNode.nodeId}@v${point.viaNode.vertex}(±${point.viaNode.offsetM}m)`
          : `v${point.roadVertex ?? "-"}`;
      console.log(
        `  ${String(step.seq).padStart(2)}. ${step.side} ${along}  ${endpoint(step.from)} → ${endpoint(step.to)}  ` +
          `${step.lengthM}m  p90=${step.snap.p90M}m  [${step.source}]${step.needsRuling ? " ⚠待裁定" : ""}`,
      );
      step.absorbed.forEach((item) => {
        console.log(
          `      ↳ 并入 ${item.name || "无名要素"} ${item.lengthM}m（最远 ${item.maxDistM}m）`,
        );
      });
    });
    ring.textGaps.forEach((gap) => {
      console.log(`  ! 原文点名未贴合: ${gap.name} — ${gap.note}`);
    });
    const v = ring.verification;
    console.log(
      `  契约自检: ${v.ok ? "通过" : "未通过"}  闭合=${v.closed}  线段覆盖=${v.segmentsCovered}/${v.vertexCount}  接缝最长=${v.maxSeamM}m`,
    );
  });

  const broken = specs.flatMap((spec) =>
    spec.rings
      .filter((ring) => !ring.verification.ok)
      .map((ring) => `${spec.zoneId}#${ring.polygonIndex}`),
  );
  if (broken.length) {
    throw new Error(`段序列契约自检未通过：${broken.join(", ")}`);
  }

  if (!opts.write) {
    console.log("\n[dry-run] 未写盘；加 --write 才生成 data/zone_specs.json");
    return;
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toLocaleDateString("sv-SE"),
    generatedBy: "scripts/extract-zone-specs.mjs",
    sourceOfTruth: "逐线段反查现状环 → 最贴近具名要素；官方原文仅作对照",
    rules: {
      ringSnap: `以线段中点为探针反查最近具名要素；连续贴同一要素的线段组成一段`,
      sourceStates: {
        text: "原文点名该要素，环也连续贴它",
        "ring-snap": "原文没点名或点名错了，环连续贴该要素 → 以环为准",
        legacy: "容差内没有任何具名要素 → 沿用旧环几何，需补线",
      },
      needsRuling: `段端点离最近路口超过 ${REACH_M} m，或该段内没有路口 → 派生环之前必须人工确认`,
      absorb: `长度不足 ${opts.minLen} m 的有名碎段并入其前一段，被吞并要素记入该段 absorbed，snap 统计只反映主段；无名（legacy）段不吸收`,
      ring: "每段 from/to 首尾相接，最后一段的 to 回到第一段的 from，构成闭合一圈；脚本内建自检：闭合、线段不重不漏、接缝 0 m，任一不成立则拒绝写盘",
    },
    process: [
      {
        date: "2026-10-26",
        step: "补线",
        detail:
          "唐王河在四至里被三所学校引用（凤台小学西界、花园校区东界、小井小学），但路网缺线；从 OSM 拉取无名 ditch 串链补为 river_007，并重算交点，发布 2026.11.09",
      },
      {
        date: "2026-10-26",
        step: "裁定",
        detail:
          "zone_006 东界、zone_031 西界原文写「双龙河」，但环上连续 20+ 顶点贴唐王河（0~23.4 m），双龙河在 670~1036 m 外；采信环，裁定为唐王河，写进 zones.geojson 的 boundaryRulings（boundaryText 保留官方原文），发布 2026.11.10",
      },
      {
        date: "2026-10-26",
        step: "补线",
        detail:
          "唐王河北端由河尾沿 zone_031 西界北延至北上高大街垂足（约 700 m、3 点），补足四至「沿唐王河向北接北上高大街」缺口；重算交点后新增「唐王河×北上高大街」",
      },
      {
        date: "2026-10-26",
        step: "补线",
        detail:
          "五马街（凤台学校初中部南界）在路网与 OSM 均无具名线（OSM 仅有同名公交站 POI），按用户裁定复用 zone_031 南界现状环 v37→v50 入选为 road_062，dataStatus=boundary-derived（非实测中心线，待按影像重描替换）",
      },
      {
        date: "2026-10-26",
        step: "生成逐边来源表",
        detail:
          "对现状环逐线段（取中点）反查最贴近具名要素，连续贴合段写成「从某节点出发沿该要素到下一节点」；原文点名但环未贴合的登记进 textGaps，端点未落在真实路口的标记 needsRuling、并给出实际偏差",
      },
    ],
    zones: specs,
  };
  fs.writeFileSync(opts.out, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  console.log(
    `写入 ${path.relative(ROOT, opts.out)}（${specs.length} 个学区）`,
  );
};

main();
