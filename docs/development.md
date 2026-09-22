# 开发与运行

> 本文覆盖**本地运行、构建部署、命令速查与排错**。
> 模块/数据/样式/密钥等规范以 [CONTRIBUTING.md](../CONTRIBUTING.md) 为准；系统结构见 [architecture.md](architecture.md)。

---

## 一、前置要求

- Node.js 18+（含 npm）—— 开发、构建、数据校验均依赖
- Python 3.10+ —— **仅联网搜索需要**，不涉及后端时可不装
- 现代浏览器（Chrome / Edge / Firefox 最新版）

> ⚠️ 不要直接双击 `index.html` 运行。浏览器对 `file://` 协议下的 ES Module 与 `fetch()` 有跨域限制，会导致页面无法加载。

---

## 二、首次准备

```bash
# 1. 前端依赖（Vite + ESLint）
npm install

# 2. 后端虚拟环境与依赖（仅联网搜索需要）
python -m venv .venv
.venv\Scripts\pip.exe install -r server/requirements.txt

# 3. 环境变量：复制模板后填入服务端 Key
copy .env.example .env
```

`.env` 关键项（模板见 [.env.example](../.env.example)）：

| 变量                       | 说明                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `TIANDITU_SEARCH_TK`       | 天地图**服务端**搜索 Key，与前端瓦片 Key 不同，留空则联网搜索返回 `TOKEN_MISSING` |
| `DATA_DIR`                 | 数据目录，开发为 `./data`，生产为 `/workspace/data`         |
| `APP_VERSION` / `BUILD_TIME` | 留空时分别回退到 `package.json` 版本 / 上报 `null`         |
| `SEARCH_TIMEOUT_SECONDS` 等 | 搜索代理超时、缓存 TTL、限流阈值                            |

`.env` 已加入 `.gitignore`，**不要提交**。生产环境建议直接注入环境变量而非落地文件。

---

## 三、启动方式

### 方式 A：一键启动（Windows）

```bash
npm run dev:all
```

等价于执行 `scripts/dev.ps1`：

1. 检查 `.venv` / `.env` / 天地图服务端 Key，缺失时给出明确提示（不静默跳过）；
2. 在**独立窗口**启动后端 uvicorn（`--reload`，端口 8010）；
3. 在**当前窗口**启动 Vite（端口 5173）。

> Ctrl+C 只结束前端，独立窗口中的后端仍会继续运行，需手动关闭。

### 方式 B：只跑前端

```bash
npm run dev     # http://localhost:5173，/api 自动代理到 8010
```

未启动后端时，地图、学区查询、政策、自查等本地功能不受影响；只有"本地无匹配时的联网搜索"会提示查询失败，属预期行为。

### 方式 C：分别手动启动

```bash
# 终端 1：后端（端口需与 vite.config.js 的 API_TARGET 一致）
.venv\Scripts\python.exe -m uvicorn server.app:app --port 8010 --reload

# 终端 2：前端
npm run dev
```

页面打开后会自动读取 `data/current.json` 指针，并行加载该版本下的全部数据文件，完成后初始化地图。

---

## 四、生产构建与部署

```bash
npm run build      # 产物输出到 dist/（含 data/ 静态数据）
npm run preview    # 本地预览 dist/ 产物（同样把 /api 代理到 8010）
```

- `dist/` 已加入 `.gitignore`，不提交；正式部署时发布 `dist/` 内容。
- 由 Nginx 等反向代理把 `/api` 转发到后端进程——**前端不打包后端地址**。
- 生产环境的 `DATA_DIR` 指向实际数据目录（如 `/workspace/data`），并注入 `TIANDITU_SEARCH_TK`。

---

## 五、命令速查

| 命令                                          | 作用                                                         |
| --------------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                                 | 启动 Vite 开发服务器（热更新）                               |
| `npm run dev:all`                             | 一键启动后端 + 前端（Windows）                               |
| `npm run build`                               | 构建到 `dist/`（含 `data/` 复制）                            |
| `npm run preview`                             | 本地预览 `dist/` 构建产物                                    |
| `npm run lint` / `npm run lint:fix`           | ESLint 检查 / 自动修复                                       |
| `npm run validate:data`                       | 开发期数据校验（`data/` 工作副本，允许占位数据）             |
| `npm run check`                               | `lint` + `validate:data`，**提交前必跑**                     |
| `npm run check:release`                       | 发布门禁（严格模式，当前预期失败，见下）                     |
| `npm run test:server`                         | 运行后端测试                                                 |
| `node scripts/new-data-release.mjs <版本号>`  | 生成不可变数据发布包（不自动改指针）                         |

### 数据版本与发布门禁

数据版本流程（工作副本 → 生成快照 → 切换指针 → 回滚）与 `check:release` 的完整拒发项清单见
[CONTRIBUTING.md 第 4.5 / 4.6 节](../CONTRIBUTING.md)，此处不重复。

> ⚠️ **当前 `check:release` 预期失败，这不是脚本故障。** 现存数据含 `【待补：官方网页链接】`
> 等占位内容，门禁建立后必然会命中。转绿依赖数据清理批次。

---

## 六、排错 FAQ

### Q1: 页面提示"加载失败"？

确认是通过 `npm run dev`（开发）或 `npm run preview`（生产预览）访问，而不是直接双击 `index.html`。
若数据文件缺失或路径变更也会导致加载失败，可查看 Network 面板确认，并核对 `data/current.json`
指向的版本目录是否存在。

### Q2: 地图区域空白、不显示？

打开浏览器控制台检查报错，常见原因：

1. 网络无法访问天地图瓦片服务 → 检查瓦片 Key 是否有效，或换用其他可访问的瓦片源；
2. CDN 加载失败 → 见 Q3；
3. `mapContainer` 高度为 0 → 检查 CSS 是否被覆盖。

### Q3: CDN 加载失败？

unpkg / jsdelivr 在某些网络环境下不稳定。可将 Leaflet、Turf、Bootstrap 下载到本地 `vendor/` 目录，
并修改 `index.html` 中的 `<link>` 与 `<script>` 路径指向本地文件；或换用国内 CDN 镜像。

### Q4: 点击地图后没反应？

1. 打开控制台，确认各模块初始化成功（`main.js` 中 `safeInit` 会隔离并打印失败模块）；
2. 检查 `data/current.json` 指向的版本目录下是否存在 `zones.geojson`（Network 面板），格式是否合法（可在 https://geojson.io 校验）；
3. 检查 Polygon 是否闭合（首尾点相同）。

### Q5: 搜索无结果？

搜索优先使用本地地址点和关键词索引匹配。需要联网的两种情形：本地完全无命中，或命中的地址点坐标缺失。

联网查询经后端 `/api/search` 代理天地图，**搜索范围（泰山区 / 岱岳区 / 泰山景区）在后端过滤**，
不在范围内的候选结果不会返回，因此不会出现"查询结果不在……范围内"这类提示。

> 提示"未找到匹配结果，请尝试更完整的地址"表示上游确实没有可用候选点，常见于学校 POI 未被天地图收录
> （例如部分新建学校）。可换用地标、道路名或完整门牌地址重试。

### Q5.1: 搜索提示"联网查询失败"？

几乎都是后端没起来。按第三章启动后端（默认 `127.0.0.1:8010`），并确认：

1. `.env` 中的 `TIANDITU_SEARCH_TK` 已填写**服务端** Key（浏览器端 Key 会被上游以 `301012` 拒绝）；
2. 后端端口与 `vite.config.js` 的 `API_TARGET` 一致；
3. 浏览器 Network 面板中 `/api/search` 的请求域名是前端同源域名，而非 `127.0.0.1:8010`（说明代理生效）。

地图、学区查询、政策与自查等功能不依赖后端，后端未启动时仍可正常使用。

### Q6: FAQ 搜索无结果？

搜索使用大小写不敏感 `includes` 匹配 question / answer / keywords。无交集时显示"暂无匹配的常见问题"，属正常行为。

### Q7: 政策筛选后无结果？

当前选中的"分类 + 年份"组合下确实没有匹配政策，会显示"暂无政策数据"，属正常行为。

### Q8: JSON 格式错误？

JSON 不能写注释、不能有尾随逗号、字符串必须用双引号。可用 https://jsonlint.com 校验。