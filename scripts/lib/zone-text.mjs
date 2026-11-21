/**
 * zone-text.mjs - 四至原文的浏览器安全拆分逻辑
 *
 * 只做文本切分与方位推断，不读写文件，可被编辑器和 Node CLI 共用。
 * 输出仍是官方原文的连续片段，不改写措辞。
 */

export const ZONE_STEP_SIDES = ["东", "西", "南", "北", "说明", "排除"];

/** 方位前缀：东界：/ 东至 / 东侧：，避免误判“东岳大街” */
const SIDE_PREFIX = /^[（(]?\s*(东|西|南|北)(?:界|至|侧)?\s*[：:]/;
const SIDE_PREFIX_NO_COLON = /^[（(]?\s*(东|西|南|北)(?:界|至|侧)\s*/;
const EXCLUSION_PREFIX = /^[（(]?\s*(?:除|不含|不包括)/;
const NOTE_PREFIX = /^[（(]?\s*(?:另含|另包括|包括|含|以及|加)/;

const detectSide = (text) => {
  if (EXCLUSION_PREFIX.test(text)) return "排除";
  if (NOTE_PREFIX.test(text)) return "说明";
  const match = SIDE_PREFIX.exec(text) ?? SIDE_PREFIX_NO_COLON.exec(text);
  return match ? match[1] : null;
};

/** 按顶层标点切分，括号内的逗号不拆 */
const splitSegments = (text) => {
  const segments = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "（" || character === "(") {
      depth += 1;
    } else if (character === "）" || character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && /[，,；;。\n]/.test(character)) {
      const segment = text.slice(start, index).trim();
      if (segment) segments.push(segment);
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) segments.push(tail);
  return segments;
};

const splitExclusion = (inner) =>
  inner
    .split(/[，,；;]/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * 把四至原文拆成有序步骤。
 * 方位按“东界： / 东至 / 东侧：”识别；无方位片段继承上一段，首次出现记为“说明”。
 * 末尾“（除……）”会拆成独立的“排除”步骤。
 */
export const splitBoundaryText = (text) => {
  if (typeof text !== "string") return [];
  const steps = [];
  let side = null;

  splitSegments(text.replace(/\u3000/g, " ")).forEach((segment) => {
    const exclusion = segment.match(/^(.*?)[（(]((?:除|不含|不包括)[^）)]*)[）)]\s*$/);
    if (exclusion) {
      const base = exclusion[1].trim();
      if (base) {
        const baseSide = detectSide(base);
        if (["东", "西", "南", "北"].includes(baseSide)) side = baseSide;
        steps.push({ side: baseSide ?? side ?? "说明", text: base });
      }
      splitExclusion(exclusion[2]).forEach((item) => {
        steps.push({ side: "排除", text: item });
      });
      return;
    }

    const detected = detectSide(segment);
    if (["东", "西", "南", "北"].includes(detected)) side = detected;
    steps.push({ side: detected ?? side ?? "说明", text: segment });
  });

  return steps;
};
