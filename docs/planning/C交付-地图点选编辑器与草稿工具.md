# C 交付：地图点选编辑器与草稿工具

本文档对应 `TEMP-C-待修复缺陷.txt` 的五个阶段，记录已交付的代码、命令、验证结果与真实数据阻塞。

## 1. 产物清单

| 文件 | 作用 |
| --- | --- |
| `scripts/lib/network-generator-core.mjs` | 纯核心：由 `boundary_features` + 连接裁定生成节点/边，含 ID 分配、退役双向记录、门禁 |
| `scripts/generate-network.mjs` | 生成器 CLI：默认 dry-run，`--write` 时三文件单事务写入 |
| `scripts/lib/draft-core.mjs` | 纯核心：边可用性、候选路径、共边复用、点选状态机、撤销重做、派生环与差异 |
| `scripts/lib/zone-draft-schema.mjs` | D01–D17 草稿校验（既有，未另抄规则） |
| `scripts/validate-zone-draft.mjs` | 只读草稿校验 CLI |
| `scripts/import-zone-draft.mjs` | 草稿导入 CLI：唯一获准回写正式 `zone_specs` 的路径 |
| `scripts/lib/zone-text.mjs` | 四至原文拆分（浏览器与 Node 共用，括号内不拆、方位继承） |
| `scripts/lib/zone-creation.mjs` | 新建学区校验、ID 分配与文本追加 |
| `scripts/create-zone.mjs` | 新建学区 CLI：默认 dry-run，`--write` 双文件事务写入 |
| `tools/boundary-editor/` | 独立 Leaflet 点选编辑器（`index.html` / `app.js` / `style.css` / `mock/`） |
| `scripts/tests/network-generator.test.mjs` | 生成器测试（13 项） |
| `scripts/tests/draft-core.test.mjs` | 草稿核心测试（12 项） |
| `scripts/tests/zone-draft-cli.test.mjs` | validate / import CLI 测试（4 项） |
| `scripts/tests/zone-creation.test.mjs` | 四至拆分与新建学区测试（9 项） |

未改动生产首页 `index.html`。C 交付当时未改动 `data/boundary_features.v2.geojson`、`data/zone_specs.v2.json`、`data/zones.geojson`；后续统一拓扑阶段已按需更新这些文件。

## 2. 五阶段状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 节点/边生成器 | 完成，fixture 深相等 + 二次运行字节一致 |
| 2 | Leaflet 点选编辑器 | 完成，mock 与真实数据均实测 |
| 3 | 候选路径 + 共边复用 | 完成，唯一解需确认、多解全列、无解报错 |
| 4 | validate / import CLI + 派生环差异 | 完成，含 4 项 CLI 测试 |
| 5 | 真实数据试用 | 完成。zone_006 产出唯一闭合候选草稿；zone_031 因“五马街”要素 disputed/不可用而显式阻塞（见第 5 节） |

## 3. 命令

```powershell
# 生成网络（先 dry-run 看报告，再 --write）
npm run generate:network -- --effective-date 2026-11-21 --report "$env:TEMP\gen.json"
npm run generate:network -- --effective-date 2026-11-21 --write

# 校验草稿（只读）
npm run validate:draft -- <draft.json> [--json]

# 导入草稿（默认 dry-run；--write 必须带 --confirm）
npm run import:draft -- <draft.json> --report <report.json>
npm run import:draft -- <draft.json> --write --confirm <draftId>

# 新建学区（默认 dry-run；--write 同时推进 id_registry）
npm run create:zone -- <payload.json> --report <report.json>
npm run create:zone -- <payload.json> --write

# 测试
npm run test:zones
```

编辑器：`npm run editor` 会启动 Vite 并直接打开 `/tools/boundary-editor/index.html`。顶栏可切换 `mock` 与 `真实 data/`。

底图复用 `js/config.js` 的浏览器端天地图 token（`vec_w` 矢量 + `cva_w` 中文注记），与主站一致，不再使用 OSM；中心点与缩放也取自 `AppConfig.mapCenter`。该 token 属浏览器端 Key，curl 等非浏览器请求会被天地图以 `301012 权限类型错误` 拒绝，属正常现象。

### 3.1 统一入口

`scripts/main.mjs` 把正式流水线与旧道路脚本收在同一个入口下，只做路由和参数转发，不改写参数、不吞退出码：

```powershell
node scripts/main.mjs --list                 # 列出全部子命令
npm run cli -- network:generate --help       # 子命令参数由被调用脚本决定

npm run cli -- network:generate --effective-date 2026-11-21           # 默认 dry-run
npm run cli -- network:generate --effective-date 2026-11-21 --write
npm run cli -- network:validate --strict
npm run cli -- draft:validate <draft.json> --json
npm run cli -- draft:import <draft.json> --write --confirm <draftId>

npm run cli -- ui                            # 数据工具台（编辑器 + 路网/边界可视化）
npm run cli -- ui:editor                     # 直接打开点选编辑器
npm run cli -- legacy:roads:audit            # 旧脚本，B14 前逐步退役
```

工具台页面 `tools/index.html` 同时收录 [boundary-editor](boundary-editor)、`reports/junction-cases.html`（路口诊断）、`reports/roads-compare.html`、`reports/boundary-compare.html`、`reports/boundary-probe.html`。`reports/` 下的页面由脚本生成，不是源码，未生成时打开会 404。

### 3.2 直接写入正式学区

编辑器顶栏「写入项目」不再要求手工下载 JSON：浏览器把草稿 POST 给开发服务器的 `/__tools/import-draft`，由 `vite.config.js` 的 `zone-draft-import` 插件转交 `scripts/import-zone-draft.mjs`，保持「导入 CLI 是唯一回写路径」的契约。

写入条件（缺一不可）：

- 数据源为「真实 data/」，mock 模式拒绝写入；
- 草稿状态为 `readyForReview`，且 D01–D17 零错误；
- 浏览器确认弹窗中确认 `draftId`；
- 主入口 `confirm` 与 `draftId` 完全一致，只允许 `POST`，请求体上限 8 MB。

插件只在 `vite` 开发服务器生效（`apply: "serve"`），`vite build` 产物与 `vite preview` 不含该接口。成功后修改 `data/zone_specs.v2.json`，页面需刷新才能看到最新绑定；`下载 JSON`、`复制 JSON` 仍保留作为备份手段。

IDE 一键入口：`.vscode/tasks.json` 里的「打开学区边界编辑器」已设为默认生成任务，`Ctrl+Shift+B` 直接启动；也可以在命令面板执行 `Tasks: Run Task` 选择。换端口时用 `npm run cli -- ui:editor --port 5180`。

只用**一个** `--`：npm 只吞掉第一个，再写一个会原样转发给子脚本并被判为未知参数。

正式流水线的子命令是 `network:generate`、`network:validate`、`network:export-refs`、`draft:validate`、`draft:import`、`zone:create`；旧脚本一律带 `legacy:` 前缀，运行时会向 stderr 打印退役提示，产物不作为正式数据。

### 3.3 学区选择与新建学区

顶栏学区选择器改为可搜索弹层：按学段分组、显示绑定状态徽标（未绑定 / 部分绑定 / 已绑定未闭合 / 已闭环），数据源是 `data/zone_specs.v2.json`，是否有坐标不影响能否选中。

「＋ 新建学区」对话框允许选择尚未建学区的学校，填写学区名称与四至原文，前端调用 `scripts/lib/zone-text.mjs` 实时拆分预览：

- 学校选项自带学段，单学段学校自动采用，不再显示独立的学段选择；仅九年一贯制学校保留学段选择。
- 拆分不足 3 步、学校/学段已存在学区、学区重名、原文片段不连续时禁止提交。
- 提交走 `POST /__tools/create-zone`，由 `vite.config.js` 的 `zone-create` 插件转交 `scripts/create-zone.mjs`，并要求确认文本与学区名完全一致；成功后写入 `data/zone_specs.v2.json` 与 `data/id_registry.json`（双文件事务）。
- CLI 等价入口：`npm run create:zone -- <payload.json>`，默认 dry-run，`--write` 落盘。

已知边界：只接受原文中按方位可拆分的连续片段。纯村居列举（如“邱家店镇刘家庄村、梨园村……”）拆不出闭合路径，会停留在“N 步（至少需要 3 步）”，需要先人工整理四至。

## 4. 真实数据生成结果（2026-11-21）

> 第 4–6 节保留 C 交付当时的结果。后续统一边界网络连接裁定阶段已补齐 `data/network_connection_decisions.json`，
> 当前数据为 336 个节点、464 条边；网络与 zone 绑定状态以 `npm run validate:network` 的当前输出为准。

- 输入：61 个要素；`data/network_connection_decisions.json` 不存在。
- 输出：138 个节点、69 条边，全部 `active`、`connectionType=connected`。
- 注册表：`networkNode` 与 `networkEdge` 计数器从 0 变为 138 / 69，登记项与计数器一致。
- 幂等：第二次 dry-run 复用 138 个节点、69 条边，新增 0，两个输出文件 SHA-256 与首次一致。
- `npm run validate:network`：0 个错误，14 个警告（均为“步骤尚未绑定 edgeRefs”）。

## 5. 试用结果（2026-11-21，连接裁定补齐后）

### 5.1 zone_006（含两个“排除”步骤）— 唯一闭合候选

候选草稿：[draft_zone_006_20261121_01.json](drafts/draft_zone_006_20261121_01.json)，状态 `readyForReview`，仅含 `edgeId` + `direction`，无任何坐标字段。

| 步骤 | 边数 | 要素 |
| --- | --- | --- |
| 排除 除东湖路以北 | 1 | 东湖路 `bf_000022` |
| 排除 温泉路以西区域 | 1 | 温泉路 `bf_000028` |
| 北 北至东岳大街 | 2 | 东岳大街 `bf_000013` |
| 东 东至双龙河（裁定采信唐王河 `br_000001`） | 3 | 唐王河 `bf_000012` |
| 南 南至灵山大街 | 4 | 灵山大街 `bf_000017` |
| 西 西至迎春路 | 2 | 迎春路 `bf_000030` |

校验与导入 dry-run（未写正式数据）：

```text
validate-zone-draft：0 个错误，0 个警告
import-zone-draft（dry-run）：
  closed=true, selfIntersections=[]
  派生环 103 个顶点，面积 1,178,441 m²
  旧环   39 个顶点，面积 1,184,819 m²
  面积差 -0.5%，质心偏移 4 m
  共边：be_0000159 已被 zone_032 西界使用（共边复用命中）
  警告：外环顺时针（与现有 zones.geojson 一致；契约建议逆时针，不阻断）
```

两个“排除”步骤按契约 §8 并入 outer 凹口（东湖路自迎春路向东至温泉路，温泉路自东湖路向北至东岳大街），未创建 `hole` 环。该草稿仅为候选，尚未执行 `--write`，最终由角色 B 确认。

### 5.2 zone_031 — 显式阻塞

| 步骤 | 要素 | 可用边 | 结论 |
| --- | --- | --- | --- |
| 东 东至芝田河 | `bf_000010` | 5 | 可用，紧贴现有环 |
| 西 西至双龙河（裁定采信唐王河 `br_000002`） | `bf_000012` | 9 | 可用 |
| 南 南至五马街 | `bf_000061` | **0** | **`verificationStatus=disputed`、`boundaryEligible=false`，7 条边全部不可用** |
| 北 北至谢过城街 | `bf_000003` | 6 | 可用 |

编辑器与校验会对五马街的边返回“所属要素不可作为学区边界”，无法形成闭环，因此没有 `readyForReview` 草稿。

另外，现有 `zones.geojson` 的 zone_031 环实际贴合 唐王河、谢过城街、北上高大街、擂鼓石大街、明堂路，与原文“东至芝田河、南至五马街”不一致；这属于四至解释与人工裁定范畴，需角色 B 处理，C 不得自行改正式几何。

### 5.3 当前数据状态

- `npm run validate:network`：61 个要素、198 条裁定、0 个错误、13 个警告（13 个学区仍有未绑定步骤；zone_032 已闭环）。
- `node --test "scripts/tests/*.test.mjs"`：128 通过 / 0 失败。

## 6. 当前阻塞与下一步

1. **五马街**：需 A 核实几何并把 `verificationStatus` 从 `disputed` 提升为可用，或由 B 给出替代道路裁定；否则 zone_031 永远无法绑定“南”步骤。
2. **zone_031 现有环与原文街名不一致**：需 B 裁定采用哪条道路，再决定是否更新绘制。
3. 上述任一解决后，用同一套命令即可产出草稿：

```powershell
npm run validate:draft -- <draft.json>
npm run import:draft -- <draft.json> --report <report.json>
npm run import:draft -- <draft.json> --write --confirm <draftId>
```

连接裁定文件格式（`DECISION_SCHEMA_VERSION = 1`，当前已存在 198 条裁定）供后续新增裁定参考：

```json
{
  "schemaVersion": 1,
  "decisions": [
    {
      "decisionId": "dec_000001",
      "connectionType": "connected",
      "placements": [
        { "featureId": "bf_000001", "partIndex": 0, "vertexIndex": 3 },
        { "featureId": "bf_000002", "partIndex": 0, "vertexIndex": 0 }
      ],
      "rulingIds": ["br_000001"]
    }
  ]
}
```

约束：

- `connected` 要求各 placement 在 7 位小数下完全共点；
- `conditional` 必须给 `rulingIds`；
- 同一 placement 不得被不同裁定重复占用；
- 裁定不写坐标，只引用要素的 part / vertex 下标。

## 7. Mock 闭合矩形演示

`mock` 模式下 zone_900 可完整闭合（4 个步骤、5 条边，全部 `forward`）：

| 步骤 | 边 |
| --- | --- |
| 南 | `be_0000001`、`be_0000002` |
| 东 | `be_0000003` |
| 北 | `be_0000004` |
| 西 | `be_0000005` |

zone_901 已绑定 `be_0000003` / `be_0000004`，用于演示“已用学区”着色与共边复用。

## 8. 安全边界

- 编辑器自身不直接写正式数据；「写入项目」也走开发服务器插件转交导入 CLI（见 3.2），mock 模式一律拒绝。导出物仅为草稿 JSON，且序列化中不出现 `coordinates`、`geometry` 等字段。
- 草稿所有落点都表示为 `{ edgeId, direction }`；派生环坐标仅在导入报告与地图渲染时临时计算。
- 导入 CLI 是唯一回写路径，必须同时满足：`status=readyForReview`、零校验错误、`--write`、`--confirm` 与 `draftId` 完全一致。
- 导入只对目标步骤的 `edgeRefs` 做文本定点替换，替换后做深比较，再原子写入；失败自动回滚。
- 生成器 dry-run 默认零写入；`--write` 三文件事务化，失败恢复快照。

## 9. 测试

```text
node --test "scripts/tests/*.test.mjs"

tests 128
pass 128
fail 0
```

覆盖要点：fixture 深相等、canonical 字节、输入顺序扰动、二次写入字节不变、退役双向记录、事务回滚、候选路径 0/1/多解、nonConnecting 不参与、断链/重复/不可用阻断、撤销重做、草稿恢复、自交检测、四至拆分、新建学区 ID 分配与事务写入、CLI 的 dry-run/confirm/定点替换/格式保留。
