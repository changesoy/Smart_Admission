/**
 * zone-creation.mjs - 新建学区骨架的纯逻辑
 *
 * 只负责校验输入、分配 zoneRing / zoneStep 稳定 ID、拼装 zone 对象，
 * 以及在 zone_specs.v2.json 文本末尾追加新学区。文件读写与事务由
 * scripts/create-zone.mjs 负责。
 */
import { allocateIds, addEntry } from "./id-registry.mjs";
import { isZoneId } from "./network-schema.mjs";
import { ZONE_STEP_SIDES, splitBoundaryText } from "./zone-text.mjs";

export const ZONE_STAGES = ["小学", "初中"];
export const MAX_ZONE_STEPS = 200;

const asText = (value) => (typeof value === "string" ? value.trim() : "");

const pushError = (errors, field, message) => errors.push({ field, message });

/** 下一个学区编号：现有最大编号 + 1，三位十进制 */
export const nextZoneId = (zones) => {
  const max = zones.reduce((current, zone) => {
    const sequence = Number(String(zone.zoneId).slice("zone_".length));
    return Number.isInteger(sequence) ? Math.max(current, sequence) : current;
  }, 0);
  const candidate = `zone_${String(max + 1).padStart(3, "0")}`;
  return isZoneId(candidate) ? candidate : null;
};

const normalizeSteps = (steps) =>
  steps.map((step) => ({
    side: asText(step?.side),
    text: asText(step?.text),
  }));

const validateSteps = (steps, boundaryText, errors) => {
  if (steps.length < 3) {
    pushError(
      errors,
      "boundaryText",
      `四至至少需要拆出 3 个步骤才能闭合成环，当前只有 ${steps.length} 个`,
    );
    return;
  }
  if (steps.length > MAX_ZONE_STEPS) {
    pushError(errors, "boundaryText", `步骤超过 ${MAX_ZONE_STEPS} 个，请先人工拆分四至原文`);
  }
  steps.forEach((step, index) => {
    const at = `第 ${index + 1} 步`;
    if (!ZONE_STEP_SIDES.includes(step.side)) {
      pushError(errors, "steps", `${at} side 非法: ${JSON.stringify(step.side)}`);
    }
    if (!step.text) {
      pushError(errors, "steps", `${at} text 为空`);
    } else if (!boundaryText.includes(step.text)) {
      pushError(errors, "steps", `${at} text 不是四至原文的连续片段: ${step.text}`);
    }
  });
};

/**
 * 根据输入生成新学区与注册表变更。
 * @returns {{errors: Array, zone: object|null, steps: Array, zoneId: string|null}}
 */
export const planZoneCreation = ({
  payload,
  zones,
  schools,
  registry,
  today,
}) => {
  const errors = [];
  const schoolId = asText(payload?.schoolId);
  const school = schools.find((item) => item.schoolId === schoolId);
  if (!school) {
    pushError(errors, "schoolId", `学校不存在: ${JSON.stringify(payload?.schoolId)}`);
  }

  const boundaryText = asText(payload?.boundaryText);
  if (!boundaryText) {
    pushError(errors, "boundaryText", "四至原文不能为空");
  }

  const schoolStages = Array.isArray(school?.schoolStage) ? school.schoolStage : [];
  const stage = asText(payload?.stage) || schoolStages[0] || school?.type || "";
  if (!ZONE_STAGES.includes(stage)) {
    pushError(errors, "stage", `学段必须是 ${ZONE_STAGES.join(" / ")}，当前: ${JSON.stringify(stage)}`);
  } else if (schoolStages.length > 0 && !schoolStages.includes(stage)) {
    pushError(errors, "stage", `${school.name} 不包含 ${stage} 学段`);
  }

  const zoneName = asText(payload?.zoneName) || (school ? `${school.name}学区` : "");
  if (!zoneName) {
    pushError(errors, "zoneName", "学区名称不能为空");
  } else if (zones.some((zone) => zone.zoneName === zoneName)) {
    pushError(errors, "zoneName", `学区名称已存在: ${zoneName}`);
  }

  if (school && stage) {
    const existing = zones.find((zone) => zone.schoolId === school.schoolId && zone.stage === stage);
    if (existing) {
      pushError(
        errors,
        "schoolId",
        `${school.name} 的 ${stage} 学区已存在（${existing.zoneId}）`,
      );
    }
  }

  const year = Number(payload?.year ?? school?.verifiedDate?.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    pushError(errors, "year", "年份必须是 2000–2100 的整数");
  }

  let policyIds = payload?.policyIds;
  if (policyIds === undefined) {
    policyIds = zones.find((zone) => zone.year === year)?.policyIds ?? [];
  }
  if (!Array.isArray(policyIds) || policyIds.some((id) => typeof id !== "string" || !id)) {
    pushError(errors, "policyIds", "policyIds 必须是字符串数组");
  }

  const steps = Array.isArray(payload?.steps)
    ? normalizeSteps(payload.steps)
    : splitBoundaryText(boundaryText);
  if (boundaryText) validateSteps(steps, boundaryText, errors);

  if (errors.length > 0) {
    return { errors, zone: null, steps: [], zoneId: null };
  }

  const zoneId = nextZoneId(zones);
  if (!zoneId) {
    pushError(errors, "zoneId", "无法分配新的 zoneId");
    return { errors, zone: null, steps: [], zoneId: null };
  }

  const [ringId] = allocateIds(registry, "zoneRing", 1);
  const stepIds = allocateIds(registry, "zoneStep", steps.length);
  addEntry(registry, { id: ringId, entityType: "zoneRing", createdAt: today });
  stepIds.forEach((id) => addEntry(registry, { id, entityType: "zoneStep", createdAt: today }));

  const zone = {
    zoneId,
    zoneName,
    schoolId,
    stage,
    year,
    boundaryText,
    policyIds,
    boundaryRulings: [],
    rings: [
      {
        ringId,
        role: "outer",
        steps: steps.map((step, index) => ({
          stepId: stepIds[index],
          side: step.side,
          text: step.text,
          sourceType: "officialText",
          rulingIds: [],
          edgeRefs: [],
        })),
      },
    ],
  };

  return { errors, zone, steps, zoneId };
};

/* ----------------------------- 定点追加 ----------------------------- */

const findStringEnd = (text, start) => {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === '"') return index;
  }
  throw new Error("JSON 字符串未闭合");
};

const findMatching = (text, start) => {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      index = findStringEnd(text, index);
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("JSON 结构未闭合");
};

/** 在 zones 数组末尾追加一个学区，保留其余文本格式 */
export const appendZoneToSpecsText = (text, zone) => {
  const key = /"zones"\s*:\s*\[/g.exec(text);
  if (!key) throw new Error("zone_specs 文本中找不到 zones 数组");
  const arrayStart = text.indexOf("[", key.index);
  const arrayEnd = findMatching(text, arrayStart);
  const head = text.slice(0, arrayEnd).replace(/\s+$/, "");
  const body = JSON.stringify(zone, null, 2)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `${head},\n${body}\n  ${text.slice(arrayEnd)}`;
};
