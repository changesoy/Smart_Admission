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
| `tools/boundary-editor/` | 独立 Leaflet 点选编辑器（`index.html` / `app.js` / `style.css` / `mock/`） |
| `scripts/tests/network-generator.test.mjs` | 生成器测试（13 项） |
| `scripts/tests/draft-core.test.mjs` | 草稿核心测试（12 项） |
| `scripts/tests/zone-draft-cli.test.mjs` | validate / import CLI 测试（4 项） |

未改动生产首页 `index.html`，未改动 `data/boundary_features.v2.geojson`、`data/zone_specs.v2.json`、`data/zones.geojson`。

## 2. 五阶段状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 节点/边生成器 | 完成，fixture 深相等 + 二次运行字节一致 |
| 2 | Leaflet 点选编辑器 | 完成，mock 与真实数据均实测 |
| 3 | 候选路径 + 共边复用 | 完成，唯一解需确认、多解全列、无解报错 |
| 4 | validate / import CLI + 派生环差异 | 完成，含 4 项 CLI 测试 |
| 5 | 真实数据试用 | 生成器已落盘并验证；zone_006 / zone_031 因缺连接裁定无法闭合（见第 6 节） |

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

# 测试
npm run test:zones
```

编辑器：`npm run dev` 后打开 `/tools/boundary-editor/index.html`。顶栏可切换 `mock` 与 `真实 data/`。

## 4. 真实数据生成结果（2026-11-21）

- 输入：61 个要素；`data/network_connection_decisions.json` 不存在。
- 输出：138 个节点、69 条边，全部 `active`、`connectionType=connected`。
- 注册表：`networkNode` 与 `networkEdge` 计数器从 0 变为 138 / 69，登记项与计数器一致。
- 幂等：第二次 dry-run 复用 138 个节点、69 条边，新增 0，两个输出文件 SHA-256 与首次一致。
- `npm run validate:network`：0 个错误，14 个警告（均为“步骤尚未绑定 edgeRefs”）。

## 5. 试用结果

### zone_006（含两个“排除”步骤）

编辑器真实模式下加载成功，6 个步骤按正式顺序显示：
`排除 除东湖路以北`、`排除 温泉路以西区域`、`北 北至东岳大街`、`东 东至双龙河`、`南 南至灵山大街`、`西 西至迎春路`。

“排除”步骤按契约 §8 处理：与相接的排除区并入 outer 凹口，不创建 `hole` 环；只有完全内嵌的独立闭合才建 `hole` 且必须带 `appliesToRingId`。草稿校验会拒绝把 `side=排除` 的步骤放进 `hole` 环。

### zone_031（4 步）

真实模式下加载成功，4 个步骤东/西/南/北显示正常。
点击第一条边 `be_0000007`（辛泰铁路）成功加入“东”步骤；点击第二条边 `be_0000003`（谢过城街）被明确拒绝：

```
断链：be_0000003 的端点为 bn_000005/bn_000006，当前终点是 bn_000014
```

第二条边未被加入，页面保留第一条边并提示未闭合。

### 无连接裁定的拓扑现状

对生成结果做连通分量分析：69 个连通分量，每个分量恰好 1 条边、2 个节点，环数为 0。
因此当前真实数据下任何学区都无法形成闭合环，这不是编辑器限制，而是缺少跨要素连接裁定。

## 6. 阻塞：缺少 `data/network_connection_decisions.json`

生成器只在存在裁定文件时合并跨要素共点。当前默认路径不存在，跨要素即使坐标相同也不会连通，所以：

- 可以单边点选，但无法把多条边首尾相接；
- 任何 `readyForReview` 草稿都会因“未闭合”被校验拒绝；
- 因此本轮无法为 zone_006 / zone_031 产出可导入草稿。

补齐裁定后重跑生成器即可。裁定文件格式（`DECISION_SCHEMA_VERSION = 1`）：

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

- 编辑器只读 `/data`，不提供任何写正式数据的接口；导出物仅为草稿 JSON，且序列化中不出现 `coordinates`、`geometry` 等字段。
- 草稿所有落点都表示为 `{ edgeId, direction }`；派生环坐标仅在导入报告与地图渲染时临时计算。
- 导入 CLI 是唯一回写路径，必须同时满足：`status=readyForReview`、零校验错误、`--write`、`--confirm` 与 `draftId` 完全一致。
- 导入只对目标步骤的 `edgeRefs` 做文本定点替换，替换后做深比较，再原子写入；失败自动回滚。
- 生成器 dry-run 默认零写入；`--write` 三文件事务化，失败恢复快照。

## 9. 测试

```text
node --test "scripts/tests/*.test.mjs"

tests 80
pass 80
fail 0
```

覆盖要点：fixture 深相等、canonical 字节、输入顺序扰动、二次写入字节不变、退役双向记录、事务回滚、候选路径 0/1/多解、nonConnecting 不参与、断链/重复/不可用阻断、撤销重做、草稿恢复、自交检测、CLI 的 dry-run/confirm/定点替换/格式保留。
