# 贡献指南 (CONTRIBUTING)

> **⚠️ 修改任何源文件之前，必须先完整阅读本文档。**
>
> 本文档是多人协作的基线约定。违反规范可能导致合并冲突、运行时错误或功能回归。

---

## 一、项目架构概览

```
index.html ─────────────────────────── 主页面（仅引入第三方库 CDN 与唯一模块入口 main.js）
  │
  js/（ES Modules，依赖由 import 显式声明）
  │
  ├── config.js ────────────────────── 全局配置（所有模块的单一数据源）
  │
  ├── dataService.js ──────────────── 数据加载（fetch + async/await）
  │
  ├── render.js ──────────────────── DOM 渲染（统计卡片/结果面板/错误状态）
  │
  ├── policyService.js ───────────── 政策渲染与年度对比
  │
  ├── mapService.js ──────────────── 地图服务（Leaflet + Turf 点面判断 + 业务查询入口）
  │
  ├── searchService.js ───────────── 地址搜索（与地图点击共用统一查询入口）
  │
  ├── materialService.js ─────────── 入学材料清单（勾选/进度）
  │
  ├── faqService.js ──────────────── 常见问题（搜索/分类/展开）
  │
  ├── interactionService.js ──────── 政民互动（留言/联系卡片）
  │
  └── main.js ────────────────────── 主入口（协调初始化顺序）
```

---

## 二、模块依赖与加载方式（ES Modules）

项目已迁移为 **ES Modules**，依赖关系通过 `import`/`export` 显式声明，**不再依赖 `<script>` 标签顺序**，也**禁止**通过 `window.XxxService` 挂载或读取模块。

### 2.1 模块依赖图

```
config.js ← dataService.js
           ← render.js
           ← mapService.js
           ← searchService.js
           ← main.js

render.js  ← policyService.js
           ← materialService.js
           ← faqService.js
           ← interactionService.js
           ← searchService.js
           ← main.js

dataService.js ← main.js
```

### 2.2 index.html 中的脚本

`index.html` 仅包含两类 `<script>`，**不要**新增业务模块脚本标签：

| 标签                                       | 说明                                                    |
| ------------------------------------------ | ------------------------------------------------------- |
| Leaflet / Turf.js CDN                      | 第三方库，作为全局变量 `L` / `turf` 暴露给所有模块使用  |
| `<script type="module" src="/js/main.js">` | 唯一项目入口；其余模块由 `main.js` 通过 `import` 加载   |

### 2.3 禁止事项

- **禁止**在 `index.html` 中为业务模块单独添加 `<script>` 标签
- **禁止**使用 `window.XxxService = ...` 挂载模块；模块只通过 `export default` 暴露接口
- **禁止**靠脚本顺序解决依赖；任何依赖必须用 `import` 显式声明
- 新增模块时，只需在 `main.js` 顶部添加 `import` 并在 `bootstrapPage()` 中初始化

---

## 三、模块开发规范

### 3.1 模块结构模板

所有 JS 模块**必须**使用 ES Module，内部以 IIFE 封装私有作用域，`export default` 暴露公共接口：

```javascript
/**
 * xxxService.js - 模块简述
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: ...
 * 关键接口: ...
 * 数据格式: ...
 */
import OtherService from "./otherService.js";

const XxxService = (() => {
  // 私有变量以 _ 前缀命名
  let _data = [];

  /** 函数简述 */
  const method = () => { ... };

  /** 公共接口 */
  return { method };
})();

export default XxxService;
```

### 3.2 命名约定

| 类别     | 规则                        | 示例                           |
| -------- | --------------------------- | ------------------------------ |
| 模块导出 | `export default PascalCase` | `export default MapService`    |
| 文件名   | `camelCase.js`              | `mapService.js`                |
| 私有变量 | `_camelCase` 前缀下划线     | `_faqData`, `_currentCategory` |
| 公共方法 | `camelCase`                 | `filterByCategory()`           |
| DOM ID   | `kebab-case`                | `faq-list`, `material-tabs`    |
| CSS 类名 | `kebab-case`                | `faq-item`, `zone-primary`     |
| 数据字段 | `camelCase`                 | `zoneId`, `policyId`           |

### 3.3 公共接口约束

- 每个模块**只通过 `return` 暴露必要方法**，内部实现一律私有
- **禁止**直接访问其他模块的私有变量，必须通过其公共接口
- 新增公共方法时，须同步更新文件头注释的"关键接口"部分

### 3.4 新增模块检查清单

- [ ] 文件头包含 `⚠️ 修改前必读: CONTRIBUTING.md`
- [ ] 使用 ES Module（IIFE 封装 + `export default`），不挂载 `window`
- [ ] 依赖的其他模块全部通过顶部 `import` 显式声明
- [ ] 在 `main.js` 顶部添加 `import`，并在 `bootstrapPage()` 中用 `safeInit` 添加初始化调用
- [ ] 在 `dataService.js` 的 `loadAllData()` 中添加数据加载（如需要）
- [ ] 在 `config.js` 的 `dataPaths` 中添加路径配置（如需要）
- [ ] 运行 `npm run lint` 无报错
- [ ] 浏览器控制台无 JS 报错

---

## 四、数据文件规范

### 4.1 文件格式

- 所有数据文件位于 `data/` 目录，格式为 JSON 或 GeoJSON
- **JSON 严格规范**：无双引号注释、无尾随逗号、字符串必须双引号
- 修改后务必在 https://jsonlint.com 校验

### 4.2 数据文件与模块对应关系

| 数据文件              | 加载模块           | 格式                      |
| --------------------- | ------------------ | ------------------------- |
| `zones.geojson`       | MapService         | GeoJSON FeatureCollection |
| `schools.json`        | RenderService      | JSON Array                |
| `policies.json`       | PolicyService      | JSON Array                |
| `policy_diff.json`    | PolicyService      | JSON Array                |
| `materials.json`      | MaterialService    | JSON Array                |
| `faq.json`            | FaqService         | JSON Array                |
| `contacts.json`       | InteractionService | JSON Array                |
| `address_points.json` | SearchService      | JSON Array                |
| `keywords_index.json` | SearchService      | JSON Array                |
| `zones_history.json`  | RenderService      | JSON Array                |
| `rumors.json`         | 预留               | JSON Array                |

### 4.3 关键数据结构

**zones.geojson Feature properties：**

```json
{
  "zoneId": "m1",
  "zoneName": "泰安六中学区",
  "stage": "初中",
  "schoolId": "s01",
  "description": "招生范围说明",
  "year": 2025,
  "policyIds": ["p1", "p2"],
  "boundaryText": "...",
  "sourceName": "...",
  "sourceUrl": "...",
  "verifiedDate": "..."
}
```

**schools.json 条目：**

```json
{
  "schoolId": "s01",
  "name": "泰安市第六中学",
  "shortName": "泰安六中",
  "type": "公办",
  "schoolStage": "初中",
  "district": "泰山区",
  "address": "...",
  "phone": "...",
  "website": "...",
  "description": "..."
}
```

**policies.json 条目：**

```json
{
  "policyId": "p1",
  "title": "...",
  "year": 2025,
  "category": "招生政策",
  "source": "...",
  "publishDate": "2025-04-01",
  "summary": "...",
  "url": "#"
}
```

**policy_diff.json 条目：**

```json
{
  "yearA": 2024,
  "yearB": 2025,
  "diffPoints": [
    {
      "topic": "入学年龄",
      "valueA": "...",
      "valueB": "...",
      "isChange": true,
      "changeNote": "..."
    }
  ]
}
```

**materials.json 条目：**

```json
{
  "group": "本地户籍",
  "description": "...",
  "applicableStage": ["小学", "初中"],
  "items": [
    {
      "materialId": "mat01",
      "name": "户口簿",
      "required": true,
      "note": "...",
      "validity": "...",
      "templateUrl": "",
      "rejectReasons": ["..."]
    }
  ]
}
```

**faq.json 条目：**

```json
{
  "faqId": "faq01",
  "question": "...",
  "answer": "...",
  "category": "报名流程",
  "priority": 90,
  "keywords": ["..."],
  "relatedFaqIds": ["faq02"]
}
```

**contacts.json 条目：**

```json
{
  "type": "教育局",
  "name": "...",
  "phone": "...",
  "email": "...",
  "address": "...",
  "hours": "...",
  "note": "..."
}
```

**address_points.json 条目：**

```json
{
  "name": "...",
  "fullAddress": "...",
  "lng": 117.13,
  "lat": 36.2,
  "aliases": ["..."]
}
```

**keywords_index.json 条目：**

```json
{
  "keyword": "...",
  "aliases": ["..."],
  "matchedZoneIds": ["m1"],
  "type": "学校",
  "displayName": "..."
}
```

**zones_history.json 条目：**

```json
{
  "zoneId": "m1",
  "history": [
    {
      "year": 2024,
      "changeType": "范围调整",
      "change": "范围调整",
      "title": "...",
      "description": "...",
      "reason": "..."
    }
  ]
}
```

### 4.4 新增数据文件检查清单

- [ ] 在 `data/` 目录放置文件，格式符合 JSON 规范
- [ ] 在 `config.js` 的 `dataPaths` 中添加路径键值对
- [ ] 在 `dataService.js` 的 `loadAllData()` 解构中添加对应变量
- [ ] 在 `main.js` 的 `bootstrapPage()` 中将数据传递给目标模块
- [ ] 在 `docs/data-schema.md` 中补充数据结构说明

---

## 五、地图与坐标规范（极易出错）

**GeoJSON 与 Leaflet 坐标顺序不同，混淆会导致地图显示异常或点面判断失败：**

| 场景                       | 坐标顺序                  | 示例                                      |
| -------------------------- | ------------------------- | ----------------------------------------- |
| GeoJSON `coordinates`      | `[经度, 纬度]` (lng, lat) | `[117.13, 36.20]`                         |
| Leaflet `setView` / marker | `[纬度, 经度]` (lat, lng) | `[36.20, 117.13]`                         |
| `turf.point()`             | `[经度, 纬度]` (lng, lat) | `turf.point([117.13, 36.20])`             |
| Leaflet `e.latlng`         | `{ lat, lng }`            | 传给 Turf: `[e.latlng.lng, e.latlng.lat]` |

**Polygon 必须首尾点相同**才算闭合，否则 Turf 几何判断异常。

---

## 六、样式规范

### 6.1 CSS 变量（定义在 `:root`）

| 变量               | 值        | 用途           |
| ------------------ | --------- | -------------- |
| `--primary-color`  | `#1e3a5f` | 主色（深蓝）   |
| `--primary-dark`   | `#15294a` | 主色深色变体   |
| `--primary-hover`  | `#2a5080` | 主色悬停变体   |
| `--accent-color`   | `#f0a04b` | 强调色（琥珀） |
| `--bg-color`       | `#f5f7fa` | 页面背景       |
| `--card-bg`        | `#ffffff` | 卡片背景       |
| `--text-primary`   | `#2c3e50` | 主文本色       |
| `--text-secondary` | `#6c757d` | 次文本色       |
| `--border-light`   | `#e9ecef` | 边框色         |
| `--radius-card`    | `8px`     | 卡片圆角       |
| `--radius-btn`     | `6px`     | 按钮圆角       |

### 6.2 响应式断点

| 断点   | 宽度     | 场景              |
| ------ | -------- | ----------------- |
| 中屏   | `≤992px` | 平板横屏          |
| 小屏   | `≤768px` | 平板竖屏/小笔记本 |
| 超小屏 | `≤576px` | 手机              |

### 6.3 样式修改原则

- **禁止**使用 `!important`，除非覆盖第三方库样式
- 新增颜色**必须**使用 CSS 变量，禁止硬编码色值
- 新增组件样式**必须**放在对应模块注释区块内（如 `/* ========== FAQ ========== */`）
- 样式区块之间保持 `/* ========== 模块名 ========== */` 分隔注释

---

## 七、ESLint 配置

项目使用 ESLint 9.x 扁平配置（`eslint.config.js`），关键规则：

| 规则                     | 级别  | 说明                               |
| ------------------------ | ----- | ---------------------------------- |
| `no-var`                 | error | 禁止 `var`，必须使用 `const`/`let` |
| `prefer-const`           | warn  | 优先使用 `const`                   |
| `prefer-arrow-callback`  | warn  | 优先使用箭头函数                   |
| `prefer-template`        | warn  | 优先使用模板字符串                 |
| `prefer-destructuring`   | warn  | 优先使用解构赋值                   |
| `object-shorthand`       | warn  | 优先使用对象属性简写               |
| `template-curly-spacing` | error | 模板字符串花括号内不加空格         |
| `arrow-spacing`          | error | 箭头函数前后加空格                 |
| `no-useless-concat`      | error | 禁止无意义字符串拼接               |

**全局只读变量**：`L`（Leaflet）、`turf`（Turf.js）——由 CDN `<script>` 引入，模块内直接使用，**不要**再写 `/* global */` 注释或 `window.L`。

**模块格式**：`sourceType: "module"`，支持 `import`/`export` 语法。

**忽略目录**：`node_modules/`、`dist/`、`data/`、`docs/`

**运行命令：**

```bash
npm run lint        # 检查
npm run lint:fix    # 自动修复
```

---

## 八、Git 提交规范

### _严格禁止强制推送_

### 8.1 Commit Message 格式

\*type 取值：\*\*

| type       | 用途                           |
| ---------- | ------------------------------ |
| `feat`     | 新功能                         |
| `fix`      | 修复 Bug                       |
| `docs`     | 文档/注释变更                  |
| `style`    | 代码格式调整（不影响逻辑）     |
| `refactor` | 重构（不新增功能、不修复 Bug） |
| `perf`     | 性能优化                       |
| `test`     | 测试相关                       |
| `chore`    | 构建/工具/配置变更             |

### 8.2 分支约定

| 分支        | 用途         |
| ----------- | ------------ |
| `main`      | 稳定发布版本 |
| `feature/*` | 功能开发     |
| `fix/*`     | Bug 修复     |

### 8.3 提交前检查清单

- [ ] `npm run lint` 无报错
- [ ] `npm run check` 数据校验通过
- [ ] `npm run dev` 启动后页面功能正常（或 `npm run build` 构建成功）
- [ ] 浏览器控制台无 JS 报错
- [ ] **不要**提交 `node_modules/` 或 `dist/`（已在 `.gitignore` 中忽略）

---

## 九、常见冲突场景与避免方法

| 冲突场景                              | 避免方法                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------ |
| 多人同时修改同一模块                  | 每个模块尽量由一人负责；修改前先 `git pull`                              |
| 同时修改 `index.html`                 | 不新增业务 `<script>` 标签（模块由 `main.js` import 加载）               |
| 同时修改 `main.js` 的 import 区块     | 在已有 import 列表末尾追加新模块导入                                     |
| 同时修改 `config.js`                  | 只在对应对象末尾追加新配置项，不修改已有项                               |
| 同时修改 `main.js` 的 `bootstrapPage` | 在已有初始化调用之后追加新调用                                           |
| 同时修改 `style.css`                  | 在文件末尾对应模块区块追加样式，不修改已有样式                           |
| 同时修改数据文件                      | 不同数据文件互不影响，但同一文件需协商                                   |
| 同时修改 `dataService.js`             | 只在 `loadAllData()` 末尾追加新的 `loadFile` 调用和返回字段              |

---

## 十、本地开发环境

### 10.1 前置要求

- Node.js 18+（项目基于 Vite，开发/构建/数据校验均依赖 npm）
- 现代浏览器（Chrome / Edge / Firefox 最新版）

### 10.2 启动步骤

```bash
# 1. 克隆仓库
git clone <repo-url>
cd smart-admission

# 2. 安装开发依赖（Vite + ESLint）
npm install

# 3. 启动开发服务器
npm run dev

# 4. 浏览器访问（终端会输出实际端口）
http://localhost:5173
```

> ⚠️ **不要直接双击 `index.html` 运行。** 浏览器对 `file://` 协议下的 ES Module 和 `fetch()` 有跨域限制，会导致页面无法加载。

### 10.3 常用命令

```bash
npm run dev         # 启动 Vite 开发服务器（热更新）
npm run build       # 产物构建到 dist/（含 data/ 复制），dist/ 不提交
npm run preview     # 本地预览 dist/ 构建产物
npm run lint        # 检查所有 js/ 目录下的文件
npm run lint:fix    # 自动修复可修复的问题
npm run check       # 数据文件完整性校验（引用一致性等）
```
