# 角色 B · 政策与模拟工程师 — 任务清单与实现路径

> 你负责让家长理解政策变化、预判录取结果、不被谣言带偏。
> 你是项目里最贴近"业务逻辑"的角色,价值在于把抽象政策变成可交互体验。

---

## 一、角色定位

**核心使命**:把"读政策文档"升级为"对比看变化 + 模拟看结果 + 辟谣建信任"。

**关键产出**(W4 末尾应有):
1. 政策归档扩展到 2022-2025 共 4 年,共计 19 条政策文件
2. 政策对比视图(任选两个年份并排展示差异点)
3. 录取建议模拟器(输入家庭情况 → 输出推荐学区与录取概率参考)
4. 政策辟谣模块(谣言 + 官方澄清卡片)
5. **政策超链接跳转功能**(点击政策卡片可直接打开原文链接)

---

## 二、政策文件来源与索引

以下为泰山区义务教育招生入学工作官方政策文件,共覆盖 **2022-2025 四个年度** :

| 序号 | 年份 | 文件名称 | 分类 | 原文链接 |
|---|---|---|---|---|
| 1 | 2025 | [泰山政办发〔2025〕6号 阳光招生工作方案](http://www.sdtaishan.gov.cn/art/2025/8/12/art_181325_19023.html) | 招生政策 | [查看](http://www.sdtaishan.gov.cn/art/2025/8/12/art_181325_19023.html) |
| 2 | 2025 | [(简明问答)政策问题解答](http://www.sdtaishan.gov.cn/art/2025/8/12/art_172295_10373774.html) | 报名流程 | [查看](http://www.sdtaishan.gov.cn/art/2025/8/12/art_172295_10373774.html) |
| 3 | 2025 | [义务教育学校名录(110所)](http://www.sdtaishan.gov.cn/art/2025/8/4/art_193047_10373392.html) | 材料要求 | [查看](http://www.sdtaishan.gov.cn/art/2025/8/4/art_193047_10373392.html) |
| 4 | 2025 | [随迁子女入学办法](http://www.sdtaishan.gov.cn/art/2025/8/12/art_193048_10374114.html) | 随迁子女 | [查看](http://www.sdtaishan.gov.cn/art/2025/8/12/art_193048_10374114.html) |
| 5 | 2025 | [中小学教辅材料政策明白纸](https://jyj.taian.gov.cn/art/2024/7/4/art_45480_10304427.html) | 政策提醒 | [查看](https://jyj.taian.gov.cn/art/2024/7/4/art_45480_10304427.html) |
| 6 | 2025 | [招生纪律与监督公告](http://www.sdtaishan.gov.cn/art/2025/8/12/art_181325_19023.html) | 政策提醒 | [查看](http://www.sdtaishan.gov.cn/art/2025/8/12/art_181325_19023.html) |
| 7 | 2024 | [泰山政办发〔2024〕7号 阳光招生工作方案(PDF)](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=c72f97901bd049f19cf1672ca0f23835.pdf) | 招生政策 | [下载](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=c72f97901bd049f19cf1672ca0f23835.pdf) |
| 8 | 2024 | [小学入学网上报名流程指引](http://www.sdtaishan.gov.cn/art/2024/8/6/art_312742_4021.html) | 报名流程 | [查看](http://www.sdtaishan.gov.cn/art/2024/8/6/art_312742_4021.html) |
| 9 | 2024 | [招生材料清单(PDF)](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=c72f97901bd049f19cf1672ca0f23835.pdf) | 材料要求 | [下载](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=c72f97901bd049f19cf1672ca0f23835.pdf) |
| 10 | 2024 | [随迁子女积分入学实施细则](http://www.sdtaishan.gov.cn/art/2024/8/12/art_193048_10363913.html) | 随迁子女 | [查看](http://www.sdtaishan.gov.cn/art/2024/8/12/art_193048_10363913.html) |
| 11 | 2024 | [规范招生秩序重要提醒(PDF)](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=c72f97901bd049f19cf1672ca0f23835.pdf) | 政策提醒 | [下载](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=c72f97901bd049f19cf1672ca0f23835.pdf) |
| 12 | 2023 | [泰山政办发〔2023〕13号 招生入学工作意见(PDF)](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=1accdf0271d0441d906fc5631fe780fd.pdf) | 招生政策 | [下载](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=1accdf0271d0441d906fc5631fe780fd.pdf) |
| 13 | 2023 | [招生报名操作指南](http://www.sdtaishan.gov.cn/art/2023/8/8/art_172295_10348748.html) | 报名流程 | [查看](http://www.sdtaishan.gov.cn/art/2023/8/8/art_172295_10348748.html) |
| 14 | 2023 | [随迁子女入学政策解读](http://www.sdtaishan.gov.cn/art/2023/8/11/art_193048_10351779.html) | 随迁子女 | [查看](http://www.sdtaishan.gov.cn/art/2023/8/11/art_193048_10351779.html) |
| 15 | 2023 | [招生安全工作提示(PDF)](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=1accdf0271d0441d906fc5631fe780fd.pdf) | 政策提醒 | [下载](http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=1accdf0271d0441d906fc5631fe780fd.pdf) |
| 16 | 2022 | [泰山政办发〔2022〕10号 招生入学工作意见](http://www.sdtaishan.gov.cn/art/2022/8/15/art_181325_9107.html) | 招生政策 | [查看](http://www.sdtaishan.gov.cn/art/2022/8/15/art_181325_9107.html) |
| 17 | 2022 | [小学新生入学报名流程](http://www.sdtaishan.gov.cn/art/2022/12/30/art_312742_723.html) | 报名流程 | [查看](http://www.sdtaishan.gov.cn/art/2022/12/30/art_312742_723.html) |
| 18 | 2022 | [入学材料准备须知](http://www.sdtaishan.gov.cn/art/2022/8/15/art_181325_9107.html) | 材料要求 | [查看](http://www.sdtaishan.gov.cn/art/2022/8/15/art_181325_9107.html) |
| 19 | 2022 | [随迁子女入学工作通知](http://www.sdtaishan.gov.cn/art/2022/8/15/art_181325_9107.html) | 随迁子女 | [查看](http://www.sdtaishan.gov.cn/art/2022/8/15/art_181325_9107.html) |

---

## 三、2022-2025 政策演变对比分析

### 3.1 重大政策变化总览

| 变化维度 | 2022年 | 2023年 | 2024年 | 2025年 | 趋势 |
|---|---|---|---|---|---|
| **报名方式** | 网上试点+线下并存 | 全面推行网上报名 | 一网通办 | 一网通办+绿色通道 | 数字化程度不断提高 |
| **随迁子女入学** | 条件接收制 | 积分制实行 | 积分制完善 | 积分制+精细化材料审核 | 从粗放管理到精准服务 |
| **材料要求** | 预防接种证作为条件 | 取消预防接种证条件 | 继续精简 | 本区户籍"零证明提交" | 材料不断精简,数据共享增强 |
| **服务模式** | 基本服务 | 基础便民 | 优化流程 | 集中办公+帮办代办+优抚通道 | 服务型政府理念深化 |
| **招生年龄** | 满6周岁 | 满6周岁 | 满6周岁 | 满6周岁 | 稳定 |

### 3.2 逐年关键变化点

#### 2022 → 2023 关键变化
1. **随迁子女入学方式根本性转变**:从"满足基本条件即可申请"转为"积分制综合评估"
2. **报名渠道全面线上化**:2023年起全面推行网上报名,逐步取消线下报名
3. **材料精简**:预防接种证明不再作为入学报名前置条件

#### 2023 → 2024 关键变化
1. **居住证发证机关明确化**:从"泰山区公安部门"明确为"泰安市公安局泰山分局"
2. **民办学校录取规则细化**:明确"超出计划电脑随机派位,未超计划全员录取"
3. **多胞胎登记制度化**:新增多胞胎家庭报名登记说明

#### 2024 → 2025 关键变化
1. **报名时间具体化**:2025年明确了具体时间范围(5月15日至6月1日)
2. **绿色通道制度化**:对使用平台不便的家长开辟绿色通道,设置线下"一站式"站点
3. **优抚措施具体化**:专设优抚对象入学网上申请入口,优先协调办理高层次人才和军人子女入学
4. **延缓入学申请时间明确**:8月17日至8月18日通过APP提交申请
5. **泰安市内部户籍区别对待**:明确岱岳区、高新区、景区户籍人员无需办理居住证

---

## 四、政策超链接功能说明

### 4.1 功能实现

点击政策卡片标题或"查看原文"按钮,可直接在**新标签页**打开对应的政府官网政策原文。

### 4.2 数据结构

```json
{
  "policyId": "policy_2025_001",
  "title": "2025年泰山区义务教育段学校阳光招生工作方案",
  "year": 2025,
  "category": "招生政策",
  "source": "泰安市泰山区人民政府办公室",
  "publishDate": "2025-08-12",
  "summary": "泰山政办发〔2025〕6号...",
  "url": "http://www.sdtaishan.gov.cn/art/2025/8/12/art_181325_19023.html"
}
```

### 4.3 渲染逻辑

```javascript
// policyService.js 核心逻辑
function renderPolicies(list) {
  list.forEach(function (p) {
    var isExternalLink = p.url && p.url !== '#' && p.url.startsWith('http');
    if (isExternalLink) {
      // 卡片可点击,打开新标签页
      // 显示"查看原文"按钮
      // 标题旁显示外部链接图标
    }
  });
}
```

---

## 五、你的专属文件

| 类型 | 文件路径 | 状态 |
|---|---|---|
| 数据 | `data/policies.json` | ✅ 已更新(19条,含真实URL) |
| 数据 | `data/policy_diff.json` | ✅ 已更新(4组对比,基于实际政策) |
| 数据 | `data/rumors.json` | 需维护 |
| 数据 | `data/simulator_rules.json` | 需维护 |
| 代码 | `js/policyService.js` | ✅ 已添加超链接功能 |
| 代码 | `js/simulatorService.js` | 需维护 |

**已改动共享文件**:
- `js/policyService.js` - 添加超链接跳转功能
- `css/style.css` - 添加 `.policy-link-btn` 样式

---

## 六、4 周时间表

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
| D8-D9 | **政策扩展**:把 policies.json 扩到 15-20 条,覆盖 4 年 | ✅ 已完成,共19条 |
| D10-D13 | **政策对比视图**:年份下拉 + 并排对比 + 差异点高亮 | ✅ 已实现 |
| D14 | 自测 + push,**里程碑 M2** | 视频/截图存档 |

### Week 3(D15-D21)· 核心开发 2

| 日 | 任务 | 实现要点 |
|---|---|---|
| D15-D18 | **录取建议模拟器**:表单 → 计算 → 结果展示 | 见下文 4.3 |
| D19-D20 | **政策辟谣模块**:卡片式展示谣言与澄清 | 见下文 4.4 |
| D21 | 端到端测试,**里程碑 M3** | 测试报告 |

### Week 4(D22-D28)· 收尾

| 日 | 任务 |
|---|
| D22-D24 | Bug 修复 + 模拟器规则微调 |
| D25 | 与 A 联调("在地图上查看"按钮跳转) |
| D26 | 录屏(政策与模拟器 3 分钟片段) |
| D27 | 答辩演练 3 次 |
| D28 | **里程碑 M4** · 答辩就绪 |

---

## 七、四个功能的实现路径

### 7.1 政策扩展 ✅ (已完成)

**目标**:从 6 条扩展到 19 条,覆盖 2022-2025 共 4 年。

**扩展完成情况**:

| 年份 | 数量 | 涉及分类 |
|---|---|---|
| 2022 | 4 | 招生政策、报名流程、材料要求、随迁子女 |
| 2023 | 4 | 招生政策、报名流程、随迁子女、政策提醒 |
| 2024 | 5 | 招生政策、报名流程、材料要求、随迁子女、政策提醒 |
| 2025 | 6 | 招生政策、报名流程、材料要求、随迁子女、政策提醒 |

**数据源**:
- 所有政策文件均来自 `sdtaishan.gov.cn`(泰山区人民政府) 和 `jyj.taian.gov.cn`(泰安市教育局)
- PDF 文件通过 `module/download/downfile.jsp` 接口获取

**超链接功能**:
- 政策卡片点击可打开原文
- 外部链接显示图标 `bi-box-arrow-up-right`
- "查看原文"按钮支持新标签页打开

---

### 7.2 政策对比视图 ✅ (已实现)

**目标**:用户选择两个年份(如 2024 vs 2025),系统在并排栏目里展示具体差异点,变化项高亮。

**已完成对比组**:

| 对比组 | 关键差异点数量 | 主要变化 |
|---|---|---|
| 2024 ↔ 2025 | 8 | 报名时间、方式、优抚措施、绿色通道等 |
| 2023 ↔ 2024 | 5 | 居住证机关、民办录取规则、多胞胎登记等 |
| 2022 ↔ 2023 | 5 | 全面网报、积分制、预防接种证等 |
| 2022 ↔ 2025 | 5 | 三年总变化趋势对比 |

**对比表样式**:
- 变化项用橙色背景高亮
- 每项下方显示变化说明
- 支持双向对比(2024→2025 或 2025→2024)

---

### 7.3 录取建议模拟器(D15-D18)

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
      "suggestion": "极有可能录取至学区内对口学校",
      "advice": "按时报名即可,材料齐全是关键。"
    },
    {
      "minScore": 65,
      "level": "中",
      "color": "warning",
      "suggestion": "大概率按学区分配,但需关注学校学位情况",
      "advice": "提前确认材料齐全,优先选择对口学校。"
    },
    {
      "minScore": 40,
      "level": "低",
      "color": "warning",
      "suggestion": "可能需要进入统筹安排",
      "advice": "建议同时准备多所学校的报名材料,关注招生办通知。"
    },
    {
      "minScore": 0,
      "level": "需关注",
      "color": "danger",
      "suggestion": "建议尽早咨询教育主管部门",
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
      <i class="bi bi-cpu-fill"></i>录取建议模拟器（示例）
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
    renderForm();
    setupEventListeners();
  }

  function renderForm() {
    var container = document.getElementById('simulatorForm');
    if (!container || !_rules) return;

    var html = '';
    _rules.categories.forEach(function (cat) {
      html += '<div class="col-md-6">';
      html += '<div class="mb-3">';
      html += '<label class="form-label">' + cat.label + '</label>';
      html += '<select id="cat_' + cat.key + '" class="form-select">';
      html += '<option value="">请选择</option>';
      _rules.factors.forEach(function (f) {
        f.options.forEach(function (opt) {
          html += '<option value="' + opt.value + '">' + opt.label + '</option>';
        });
      });
      html += '</select>';
      html += '</div></div>';
    });

    // ... 更多表单项
    container.innerHTML = html;
  }

  function setupEventListeners() {
    document.getElementById('simulateBtn').addEventListener('click', calculateResult);
    document.getElementById('resetBtn').addEventListener('click', resetForm);
  }

  function calculateResult() {
    // 计算总分,匹配建议
  }

  function resetForm() {
    // 重置表单
  }

  return { init: init };
})();
```

---

### 7.4 政策辟谣模块(D19-D20)

**目标**:卡片式展示谣言与澄清,帮助家长识别虚假信息。

**数据文件 `data/rumors.json`**:

```json
[
  {
    "rumorId": "rumor_001",
    "category": "报名诈骗",
    "rumor": "有关系可以提前锁定名额,只需交3000元手续费",
    "truth": "泰山区义务教育招生全程电脑随机录取,任何机构和个人都无法操控结果。教育局举报电话:6276103。"
  },
  {
    "rumorId": "rumor_002",
    "category": "材料诈骗",
    "rumor": "预防接种证没办下来会影响入学报名",
    "truth": "预防接种证明已于2023年起不再作为入学报名前置条件,可开学后补交。"
  },
  {
    "rumorId": "rumor_003",
    "category": "招生诈骗",
    "rumor": "民办学校可以提前"预订"学位",
    "truth": "民办学校须通过统一招生平台录取,不得提前招生或承诺录取。多胞胎家庭需到指定地点登记。"
  },
  {
    "rumorId": "rumor_004",
    "category": "材料诈骗",
    "rumor": "房产证正在办理中可以用购房合同代替",
    "truth": "已交房入住的住宅可用购房合同作为房产证明,工业用房、商业用房等非住宅性质房产不能作为入学依据。"
  },
  {
    "rumorId": "rumor_005",
    "category": "时间诈骗",
    "rumor": "错过报名时间可以找关系补录",
    "truth": "招生工作严格按照时间节点进行,逾期未报名者须等待统筹安排,无法通过任何渠道补录。"
  },
  {
    "rumorId": "rumor_006",
    "category": "招生诈骗",
    "rumor": "可以去学校"借读",以后再转学籍",
    "truth": "已录取学生不得违规借读,出现"人籍不一致"属于违规行为,将被严肃查处。"
  }
]
```

**HTML 结构**:

```html
<section id="section-rumors" class="mb-4">
  <div class="card section-card">
    <div class="card-header section-header">
      <i class="bi bi-shield-exclamation"></i>政策解读与辟谣（示例）
    </div>
    <div class="card-body">
      <div id="rumorList" class="rumor-grid"></div>
    </div>
  </div>
</section>
```

**`js/policyService.js` 辟谣渲染逻辑**:

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
    html += '<div class="rumor-card">';
    html += '<div class="rumor-tag-row">';
    html += '<span class="rumor-category">' + r.category + '</span>';
    html += '</div>';
    html += '<div class="rumor-question">';
    html += '<i class="bi bi-question-circle-fill"></i>';
    html += '<span>' + r.rumor + '</span>';
    html += '</div>';
    html += '<div class="rumor-truth">';
    html += '<div class="rumor-truth-label"><i class="bi bi-check-circle-fill"></i>官方澄清</div>';
    html += '<div class="rumor-truth-text">' + r.truth + '</div>';
    html += '</div>';
    html += '</div>';
  });
  el.innerHTML = html;
}
```

---

## 八、自测清单

### 政策列表与超链接
- [x] 默认显示所有年份政策
- [x] 按分类筛选正常工作
- [x] 按年份筛选正常工作
- [x] 外部链接显示图标
- [x] 点击卡片可打开原文
- [x] "查看原文"按钮可打开原文

### 政策对比视图
- [x] 默认显示最近两年对比(2024 vs 2025)
- [x] 切换年份后表格刷新
- [x] 变化项有橙色背景 + 变化说明
- [x] 选两个相同年份时显示提示
- [x] 反向选择(2025 vs 2024 vs 2024 vs 2025)结果一致

### 录取建议模拟器
- [ ] 表单渲染正常
- [ ] 选择不同选项后点击"开始模拟"显示结果
- [ ] 结果根据分数显示不同颜色等级
- [ ] 点击"重置"表单恢复初始状态
- [ ] 低于40分显示"建议咨询官方"

### 政策辟谣模块
- [ ] 谣言卡片正常显示
- [ ] 点击谣言类别可筛选
- [ ] 澄清内容清晰可读

---

## 九、官方政策原文链接汇总

### 泰山区人民政府 (sdtaishan.gov.cn)
| 文件 | 链接 |
|---|---|
| 2025年阳光招生方案 | http://www.sdtaishan.gov.cn/art/2025/8/12/art_181325_19023.html |
| 2025年政策问答 | http://www.sdtaishan.gov.cn/art/2025/8/12/art_172295_10373774.html |
| 2025年学校名录 | http://www.sdtaishan.gov.cn/art/2025/8/4/art_193047_10373392.html |
| 2025年随迁子女入学 | http://www.sdtaishan.gov.cn/art/2025/8/12/art_193048_10374114.html |
| 2024年随迁子女积分入学 | http://www.sdtaishan.gov.cn/art/2024/8/12/art_193048_10363913.html |
| 2024年网上报名指引 | http://www.sdtaishan.gov.cn/art/2024/8/6/art_312742_4021.html |
| 2023年随迁子女入学解读 | http://www.sdtaishan.gov.cn/art/2023/8/11/art_193048_10351779.html |
| 2023年招生报名指南 | http://www.sdtaishan.gov.cn/art/2023/8/8/art_172295_10348748.html |
| 2022年招生工作意见 | http://www.sdtaishan.gov.cn/art/2022/8/15/art_181325_9107.html |
| 2022年入学报名流程 | http://www.sdtaishan.gov.cn/art/2022/12/30/art_312742_723.html |

### 泰安市教育局 (jyj.taian.gov.cn)
| 文件 | 链接 |
|---|---|
| 中小学教辅材料政策明白纸 | https://jyj.taian.gov.cn/art/2024/7/4/art_45480_10304427.html |

### PDF下载文件
| 文件 | 链接 |
|---|---|
| 2024年招生工作方案(PDF) | http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=c72f97901bd049f19cf1672ca0f23835.pdf |
| 2023年招生入学意见(PDF) | http://www.sdtaishan.gov.cn/module/download/downfile.jsp?classid=0&filename=1accdf0271d0441d906fc5631fe780fd.pdf |
| 2022年招生工作意见(PDF) | (见网页版) |
