# 智慧入学·学区治理一站式可视化门户

> 阶段性原型 · 前端可视化 + Backend Lite 搜索代理 · 基于学区边界、招生政策与入学条件自查的查询门户

---

## 目录

- [一、项目简介](#一项目简介)
- [二、技术栈](#二技术栈)
- [三、目录结构](#三目录结构)
- [四、本地运行方式](#四本地运行方式)
- [五、功能说明](#五功能说明)
- [六、模块架构](#六模块架构)
- [七、数据文件说明](#七数据文件说明)
- [八、地图与坐标说明](#八地图与坐标说明)
- [九、代码规范](#九代码规范)
- [十、项目边界与声明](#十项目边界与声明)
- [十一、后续扩展方向](#十一后续扩展方向)
- [十二、常见问题](#十二常见问题)

---

## 一、项目简介

本项目是面向义务教育入学场景的"一站式查询"门户，整合学区划分、招生政策、入学条件自查与常见问题，提供轻量化的可视化政务服务体验。当前版本为**阶段性原型**：前端为 Vanilla JS + Leaflet 的纯静态站点，另含一个职责极窄的 **Backend Lite**（仅 health / version / 第三方搜索代理三个接口）；无数据库、无登录注册。

**核心目标：**

- 让家长在一个页面内完成"学区查询 → 政策了解 → 入学条件自查 → 疑问解答"的闭环；
- 通过"前端 GIS + 本地 JSON / GeoJSON + 最小后端代理"的轻量架构，验证可迁移、低成本的政务网站技术路线；
- 为后续接入真实政务数据、完善业务功能奠定结构基础。

---

## 二、技术栈

| 类别     | 技术                                           | 版本                         |
| -------- | ---------------------------------------------- | ---------------------------- |
| 基础     | HTML5 / CSS3 / Vanilla JavaScript (ES Modules) | —                            |
| 构建工具 | Vite (dev / build / preview)                   | 8.x                          |
| UI 框架  | Bootstrap 5 + Bootstrap Icons                  | 5.3.2 / 1.11.3               |
| 地图     | Leaflet + 天地图在线瓦片 (WMTS)                | 1.9.4                        |
| 空间计算 | Turf.js (`booleanPointInPolygon`)              | 6.5.0                        |
| 数据     | 本地 JSON / GeoJSON 文件（按版本目录组织）     | —                            |
| 后端     | FastAPI + uvicorn + httpx                      | 见 `server/requirements.txt` |
| 代码规范 | ESLint 扁平配置 (ES Modules 语法检查)          | 9.x                          |

**本项目不使用** Vue / React / Angular / TypeScript / 商业地图 API / Node 后端（后端为 Python，且只做代理，不承载业务逻辑）。

---

## 三、目录结构

```
smart-admission/
├── index.html                  # 主页面（Vite 入口 HTML）
├── vite.config.js              # Vite 配置（/api 代理 + 构建时复制 data/ 到 dist/）
├── README.md                   # 项目说明
├── CONTRIBUTING.md             # 贡献指南（修改前必读）
├── package.json                # npm 配置（dev/build/preview/lint/校验脚本）
├── eslint.config.js            # ESLint 9.x 扁平配置
├── .env.example                # 后端环境变量模板（复制为 .env 后填写）
├── .gitignore                  # Git 忽略规则（node_modules/ dist/ .venv/ .env）
├── dist/                       # 构建产物（不提交，由 npm run build 生成）
├── css/
│   └── style.css               # 全局样式（含所有模块样式）
├── js/                         # 全部为 ES Modules（import/export 显式依赖）
│   ├── config.js               # 全局配置（地图/数据版本/学区样式/搜索接口/提示文案）
│   ├── dataService.js          # 数据加载服务（解析版本指针 + fetch 并行加载）
│   ├── render.js               # 渲染服务（统计卡片/结果面板/错误状态/网站说明）
│   ├── mapService.js           # 地图服务（Leaflet 渲染 + Turf 点面判断）
│   ├── searchService.js        # 搜索服务（本地地址点/关键词 + 服务端联网查询）
│   ├── policyService.js        # 政策渲染与年度对比服务
│   ├── simulatorService.js     # 入学条件自查 / 情形判断助手
│   ├── faqService.js           # 常见问题（搜索 + 分类筛选 + 展开/收起）
│   ├── interactionService.js   # 政民互动（联系卡片 + 留言表单 + 本地存储）
│   └── main.js                 # 主入口（import 所有模块，协调初始化顺序）
├── data/
│   ├── current.json            # 数据版本指针（当前生效的发布版本号）
│   ├── releases/               # 不可变数据发布快照，一次一目录
│   │   └── 2026.09.1/          # 版本目录：11 个数据文件 + manifest.json
│   └── *.json / *.geojson      # 数据源文件（由发布脚本打包进 releases/<版本>/）
├── server/                     # Backend Lite（FastAPI，仅 3 个接口）
│   ├── app.py                  # 应用入口 + 统一异常收敛
│   ├── config.py               # 环境变量与常量（含搜索范围唯一来源）
│   ├── errors.py               # 统一错误码与响应结构
│   ├── data_release.py         # 读取 data/current.json 与 manifest
│   ├── requirements.txt        # 后端依赖
│   ├── routes/                 # health / version / search 三组路由
│   └── services/               # 天地图上游封装 + 简易限流
├── scripts/                    # Node 脚本（数据校验与发布）
│   ├── validate-data.mjs       # 开发期数据校验（npm run validate:data）
│   ├── check-release.mjs       # 发布门禁（npm run check:release）
│   ├── new-data-release.mjs    # 生成新的数据发布包
│   └── lib/validate-core.mjs   # 校验逻辑单一来源（被上述两个校验入口共用）
└── docs/                       # 文档与数据说明
    ├── data-schema.md          # 数据结构文档
    ├── zone-school-list.md     # 学区-学校对应表
    ├── address_points.json     # 地址点数据备份
    ├── keywords_index.json     # 关键词数据备份
    └── zones_history.json      # 历史数据备份
```

---

## 四、本地运行方式

### 前置要求

- Node.js 18+（含 npm）
- Python 3.10+（仅后端需要）
- 现代浏览器（Chrome / Edge / Firefox 最新版）

### 后端启动（联网搜索必需）

前端以同源相对路径 `/api/search` 调用后端；天地图服务端 Key 与搜索范围过滤都在后端，
前端不持有搜索 Key。

```bash
cd smart-admission

# 1. 创建虚拟环境并安装依赖
python -m venv .venv
.venv\Scripts\pip.exe install -r server/requirements.txt

# 2. 配置环境变量（复制模板后填入服务端 Key）
copy .env.example .env

# 3. 启动后端（端口需与 vite.config.js 的 API_TARGET 一致）
.venv\Scripts\python.exe -m uvicorn server.app:app --port 8010 --reload
```

> 未启动后端时，地图、学区查询、政策、自查等本地功能不受影响；只有"本地无匹配时的联网搜索"
> 会提示查询失败，属预期行为。

### 前端开发模式

```bash
# 1. 安装开发依赖（Vite + ESLint）
npm install

# 2. 启动 Vite 开发服务器（默认 http://localhost:5173，/api 自动代理到 8010）
npm run dev

# 3. 浏览器访问
http://localhost:5173
```

页面打开后会自动读取 `data/current.json` 指针，并并行加载该版本下的全部数据文件，完成后初始化地图。

### 生产构建与预览

```bash
npm run build      # 构建产物输出到 dist/（含 data/ 静态数据）
npm run preview    # 本地预览 dist/ 构建产物（同样把 /api 代理到 8010）
```

`dist/` 已加入 `.gitignore`，不提交到仓库；正式部署时发布 `dist/` 内容，并由 Nginx 等反向代理
把 `/api` 转发到后端进程（前端不打包后端地址）。

### 代码检查与数据发布

```bash
npm run lint        # ESLint 语法检查
npm run lint:fix    # 自动修复可修复问题
npm run validate:data     # 数据完整性校验（开发期）
npm run check             # lint + validate:data，提交前必跑
npm run check:release     # 发布门禁（严格模式，命中拒发项时退出码为 1）
node scripts/new-data-release.mjs <版本号>   # 生成不可变数据发布包（不自动改指针）
```

数据版本与发布门禁的完整用法见 [CONTRIBUTING.md](CONTRIBUTING.md) 第 4.5 / 4.6 节。

---

## 五、功能说明

| 模块             | 功能描述                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **数据概览**     | 顶部 4 张统计卡片，实时展示学区、学校、政策、FAQ 数量                                                                                                 |
| **搜索查询**     | 输入学校、小区、道路或地址关键词，本地匹配地址点与关键词索引；本地无命中（或命中项坐标缺失）时经服务端 `/api/search` 代理联网查询，支持多结果下拉选择 |
| **学区等级筛选** | 初中/小学复选框，只控制地图上不同学段学区的显示与隐藏；不影响业务查询结果（隐藏后查询仍返回完整归属）                                                 |
| **学区地图**     | Leaflet + 天地图底图，渲染学区 Polygon（初中蓝色/小学绿色），悬停高亮、点击选中，自动适配视野                                                         |
| **学区查询**     | 点击地图任意位置或搜索地址，使用 Turf 对全部学区数据做点面判断，同一坐标可同时返回小学+初中归属；地图点击与地址搜索共用同一查询入口                   |
| **查询结果面板** | 按"小学学区 / 初中学区"分组展示：学区名 / 招生范围 / 对应学校（地址/电话/区县/类型/官网）/ 关联政策 / 历年调整记录时间线；无匹配时显示明确空状态      |
| **招生政策**     | 政策卡片列表，支持按"分类"和"年份"双向筛选，默认显示 6 条可展开                                                                                       |
| **政策年度对比** | 选择相邻年份，对比政策变化项与未变化项，含变化说明                                                                                                    |
| **入学条件自查** | 按学段/户籍/住房等情形选择，匹配政策规则输出情形分类、需核验条件、建议准备材料与相关政策依据，不做录取概率预测                                        |
| **常见问题**     | 关键词搜索 + 分类标签筛选，问题可展开/收起，支持关联问题跳转                                                                                          |
| **留言建议**     | 在线留言表单（含字数统计和分类选择），留言持久化到 localStorage，支持 Toast 提示                                                                      |
| **网站说明**     | 明示平台范围与数据来源，避免误解                                                                                                                      |

---

## 六、模块架构

项目代码组织为 **ES Modules**：`index.html` 只引入一个 `<script type="module" src="/js/main.js">`，
模块依赖全部通过 `import` 显式声明，不存在 `window.XxxService` 全局依赖和 `<script>` 加载顺序约束。

```
index.html ─────────────────────────── 主页面（仅引入 main.js module 脚本）
  │
  └── main.js ────────────────────── 主入口（import 全部模块，协调初始化顺序）
        │
        ├── config.js ────────────── 全局配置（所有模块的单一数据源）
        │
        ├── dataService.js ──────── 数据加载（fetch + async/await 并行加载）
        │
        ├── render.js ──────────── DOM 渲染（统计卡片/结果面板/错误状态）
        │
        ├── policyService.js ───── 政策渲染与年度对比
        │
        ├── mapService.js ──────── 地图服务（Leaflet + Turf 点面判断）
        │
        ├── simulatorService.js ─ 入学条件自查 / 情形判断助手
        │
        ├── faqService.js ──────── 常见问题（搜索/分类/展开）
        │
        ├── interactionService.js  政民互动（留言/联系卡片）
        │
        └── searchService.js ───── 搜索服务（本地匹配 + 服务端联网查询）
```

其中 `searchService.js` 是唯一与后端交互的前端模块：本地索引无命中、或命中的地址点坐标缺失时，
以同源相对路径请求 `/api/search`，由后端完成天地图调用与范围过滤，前端只消费归一化后的结果。

**初始化顺序（main.js 中按序调用，各模块用 safeInit 隔离异常）：**

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

## 七、数据文件说明

所有业务数据以**不可变发布包**的形式组织在 `data/releases/<版本>/` 下，
`data/current.json` 指向当前生效版本。下表为 `2026.09.1` 版本的内容：

| 数据文件               | 大小   | 用途                                  | 消费模块                     |
| ---------------------- | ------ | ------------------------------------- | ---------------------------- |
| `zones.geojson`        | 147 KB | 学区边界 Polygon (FeatureCollection)  | MapService, RenderService    |
| `schools.json`         | 62 KB  | 学校信息（73 所示例）                 | RenderService                |
| `policies.json`        | 32 KB  | 招生政策列表                          | PolicyService, RenderService |
| `policy_diff.json`     | 25 KB  | 政策年度对比数据                      | PolicyService                |
| `simulator_rules.json` | 25 KB  | 入学自查规则与材料字典                | SimulatorService             |
| `address_points.json`  | 21 KB  | 本地地址点索引                        | SearchService                |
| `faq.json`             | 9 KB   | 常见问题（含分类/优先级/关联）        | FaqService                   |
| `keywords_index.json`  | 6.5 KB | 关键词索引（含关联 zoneId）           | SearchService                |
| `zones_history.json`   | 5 KB   | 学区历年调整记录                      | RenderService                |
| `rumors.json`          | 3.7 KB | 辟谣信息（暂未接入渲染）              | 预留                         |
| `contacts.json`        | 1.3 KB | 联系方式                              | InteractionService           |
| `manifest.json`        | 1.7 KB | 发布清单（版本/生成时间/文件 sha256） | 发布门禁, `/api/version`     |

> 纳入发布包的文件清单取自 `js/config.js` 的 `dataPaths`，前端与发布脚本读同一份配置，
> 因此不存在"新增了数据文件但忘记打包"的情况。

**关键数据结构详见** [CONTRIBUTING.md](CONTRIBUTING.md) 第四章。

---

## 八、地图与坐标说明

GeoJSON 与 Leaflet 的坐标顺序不同，**容易混淆**：

| 场景                       | 坐标顺序                  | 示例                                      |
| -------------------------- | ------------------------- | ----------------------------------------- |
| GeoJSON `coordinates`      | `[经度, 纬度]` (lng, lat) | `[117.13, 36.20]`                         |
| Leaflet `setView` / marker | `[纬度, 经度]` (lat, lng) | `[36.20, 117.13]`                         |
| `turf.point()`             | `[经度, 纬度]` (lng, lat) | `turf.point([117.13, 36.20])`             |
| Leaflet `e.latlng`         | `{ lat, lng }`            | 传给 Turf: `[e.latlng.lng, e.latlng.lat]` |

**Polygon 必须首尾点相同**才算闭合，否则 Turf 几何判断会异常。

地图底图使用**天地图**（国家地理信息公共服务平台）。默认中心 `[36.1947, 117.1297]`（山东省泰安市泰山区附近），缩放级别 `14`。

### 天地图 Key 的分工（重要）

项目使用**两枚互相独立**的天地图 Key，不可混用：

| 用途         | 存放位置                                    | 类型         | 是否对浏览器可见 |
| ------------ | ------------------------------------------- | ------------ | ---------------- |
| 地图瓦片加载 | `js/config.js` 的 `tianditu.token`          | 浏览器端 Key | 是（必然可见）   |
| 地址搜索代理 | 后端环境变量 `TIANDITU_SEARCH_TK`（`.env`） | 服务端 Key   | 否               |

> ⚠️ 瓦片 Key 写在 `js/config.js`，浏览器请求必定携带，**无法隐藏**。请务必在
> [天地图开发者控制台](https://console.tianditu.gov.cn/)为其绑定域名并设置配额；若已泄露应重新申请。
> 服务端 Key 只存在于 `.env`（已加入 `.gitignore`），不得写入源码或提交到仓库。
> 浏览器端 Key 调用搜索接口会被上游拒绝（错误码 `301012`），这正是两者必须分开的原因。

---

## 九、代码规范

### 开发规范

所有开发规范详见 [CONTRIBUTING.md](CONTRIBUTING.md)，关键要点：

- 所有源文件头部均包含 `⚠️ 修改前必读: CONTRIBUTING.md`
- 使用 ES Modules（`import`/`export default`）组织模块，禁止新增 `window.XxxService` 全局依赖
- 私有变量 `_underScorePrefix`，公共方法 `camelCase`
- XSS 防护：所有用户可见文本必须通过 `RenderService.safeText()` 转义
- 提交前运行 `npm run check` 确保无报错

### ESLint 规则

| 规则                    | 级别  | 说明                     |
| ----------------------- | ----- | ------------------------ |
| `no-var`                | error | 禁止 var，必须 const/let |
| `prefer-const`          | warn  | 优先使用 const           |
| `prefer-template`       | warn  | 优先模板字符串           |
| `prefer-arrow-callback` | warn  | 优先箭头函数             |
| `no-useless-concat`     | error | 禁止无意义拼接           |
| `arrow-spacing`         | error | 箭头函数前后加空格       |

### Git 提交规范

```
<type>: <简短描述>
```

| type       | 用途                   |
| ---------- | ---------------------- |
| `feat`     | 新功能                 |
| `fix`      | Bug 修复               |
| `docs`     | 文档/注释变更          |
| `refactor` | 代码重构               |
| `style`    | 格式调整（不影响逻辑） |
| `chore`    | 构建/配置变更          |

---

## 十、项目边界与声明

> 当前项目为阶段性原型。
>
> - 系统包含一个最小后端（只提供 health / version / 搜索代理三个接口），**不含**数据库、登录注册、真实在线咨询功能。
> - 后端不承载业务逻辑：学区点面判断、数据加载、政策匹配全部在前端完成。
> - 地图底图使用天地图在线瓦片服务。
> - 业务数据来自 `data/releases/` 下的本地示例 JSON / GeoJSON 发布包。
> - 学区边界依据公开数据绘制。
> - 示例数据仅用于展示技术路线，不代表真实招生政策。
> - 开发时用 `npm run dev` 启动前端（并单独启动后端），或 `npm run build && npm run preview` 构建并预览生产版本。

---

## 十一、后续扩展方向

1. **数据真实化** — 接入教育主管部门发布的真实学区边界与政策数据（当前仍有待补占位内容，见 `npm run check:release`）。
2. **后端能力扩展** — 在保持代理职责清晰的前提下，逐步把数据下发与统计改为接口形式。
3. **录取建议模拟** — 基于历年录取分数与积分规则，实现择校参考建议。
4. **在线地理编码** — 已通过后端 `/api/search` 代理天地图搜索实现，可进一步扩展为完整地理编码服务（含逆地理编码）。
5. **多区域可迁移** — 通过更换 GeoJSON 与政策 JSON，实现区域间快速迁移，前端零改动。
6. **学位预警** — 基于学位资源数量与适龄儿童数据，提供动态预警。
7. **可访问性优化** — 高对比度模式、无障碍标签（ARIA）、键盘导航。
8. **离线部署支持** — 将 CDN 依赖本地化到 `vendor/` 目录，支持内网/离线环境。
9. **辟谣模块** — 接入 `rumors.json`，提供谣言查证与辟谣信息展示。
10. **移动端优化** — 增强触摸交互（双指缩放、长按查询）、PWA 离线缓存。

---

## 十二、常见问题

### Q1: 页面提示"加载失败"？

请确认通过 `npm run dev`（开发）或 `npm run preview`（生产预览）访问，而不是直接双击 `index.html`。若数据文件缺失或路径变更，也会导致加载失败，可查看 Network 面板确认。

### Q2: CDN 加载失败？

unpkg / jsdelivr 在某些网络环境下不稳定。可将 Leaflet、Turf、Bootstrap 下载到本地 `vendor/` 目录，并修改 `index.html` 中的 `<link>` 与 `<script>` 路径指向本地文件；或换用国内 CDN 镜像。

### Q3: 地图区域空白、不显示？

打开浏览器控制台检查报错。常见原因：

1. 网络无法访问天地图瓦片服务 → 检查 Token 是否有效，或换用其他可访问的瓦片源；
2. CDN 加载失败 → 同 Q2；
3. `mapContainer` 高度为 0 → 检查 CSS 是否被覆盖。

### Q4: 点击地图后没反应？

1. 打开控制台检查报错，确认各模块初始化成功（main.js 中 safeInit 会隔离并打印失败模块）；
2. 检查 `data/current.json` 指向的版本目录下是否存在 `zones.geojson`（Network 面板）、格式是否合法（可在 https://geojson.io 校验）；
3. 检查 Polygon 是否闭合（首尾点相同）。

### Q5: 搜索无结果？

搜索优先使用本地地址点和关键词索引匹配。需要联网的两种情形：本地完全无命中，或命中的地址点坐标缺失。
联网查询经后端 `/api/search` 代理天地图，**搜索范围（泰山区 / 岱岳区 / 泰山景区）在后端过滤**，
不在范围内的候选结果不会返回，因此不会再出现"查询结果不在……范围内"这类提示。

> 提示文案"未找到匹配结果，请尝试更完整的地址"表示上游确实没有可用的候选点，
> 常见于学校 POI 未被天地图收录（例如部分新建学校）。可换用地标、道路名或完整门牌地址重试。

### Q5.1: 搜索提示"联网查询失败"？

几乎都是后端没起来。按第四章启动后端（默认 `127.0.0.1:8010`），并确认：

1. `.env` 中的 `TIANDITU_SEARCH_TK` 已填写**服务端** Key（浏览器端 Key 会被上游以 `301012` 拒绝）；
2. 后端端口与 `vite.config.js` 的 `API_TARGET` 一致；
3. 浏览器 Network 面板中 `/api/search` 的请求域名是前端同源域名，而非 `127.0.0.1:8010`（说明代理生效）。

地图、学区查询、政策与自查等功能不依赖后端，后端未启动时仍可正常使用。

### Q6: FAQ 搜索无结果？

搜索使用大小写不敏感 `includes` 匹配 question / answer / keywords。如果无交集，会显示"暂无匹配的常见问题"——属正常行为。

### Q7: 政策筛选后无结果？

当前选中的"分类 + 年份"组合下确实没有匹配政策，会显示"暂无政策数据"——属正常行为。

### Q8: JSON 格式错误？

JSON 不能写注释、不能有尾随逗号、字符串必须用双引号。可用 https://jsonlint.com 校验。

---

**项目维护者**：智慧入学·学区治理课题组
**版本**：阶段性原型 v1.0
