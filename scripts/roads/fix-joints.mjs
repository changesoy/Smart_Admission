/**
 * fix-joints.mjs - 修复 OSM way 拼接处的"横杆台阶"与"往返回折"
 *
 * 背景:
 *   一条道路由多条 OSM way 串成, 相邻 way 的端点常年错开 4–15 m(上下行各取一侧,
 *   或接缝两侧来自不同的 way 链)。P3/P1 直接连直线, 就在接缝处留下一根短横杆,
 *   成图上表现为"双车道之间跳一下"; 个别道路还有整段往返重复(去程+回程).
 *
 * 判定与处理:
 *   1. 回折(≥150° 且首/尾 30 m 内回归原位): 删除多走的那一段.
 *   2. Z 型台阶(连续两个 ≥35° 反向转角, 中间段 ≤20 m): 两点取中点作为接缝点,
 *      台阶位移由两端相邻段自然吸收(短段 ≤16 m 时相邻段都在 40 m 以上, 折角 <20°).
 *
 * 用法:
 *   node scripts/roads/fix-joints.mjs            # dry-run
 *   node scripts/roads/fix-joints.mjs --write    # 落盘
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADS = path.join(ROOT, "data/roads.geojson");
const WRITE = process.argv.includes("--write");

const MIN_TURN = 35; // 台阶转角阈值(度)
const MAX_JOG = 20; // 台阶短段上限(米)
const SPIKE = 150; // 回折阈值(度)
const SPIKE_RETURN = 30; // 回折后回到首/尾的距离上限(米)

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
const turnDeg = (a, b, c) => {
  const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = ((t2 - t1) * 180) / Math.PI;
  return ((d + 540) % 360) - 180;
};
const round6 = (p) => [+p[0].toFixed(6), +p[1].toFixed(6)];

const fc = JSON.parse(fs.readFileSync(ROADS, "utf8").replace(/^\uFEFF/, ""));
const log = [];

const partsOf = (f) =>
  f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates];

/** 修改一个 part 的坐标数组；未改动时原样返回，避免无谓的坐标重排 */
const fixPart = (line, name, pi) => {
  let coords = line.map((p) => [...p]);
  const touched = { value: false };

  // 1) 首尾回折: 先处理, 免得后续索引混乱
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const n = coords.length;
    for (let k = 1; k < n - 1; k++) {
      const t = turnDeg(coords[k - 1], coords[k], coords[k + 1]);
      if (Math.abs(t) < SPIKE) continue;
      if (k >= 2 && dd(coords[0], coords[k + 1]) <= SPIKE_RETURN) {
        log.push({ name, pi, rule: "去掉首部回折", detail: `删除 #0–#${k - 1}（${(dd(coords[0], coords[k]) / 1000).toFixed(2)} km）` });
        coords = coords.slice(k);
        changed = true;
        touched.value = true;
        break;
      }
      if (k <= n - 3 && dd(coords[k], coords[n - 1]) <= SPIKE_RETURN) {
        log.push({ name, pi, rule: "去掉尾部回折", detail: `删除 #${k + 1}–#${n - 1}（${(dd(coords[k], coords[n - 1]) / 1000).toFixed(2)} km）` });
        coords = coords.slice(0, k + 1);
        changed = true;
        touched.value = true;
        break;
      }
    }
    if (!changed) break;
  }

  // 2) Z 型台阶
  for (let pass = 0; pass < 10; pass++) {
    const n = coords.length;
    let fixed = false;
    for (let i = 1; i < n - 2; i++) {
      const t1 = turnDeg(coords[i - 1], coords[i], coords[i + 1]);
      const t2 = turnDeg(coords[i], coords[i + 1], coords[i + 2]);
      if (Math.abs(t1) < MIN_TURN || Math.abs(t2) < MIN_TURN) continue;
      if (Math.sign(t1) === Math.sign(t2)) continue;
      const jog = dd(coords[i], coords[i + 1]);
      if (jog > MAX_JOG) continue;

      const lat0 = coords[i][1];
      const kmx = 111320 * Math.cos(rad(lat0));
      const kmy = 110574;
      const half = (Math.hypot(
        (coords[i + 1][0] - coords[i][0]) * kmx,
        (coords[i + 1][1] - coords[i][1]) * kmy,
      ) / 2);
      if (half > MAX_JOG) continue;

      // 两点取中点，横杆位移由两端相邻段吸收
      const mid = [
        (coords[i][0] + coords[i + 1][0]) / 2,
        (coords[i][1] + coords[i + 1][1]) / 2,
      ];
      coords.splice(i, 2, mid);
      log.push({
        name,
        pi,
        rule: "Z 型台阶归一",
        detail: `#${i}/#${i + 1} 转角 ${t1.toFixed(0)}°/${t2.toFixed(0)}°，短段 ${jog.toFixed(1)} m（横向 ${half.toFixed(1)} m）→ 取中点`,
      });
      fixed = true;
      touched.value = true;
      break;
    }
    if (!fixed) break;
  }

  return touched.value ? coords.map(round6) : line;
};

const patches = new Map();
for (const f of fc.features) {
  const p = f.properties || {};
  if (p.type !== "道路") continue;
  if (p.dataStatus === "estimated") continue; // 示意线本来就是抽象线形
  const parts = partsOf(f);
  const next = parts.map((line, pi) => fixPart(line, p.name, pi));
  if (JSON.stringify(next) !== JSON.stringify(parts)) patches.set(f, next);
}

console.log(`=== 接缝修复：${patches.size} 条道路 ===`);
for (const item of log) console.log(`  ${item.name} part${item.pi}: ${item.rule} — ${item.detail}`);

if (WRITE && patches.size > 0) {
  for (const [f, parts] of patches) {
    f.geometry =
      parts.length === 1
        ? { type: "LineString", coordinates: parts[0] }
        : { type: "MultiLineString", coordinates: parts };
  }
  const text = `${JSON.stringify(fc, null, 2).replace(/\r?\n/g, "\r\n")}\r\n`;
  fs.writeFileSync(ROADS, text);
  console.log(`\n已写入 ${ROADS}（CRLF，${Buffer.byteLength(text)} 字节）`);
} else if (WRITE) {
  console.log("\n无改动，未写盘");
} else {
  console.log("\ndry-run：未写盘（加 --write 落盘）");
}
