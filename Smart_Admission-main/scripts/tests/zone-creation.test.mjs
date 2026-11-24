/**
 * zone-creation.test.mjs - 四至拆分与学区创建骨架
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { appendZoneToSpecsText, planZoneCreation } from "../lib/zone-creation.mjs";
import { createRegistry } from "../lib/id-registry.mjs";
import { splitBoundaryText } from "../lib/zone-text.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "scripts", "create-zone.mjs");

const school = {
  schoolId: "school_m_009",
  name: "泰安市泰山区万官路学校",
  schoolStage: ["初中"],
  verifiedDate: "2025-08-29",
};

const existingZone = {
  zoneId: "zone_040",
  zoneName: "旧学区",
  schoolId: "school_m_001",
  stage: "初中",
  year: 2025,
  boundaryText: "东至甲路，西至乙路，南至丙路，北至丁路。",
  policyIds: ["policy_2025_001"],
  boundaryRulings: [],
  rings: [
    {
      ringId: "zr_000014",
      role: "outer",
      steps: [
        { stepId: "zs_0000116", side: "东", text: "东至甲路", sourceType: "officialText", rulingIds: [], edgeRefs: [] },
        { stepId: "zs_0000117", side: "西", text: "西至乙路", sourceType: "officialText", rulingIds: [], edgeRefs: [] },
        { stepId: "zs_0000118", side: "南", text: "南至丙路", sourceType: "officialText", rulingIds: [], edgeRefs: [] },
      ],
    },
  ],
};

const registryOf = () => {
  const registry = createRegistry();
  registry.counters.zoneRing = 14;
  registry.counters.zoneStep = 118;
  return registry;
};

const payloadOf = (overrides = {}) => ({
  schoolId: school.schoolId,
  stage: "初中",
  boundaryText: "东至双龙河，西至迎春路，北至东岳大街，南至灵山大街。",
  ...overrides,
});

const plan = (overrides = {}) =>
  planZoneCreation({
    payload: payloadOf(overrides),
    zones: [existingZone],
    schools: [school],
    registry: registryOf(),
    today: "2026-11-21",
  });

test("四至按方位拆分并保留原文片段", () => {
  const steps = splitBoundaryText(
    "东界：致富路，荣军医院东路，西界：佳苑路，长城路，南界：灵山大街，北界：京沪铁路。",
  );
  assert.deepEqual(
    steps.map((step) => [step.side, step.text]),
    [
      ["东", "东界：致富路"],
      ["东", "荣军医院东路"],
      ["西", "西界：佳苑路"],
      ["西", "长城路"],
      ["南", "南界：灵山大街"],
      ["北", "北界：京沪铁路"],
    ],
  );
});

test("括号内排除区域拆成独立排除步骤", () => {
  const steps = splitBoundaryText(
    "东至双龙河，西至迎春路，北至东岳大街，南至灵山大街（除东湖路以北，温泉路以西区域）。",
  );
  assert.deepEqual(
    steps.map((step) => [step.side, step.text]),
    [
      ["东", "东至双龙河"],
      ["西", "西至迎春路"],
      ["北", "北至东岳大街"],
      ["南", "南至灵山大街"],
      ["排除", "除东湖路以北"],
      ["排除", "温泉路以西区域"],
    ],
  );
});

test("无方位片段继承上一段，补充说明记为说明", () => {
  const steps = splitBoundaryText("东界：甲路，乙路，另含丙小区，丁路。");
  assert.deepEqual(
    steps.map((step) => [step.side, step.text]),
    [
      ["东", "东界：甲路"],
      ["东", "乙路"],
      ["说明", "另含丙小区"],
      ["东", "丁路"],
    ],
  );
});

test("创建计划分配学区、环与步骤 ID", () => {
  const result = plan();
  assert.deepEqual(result.errors, []);
  assert.equal(result.zoneId, "zone_041");
  assert.equal(result.zone.rings[0].ringId, "zr_000015");
  assert.equal(result.zone.rings[0].steps[0].stepId, "zs_0000119");
  assert.equal(result.zone.schoolId, school.schoolId);
  assert.deepEqual(result.zone.policyIds, ["policy_2025_001"]);
  assert.equal(result.zone.rings[0].role, "outer");
});

test("同校同学段已有学区时拒绝创建", () => {
  const result = planZoneCreation({
    payload: payloadOf({ schoolId: "school_m_001" }),
    zones: [existingZone],
    schools: [{ ...school, schoolId: "school_m_001" }],
    registry: registryOf(),
    today: "2026-11-21",
  });
  assert.ok(result.errors.some((item) => item.message.includes("已存在")));
});

test("步骤不足三个时拒绝创建", () => {
  const result = plan({ boundaryText: "岳麓社区。" });
  assert.ok(result.errors.some((item) => item.message.includes("至少需要拆出 3 个步骤")));
});

test("追加学区保留原有文本格式", () => {
  const text = `${JSON.stringify({ schemaVersion: 2, zones: [existingZone] }, null, 2)}\n`;
  const { zone } = plan();
  const patched = appendZoneToSpecsText(text, zone);
  const parsed = JSON.parse(patched);
  assert.deepEqual(parsed.zones, [existingZone, zone]);
  assert.ok(patched.startsWith(text.slice(0, text.indexOf("]"))));
  assert.ok(patched.endsWith("\n"));
});

test("CLI dry-run 不写盘，--write 同时推进注册表", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zone-create-"));
  const specs = path.join(dir, "zone_specs.v2.json");
  const registry = path.join(dir, "id_registry.json");
  const schools = path.join(dir, "schools.json");
  const payload = path.join(dir, "payload.json");
  const specsText = `${JSON.stringify({ schemaVersion: 2, zones: [existingZone] }, null, 2)}\n`;
  fs.writeFileSync(specs, specsText, "utf-8");
  fs.writeFileSync(registry, `${JSON.stringify(registryOf(), null, 2)}\n`, "utf-8");
  fs.writeFileSync(schools, JSON.stringify([school]), "utf-8");
  fs.writeFileSync(payload, JSON.stringify(payloadOf()), "utf-8");

  const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const before = { specs: hash(specs), registry: hash(registry) };

  const dryRun = JSON.parse(
    execFileSync(
      process.execPath,
      [CLI, payload, "--zone-specs", specs, "--registry", registry, "--schools", schools],
      { cwd: ROOT, encoding: "utf-8" },
    ),
  );
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(hash(specs), before.specs);
  assert.equal(hash(registry), before.registry);

  const written = JSON.parse(
    execFileSync(
      process.execPath,
      [CLI, payload, "--zone-specs", specs, "--registry", registry, "--schools", schools, "--write"],
      { cwd: ROOT, encoding: "utf-8" },
    ),
  );
  assert.equal(written.mode, "write");
  const { zones } = JSON.parse(fs.readFileSync(specs, "utf-8"));
  assert.deepEqual(zones.map((zone) => zone.zoneId), ["zone_040", "zone_041"]);
  const nextRegistry = JSON.parse(fs.readFileSync(registry, "utf-8"));
  assert.equal(nextRegistry.counters.zoneRing, 15);
  assert.equal(nextRegistry.counters.zoneStep, 122);
});
