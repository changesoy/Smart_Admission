/**
 * split-zone-steps.mjs - 把各学区官方四至拆成有序步骤（B1）
 *
 * 只写 side / text / sourceType / rulingIds，edgeRefs 一律留空，
 * 等节点与边就绪后由绑定阶段（B10）补齐。
 *
 * 用法：
 *   node scripts/split-zone-steps.mjs --dry-run
 *   node scripts/split-zone-steps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allocateIds, addEntry, loadRegistry, saveRegistry } from "./lib/id-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_FILE = path.join(ROOT, "data", "zone_specs.v2.json");
const REGISTRY_FILE = path.join(ROOT, "data", "id_registry.json");
const TODAY = "2026-11-17";

/**
 * 四至拆分表。
 * side 取值：东 / 西 / 南 / 北 / 说明 / 排除
 * text 必须是官方原文的连续片段，不改变措辞。
 */
const STEPS = {
  zone_002: [
    ["东", "东界：致富路"],
    ["东", "荣军医院东路"],
    ["西", "西界：佳苑路"],
    ["西", "长城路"],
    ["南", "南界：灵山大街"],
    ["北", "北界：铁路"],
  ],
  zone_006: [
    ["东", "东至双龙河", "boundaryRuling", ["br_000001"]],
    ["西", "西至迎春路"],
    ["北", "北至东岳大街"],
    ["南", "南至灵山大街"],
    ["排除", "除东湖路以北，温泉路以西区域"],
  ],
  zone_004: [
    ["说明", "自东岳大街与唐王河交界处起，沿唐王河向北接北上高大街"],
    ["说明", "沿北上高大街向西"],
    ["说明", "接温泉路向北"],
    ["说明", "自东岳大街与唐王河交界处起，沿东岳大街向西至温泉路"],
    ["说明", "向南接东湖路"],
    ["说明", "向西接迎春路向北"],
    ["说明", "接东岳大街向西至虎山路"],
    ["说明", "沿虎山路向北过岱宗大街，擂鼓石大街接虎山路"],
    ["说明", "沿梳洗河东岸向北"],
    ["说明", "包括东关村和三合村"],
  ],
  zone_010: [
    ["东", "东至红门路"],
    ["西", "西至渿河"],
    ["南", "南至岱宗大街"],
    ["说明", "含青年路以西，北新东街以北，北新街以东，岱宗大街以南的小片区域"],
  ],
  zone_016: [
    ["北", "北界：东岳大街以南自东岳大街与温泉路交界处起，沿东岳大街向东、至与唐王河交界处止"],
    ["西", "西界：温泉路以东自温泉路与东岳大街交界处起，沿温泉路向南、至与东湖路交界处止"],
    ["南", "南界：东湖路以北自东湖路与温泉路交界处起，沿东湖路向东、至与唐王河交界处止"],
    ["东", "东界：唐王河以西自东湖路与唐王河交界处起，沿唐王河向北、至与东岳大街交界处止"],
    ["说明", "该学区含东湖路以南的花园小区南区48号、49号楼"],
  ],
  zone_003: [
    ["东", "东界：虎山路（东湖公园西门）往北沿虎山路，经过岱宗大街与虎山路路口"],
    ["东", "沿梳洗河到环山路，梳洗河以西"],
    ["北", "北界：红门路与梳洗河之间"],
    ["西", "西界：红门路（下行至岱宗大街，向西至校场街北头）"],
    ["南", "南界：自东岳大街与校场街十字路口向东至岱庙南门（双龙池）"],
    ["南", "向南至通天街到财源街交叉路口"],
    ["南", "再向东达东湖公园西门路口"],
  ],
  zone_031: [
    ["东", "东至芝田河"],
    ["西", "西至双龙河", "boundaryRuling", ["br_000002"]],
    ["南", "南至五马街"],
    ["北", "北至谢过城街"],
  ],
  zone_032: [
    ["北", "北至北上高大街"],
    ["南", "南至东湖路"],
    ["西", "西至唐王河"],
    ["东", "东至天烛峰路"],
  ],
  zone_033: [
    ["西", "西界：王家庄社区接长城路以东"],
    ["说明", "长城路以西圣山帝景属于"],
    ["东", "东界：龙潭路"],
    ["南", "南界：长城路南接泰山大街"],
    ["南", "东接15号路"],
    ["南", "北接铁路"],
    ["南", "东接荣疗东路"],
    ["南", "南接泰山大街"],
    ["南", "东接龙潭路"],
    ["北", "北界：北环山路"],
    ["北", "东接优山美地西邻路"],
    ["北", "南接迎胜路"],
    ["北", "东接擂鼓石路"],
    ["北", "南接科山路"],
    ["北", "东接文化路"],
    ["北", "南接傲徕峰路"],
    ["北", "东接东岳大街"],
    ["北", "东接龙潭路"],
  ],
  zone_034: [
    ["东", "自泮河大街与泰良路交界处起，沿泰良路向北至泰辛铁路"],
    ["东", "沿泰辛铁路向东至南关中学东临"],
    ["东", "自南关中学东界至迎春西路"],
    ["东", "沿迎春西路向北至与灵山大街交汇处"],
    ["东", "沿灵山大街向西至顺河街"],
    ["东", "沿顺河街向北至与财源街交汇处"],
    ["东", "沿财源街向东至于通天街交汇处"],
    ["东", "沿通天街向北至与东岳大街交汇处止"],
    ["北", "自通天街与东岳大街交汇处向西至与校场街交汇处"],
    ["北", "沿校场街向南至与财源街交汇处"],
    ["北", "沿财源北街向西至与龙潭路交汇处止"],
    ["西", "自财源大街与龙潭路交界处起，沿龙潭路向南至与泮河大街交界处止"],
    ["南", "自泮河大街与龙潭路交界处起，沿泮河大街向东、至与泰良路交界处止"],
  ],
  zone_035: [
    ["北", "北至艾洼小区"],
    ["南", "南至北上高大街"],
    ["东", "东至明堂路"],
    ["西", "西至温泉路"],
  ],
  zone_036: [
    ["说明", "校场街以西"],
    ["说明", "财源街以北"],
    ["说明", "龙潭路以东"],
    ["说明", "泰山大桥以西"],
    ["说明", "沿岱宗大街向北"],
    ["说明", "沿渿河西路向北到大众桥"],
    ["说明", "沿环山路向西"],
    ["说明", "泰疗、老卫校、煤气公司至优山美地"],
    ["说明", "科山路南沿擂鼓石大街以北东西两边"],
    ["说明", "从擂鼓石大街以南，科山路以东"],
    ["说明", "从文化路以北，文化路以南只有老师专家属院和试验设备厂属于"],
    ["说明", "至傲徕峰路以东至东岳大街以北"],
    ["说明", "至龙潭路齐鲁银座南与财源北街汇合到校场街处"],
    ["说明", "另含老人口学校宿舍、老迎胜小区1-12号楼、宋家庄老回迁楼"],
  ],
  zone_039: [
    ["说明", "自迎春学校往西至南湖大街与迎春西路交界"],
    ["说明", "沿迎春西路向北到灵山大街交界处"],
    ["说明", "沿灵山大街向西，到渿河东路交界处"],
    ["说明", "沿渿河东路向北到财源大街交界处"],
    ["说明", "沿财源大街向东到虎山路交界处"],
    ["说明", "沿虎山路向北到东岳大街"],
    ["说明", "沿东岳大街向东直至迎春路交界处"],
    ["说明", "沿迎春路向南直至灵山大街"],
    ["说明", "沿灵山大街向东直至唐訾路"],
    ["说明", "沿唐訾路向南直至南湖大街"],
    ["说明", "沿南湖大街向西至温泉路"],
    ["说明", "沿温泉路向北到韩家结庄新村北墙"],
    ["说明", "再向西到韩家结庄西墙"],
    ["说明", "沿西墙向南至南湖大街"],
    ["说明", "沿南湖大街向西至韩家结庄村委西路"],
    ["说明", "沿西路往南到铁路"],
    ["说明", "沿辛泰铁路向西直至东岳小区西墙"],
    ["说明", "沿路向北到南湖大街"],
  ],
  zone_040: [
    ["东", "东界：博阳路"],
    ["西", "西界：明堂路"],
    ["北", "北界：环山东路"],
    ["南", "南界：谢过城街"],
  ],
};

const dryRun = process.argv.includes("--dry-run");

const specs = JSON.parse(fs.readFileSync(SPEC_FILE, "utf-8"));
const registry = loadRegistry(REGISTRY_FILE);

const missing = specs.zones.map((zone) => zone.zoneId).filter((id) => !STEPS[id]);
const extra = Object.keys(STEPS).filter((id) => !specs.zones.some((zone) => zone.zoneId === id));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(`拆分表与学区不匹配。缺少: ${missing.join()} 多余: ${extra.join()}`);
}

let ringCount = 0;
let stepCount = 0;

specs.zones.forEach((zone) => {
  const rows = STEPS[zone.zoneId];
  const existingRing = zone.rings?.[0];
  const existingSteps = existingRing?.steps ?? [];

  let ringId = existingRing?.ringId;
  if (!ringId) {
    [ringId] = allocateIds(registry, "zoneRing", 1);
    addEntry(registry, { id: ringId, entityType: "zoneRing", createdAt: TODAY });
    ringCount += 1;
  }

  const steps = rows.map(([side, text, sourceType = "officialText", rulingIds = []], index) => {
    let stepId = existingSteps[index]?.stepId;
    if (!stepId) {
      [stepId] = allocateIds(registry, "zoneStep", 1);
      addEntry(registry, { id: stepId, entityType: "zoneStep", createdAt: TODAY });
      stepCount += 1;
    }
    return { stepId, side, text, sourceType, rulingIds, edgeRefs: [] };
  });

  zone.rings = [{ ringId, role: "outer", steps }];
});

if (dryRun) {
  const preview = specs.zones
    .map((zone) => `${zone.zoneId} ${zone.rings[0].ringId} ${zone.rings[0].steps.length} 步`)
    .join("\n");
  console.log(`[dry-run] 未写入文件\n${preview}`);
} else {
  saveRegistry(REGISTRY_FILE, registry);
  fs.writeFileSync(SPEC_FILE, `${JSON.stringify(specs, null, 2)}\n`, "utf-8");
  console.log(
    `已写入 ${specs.zones.length} 个学区，新增 ${ringCount} 个环、${stepCount} 个步骤；` +
      `环总数 ${registry.counters.zoneRing}，步骤总数 ${registry.counters.zoneStep}`,
  );
}
