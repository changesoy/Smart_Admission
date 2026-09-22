# 架构说明

> 本文描述**系统的结构**：模块如何分层、数据如何流转、坐标系如何约定。
> 规范类内容（命名、编码、样式、密钥、提交）以 [CONTRIBUTING.md](../CONTRIBUTING.md) 为唯一来源，本文只做引用，不复制。

---

## 一、总体结构

系统由两个可独立运行的部分组成，二者只通过一个 HTTP 接口相连：

```
浏览器（静态站点）                          Python 进程
┌───────────────────────────┐             ┌──────────────────────┐
│ index.html + js/ (ESM)    │  /api/search│ server/ (FastAPI)    │
│ Leaflet 地图 + Turf 点面判断│ ──────────► │ 代理天地图搜索 + 范围过滤│
│ 本地 JSON/GeoJSON 数据     │             │ health / version     │
└───────────────────────────┘             └──────────────────────┘
```

- **业务逻辑全在前端**：数据加载、学区点面判断、政策匹配、自查规则求值都在浏览器内完成。
- **后端只是代理**：不查数据库、不存状态、不做业务判断，职责见第五章。
- 前端不持有搜索 Key，只以同源相对路径 `/api/search` 调用（开发期由 `vite.config.js` 代理，生产由 Nginx 转发）。

---

## 二、前端模块架构

> 贡献者视角的精简架构图见 [CONTRIBUTING.md 第一章](../CONTRIBUTING.md)；本节在其上补充模块职责与对外接口。

模块依赖通过 `import` / `export` 显式声明，`index.html` 只引入一个入口脚本。
`index.html` 中仅有两类 `<script>`：第三方库 CDN（Leaflet / Turf，暴露全局 `L` / `turf`）与 `<script type="module" src="/js/main.js">`。

```
index.html ──────────────────── 主页面（仅引入 main.js module 脚本）
  │
  └── main.js ───────────────── 主入口（import 全部模块，协调初始化顺序）
        │
        ├── config.js ──────── 全局配置（所有模块的单一数据源）
        ├── dataService.js ─── 数据加载（版本指针 + fetch 并行加载）
        ├── render.js ──────── DOM 渲染（统计卡片/结果面板/错误状态）
        ├── policyService.js ─ 政策渲染与年度对比
        ├── mapService.js ──── 地图服务（Leaflet + Turf 点面判断）
        ├── simulatorService.js  入学条件自查 / 情形判断助手
        ├── faqService.js ──── 常见问题（搜索/分类/展开）
        ├── interactionService.js  政民互动（留言/联系卡片）
        └── searchService.js ─ 搜索服务（本地匹配 + 服务端联网查询）
```

### 模块职责

| 模块                    | 职责                                                   | 关键对外接口                                    |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `config.js`             | 集中配置：地图参数、瓦片、数据版本、学区样式、提示文案 | `AppConfig`                                     |
| `dataService.js`        | 解析版本指针，整包并行加载数据                         | `loadAllData()`                                 |
| `render.js`             | 统计卡片、结果面板、空/错误状态、文本转义              | `renderStats()`、`safeText()`、`renderResult()` |
| `mapService.js`         | 地图初始化、学区图层渲染、点击选点与点面判断           | `initMap()`、`findZonesByPoint()`               |
| `searchService.js`      | 本地地址/关键词匹配，本地无命中时联网查询              | `init()`                                        |
| `policyService.js`      | 政策列表筛选与年度对比                                 | `init()`                                        |
| `simulatorService.js`   | 入学条件自查：按表单取值匹配规则、输出材料与依据       | `init()`                                        |
| `faqService.js`         | 常见问题搜索、分类筛选、展开收起与关联跳转             | `init()`                                        |
| `interactionService.js` | 联系卡片渲染与留言表单本地持久化                       | `init()`                                        |

> `searchService.js` 是**唯一**与后端交互的前端模块。本地索引无命中、或命中地址点坐标缺失时，
> 以同源相对路径请求 `/api/search`，由后端完成天地图调用与范围过滤，前端只消费归一化结果。

---

## 三、初始化顺序

`main.js` 的 `bootstrapPage()` 按下列顺序调用，各模块用 `safeInit` 包裹以隔离异常
（某个模块初始化失败不会中断其余模块，失败模块会打印到控制台）：

1. `DataService.loadAllData()` — 并行加载全部数据文件
2. `RenderService.renderStats()` — 渲染统计卡片
3. `RenderService.renderDefaultResultTip()` — 渲染引导提示
4. `PolicyService.init()` — 初始化政策模块
5. `SimulatorService.init()` — 初始化入学条件自查助手
6. `FaqService.init()` — 初始化 FAQ 模块
7. `InteractionService.init()` — 初始化互动模块
8. `MapService.initMap()` + `SearchService.init()` — 初始化地图和搜索（含回调绑定）
9. `StageFilter` — 绑定学段筛选复选框（只影响地图显示）

---

## 四、数据流与数据版本

### 4.1 加载流程

```
data/current.json ──► version ──► data/releases/<version>/ ──► Promise.all 并行 fetch
                                          │
                                          └──► main.js 按模块分发 ──► 各 Service 渲染
```

启动时先读版本指针拿到版本号，再从该版本目录**整包加载**（见 `dataService.js` 的 `resolveRelease()`）。
指针指向不存在的版本时，页面显示带失败文件路径的错误提示，不会白屏。

### 4.2 三种目录角色

`data/*.json` 是**工作副本**（日常改这里），`data/releases/<版本>/` 是**已发布快照**（只增不改），
`data/current.json` 是**当前生效指针**（切换版本即改它）。

发布新版本、回滚与发布门禁的完整流程见 [CONTRIBUTING.md 第 4.5 / 4.6 节](../CONTRIBUTING.md)。

### 4.3 数据文件清单

纳入发布包的文件清单取自 `js/config.js` 的 `dataPaths`，前端与发布脚本读同一份配置，
因此不存在"新增了数据文件但忘记打包"的情况。

| 数据文件               | 用途                                  | 消费模块                     |
| ---------------------- | ------------------------------------- | ---------------------------- |
| `zones.geojson`        | 学区边界 Polygon (FeatureCollection)  | MapService, RenderService    |
| `schools.json`         | 学校信息（名称/地址/电话/区县/类型）  | RenderService                |
| `policies.json`        | 招生政策列表                          | PolicyService, RenderService |
| `policy_diff.json`     | 政策年度对比数据                      | PolicyService                |
| `simulator_rules.json` | 入学自查规则与材料字典                | SimulatorService             |
| `address_points.json`  | 本地地址点索引                        | SearchService                |
| `keywords_index.json`  | 关键词索引（含关联 zoneId）           | SearchService                |
| `faq.json`             | 常见问题（含分类/优先级/关联）        | FaqService                   |
| `zones_history.json`   | 学区历年调整记录                      | RenderService                |
| `contacts.json`        | 联系方式                              | InteractionService           |
| `rumors.json`          | 辟谣信息（暂未接入渲染）              | 预留                         |
| `manifest.json`        | 发布清单（版本/生成时间/文件 sha256） | 发布门禁, `/api/version`     |

各文件的**字段结构**与新增文件的检查清单见 [CONTRIBUTING.md 第 4.2 / 4.3 / 4.4 节](../CONTRIBUTING.md)。

---

## 五、后端职责边界

`server/` 是 **Backend Lite**，只有三个接口：`/api/health`（存活检查）、`/api/version`（上报应用与数据版本）、
`/api/search`（代理天地图搜索并做范围过滤）。

**明确不负责**：点面判断、学区查询、下发学校/政策数据、用户账号、管理后台。
任何"顺手把业务逻辑搬到后端"的改动都超出边界，应先讨论而不是直接实现。

接口定义、前端调用约定、两枚天地图 Key 的分工与安全要求，见
[CONTRIBUTING.md 第十一章](../CONTRIBUTING.md)。

---

## 六、地图与坐标约定

底图使用**天地图**（国家地理信息公共服务平台），默认中心 `[36.1947, 117.1297]`（山东省泰安市泰山区附近），
缩放级别 `14`；学区图层样式按学段与交互状态分组定义在 `config.js` 的 `zoneStyle`。

> ⚠️ GeoJSON 与 Leaflet 的坐标顺序不同，**极易出错**（GeoJSON / Turf 是 `[lng, lat]`，Leaflet 是 `[lat, lng]`），
> 且 Polygon 必须首尾点相同才算闭合。四处易错点的对照表见
> [CONTRIBUTING.md 第五章](../CONTRIBUTING.md)，改地图相关代码前先读那张表。
