#!/usr/bin/env node
/**
 * network.mjs - 路网交点的单入口：build / diagnose / all
 *
 *   build     读路网 → 两两求交 → 内存里把插点写回路网 → 可选落盘
 *   diagnose  只读诊断 A（近邻节点）/ B（欠伸）/ C（过冲）→ 写报告
 *   all       并入新路 → 算交点 → 诊断，三段在内存里串联，不再落临时文件
 *
 * 默认全部 dry-run：只打印统计，不产生任何文件；加 --write 才落盘。
 *
 * 用法：
 *   node scripts/network.mjs build    [--roads ...] [--out ...] [--report ...] [--tol 3] [--candidate 10] [--cluster 1] [--write]
 *   node scripts/network.mjs diagnose [--roads ...] [--nodes ...] [--out ...] [--near 30] [--under-max 15]
 *   node scripts/network.mjs all      [--add ...] [--base ...] [--out ...] [--write]
 *
 *   --base none 表示空网；all 的 --out 默认等于 --base。
 *   报告默认写 reports/intersections、reports/junctions，并刷新 latest.json。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildNetwork } from "./build-intersections.mjs";
import { diagnoseNetwork } from "./junction-diagnose.mjs";
import { mergeRoads } from "./merge-roads.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CWD = process.cwd();

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

const WRITE = process.argv.includes("--write");

const displayPath = (p) => {
  const rel = path.relative(ROOT, p);
  return rel.startsWith("..") ? p : rel;
};

const readJson = (p) =>
  JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));

const requireFile = (p, label) => {
  if (!p || !fs.existsSync(p)) {
    console.error(`❌ ${label} 不存在: ${p}`);
    process.exit(1);
  }
};

const shaOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const crlfJson = (obj) =>
  `${JSON.stringify(obj, null, 2)}\n`.replace(/\n/g, "\r\n");
const prettyJson = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const writeReport = (dir, report) => {
  fs.mkdirSync(dir, { recursive: true });
  const body = prettyJson(report);
  const file = path.join(dir, `${localToday()}.json`);
  fs.writeFileSync(file, body, "utf8");
  fs.writeFileSync(path.join(dir, "latest.json"), body, "utf8");
  return file;
};

const writeGeoJson = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crlfJson(obj), "utf8");
};

const buildParams = () => ({
  tol: numOf("tol", 3),
  candidate: numOf("candidate", 10),
  clusterM: numOf("cluster", 1),
});

const diagnoseParams = () => ({
  nearM: numOf("near", 30),
  underMinM: numOf("under-min", 3),
  underAutoM: numOf("under-max", 15),
  underWarnM: numOf("under-warn", 30),
  pointingMaxDeg: numOf("pointing-max", 30),
  minAngleDeg: numOf("min-angle", 30),
  overMinM: numOf("over-min", 0.3),
  overMaxM: numOf("over-max", 15),
});

const printBuild = (report, roadsPath, outPath, reportDir, reportFile) => {
  const t = report.totals;
  console.log(
    `[${WRITE ? "write" : "dry-run"}] 路网 ${displayPath(roadsPath)} · 交点 ${displayPath(outPath)} · 报告 ${displayPath(reportDir)}`,
  );
  console.log(
    `[${WRITE ? "write" : "dry-run"}] 交点 ${t.nodes}（${JSON.stringify(t.kind)}，其中吸附 ${t.gapNodes}）`,
  );
  console.log(
    `路对 ${t.pairs}；有交点道路 ${t.roadsWithNode}/${t.roadsTotal}；贯通近失 ${t.nearMiss}；共线重叠 ${t.overlaps}；低置信 ${t.lowConfidence}`,
  );
  if (reportFile) console.log(`报告 → ${displayPath(reportFile)}`);
  for (const g of report.nearMiss.slice(0, 10))
    console.log(`  近失 ${g.names.join("×")} ${g.gapM}m / ${g.angleDeg}°`);
  if (report.isolated.length)
    console.log(
      `无交点道路 ${report.isolated.length} 条：${report.isolated.join("、")}`,
    );
};

const printDiagnose = (report, roadsPath, nodesPath, reportDir, reportFile) => {
  const t = report.totals;
  console.log(
    `输入：路网 ${displayPath(roadsPath)} · 交点 ${nodesPath ? displayPath(nodesPath) : "none"} · 输出 ${displayPath(reportDir)}`,
  );
  console.log(`[A] 近邻节点 ${t.nearGroups} 组 / ${t.nearNodes} 个节点`);
  for (const g of report.nearGroups.slice(0, 12))
    console.log(
      `    ${g.groupId} 跨度 ${g.spreadM}m 基准 ${g.anchorId}：${g.members.map((m) => m.id).join("、")}`,
    );
  console.log(`[B] 欠伸 ${t.underAuto} 条可自动修 / ${t.underWarn} 条仅告警`);
  for (const u of report.under.slice(0, 20))
    console.log(
      `    ${u.severity === "auto" ? "修" : "警"} ${u.name} ${u.end}端距 ${u.targetName} ${u.gapM}m（指向偏 ${u.pointingDeg}°，夹角 ${u.lineAngleDeg}°）`,
    );
  console.log(`[C] 过冲 ${t.over} 条`);
  for (const o of report.over.slice(0, 20))
    console.log(
      `    裁 ${o.name} ${o.end}端尾巴 ${o.stubM}m（节点 ${o.nodeId}，删 ${o.droppedVertices} 个顶点）`,
    );
  if (reportFile) console.log(`报告 → ${displayPath(reportFile)}`);
};

const usage = () => {
  console.log(`用法：
  node scripts/network.mjs build    [--roads ...] [--out ...] [--report ...] [--tol 3] [--candidate 10] [--cluster 1] [--write]
  node scripts/network.mjs diagnose [--roads ...] [--nodes ...] [--out ...] [--near 30] [--under-max 15]
  node scripts/network.mjs all      [--add ...] [--base ...] [--out ...] [--write]

  --base none 表示空网；all 的 --out 默认等于 --base。`);
};

const cmdBuild = () => {
  const ROADS = pathArg("roads", path.join(ROOT, "data/roads.geojson"));
  const OUT = pathArg("out", path.join(ROOT, "data/intersections.geojson"));
  const REPORT_DIR = pathArg(
    "report",
    path.join(ROOT, "reports/intersections"),
  );

  requireFile(ROADS, "路网文件");
  const roads = readJson(ROADS);
  const roadsSha = shaOf(fs.readFileSync(ROADS));

  let built;
  try {
    built = buildNetwork(roads, buildParams());
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  const { roads: outRoads, intersections, report } = built;
  report.source.file = displayPath(ROADS);
  report.source.sha256 = roadsSha;

  let reportFile = null;
  if (WRITE) {
    writeGeoJson(OUT, intersections);
    writeGeoJson(ROADS, outRoads);
    reportFile = writeReport(REPORT_DIR, report);
  }
  printBuild(report, ROADS, OUT, REPORT_DIR, reportFile);
};

const cmdDiagnose = () => {
  const ROADS = pathArg("roads", path.join(ROOT, "data/roads.geojson"));
  const NODES_RAW = argOf("nodes", null);
  const IX =
    NODES_RAW === null
      ? path.join(ROOT, "data/intersections.geojson")
      : NODES_RAW === "none"
        ? null
        : path.resolve(CWD, NODES_RAW);
  const REPORT_DIR = pathArg("out", path.join(ROOT, "reports/junctions"));

  requireFile(ROADS, "路网文件");
  if (IX) requireFile(IX, "交点文件");

  const roads = readJson(ROADS);
  const ix = IX ? readJson(IX) : null;
  const report = diagnoseNetwork({
    roadsGeoJson: roads,
    intersectionsGeoJson: ix,
    params: diagnoseParams(),
  });
  report.source.roads.sha256 = shaOf(fs.readFileSync(ROADS));
  if (IX && ix.features.length)
    report.source.intersections.sha256 = shaOf(fs.readFileSync(IX));

  const reportFile = writeReport(REPORT_DIR, report);
  printDiagnose(report, ROADS, IX, REPORT_DIR, reportFile);
};

const cmdAll = () => {
  const BASE_RAW = argOf("base", null);
  const BASE =
    BASE_RAW === "none"
      ? null
      : pathArg("base", path.join(ROOT, "data/roads.geojson"));
  const ADD = pathArg("add", null);
  const OUT = pathArg("out", BASE);
  const OUT_DIR = path.dirname(OUT);
  const REPORTS =
    OUT_DIR === path.join(ROOT, "data")
      ? path.join(ROOT, "reports")
      : path.join(OUT_DIR, "reports");
  const BUILD_REPORT = path.join(REPORTS, "intersections");
  const DIAG_REPORT = path.join(REPORTS, "junctions");

  if (!BASE && !ADD) {
    console.error("❌ --base none 时必须用 --add 提供路网");
    process.exit(1);
  }
  if (!OUT) {
    console.error("❌ --base none 时必须用 --out 指定输出路径");
    process.exit(1);
  }
  if (BASE) requireFile(BASE, "基线路网");
  if (ADD) requireFile(ADD, "待导入路网");

  const base = BASE
    ? readJson(BASE)
    : { type: "FeatureCollection", features: [] };
  const roadsForBuild = ADD
    ? (() => {
        const add = readJson(ADD);
        const { merged, errors, incoming } = mergeRoads(base, add);
        if (errors.length) {
          console.error(`❌ 校验未通过（${errors.length} 处）：`);
          errors.forEach((e) => console.error(`  - ${e}`));
          process.exit(1);
        }
        console.log(
          `基线 ${displayPath(BASE ?? OUT)} ${base.features.length} 条 · 新增 ${displayPath(ADD)} ${add.features.length} 条（可用 ${incoming.length} 条）`,
        );
        return merged;
      })()
    : base;

  const inputSha = shaOf(Buffer.from(crlfJson(roadsForBuild), "utf8"));

  let built;
  try {
    built = buildNetwork(roadsForBuild, buildParams());
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  const { roads, intersections, report: buildReport } = built;
  buildReport.source.file = displayPath(BASE ?? OUT);
  buildReport.source.sha256 = inputSha;

  const diagReport = diagnoseNetwork({
    roadsGeoJson: roads,
    intersectionsGeoJson: intersections,
    params: diagnoseParams(),
  });
  diagReport.source.roads.sha256 = inputSha;
  if (intersections.features.length)
    diagReport.source.intersections.sha256 = shaOf(
      Buffer.from(crlfJson(intersections), "utf8"),
    );

  const IX = path.join(path.dirname(OUT), "intersections.geojson");
  let buildReportFile = null;
  let diagReportFile = null;
  if (WRITE) {
    writeGeoJson(OUT, roads);
    writeGeoJson(IX, intersections);
    buildReportFile = writeReport(BUILD_REPORT, buildReport);
    diagReportFile = writeReport(DIAG_REPORT, diagReport);
  }

  printBuild(buildReport, OUT, IX, BUILD_REPORT, buildReportFile);
  console.log("");
  printDiagnose(diagReport, OUT, IX, DIAG_REPORT, diagReportFile);
  if (!WRITE) {
    console.log("\n（dry-run）未写任何文件；确认无误后加 --write 落盘");
  } else {
    console.log(
      `\n✅ 已写入路网 ${displayPath(OUT)}、交点 ${displayPath(IX)} 与两份报告`,
    );
  }
};

const [, , sub] = process.argv;
if (sub === "build") cmdBuild();
else if (sub === "diagnose") cmdDiagnose();
else if (sub === "all") cmdAll();
else {
  usage();
  process.exit(1);
}
