/**
 * id-registry.mjs - 稳定 ID 注册表与分配器
 *
 * 契约：docs/planning/统一边界网络数据契约与ID规则.md（第五章）
 *
 * 规则要点：
 *   - 每类实体独立单调递增计数器，序号永不回收；
 *   - ID 与实体同批落盘，任一失败不写文件；
 *   - 已登记的 legacyRef 再次迁移时复用原 ID，保证幂等；
 *   - dry-run 不推进计数器。
 */
import fs from "node:fs";
import path from "node:path";

import { ID_SPECS, formatId, parseIdSequence } from "./network-schema.mjs";

/** 空注册表 */
export const createRegistry = () => ({
  schemaVersion: 1,
  counters: Object.fromEntries(Object.keys(ID_SPECS).map((key) => [key, 0])),
  entries: [],
});

/** 读取注册表；文件不存在时返回空表（首次迁移场景） */
export const loadRegistry = (file) => {
  if (!fs.existsSync(file)) return createRegistry();
  const registry = JSON.parse(fs.readFileSync(file, "utf-8"));
  registry.counters = { ...createRegistry().counters, ...(registry.counters ?? {}) };
  registry.entries = registry.entries ?? [];
  return registry;
};

/** 原子写盘：先写临时文件再改名，避免中途失败留下半个注册表 */
export const saveRegistry = (file, registry) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
};

/** 按 legacyRef 反查已登记的 ID，找不到返回 null */
export const findIdByLegacyRef = (registry, { namespace, jsonType, value }) => {
  const hit = registry.entries.find((entry) =>
    (entry.legacyRefs ?? []).some(
      (ref) =>
        ref.namespace === namespace &&
        ref.jsonType === jsonType &&
        ref.value === value,
    ),
  );
  return hit?.id ?? null;
};

/**
 * 分配连续 ID 并登记条目（内存操作，由调用方决定是否落盘）
 * @param {object} registry 注册表
 * @param {string} entityType ID_SPECS 的键
 * @param {number} count 需要分配的数量
 * @returns {string[]} 按调用顺序返回的 ID
 */
export const allocateIds = (registry, entityType, count) => {
  if (!ID_SPECS[entityType]) {
    throw new Error(`未登记的实体类型: ${entityType}`);
  }
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    registry.counters[entityType] += 1;
    ids.push(formatId(entityType, registry.counters[entityType]));
  }
  return ids;
};

/**
 * 登记一个实体
 * @param {object} registry 注册表
 * @param {object} entry { id, entityType, legacyRefs, lifecycle, createdAt }
 */
export const addEntry = (registry, entry) => {
  registry.entries.push({
    lifecycle: "active",
    retiredAt: null,
    supersededBy: [],
    legacyRefs: [],
    ...entry,
  });
};

/**
 * 获取或分配一个带 legacyRef 的实体 ID
 * 已有登记则复用，否则分配新 ID 并登记，保证迁移可重复执行
 */
export const ensureIdForLegacyRef = (registry, entityType, legacyRef, createdAt) => {
  const existing = findIdByLegacyRef(registry, legacyRef);
  if (existing) return existing;
  const [id] = allocateIds(registry, entityType, 1);
  addEntry(registry, {
    id,
    entityType,
    legacyRefs: [legacyRef],
    createdAt,
  });
  return id;
};

/** 给已登记实体追加一个 legacyRef，已存在则跳过 */
export const addLegacyRef = (registry, id, legacyRef) => {
  const entry = registry.entries.find((item) => item.id === id);
  if (!entry) return false;
  const exists = (entry.legacyRefs ?? []).some(
    (ref) =>
      ref.namespace === legacyRef.namespace &&
      ref.jsonType === legacyRef.jsonType &&
      ref.value === legacyRef.value,
  );
  if (exists) return false;
  entry.legacyRefs = [...(entry.legacyRefs ?? []), legacyRef];
  return true;
};

/** 退役实体：保留登记，禁止回收 ID，并记录替代关系 */
export const retireEntry = (registry, id, { retiredAt, supersededBy = [] } = {}) => {
  const entry = registry.entries.find((item) => item.id === id);
  if (!entry) return false;
  entry.lifecycle = "retired";
  entry.retiredAt = retiredAt ?? null;
  entry.supersededBy = supersededBy;
  return true;
};

/** 已登记 ID 的最大序号，用于一致性核对 */
export const maxAllocatedSequence = (registry, entityType) =>
  registry.entries.reduce((max, entry) => {
    if (entry.entityType !== entityType) return max;
    return Math.max(max, parseIdSequence(entityType, entry.id) ?? 0);
  }, 0);
