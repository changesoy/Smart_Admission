# 智慧入学·学区治理一站式可视化门户

> 阶段性本地前端原型 · 基于学区边界、招生政策与入学材料的本地可视化查询

---

## 一、项目简介

本项目是面向义务教育入学场景的"一站式查询"前端原型,整合学区划分、招生政策、入学材料与常见问题,提供轻量化的可视化政务服务体验。当前版本为**阶段性本地原型**:仅含前端代码与示例数据,无后端、无数据库、无登录注册。

核心目标:

- 让家长在一个页面内完成"学区查询 → 政策了解 → 材料准备 → 疑问解答"的闭环;
- 通过"前端 GIS + 本地 JSON / GeoJSON"的轻量架构,验证可迁移、低成本的政务网站技术路线;
- 为后续接入真实政务数据、完善业务功能奠定结构基础。

---

## 二、技术栈

| 类别     | 技术                                            |
| -------- | ----------------------------------------------- |
| 基础     | HTML5 / CSS3 / Vanilla JavaScript               |
| UI 框架  | Bootstrap 5.3.2 + Bootstrap Icons 1.11.3        |
| 地图     | Leaflet 1.9.4 + 天地图在线瓦片                  |
| 空间计算 | Turf 6.5.0 (`turf.booleanPointInPolygon`)       |
| 数据     | 本地 JSON / GeoJSON 文件                        |
| 运行     | Python 内置 HTTP 服务(或任意静态服务器)         |

**本项目不使用** Vue / React / Angular / Node 后端 / npm / Vite / TypeScript / 商业地图 API。

---

## 三、目录结构

```
smart-admission-demo/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── config.js
│   ├── dataService.js
│   ├── render.js
│   ├── mapService.js
│   ├── searchService.js
│   ├── policyService.js
│   ├── materialService.js
│   ├── faqService.js
│   ├── interactionService.js
│   └── main.js
├── data/
│   ├── zones.geojson
│   ├── schools.json
│   ├── zones_history.json
│   ├── address_points.json
│   ├── keywords_index.json
│   ├── policies.json
│   ├── policy_diff.json
│   ├── materials.json
│   ├── faq.json
│   ├── contacts.json
│   └── rumors.json
└── README.md
```

---

## 四、本地运行方式

> ⚠️ **不要直接双击 `index.html` 运行。** 浏览器对 `file://` 协议下的 `fetch()` 有跨域限制,会导致数据加载失败。

正确步骤:

```bash
# 1. 进入项目目录
cd smart-admission-demo

# 2. 启动本地 HTTP 服务(任选一种)
python -m http.server 5500
# 或: python3 -m http.server 5500
# 或: npx serve -l 5500
# 或: VSCode "Live Server" 插件

# 3. 浏览器访问
http://localhost:5500
```

页面打开后会自动加载 `data/` 下的 JSON / GeoJSON 文件,并初始化地图。

---

## 五、功能说明

| 模块         | 描述                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| 数据概览     | 顶部 4 张卡片,展示学区、学校、政策、FAQ 数量                                   |
| 搜索查询     | 输入学校、小区、道路或地址关键词,本地匹配地址点与关键词索引,快速定位学区       |
| 学区等级筛选 | 初中/小学复选框,控制地图上不同学段学区的显示与隐藏                              |
| 学区地图     | Leaflet + 天地图底图,渲染 10 个学区 Polygon(初中蓝色/小学绿色),悬停高亮、点击选中 |
| 学区查询     | 点击地图任意位置,使用 Turf 判断点位所属学区,命中即显示详情                     |
| 查询结果面板 | 学区名 / 对应学校(地址/电话/区县/类型/官网) / 招生范围 / 学区年份 / 关联政策 / 历年调整记录时间线 |
| 招生政策     | 政策列表,支持按"分类"和"年份"双向筛选                                          |
| 政策年度对比 | 选择两个年份,对比政策变化点                                                     |
| 入学材料     | 4 类材料(本地户籍 / 随迁子女 / 集体户 / 人户分离),可勾选并显示进度             |
| FAQ          | 关键词搜索 + 分类筛选,对问题与答案做实时过滤                                    |
| 留言建议     | 在线留言表单 + 留言列表,支持分类选择                                            |
| 网站说明     | 明示平台范围与数据来源,避免误解                                                 |

---

## 六、数据文件说明

所有业务数据来自本地 `data/` 目录,便于编辑与迁移:

- **`zones.geojson`** — 10 个示例学区 Polygon,Feature 含 `zoneId`、`zoneName`、`stage`(初中/小学)、`schoolId`、`description`、`boundaryText`、`year`、`policyIds`、`sourceName`、`sourceUrl`、`verifiedDate` 等。
- **`schools.json`** — 34 所示例学校(小学 + 初中),含 `schoolId`、`name`、`shortName`、`type`、`schoolStage`、`district`、`address`、`phone`、`website`、`description`、`sourceName`、`sourceUrl`、`verifiedDate` 等。
- **`zones_history.json`** — 学区历年调整记录,按 `zoneId` 索引,每条含 `year`、`changeType`/`change`、`title`、`description`、`reason`。
- **`address_points.json`** — 本地地址点索引,含 `name`、`fullAddress`、`lng`、`lat`、`aliases`,供搜索服务匹配。
- **`keywords_index.json`** — 关键词索引,含 `keyword`、`aliases`、`matchedZoneIds`、`type`、`displayName`,供搜索服务匹配。
- **`policies.json`** — 示例政策,含 `policyId`、`title`、`year`、`category`、`source`、`publishDate`、`summary`、`url`。
- **`policy_diff.json`** — 政策年度对比数据,供政策对比模块使用。
- **`materials.json`** — 4 类入学材料分组,每类含多个材料项。
- **`faq.json`** — 常见问题,含分类标签。
- **`contacts.json`** — 联系方式数据。
- **`rumors.json`** — 辟谣信息数据。

> ⚠️ **示例性质声明**:上述数据均为示例数据,**不代表官方学区划分或真实招生政策**。学校名采用示例化命名;电话统一为占位格式;政策 `source` 字段统一标注"示例数据·非官方"。**实际入学政策以教育主管部门官方发布为准**。
>
> 部分边界依据文字描述进行简化示意绘制,仅用于原型展示。

---

## 七、地图与坐标说明(重要)

GeoJSON 与 Leaflet 的坐标顺序不同,**容易混淆**:

| 场景                       | 坐标顺序       | 示例                                     |
| -------------------------- | -------------- | ---------------------------------------- |
| GeoJSON `coordinates`      | `[经度, 纬度]` | `[117.13, 36.20]`                        |
| Leaflet `setView` / marker | `[纬度, 经度]` | `[36.20, 117.13]`                        |
| `turf.point()`             | `[经度, 纬度]` | `turf.point([117.13, 36.20])`            |
| Leaflet `e.latlng`         | `{ lat, lng }` | 传给 Turf:`[e.latlng.lng, e.latlng.lat]` |

**Polygon 必须首尾点相同**才算闭合,否则 Turf 几何判断会异常。

地图底图使用**天地图**(国家地理信息公共服务平台),需在 `js/config.js` 中配置有效 Token。地图中心默认 `[36.1947, 117.1297]` (山东泰安市泰山区附近),默认缩放级别 `14`。

---

## 八、项目边界说明

> 当前项目为阶段性本地前端原型。
>
> 系统不包含后端、数据库、登录注册、真实在线咨询功能。
>
> 地图底图使用天地图在线瓦片服务。
>
> 业务数据来自本地示例 JSON / GeoJSON 文件。
>
> 学区边界为示例或简化示意数据,不代表官方学区划分。
>
> 示例数据仅用于展示技术路线,不代表真实招生政策。
>
> ⚠️ 不要直接双击 index.html 运行。
>
> 请在项目目录下执行 `python -m http.server 5500`,然后访问 http://localhost:5500。

---

## 九、后续扩展方向

1. **数据真实化** — 接入教育主管部门发布的真实学区边界与政策数据。
2. **后端接入** — 替换本地 JSON 为 RESTful 接口,支持动态更新。
3. **录取建议模拟** — 基于历年录取分数与积分规则,实现择校参考建议。
4. **在线地理编码** — 将搜索服务从本地地址点匹配升级为在线地理编码服务。
5. **多区域可迁移** — 通过更换 GeoJSON 与政策 JSON,将系统从 A 市迁移到 B 市,前端零改动。
6. **学位预警** — 基于学位资源数量与适龄儿童数据,提供动态预警。
7. **可访问性优化** — 高对比度模式、无障碍标签、键盘导航。

---

## 十、常见问题

### Q1:页面提示"加载失败"?

极有可能是直接双击了 `index.html`,导致 `fetch()` 无法读取本地 JSON。请按"四、本地运行方式"启动 HTTP 服务后访问 `http://localhost:5500`。

### Q2:CDN 加载失败?

unpkg / jsdelivr 在某些网络环境下不稳定。可将 Leaflet、Turf、Bootstrap 下载到本地 `vendor/` 目录,并修改 `index.html` 中的 `<link>` 与 `<script>` 路径指向本地文件;或换用国内 CDN 镜像。

### Q3:地图区域空白、不显示?

打开浏览器控制台检查报错。常见原因:

1. 网络无法访问天地图瓦片服务 → 检查 Token 是否有效,或换用其他可访问的瓦片源;
2. CDN 加载失败 → 同 Q2;
3. `mapContainer` 高度为 0 → 检查 `css/style.css` 中 `#mapContainer` 是否被覆盖。

### Q4:点击地图后没反应?

1. 检查 `js/` 文件加载顺序(必须 config → dataService → render → policyService → mapService → materialService → faqService → interactionService → main);
2. 检查 `data/zones.geojson` 是否加载成功(Network 面板)、格式是否合法(可在 https://geojson.io 校验);
3. 检查 Polygon 是否闭合(首尾点相同)。

### Q5:搜索无结果?

搜索使用本地地址点和关键词索引进行匹配。如果输入的关键词与地址点名称、别名或关键词索引都无交集,会显示"未找到匹配结果"——属正常行为。后续可接入在线地理编码服务扩大搜索范围。

### Q6:FAQ 搜索无结果?

搜索使用大小写不敏感 `includes` 匹配。如果输入关键词与 question / answer 都无交集,会显示"未找到相关问题,请尝试其他关键词"——属正常行为。

### Q7:政策筛选后无结果?

当前选中的"分类 + 年份"组合下确实没有匹配政策,会显示"当前筛选条件下暂无政策"——属正常行为。

### Q8:JSON 格式错误?

JSON 不能写注释、不能有尾随逗号、字符串必须用双引号。可用 https://jsonlint.com 校验。

---

**项目维护者**:智慧入学·学区治理课题组
**版本**:阶段性原型 v0.2
