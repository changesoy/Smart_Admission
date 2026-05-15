# 智慧入学·学区治理一站式可视化门户数据 Schema

> 版本：v1.0-draft  
> 适用阶段：正式分工前的数据契约  
> 适用范围：A 地图与查询、B 政策与模拟、C 互动与内容  
> 当前项目设定：真实学校名、一校一区、目标 20–30 个学校/学区，小学和初中都做，通过 `stage` 区分；地址查询采用“地址/学校/小区 → 坐标 → Turf 点面判断”的思路。

---

## 1. 总原则

### 1.1 技术边界

本项目仍然是纯前端静态原型：

- 使用 HTML5 / CSS3 / Vanilla JavaScript
- 使用 Leaflet + Turf + Bootstrap + 天地图
- 数据来自本地 JSON / GeoJSON
- 不使用 Vue / React / Node 后端 / 数据库 / npm / Vite / TypeScript / ES Module

### 1.2 字段命名

所有字段统一使用 `camelCase`。

正确示例：

```text
zoneId
zoneName
schoolId
policyId
sourceUrl
verifiedDate
relatedPolicyIds
```

禁止写法：

```text
zone_id
zone_name
school_id
policy_id
source_url
verified_date
```

### 1.3 当前业务设定

v1.0 暂按“一校一区”设计：

```text
1 个 zone 对应 1 所 school
1 所 school 对应 1 个 zone
小学和初中都做，但必须用 stage / schoolStage 区分
```

### 1.4 真实数据来源要求

学校名称、学校地址、公开电话、政策链接、联系方式尽量使用真实公开信息。

凡是真实数据，建议补充以下字段：

```json
{
  "sourceName": "泰山区教育和体育局",
  "sourceUrl": "https://example.gov.cn/xxx.html",
  "sourceType": "official",
  "verifiedDate": "2026-05-15",
  "dataStatus": "verified"
}
```

### 1.5 来源字段说明

| 字段 | 类型 | 必填建议 | 说明 |
|---|---|---:|---|
| `sourceName` | string | 真实数据建议必填 | 数据来源名称 |
| `sourceUrl` | string | 真实数据建议必填 | 原始来源链接 |
| `sourceType` | string | 真实数据建议必填 | 来源类型 |
| `verifiedDate` | string | 真实数据建议必填 | 团队核验日期，格式 `YYYY-MM-DD` |
| `dataStatus` | string | 真实数据建议必填 | 数据状态 |

`sourceType` 建议值：

```text
official  政府或教育主管部门官方来源
school    学校官网、学校官方公众号等
media     可信媒体来源
manual    团队根据公开资料人工整理
demo      示例数据
```

`dataStatus` 建议值：

```text
verified   已核验
estimated  根据公开资料整理或估算
demo       示例数据
outdated   可能过期
```

### 1.6 坐标顺序

必须严格区分：

```text
GeoJSON / Turf： [lng, lat]，即 [经度, 纬度]
Leaflet setView / marker： [lat, lng]，即 [纬度, 经度]
```

### 1.7 学区边界说明

如果学区 Polygon 不是官方矢量边界，而是团队根据官方文字四至人工绘制，必须标明：

```json
{
  "geometryAccuracy": "manualApproximation",
  "note": "Polygon 由团队根据官方文字四至人工绘制，仅用于原型展示。"
}
```

---

## 2. 数据文件总览

| 文件 | 负责人 | 是否必须 | 用途 |
|---|---|---:|---|
| `data/zones.geojson` | A | 是 | 学区 Polygon，地图渲染和 Turf 点面判断 |
| `data/schools.json` | A / 共享 | 是 | 真实学校信息 |
| `data/address_points.json` | A | 是 | 学校、小区、地标、道路代表点坐标 |
| `data/keywords_index.json` | A | 是 | 模糊关键词兜底搜索 |
| `data/zones_history.json` | A | 是 | 学区历年调整 timeline |
| `data/policies.json` | B | 是 | 真实招生政策、流程、材料、学区调整等 |
| `data/policy_diff.json` | B | 建议 | 不同年份政策对比 |
| `data/rumors.json` | B | 建议 | 政策辟谣、误区澄清 |
| `data/simulator_rules.json` | B | 可选 | 模拟器规则，当前不作为核心 |
| `data/admission_scores.json` | B | 可选 | 往年分数线；没有可靠来源时不启用 |
| `data/materials.json` | C | 是 | 入学材料清单 |
| `data/faq.json` | C | 是 | FAQ、分类、相关推荐 |
| `data/contacts.json` | C | 是 | 真实公开联系方式 |
| `data/interaction_topics.json` | C | 可选 | 留言表单主题配置 |

---

# A 组：地图与查询数据

## 3. `data/zones.geojson`

### 3.1 用途

存储学校对应的学区 Polygon，用于：

- 地图渲染
- 地图点击查询
- 地址点面判断
- 学区详情展示

### 3.2 顶层结构

```json
{
  "type": "FeatureCollection",
  "features": []
}
```

### 3.3 Feature 示例

```json
{
  "type": "Feature",
  "properties": {
    "zoneId": "zone_001",
    "zoneName": "泰山学院附属中学学区",
    "stage": "初中",
    "schoolId": "school_m_001",
    "description": "东至校场街，西至龙潭路，南至财源街，北至岱宗大街。",
    "boundaryText": "官方公布的文字四至范围。",
    "year": 2025,
    "policyIds": ["policy_2025_001"],
    "sourceName": "泰山区教育和体育局",
    "sourceUrl": "https://example.gov.cn/policy.html",
    "sourceType": "official",
    "verifiedDate": "2026-05-15",
    "dataStatus": "verified",
    "geometryAccuracy": "manualApproximation",
    "note": "Polygon 由团队根据官方文字四至人工绘制，仅用于原型展示。"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [117.103000, 36.220000],
        [117.120000, 36.220000],
        [117.120000, 36.205000],
        [117.103000, 36.205000],
        [117.103000, 36.220000]
      ]
    ]
  }
}
```

### 3.4 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `zoneId` | string | 是 | 学区唯一 ID，例如 `zone_001` |
| `zoneName` | string | 是 | 学区名称 |
| `stage` | string | 是 | `小学` / `初中` |
| `schoolId` | string | 是 | 一校一区模式下对应的唯一学校 ID |
| `description` | string | 是 | 面向用户展示的学区范围说明 |
| `boundaryText` | string | 建议 | 官方文字四至原文或整理后的范围 |
| `year` | number | 是 | 学区数据年份 |
| `policyIds` | string[] | 是 | 关联政策 ID |
| `sourceName` | string | 建议 | 数据来源名称 |
| `sourceUrl` | string | 建议 | 来源链接 |
| `sourceType` | string | 建议 | `official` / `school` / `manual` / `demo` |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | `verified` / `estimated` / `demo` / `outdated` |
| `geometryAccuracy` | string | 建议 | `officialBoundary` / `manualApproximation` / `demoBoundary` |
| `note` | string | 否 | 额外说明 |
| `geometry.type` | string | 是 | v1.0 建议固定为 `Polygon` |
| `coordinates` | array | 是 | GeoJSON 坐标，必须是 `[lng, lat]` |

### 3.5 约束

1. `zoneId` 不允许重复。
2. `schoolId` 必须能在 `schools.json` 中找到。
3. `policyIds` 中的每个 `policyId` 必须能在 `policies.json` 中找到。
4. Polygon 首尾坐标必须闭合。
5. v1.0 阶段建议只使用 `Polygon`，不使用 `MultiPolygon`。
6. 每个学区只绑定一个 `schoolId`。
7. 小学和初中必须用 `stage` 区分，不能混在一起。

---

## 4. `data/schools.json`

### 4.1 用途

存储真实学校信息，供地图结果面板、搜索结果、政策模块、FAQ 模块复用。

### 4.2 结构示例

```json
[
  {
    "schoolId": "school_m_001",
    "name": "泰山学院附属中学",
    "shortName": "泰院附中",
    "type": "初中",
    "schoolStage": ["初中"],
    "district": "泰山区",
    "address": "山东省泰安市泰山区擂鼓石大街677号",
    "phone": "0538-XXXXXXX",
    "website": "",
    "tags": ["公办", "初中"],
    "description": "泰山区义务教育阶段学校。",
    "sourceName": "泰山区教育和体育局",
    "sourceUrl": "https://example.gov.cn/school.html",
    "sourceType": "official",
    "verifiedDate": "2026-05-15",
    "dataStatus": "verified"
  }
]
```

### 4.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schoolId` | string | 是 | 学校唯一 ID |
| `name` | string | 是 | 真实学校名称 |
| `shortName` | string | 否 | 学校简称，用于搜索 |
| `type` | string | 是 | `小学` / `初中` / `九年一贯制学校` |
| `schoolStage` | string[] | 是 | 学校覆盖学段，值为 `小学` / `初中` |
| `district` | string | 建议 | 区县，例如 `泰山区` |
| `address` | string | 是 | 学校真实地址 |
| `phone` | string | 建议 | 公开办公电话，不填写个人手机号 |
| `website` | string | 否 | 学校官网或介绍页，没有则为空字符串 |
| `tags` | string[] | 否 | 例如 `公办`、`小学`、`初中` |
| `description` | string | 否 | 学校简介 |
| `sourceName` | string | 建议 | 来源名称 |
| `sourceUrl` | string | 建议 | 来源链接 |
| `sourceType` | string | 建议 | 来源类型 |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | 数据状态 |

### 4.4 ID 规则

```text
小学：school_p_001、school_p_002
初中：school_m_001、school_m_002
九年一贯制：school_9y_001
```

### 4.5 约束

1. `schoolId` 不允许重复。
2. `name` 使用真实学校名。
3. `phone` 只填写公开办公电话。
4. `type` 与 `schoolStage` 必须一致。
5. 每个 `schoolId` 原则上应在 `zones.geojson` 中被一个 zone 使用。

---

## 5. `data/address_points.json`

### 5.1 用途

本地地址点库，用于提高查询稳定性。优先匹配常用学校、小区、道路、地标，再进行 Turf 点面判断。

### 5.2 结构示例

```json
[
  {
    "addressId": "addr_001",
    "name": "泰山学院附属中学",
    "type": "学校",
    "fullAddress": "山东省泰安市泰山区擂鼓石大街677号",
    "lng": 117.123456,
    "lat": 36.123456,
    "matchedZoneId": "zone_001",
    "confidence": 100,
    "aliases": ["泰院附中", "泰山学院附中"],
    "sourceName": "泰山区教育和体育局",
    "sourceUrl": "https://example.gov.cn/school.html",
    "sourceType": "official",
    "verifiedDate": "2026-05-15",
    "dataStatus": "verified"
  }
]
```

### 5.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `addressId` | string | 是 | 地址点唯一 ID |
| `name` | string | 是 | 地址点名称 |
| `type` | string | 是 | `学校` / `小区` / `道路` / `社区` / `地标` / `政府机构` |
| `fullAddress` | string | 建议 | 完整地址 |
| `lng` | number | 是 | 经度 |
| `lat` | number | 是 | 纬度 |
| `matchedZoneId` | string | 否 | 人工确认的命中学区 |
| `confidence` | number | 否 | 可信度，范围 0–100 |
| `aliases` | string[] | 否 | 别名、简称、常见写法 |
| `sourceName` | string | 建议 | 来源名称 |
| `sourceUrl` | string | 建议 | 来源链接 |
| `sourceType` | string | 建议 | 来源类型 |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | 数据状态 |

### 5.4 查询建议

1. 用户输入后，先匹配 `name`。
2. 再匹配 `aliases`。
3. 再匹配 `fullAddress`。
4. 找到后取 `lng` / `lat`。
5. 用 Turf 判断该点落在哪个 `zone`。
6. 如果点面判断结果与 `matchedZoneId` 不一致，前端可提示团队核查。

---

## 6. `data/keywords_index.json`

### 6.1 用途

模糊关键词兜底，主要解决用户只输入道路名、片区名、学校简称时的搜索体验。

### 6.2 结构示例

```json
[
  {
    "keyword": "擂鼓石大街",
    "type": "道路",
    "matchedZoneIds": ["zone_001", "zone_003"],
    "displayName": "擂鼓石大街相关片区",
    "matchMode": "fuzzy",
    "weight": 80,
    "aliases": ["擂鼓石路"],
    "note": "道路可能跨多个学区，需结合门牌号或附近地标进一步判断。"
  }
]
```

### 6.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `keyword` | string | 是 | 主关键词 |
| `type` | string | 是 | `小区` / `道路` / `学校` / `地标` / `社区` / `街道` |
| `matchedZoneIds` | string[] | 是 | 可能匹配的学区 ID 列表 |
| `displayName` | string | 否 | 前端展示名称 |
| `matchMode` | string | 建议 | `exact` / `fuzzy` |
| `weight` | number | 否 | 排序权重 |
| `aliases` | string[] | 否 | 别名、简称、常见写法 |
| `note` | string | 否 | 补充说明 |

### 6.4 约束

1. `matchedZoneIds` 中的所有 `zoneId` 必须能在 `zones.geojson` 中找到。
2. 道路类关键词尽量不要只绑定一个学区，因为道路可能跨越多个学区。
3. `keywords_index.json` 是兜底，不应该替代 `address_points.json` 的精确地址点。

---

## 7. `data/zones_history.json`

### 7.1 用途

存储学区历年调整记录，用于学区详情面板 timeline。

### 7.2 结构示例

```json
[
  {
    "zoneId": "zone_001",
    "history": [
      {
        "year": 2024,
        "changeType": "原始划分",
        "title": "建立泰山学院附属中学学区",
        "description": "根据当年公开资料整理形成该学区范围。",
        "reason": "公开资料整理",
        "sourceName": "泰山区教育和体育局",
        "sourceUrl": "https://example.gov.cn/policy.html",
        "sourceType": "official",
        "verifiedDate": "2026-05-15"
      }
    ]
  }
]
```

### 7.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `zoneId` | string | 是 | 关联 `zones.geojson` 的学区 ID |
| `history` | array | 是 | 该学区的历史记录 |
| `history[].year` | number | 是 | 年份 |
| `history[].changeType` | string | 是 | 变更类型 |
| `history[].title` | string | 是 | 变更标题 |
| `history[].description` | string | 是 | 变更说明 |
| `history[].reason` | string | 否 | 变更原因 |
| `history[].sourceName` | string | 建议 | 来源名称 |
| `history[].sourceUrl` | string | 建议 | 来源链接 |
| `history[].sourceType` | string | 建议 | 来源类型 |
| `history[].verifiedDate` | string | 建议 | 核验日期 |

`changeType` 建议值：

```text
原始划分
边界微调
新增学校
撤销合并
范围说明更新
```

---

# B 组：政策与模拟数据

## 8. `data/policies.json`

### 8.1 用途

存储招生政策、报名流程、材料要求、学区划分、随迁子女、政策提醒等信息。

### 8.2 结构示例

```json
[
  {
    "policyId": "policy_2025_001",
    "title": "泰山区2025年义务教育学校招生入学工作实施意见",
    "year": 2025,
    "category": "招生政策",
    "source": "泰山区教育和体育局",
    "sourceName": "泰山区教育和体育局",
    "sourceUrl": "https://example.gov.cn/policy-2025.html",
    "sourceType": "official",
    "publishDate": "2025-06-01",
    "effectiveDate": "2025-06-01",
    "documentNo": "",
    "summary": "说明2025年义务教育招生对象、报名条件、时间安排、学区划分等内容。",
    "url": "https://example.gov.cn/policy-2025.html",
    "relatedZoneIds": ["zone_001", "zone_002"],
    "relatedSchoolIds": ["school_m_001"],
    "attachments": [
      {
        "name": "政策原文附件",
        "url": "https://example.gov.cn/attachment.pdf",
        "type": "pdf"
      }
    ],
    "verifiedDate": "2026-05-15",
    "dataStatus": "verified"
  }
]
```

### 8.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `policyId` | string | 是 | 政策唯一 ID |
| `title` | string | 是 | 政策标题 |
| `year` | number | 是 | 政策年份 |
| `category` | string | 是 | 政策分类 |
| `source` | string | 是 | 兼容旧字段，可与 `sourceName` 相同 |
| `sourceName` | string | 建议 | 来源名称 |
| `sourceUrl` | string | 建议 | 来源链接 |
| `sourceType` | string | 建议 | `official` / `school` / `media` / `manual` / `demo` |
| `publishDate` | string | 建议 | 发布日期，格式 `YYYY-MM-DD` |
| `effectiveDate` | string | 否 | 生效日期 |
| `documentNo` | string | 否 | 文件文号 |
| `summary` | string | 是 | 政策摘要 |
| `url` | string | 建议 | 前端“查看原文”链接 |
| `relatedZoneIds` | string[] | 否 | 关联学区 ID |
| `relatedSchoolIds` | string[] | 否 | 关联学校 ID |
| `attachments` | array | 否 | 附件列表 |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | 数据状态 |

### 8.4 分类建议

```text
招生政策
报名流程
材料要求
随迁子女
政策提醒
学区调整
政策解读
录取规则
```

### 8.5 约束

1. `policyId` 不允许重复。
2. `year` 必须是 number，例如 `2025`。
3. 真实政策不要编造链接。
4. `relatedZoneIds`、`relatedSchoolIds` 中的 ID 必须能在对应文件中找到。

---

## 9. `data/policy_diff.json`

### 9.1 用途

存储政策年份之间的差异点，用于政策对比视图。

### 9.2 结构示例

```json
[
  {
    "diffId": "diff_2024_2025",
    "yearA": 2024,
    "yearB": 2025,
    "title": "2024 与 2025 年义务教育招生政策对比",
    "summary": "对比招生对象、报名方式、材料要求、时间安排等重点变化。",
    "sourcePolicyIds": ["policy_2024_001", "policy_2025_001"],
    "diffPoints": [
      {
        "topic": "招生年龄",
        "valueA": "2018年8月31日前出生的适龄儿童",
        "valueB": "2019年8月31日前出生的适龄儿童",
        "isChange": true,
        "changeLevel": "normal",
        "explanation": "招生年龄随年度正常顺延。"
      }
    ],
    "sourceName": "团队根据公开政策整理",
    "sourceUrl": "",
    "sourceType": "manual",
    "verifiedDate": "2026-05-15",
    "dataStatus": "estimated"
  }
]
```

### 9.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `diffId` | string | 是 | 对比记录唯一 ID |
| `yearA` | number | 是 | 左侧年份 |
| `yearB` | number | 是 | 右侧年份 |
| `title` | string | 是 | 对比标题 |
| `summary` | string | 否 | 对比摘要 |
| `sourcePolicyIds` | string[] | 建议 | 对比依据政策 ID |
| `diffPoints` | array | 是 | 差异点列表 |
| `diffPoints[].topic` | string | 是 | 对比主题 |
| `diffPoints[].valueA` | string | 是 | 年份 A 的内容 |
| `diffPoints[].valueB` | string | 是 | 年份 B 的内容 |
| `diffPoints[].isChange` | boolean | 是 | 是否变化 |
| `diffPoints[].changeLevel` | string | 建议 | `none` / `normal` / `important` / `major` |
| `diffPoints[].explanation` | string | 否 | 通俗解释 |
| `sourceName` | string | 建议 | 来源名称 |
| `sourceUrl` | string | 否 | 来源链接 |
| `sourceType` | string | 建议 | 来源类型 |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | 数据状态 |

### 9.4 约束

1. `yearA` 和 `yearB` 不能相同。
2. `sourcePolicyIds` 中的 ID 必须能在 `policies.json` 中找到。
3. 如果是团队整理内容，`sourceType` 建议写 `manual`，`dataStatus` 建议写 `estimated`。

---

## 10. `data/rumors.json`

### 10.1 用途

存储政策辟谣、常见误区、官方澄清。

### 10.2 结构示例

```json
[
  {
    "rumorId": "rumor_001",
    "rumor": "听说今年所有学区都会重新划分？",
    "truth": "根据公开政策资料，学区范围以当年官方公告为准，并非所有学区都会重新划分。",
    "category": "学区调整",
    "sourceName": "泰山区教育和体育局",
    "sourceUrl": "https://example.gov.cn/policy-2025.html",
    "sourceType": "official",
    "publishDate": "2025-06-10",
    "relatedPolicyIds": ["policy_2025_001"],
    "severity": "medium",
    "verifiedDate": "2026-05-15",
    "dataStatus": "verified"
  }
]
```

### 10.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `rumorId` | string | 是 | 辟谣卡片唯一 ID |
| `rumor` | string | 是 | 谣言、误区或常见误解 |
| `truth` | string | 是 | 澄清内容 |
| `category` | string | 是 | 分类 |
| `sourceName` | string | 建议 | 澄清依据来源 |
| `sourceUrl` | string | 建议 | 澄清依据链接 |
| `sourceType` | string | 建议 | 来源类型 |
| `publishDate` | string | 否 | 发布日期 |
| `relatedPolicyIds` | string[] | 否 | 关联政策 |
| `severity` | string | 否 | `low` / `medium` / `high` |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | 数据状态 |

---

## 11. `data/admission_scores.json`（可选）

### 11.1 用途

存储往年录取分数、积分线、参考线。

当前项目中录取分数暂时没有准确来源，因此该文件不作为必须交付项。没有可靠来源时，建议内容为：

```json
[]
```

### 11.2 有可靠来源时的结构示例

```json
[
  {
    "scoreId": "score_2024_m_001",
    "year": 2024,
    "schoolId": "school_m_001",
    "schoolName": "泰山学院附属中学",
    "stage": "初中",
    "studentType": "本地户籍",
    "batch": "第一批",
    "minScore": 82,
    "scoreType": "积分",
    "notes": "达到往年参考分不代表一定录取，需结合当年招生计划和官方审核结果。",
    "sourceName": "泰山区教育和体育局",
    "sourceUrl": "https://example.gov.cn/admission-score.html",
    "sourceType": "official",
    "verifiedDate": "2026-05-15",
    "dataStatus": "verified"
  }
]
```

### 11.3 约束

1. 找不到可靠来源时，不要编造数据。
2. 如果只是演示数据，必须写 `dataStatus: "demo"`。
3. 前端展示时必须提示“仅供参考，不代表官方录取结果”。

---

## 12. `data/simulator_rules.json`（可选）

### 12.1 用途

定义录取建议模拟器的输入项、匹配逻辑和输出文案。

当前建议：因为暂时没有准确录取分数来源，v1.0 不建议把模拟器作为必须交付项。可以先做成“资格核对 + 材料提醒”的轻量模块。

### 12.2 结构示例

```json
{
  "version": "1.0",
  "enabled": false,
  "source": "团队整理",
  "disclaimer": "模拟结果仅供参考，不代表官方录取结果。若缺少官方往年分数线，本模块仅提供材料和资格核对建议。",
  "inputFields": [
    {
      "key": "studentStage",
      "label": "申请学段",
      "type": "select",
      "required": true,
      "options": ["小学", "初中"]
    },
    {
      "key": "studentType",
      "label": "学生类型",
      "type": "select",
      "required": true,
      "options": ["本地户籍", "随迁子女", "集体户", "人户分离"]
    },
    {
      "key": "score",
      "label": "积分或参考分数",
      "type": "number",
      "required": false
    }
  ],
  "matchRules": [
    {
      "key": "scoreGteMinScore",
      "label": "用户分数大于等于往年最低参考分",
      "enabled": false
    },
    {
      "key": "studentTypeMatch",
      "label": "学生类型匹配",
      "enabled": true
    },
    {
      "key": "stageMatch",
      "label": "申请学段匹配",
      "enabled": true
    }
  ],
  "outputLevels": [
    {
      "level": "info",
      "title": "请以官方审核为准",
      "message": "当前仅提供资格和材料准备建议，不作为录取预测。"
    },
    {
      "level": "notEnoughData",
      "title": "暂无足够数据",
      "message": "当前缺少可靠的往年分数线，无法进行学校推荐。"
    }
  ]
}
```

---

# C 组：互动与内容数据

## 13. `data/materials.json`

### 13.1 用途

存储不同入学类型所需材料，用于入学材料清单模块。

### 13.2 结构示例

```json
[
  {
    "groupId": "material_group_001",
    "group": "本地户籍",
    "description": "适用于适龄儿童少年户籍在本区的家庭。",
    "applicableStage": ["小学", "初中"],
    "relatedPolicyIds": ["policy_2025_001"],
    "items": [
      {
        "materialId": "material_001",
        "name": "户口簿",
        "required": true,
        "note": "需提供首页、户主页、儿童本人页。",
        "templateUrl": "",
        "rejectReasons": ["户籍信息与报名信息不一致", "页面缺失或照片模糊"],
        "validity": "以最新户籍信息为准",
        "sourceName": "泰山区教育和体育局",
        "sourceUrl": "https://example.gov.cn/policy-2025.html",
        "sourceType": "official",
        "verifiedDate": "2026-05-15",
        "dataStatus": "verified"
      }
    ]
  }
]
```

### 13.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `groupId` | string | 建议 | 材料分组唯一 ID |
| `group` | string | 是 | 材料分组 |
| `description` | string | 是 | 分组说明 |
| `applicableStage` | string[] | 建议 | 适用学段 |
| `relatedPolicyIds` | string[] | 否 | 关联政策 ID |
| `items` | array | 是 | 材料项列表 |
| `items[].materialId` | string | 建议 | 材料项唯一 ID |
| `items[].name` | string | 是 | 材料名称 |
| `items[].required` | boolean | 是 | 是否必需 |
| `items[].note` | string | 否 | 材料说明 |
| `items[].templateUrl` | string | 否 | 模板下载链接 |
| `items[].rejectReasons` | string[] | 否 | 常见被拒原因 |
| `items[].validity` | string | 否 | 有效期说明 |
| `items[].sourceName` | string | 建议 | 来源名称 |
| `items[].sourceUrl` | string | 建议 | 来源链接 |
| `items[].sourceType` | string | 建议 | 来源类型 |
| `items[].verifiedDate` | string | 建议 | 核验日期 |
| `items[].dataStatus` | string | 建议 | 数据状态 |

### 13.4 分组建议

```text
本地户籍
随迁子女
集体户
人户分离
人才子女
```

### 13.5 约束

1. `required` 必须是 boolean，不能写成 `"是"` 或 `"否"`。
2. `relatedPolicyIds` 中的 ID 必须能在 `policies.json` 中找到。
3. 如果 `templateUrl` 不确定，先写空字符串，不要编造。
4. 材料勾选状态由前端控制，不写入 `materials.json`。

---

## 14. `data/faq.json`

### 14.1 用途

存储常见问题，用于 FAQ 搜索、分类筛选、相关推荐。

### 14.2 结构示例

```json
[
  {
    "faqId": "faq_001",
    "question": "如何查询我家对应的学区？",
    "answer": "可以在地图查询区输入小区、道路、学校或附近地标，系统会先匹配本地地址库，再进行地图点面判断。",
    "category": "学区查询",
    "keywords": ["学区", "查询", "小区", "道路", "地址"],
    "relatedFaqIds": ["faq_002", "faq_003"],
    "relatedPolicyIds": ["policy_2025_001"],
    "priority": 100,
    "sourceName": "团队根据项目功能整理",
    "sourceUrl": "",
    "sourceType": "manual",
    "verifiedDate": "2026-05-15",
    "dataStatus": "estimated"
  }
]
```

### 14.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `faqId` | string | 是 | FAQ 唯一 ID |
| `question` | string | 是 | 问题 |
| `answer` | string | 是 | 回答 |
| `category` | string | 是 | 分类 |
| `keywords` | string[] | 否 | 搜索关键词 |
| `relatedFaqIds` | string[] | 否 | 相关问题 ID |
| `relatedPolicyIds` | string[] | 否 | 关联政策 ID |
| `priority` | number | 否 | 排序优先级 |
| `sourceName` | string | 建议 | 来源名称 |
| `sourceUrl` | string | 否 | 来源链接 |
| `sourceType` | string | 建议 | 来源类型 |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | 数据状态 |

### 14.4 分类建议

```text
学区查询
报名时间
材料准备
随迁子女
入学资格
政策变化
咨询方式
数据说明
原型边界
录取规则
```

### 14.5 约束

1. `faqId` 不允许重复。
2. `relatedFaqIds` 中的 ID 必须能在 `faq.json` 中找到。
3. `relatedPolicyIds` 中的 ID 必须能在 `policies.json` 中找到。
4. 如果回答来自官方政策，应填写 `sourceUrl`。
5. 如果回答是团队解释，应写 `sourceType: "manual"`，`dataStatus: "estimated"`。

---

## 15. `data/contacts.json`

### 15.1 用途

存储教育主管部门、学校、社区、线上咨询入口等联系方式。

### 15.2 结构示例

```json
[
  {
    "contactId": "contact_001",
    "name": "泰山区教育和体育局",
    "type": "教育主管部门",
    "district": "泰山区",
    "phone": "0538-XXXXXXX",
    "email": "",
    "address": "山东省泰安市泰山区示范地址",
    "hours": "工作日 09:00-17:00",
    "serviceScope": ["义务教育招生", "学区咨询", "政策咨询"],
    "note": "公开办公电话，具体办理时间以官方公告为准。",
    "channels": [
      {
        "name": "电话咨询",
        "value": "0538-XXXXXXX"
      },
      {
        "name": "现场咨询",
        "value": "山东省泰安市泰山区示范地址"
      }
    ],
    "relatedSchoolIds": [],
    "relatedPolicyIds": ["policy_2025_001"],
    "sourceName": "泰山区人民政府",
    "sourceUrl": "https://example.gov.cn/contact.html",
    "sourceType": "official",
    "verifiedDate": "2026-05-15",
    "dataStatus": "verified"
  }
]
```

### 15.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `contactId` | string | 是 | 联系方式唯一 ID |
| `name` | string | 是 | 单位或机构名称 |
| `type` | string | 是 | 联系方式类型 |
| `district` | string | 建议 | 区县 |
| `phone` | string | 建议 | 公开办公电话 |
| `email` | string | 否 | 公开邮箱 |
| `address` | string | 否 | 办公地址或学校地址 |
| `hours` | string | 否 | 服务时间 |
| `serviceScope` | string[] | 否 | 服务范围 |
| `note` | string | 否 | 补充说明 |
| `channels` | array | 否 | 咨询渠道列表 |
| `relatedSchoolIds` | string[] | 否 | 关联学校 ID |
| `relatedPolicyIds` | string[] | 否 | 关联政策 ID |
| `sourceName` | string | 建议 | 来源名称 |
| `sourceUrl` | string | 建议 | 来源链接 |
| `sourceType` | string | 建议 | 来源类型 |
| `verifiedDate` | string | 建议 | 核验日期 |
| `dataStatus` | string | 建议 | 数据状态 |

### 15.4 `type` 建议值

```text
教育主管部门
小学
初中
九年一贯制学校
社区
线上咨询
```

### 15.5 约束

1. `contactId` 不允许重复。
2. `phone` 只填写公开电话，不填写私人手机号。
3. `type` 为 `小学` 或 `初中` 时，建议 `relatedSchoolIds` 关联 `schools.json`。
4. 真实联系方式必须填写 `sourceUrl` 或至少填写 `sourceName`。
5. 联系方式容易变化，`verifiedDate` 必须尽量填写。

---

## 16. `data/interaction_topics.json`（可选）

### 16.1 用途

如果 C 组要做留言表单，可以用此文件维护咨询类型、表单提示、处理说明。

### 16.2 结构示例

```json
[
  {
    "topicId": "topic_001",
    "name": "学区查询咨询",
    "description": "用于咨询居住地址对应学区、学校信息等问题。",
    "requiredFields": ["name", "phone", "address", "question"],
    "tips": "请尽量填写完整居住地址，例如街道、小区、楼号。",
    "relatedFaqIds": ["faq_001"],
    "relatedContactIds": ["contact_001"]
  }
]
```

### 16.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `topicId` | string | 是 | 留言主题唯一 ID |
| `name` | string | 是 | 咨询主题名称 |
| `description` | string | 是 | 主题说明 |
| `requiredFields` | string[] | 是 | 该主题建议填写的表单字段 |
| `tips` | string | 否 | 表单提示文案 |
| `relatedFaqIds` | string[] | 否 | 关联 FAQ |
| `relatedContactIds` | string[] | 否 | 关联联系方式 |

### 16.4 约束

1. 留言内容如果只是前端原型，建议存入 `sessionStorage` 或 `localStorage`。
2. 不要做真实在线提交，除非有后端。
3. 前端必须提示“留言功能为原型演示，未接入真实政务系统”。

---

# 17. 前端数据加载建议

建议 `js/dataService.js` 统一登记所有数据路径，避免每个 service 单独写 `fetch`。

```javascript
var DATA_PATHS = {
  zones: 'data/zones.geojson',
  schools: 'data/schools.json',
  policies: 'data/policies.json',
  materials: 'data/materials.json',
  faq: 'data/faq.json',

  addressPoints: 'data/address_points.json',
  keywordsIndex: 'data/keywords_index.json',
  zonesHistory: 'data/zones_history.json',

  policyDiff: 'data/policy_diff.json',
  rumors: 'data/rumors.json',
  simulatorRules: 'data/simulator_rules.json',
  admissionScores: 'data/admission_scores.json',

  contacts: 'data/contacts.json',
  interactionTopics: 'data/interaction_topics.json'
};
```

加载完成后的 `data` 对象建议为：

```javascript
{
  zones: {},
  schools: [],
  policies: [],
  materials: [],
  faq: [],

  addressPoints: [],
  keywordsIndex: [],
  zonesHistory: [],

  policyDiff: [],
  rumors: [],
  simulatorRules: {},
  admissionScores: [],

  contacts: [],
  interactionTopics: []
}
```

---

# 18. 地址查询流程

推荐查询顺序：

```text
1. 用户输入地址、学校、小区、道路或地标。
2. 先查 address_points.json：
   - 匹配 name
   - 匹配 aliases
   - 匹配 fullAddress
3. 如果找到地址点，取 lng / lat，用 Turf 进行点面判断。
4. 如果 address_points.json 没找到，再查 keywords_index.json。
5. 如果 keywords_index.json 只命中一个 zone，显示该学区。
6. 如果命中多个 zone，显示候选列表，让用户选择或提示输入更完整地址。
7. 如果仍未命中，可调用天地图地理编码服务。
8. 天地图返回坐标后，再用 Turf 判断落在哪个 zones.geojson 的 Polygon 内。
9. 如果没有落入任何 Polygon，提示“暂未匹配到学区，请尝试输入更完整地址”。
```

---

# 19. 模块使用关系

## A：地图与查询

主要使用：

```text
zones.geojson
schools.json
address_points.json
keywords_index.json
zones_history.json
policies.json
```

输出能力：

```text
地图渲染
学区点击查询
地址查询
图层切换
学区历史 timeline
```

## B：政策与模拟

主要使用：

```text
policies.json
policy_diff.json
rumors.json
simulator_rules.json
admission_scores.json
zones.geojson
schools.json
materials.json
```

输出能力：

```text
政策归档
政策对比
政策辟谣
资格核对
可选录取建议模拟
```

## C：互动与内容

主要使用：

```text
materials.json
faq.json
contacts.json
interaction_topics.json
policies.json
schools.json
```

输出能力：

```text
材料清单
FAQ 筛选
相关问题推荐
联系卡片
留言表单
```

---

# 20. 开发注意事项

## 20.1 A 组注意事项

1. 不要在 service 文件中硬编码学校名或学区名。
2. 学校、学区、地址点全部从 data 文件读取。
3. 地图点击和地址搜索最后都应回到同一套 `showZoneDetail(zoneId)` 逻辑。
4. 学区点击必须阻止冒泡，避免触发地图空白点击逻辑。
5. 一次只允许一个学区处于选中态。
6. 所有真实数据都必须保留来源，尤其是学校电话和学区范围。

## 20.2 B 组注意事项

1. 先做真实政策归档，不要急着做模拟器。
2. 政策链接能找到官方来源就填真实链接，找不到就暂缓，不要编造。
3. 政策对比可以由团队人工整理，但必须标明 `sourceType: "manual"`。
4. 录取分数没有可靠来源时，不要输出“某学校可录取”这种确定结论。
5. 模拟器如果实现，优先做“资格核对 + 材料提醒”，分数推荐作为后续增强。
6. 所有“预测”“推荐”类结果必须显示免责声明。

## 20.3 C 组注意事项

1. 所有真实电话、地址、邮箱必须可追溯来源。
2. FAQ 回答不能与政策文件冲突。
3. 材料清单建议关联 `policyId`，便于解释依据。
4. 留言表单不要收集过多敏感信息。
5. 前端原型阶段的留言功能必须提示“未接入真实政务系统”。

---

# 21. 推荐第一批新建文件

正式开发前，建议先新建以下文件，即使内容暂时为空数组：

```text
data/address_points.json
data/keywords_index.json
data/zones_history.json
data/policy_diff.json
data/rumors.json
data/contacts.json
```

初始内容可写：

```json
[]
```

如果决定暂时不做模拟器，可不新建 `admission_scores.json`。如果要占位，则内容为：

```json
[]
```

`simulator_rules.json` 如果占位，建议写：

```json
{
  "version": "1.0",
  "enabled": false,
  "source": "团队整理",
  "disclaimer": "当前缺少可靠往年分数线，暂不提供录取预测。"
}
```
