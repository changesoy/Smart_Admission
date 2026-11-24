# 节点/边生成器最小验收样例

本目录是 B8 冻结的合成 fixture，不是生产数据。`bf_900001` 起的 ID 仅供测试，不得写入生产注册表。

## 场景

- 四条要素组成矩形；
- 南界中点与竖向穿越线是 `connected`，两条要素都应在该点切边；
- 西界中点与水平穿越线是 `nonConnectingCrossing`，两条要素都不得因该交叉切边；
- `bn_000001` 已存在，重建必须复用；
- 其余节点按稳定候选键分配 `bn_000002`–`bn_000010`；
- 八条边按稳定候选键分配 `be_0000001`–`be_0000008`；
- `bf_900006` 为 `boundaryEligible=false`，其边必须继承 false。

## 预期断言

1. 输出 10 个节点、8 条边；
2. `bn_000001` 保持不变；
3. `bn_000002` 是南界与竖向穿越线的 connected 节点；
4. `bn_000006` 是审计用 nonConnectingCrossing，不能参与换边；
5. `bf_900001` 和 `bf_900005` 各在 connected 节点切成两条边；
6. `bf_900004` 与 `bf_900006` 都不在 nonConnectingCrossing 切边；
7. 所有边使用 `fromVertexIndex < toVertexIndex`；
8. 第二次运行不分配新 ID，三个预期文件字节不变；
9. 不带 `--write` 时本目录及注册表字节不变；
10. 调换 features、decisions 的无语义数组顺序后输出字节不变。

## C 实现后的命令

```powershell
node scripts/generate-network.mjs `
  --features scripts/fixtures/network-generator/minimal/boundary_features.geojson `
  --decisions scripts/fixtures/network-generator/minimal/connection_decisions.json `
  --previous-nodes scripts/fixtures/network-generator/minimal/previous_network_nodes.json `
  --previous-edges scripts/fixtures/network-generator/minimal/previous_network_edges.json `
  --registry scripts/fixtures/network-generator/minimal/id_registry.json `
  --effective-date 2026-11-17
```

该命令默认 dry-run。C 的测试应在临时目录中追加 `--write`，再逐字节比较 `expected_network_nodes.json`、`expected_network_edges.json` 和 `expected_id_registry.json`，不能覆盖本 fixture。
