# 智慧入学·学区治理一站式可视化门户

> 阶段性本地前端原型 · 基于学区边界、招生政策与入学材料的本地可视化查询

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

本项目是面向义务教育入学场景的"一站式查询"前端原型，整合学区划分、招生政策、入学材料与常见问题，提供轻量化的可视化政务服务体验。当前版本为**阶段性本地原型**：仅含前端代码与示例数据，无后端、无数据库、无登录注册。

**核心目标：**

- 让家长在一个页面内完成"学区查询 → 政策了解 → 材料准备 → 疑问解答"的闭环；
- 通过"前端 GIS + 本地 JSON / GeoJSON"的轻量架构，验证可迁移、低成本的政务网站技术路线；
- 为后续接入真实政务数据、完善业务功能奠定结构基础。

---

## 二、技术栈

| 类别     | 技术                                     | 版本           |
| -------- | ---------------------------------------- | -------------- |
| 基础     | HTML5 / CSS3 / Vanilla JavaScript (ES6+) | —              |
| UI 框架  | Bootstrap 5 + Bootstrap Icons            | 5.3.2 / 1.11.3 |
| 地图     | Leaflet + 天地图在线瓦片 (WMTS)          | 1.9.4          |
| 空间计算 | Turf.js (`booleanPointInPolygon`)        | 6.5.0          |
| 数据     | 本地 JSON / GeoJSON 文件                 | —              |
| 代码规范 | ESLint 扁平配置 (ES6+ 语法检查)          | 9.x            |
| 运行     | Python 内置 HTTP Server 或同类静态服务器 | —              |

**本项目不使用** Vue / React / Angular / Node 后端 / Vite / TypeScript / 商业地图 API。

---

## 三、目录结构

```
smart-admission/
├── index.html                  # 主页面（脚本加载顺序不可变）
├── README.md                   # 项目说明
├── CONTRIBUTING.md             # 贡献指南（修改前必读）
├── package.json                # npm 配置（ESLint 脚本）
├── eslint.config.js            # ESLint 9.x 扁平配置
├── .gitignore                  # Git 忽略规则
├── css/
│   └── style.css               # 全局样式（1586 行，含所有模块样式）
├── js/
│   ├── config.js               # 全局配置（地图/数据路径/学区样式/提示文案）
│   ├── dataService.js          # 数据加载服务（fetch + async/await 并行加载）
│   ├── render.js               # 渲染服务（统计卡片/结果面板/错误状态/网站说明）
│   ├── mapService.js           # 地图服务（Leaflet 渲染 + Turf 点面判断）
│   ├── searchService.js        # 搜索服务（地址点 + 关键词模糊匹配）
│   ├── policyService.js        # 政策渲染与年度对比服务
│   ├── materialService.js      # 入学材料清单（分组标签 + 勾选进度）
│   ├── faqService.js           # 常见问题（搜索 + 分类筛选 + 展开/收起）
│   ├── interactionService.js   # 政民互动（联系卡片 + 留言表单 + 本地存储）
│   └── main.js                 # 主入口（协调初始化顺序 + 错误处理）
├── data/
│   ├── zones.geojson           # 学区边界多边形 (85KB)
│   ├── schools.json            # 学校信息 (25KB)
│   ├── zones_history.json      # 学区历年调整记录
│   ├── address_points.json     # 地址点索引 (20KB)
│   ├── keywords_index.json     # 关键词索引
│   ├── policies.json           # 招生政策 (21KB)
│   ├── policy_diff.json        # 政策年度对比数据 (17KB)
│   ├── materials.json          # 入学材料分组 (14KB)
│   ├── faq.json                # 常见问题
│   ├── contacts.json           # 联系方式
│   └── rumors.json             # 辟谣信息（暂未接入）
└── docs/                       # 文档与数据说明
    ├── data-schema.md          # 数据结构文档
    ├── zone-school-list.md     # 学区-学校对应表
    ├── address_points.json     # 地址点数据备份
    ├── keywords_index.json     # 关键词数据备份
    └── zones_history.json      # 历史数据备份
```

---

## 四、本地运行方式

> ⚠️ **不要直接双击 `index.html` 运行。** 浏览器对 `file://` 协议下的 `fetch()` 有跨域限制，会导致数据加载失败。

### 前置要求

- Python 3.x（推荐）或 Node.js
- 现代浏览器（Chrome / Edge / Firefox 最新版）

### 启动步骤

```bash
# 1. 进入项目目录
cd smart-admission

# 2. （可选）安装 ESLint 开发依赖
npm install

# 3. 启动本地 HTTP 服务（任选一种）
python -m http.server 5500
# 或: npx serve -l 5500
# 或: VSCode "Live Server" 插件

# 4. 浏览器访问
http://localhost:5500
```

页面打开后会自动并行加载 `data/` 下的 10 个 JSON / GeoJSON 文件，完成后初始化地图。

### 代码检查

```bash
npm run lint        # ESLint 语法检查
npm run lint:fix    # 自动修复可修复问题
```

---

## 五、功能说明

| 模块             | 功能描述                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- |
| **数据概览**     | 顶部 4 张统计卡片，实时展示学区、学校、政策、FAQ 数量                                         |
| **搜索查询**     | 输入学校、小区、道路或地址关键词，本地匹配地址点与关键词索引，选中后自动定位地图              |
| **学区等级筛选** | 初中/小学复选框，控制地图上不同学段学区的显示与隐藏                                           |
| **学区地图**     | Leaflet + 天地图底图，渲染学区 Polygon（初中蓝色/小学绿色），悬停高亮、点击选中，自动适配视野 |
| **学区查询**     | 点击地图任意位置，使用 Turf 判断点位所属学区，命中即显示详情                                  |
| **查询结果面板** | 学区名 / 招生范围 / 对应学校（地址/电话/区县/类型/官网）/ 关联政策 / 历年调整记录时间线       |
| **招生政策**     | 政策卡片列表，支持按"分类"和"年份"双向筛选，默认显示 6 条可展开                               |
| **政策年度对比** | 选择相邻年份，对比政策变化项与未变化项，含变化说明                                            |
| **入学材料**     | 按学生类型分组的材料清单，支持勾选、进度追踪，全部勾选时显示完成动画                          |
| **常见问题**     | 关键词搜索 + 分类标签筛选，问题可展开/收起，支持关联问题跳转                                  |
| **留言建议**     | 在线留言表单（含字数统计和分类选择），留言持久化到 localStorage，支持 Toast 提示              |
| **网站说明**     | 明示平台范围与数据来源，避免误解                                                              |

---

## 六、模块架构

```
index.html ─────────────────────────── 主页面（脚本加载顺序不可变）
  │
  ├── config.js ────────────────────── 全局配置（所有模块的单一数据源）
  │
  ├── dataService.js ──────────────── 数据加载（fetch + async/await 并行加载）
  │
  ├── render.js ──────────────────── DOM 渲染（统计卡片/结果面板/错误状态）
  │
  ├── policyService.js ───────────── 政策渲染与年度对比
  │
  ├── mapService.js ──────────────── 地图服务（Leaflet + Turf 点面判断）
  │
  ├── materialService.js ─────────── 入学材料清单（勾选/进度）
  │
  ├── faqService.js ──────────────── 常见问题（搜索/分类/展开）
  │
  ├── interactionService.js ──────── 政民互动（留言/联系卡片）
  │
  ├── searchService.js ───────────── 搜索服务（地址点 + 关键词匹配）
  │
  └── main.js ────────────────────── 主入口（协调初始化顺序，错误处理）
```

**模块间依赖关系：**

```
config.js ← dataService.js ← main.js → render.js
                                   ├→ policyService.js
                                   ├→ materialService.js
                                   ├→ faqService.js
                                   ├→ interactionService.js
                                   ├→ mapService.js ←→ searchService.js
                                   └→ searchService.js
```

**初始化顺序（8 步，不可调换）：**

1. `DataService.loadAllData()` — 并行加载全部数据文件
2. `RenderService.renderStats()` — 渲染统计卡片
3. `RenderService.renderDefaultResultTip()` — 渲染引导提示
4. `PolicyService.init()` — 初始化政策模块
5. `MaterialService.init()` — 初始化材料模块
6. `FaqService.init()` — 初始化 FAQ 模块
7. `InteractionService.init()` — 初始化互动模块
8. `MapService.initMap()` + `SearchService.init()` — 初始化地图和搜索（含回调绑定）

---

## 七、数据文件说明

所有业务数据来自本地 `data/` 目录，便于编辑与迁移：

| 数据文件              | 大小  | 用途                                 | 消费模块                     |
| --------------------- | ----- | ------------------------------------ | ---------------------------- |
| `zones.geojson`       | 85 KB | 学区边界 Polygon (FeatureCollection) | MapService, RenderService    |
| `schools.json`        | 25 KB | 学校信息（34 所示例）                | RenderService                |
| `policies.json`       | 21 KB | 招生政策列表                         | PolicyService, RenderService |
| `address_points.json` | 20 KB | 本地地址点索引                       | SearchService                |
| `policy_diff.json`    | 17 KB | 政策年度对比数据                     | PolicyService                |
| `materials.json`      | 14 KB | 入学材料分组（4 类）                 | MaterialService              |
| `faq.json`            | 9 KB  | 常见问题（含分类/优先级/关联）       | FaqService                   |
| `keywords_index.json` | 7 KB  | 关键词索引（含关联 zoneId）          | SearchService                |
| `zones_history.json`  | 5 KB  | 学区历年调整记录                     | RenderService                |
| `contacts.json`       | 1 KB  | 联系方式                             | InteractionService           |
| `rumors.json`         | 4 KB  | 辟谣信息（暂未接入渲染）             | 预留                         |

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

地图底图使用**天地图**（国家地理信息公共服务平台），Token 配置在 `js/config.js` 中。默认中心 `[36.1947, 117.1297]`（山东省泰安市泰山区附近），缩放级别 `14`。

---

## 九、代码规范

### 开发规范

所有开发规范详见 [CONTRIBUTING.md](CONTRIBUTING.md)，关键要点：

- 所有源文件头部均包含 `⚠️ 修改前必读: CONTRIBUTING.md`
- 使用 IIFE + `window.XxxService` 模块模式
- 私有变量 `_underScorePrefix`，公共方法 `camelCase`
- XSS 防护：所有用户可见文本必须通过 `RenderService.safeText()` 转义
- 提交前运行 `npm run lint` 确保无报错

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

> 当前项目为阶段性本地前端原型。
>
> - 系统暂时不包含后端、数据库、登录注册、真实在线咨询功能。
> - 地图底图使用天地图在线瓦片服务。
> - 业务数据来自本地示例 JSON / GeoJSON 文件。
> - 学区边界依据公开数据绘制。
> - 示例数据仅用于展示技术路线，不代表真实招生政策。
> - ⚠️ 不要直接双击 index.html 运行，须通过 HTTP 服务访问。
>
> 请在项目目录下执行 `python -m http.server 5500`，然后访问 `http://localhost:5500`。

---

## 十一、后续扩展方向

1. **数据真实化** — 接入教育主管部门发布的真实学区边界与政策数据。
2. **后端接入** — 替换本地 JSON 为 RESTful 接口，支持动态更新。
3. **录取建议模拟** — 基于历年录取分数与积分规则，实现择校参考建议。
4. **在线地理编码** — 将搜索服务从本地地址点匹配升级为在线地理编码服务（如高德/百度 API）。
5. **多区域可迁移** — 通过更换 GeoJSON 与政策 JSON，实现区域间快速迁移，前端零改动。
6. **学位预警** — 基于学位资源数量与适龄儿童数据，提供动态预警。
7. **可访问性优化** — 高对比度模式、无障碍标签（ARIA）、键盘导航。
8. **离线部署支持** — 将 CDN 依赖本地化到 `vendor/` 目录，支持内网/离线环境。
9. **辟谣模块** — 接入 `rumors.json`，提供谣言查证与辟谣信息展示。
10. **移动端优化** — 增强触摸交互（双指缩放、长按查询）、PWA 离线缓存。

---

## 十二、常见问题

### Q1: 页面提示"加载失败"？

极有可能是直接双击了 `index.html`，导致 `fetch()` 无法读取本地 JSON。请按"四、本地运行方式"启动 HTTP 服务后访问 `http://localhost:5500`。

### Q2: CDN 加载失败？

unpkg / jsdelivr 在某些网络环境下不稳定。可将 Leaflet、Turf、Bootstrap 下载到本地 `vendor/` 目录，并修改 `index.html` 中的 `<link>` 与 `<script>` 路径指向本地文件；或换用国内 CDN 镜像。

### Q3: 地图区域空白、不显示？

打开浏览器控制台检查报错。常见原因：

1. 网络无法访问天地图瓦片服务 → 检查 Token 是否有效，或换用其他可访问的瓦片源；
2. CDN 加载失败 → 同 Q2；
3. `mapContainer` 高度为 0 → 检查 CSS 是否被覆盖。

### Q4: 点击地图后没反应？

1. 检查 JS 文件加载顺序（参见"六、模块架构"）；
2. 检查 `data/zones.geojson` 是否加载成功（Network 面板）、格式是否合法（可在 https://geojson.io 校验）；
3. 检查 Polygon 是否闭合（首尾点相同）。

### Q5: 搜索无结果？

搜索使用本地地址点和关键词索引进行匹配。如果输入的关键词与索引无交集，会显示"未找到匹配结果"——属正常行为。后续可接入在线地理编码服务扩大搜索范围。

### Q6: FAQ 搜索无结果？

搜索使用大小写不敏感 `includes` 匹配 question / answer / keywords。如果无交集，会显示"暂无匹配的常见问题"——属正常行为。

### Q7: 政策筛选后无结果？

当前选中的"分类 + 年份"组合下确实没有匹配政策，会显示"暂无政策数据"——属正常行为。

### Q8: JSON 格式错误？

JSON 不能写注释、不能有尾随逗号、字符串必须用双引号。可用 https://jsonlint.com 校验。

---

**项目维护者**：智慧入学·学区治理课题组
**版本**：阶段性原型 v1.0
