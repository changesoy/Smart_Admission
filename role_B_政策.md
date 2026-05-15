# 角色 B · 政策与模拟工程师 — 任务清单与实现路径

> 你负责让家长理解政策变化、预判录取结果、不被谣言带偏。
> 你是项目里最贴近"业务逻辑"的角色,价值在于把抽象政策变成可交互体验。

---

## 一、角色定位

**核心使命**:把"读政策文档"升级为"对比看变化 + 模拟看结果 + 辟谣建信任"。

**关键产出**(W4 末尾应有):
1. 政策归档扩展到 2022-2025 共 4 年
2. 政策对比视图(任选两个年份并排展示差异点)
3. 录取建议模拟器(输入家庭情况 → 输出推荐学区与录取概率参考)
4. 政策辟谣模块(谣言 + 官方澄清卡片)

---

## 二、你的专属文件

| 类型 | 文件路径 | 状态 |
|---|---|---|
| 数据 | `data/policies.json` | 扩展(6 条 → 15-20 条,覆盖 2022-2025) |
| 数据 | `data/policy_diff.json` | **新增** |
| 数据 | `data/rumors.json` | **新增** |
| 数据 | `data/simulator_rules.json` | **新增** |
| 代码 | `js/policyService.js` | **新增**(从 render.js 拆出政策渲染) |
| 代码 | `js/simulatorService.js` | **新增** |

**你会动到的共享文件**(改前在群里喊一声):
- `index.html` 的 `<!-- ========== B: 政策模拟区 ========== -->` 区块
- `js/config.js` 加 `simulatorConfig` 等
- `js/dataService.js` 注册新数据文件路径
- `js/main.js` 加 `PolicyService.init`、`SimulatorService.init` 调用
- `css/style.css` 加 `.policy-*`、`.sim-*`、`.rumor-*` 前缀的样式

---

## 三、4 周时间表

### Week 1(D1-D7)· 准备与脚手架

| 日 | 任务 | 产出 |
|---|---|---|
| D1 | 参加 4 小时数据 schema 闭门会议,讨论 policy_diff、rumors、simulator_rules 的字段 | 共同 schema 文档 |
| D2 | 创建 `feature/B-policy` 分支 | 分支就绪 |
| D2 | 把 `render.js` 里 `renderPolicies` 和 `renderPolicyFilters` 移到新建的 `policyService.js` | 拆分完成 |
| D3 | 起草 `policies.json` 扩展(2022/2023 各加 2-3 条) | 数据扩展 |
| D3 | 起草 `policy_diff.json`(先填 2024 vs 2025 一条) | 数据草稿 |
| D4 | 起草 `rumors.json`(6-8 条) + `simulator_rules.json` | 数据草稿 |
| D4 | 创建 `simulatorService.js` 空壳,加到 `main.js` | 骨架就绪 |
| D5 | **里程碑 M1**:第一次集成,跑通 | 整体可运行 |
| D6-D7 | 修 bug,准备 W2 | 进入主开发 |

### Week 2(D8-D14)· 核心开发 1

| 日 | 任务 | 实现要点 |
|---|---|---|
| D8-D9 | **政策扩展**:把 policies.json 扩到 15-20 条,覆盖 4 年 | 见下文 4.1 |
| D10-D13 | **政策对比视图**:年份下拉 + 并排对比 + 差异点高亮 | 见下文 4.2 |
| D14 | 自测 + push,**里程碑 M2** | 视频/截图存档 |

### Week 3(D15-D21)· 核心开发 2

| 日 | 任务 | 实现要点 |
|---|---|---|
| D15-D18 | **录取建议模拟器**:表单 → 计算 → 结果展示 | 见下文 4.3 |
| D19-D20 | **政策辟谣模块**:卡片式展示谣言与澄清 | 见下文 4.4 |
| D21 | 端到端测试,**里程碑 M3** | 测试报告 |

### Week 4(D22-D28)· 收尾

| 日 | 任务 |
|---|---|
| D22-D24 | Bug 修复 + 模拟器规则微调 |
| D25 | 与 A 联调("在地图上查看"按钮跳转) |
| D26 | 录屏(政策与模拟器 3 分钟片段) |
| D27 | 答辩演练 3 次 |
| D28 | **里程碑 M4** · 答辩就绪 |

---

## 四、四个功能的实现路径

### 4.1 政策扩展(D8-D9)

**目标**:从 6 条扩展到 15-20 条,覆盖 2022-2025 共 4 年。

**扩展建议**(按年份分布):

| 年份 | 数量 | 涉及分类 |
|---|---|---|
| 2022 | 3-4 | 招生政策、报名流程、材料要求 |
| 2023 | 3-4 | 招生政策、随迁子女、政策提醒 |
| 2024 | 4-5 | 招生政策、报名流程、材料要求、随迁子女 |
| 2025 | 5-6 | 招生政策、报名流程、材料要求、随迁子女、政策提醒 |

**继续遵守 v0.1 约束**:
- `source` 字段统一 `"示例数据·非官方"`
- `category` 取值限定:招生政策、报名流程、材料要求、随迁子女、政策提醒
- `url` 字段统一 `"#"`(不指向真实链接)
- 标题统一加"(示例)"后缀

**示例新增条目**:

```json
{
  "policyId": "policy_2022_001",
  "title": "2022 年义务教育招生入学工作政策说明(示例)",
  "year": 2022,
  "category": "招生政策",
  "source": "示例数据·非官方",
  "publishDate": "2022-04-15",
  "summary": "2022 年招生政策延续 2021 年总体框架,小学入学年龄保持 6 周岁,随迁子女继续执行积分入学制度。本政策为示例文本,实际以教育主管部门官方发布为准。",
  "url": "#"
}
```

**注意**:与 A 同步——A 的 zones.geojson 里 policyIds 数组也要更新引用新政策(W2 末集成时一起做)。

---

### 4.2 政策对比视图(D10-D13)

**目标**:用户选择两个年份(如 2024 vs 2025),系统在并排栏目里展示具体差异点,变化项高亮。

**数据文件 `data/policy_diff.json`**:

```json
[
  {
    "diffId": "diff_2024_2025",
    "yearA": 2024,
    "yearB": 2025,
    "diffPoints": [
      {
        "topic": "招生年龄",
        "valueA": "截至 8 月 31 日满 6 周岁(示例)",
        "valueB": "截至 8 月 31 日满 6 周岁(示例)",
        "isChange": false
      },
      {
        "topic": "报名时间",
        "valueA": "5 月 20 日—6 月 5 日(示例)",
        "valueB": "5 月 15 日—6 月 1 日(示例)",
        "isChange": true,
        "changeNote": "报名时间整体提前 5 天"
      },
      {
        "topic": "随迁子女积分起点",
        "valueA": "60 分(示例)",
        "valueB": "65 分(示例)",
        "isChange": true,
        "changeNote": "门槛提高 5 分,体现学位资源紧张"
      },
      {
        "topic": "材料要求",
        "valueA": "户口簿、房产证、出生证、防疫证",
        "valueB": "户口簿、房产证、出生证、防疫证(新增:监护人社保证明)",
        "isChange": true,
        "changeNote": "新增社保证明项"
      }
    ]
  },
  {
    "diffId": "diff_2023_2024",
    "yearA": 2023,
    "yearB": 2024,
    "diffPoints": [ /* ... */ ]
  }
]
```

至少做 2-3 个相邻年份的对比(2023↔2024、2024↔2025、2022↔2025)。

**HTML 结构**(放在 `index.html` 的 B 区块,政策列表下方):

```html
<section id="section-policy-diff" class="mb-4">
  <div class="card section-card">
    <div class="card-header section-header">
      <i class="bi bi-arrow-left-right"></i>政策年度对比
    </div>
    <div class="card-body">
      <div class="row align-items-center mb-3">
        <div class="col-md-5">
          <label class="form-label small text-muted mb-1">基准年份</label>
          <select id="diffYearA" class="form-select"></select>
        </div>
        <div class="col-md-2 text-center">
          <i class="bi bi-arrow-left-right fs-3 text-warning"></i>
        </div>
        <div class="col-md-5">
          <label class="form-label small text-muted mb-1">对比年份</label>
          <select id="diffYearB" class="form-select"></select>
        </div>
      </div>
      <div id="policyDiffResult"></div>
    </div>
  </div>
</section>
```

**`js/policyService.js` 代码骨架**:

```javascript
/* policyService.js - 政策渲染与对比 */

window.PolicyService = (function () {

  var _policies = [];
  var _diffs = [];

  function init(data) {
    _policies = data.policies || [];
    _diffs = data.policyDiff || [];

    renderPolicies(_policies);
    renderFilters();
    setupDiffView();
  }

  // (复用 v0.1 的 renderPolicies / renderPolicyFilters 逻辑,从 render.js 搬过来)
  function renderPolicies(list) { /* ... */ }
  function renderFilters() { /* ... */ }

  // ===== 政策对比视图 =====
  function setupDiffView() {
    var selA = document.getElementById('diffYearA');
    var selB = document.getElementById('diffYearB');
    if (!selA || !selB) return;

    // 提取所有年份
    var years = uniq(_policies.map(function (p) { return p.year; }))
                  .sort(function (a, b) { return b - a; });

    var options = years.map(function (y) {
      return '<option value="' + y + '">' + y + ' 年</option>';
    }).join('');

    selA.innerHTML = options;
    selB.innerHTML = options;
    // 默认选最近的两年
    if (years.length >= 2) {
      selA.value = years[1];
      selB.value = years[0];
    }

    selA.addEventListener('change', updateDiff);
    selB.addEventListener('change', updateDiff);

    updateDiff();
  }

  function updateDiff() {
    var yA = parseInt(document.getElementById('diffYearA').value);
    var yB = parseInt(document.getElementById('diffYearB').value);
    var resultEl = document.getElementById('policyDiffResult');

    if (yA === yB) {
      resultEl.innerHTML = '<div class="text-muted text-center py-3">请选择两个不同的年份进行对比</div>';
      return;
    }

    // 找到匹配的 diff(双向查找)
    var diff = _diffs.find(function (d) {
      return (d.yearA === yA && d.yearB === yB) || (d.yearA === yB && d.yearB === yA);
    });

    if (!diff) {
      resultEl.innerHTML = '<div class="text-muted text-center py-3">暂无 ' + yA + ' 与 ' + yB + ' 的对比数据</div>';
      return;
    }

    // 如果方向反了,交换 A/B 字段
    var swap = (diff.yearA !== yA);
    var html = '<div class="policy-diff-grid">';
    html += '<div class="policy-diff-row policy-diff-head">' +
              '<div class="policy-diff-topic">对比项</div>' +
              '<div class="policy-diff-cell">' + yA + ' 年</div>' +
              '<div class="policy-diff-cell">' + yB + ' 年</div>' +
            '</div>';

    diff.diffPoints.forEach(function (p) {
      var vA = swap ? p.valueB : p.valueA;
      var vB = swap ? p.valueA : p.valueB;
      var changeClass = p.isChange ? 'is-change' : '';
      html += '<div class="policy-diff-row ' + changeClass + '">' +
                '<div class="policy-diff-topic">' + p.topic + '</div>' +
                '<div class="policy-diff-cell">' + vA + '</div>' +
                '<div class="policy-diff-cell">' + vB + '</div>' +
              '</div>';
      if (p.isChange && p.changeNote) {
        html += '<div class="policy-diff-note"><i class="bi bi-exclamation-circle"></i>' + p.changeNote + '</div>';
      }
    });
    html += '</div>';
    resultEl.innerHTML = html;
  }

  function uniq(arr) {
    var out = [];
    arr.forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
    return out;
  }

  return { init: init };
})();
```

**CSS**(`.policy-*` 前缀):

```css
.policy-diff-grid {
  border: 1px solid var(--border-light);
  border-radius: 6px;
  overflow: hidden;
}

.policy-diff-row {
  display: grid;
  grid-template-columns: 1.5fr 2fr 2fr;
  border-bottom: 1px solid var(--border-light);
}

.policy-diff-row:last-child {
  border-bottom: none;
}

.policy-diff-head {
  background: var(--primary-color);
  color: #fff;
  font-weight: 600;
}

.policy-diff-row.is-change {
  background: rgba(240, 160, 75, 0.08);
}

.policy-diff-topic,
.policy-diff-cell {
  padding: 0.75rem 1rem;
  font-size: 0.9rem;
}

.policy-diff-topic {
  font-weight: 500;
  border-right: 1px solid var(--border-light);
}

.policy-diff-cell {
  border-right: 1px solid var(--border-light);
}

.policy-diff-cell:last-child {
  border-right: none;
}

.policy-diff-note {
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  color: var(--accent-color);
  background: rgba(240, 160, 75, 0.05);
  border-top: 1px dashed rgba(240, 160, 75, 0.3);
}

.policy-diff-note i {
  margin-right: 0.3rem;
}
```

**自测清单**:
- [ ] 默认显示最近两年对比
- [ ] 切换年份后表格刷新
- [ ] 变化项有橙色背景 + 变化说明
- [ ] 选两个相同年份时显示提示
- [ ] 反向选择(2025 vs 2024 vs 2024 vs 2025)结果一致

---

### 4.3 录取建议模拟器(D15-D18)

**目标**:用户填一个简单表单(户籍类型、房产情况、居住年限、户籍住房一致性),点击"开始模拟",输出一个推荐学区 + 录取概率档位 + 类似往年案例。

**重要心态**:这是**示意性模拟**,不是真实算法。规则越简单越好,够答辩演示即可。

**数据文件 `data/simulator_rules.json`**:

```json
{
  "categories": [
    { "key": "local", "label": "本地户籍" },
    { "key": "migrant", "label": "随迁子女" },
    { "key": "collective", "label": "集体户" },
    { "key": "split", "label": "人户分离" }
  ],
  "factors": [
    {
      "key": "propertyOwnership",
      "label": "房产情况",
      "options": [
        { "value": "owner", "label": "学区内自有房产", "score": 40 },
        { "value": "rental", "label": "学区内租房(已备案)", "score": 25 },
        { "value": "relative", "label": "亲属房产(借住)", "score": 15 },
        { "value": "none", "label": "无房产证明", "score": 5 }
      ]
    },
    {
      "key": "residenceYears",
      "label": "居住年限",
      "options": [
        { "value": "5plus", "label": "5 年以上", "score": 30 },
        { "value": "3to5", "label": "3-5 年", "score": 20 },
        { "value": "1to3", "label": "1-3 年", "score": 10 },
        { "value": "lt1", "label": "不足 1 年", "score": 5 }
      ]
    },
    {
      "key": "residenceMatch",
      "label": "户籍与住房一致性",
      "options": [
        { "value": "fullMatch", "label": "户籍与住房完全一致", "score": 30 },
        { "value": "partial", "label": "户籍与住房部分一致", "score": 15 },
        { "value": "mismatch", "label": "户籍与住房不一致", "score": 5 }
      ]
    }
  ],
  "scoreToSuggestion": [
    {
      "minScore": 85,
      "level": "高",
      "color": "success",
      "suggestion": "极有可能录取至学区内对口学校(示例)",
      "advice": "按时报名即可,材料齐全是关键。"
    },
    {
      "minScore": 65,
      "level": "中",
      "color": "warning",
      "suggestion": "大概率按学区分配,但需关注学校学位情况(示例)",
      "advice": "提前确认材料齐全,优先选择对口学校。"
    },
    {
      "minScore": 40,
      "level": "低",
      "color": "warning",
      "suggestion": "可能需要进入统筹安排(示例)",
      "advice": "建议同时准备多所学校的报名材料,关注招生办通知。"
    },
    {
      "minScore": 0,
      "level": "需关注",
      "color": "danger",
      "suggestion": "建议尽早咨询教育主管部门(示例)",
      "advice": "材料不足或情况复杂,建议提前咨询官方渠道。"
    }
  ]
}
```

**HTML 结构**:

```html
<section id="section-simulator" class="mb-4">
  <div class="card section-card">
    <div class="card-header section-header">
      <i class="bi bi-cpu-fill"></i>录取建议模拟器(示例)
    </div>
    <div class="card-body">
      <div class="alert alert-info small mb-3">
        <i class="bi bi-info-circle"></i> 本模拟器为示意性工具,基于示例规则生成参考建议,
        不构成任何实际录取承诺。实际录取以教育主管部门发布为准。
      </div>

      <div id="simulatorForm" class="row g-3"></div>

      <div class="mt-3 text-center">
        <button id="simulateBtn" class="btn btn-primary">
          <i class="bi bi-play-fill"></i> 开始模拟
        </button>
        <button id="resetBtn" class="btn btn-outline-secondary ms-2">重置</button>
      </div>

      <div id="simulatorResult" class="mt-4"></div>
    </div>
  </div>
</section>
```

**`js/simulatorService.js` 代码骨架**:

```javascript
/* simulatorService.js - 录取建议模拟器 */

window.SimulatorService = (function () {

  var _rules = null;

  function init(data) {
    _rules = data.simulatorRules;
    if (!_rules) {
      console.warn('simulatorRules 数据未加载');
      return;
    }
    renderForm();
    bindEvents();
  }

  function renderForm() {
    var container = document.getElementById('simulatorForm');
    if (!container) return;

    var html = '';

    // 户籍类型
    html += '<div class="col-md-6"><label class="form-label">户籍类型</label>';
    html += '<select id="simCategory" class="form-select">';
    _rules.categories.forEach(function (c) {
      html += '<option value="' + c.key + '">' + c.label + '</option>';
    });
    html += '</select></div>';

    // 三个评分因子
    _rules.factors.forEach(function (f) {
      html += '<div class="col-md-6"><label class="form-label">' + f.label + '</label>';
      html += '<select class="form-select sim-factor" data-factor-key="' + f.key + '">';
      f.options.forEach(function (o) {
        html += '<option value="' + o.value + '" data-score="' + o.score + '">' + o.label + '</option>';
      });
      html += '</select></div>';
    });

    container.innerHTML = html;
  }

  function bindEvents() {
    document.getElementById('simulateBtn').addEventListener('click', simulate);
    document.getElementById('resetBtn').addEventListener('click', resetForm);
  }

  function simulate() {
    var totalScore = 0;
    document.querySelectorAll('.sim-factor').forEach(function (sel) {
      var opt = sel.options[sel.selectedIndex];
      var score = parseInt(opt.getAttribute('data-score')) || 0;
      totalScore += score;
    });

    // 按分数查找建议(列表已按 minScore 降序排好)
    var suggestion = _rules.scoreToSuggestion.find(function (s) {
      return totalScore >= s.minScore;
    }) || _rules.scoreToSuggestion[_rules.scoreToSuggestion.length - 1];

    renderResult(totalScore, suggestion);
  }

  function renderResult(score, sug) {
    var el = document.getElementById('simulatorResult');
    el.innerHTML =
      '<div class="sim-result-card sim-result-' + sug.color + '">' +
        '<div class="sim-result-score">' +
          '<div class="sim-score-num">' + score + '</div>' +
          '<div class="sim-score-label">综合评分(满分 100)</div>' +
        '</div>' +
        '<div class="sim-result-body">' +
          '<div class="sim-result-level">参考等级:<strong>' + sug.level + '</strong></div>' +
          '<div class="sim-result-suggest">' + sug.suggestion + '</div>' +
          '<div class="sim-result-advice"><i class="bi bi-lightbulb"></i> ' + sug.advice + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="text-muted small mt-2 text-center">' +
        '<i class="bi bi-exclamation-triangle"></i> 本结果为示例,实际录取以官方为准' +
      '</div>';

    // 平滑滚动到结果
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetForm() {
    document.getElementById('simulatorForm').querySelectorAll('select').forEach(function (sel) {
      sel.selectedIndex = 0;
    });
    document.getElementById('simulatorResult').innerHTML = '';
  }

  return { init: init };
})();
```

**CSS**(`.sim-*` 前缀):

```css
.sim-result-card {
  display: flex;
  align-items: center;
  padding: 1.25rem;
  border-radius: 8px;
  border: 2px solid;
  background: #fff;
}

.sim-result-success { border-color: #28a745; background: rgba(40, 167, 69, 0.05); }
.sim-result-warning { border-color: var(--accent-color); background: rgba(240, 160, 75, 0.06); }
.sim-result-danger  { border-color: #dc3545; background: rgba(220, 53, 69, 0.05); }

.sim-result-score {
  text-align: center;
  padding-right: 1.25rem;
  margin-right: 1.25rem;
  border-right: 2px solid var(--border-light);
  min-width: 130px;
}

.sim-score-num {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--primary-color);
  line-height: 1;
}

.sim-score-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.sim-result-body { flex: 1; }

.sim-result-level {
  font-size: 0.95rem;
  margin-bottom: 0.4rem;
}

.sim-result-suggest {
  font-size: 1rem;
  font-weight: 600;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
}

.sim-result-advice {
  font-size: 0.88rem;
  color: var(--text-primary);
  background: rgba(0, 0, 0, 0.03);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
}

.sim-result-advice i {
  color: var(--accent-color);
  margin-right: 0.3rem;
}
```

**自测清单**:
- [ ] 表单 4 个下拉都能选
- [ ] 点击"开始模拟"立即出结果
- [ ] 分数计算正确(手动核对几次)
- [ ] 不同分数档位颜色不同
- [ ] 重置按钮正常工作
- [ ] 多次模拟不会重复堆叠结果

**与 A 联调**:在结果卡片里加一个"在地图上查看推荐学区"按钮,调用 `MapService.flyToZoneById('zone_XXX')`。

---

### 4.4 政策辟谣模块(D19-D20)

**目标**:卡片式展示常见谣言 + 官方澄清,帮助家长建立信任。

**数据文件 `data/rumors.json`**:

```json
[
  {
    "rumorId": "rumor_001",
    "rumor": "听说今年学区有大调整,我家划到外区了?",
    "truth": "(示例)2025 年学区调整仅涉及个别边界微调,主城区 90% 学区不变。具体可在本系统地图上查询您家位置所属学区。",
    "category": "学区调整",
    "source": "示例数据·非官方"
  },
  {
    "rumorId": "rumor_002",
    "rumor": "买了学区房就一定能上对应学校?",
    "truth": "(示例)学区房不等于学位锁定。具体录取要看入学年份的招生政策,部分热门学校还要看落户年限。",
    "category": "学区房",
    "source": "示例数据·非官方"
  },
  {
    "rumorId": "rumor_003",
    "rumor": "听说交一笔'择校费'就能进重点学校?",
    "truth": "(示例)义务教育阶段公办学校严禁收取择校费。任何以入学为名收费的行为都是违规的,请拨打教育局举报电话。",
    "category": "违规招生",
    "source": "示例数据·非官方"
  },
  {
    "rumorId": "rumor_004",
    "rumor": "随迁子女今年完全停止接收?",
    "truth": "(示例)随迁子女入学政策延续执行,具体按积分制安排,门槛较去年略有调整。详情参见'政策对比'区。",
    "category": "随迁子女",
    "source": "示例数据·非官方"
  },
  {
    "rumorId": "rumor_005",
    "rumor": "报名晚了就一定上不了对口学校?",
    "truth": "(示例)只要在官方公布的报名截止日期前完成报名都视为有效。但建议提前 2-3 天提交,避免末日拥堵。",
    "category": "报名时间",
    "source": "示例数据·非官方"
  },
  {
    "rumorId": "rumor_006",
    "rumor": "网上说某某学校今年录取分突然涨了 20 分?",
    "truth": "(示例)义务教育阶段公办学校不存在'分数线',按学区划分入学。所谓的'分数线'通常指随迁子女积分,详见官方政策。",
    "category": "录取规则",
    "source": "示例数据·非官方"
  }
]
```

填 6-10 条。

**HTML**(放在 B 区块,辟谣放在政策对比下面):

```html
<section id="section-rumors" class="mb-4">
  <div class="card section-card">
    <div class="card-header section-header">
      <i class="bi bi-shield-exclamation"></i>政策解读与辟谣(示例)
    </div>
    <div class="card-body">
      <div id="rumorList" class="rumor-grid"></div>
    </div>
  </div>
</section>
```

**渲染逻辑**(加入 `policyService.js`):

```javascript
function renderRumors(rumors) {
  var el = document.getElementById('rumorList');
  if (!el) return;

  if (!rumors || rumors.length === 0) {
    el.innerHTML = '<div class="text-muted text-center py-3">暂无辟谣数据</div>';
    return;
  }

  var html = '';
  rumors.forEach(function (r) {
    html += '<div class="rumor-card">' +
              '<div class="rumor-tag-row">' +
                '<span class="rumor-category">' + r.category + '</span>' +
              '</div>' +
              '<div class="rumor-question">' +
                '<i class="bi bi-question-circle-fill"></i>' +
                '<span>' + r.rumor + '</span>' +
              '</div>' +
              '<div class="rumor-truth">' +
                '<div class="rumor-truth-label"><i class="bi bi-check-circle-fill"></i> 官方澄清(示例)</div>' +
                '<div class="rumor-truth-text">' + r.truth + '</div>' +
              '</div>' +
            '</div>';
  });
  el.innerHTML = html;
}
```

记得在 `init(data)` 里调一次 `renderRumors(data.rumors)`。

**CSS**(`.rumor-*` 前缀):

```css
.rumor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}

.rumor-card {
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 1rem;
  background: #fff;
  transition: all 0.2s ease;
}

.rumor-card:hover {
  border-color: var(--accent-color);
  box-shadow: 0 2px 6px rgba(240, 160, 75, 0.12);
}

.rumor-category {
  display: inline-block;
  font-size: 0.75rem;
  background: rgba(220, 53, 69, 0.1);
  color: #dc3545;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-weight: 500;
}

.rumor-question {
  margin: 0.75rem 0;
  font-size: 0.95rem;
  color: var(--text-primary);
  display: flex;
  align-items: flex-start;
}

.rumor-question i {
  color: #dc3545;
  margin-right: 0.4rem;
  margin-top: 0.15rem;
}

.rumor-truth {
  background: rgba(40, 167, 69, 0.06);
  border-left: 3px solid #28a745;
  padding: 0.6rem 0.75rem;
  border-radius: 4px;
}

.rumor-truth-label {
  font-size: 0.8rem;
  color: #28a745;
  font-weight: 600;
  margin-bottom: 0.3rem;
}

.rumor-truth-label i { margin-right: 0.25rem; }

.rumor-truth-text {
  font-size: 0.88rem;
  color: var(--text-primary);
  line-height: 1.6;
}
```

**自测清单**:
- [ ] 6-10 个谣言卡片全部渲染
- [ ] 桌面端自动多列,移动端单列
- [ ] 红/绿色对比清晰

---

## 五、与其他角色的对接接口

| 接口 | 我提供 | 对方使用 | 数据形式 |
|---|---|---|---|
| `policy_diff 数据` | `data/policy_diff.json` | C 的 FAQ 答案可能链接到具体对比 | JSON |
| `推荐学区 zoneId` | 模拟器结果里的按钮 | A 的 `MapService.flyToZoneById()` | 函数调用 |
| `policyIds` | A 的 zones.geojson 需要引用我新增的 policyId | A 集成时同步更新 | 字符串数组 |

**我需要 A 提供的接口**:
```javascript
// 在 simulatorService.js 里(W4 联调时)
function bindMapJump() {
  var btn = document.getElementById('simViewMapBtn');
  if (btn) {
    btn.addEventListener('click', function () {
      var zoneId = btn.getAttribute('data-zone-id');
      if (window.MapService && window.MapService.flyToZoneById) {
        window.MapService.flyToZoneById(zoneId);
        document.getElementById('section-map').scrollIntoView({ behavior: 'smooth' });
      }
    });
  }
}
```

---

## 六、自测清单(每周末过一遍)

### W1 末尾
- [ ] `feature/B-policy` 分支已推送
- [ ] policies.json 扩展到 10+ 条
- [ ] 4 个数据文件骨架到位
- [ ] index.html 加了 4 个 section 占位

### W2 末尾
- [ ] 政策对比视图工作正常
- [ ] 切换年份表格刷新
- [ ] 变化项有视觉区分

### W3 末尾
- [ ] 模拟器表单 + 计算 + 结果展示完整
- [ ] 辟谣卡片渲染漂亮
- [ ] 整体 4 个功能都能跑

### W4 末尾
- [ ] Bug 全关闭
- [ ] 联调 "在地图上查看" 按钮工作
- [ ] 演示流程顺畅

---

## 七、答辩演示词(1.5 分钟,自己讲)

> "我负责政策与模拟模块,核心目标是把'看政策文档'变成'看变化、模拟结果、辟谣建信任'三件可以互动的事。
>
> 第一,**政策对比**[演示切换年份]。我们扩展了 2022—2025 共 4 年的政策数据,这里可以选两个年份并排比较,变化项用橙色高亮——比如这里 2024 到 2025 报名时间提前了 5 天,随迁子女积分门槛提高了 5 分。这直接回应了选题报告里'历史政策无统一归档、新老政策对比困难'的痛点。
>
> 第二,**录取建议模拟器**[演示填表]。这是一个示意性工具——家长填户籍类型、房产情况、居住年限、户籍住房一致性,系统根据 simulator_rules.json 里定义的简化规则计算一个综合评分,给出参考等级。比如这里我填一个典型情况,得到 75 分,建议是'大概率按学区分配'。**这只是参考,我们在 UI 上反复强调实际以官方为准**。
>
> 第三,**政策辟谣**[演示]。我们整理了 [N] 条常见谣言——比如'交择校费能进重点'、'学区房锁学位'——红色是谣言,绿色是澄清。这部分回应了选题报告里'微信群、短视频不实信息泛滥'的痛点。
>
> 整个模块完全由 JSON 数据驱动,如果将来对接真实政策数据,只需要替换 4 个 JSON 文件,代码零修改。"

---

## 八、AI-IDE 使用建议

**好用场景**:
1. 让 AI 帮你扩写 policies.json 的示例文本(给它已有的 1 条,让它续写 9 条,主题指定)
2. 让 AI 帮你设计 policy_diff.json 的 diffPoints(给它两年差异描述,自动生成结构化数据)
3. 让 AI 帮你写表单渲染的循环 HTML 字符串

**容易翻车的场景**:
1. **AI 会偷偷加 import/export**:每次提醒它"全局变量,window.XXX"
2. **AI 会过度优化模拟器算法**:你只需要简单求和,它可能给你写出加权矩阵——直接拒绝,够用就好
3. **AI 会忘了"示例数据·非官方"**:每次生成完政策数据,搜一下确保 source 字段统一
4. **AI 会发明真实学校/真实政策**:严格 review,不允许出现真实学校名、真实电话、真实政策内容

**推荐 prompt 模板**:
```
我在做智慧入学项目的政策与模拟模块,纯前端 Vanilla JS。
当前文件:js/simulatorService.js
需求:[具体功能]
约束:
- 暴露 window.SimulatorService = { init }
- 不使用 import/export
- 必须保持"示例数据·非官方"声明
- 不允许出现真实政策文本、真实学校名
- 字段名严格按照 data-schema.md
请只生成这个文件的代码,不要改其他文件。
```

---

**祝顺利。如有跨模块对接问题,优先在群里和 A、C 对齐。**
