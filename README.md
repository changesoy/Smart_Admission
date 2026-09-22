# 智慧入学·学区治理一站式可视化门户

> 阶段性原型 · 前端可视化 + Backend Lite 搜索代理

面向义务教育入学场景的"一站式查询"门户，把**学区划分、招生政策、入学条件自查与常见问题**整合进一个页面。
前端是 Vanilla JS + Leaflet 的纯静态站点，另有一个只做搜索代理的 Backend Lite；无数据库、无登录注册。

---

## 一、文档导航

本 README 只做**项目门面**（是什么、有什么、怎么跑）。细则按职责拆分：

| 文档                                                 | 内容                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| [CONTRIBUTING.md](CONTRIBUTING.md)                   | **改任何源文件前必读**：模块/数据/样式/Git 规范、密钥边界            |
| [docs/architecture.md](docs/architecture.md)         | 模块架构、初始化顺序、数据文件与数据流、坐标约定                     |
| [docs/development.md](docs/development.md)           | 本地运行、构建部署、命令速查、排错 FAQ                               |
| [docs/roadmap.md](docs/roadmap.md)                   | 后续扩展方向                                                         |
| [docs/zone-school-list.md](docs/zone-school-list.md) | 学区-学校对应表                                                      |
| [docs/data-schema.md](docs/data-schema.md)           | 数据 Schema 草案（v1.0，部分已过时；权威以 CONTRIBUTING 第四章为准） |

> 规范类内容只在 CONTRIBUTING.md 维护一份，其余文档一律链接引用，不复制。

---

## 二、核心功能

- **数据概览** — 学区 / 学校 / 政策 / FAQ 统计卡片
- **搜索查询** — 学校、小区、道路或地址关键词；本地索引优先，无命中时经后端 `/api/search` 代理联网查询
- **学区地图与查询** — Leaflet + 天地图，初中蓝 / 小学绿；点击地图或搜索地址，用 Turf 做点面判断，同一坐标可同时返回小学 + 初中归属
- **查询结果面板** — 按学段分组展示学区名 / 招生范围 / 对应学校（地址、电话、官网）/ 关联政策 / 历年调整时间线
- **招生政策与年度对比** — 分类 + 年份双向筛选；相邻年份差异对比
- **入学条件自查** — 按学段 / 户籍 / 住房情形匹配规则，输出情形分类、需核验条件、建议材料与政策依据（**不做录取概率预测**）
- **常见问题** — 关键词搜索 + 分类筛选 + 展开收起 + 关联跳转
- **留言建议** — 表单持久化到 localStorage
- **学段筛选** — 只控制地图上学区的显隐，不影响查询结果

---

## 三、技术栈

| 类别     | 技术                                           | 版本                         |
| -------- | ---------------------------------------------- | ---------------------------- |
| 基础     | HTML5 / CSS3 / Vanilla JavaScript (ES Modules) | —                            |
| 构建工具 | Vite (dev / build / preview)                   | 8.x                          |
| UI 框架  | Bootstrap 5 + Bootstrap Icons                  | 5.3.2 / 1.11.3               |
| 地图     | Leaflet + 天地图在线瓦片 (WMTS)                | 1.9.4                        |
| 空间计算 | Turf.js (`booleanPointInPolygon`)              | 6.5.0                        |
| 数据     | 本地 JSON / GeoJSON（按版本目录组织）          | —                            |
| 后端     | FastAPI + uvicorn + httpx                      | 见 `server/requirements.txt` |
| 代码规范 | ESLint 扁平配置                                | 9.x                          |

**不使用** Vue / React / Angular / TypeScript / 商业地图 API / Node 后端（后端为 Python，只做代理）。

---

## 四、快速开始

前置要求：Node.js 18+；Python 3.10+（仅联网搜索需要）。

```bash
npm install
npm run dev:all   # 后端 + 前端一键启动（Windows）
npm run dev       # 只跑前端，/api 自动代理到 8010
```

未启动后端时，地图、学区查询、政策、自查等本地功能不受影响，仅"本地无匹配时的联网搜索"不可用。

> ⚠️ 不要直接双击 `index.html`：`file://` 协议下 ES Module 与 `fetch()` 会被浏览器拦截。

环境变量配置、后端单独启动、生产构建与完整命令表见 [docs/development.md](docs/development.md)。

---

## 五、目录结构

```
smart-admission/
├── index.html / vite.config.js / eslint.config.js / package.json
├── js/            # ES Modules 前端源码（config / dataService / render / mapService /
│                  #   searchService / policyService / simulatorService / faqService /
│                  #   interactionService），入口为 main.js
├── css/style.css  # 全局样式（含所有模块）
├── data/          # current.json 版本指针 + releases/<版本>/ 不可变快照 + 工作副本
├── server/        # Backend Lite（FastAPI：health / version / search 三组路由）
├── scripts/       # 数据校验、发布脚本与 dev.ps1 一键启动
└── docs/          # architecture / development / roadmap 等文档
```

各模块职责见 [docs/architecture.md](docs/architecture.md)，文件级说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 六、项目边界

> 当前项目为阶段性原型。

- 后端只提供 health / version / 搜索代理三个接口，**不含**数据库、登录注册、真实在线咨询。
- 业务逻辑全在前端：学区点面判断、数据加载、政策匹配均在浏览器内完成。
- 地图底图使用天地图在线瓦片服务；学区边界依据公开数据绘制。
- 业务数据来自 `data/releases/` 下的本地示例 JSON / GeoJSON，**不代表真实招生政策**。

---

**项目维护者**：智慧入学·学区治理课题组 · **版本**：阶段性原型 v1.0
