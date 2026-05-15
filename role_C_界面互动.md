# 角色 C · 互动与内容工程师 — 任务清单与实现路径

> 你负责让家长能完成"咨询 + 准备材料 + 解疑"的全流程。
> 你的工作贯穿整个页面的"末端体验",看似零散但决定用户口碑。

---

## 一、角色定位

**核心使命**:把"看完地图就走"升级为"留言能反馈 + 材料能下载 + 问题能找到 + 视觉舒服"。

**关键产出**(W4 末尾应有):
1. 政民互动模块(留言表单 + 教育局联系卡片)
2. 入学材料清单增强(模板下载链接 + 常见被拒原因 + 有效期标签)
3. FAQ 增强(分类筛选 chip + 相关问题推荐)
4. 整体 UI 体检(响应式微调 + 加载骨架屏 + 错误状态美化)

---

## 二、你的专属文件

| 类型 | 文件路径 | 状态 |
|---|---|---|
| 数据 | `data/materials.json` | 扩展(增加 templateUrl、commonReasons、validity 字段) |
| 数据 | `data/faq.json` | 扩展(增加 relatedIds 字段) |
| 数据 | `data/contacts.json` | **新增** |
| 代码 | `js/materialService.js` | **新增**(从 render.js 拆出材料部分) |
| 代码 | `js/faqService.js` | **新增**(从 render.js 拆出 FAQ 部分) |
| 代码 | `js/interactionService.js` | **新增** |

**你会动到的共享文件**(改前在群里喊一声):
- `index.html` 的 `<!-- ========== C: 互动内容区 ========== -->` 区块
- `js/config.js` 加 `interactionConfig` 等
- `js/dataService.js` 注册新数据文件路径
- `js/main.js` 加 `MaterialService.init`、`FaqService.init`、`InteractionService.init` 调用
- `css/style.css` 加 `.mat-*`、`.faq-*`、`.contact-*` 前缀的样式
- **特别**:`:root` 里的全局变量(如果想做全局 UI 调整,要和组长 A 商量)

---

## 三、4 周时间表

### Week 1(D1-D7)· 准备与脚手架

| 日 | 任务 | 产出 |
|---|---|---|
| D1 | 参加 4 小时数据 schema 闭门会议,讨论 materials、faq、contacts 的字段扩展 | 共同 schema 文档 |
| D2 | 创建 `feature/C-interaction` 分支 | 分支就绪 |
| D2 | 把 `render.js` 里 `renderMaterials`、`renderFaq`、`bindFaqSearch` 移到新建的 `materialService.js` 和 `faqService.js` | 拆分完成 |
| D3 | 起草扩展后的 `materials.json`(每项材料加 templateUrl、commonReasons、validity) | 数据扩展 |
| D3 | 起草扩展后的 `faq.json`(每条加 relatedIds) | 数据扩展 |
| D4 | 起草 `contacts.json`(教育局示例联系信息) | 数据草稿 |
| D4 | 创建 `interactionService.js` 空壳,加到 `main.js` | 骨架就绪 |
| D5 | **里程碑 M1**:第一次集成,跑通 | 整体可运行 |
| D6-D7 | 修 bug,准备 W2 | 进入主开发 |

### Week 2(D8-D14)· 核心开发 1

| 日 | 任务 | 实现要点 |
|---|---|---|
| D8-D9 | **政民互动模块**:留言表单(sessionStorage)+ 联系卡片 | 见下文 4.1 |
| D10-D13 | **材料清单增强**:模板下载 + 被拒原因展开 + 有效期标签 | 见下文 4.2 |
| D14 | 自测 + push,**里程碑 M2** | 视频/截图存档 |

### Week 3(D15-D21)· 核心开发 2

| 日 | 任务 | 实现要点 |
|---|---|---|
| D15-D17 | **FAQ 增强**:分类筛选 chip + 相关问题推荐 | 见下文 4.3 |
| D18-D20 | **整体 UI 体检**:响应式 + 骨架屏 + 错误状态 + 微动画 | 见下文 4.4 |
| D21 | 端到端测试,**里程碑 M3** | 测试报告 |

### Week 4(D22-D28)· 收尾

| 日 | 任务 |
|---|---|
| D22-D24 | Bug 修复 + 视觉细节打磨 |
| D25 | 移动端真机测试(至少手机 + 平板各一次) |
| D26 | 录屏(互动与内容 3 分钟片段) |
| D27 | 答辩演练 3 次 |
| D28 | **里程碑 M4** · 答辩就绪 |

---

## 四、四个功能的实现路径

### 4.1 政民互动模块(D8-D9)

**目标**:左侧留言表单(纯前端,sessionStorage 模拟),右侧教育局联系卡片(电话、邮箱、地址、工作时间)。提交留言后实时刷新留言列表。

**数据文件 `data/contacts.json`**:

```json
[
  {
    "contactId": "contact_001",
    "name": "泰安市泰山区教育和体育局(示例)",
    "phone": "0538-0000001",
    "email": "example@taishan.gov.cn",
    "address": "泰安市泰山区示范路 XXX 号(示例)",
    "hours": "工作日 09:00-12:00, 13:30-17:00",
    "type": "主管部门",
    "note": "本信息为示例数据·非官方,实际联系方式以官方公布为准"
  },
  {
    "contactId": "contact_002",
    "name": "招生咨询热线(示例)",
    "phone": "0538-0000002",
    "email": "",
    "address": "",
    "hours": "招生季 09:00-20:00,平时工作日 09:00-17:00",
    "type": "热线",
    "note": "本信息为示例数据·非官方"
  },
  {
    "contactId": "contact_003",
    "name": "学区咨询窗口(示例)",
    "phone": "0538-0000003",
    "email": "",
    "address": "泰安市泰山区原型街 XXX 号政务服务大厅 X 楼 X 号窗口(示例)",
    "hours": "工作日 09:00-17:00",
    "type": "窗口",
    "note": "本信息为示例数据·非官方"
  }
]
```

**HTML 结构**(放在 `index.html` 的 C 区块,FAQ 下面):

```html
<section id="section-interaction" class="mb-4">
  <div class="card section-card">
    <div class="card-header section-header">
      <i class="bi bi-chat-square-dots-fill"></i>政民互动
    </div>
    <div class="card-body">
      <div class="alert alert-info small mb-3">
        <i class="bi bi-info-circle"></i> 本区为示例性互动入口,留言数据仅在本次会话中保存,刷新页面后清空。
        实际线上咨询请通过下方"教育局联系信息"中的官方渠道。
      </div>

      <div class="row g-3">
        <!-- 左:留言表单 -->
        <div class="col-lg-6">
          <h6 class="contact-section-title"><i class="bi bi-pencil-square"></i> 在线留言(示例)</h6>
          <div class="contact-message-form">
            <div class="mb-2">
              <input type="text" id="msgName" class="form-control form-control-sm" placeholder="您的称呼(可选,匿名留言写'匿名')">
            </div>
            <div class="mb-2">
              <select id="msgCategory" class="form-select form-select-sm">
                <option value="入学咨询">入学咨询</option>
                <option value="材料问题">材料问题</option>
                <option value="政策疑问">政策疑问</option>
                <option value="投诉建议">投诉建议</option>
              </select>
            </div>
            <div class="mb-2">
              <textarea id="msgContent" class="form-control form-control-sm" rows="3"
                        placeholder="请描述您的问题或建议(本表单为示例,不会真实提交到任何渠道)" maxlength="200"></textarea>
              <div class="contact-message-counter small text-muted text-end">0/200</div>
            </div>
            <button id="msgSubmitBtn" class="btn btn-primary btn-sm w-100">
              <i class="bi bi-send"></i> 提交留言(示例)
            </button>
          </div>

          <h6 class="contact-section-title mt-3"><i class="bi bi-card-list"></i> 留言列表(本次会话)</h6>
          <div id="messageList" class="contact-message-list"></div>
        </div>

        <!-- 右:联系卡片 -->
        <div class="col-lg-6">
          <h6 class="contact-section-title"><i class="bi bi-telephone-fill"></i> 官方咨询渠道(示例)</h6>
          <div id="contactList" class="contact-card-list"></div>
        </div>
      </div>
    </div>
  </div>
</section>
```

**`js/interactionService.js` 代码骨架**:

```javascript
/* interactionService.js - 政民互动:留言 + 联系卡片 */

window.InteractionService = (function () {

  var STORAGE_KEY = 'sa_messages_v1';
  var _contacts = [];

  function init(data) {
    _contacts = data.contacts || [];
    renderContacts();
    bindMessageForm();
    renderMessages();
  }

  // ===== 联系卡片 =====
  function renderContacts() {
    var el = document.getElementById('contactList');
    if (!el) return;

    if (!_contacts.length) {
      el.innerHTML = '<div class="text-muted small">暂无联系信息</div>';
      return;
    }

    var html = '';
    _contacts.forEach(function (c) {
      html += '<div class="contact-card">';
      html += '<div class="contact-card-header">' +
                '<span class="contact-type-tag">' + c.type + '</span>' +
                '<span class="contact-name">' + c.name + '</span>' +
              '</div>';
      if (c.phone) html += '<div class="contact-row"><i class="bi bi-telephone"></i>' + c.phone + '</div>';
      if (c.email) html += '<div class="contact-row"><i class="bi bi-envelope"></i>' + c.email + '</div>';
      if (c.address) html += '<div class="contact-row"><i class="bi bi-geo-alt"></i>' + c.address + '</div>';
      if (c.hours) html += '<div class="contact-row"><i class="bi bi-clock"></i>' + c.hours + '</div>';
      if (c.note) html += '<div class="contact-note small text-muted">' + c.note + '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  }

  // ===== 留言表单 =====
  function bindMessageForm() {
    var content = document.getElementById('msgContent');
    var counter = document.querySelector('.contact-message-counter');
    var submitBtn = document.getElementById('msgSubmitBtn');

    if (content && counter) {
      content.addEventListener('input', function () {
        counter.textContent = content.value.length + '/200';
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var name = (document.getElementById('msgName').value || '').trim() || '匿名';
        var category = document.getElementById('msgCategory').value;
        var contentText = (document.getElementById('msgContent').value || '').trim();

        if (!contentText) {
          alert('请填写留言内容');
          return;
        }

        var msg = {
          id: Date.now(),
          name: name,
          category: category,
          content: contentText,
          createdAt: new Date().toLocaleString('zh-CN')
        };

        var list = loadMessages();
        list.unshift(msg);
        saveMessages(list);

        // 清空表单
        document.getElementById('msgName').value = '';
        document.getElementById('msgContent').value = '';
        counter.textContent = '0/200';

        renderMessages();

        // 友好提示
        showToast('留言已提交(本会话内有效)');
      });
    }
  }

  // ===== 留言列表 =====
  function renderMessages() {
    var el = document.getElementById('messageList');
    if (!el) return;

    var list = loadMessages();
    if (!list.length) {
      el.innerHTML = '<div class="contact-message-empty">' +
                       '<i class="bi bi-inbox"></i><div>暂无留言,您可以是第一个留言的人</div>' +
                     '</div>';
      return;
    }

    var html = '';
    list.forEach(function (m) {
      html += '<div class="contact-message-item">' +
                '<div class="contact-message-meta">' +
                  '<span class="contact-message-name">' + m.name + '</span>' +
                  '<span class="contact-message-cat">' + m.category + '</span>' +
                  '<span class="contact-message-time">' + m.createdAt + '</span>' +
                '</div>' +
                '<div class="contact-message-content">' + m.content + '</div>' +
              '</div>';
    });
    el.innerHTML = html;
  }

  // ===== sessionStorage 工具 =====
  function loadMessages() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveMessages(list) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('sessionStorage 保存失败');
    }
  }

  // ===== 简易 Toast =====
  function showToast(msg) {
    var toast = document.createElement('div');
    toast.className = 'sa-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('sa-toast-show'); }, 10);
    setTimeout(function () {
      toast.classList.remove('sa-toast-show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2200);
  }

  return { init: init };
})();
```

**CSS**(`.contact-*` 前缀):

```css
.contact-section-title {
  color: var(--primary-color);
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.6rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--border-light);
}

.contact-section-title i {
  color: var(--accent-color);
  margin-right: 0.3rem;
}

/* 留言表单 */
.contact-message-form {
  background: var(--bg-color);
  border-radius: 6px;
  padding: 0.75rem;
}

.contact-message-list {
  max-height: 280px;
  overflow-y: auto;
}

.contact-message-empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 1.5rem 0;
}

.contact-message-empty i {
  font-size: 2rem;
  display: block;
  margin-bottom: 0.5rem;
  opacity: 0.5;
}

.contact-message-item {
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.5rem;
  background: #fff;
}

.contact-message-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
  font-size: 0.75rem;
}

.contact-message-name {
  font-weight: 600;
  color: var(--primary-color);
}

.contact-message-cat {
  background: rgba(240, 160, 75, 0.1);
  color: var(--accent-color);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
}

.contact-message-time {
  color: var(--text-secondary);
  margin-left: auto;
}

.contact-message-content {
  font-size: 0.88rem;
  color: var(--text-primary);
  line-height: 1.6;
}

/* 联系卡片 */
.contact-card {
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.85rem;
  margin-bottom: 0.6rem;
  background: #fff;
  transition: all 0.2s ease;
}

.contact-card:hover {
  border-color: var(--accent-color);
  box-shadow: 0 2px 6px rgba(240, 160, 75, 0.1);
}

.contact-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px dashed var(--border-light);
}

.contact-type-tag {
  font-size: 0.72rem;
  background: var(--primary-color);
  color: #fff;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
}

.contact-name {
  font-weight: 600;
  color: var(--primary-color);
  font-size: 0.92rem;
}

.contact-row {
  font-size: 0.85rem;
  color: var(--text-primary);
  padding: 0.2rem 0;
}

.contact-row i {
  color: var(--accent-color);
  margin-right: 0.4rem;
  width: 1rem;
  display: inline-block;
}

.contact-note {
  margin-top: 0.4rem;
  font-style: italic;
}

/* Toast */
.sa-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--primary-color);
  color: #fff;
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  font-size: 0.9rem;
  box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  opacity: 0;
  transition: all 0.3s ease;
  z-index: 9999;
}

.sa-toast.sa-toast-show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```

**自测清单**:
- [ ] 联系卡片渲染齐全
- [ ] 留言表单字符计数实时
- [ ] 提交后留言出现在列表顶部
- [ ] 刷新后留言依然在(sessionStorage)
- [ ] 关闭标签页后再打开,留言清空(符合 sessionStorage 特性)
- [ ] Toast 提示出现并自动消失

---

### 4.2 入学材料清单增强(D10-D13)

**目标**:每项材料从一个字符串变成富信息卡片,带"模板下载""常见被拒原因""有效期"。

**扩展 `data/materials.json` 的 schema**:

原结构(v0.1):
```json
{
  "group": "本地户籍",
  "description": "...",
  "items": ["户口簿(户主页 + 儿童本人页)", ...]
}
```

新结构(v1.0):
```json
{
  "group": "本地户籍",
  "description": "适用于户籍与家庭实际居住地一致的适龄儿童家庭。建议在报名前 2-3 周开始准备。",
  "items": [
    {
      "name": "户口簿(户主页 + 儿童本人页)",
      "templateUrl": "#",
      "validity": "需在有效期内",
      "commonReasons": [
        "户主页未提供,只提供了儿童页",
        "户口簿信息与房产证不一致(户主不同)",
        "户口簿复印件不清晰(关键信息看不清)"
      ]
    },
    {
      "name": "适龄儿童监护人房产证明",
      "templateUrl": "#",
      "validity": "无固定期限,需为现行有效",
      "commonReasons": [
        "提供的是租赁合同而非产权证明",
        "房产证持有人非父母/法定监护人",
        "房产证明地址与户籍地址完全不一致"
      ]
    },
    {
      "name": "儿童出生医学证明",
      "templateUrl": "#",
      "validity": "终身有效",
      "commonReasons": [
        "出生证遗失未办理补办",
        "出生证信息与户口簿不一致"
      ]
    },
    {
      "name": "预防接种证明",
      "templateUrl": "#",
      "validity": "学龄前接种记录齐全",
      "commonReasons": [
        "接种证遗失",
        "国家免疫规划疫苗未完成"
      ]
    },
    {
      "name": "监护人身份证",
      "templateUrl": "#",
      "validity": "需在有效期内",
      "commonReasons": [
        "身份证已过期",
        "只提供了一方监护人的身份证"
      ]
    }
  ]
}
```

四个分组都按此结构扩展。

**`js/materialService.js` 代码骨架**:

```javascript
/* materialService.js - 入学材料清单(增强版) */

window.MaterialService = (function () {

  var _materials = [];

  function init(data) {
    _materials = data.materials || [];
    render();
  }

  function render() {
    var container = document.getElementById('materialContainer');
    if (!container || !_materials.length) {
      if (container) container.innerHTML = '<div class="text-muted text-center py-3">暂无材料数据</div>';
      return;
    }

    // Tab 头
    var tabsHtml = '<ul class="nav nav-tabs material-tabs mb-3" role="tablist">';
    _materials.forEach(function (m, i) {
      var id = 'matTab_' + i;
      tabsHtml += '<li class="nav-item"><button class="nav-link ' + (i === 0 ? 'active' : '') + '" ' +
                    'data-bs-toggle="tab" data-bs-target="#' + id + '" type="button">' +
                    m.group + '</button></li>';
    });
    tabsHtml += '</ul>';

    // Tab 内容
    var contentHtml = '<div class="tab-content">';
    _materials.forEach(function (m, i) {
      var id = 'matTab_' + i;
      var items = m.items || [];
      contentHtml += '<div class="tab-pane fade ' + (i === 0 ? 'show active' : '') + '" id="' + id + '">';
      contentHtml += '<p class="text-muted small mb-2">' + (m.description || '') + '</p>';
      contentHtml += '<div class="material-progress" data-group-index="' + i + '">已完成 0/' + items.length + ' 项</div>';
      contentHtml += '<div class="mat-items-grid">';
      items.forEach(function (item, j) {
        contentHtml += renderItem(item, i, j);
      });
      contentHtml += '</div></div>';
    });
    contentHtml += '</div>';

    container.innerHTML = tabsHtml + contentHtml;
    bindEvents(container);
  }

  function renderItem(item, groupIndex, itemIndex) {
    var checkboxId = 'mat_chk_' + groupIndex + '_' + itemIndex;
    var detailId = 'mat_detail_' + groupIndex + '_' + itemIndex;

    var html = '<div class="mat-item-card">';

    // 行 1:勾选 + 名称 + 工具按钮
    html += '<div class="mat-item-row">';
    html += '<input class="form-check-input material-checkbox" type="checkbox" id="' + checkboxId + '" data-group-index="' + groupIndex + '">';
    html += '<label class="mat-item-name" for="' + checkboxId + '">' + item.name + '</label>';

    if (item.validity) {
      html += '<span class="mat-validity-tag">' + item.validity + '</span>';
    }

    html += '<div class="mat-item-actions">';
    if (item.templateUrl) {
      html += '<a class="btn btn-sm btn-outline-primary mat-action-btn" href="' + item.templateUrl + '" target="_blank">' +
                '<i class="bi bi-download"></i> 模板</a>';
    }
    if (item.commonReasons && item.commonReasons.length) {
      html += '<button class="btn btn-sm btn-outline-warning mat-action-btn mat-detail-toggle" data-target="' + detailId + '">' +
                '<i class="bi bi-exclamation-circle"></i> 被拒原因</button>';
    }
    html += '</div></div>';

    // 行 2:展开的被拒原因
    if (item.commonReasons && item.commonReasons.length) {
      html += '<div class="mat-reasons-panel" id="' + detailId + '" style="display:none;">';
      html += '<div class="mat-reasons-title"><i class="bi bi-exclamation-triangle"></i> 常见被拒原因(示例)</div>';
      html += '<ul class="mat-reasons-list">';
      item.commonReasons.forEach(function (r) {
        html += '<li>' + r + '</li>';
      });
      html += '</ul></div>';
    }

    html += '</div>';
    return html;
  }

  function bindEvents(container) {
    // 勾选事件
    container.querySelectorAll('.material-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        updateProgress(container, cb.getAttribute('data-group-index'));
      });
    });

    // 展开/收起被拒原因
    container.querySelectorAll('.mat-detail-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var targetId = btn.getAttribute('data-target');
        var panel = document.getElementById(targetId);
        if (!panel) return;
        var isOpen = panel.style.display !== 'none';
        panel.style.display = isOpen ? 'none' : 'block';
        btn.classList.toggle('active', !isOpen);
      });
    });
  }

  function updateProgress(container, groupIndex) {
    var checkboxes = container.querySelectorAll('.material-checkbox[data-group-index="' + groupIndex + '"]');
    var checked = 0;
    checkboxes.forEach(function (cb) { if (cb.checked) checked++; });
    var progressEl = container.querySelector('.material-progress[data-group-index="' + groupIndex + '"]');
    if (progressEl) {
      progressEl.textContent = '已完成 ' + checked + '/' + checkboxes.length + ' 项';
    }
  }

  return { init: init };
})();
```

**CSS**(`.mat-*` 前缀):

```css
.mat-items-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.mat-item-card {
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  background: #fff;
  transition: all 0.2s ease;
}

.mat-item-card:hover {
  border-color: var(--accent-color);
}

.mat-item-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.mat-item-name {
  flex: 1;
  margin: 0;
  font-size: 0.92rem;
  cursor: pointer;
}

.mat-validity-tag {
  font-size: 0.72rem;
  background: rgba(30, 58, 95, 0.08);
  color: var(--primary-color);
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
}

.mat-item-actions {
  display: flex;
  gap: 0.4rem;
}

.mat-action-btn {
  font-size: 0.78rem;
  padding: 0.2rem 0.5rem;
}

.mat-action-btn.active {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
}

.mat-reasons-panel {
  margin-top: 0.6rem;
  padding: 0.6rem 0.85rem;
  background: rgba(240, 160, 75, 0.06);
  border-left: 3px solid var(--accent-color);
  border-radius: 4px;
}

.mat-reasons-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--accent-color);
  margin-bottom: 0.4rem;
}

.mat-reasons-title i { margin-right: 0.25rem; }

.mat-reasons-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.85rem;
  color: var(--text-primary);
  line-height: 1.7;
}
```

**自测清单**:
- [ ] 4 个分组 Tab 切换正常
- [ ] 每项有勾选 + 模板按钮 + 被拒原因按钮(若有)
- [ ] 点击"被拒原因"展开/收起
- [ ] 勾选后进度文字更新
- [ ] 模板下载按钮点击(链接是 `#` 无所谓,只演示)

---

### 4.3 FAQ 增强(D15-D17)

**目标**:在搜索框基础上加分类筛选 chip(横向胶囊按钮),每条 FAQ 末尾显示"相关问题推荐"。

**扩展 `data/faq.json`**(每条加 `faqId` 和 `relatedIds`):

```json
[
  {
    "faqId": "faq_001",
    "question": "如何查询自己家所在的学区?",
    "answer": "可以在地图区点击家庭住址附近的位置,系统会自动判断该位置所属的示例学区,并在右侧结果面板显示对口小学与初中。本页学区数据为示例数据,实际查询请以教育主管部门官方公布为准。",
    "category": "学区查询",
    "relatedIds": ["faq_008", "faq_009"]
  },
  {
    "faqId": "faq_002",
    "question": "义务教育招生的报名时间一般是什么时候?",
    "answer": "...",
    "category": "报名时间",
    "relatedIds": ["faq_003", "faq_006"]
  }
]
```

为已有 10 条都加 `faqId` 和 `relatedIds`(每条挑 1-3 个相关)。

**HTML 结构**(替换原 FAQ 区块):

```html
<section id="section-faq" class="mb-4">
  <div class="card section-card">
    <div class="card-header section-header">
      <i class="bi bi-question-circle-fill"></i>常见问题
    </div>
    <div class="card-body">
      <!-- 搜索框 -->
      <div class="mb-3">
        <div class="input-group">
          <span class="input-group-text"><i class="bi bi-search"></i></span>
          <input type="text" id="faqSearch" class="form-control" placeholder="输入关键词搜索问题或答案">
        </div>
      </div>

      <!-- 分类 chip -->
      <div id="faqChips" class="faq-chip-row mb-3"></div>

      <!-- FAQ 列表 -->
      <div id="faqList"></div>
    </div>
  </div>
</section>
```

**`js/faqService.js` 代码骨架**:

```javascript
/* faqService.js - FAQ 增强版 */

window.FaqService = (function () {

  var _allFaq = [];
  var _activeCategory = '';
  var _searchKeyword = '';

  function init(data) {
    _allFaq = data.faq || [];
    renderChips();
    bindSearch();
    refresh();
  }

  // ===== 分类 chip =====
  function renderChips() {
    var el = document.getElementById('faqChips');
    if (!el) return;

    var categories = uniq(_allFaq.map(function (f) { return f.category; })).filter(Boolean);
    var html = '<span class="faq-chip ' + (!_activeCategory ? 'faq-chip-active' : '') + '" data-cat="">全部</span>';
    categories.forEach(function (c) {
      html += '<span class="faq-chip ' + (_activeCategory === c ? 'faq-chip-active' : '') + '" data-cat="' + c + '">' + c + '</span>';
    });
    el.innerHTML = html;

    el.querySelectorAll('.faq-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        _activeCategory = chip.getAttribute('data-cat') || '';
        renderChips();
        refresh();
      });
    });
  }

  // ===== 搜索 =====
  function bindSearch() {
    var input = document.getElementById('faqSearch');
    if (!input) return;
    input.addEventListener('input', function () {
      _searchKeyword = (input.value || '').trim().toLowerCase();
      refresh();
    });
  }

  // ===== 列表渲染 =====
  function refresh() {
    var filtered = _allFaq.filter(function (f) {
      if (_activeCategory && f.category !== _activeCategory) return false;
      if (_searchKeyword) {
        var q = (f.question || '').toLowerCase();
        var a = (f.answer || '').toLowerCase();
        if (q.indexOf(_searchKeyword) === -1 && a.indexOf(_searchKeyword) === -1) return false;
      }
      return true;
    });

    renderList(filtered);
  }

  function renderList(list) {
    var container = document.getElementById('faqList');
    if (!container) return;

    if (!list || !list.length) {
      container.innerHTML = '<div class="text-muted text-center py-3">未找到相关问题,请尝试其他关键词或分类</div>';
      return;
    }

    var html = '';
    list.forEach(function (f) {
      html += '<div class="faq-item">';
      html += '<div class="faq-question"><i class="bi bi-patch-question-fill"></i>' + (f.question || '—') + '</div>';
      html += '<div class="faq-answer">' + (f.answer || '—') + '</div>';
      if (f.category) {
        html += '<div class="faq-category">' + f.category + '</div>';
      }

      // 相关问题
      var related = (f.relatedIds || [])
        .map(function (id) { return _allFaq.find(function (x) { return x.faqId === id; }); })
        .filter(Boolean);

      if (related.length) {
        html += '<div class="faq-related">';
        html += '<div class="faq-related-title"><i class="bi bi-link-45deg"></i> 相关问题</div>';
        html += '<div class="faq-related-list">';
        related.forEach(function (r) {
          html += '<span class="faq-related-link" data-faq-id="' + r.faqId + '">' + r.question + '</span>';
        });
        html += '</div></div>';
      }

      html += '</div>';
    });
    container.innerHTML = html;

    // 绑定相关问题点击 → 滚动到目标
    container.querySelectorAll('.faq-related-link').forEach(function (link) {
      link.addEventListener('click', function () {
        var targetId = link.getAttribute('data-faq-id');
        scrollToFaq(targetId);
      });
    });
  }

  function scrollToFaq(faqId) {
    // 先确保该 FAQ 可见(清空筛选)
    _activeCategory = '';
    _searchKeyword = '';
    var searchInput = document.getElementById('faqSearch');
    if (searchInput) searchInput.value = '';
    renderChips();
    refresh();

    // 然后滚动并高亮
    setTimeout(function () {
      var items = document.querySelectorAll('.faq-item');
      // 由于 renderList 没给单独 ID,这里做粗略匹配:按文字
      var target = _allFaq.find(function (f) { return f.faqId === faqId; });
      if (!target) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].querySelector('.faq-question').textContent.indexOf(target.question) !== -1) {
          items[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
          items[i].classList.add('faq-highlight');
          setTimeout(function () { items[i].classList.remove('faq-highlight'); }, 1500);
          break;
        }
      }
    }, 100);
  }

  function uniq(arr) {
    var out = [];
    arr.forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
    return out;
  }

  return { init: init };
})();
```

**CSS**(`.faq-*` 前缀):

```css
.faq-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.faq-chip {
  display: inline-block;
  padding: 0.3rem 0.85rem;
  font-size: 0.85rem;
  background: var(--bg-color);
  color: var(--text-primary);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.18s ease;
  border: 1px solid transparent;
}

.faq-chip:hover {
  border-color: var(--accent-color);
}

.faq-chip-active {
  background: var(--primary-color);
  color: #fff;
}

.faq-related {
  margin-top: 0.75rem;
  padding-top: 0.6rem;
  border-top: 1px dashed var(--border-light);
}

.faq-related-title {
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin-bottom: 0.4rem;
}

.faq-related-title i {
  color: var(--accent-color);
  margin-right: 0.25rem;
}

.faq-related-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.faq-related-link {
  font-size: 0.82rem;
  padding: 0.25rem 0.6rem;
  background: rgba(30, 58, 95, 0.05);
  color: var(--primary-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.faq-related-link:hover {
  background: var(--accent-color);
  color: #fff;
}

.faq-highlight {
  animation: faq-pulse 1.5s ease;
}

@keyframes faq-pulse {
  0% { background: rgba(240, 160, 75, 0); }
  30% { background: rgba(240, 160, 75, 0.18); }
  100% { background: rgba(240, 160, 75, 0); }
}
```

**自测清单**:
- [ ] 9 个 chip 横向排列(全部 + 8 个分类)
- [ ] 点击 chip 切换分类,列表刷新
- [ ] 搜索 + 分类可同时生效
- [ ] 每条 FAQ 下方显示 1-3 个相关问题
- [ ] 点击相关问题滚动并高亮目标
- [ ] 无结果时显示友好提示

---

### 4.4 整体 UI 体检(D18-D20)

**目标**:提升页面的"做工感",答辩时演示会显得专业。

**4 个具体改进项**:

#### 1. 加载骨架屏

在数据加载期间,把空白的 loading spinner 升级为"骨架屏"——预先渲染区块的灰色占位框,体感上"看起来已经在加载"。

```html
<!-- 替换原 loadingState -->
<div id="loadingState">
  <div class="container-fluid">
    <!-- 卡片骨架 -->
    <div class="row g-3 mb-4">
      <div class="col-6 col-md-3"><div class="sk-card sk-shimmer"></div></div>
      <div class="col-6 col-md-3"><div class="sk-card sk-shimmer"></div></div>
      <div class="col-6 col-md-3"><div class="sk-card sk-shimmer"></div></div>
      <div class="col-6 col-md-3"><div class="sk-card sk-shimmer"></div></div>
    </div>
    <!-- 地图骨架 -->
    <div class="row g-3">
      <div class="col-lg-8"><div class="sk-map sk-shimmer"></div></div>
      <div class="col-lg-4"><div class="sk-panel sk-shimmer"></div></div>
    </div>
  </div>
</div>
```

```css
.sk-card { height: 120px; border-radius: 8px; }
.sk-map  { height: 560px; border-radius: 8px; }
.sk-panel { height: 560px; border-radius: 8px; }

.sk-shimmer {
  background: linear-gradient(90deg, #e9ecef 25%, #f5f7fa 50%, #e9ecef 75%);
  background-size: 200% 100%;
  animation: sk-shimmer 1.4s linear infinite;
}

@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

#### 2. 错误状态美化

把原 `errorState` 改为更友好的样式:

```html
<div id="errorState" style="display:none;">
  <div class="sa-error-card">
    <i class="bi bi-cloud-slash"></i>
    <h5>数据加载失败</h5>
    <p id="errorStateMsg"></p>
    <p class="small text-muted">通常是因为直接双击了 index.html。请通过 HTTP 服务运行,例如:</p>
    <code>python -m http.server 5500</code>
  </div>
</div>
```

```css
.sa-error-card {
  text-align: center;
  padding: 3rem 2rem;
  background: #fff;
  border-radius: 8px;
  border: 2px dashed #dc3545;
  margin: 2rem auto;
  max-width: 600px;
}

.sa-error-card i {
  font-size: 3rem;
  color: #dc3545;
  margin-bottom: 1rem;
}

.sa-error-card code {
  display: inline-block;
  background: #f5f7fa;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  margin-top: 0.5rem;
}
```

#### 3. 响应式微调

在不同断点下检查并修复:

| 断点 | 检查点 | 修复 |
|---|---|---|
| ≥ 992px | 地图与面板左右排列 | 确保面板不被压扁(min-width) |
| 768-991px | 地图变全宽,面板移到下方 | 地图高度调到 400px |
| < 768px | 卡片 4 列 → 2 列 | stats-section 改成 col-6 |
| < 576px | 导航栏品牌字过小 | 字号略减,badge 缩小 |

#### 4. 微交互动画

少量、克制地加点过渡效果:

- 卡片 hover 时阴影加深(已有,确认效果到位)
- 按钮 hover 时背景渐变
- chip 切换时淡入淡出
- 模拟器结果出现时滑入

注意:不允许炫技,**所有动画时长 ≤ 0.3s**,避免拖沓。

**自测清单**:
- [ ] 桌面 / 平板 / 手机三个尺寸都看一遍
- [ ] 慢网络(Chrome DevTools 限速到 Slow 3G)下骨架屏出现
- [ ] 故意改坏 zones.geojson 路径,看错误状态
- [ ] 卡片 hover、chip 切换都有合适过渡

---

## 五、与其他角色的对接接口

| 接口 | 我提供 | 对方使用 | 数据形式 |
|---|---|---|---|
| FAQ 中提到的学区/学校名 | `faq.json` 中的 answer 文本 | A 可能在 FAQ 答案里加"在地图上查看"链接 | 文本 |
| 整体 CSS 变量微调 | `:root` 里 | A、B 都依赖,改前必须群里确认 | CSS 变量 |
| 加载/错误状态 | `loadingState`、`errorState` 区块 | main.js 在 catch 里调用 | DOM 元素 |

**我可能需要 A、B 的协助**:
- **A**:如果 FAQ 答案要加"在地图上查看 zone_003"链接,需要 `MapService.flyToZoneById`
- **B**:如果留言分类要加"模拟器问题"选项,需要确认是否与模拟器关联

---

## 六、自测清单(每周末过一遍)

### W1 末尾
- [ ] `feature/C-interaction` 分支已推送
- [ ] materials.json、faq.json、contacts.json 三个文件就位
- [ ] 三个 service 文件骨架到位
- [ ] index.html 加了 3 个 section 占位

### W2 末尾
- [ ] 留言表单工作,提交后出现在列表
- [ ] 联系卡片显示完整
- [ ] 材料卡片有模板按钮 + 被拒原因展开

### W3 末尾
- [ ] FAQ chip 切换分类正常
- [ ] 相关问题点击滚动 + 高亮
- [ ] 骨架屏在慢网络下出现
- [ ] 错误状态美化完成

### W4 末尾
- [ ] Bug 全关闭
- [ ] 手机真机测试通过
- [ ] 演示流程顺畅

---

## 七、答辩演示词(1.5 分钟,自己讲)

> "我负责的部分是'互动与内容',目标是把家长'看完就走'变成'能留言、能下载、能找到答案、感受舒服'。
>
> 首先是**入学材料清单**[切到材料区,展开一个分组]。每项材料不只是一个文字,而是带'模板下载''有效期''常见被拒原因'。比如这条'户口簿',点击'被拒原因'[演示],展开常见三种被拒情况。这直接解决了选题报告里提到的'材料办理被拒,白跑一趟'的痛点。
>
> 然后是 **FAQ 增强**[切到 FAQ 区]。我们做了横向分类筛选[演示切换 chip],搜索和筛选可以叠加使用。每条问题下方有'相关问题'推荐[演示点击],点击会平滑滚动并高亮到目标问题,形成知识图谱式的浏览体验。
>
> 第三是**政民互动**[切到互动区]。左边是留言表单——为了不引起'真的能反馈'的误解,我们在 UI 上反复强调'本会话内有效',并通过 sessionStorage 实现。右边是教育局示例联系卡片,把电话、邮箱、地址、工作时间格式化展示。
>
> 最后是整体的 UI 体检——加载时有骨架屏[刷新页面演示],错误时有友好提示[演示报错截图]。我也针对手机和平板做了响应式适配[演示移动端]。
>
> 这一块的核心思路是:**让示例原型在演示时显得专业、稳重、可信**,这对'政务服务'类项目尤其重要,因为家长信任感是这种产品最稀缺的资源。"

---

## 八、AI-IDE 使用建议

**好用场景**:
1. 让 AI 帮你扩写 materials.json 的 `commonReasons`(给一两个示例,让它续写)
2. 让 AI 帮你写 FAQ 的 `relatedIds` 关联(给一份 FAQ 列表,让它推荐每条的相关)
3. 让 AI 帮你设计骨架屏的 CSS 动画(关键词:shimmer effect Tailwind)
4. 让 AI 帮你做响应式 media query 的检查

**容易翻车的场景**:
1. **AI 会建议用 localStorage** 持久化留言:务必使用 sessionStorage,因为这是示例原型,留言不应跨会话
2. **AI 容易过度设计**:它会想给留言加"点赞""回复""举报"等功能——你只需要"提交+展示"够答辩演示就行
3. **AI 容易引入 jQuery**:坚持 Vanilla JS
4. **AI 会改全局 CSS 变量** 来调一个细节:用 `.mat-*`、`.faq-*` 前缀的局部样式覆盖即可,不要动 `:root`

**推荐 prompt 模板**:
```
我在做智慧入学项目的互动内容模块,纯前端 Vanilla JS,使用 Bootstrap 5.3.2。
当前文件:js/faqService.js
需求:[具体功能]
约束:
- 暴露 window.FaqService = { init }
- 不使用 import/export、不使用 jQuery
- CSS 类名必须使用 .faq-* 前缀
- 留言数据用 sessionStorage,不用 localStorage
- 字段名严格按照 data-schema.md
请只生成这个文件的代码,不要改其他文件。
```

---

## 九、特别提醒:你是"答辩印象分"的关键

A 和 B 做的功能再强,如果整体页面看起来粗糙、加载时白屏、错误时报错乱跳,答辩印象分会被拉低。

**你的工作的本质是**:让别人觉得这个项目"做得很认真,即使是阶段性原型"。

**重点关注**:
- 任何文字都不能有错别字
- 任何按钮 hover 都有视觉反馈
- 任何空状态都有友好提示(不是空白)
- 任何分割线都对齐
- 任何颜色都符合设计规范

---

**祝顺利。三人协作中,你是最需要"细心"的角色。**
