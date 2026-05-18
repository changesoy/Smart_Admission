# 角色 A · 地图与查询工程师 — 任务清单与实现路径

> 你负责让"找到自己家学区"这件事变得快速、准确、可追溯。
> 同时建议你担任组长,因为你的模块改动最多,对整体最熟悉。

---

## 一、角色定位

**核心使命**:把"点击地图查询"升级为"多维度查询 + 历史可追溯 + 多视图可切换"的完整 GIS 体验。

**关键产出**(W4 末尾应有):
1. 学区数量从 5 个扩展到 10-15 个,使用泰山区真实道路名称作为边界参考
2. 关键词检索框,输入小区/路名即可定位学区
3. 图层切换控件(矢量底图 ↔ 影像底图)
4. 学区历年调整 timeline(在结果面板内)

---

## 二、你的专属文件

| 类型 | 文件路径 | 状态 |
|---|---|---|
| 数据 | `data/zones.geojson` | 扩展(从 5 个 Feature → 10-15 个) |
| 数据 | `data/zones_history.json` | **新增** |
| 数据 | `data/keywords_index.json` | **新增** |
| 代码 | `js/mapService.js` | 扩展(加图层切换 + 历史 timeline 调用) |
| 代码 | `js/searchService.js` | **新增** |

**你会动到的共享文件**(改前在群里喊一声):
- `index.html` 的 `<!-- ========== A: 地图查询区 ========== -->` 区块
- `js/config.js` 加 `searchConfig`、`tianditu.layers` 等
- `js/dataService.js` 注册新数据文件路径
- `js/main.js` 加 `SearchService.init(data)` 调用
- `css/style.css` 加 `.map-*`、`.zone-*`、`.search-*` 前缀的样式

---

## 三、4 周时间表

### Week 1(D1-D7)· 准备与脚手架

| 日 | 任务 | 产出 |
|---|---|---|
| D1 | (组长职责)创建 GitHub 仓库,push v0.1 代码到 main,配置三人权限 | 仓库就绪 |
| D1 | 主持 4 小时数据 schema 闭门会议,产出 `docs/data-schema.md` | schema 文档 |
| D2 | 创建 `feature/A-map` 分支 | 分支就绪 |
| D2 | 把 `render.js` 中地图相关代码移到 `mapService.js`,其他人对应模块也要做 | 拆分完成 |
| D3 | 起草 `zones_history.json`(每个学区填 2-3 年假数据,先跑通格式) | 数据文件草稿 |
| D3 | 起草 `keywords_index.json`(每个学区先填 3-5 个关键词) | 数据文件草稿 |
| D4 | 创建 `js/searchService.js` 空壳,暴露 `init(data)`,加到 `main.js` | 骨架就绪 |
| D4-D5 | `index.html` 加入搜索框 + 图层切换控件占位 | UI 区块出现 |
| D5 | **里程碑 M1**:与 B/C 第一次集成,跑通页面 | 整体可运行 |
| D6-D7 | M1 集成问题修复,准备 W2 实质开发 | bug 清零 |

### Week 2(D8-D14)· 核心开发 1

| 日 | 任务 | 实现要点 |
|---|---|---|
| D8-D10 | **学区扩展**:基于 PDF 里的真实道路名,把 5 个 Polygon 扩到 10-15 个 | 见下文 4.1 |
| D11-D13 | **关键词检索**:输入框 → 过滤匹配 → 地图飞行 + 高亮 | 见下文 4.2 |
| D14 | 自测 + push,**里程碑 M2** | 视频/截图存档 |

### Week 3(D15-D21)· 核心开发 2

| 日 | 任务 | 实现要点 |
|---|---|---|
| D15-D17 | **图层切换控件**:矢量 ↔ 影像 | 见下文 4.3 |
| D18-D20 | **学区历年调整 timeline**:点击学区后在结果面板显示历史 | 见下文 4.4 |
| D21 | 端到端测试 + Bug 列表,**里程碑 M3** | 测试报告 |

### Week 4(D22-D28)· 收尾

| 日 | 任务 |
|---|---|
| D22-D24 | Bug 修复 + 性能调优(地图加载、检索响应) |
| D25 | 协助组长(自己)更新 README.md |
| D26 | 录屏(地图相关 3 分钟片段) |
| D27 | 答辩演练 3 次 |
| D28 | **里程碑 M4** · 答辩就绪 |

---

## 四、四个功能的实现路径

### 4.1 学区扩展(D8-D10)

**目标**:从 5 个示例学区扩到 10-15 个,Polygon 边界使用 PDF 里的真实道路名称。

**学校选取建议**(从 PDF 提取的典型学区):

| 序号 | 真实学校(参考) | 在系统中命名为 | 边界关键道路 |
|---|---|---|---|
| 1 | 泰安实验学校 | 泰山区示范第一小学 | 渿河东路、金山西街、擂鼓石大街、红门路、环山路、虎山路、岱庙北街 |
| 2 | 第六中学 | 泰山区原型实验初中 | 虎山路、岱宗大街、梳洗河、环山路、红门路、东岳大街、校场街、通天街 |
| 3 | 泰山学院附属中学 | 泰山区示范第二初中 | 擂鼓石大街、龙潭路、泰山大桥、岱宗大街 |
| 4 | 东岳中学(小学部) | 泰山区原型第三小学 | 唐王河、北上高大街、温泉路、东岳大街、岱道庵路、擂鼓石大街 |
| 5 | 南关中学 | 泰山区阶段路初中 | 泮河大街、泰良路、泰辛铁路、迎春西路、灵山大街、顺河街、财源街 |
| 6 | 望岳中学 | 泰山区示意第四小学 | 致富路、佳苑路、长城路、灵山大街 |
| 7 | 迎春学校(小学部) | 泰山区原型第五小学 | 灵山大街、迎春路、辛泰铁路、迎春西路 |
| 8 | 第二实验学校 | 泰山区上高第六小学 | 博阳路、谢过城大街、天烛峰路、东岳大街东段 |
| 9 | 凤台学校(小学部) | 泰山区凤台第七小学 | 北上高大街、东湖路、唐王河、天烛峰路 |
| 10 | 万官路学校(小学部) | 泰山区万官第八小学 | 万官大街、堰东路、长城路、梅山东路 |

**学校命名规则**(继续遵守 v0.1 约定):
- 仍使用"泰山区示范XX小学/初中"等示例化命名
- 电话仍使用 `0538-XXXXXXX` 占位格式
- **但 description 字段可以引用真实道路名**,例如:
  > "东至梳洗河,西至虎山路,南至东岳大街,北至环山路。覆盖红门片区核心居住区。"

**Polygon 绘制方法**:

不需要做到真实坐标 100% 准确,**示意性贴近即可**。三种工具任选:

1. **手工**:打开 https://geojson.io,在地图上画 Polygon,右侧自动生成 GeoJSON 复制即可
2. **AI 辅助**:让 AI-IDE 根据"东至 XX 路,西至 YY 路"的描述,在泰安市地理范围内生成 5-8 个 Polygon 坐标点
3. **批量调整**:从 v0.1 的 5 个 Polygon 入手,逐个微调形状 + 复制 5 份重定位

**坐标范围约束**:
- 经度:`117.10—117.20`(泰山区主城区)
- 纬度:`36.16—36.23`
- 互不重叠
- 留 1-2 处空隙演示"未匹配"提示
- Polygon 闭合(首尾点相同),5-10 个点足够

**zones.geojson 完整结构**(每个 Feature):

```json
{
  "type": "Feature",
  "properties": {
    "zoneId": "zone_001",
    "zoneName": "泰山区示范第一小学学区",
    "primarySchoolId": "school_p_001",
    "middleSchoolId": "school_m_001",
    "description": "东至梳洗河,西至虎山路,南至东岳大街,北至环山路。",
    "year": 2025,
    "policyIds": ["policy_2025_001", "policy_2025_002"]
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lng,lat], [lng,lat], ..., [lng,lat]]]
  }
}
```

**自测清单**:
- [ ] 10-15 个 Polygon 全部渲染,无报错
- [ ] 点击每个都能高亮 + 显示结果
- [ ] 在 https://geojson.io 把整个 zones.geojson 粘进去,目测无重叠
- [ ] 同步更新 `schools.json`(每个新学区都要有对口学校)

---

### 4.2 关键词检索(D11-D13)

**目标**:输入框输入"示范小区""红门路""擂鼓石"→ 实时过滤建议列表 → 点击或回车 → 地图飞到该学区 + 高亮 + 显示结果。

**数据文件 `data/keywords_index.json`**:

```json
[
  { "keyword": "示范小区", "matchedZoneId": "zone_001", "type": "小区" },
  { "keyword": "红门路", "matchedZoneId": "zone_001", "type": "道路" },
  { "keyword": "梳洗河", "matchedZoneId": "zone_001", "type": "河流" },
  { "keyword": "原型新村", "matchedZoneId": "zone_002", "type": "小区" },
  { "keyword": "虎山路", "matchedZoneId": "zone_002", "type": "道路" }
]
```

每个学区建议填 5-8 个关键词,共 50-100 条。

**HTML 结构**(放在 `index.html` 的 A 区块,地图卡片上方):

```html
<section id="section-search" class="mb-3">
  <div class="card section-card">
    <div class="card-body py-2">
      <div class="input-group">
        <span class="input-group-text bg-white border-end-0">
          <i class="bi bi-search"></i>
        </span>
        <input type="text" id="searchInput" class="form-control border-start-0"
               placeholder="输入小区、街道、路名查询学区(如:红门路、示范小区)">
        <button id="searchClearBtn" class="btn btn-outline-secondary" style="display:none;">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div id="searchSuggestions" class="search-suggestions" style="display:none;"></div>
    </div>
  </div>
</section>
```

**`js/searchService.js` 代码骨架**:

```javascript
/* searchService.js - 关键词检索服务 */

window.SearchService = (function () {

  var _keywords = [];
  var _zones = null;
  var _onZoneMatched = null;

  // 入口
  function init(data) {
    _keywords = data.keywords || [];
    _zones = data.zones;

    bindEvents();
  }

  // 暴露给 main.js 设置回调
  function setOnZoneMatched(fn) {
    _onZoneMatched = fn;
  }

  function bindEvents() {
    var input = document.getElementById('searchInput');
    var clearBtn = document.getElementById('searchClearBtn');
    var suggestionsEl = document.getElementById('searchSuggestions');

    if (!input) return;

    input.addEventListener('input', function () {
      var kw = (input.value || '').trim();
      clearBtn.style.display = kw ? 'block' : 'none';

      if (!kw) {
        suggestionsEl.style.display = 'none';
        return;
      }

      var matches = filterKeywords(kw);
      renderSuggestions(matches);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var matches = filterKeywords(input.value.trim());
        if (matches.length > 0) flyToZone(matches[0].matchedZoneId);
      }
    });

    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.style.display = 'none';
      suggestionsEl.style.display = 'none';
    });
  }

  // 按关键词过滤(includes 匹配,不区分大小写)
  function filterKeywords(kw) {
    var lower = kw.toLowerCase();
    return _keywords.filter(function (k) {
      return k.keyword.toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 8); // 最多 8 条建议
  }

  // 渲染建议下拉
  function renderSuggestions(matches) {
    var el = document.getElementById('searchSuggestions');
    if (!matches || matches.length === 0) {
      el.innerHTML = '<div class="search-no-result">未找到匹配结果</div>';
      el.style.display = 'block';
      return;
    }

    var html = '';
    matches.forEach(function (m) {
      html += '<div class="search-suggestion-item" data-zone-id="' + m.matchedZoneId + '">' +
                '<span class="search-type-tag">' + m.type + '</span>' +
                '<span class="search-keyword">' + m.keyword + '</span>' +
              '</div>';
    });
    el.innerHTML = html;
    el.style.display = 'block';

    // 绑定点击
    el.querySelectorAll('.search-suggestion-item').forEach(function (item) {
      item.addEventListener('click', function () {
        flyToZone(item.getAttribute('data-zone-id'));
        document.getElementById('searchInput').value = item.querySelector('.search-keyword').textContent;
        el.style.display = 'none';
      });
    });
  }

  // 飞到学区(调 MapService 暴露的方法)
  function flyToZone(zoneId) {
    if (typeof _onZoneMatched === 'function') {
      _onZoneMatched(zoneId);
    }
  }

  return {
    init: init,
    setOnZoneMatched: setOnZoneMatched
  };
})();
```

**MapService 需新增的方法**(在 `mapService.js` 加):

```javascript
// 暴露给 SearchService 调用
function flyToZoneById(zoneId) {
  var entry = _zoneLayers.find(function (e) {
    return e.feature.properties.zoneId === zoneId;
  });
  if (!entry) return;

  _map.flyToBounds(entry.layer.getBounds(), { padding: [40, 40], duration: 0.8 });
  selectLayer(entry.layer, entry.feature);
}

// 在 return 的对象里加
return {
  initMap: initMap,
  flyToZoneById: flyToZoneById  // 新增
};
```

**main.js 串联**:

```javascript
SearchService.init(data);
SearchService.setOnZoneMatched(function (zoneId) {
  MapService.flyToZoneById(zoneId);
});
```

**自测清单**:
- [ ] 输入"红"应该出现"红门路"等建议
- [ ] 点击建议项,地图平滑飞到对应学区,学区高亮
- [ ] 回车键直接定位到第一条匹配
- [ ] 清空按钮工作正常
- [ ] 无匹配时显示"未找到匹配结果"

---

### 4.3 图层切换控件(D15-D17)

**目标**:右上角加一个图层切换按钮组,点击可在"矢量底图""影像底图""矢量+影像混合"之间切换。

**前置工作**:`config.js` 里 `tianditu` 部分已经预留了 `imgUrl` 和 `ciaUrl`,可以直接用。

**实现思路**(使用 Leaflet 的 `L.control.layers`):

```javascript
// 在 mapService.js 的 initMap 中,替换原来的 loadTiandituBaseLayers

function setupBaseLayers(map) {
  var td = window.AppConfig.tianditu;

  function tiandituLayer(urlTemplate, opts) {
    opts = opts || {};
    return L.tileLayer(buildTiandituUrl(urlTemplate, td.token), {
      subdomains: td.subdomains,
      attribution: opts.attribution || td.attribution,
      maxZoom: 18
    });
  }

  // 矢量底图
  var vecLayer = tiandituLayer(td.vecUrl);
  var cvaLayer = tiandituLayer(td.cvaUrl, { attribution: '' });

  // 影像底图
  var imgLayer = tiandituLayer(td.imgUrl);
  var ciaLayer = tiandituLayer(td.ciaUrl, { attribution: '' });

  // 图层组(底图 + 注记一起切换)
  var vecGroup = L.layerGroup([vecLayer, cvaLayer]);
  var imgGroup = L.layerGroup([imgLayer, ciaLayer]);

  // 默认加载矢量
  vecGroup.addTo(map);

  // 添加图层切换控件
  L.control.layers(
    {
      '矢量底图': vecGroup,
      '影像底图': imgGroup
    },
    null,
    { position: 'topright', collapsed: false }
  ).addTo(map);
}
```

**自定义样式**(`style.css` 加):

```css
.leaflet-control-layers {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  padding: 8px 12px;
  border: 1px solid var(--border-light);
}

.leaflet-control-layers label {
  font-size: 0.85rem;
  color: var(--text-primary);
}
```

**自测清单**:
- [ ] 控件出现在右上角
- [ ] 切换到影像底图,瓦片正常加载
- [ ] 切换后学区 Polygon 仍正确显示
- [ ] 控件不遮挡地图操作

---

### 4.4 学区历年调整 timeline(D18-D20)

**目标**:点击学区后,结果面板下方加一个 timeline,展示该学区过去 3 年的调整记录。

**数据文件 `data/zones_history.json`**:

```json
[
  {
    "zoneId": "zone_001",
    "history": [
      {
        "year": 2023,
        "change": "原始划分",
        "description": "初次设立泰山区示范第一小学学区,东至梳洗河,西至虎山路。"
      },
      {
        "year": 2024,
        "change": "东边界外扩",
        "description": "因人口增长,东边界从梳洗河西岸调整至梳洗河东岸,新增 2 个小区纳入。"
      },
      {
        "year": 2025,
        "change": "维持现状",
        "description": "2025 年学区范围与 2024 年保持一致,无调整。"
      }
    ]
  }
]
```

每个学区填 2-4 条历史记录。

**渲染逻辑**(扩展 `render.js` 的 `renderResult`,或者直接在 `mapService.js` 触发回调时多带一个参数):

最干净的做法是,在 `main.js` 的 `onZoneSelected` 回调里同时把 history 数据传过去:

```javascript
// main.js
MapService.initMap({
  zones: data.zones,
  schools: data.schools,
  policies: data.policies,
  onZoneSelected: function (feature) {
    var zoneId = feature.properties.zoneId;
    var historyEntry = (data.zonesHistory || []).find(function (h) {
      return h.zoneId === zoneId;
    });

    RenderService.renderResult({
      zoneFeature: feature,
      schools: data.schools,
      policies: data.policies,
      history: historyEntry ? historyEntry.history : []  // 新增
    });
  },
  onNoMatch: function () { RenderService.renderNoMatch(); }
});
```

**`render.js` 的 `renderResult` 末尾追加**:

```javascript
// 在原有的关联政策渲染之后追加
if (ctx.history && ctx.history.length > 0) {
  html += '<div class="result-section-title">历年调整记录</div>';
  html += '<div class="zone-history-timeline">';
  ctx.history.forEach(function (h) {
    html += '<div class="zone-history-item">' +
              '<div class="zone-history-year">' + h.year + '</div>' +
              '<div class="zone-history-body">' +
                '<div class="zone-history-change">' + h.change + '</div>' +
                '<div class="zone-history-desc">' + h.description + '</div>' +
              '</div>' +
            '</div>';
  });
  html += '</div>';
}
```

**CSS**(`.zone-*` 前缀,放心写):

```css
.zone-history-timeline {
  position: relative;
  padding-left: 1.5rem;
  border-left: 2px solid var(--border-light);
  margin-top: 0.5rem;
}

.zone-history-item {
  position: relative;
  margin-bottom: 0.75rem;
}

.zone-history-item::before {
  content: '';
  position: absolute;
  left: -1.85rem;
  top: 0.25rem;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent-color);
  box-shadow: 0 0 0 2px #fff;
}

.zone-history-year {
  font-weight: 600;
  color: var(--primary-color);
  font-size: 0.9rem;
}

.zone-history-change {
  font-size: 0.85rem;
  color: var(--text-primary);
  margin-top: 0.15rem;
}

.zone-history-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.15rem;
  line-height: 1.5;
}
```

**自测清单**:
- [ ] 点击学区,timeline 出现在结果面板底部
- [ ] 年份倒序或正序显示(自己选,但要一致)
- [ ] 没有历史数据时不显示这个 section
- [ ] 视觉上不与其他 section 冲突

---

## 五、与其他角色的对接接口

| 接口 | 我提供 | 对方使用 | 数据形式 |
|---|---|---|---|
| `zone_id → 跳转到该学区` | `MapService.flyToZoneById(zoneId)` | B 的模拟器输出推荐学区时,可以加"在地图上查看"按钮 | 函数 |
| `keywords 数据` | `data/keywords_index.json` | C 可能在 FAQ 答案里需要引用学区 | JSON |
| `zones 数据` | `data/zones.geojson` | B 的政策对比可能需要按学区分组 | JSON |

**给 B 的接口示例**:
```javascript
// B 的 simulatorService.js 里
document.getElementById('viewOnMapBtn').addEventListener('click', function () {
  window.MapService.flyToZoneById('zone_003');
  // 滚动到地图区
  document.getElementById('section-map').scrollIntoView({ behavior: 'smooth' });
});
```

---

## 六、自测清单(每周末过一遍)

### W1 末尾
- [ ] 仓库创建,三人有 push 权限
- [ ] `docs/data-schema.md` 已 commit
- [ ] `feature/A-map` 分支已推送
- [ ] `index.html` 加了搜索框 + 图层切换占位

### W2 末尾
- [ ] 10-15 个学区 Polygon 全部加载无报错
- [ ] 每个学区点击都有结果
- [ ] 搜索框输入"红""示范"等都有建议
- [ ] 点击建议地图飞到该学区

### W3 末尾
- [ ] 图层切换按钮工作,矢量/影像都能加载
- [ ] 任一学区点击都显示 timeline(没数据则隐藏)

### W4 末尾
- [ ] 所有 Bug 关闭
- [ ] 演示流程跑通无卡顿
- [ ] 录屏完成

---

## 七、答辩演示词(1.5 分钟,自己讲)

> "我负责系统的地图与查询模块。我们用 Leaflet 加载天地图作为底图,基于 Turf.js 在前端直接做点面判断,不需要后端。
>
> 数据扩展上,我们把示例学区从最初的 5 个增加到 [N] 个,使用泰山区主城区真实道路名作为边界参考,比如这个 [演示点击]泰山区示范第一小学学区,它的边界'东至梳洗河、西至虎山路、南至东岳大街、北至环山路',就来自泰山区教育局公开发布的学区划分材料。
>
> 在查询方式上,除了点击,我还做了关键词检索 [演示]——输入'红门路'就能匹配到对应学区,地图平滑飞过去并高亮。这背后是 keywords_index.json 提供的小区/路名到 zoneId 的映射。
>
> 用户还可以切换地图视图 [演示]——从矢量底图切到影像底图,在影像图上能清楚看到学区与实际建筑物的对应关系。
>
> 最后,点击学区后下方有历年调整 timeline [演示],把这个学区近 3 年的边界调整、原因都列出来,做到了'信息可追溯',这是回应选题报告里提的痛点'历史政策无统一归档,新老政策对比困难'。
>
> 整套地图模块的核心技术价值是:**全部基于前端 + 静态 GeoJSON**,迁移到其他城市只要换数据文件,代码零修改。"

---

## 八、AI-IDE 使用建议(针对你的工作)

**好用场景**:
1. 让 AI 帮你按"东至 X 路、西至 Y 路"的描述生成 Polygon 坐标点(给它一个泰安市的大致坐标范围作为约束)
2. 让 AI 帮你写 keywords_index.json 的批量数据(给它学区列表 + 5 个示范关键词,让它续写)
3. 让 AI 帮你调试 Leaflet 控件样式

**容易翻车的场景**:
1. **AI 容易乱改坐标顺序**:每次让它写 GeoJSON,提醒它"经度在前、纬度在后"
2. **AI 容易引入 ES Module**:看到 `import L from 'leaflet'` 立刻拒绝,Leaflet 是全局变量 `L`
3. **AI 容易擅自加防抖/节流**:搜索框 input 事件本来就够快,加防抖反而卡;明确告诉它"不要加 debounce"
4. **AI 容易把 `var` 改成 `const/let`**:我们项目用 `var` 保持风格统一,改前问一句

**推荐 prompt 模板**:
```
我在做智慧入学项目的地图模块,纯前端 Vanilla JS,使用 Leaflet 1.9.4 + Turf 6.5.0。
当前文件:js/searchService.js
需求:[具体功能]
约束:
- 暴露 window.SearchService = { init, setOnZoneMatched }
- 不使用 import/export
- 字段名严格使用 zoneId、matchedZoneId,不要改
- 不要添加新的 npm 依赖
请只生成这个文件的代码,不要改其他文件。
```

---

## 九、组长额外职责

因为你担任组长,除了本人模块外还要:

1. **每周一次集成日**:周五下午合并三人代码到 main,跑一遍,出问题立即拉群解决
2. **守护共享文件**:`main.js`、`config.js`、`dataService.js` 的合并由你最终把关
3. **看不见的工作**:维护 README.md、协调 PR review、管理 GitHub Issues
4. **答辩时**:总览陈述,负责开场和收尾(各 1 分钟,加上自己 1.5 分钟个人陈述,合计 3.5 分钟)

---

**祝顺利。有不清楚的接口,在群里 @ 我(指 AI 协作者),随时迭代。**
