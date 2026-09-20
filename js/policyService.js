/**
 * policyService.js - 政策渲染与年度对比服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 渲染招生政策列表(支持分类/年份双向筛选和展开收起),
 *       提供政策年度对比视图,展示相邻年份间的政策变化点,
 *       政策搜索、收藏、统计概览、时间线、辟谣模块。
 *
 * 关键接口:
 *   init(data) - 初始化,接收 { policies, policyDiff, rumors }
 *
 * 数据格式:
 *   policy = { policyId, title, year, category, source, publishDate, summary, url }
 *   policyDiff = { yearA, yearB, diffPoints: [{ topic, valueA, valueB, isChange, changeNote }] }
 *   rumor = { rumorId, rumor, truth, category, source }
 */
window.PolicyService = (() => {
  let _policies = [];
  let _diffs = [];
  let _currentFilter = { category: null, year: null, keyword: null };
  let _isExpanded = false;
  const _MAX_DISPLAY = 6;

  /** 初始化:存储数据并渲染政策列表、筛选器和对比视图 */
  const init = (data) => {
    _policies = data.policies || [];
    _diffs = data.policyDiff || [];

    renderStats();
    renderPolicies(_policies);
    renderFilters();
    setupDiffView();
    setupSearch();
  };

  // ==================== 政策统计概览 ====================

  /** 渲染政策统计概览：按分类和年份的条形统计 */
  const renderStats = () => {
    const container = document.getElementById("policyStats");
    if (!container) return;

    const categories = ["招生政策", "报名流程", "材料要求", "随迁子女", "政策提醒"];
    const years = uniq(_policies.map((p) => p.year)).sort((a, b) => b - a);

    const categoryColors = {
      "招生政策": "#8B0000",
      "报名流程": "#e67e22",
      "材料要求": "#28a745",
      "随迁子女": "#c9a227",
      "政策提醒": "#6c757d",
    };

    const catCounts = categories.map((c) => _policies.filter((p) => p.category === c).length);
    const maxCatCount = Math.max(...catCounts, 1);

    let html = `<div class="policy-stats-bar">`;
    html += `<div class="policy-stats-title"><i class="bi bi-bar-chart-fill"></i> 政策分布概览（共${_policies.length}条）</div>`;
    html += `<div class="policy-stats-row">`;
    categories.forEach((c, i) => {
      const pct = Math.round((catCounts[i] / maxCatCount) * 100);
      const color = categoryColors[c] || "#6c757d";
      html += `<div class="policy-stats-item">`;
      html += `<div class="policy-stats-label">${c}</div>`;
      html += `<div class="policy-stats-bar-track"><div class="policy-stats-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
      html += `<div class="policy-stats-count">${catCounts[i]}</div>`;
      html += `</div>`;
    });
    html += `</div>`;

    html += `<div class="policy-stats-year-row">`;
    years.forEach((y) => {
      const count = _policies.filter((p) => p.year === y).length;
      html += `<span class="policy-stats-year-chip">${y}年 <strong>${count}</strong>条</span>`;
    });
    html += `</div>`;
    html += `</div>`;

    container.innerHTML = html;
  };

  // ==================== 政策搜索 ====================

  /** 初始化政策搜索功能 */
  const setupSearch = () => {
    const input = document.getElementById("policySearchInput");
    const clearBtn = document.getElementById("policySearchClearBtn");
    if (!input) return;

    let debounceTimer = null;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const keyword = input.value.trim();
        _currentFilter.keyword = keyword || null;
        if (clearBtn) clearBtn.style.display = keyword ? "inline-block" : "none";
        applyFilters();
      }, 300);
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        _currentFilter.keyword = null;
        clearBtn.style.display = "none";
        applyFilters();
      });
    }
  };

  // ==================== 政策列表渲染 ====================

  /** 渲染政策卡片列表,按年份和发布日期降序排列,默认显示前6条可展开 */
  const renderPolicies = (list) => {
    const container = document.getElementById("policyList");
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = `<div class="text-muted text-center py-4"><i class="bi bi-inbox"></i> 暂无匹配的政策数据</div>`;
      return;
    }

    const safe = window.RenderService.safeText;
    const safeU = window.RenderService.safeUrl;

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
      const linkIcon = isExternalLink
        ? ` <i class="bi bi-box-arrow-up-right text-primary" style="font-size:0.7em;"></i>`
        : "";
      html += `<div class="col-md-6 col-lg-4">`;
      html += `<div class="policy-card"${isExternalLink ? ` data-policy-url="${safeU(p.url)}" style="cursor:pointer;"` : ""}>`;
      html += `<div class="policy-card-header">`;
      html += `<span class="policy-year-badge">${safe(p.year)}年</span>`;
      html += `<span class="policy-category-badge ${categoryClass}">${safe(p.category)}</span>`;
      html += `</div>`;
      html += `<h6 class="policy-card-title">${safe(p.title)}${linkIcon}</h6>`;
      html += `<p class="policy-card-summary">${safe(p.summary)}</p>`;
      html += `<div class="policy-card-footer">`;
      html += `<small class="text-muted"><i class="bi bi-calendar3"></i> ${safe(p.publishDate)}</small>`;
      html += `<small class="text-muted"><i class="bi bi-building"></i> ${safe(p.source)}</small>`;
      if (isExternalLink) {
        html += `<a href="${safeU(p.url)}" class="policy-link-btn" target="_blank" rel="noopener noreferrer"><i class="bi bi-link-45deg"></i>查看原文</a>`;
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

    // 绑定卡片点击跳转
    container
      .querySelectorAll(".policy-card[data-policy-url]")
      .forEach((card) => {
        card.addEventListener("click", (e) => {
          if (e.target.closest(".policy-link-btn")) return;
          window.open(card.dataset.policyUrl, "_blank");
        });
      });

    // 绑定展开/收起按钮
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
    const years = uniq(_policies.map((p) => p.year)).sort((a, b) => b - a);

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

  /** 应用筛选条件并重新渲染政策列表 */
  const applyFilters = () => {
    const category = document.getElementById("filterCategory").value;
    const year = document.getElementById("filterYear").value;
    const keyword = _currentFilter.keyword;

    const filtered = _policies.filter((p) => {
      if (category && p.category !== category) return false;
      if (year && String(p.year) !== String(year)) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        const matchTitle = (p.title || "").toLowerCase().includes(kw);
        const matchSummary = (p.summary || "").toLowerCase().includes(kw);
        const matchSource = (p.source || "").toLowerCase().includes(kw);
        if (!matchTitle && !matchSummary && !matchSource) return false;
      }
      return true;
    });

    _isExpanded = false;
    renderPolicies(filtered);
  };

  // ==================== 政策年度对比（逐年相邻） ====================

  /** 初始化政策年度对比视图：右侧只显示相邻年份，无预定义数据时自动分析生成 */
  const setupDiffView = () => {
    const selA = document.getElementById("diffYearA");
    const selB = document.getElementById("diffYearB");
    if (!selA || !selB) return;

    const years = uniq(_policies.map((p) => p.year)).sort((a, b) => a - b);

    // 左侧：所有年份
    selA.innerHTML = years
      .map((y) => `<option value="${y}">${y}年</option>`)
      .join("");

    // 右侧：根据左侧选择联动更新
    const updateSelB = () => {
      const yA = parseInt(selA.value);
      const next = years.filter((y) => y === yA + 1);
      if (next.length > 0) {
        selB.innerHTML = `<option value="${next[0]}">${next[0]}年</option>`;
      } else {
        selB.innerHTML = `<option value="" disabled>无可对比年份</option>`;
      }
    };

    selA.addEventListener("change", () => {
      updateSelB();
      updateDiff();
    });
    selB.addEventListener("change", updateDiff);

    // 默认选中最新一对
    if (years.length >= 2) {
      selA.value = years[years.length - 2];
      updateSelB();
      updateDiff();
    }
  };

  /** 自动分析政策数据，生成两个年份间的对比点 */
  const generateDiffFromPolicies = (yA, yB) => {
    const policiesA = _policies.filter((p) => p.year === yA);
    const policiesB = _policies.filter((p) => p.year === yB);

    const diffPoints = [];
    const allCategories = uniq([...policiesA.map((p) => p.category), ...policiesB.map((p) => p.category)]);

    allCategories.forEach((cat) => {
      const itemsA = policiesA.filter((p) => p.category === cat);
      const itemsB = policiesB.filter((p) => p.category === cat);

      if (itemsA.length === 0 && itemsB.length > 0) {
        // 新增类别
        itemsB.forEach((p) => {
          diffPoints.push({
            topic: p.title,
            valueA: "无",
            valueB: p.title,
            isChange: true,
            changeNote: `${yB}年新增${cat}相关政策`,
          });
        });
      } else if (itemsB.length === 0 && itemsA.length > 0) {
        // 移除的类别
        itemsA.forEach((p) => {
          diffPoints.push({
            topic: p.title,
            valueA: p.title,
            valueB: "无",
            isChange: true,
            changeNote: `${yB}年未延续该政策`,
          });
        });
      } else {
        // 两年度都有，逐一匹配
        const matchedB = new Set();
        itemsA.forEach((pA) => {
          // 尝试在B中找标题最相似的政策
          const bestMatch = itemsB.reduce(
            (best, pB) => {
              if (matchedB.has(pB.policyId)) return best;
              const sim = titleSimilarity(pA.title, pB.title);
              return sim > best.sim ? { pB, sim } : best;
            },
            { pB: null, sim: 0 },
          );

          if (bestMatch.pB && bestMatch.sim > 0.3) {
            matchedB.add(bestMatch.pB.policyId);
            const isChange = bestMatch.sim < 0.7 || pA.summary !== bestMatch.pB.summary;
            diffPoints.push({
              topic: pA.title,
              valueA: pA.title,
              valueB: bestMatch.pB.title,
              isChange,
              changeNote: isChange ? "政策内容有所调整" : "政策延续",
            });
          } else {
            diffPoints.push({
              topic: pA.title,
              valueA: pA.title,
              valueB: "无",
              isChange: true,
              changeNote: `${yB}年未延续该政策`,
            });
          }
        });

        // B中未匹配到的为新增
        itemsB.forEach((pB) => {
          if (!matchedB.has(pB.policyId)) {
            diffPoints.push({
              topic: pB.title,
              valueA: "无",
              valueB: pB.title,
              isChange: true,
              changeNote: `${yB}年新增`,
            });
          }
        });
      }
    });

    return diffPoints;
  };

  /** 计算两个标题的相似度（基于词重叠） */
  const titleSimilarity = (t1, t2) => {
    if (!t1 || !t2) return 0;
    // 提取关键词（2字及以上）
    const words1 = new Set(t1.match(/[\u4e00-\u9fa5]{2,}/g) || []);
    const words2 = new Set(t2.match(/[\u4e00-\u9fa5]{2,}/g) || []);
    if (words1.size === 0 || words2.size === 0) return 0;
    let overlap = 0;
    words1.forEach((w) => {
      if (words2.has(w)) overlap++;
    });
    return overlap / Math.max(words1.size, words2.size);
  };

  /** 渲染政策对比结果：优先使用预定义diff，无则自动生成 */
  const updateDiff = () => {
    const yA = parseInt(document.getElementById("diffYearA").value);
    const yB = parseInt(document.getElementById("diffYearB").value);
    const resultEl = document.getElementById("policyDiffResult");

    if (!yA || !yB) {
      resultEl.innerHTML = `<div class="text-muted text-center py-3">请选择对比年份</div>`;
      return;
    }

    if (yA === yB) {
      resultEl.innerHTML = `<div class="text-muted text-center py-3"><i class="bi bi-info-circle"></i> 请选择不同年份进行对比</div>`;
      return;
    }

    let diff = _diffs.find(
      (d) =>
        (d.yearA === yA && d.yearB === yB) ||
        (d.yearA === yB && d.yearB === yA),
    );

    // 无预定义diff时自动生成
    let diffPoints;
    if (!diff) {
      diffPoints = generateDiffFromPolicies(yA, yB);
    } else {
      diffPoints = diff.diffPoints;
    }

    const changes = diffPoints.filter((p) => p.isChange);
    const unchanged = diffPoints.filter((p) => !p.isChange);
    const safe = window.RenderService.safeText;

    let html = "";

    if (!diff) {
      html += `<div class="auto-generated-badge"><i class="bi bi-magic"></i> 自动分析生成</div>`;
    }

    if (changes.length > 0) {
      html += `<div class="diff-summary-bar">`;
      html += `<span class="diff-summary-icon"><i class="bi bi-lightning-charge-fill"></i></span>`;
      html += `<span>共 <strong>${changes.length}</strong> 项政策变化</span>`;
      html += `</div>`;
      html += `<div class="diff-cards">`;
      changes.forEach((p) => {
        const vA = diff && diff.yearA !== yA ? p.valueB : p.valueA;
        const vB = diff && diff.yearA !== yA ? p.valueA : p.valueB;
        html += `<div class="diff-card">`;
        html += `<div class="diff-card-topic"><i class="bi bi-tag-fill"></i>${safe(p.topic)}</div>`;
        html += `<div class="diff-card-body">`;
        html += `<div class="diff-card-side diff-card-old">`;
        html += `<span class="diff-card-year">${yA}</span>`;
        html += `<span class="diff-card-val">${safe(vA)}</span>`;
        html += `</div>`;
        html += `<div class="diff-card-arrow"><i class="bi bi-arrow-right"></i></div>`;
        html += `<div class="diff-card-side diff-card-new">`;
        html += `<span class="diff-card-year">${yB}</span>`;
        html += `<span class="diff-card-val">${safe(vB)}</span>`;
        html += `</div>`;
        html += `</div>`;
        if (p.changeNote) {
          html += `<div class="diff-card-note"><i class="bi bi-info-circle"></i>${safe(p.changeNote)}</div>`;
        }
        html += `</div>`;
      });
      html += `</div>`;
    } else {
      html += `<div class="diff-no-change"><i class="bi bi-check-circle-fill d-block"></i>两年政策无重大变化</div>`;
    }

    if (unchanged.length > 0) {
      html += `<details class="diff-unchanged-details">`;
      html += `<summary><i class="bi bi-check-circle"></i>未变化项（${unchanged.length}项）</summary>`;
      html += `<div class="diff-unchanged-list">`;
      unchanged.forEach((p) => {
        const val = diff && diff.yearA !== yA ? p.valueB : p.valueA;
        html += `<div class="diff-unchanged-item"><i class="bi bi-dash-circle"></i><span>${safe(p.topic)}</span><span class="text-muted">${safe(val)}</span></div>`;
      });
      html += `</div>`;
      html += `</details>`;
    }

    resultEl.innerHTML = html;
  };

  // ==================== 工具函数 ====================

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
