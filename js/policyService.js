/**
 * policyService.js - 政策渲染与年度对比服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 渲染招生政策列表(支持分类/年份双向筛选和展开收起),
 *       提供政策年度对比视图,展示相邻年份间的政策变化点。
 *
 * 关键接口:
 *   init(data) - 初始化,接收 { policies: Array, policyDiff: Array }
 *
 * 数据格式:
 *   policy = { policyId, title, year, category, source, publishDate, summary, url }
 *   policyDiff = { yearA, yearB, diffPoints: [{ topic, valueA, valueB, isChange, changeNote }] }
 */
window.PolicyService = (() => {
  let _policies = [];
  let _diffs = [];
  let _currentFilter = { category: null, year: null };
  let _isExpanded = false;
  const _MAX_DISPLAY = 6;

  /** 初始化:存储数据并渲染政策列表、筛选器和对比视图 */
  const init = (data) => {
    _policies = data.policies || [];
    _diffs = data.policyDiff || [];

    renderPolicies(_policies);
    renderFilters();
    setupDiffView();
  };

  /** 渲染政策卡片列表,按年份和发布日期降序排列,默认显示前6条可展开 */
  const renderPolicies = (list) => {
    const container = document.getElementById("policyList");
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = `<div class="text-muted text-center py-4">暂无政策数据</div>`;
      return;
    }

    const sortedList = list.slice().sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return new Date(b.publishDate) - new Date(a.publishDate);
    });

    const displayList = _isExpanded
      ? sortedList
      : sortedList.slice(0, _MAX_DISPLAY);
    const hasMore = sortedList.length > _MAX_DISPLAY;

    let html = `<div class="row g-3" id="policyCards">`;
    displayList.forEach((p) => {
      const categoryClass = getCategoryClass(p.category);
      const isExternalLink =
        p.url && p.url !== "#" && p.url.indexOf("http") === 0;
      const linkTarget = isExternalLink
        ? ` target="_blank" rel="noopener noreferrer"`
        : "";
      const linkIcon = isExternalLink
        ? ` <i class="bi bi-box-arrow-up-right text-primary" style="font-size:0.7em;"></i>`
        : "";
      html += `<div class="col-md-6 col-lg-4">`;
      html +=
        `<div class="policy-card" ` +
        (isExternalLink
          ? `style="cursor:pointer;" onclick="window.open('${p.url}', '_blank')"`
          : "") +
        `>`;
      html += `<div class="policy-card-header">`;
      html += `<span class="policy-year-badge">${p.year}年</span>`;
      html += `<span class="policy-category-badge ${categoryClass}">${p.category}</span>`;
      html += `</div>`;
      html += `<h6 class="policy-card-title">${p.title}${linkIcon}</h6>`;
      html += `<p class="policy-card-summary">${p.summary}</p>`;
      html += `<div class="policy-card-footer">`;
      html += `<small class="text-muted"><i class="bi bi-calendar3"></i> ${p.publishDate}</small>`;
      html += `<small class="text-muted"><i class="bi bi-building"></i> ${p.source}</small>`;
      if (isExternalLink) {
        html += `<a href="${p.url}" class="policy-link-btn"${linkTarget} onclick="event.stopPropagation();"><i class="bi bi-link-45deg"></i>查看原文</a>`;
      }
      html += `</div>`;
      html += `</div>`;
      html += `</div>`;
    });
    html += `</div>`;

    if (hasMore) {
      const remainingCount = sortedList.length - _MAX_DISPLAY;
      html += `<div class="text-center mt-4">`;
      html += `<button id="toggleExpandBtn" class="btn btn-outline-primary">`;
      html += _isExpanded
        ? `<i class="bi bi-chevron-up"></i> 收起（共${sortedList.length}个）`
        : `<i class="bi bi-chevron-down"></i> 展开更多（还有${remainingCount}个）`;
      html += `</button>`;
      html += `</div>`;
    }

    container.innerHTML = html;

    if (hasMore) {
      document
        .getElementById("toggleExpandBtn")
        .addEventListener("click", () => {
          _isExpanded = !_isExpanded;
          renderPolicies(list);
        });
    }
  };

  /** 获取政策分类对应的 CSS 类名 */
  const getCategoryClass = (category) => {
    const map = {
      招生政策: "category-policy",
      报名流程: "category-flow",
      材料要求: "category-material",
      随迁子女: "category-migrant",
      政策提醒: "category-notice",
    };
    return map[category] || "category-default";
  };

  /** 渲染分类和年份筛选下拉框,绑定 change 事件 */
  const renderFilters = () => {
    const container = document.getElementById("policyFilters");
    if (!container) return;

    const categories = [
      "招生政策",
      "报名流程",
      "材料要求",
      "随迁子女",
      "政策提醒",
    ];
    const years = [2026, 2025, 2024, 2023, 2022];

    let html = `<div class="col-md-6">`;
    html += `<label class="form-label small text-muted">按分类筛选</label>`;
    html += `<select id="filterCategory" class="form-select">`;
    html += `<option value="">全部分类</option>`;
    categories.forEach((c) => {
      html += `<option value="${c}">${c}</option>`;
    });
    html += `</select></div>`;

    html += `<div class="col-md-6">`;
    html += `<label class="form-label small text-muted">按年份筛选</label>`;
    html += `<select id="filterYear" class="form-select">`;
    html += `<option value="">全部年份</option>`;
    years.forEach((y) => {
      html += `<option value="${y}">${y}年</option>`;
    });
    html += `</select></div>`;

    container.innerHTML = html;

    document
      .getElementById("filterCategory")
      .addEventListener("change", applyFilters);
    document
      .getElementById("filterYear")
      .addEventListener("change", applyFilters);
  };
  /** 应用分类和年份筛选,更新政策列表 */

  /** 应用筛选条件并重新渲染政策列表 */
  const applyFilters = () => {
    const category = document.getElementById("filterCategory").value;
    const year = document.getElementById("filterYear").value;

    const filtered = _policies.filter((p) => {
      if (category && p.category !== category) return false;
      if (year && String(p.year) !== String(year)) return false;
      return true;
    });

    _isExpanded = false;
    /** 初始化对比视图:填充年份选择框,设置事件监听 */
    renderPolicies(filtered);
  };

  /** 初始化政策年度对比视图:填充年份选择器并绑定事件 */
  const setupDiffView = () => {
    const selA = document.getElementById("diffYearA");
    const selB = document.getElementById("diffYearB");
    if (!selA || !selB) return;

    const years = uniq(_policies.map((p) => p.year)).sort((a, b) => b - a);

    const options = years
      .map((y) => `<option value="${y}">${y}年</option>`)
      .join("");

    selA.innerHTML = options;

    if (years.length >= 2) {
      selA.value = years[1];
      updateYearBOptions();
    }

    selA.addEventListener("change", () => {
      updateYearBOptions();
      updateDiff();
    });
    selB.addEventListener("change", updateDiff);

    updateDiff();
  };

  /** 根据基准年份A更新对比年份B的选项(仅允许相邻年份) */
  const updateYearBOptions = () => {
    const selA = document.getElementById("diffYearA");
    const selB = document.getElementById("diffYearB");
    if (!selA || !selB) return;

    const selectedYearA = parseInt(selA.value);
    const years = uniq(_policies.map((p) => p.year)).sort((a, b) => b - a);

    const adjacentYears = years.filter(
      (y) => Math.abs(y - selectedYearA) === 1,
    );

    selB.innerHTML = adjacentYears
      .map((y) => `<option value="${y}">${y}年</option>`)
      .join("");

    if (adjacentYears.length > 0) {
      selB.value = adjacentYears[0];
    }
  };

  /** 渲染政策对比结果:展示变化项和未变化项 */
  const updateDiff = () => {
    const yA = parseInt(document.getElementById("diffYearA").value);
    const yB = parseInt(document.getElementById("diffYearB").value);
    const resultEl = document.getElementById("policyDiffResult");

    if (!yA || !yB) {
      resultEl.innerHTML = `<div class="text-muted text-center py-3">请选择两个年份进行对比</div>`;
      return;
    }

    if (yA === yB) {
      resultEl.innerHTML = `<div class="text-muted text-center py-3">请选择两个不同的年份进行对比</div>`;
      return;
    }

    if (Math.abs(yA - yB) !== 1) {
      resultEl.innerHTML = `<div class="text-muted text-center py-3">请选择相邻年份进行逐年对比</div>`;
      return;
    }

    const diff = _diffs.find(
      (d) =>
        (d.yearA === yA && d.yearB === yB) ||
        (d.yearA === yB && d.yearB === yA),
    );

    if (!diff) {
      resultEl.innerHTML = `<div class="text-muted text-center py-3">暂无${yA}年与${yB}年的对比数据</div>`;
      return;
    }

    const swap = diff.yearA !== yA;
    const changes = diff.diffPoints.filter((p) => p.isChange);
    const unchanged = diff.diffPoints.filter((p) => !p.isChange);

    let html = "";

    if (changes.length > 0) {
      html += `<div class="diff-summary-bar">`;
      html += `<span class="diff-summary-icon"><i class="bi bi-lightning-charge-fill"></i></span>`;
      html += `<span>共 <strong>${changes.length}</strong> 项政策变化</span>`;
      html += `</div>`;
      html += `<div class="diff-cards">`;
      changes.forEach((p) => {
        const vA = swap ? p.valueB : p.valueA;
        const vB = swap ? p.valueA : p.valueB;
        html += `<div class="diff-card">`;
        html += `<div class="diff-card-topic"><i class="bi bi-tag-fill"></i>${p.topic}</div>`;
        html += `<div class="diff-card-body">`;
        html += `<div class="diff-card-side diff-card-old">`;
        html += `<span class="diff-card-year">${yA}</span>`;
        html += `<span class="diff-card-val">${vA}</span>`;
        html += `</div>`;
        html += `<div class="diff-card-arrow"><i class="bi bi-arrow-right"></i></div>`;
        html += `<div class="diff-card-side diff-card-new">`;
        html += `<span class="diff-card-year">${yB}</span>`;
        html += `<span class="diff-card-val">${vB}</span>`;
        html += `</div>`;
        html += `</div>`;
        if (p.changeNote) {
          html += `<div class="diff-card-note"><i class="bi bi-info-circle"></i>${p.changeNote}</div>`;
        }
        html += `</div>`;
      });
      html += `</div>`;
    }

    if (unchanged.length > 0) {
      html += `<details class="diff-unchanged-details">`;
      html += `<summary><i class="bi bi-check-circle"></i>未变化项（${unchanged.length}项）</summary>`;
      html += `<div class="diff-unchanged-list">`;
      unchanged.forEach((p) => {
        html += `<div class="diff-unchanged-item"><i class="bi bi-dash-circle"></i><span>${p.topic}</span><span class="text-muted">${swap ? p.valueB : p.valueA}</span></div>`;
      });
      html += `</div>`;
      html += `</details>`;
    }

    resultEl.innerHTML = html;
  };

  /** 数组去重工具函数 */
  const uniq = (arr) => {
    const out = [];
    arr.forEach((v) => {
      if (!out.includes(v)) out.push(v);
    });
    return out;
  };

  /** 公共接口 */
  return {
    init,
  };
})();
