# 统一边界网络数据契约与 ID 规则

> 状态：方案已确认，进入分阶段实施；在新体系整体验收前不作为当前发布数据的即时约束  
> 目标：建立道路、河流、铁路、行政界线和人工裁定线共用的唯一坐标与拓扑来源，使所有学区边界由网络引用自动派生  
> 适用范围：`roads.geojson`、`intersections.geojson`、`zone_specs.json`、`zones.geojson` 及相关生成、校验、发布脚本

---

## 一、结论

新模型采用三层结构：

1. **边界要素层**：唯一维护坐标，保存道路、河流、铁路、行政界线、围墙和人工裁定线；
2. **拓扑引用层**：节点和边只引用边界要素中的顶点，不再保存第二份独立坐标；
3. **学区语义层**：学区边界只保存有序 `edgeId` 引用，`zones.geojson` 由构建脚本生成。

核心原则：

- 人工只维护一套坐标，即边界要素几何；
- 节点、拓扑边和学区边界不得维护自由坐标副本；
- 所有正式 ID 均为字符串、分类型、固定格式、创建后永久稳定；
- ID 不从名称、坐标、数组下标、顶点下标或排序序号动态计算；
- 已发布 ID 永不复用，合并、拆分和替换必须保留迁移关系；
- `boundaryText` 永远保留官方原文，任何采信差异只进入 `boundaryRulings`；
- `zones.geojson` 继续供前端渲染和点面查询，但降级为可重复生成的发布产物。

---

## 二、目标与非目标

### 2.1 目标

1. 路网及其他边界要素具有统一结构、统一状态、统一来源字段和稳定 ID。
2. 每个有效交点、端点和人工控制点具有稳定 `nodeId`。
3. 每条边界要素按节点切分为稳定 `edgeId`，边可无歧义地还原几何。
4. 每个学区环由有序拓扑边组成，不再依赖手绘 Polygon 坐标。
5. 相邻学区引用同一条边时天然共享完全相同的坐标序列。
6. 任意学区顶点都能追溯到 `featureId + partIndex + vertexIndex`。
7. 路网更新后能够明确判断哪些节点、边和学区受到影响。
8. 所有构建和迁移过程可审计、可回滚、可重复执行。

### 2.2 非目标

1. 本契约不自动解释官方四至文本。
2. 本契约不允许算法替代人工处理路径多解、名称冲突和资料不足。
3. 本契约不要求前端直接读取拓扑图；前端短期继续读取派生的 `zones.geojson`。
4. 本契约不把所有几何相交都视为道路连通；立交、跨河桥和下穿必须显式判定。
5. 本契约不在实施初期直接重编号或修改现有发布数据，迁移必须按后续阶段执行。

### 2.3 协作分工

本轮工作由三名成员按以下边界协作：

- **角色 A：边界数据维护**，负责道路、河流、铁路等边界要素的数据更新、来源核验和几何标准化；
- **角色 B：契约、学区语义与验收**，负责本契约、稳定 ID、四至解释、人工裁定、发布门禁与最终业务验收；
- **角色 C：可视化工具与自动化实现**，负责节点与边生成器、地图点选编辑器、草稿导入导出、派生环、差异报告和测试。

角色 A 与角色 C 可以并行推进数据标准化和工具开发；角色 B 负责冻结接口、解释四至、确认裁定并完成最终汇合。三方原则上不直接修改对方的权威数据，遇到缺线、歧义或契约不足时通过问题清单交接。可视化工具只辅助产生和复核 `edgeRefs`，不得替代人工裁定。

---

## 三、文件与权威边界

建议目标文件如下：

| 文件 | 角色 | 是否人工维护 | 是否保存坐标 | 是否进入发布包 |
| --- | --- | --- | --- | --- |
| `data/boundary_features.geojson` | 边界要素唯一几何源 | 是 | 是，唯一权威坐标 | 是 |
| `data/network_nodes.json` | 拓扑节点及顶点引用 | 半自动生成、人工裁定 | 否 | 是 |
| `data/network_edges.json` | 节点之间的可引用边 | 自动生成 | 否 | 是 |
| `data/zone_specs.json` | 学区元数据、官方原文、裁定和有序边引用 | 半自动生成、人工复核 | 否 | 是 |
| `data/zone_drafts/<draftId>.json` | 地图点选和自动补全产生的待审草稿 | 工具生成、人工复核 | 否 | 否 |
| `data/zones.geojson` | 前端运行时 Polygon | 自动生成 | 是，但仅为派生副本 | 是 |
| `data/intersections.geojson` | 兼容展示或审计产物 | 自动生成 | 是，但仅为派生副本 | 迁移期保留 |
| `data/id_registry.json` | ID 分配与退役登记 | 由专用脚本维护 | 否 | 否 |

> 迁移期双轨命名：新版边界要素与学区语义先写入 `data/boundary_features.v2.geojson` 与 `data/zone_specs.v2.json`，避免覆盖 L2 修复流程仍在使用的 `data/boundary_features.geojson` 与发布链路读取的 `data/zone_specs.json`。整批切换时提升为正式文件名，旧文件同步退役，`repair-zones.mjs` 一并下线。

权威顺序：

```text
boundary_features.geojson
        ↓ 顶点引用
network_nodes.json
        ↓ 节点切分
network_edges.json
        ↓ 有序边引用
zone_specs.json
        ↓ 确定性构建
zones.geojson
```

`network_nodes.json` 和 `network_edges.json` 可以删除后重建，但重建时必须读取 ID 注册表和上一版实体匹配结果，以保留稳定 ID。不能每次运行时重新按排序分配 ID。

`zone_drafts` 不是权威数据，也不进入发布包。草稿必须通过导入器的结构、引用、闭合、裁定和共边校验，并经人工确认后，才能合并到 `zone_specs.json`。编辑器不得直接写正式学区文件。

---

## 四、通用数据规则

### 4.1 JSON 与字段规则

- 字段名统一使用 `camelCase`。
- 所有 ID 必须是 JSON string，禁止 number。
- 坐标统一使用 WGS84，经度在前、纬度在后。
- 权威几何坐标统一保留 7 位小数。
- 所有日期使用 `YYYY-MM-DD`。
- 所有时间使用 UTC ISO 8601；若只需要裁定日期则使用日期格式。
- 数组顺序具有语义时必须保持稳定；无语义时按主 ID 升序输出。
- 构建产物必须使用稳定字段顺序和稳定数组排序，保证同输入产生字节一致输出。
- 禁止用空字符串表达未知枚举；统一使用 `null`，并通过状态字段说明原因。

### 4.2 生命周期规则

所有可被引用的实体统一支持：

```json
{
  "lifecycle": "active",
  "supersedes": [],
  "supersededBy": [],
  "createdAt": "2026-11-17",
  "retiredAt": null
}
```

`lifecycle` 取值：

- `active`：当前有效，可被新数据引用；
- `deprecated`：仍可解析，但禁止新增引用；
- `retired`：已退出使用，只保留迁移与审计记录。

规则：

- ID 一经分配永久保留，不能转给其他实体；
- 删除实体必须改为 `retired`，不能从注册表抹除；
- 一对一替换通过 `supersedes/supersededBy` 关联；
- 一对多拆分和多对一合并同样使用数组表达；
- 发布包不得引用 `retired` 实体；
- 历史发布包仍按其自身快照解释，不追溯改写。

### 4.3 来源与可信状态

来源和质量必须拆开表达，禁止继续用一个 `dataStatus` 同时表达“来自哪里”和“是否可信”。

统一字段：

```json
{
  "sourceType": "osm",
  "sourceName": "OpenStreetMap",
  "sourceUrl": null,
  "verifiedDate": "2026-11-17",
  "verificationStatus": "reviewed",
  "geometryAccuracy": "surveyedOrMapped"
}
```

`sourceType` 取值：

- `official`
- `osm`
- `manualSurvey`
- `imageryTrace`
- `boundaryDerived`
- `manualRuling`
- `legacy`

`verificationStatus` 取值：

- `unreviewed`
- `reviewed`
- `verified`
- `disputed`
- `outdated`

`geometryAccuracy` 取值：

- `officialBoundary`
- `surveyedOrMapped`
- `imageryApproximation`
- `boundaryDerived`
- `manualRuling`
- `unknown`

---

## 五、ID 命名与分配规则

### 5.1 ID 类型

| 实体 | 字段 | 格式 | 示例 |
| --- | --- | --- | --- |
| 边界要素 | `featureId` | `bf_` + 6 位十进制序号 | `bf_000127` |
| 拓扑节点 | `nodeId` | `bn_` + 6 位十进制序号 | `bn_000842` |
| 拓扑边 | `edgeId` | `be_` + 7 位十进制序号 | `be_0012045` |
| 学区 | `zoneId` | 保留现有 `zone_NNN` | `zone_006` |
| 学区环 | `ringId` | `zr_` + 6 位十进制序号 | `zr_000021` |
| 学区步骤 | `stepId` | `zs_` + 7 位十进制序号 | `zs_0000138` |
| 人工裁定 | `rulingId` | `br_` + 6 位十进制序号 | `br_000014` |

说明：

- `featureId` 不编码道路、河流、铁路等类型，因为实体分类可能被纠正，ID 不应随分类改变；
- `featureId` 不编码名称，因为道路更名、别名修正不应改变引用；
- `nodeId` 不编码参与要素或坐标，避免要素增减或微调造成 ID 变化；
- `edgeId` 不编码顶点下标，避免插点导致所有后续边改名；
- `zoneId` 已是稳定业务 ID，继续保留；
- `ringId` 和 `stepId` 不编码学区或顺序，所属关系和先后顺序只由数据字段与数组位置表达。

### 5.2 分配机制

所有新 ID 必须由一个专用分配器写入 `data/id_registry.json`，禁止人工猜测“下一个编号”。

注册表示例：

```json
{
  "schemaVersion": 1,
  "counters": {
    "boundaryFeature": 127,
    "networkNode": 842,
    "networkEdge": 12045,
    "zoneRing": 21,
    "zoneStep": 138,
    "boundaryRuling": 14
  },
  "entries": [
    {
      "id": "bf_000127",
      "entityType": "boundaryFeature",
      "lifecycle": "active",
      "legacyRefs": [
        { "namespace": "roadId", "jsonType": "string", "value": "river_007" }
      ],
      "createdAt": "2026-11-17",
      "retiredAt": null,
      "supersededBy": []
    }
  ]
}
```

分配规则：

1. 每类实体使用独立单调递增计数器；
2. 已使用序号永不回收；
3. 一次命令需要创建多个实体时，先按稳定候选键排序，再连续分配；
4. 分配完成后必须同时写实体和注册表，任一失败则整体不落盘；
5. dry-run 只能展示拟分配 ID，不得推进计数器；
6. 并行分支不得分别提交重叠注册表修改；ID 分配和落盘应作为串行汇合步骤；
7. 迁移旧数据时，先冻结完整映射，再一次性写入，禁止边迁移边重新编号。

### 5.3 稳定身份判定

以下变化保留原 ID：

- 名称修正或新增别名；
- 来源、核验状态、说明更新；
- 同一实体的小范围几何校正；
- 在几何中插入不改变线路含义的顶点；
- 节点坐标因中心线校正发生小范围移动，但仍代表同一现实路口；
- 边的内部顶点变化，但起止节点和所属要素不变。

以下变化创建新 ID：

- 原来误认为同一要素，后确认应拆成多个独立要素；
- 多条重复要素合并为一个规范要素；
- 节点拆分为互不连通的多个节点；
- 多个节点经人工确认合并为同一节点；
- 边的起点、终点或所属要素改变；
- 一条边因新增正式节点被拆分；
- 多条边因删除错误节点而合并。

边因新增节点被拆分时，旧 `edgeId` 退役，新边记录：

```json
{
  "supersedes": ["be_0001023"]
}
```

旧边记录：

```json
{
  "lifecycle": "retired",
  "supersededBy": ["be_0012045", "be_0012046"]
}
```

---

## 六、边界要素契约

### 6.1 文件结构

`boundary_features.geojson` 是唯一人工维护的坐标库。

```json
{
  "type": "FeatureCollection",
  "schemaVersion": 2,
  "features": []
}
```

### 6.2 要素结构

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [[117.1, 36.1], [117.2, 36.2]]
  },
  "properties": {
    "featureId": "bf_000127",
    "canonicalName": "唐王河",
    "aliases": [],
    "featureType": "river",
    "boundaryEligible": true,
    "importance": "normal",
    "sourceType": "osm",
    "sourceName": "OpenStreetMap",
    "sourceUrl": null,
    "verifiedDate": "2026-11-17",
    "verificationStatus": "reviewed",
    "geometryAccuracy": "surveyedOrMapped",
    "lifecycle": "active",
    "supersedes": [],
    "supersededBy": [],
    "createdAt": "2026-11-17",
    "retiredAt": null,
    "note": ""
  }
}
```

`featureType` 取值：

- `road`
- `river`
- `railway`
- `administrativeBoundary`
- `wall`
- `manualRulingLine`

规则：

- 几何仅允许 `LineString` 或 `MultiLineString`；
- 同一现实中心线原则上只允许一个 active 要素；
- 同名不等于同一要素，异名也不必然是不同要素；身份由人工核验决定；
- `aliases` 用于四至文本匹配，不能把别名只写在 `note`；
- `manualRulingLine` 必须关联至少一个 `rulingId`，不能成为无来源自由线；
- `boundaryEligible=false` 的展示道路不得被新学区步骤引用；
- 每个 part 的首尾都必须成为拓扑节点；
- 有效交点必须作为两个相关要素中完全相同的顶点存在；
- 立交或下穿等不连通交叉不得生成共享节点。

---

## 七、拓扑节点契约

### 7.1 设计原则

节点表示一个真实或经裁定的拓扑位置。节点本身不保存坐标，坐标从其 `placements` 引用的边界要素顶点解析。

同一节点的全部 placement 坐标必须在 7 位小数下完全相同。若无法相同，则不能声明为同一正式节点。

### 7.2 节点结构

```json
{
  "nodeId": "bn_000842",
  "nodeType": "intersection",
  "connectionType": "connected",
  "label": "唐王河×东岳大街",
  "placements": [
    {
      "featureId": "bf_000127",
      "partIndex": 0,
      "vertexIndex": 22
    },
    {
      "featureId": "bf_000031",
      "partIndex": 0,
      "vertexIndex": 118
    }
  ],
  "derivationType": "geometryIntersection",
  "verificationStatus": "verified",
  "lifecycle": "active",
  "supersedes": [],
  "supersededBy": [],
  "createdAt": "2026-11-17",
  "retiredAt": null
}
```

`nodeType` 取值：

- `intersection`：两个及以上要素连通；
- `terminal`：要素 part 的端点；
- `control`：为切分闭合线、表达行政界控制点等增加的稳定控制点；
- `ruling`：人工裁定产生的边界转折点。

`connectionType` 取值：

- `connected`
- `nonConnectingCrossing`
- `conditional`

规则：

- `nonConnectingCrossing` 只用于审计交叉关系，不参与同节点换边；
- 正式路径只能经过 `connected` 节点；
- `conditional` 必须带裁定或通行条件，学区边界默认禁止自动采用；
- `terminal` 和 `control` 可以只有一个 placement；
- `intersection` 至少有两个不同 `featureId` 的 placement；
- 顶点下标只是当前快照内的定位信息，不是节点身份；几何插点后由构建器重算；
- 节点身份匹配必须优先读取上一版节点和迁移记录，不能按坐标重新编号。

---

## 八、拓扑边契约

### 8.1 设计原则

拓扑边表示同一边界要素上两个相邻节点之间的连续几何。边不保存坐标，只保存要素和顶点范围引用。

### 8.2 边结构

```json
{
  "edgeId": "be_0012045",
  "featureId": "bf_000127",
  "partIndex": 0,
  "fromNodeId": "bn_000842",
  "toNodeId": "bn_000911",
  "fromVertexIndex": 22,
  "toVertexIndex": 66,
  "lengthM": 1394.2,
  "boundaryEligible": true,
  "verificationStatus": "verified",
  "lifecycle": "active",
  "supersedes": [],
  "supersededBy": [],
  "createdAt": "2026-11-17",
  "retiredAt": null
}
```

规则：

- 一条边只能属于一个 `featureId` 和一个 `partIndex`；
- `fromNodeId` 与 `toNodeId` 必须不同；
- `fromVertexIndex < toVertexIndex`，定义为该边的规范方向；
- 学区逆向使用边时只写 `direction: reverse`，不能复制倒序坐标；
- 两端节点 placement 必须与 `featureId/partIndex/fromVertexIndex/toVertexIndex` 一致；
- 两端之间不得存在未切分的 active、connected 节点；
- 同一 feature part 的 active 边不得覆盖、遗漏或重复内部线段；
- `lengthM` 为派生校验字段，不参与身份判定；
- 新增节点导致边拆分时必须退役旧边并迁移所有引用；
- 闭合要素若只有一个交点，必须增加至少一个 `control` 节点，禁止生成普通自环边。

---

## 九、学区契约

### 9.1 学区成为语义源

`zone_specs.json` 升级为学区边界的权威语义来源，包含：

- 学区和学校关联；
- 官方 `boundaryText`；
- 人工裁定；
- 一个或多个环；
- 每个环的有序步骤；
- 每个步骤最终采用的有序拓扑边。

不得继续把现状 Polygon 的坐标写入 `ring`、`from.coord`、`to.coord` 或 `ringVertexSpan` 作为正式数据。

### 9.2 学区结构

```json
{
  "schemaVersion": 2,
  "zones": [
    {
      "zoneId": "zone_006",
      "zoneName": "山东省泰安第六中学新校区学区",
      "schoolId": "school_m_006",
      "stage": "初中",
      "year": 2025,
      "boundaryText": "东至双龙河，西至迎春路，北至东岳大街，南至灵山大街。",
      "policyIds": [],
      "boundaryRulings": [],
      "rings": []
    }
  ]
}
```

### 9.3 环与步骤

```json
{
  "ringId": "zr_000021",
  "role": "outer",
  "steps": [
    {
      "stepId": "zs_0000138",
      "side": "东",
      "text": "东至双龙河",
      "sourceType": "boundaryRuling",
      "rulingIds": ["br_000014"],
      "edgeRefs": [
        { "edgeId": "be_0012045", "direction": "forward" },
        { "edgeId": "be_0012046", "direction": "forward" }
      ]
    }
  ]
}
```

`role` 取值：

- `outer`
- `hole`

`side` 取值：

- `东` / `西` / `南` / `北`：官方原文按方位表述；
- `说明`：原文以路径、包含关系或补充条件描述，不对应单一方位；
- `排除`：原文中的排除区域。几何形态按 9.6 判定：与外环相接时并入外环作凹口，完全内嵌时才另建 `hole` 环；`排除` 步骤本身只出现在 `outer` 环中，用于标记该段属于排除边界。

`sourceType` 取值：

- `officialText`
- `boundaryRuling`
- `legacyMigration`

规则：

- 发布状态下每个步骤必须至少引用一个 active `edgeId`；绑定完成前 `edgeRefs` 允许为空数组，但不得扫描为已发布；
- 同一步骤内相邻边必须首尾节点连续；
- 相邻步骤必须首尾节点连续；
- 最后一步终点必须等于第一步起点；
- 环闭合按 `nodeId` 判断，不使用距离容差；
- 外环统一逆时针，洞环统一顺时针；构建器可调整输出坐标方向，但不得改变步骤顺序和引用方向；
- `legacyMigration` 只允许迁移期使用，正式切换前必须归零；
- 路径存在多解时必须显式写出最终 `edgeRefs`，禁止运行时自动选择最短路径；
- 共享边界的学区必须引用相同 `edgeId`，方向可以相反；
- 学区步骤不得直接引用 `featureId + from/to` 作为最终发布契约，该形式只允许存在于草稿候选中。

### 9.4 草稿与可视化录入

地图点选编辑器以 `network_nodes.json`、`network_edges.json` 和边占用索引为只读输入，输出独立草稿。草稿允许暂时未闭合，但不得保存自由坐标：

```json
{
  "draftId": "draft_zone_006_20261117_01",
  "schemaVersion": 1,
  "zoneId": "zone_006",
  "boundaryText": "东至双龙河，西至迎春路，北至东岳大街，南至灵山大街（除东湖路以北，温泉路以西区域）。",
  "status": "editing",
  "createdBy": "用户",
  "createdAt": "2026-11-17",
  "updatedAt": "2026-11-17",
  "rings": [
    {
      "role": "outer",
      "appliesToRingId": null,
      "steps": [
        { "stepId": "zs_0000117", "edgeRefs": [] },
        { "stepId": "zs_0000118", "edgeRefs": [] },
        {
          "stepId": "zs_0000009",
          "edgeRefs": [{ "edgeId": "be_0012045", "direction": "forward" }]
        }
      ]
    }
  ],
  "operations": [
    {
      "type": "selectEdge",
      "stepId": "zs_0000009",
      "edgeId": "be_0012045",
      "decidedBy": "用户",
      "decidedAt": "2026-11-17",
      "textRef": "北至东岳大街"
    }
  ],
  "rejectReason": null
}
```

规则：

- 草稿按正式步骤逐条绑定：`stepId` 必须沿用 `zone_specs.json` 中的步骤，不新增、不改序、不改写原文；环的有序边序列由步骤顺序拼接派生，不再另存一份环级 `edgeRefs`；
- 字段级冻结、状态取值和校验清单见 `docs/planning/草稿字段冻结清单.md`；
- 编辑器只能选择、取消选择或反向使用既有 active、`boundaryEligible=true` 的边；
- 自动补全只能列出候选路径，禁止静默采用最短路径、最近道路或补画直线；
- 候选路径为零或多条时必须停留在草稿态并要求人工选择；
- 相邻学区已使用的边应显示归属并优先复用，但不得自动改变当前学区；
- 外环和排除区域必须按 9.6 判定形态后再保存：与外环相接的排除区并入 `outer` 作凹口，完全内嵌的排除区才保存为 `hole`，不得用删除 Polygon 坐标的方式表达排除；
- 需要使用半条边时，说明网络缺少节点，必须回到边界要素和节点层处理；
- 编辑器不得直接修改 `boundary_features`、`network_nodes`、`network_edges` 或正式 `zone_specs`；
- 导入正式数据前必须补齐步骤、原文引用和裁定关系，并由人工确认最终地图结果。

### 9.5 人工裁定

```json
{
  "rulingId": "br_000014",
  "edge": "东",
  "original": "双龙河",
  "adopted": "唐王河",
  "geometryRefs": {
    "featureIds": ["bf_000127"],
    "edgeIds": ["be_0012045", "be_0012046"]
  },
  "reason": "现状边界和相邻学区共同贴合唐王河，双龙河距该边界显著偏远。",
  "decidedAt": "2026-10-26",
  "decider": "用户",
  "lifecycle": "active",
  "supersedes": [],
  "supersededBy": [],
  "createdAt": "2026-10-26",
  "retiredAt": null
}
```

规则：

- `boundaryText` 禁止因裁定被改写；
- `original` 必须忠实摘录或概括官方原文；
- `adopted` 表达最终采用对象；
- `geometryRefs.edgeIds` 是最终几何依据；
- 只有尚未完成边切分的迁移记录可以暂时只有 `featureIds`；
- 裁定变更必须创建新 `rulingId`，旧裁定退役并通过 `supersededBy` 关联，不覆盖历史决定。

### 9.6 排除区域与飞地的几何形态

原文中的「除……区域」「不含……」「××除外」不必然等于洞。必须先判定几何形态，再决定写入哪种环，禁止一律建成 `hole`。

三种形态：

| 形态 | 判定条件 | 数据形态 |
| --- | --- | --- |
| 凹口 excision | 排除区与外环相接，且无法独立闭合成环 | 并入 `outer`，该段步骤 `side=排除`；不建 `hole` |
| 真洞 hole | 排除区完全内嵌于外环，自成闭包且不与外环接触 | 独立 `ring`，`role=hole`，`appliesToRingId` 指向本学区 `outer` |
| 飞地 enclave | 排除区完全位于外环之外，与主区不连通 | 需要 MultiPolygon（多个 `outer` 环）；当前 14 个学区均不适用，须先出裁定 |

判定步骤（顺序不可颠倒）：

1. 先取排除区的闭合轮廓，与外环做接触判定；
2. 有相交或共点 → 凹口。凹口两端必须是外环上已有节点，凹口段直接成为外环的一段；
3. 无接触且完全落在外环内部 → 真洞。洞环顶点不得与外环共享节点；
4. 无接触且完全落在外环外部 → 飞地。不得塞进 `hole`，须走裁定后按多外环处理。

约束：

- 排除区无法独立闭合（原文只给半开边界，如只描述两条街围成的角）时，只能按凹口处理，并在裁定 `reason` 中写清补全依据；
- `side=排除` 只允许出现在 `outer` 环中，用于标记「这一段是排除区的边界」；`hole` 环内出现 `side=排除` 视为错误；
- `hole` 环至少 3 个步骤，且 `appliesToRingId` 必须等于本学区唯一的 `outer` 环 ID；
- 每个学区必须且只能有一个 `outer` 环；需要飞地时另立多外环方案，不在此处临时扩展。

zone_006 落地示例：

- 原文：「除东湖路以北，温泉路以西区域」
- 判定：凹口。东湖路自迎春路向东至温泉路、温泉路自东湖路向北至东岳大街，两端分别落在西界迎春路与北界东岳大街，与外环相接，未形成独立闭包；现有派生 Polygon 也是单环、西北角在环外。
- 落地：`zone_006` 外环共 6 步，前两步 `side=排除`（「除东湖路以北」「温泉路以西区域」），共同引用裁定 `br_000003`；不生成 `hole`。

---

## 十、派生 `zones.geojson`

构建器按以下规则生成运行时 Polygon：

1. 读取 `zone_specs.json` 中每个环的有序步骤；
2. 展开每个 `edgeRef`；
3. 从 `network_edges.json` 找到 `featureId/partIndex/vertex range`；
4. 从 `boundary_features.geojson` 取得唯一权威坐标；
5. `forward` 使用规范顺序，`reverse` 使用倒序；
6. 拼接时去掉相邻边重复端点；
7. 最后只补一个闭合点；
8. 校验方向、自交、面积、共边一致性和全量溯源；
9. 把学区元数据复制到 GeoJSON properties；
10. 写入构建信息和源文件哈希报告。

`zones.geojson` 中每个要素应增加：

```json
{
  "geometrySource": "networkDerived",
  "networkSchemaVersion": 2,
  "zoneSpecHash": "sha256:...",
  "boundaryFeatureHash": "sha256:...",
  "networkEdgeHash": "sha256:..."
}
```

禁止直接编辑派生 Polygon。任何人工修改都必须回到边界要素、节点、边或学区步骤层。

---

## 十一、强制校验

### 11.1 边界要素

- `featureId` 格式正确、全局唯一、全部为 string；
- `canonicalName` 非空，`aliases` 无重复；
- 几何类型合法，坐标范围合法，无连续重复点和退化段；
- active 同实体重复线进入拒发清单；
- `manualRulingLine` 必须存在裁定引用；
- 所有来源和核验枚举合法。

### 11.2 节点

- `nodeId` 格式正确、全局唯一；
- placement 引用的要素、part 和 vertex 存在；
- 同一 connected 节点的所有 placement 坐标 7 位小数完全一致；
- intersection 至少引用两个不同要素；
- 每个 feature part 的首尾均有节点；
- 一个 feature 顶点不能无裁定地属于两个不同 active connected 节点；
- 非连通交叉不得被路径算法换边。

### 11.3 拓扑边

- `edgeId` 格式正确、全局唯一；
- feature、part、节点和顶点引用全部存在；
- 端点 placement 与顶点范围一致；
- 起止节点不同，顶点范围递增；
- feature part 被 active 边完整且不重叠地覆盖；
- 边内部不存在未切分 connected 节点；
- 重新计算长度与记录值差异在允许精度内。

### 11.4 学区

- `zoneId/ringId/stepId/rulingId` 唯一且格式正确；
- 每个学区必须且只能有一个 `role=outer` 的环；
- `side`、`sourceType`、`role` 均取自枚举，不得自由填写；
- `role=hole` 的环必须用 `appliesToRingId` 指向本学区 `outer` 环，且至少 3 个步骤；
- `role=hole` 的环内不得出现 `side=排除` 的步骤；与外环相接的排除区应并入外环作凹口（9.6）；
- 每个正式步骤只引用 active、boundaryEligible 的边；
- 步骤内、步骤间和环首尾按 nodeId 精确连续；
- 外环逆时针、洞环顺时针；
- 闭合误差为 0，自交为 0，面积大于 0；
- 顶点溯源率和线段溯源率均为 100%；
- 共用边的坐标序列完全一致或完全反向；
- `boundaryText` 存在且未被裁定改写；
- 所有 `boundaryRulings.geometryRefs` 可解析；
- 发布包中 `legacyMigration` 数量必须为 0。

### 11.5 确定性

- 同一输入连续构建两次，所有派生文件 SHA-256 一致；
- 构建器不得写入当前时间到派生数据主体；生成时间只进入独立报告；
- 数组排序、字段顺序和数值精度固定；
- dry-run 不得修改任何数据文件或 ID 计数器。

---

## 十二、旧数据迁移规则

### 12.1 `roadId` 迁移

现有 `roadId` 同时存在字符串和数字，且数字 `62` 与字符串 `road_062` 指向不同实体，因此不能通过格式补零直接归一。

迁移时必须生成显式映射：

```json
{
  "legacyType": "roadId",
  "legacyValue": 62,
  "legacyJsonType": "number",
  "featureId": "bf_000061"
}
```

和：

```json
{
  "legacyType": "roadId",
  "legacyValue": "road_062",
  "legacyJsonType": "string",
  "featureId": "bf_000064"
}
```

迁移键必须同时包含 JSON 类型和值，禁止先统一转成字符串再匹配。

### 12.2 交点 ID 迁移

现有 `ix_<roadIds>_<n>` 依赖道路排序、沿线里程和序号，不能作为永久节点 ID。

迁移流程：

1. 冻结当前 `intersections.geojson` 哈希；
2. 按旧 ID、成员要素、part、顶点和坐标建立迁移候选；
3. 人工处理一对多、多对一和近邻 anchor 情况；
4. 为确认后的真实拓扑节点分配 `bn_*`；
5. 以 `{ namespace, jsonType, value }` 形式保留 `legacyRefs`；
6. 后续几何重算只能匹配既有节点，禁止重新按顺序编号。

### 12.3 `zone_specs` 迁移

现有 `ring-snap`、`legacy`、`ring` 坐标和 `vertexSpan` 仅作为迁移证据，不直接升级为正式边引用。

每个现有步骤必须经过：

1. 解析旧 `roadId` 到 `featureId`；
2. 解析 from/to 旧交点到 `nodeId`；
3. 在单一 feature 上列出候选边路径；
4. 无解或多解时进入人工裁定；
5. 人工确认后固化为有序 `edgeRefs`；
6. 删除正式记录中的自由坐标和旧环顶点；
7. 与旧 Polygon 生成偏移和面积差异报告。

### 12.4 迁移期双轨

迁移期间允许同时保留：

- 旧 `roads.geojson` 与新 `boundary_features.geojson`；
- 旧 `intersections.geojson` 与新节点、边文件；
- 旧手绘 `zones.geojson` 与新派生候选环。

但必须遵守：

- 新数据只能引用新 ID；
- 旧 ID 只通过迁移表解析；
- 不允许新旧 ID 在同一个正式实体中混用；
- 当前发布指针在全量验收前继续指向旧体系；
- 切换必须整批完成，不能让相邻学区一部分使用旧坐标、一部分使用新网络。

---

## 十三、并行工作边界

### 13.1 工作流一：边界数据标准化

负责：

- 边界要素清洗、去重、命名、别名和来源；
- 交点、端点、控制点的确认；
- 要素顶点插入与精确共点；
- 配合工具输出确认交点、端点和非连通交叉；
- 对拓扑缺口和异常候选进行现实数据核验。

不负责：

- 解释某所学校四至应采用哪条候选线；
- 自动决定原文冲突；
- 修改官方 `boundaryText`。

### 13.2 工作流二：网络工具与可视化编辑

负责：

- 自动计算交点并生成稳定节点和拓扑边；
- 生成边占用索引和相邻学区共边提示；
- 提供地图点选、取消、反向、撤销和候选路径预览；
- 导入导出 `zone_drafts`，并将已确认草稿转换为待合并数据；
- 生成派生环、差异报告和自动校验结果；
- 为关键算法和失败条件提供自动测试。

不负责：

- 解释官方四至最终应采用哪条候选线；
- 修改官方 `boundaryText` 或自行作出人工裁定；
- 为解决闭环问题私自修改边界要素；
- 用最近距离、最短路径或自由直线静默替代无解或多解路径；
- 绕过导入器直接修改正式 `zone_specs`。

### 13.3 工作流三：学区语义与验收

负责：

- 从官方四至拆分步骤并确认名称、别名和空间含义；
- 在可视化编辑器中选择候选边、复用共边并表达排除区域；
- 对无解、多解、原文冲突和非道路参照作出或申请人工裁定；
- 审核草稿生成的 `edgeRefs`、派生环和新旧差异；
- 确认后将草稿合并到正式学区语义源。

不负责：

- 在学区文件中创建自由坐标；
- 修改边界要素以迎合某个学区结果；
- 跳过自动校验直接发布。

### 13.4 汇合规则

- 三个工作流可以同时准备数据、工具和语义候选；
- 正式 `edgeRefs` 只能引用已通过标准化验收的 active 边；
- 可视化工具只提交草稿，最终业务采信由人工完成；
- 路网变更导致边拆分或合并时，必须生成影响清单和引用迁移建议；
- 学区引用迁移完毕并通过校验后，旧边才可退役；
- ID 分配、注册表写入和正式发布是串行汇合步骤。

---

## 十四、实施阶段

### 阶段 0：契约评审

- 确认文件命名、字段、枚举和 ID 格式；
- 确认节点是否必须做到共点；
- 确认旧 `roadId` 是否只作为带类型的 `legacyRefs` 保留；
- 确认 `zones.geojson` 降级为纯派生产物。

### 阶段 1：只读审计器

- 检查旧 ID 类型与冲突；
- 生成旧要素、节点和学区步骤迁移候选；
- 不写正式数据；
- 输出无法自动迁移的阻断清单。

### 阶段 2：ID 注册与边界要素迁移

- 创建注册表和完整旧 ID 映射；
- 生成 `boundary_features.geojson`；
- 保持几何不变完成机械迁移；
- 通过哈希、数量和几何等价校验。

### 阶段 3：节点与边

- 生成稳定节点；
- 处理近邻节点和非连通交叉；
- 将有效交点精确写入相关要素；
- 生成完整、无重叠的拓扑边。

### 阶段 4：可视化编辑器

- 接入真实节点、边和边占用索引；
- 实现点选、共边复用、候选路径预览和洞环编辑；
- 实现草稿导入导出、撤销和实时校验；
- 禁止自由坐标和静默自动决策。

### 阶段 5：学区绑定

- 将全部学区拆成步骤；
- 通过编辑器生成草稿并人工确认 `edgeRefs`；
- 清零 `legacyMigration`；
- 生成全部派生环和对比报告。

### 阶段 6：整批切换

- 运行全量门禁；
- 生成新不可变发布版本；
- 切换 `current.json`；
- 旧体系保留为历史快照，不再接受新编辑。

---

## 十五、回滚策略

- 每次写操作前保存源文件哈希和完整快照；
- ID 注册表与实体文件必须作为同一批次变更；
- 迁移脚本默认 dry-run；
- 新体系验收前不修改当前发布指针；
- 切换后若发现问题，仅回退 `current.json`，不原地修改发布目录；
- 已分配但未发布的 ID 也不复用，标记为 retired；
- 任何人工裁定的撤销都通过新裁定取代旧裁定，保留历史链路。

---

## 十六、已确认决策

以下四项均已确认，作为后续实现的固定前提：

1. `boundary_features.geojson` 作为唯一人工维护坐标源，`roads.geojson` 进入兼容迁移期；
2. 统一使用不带类型语义的 `bf_*` 作为新 `featureId`，旧 `road_*/river_*/rail_*` 仅保留为带命名空间和 JSON 类型的 `legacyRefs`；
3. 正式 connected 节点在所有相关要素中使用 7 位小数完全相同的顶点坐标，不再保留“逻辑同点、物理坐标不同”的 anchor 模型；
4. 学区正式契约直接固化有序 `edgeRefs`，不在运行时按 `featureId + fromNodeId + toNodeId` 自动寻路。

以上四项均采用，以实现单一坐标来源、稳定引用和零容差闭环。
