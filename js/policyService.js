/* policyService.js - 政策渲染与对比 */

window.PolicyService = (function () {
  var _policies = [];
  var _diffs = [];
  var _currentFilter = { category: null, year: null };
  var _isExpanded = false;
  var _MAX_DISPLAY = 6;

  function init(data) {
    _policies = data.policies || [];
    _diffs = data.policyDiff || [];

    renderPolicies(_policies);
    renderFilters();
    setupDiffView();
  }

  function renderPolicies(list) {
    var container = document.getElementById('policyList');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="text-muted text-center py-4">暂无政策数据</div>';
      return;
    }

    var sortedList = list.slice().sort(function(a, b) {
      if (b.year !== a.year) return b.year - a.year;
      return new Date(b.publishDate) - new Date(a.publishDate);
    });

    var displayList = _isExpanded ? sortedList : sortedList.slice(0, _MAX_DISPLAY);
    var hasMore = sortedList.length > _MAX_DISPLAY;

    var html = '<div class="row g-3" id="policyCards">';
    displayList.forEach(function (p) {
      var categoryClass = getCategoryClass(p.category);
      var isExternalLink = p.url && p.url !== '#' && p.url.startsWith('http');
      var linkTarget = isExternalLink ? ' target="_blank" rel="noopener noreferrer"' : '';
      var linkIcon = isExternalLink ? ' <i class="bi bi-box-arrow-up-right text-primary" style="font-size:0.7em;"></i>' : '';
      html += '<div class="col-md-6 col-lg-4">';
      html += '<div class="policy-card" ' + (isExternalLink ? 'style="cursor:pointer;" onclick="window.open(\'' + p.url + '\', \'_blank\')"' : '') + '>';
      html += '<div class="policy-card-header">';
      html += '<span class="policy-year-badge">' + p.year + '年</span>';
      html += '<span class="policy-category-badge ' + categoryClass + '">' + p.category + '</span>';
      html += '</div>';
      html += '<h6 class="policy-card-title">' + p.title + linkIcon + '</h6>';
      html += '<p class="policy-card-summary">' + p.summary + '</p>';
      html += '<div class="policy-card-footer">';
      html += '<small class="text-muted"><i class="bi bi-calendar3"></i> ' + p.publishDate + '</small>';
      html += '<small class="text-muted"><i class="bi bi-building"></i> ' + p.source + '</small>';
      if (isExternalLink) {
        html += '<a href="' + p.url + '" class="policy-link-btn"' + linkTarget + ' onclick="event.stopPropagation();"><i class="bi bi-link-45deg"></i>查看原文</a>';
      }
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    if (hasMore) {
      var remainingCount = sortedList.length - _MAX_DISPLAY;
      html += '<div class="text-center mt-4">';
      html += '<button id="toggleExpandBtn" class="btn btn-outline-primary">';
      html += _isExpanded
        ? '<i class="bi bi-chevron-up"></i> 收起（共' + sortedList.length + '个）'
        : '<i class="bi bi-chevron-down"></i> 展开更多（还有' + remainingCount + '个）';
      html += '</button>';
      html += '</div>';
    }

    container.innerHTML = html;

    if (hasMore) {
      document.getElementById('toggleExpandBtn').addEventListener('click', function() {
        _isExpanded = !_isExpanded;
        renderPolicies(list);
      });
    }
  }

  function getCategoryClass(category) {
    var map = {
      '招生政策': 'category-policy',
      '报名流程': 'category-flow',
      '材料要求': 'category-material',
      '随迁子女': 'category-migrant',
      '政策提醒': 'category-notice'
    };
    return map[category] || 'category-default';
  }

  function renderFilters() {
    var container = document.getElementById('policyFilters');
    if (!container) return;

    var categories = ['招生政策', '报名流程', '材料要求', '随迁子女', '政策提醒'];
    var years = [2026, 2025, 2024, 2023, 2022];

    var html = '<div class="col-md-6">';
    html += '<label class="form-label small text-muted">按分类筛选</label>';
    html += '<select id="filterCategory" class="form-select">';
    html += '<option value="">全部分类</option>';
    categories.forEach(function (c) {
      html += '<option value="' + c + '">' + c + '</option>';
    });
    html += '</select></div>';

    html += '<div class="col-md-6">';
    html += '<label class="form-label small text-muted">按年份筛选</label>';
    html += '<select id="filterYear" class="form-select">';
    html += '<option value="">全部年份</option>';
    years.forEach(function (y) {
      html += '<option value="' + y + '">' + y + '年</option>';
    });
    html += '</select></div>';

    container.innerHTML = html;

    document.getElementById('filterCategory').addEventListener('change', applyFilters);
    document.getElementById('filterYear').addEventListener('change', applyFilters);
  }

  function applyFilters() {
    var category = document.getElementById('filterCategory').value;
    var year = document.getElementById('filterYear').value;

    var filtered = _policies.filter(function (p) {
      if (category && p.category !== category) return false;
      if (year && String(p.year) !== String(year)) return false;
      return true;
    });

    _isExpanded = false;
    renderPolicies(filtered);
  }

  function setupDiffView() {
    var selA = document.getElementById('diffYearA');
    var selB = document.getElementById('diffYearB');
    if (!selA || !selB) return;

    var years = uniq(_policies.map(function (p) { return p.year; }))
                  .sort(function (a, b) { return b - a; });

    var options = years.map(function (y) {
      return '<option value="' + y + '">' + y + '年</option>';
    }).join('');

    selA.innerHTML = options;

    if (years.length >= 2) {
      selA.value = years[1];
      updateYearBOptions();
    }

    selA.addEventListener('change', function() {
      updateYearBOptions();
      updateDiff();
    });
    selB.addEventListener('change', updateDiff);

    updateDiff();
  }

  function updateYearBOptions() {
    var selA = document.getElementById('diffYearA');
    var selB = document.getElementById('diffYearB');
    if (!selA || !selB) return;

    var selectedYearA = parseInt(selA.value);
    var years = uniq(_policies.map(function (p) { return p.year; }))
                  .sort(function (a, b) { return b - a; });

    // 只允许相邻年份：yearA ± 1
    var adjacentYears = years.filter(function(y) {
      return Math.abs(y - selectedYearA) === 1;
    });

    selB.innerHTML = adjacentYears.map(function (y) {
      return '<option value="' + y + '">' + y + '年</option>';
    }).join('');

    if (adjacentYears.length > 0) {
      selB.value = adjacentYears[0];
    }
  }

  function updateDiff() {
    var yA = parseInt(document.getElementById('diffYearA').value);
    var yB = parseInt(document.getElementById('diffYearB').value);
    var resultEl = document.getElementById('policyDiffResult');

    if (!yA || !yB) {
      resultEl.innerHTML = '<div class="text-muted text-center py-3">请选择两个年份进行对比</div>';
      return;
    }

    if (yA === yB) {
      resultEl.innerHTML = '<div class="text-muted text-center py-3">请选择两个不同的年份进行对比</div>';
      return;
    }

    // 确保只允许逐年对比（年份差为1）
    if (Math.abs(yA - yB) !== 1) {
      resultEl.innerHTML = '<div class="text-muted text-center py-3">请选择相邻年份进行逐年对比</div>';
      return;
    }

    var diff = _diffs.find(function (d) {
      return (d.yearA === yA && d.yearB === yB) || (d.yearA === yB && d.yearB === yA);
    });

    if (!diff) {
      resultEl.innerHTML = '<div class="text-muted text-center py-3">暂无' + yA + '年与' + yB + '年的对比数据</div>';
      return;
    }

    var swap = (diff.yearA !== yA);
    var changes = diff.diffPoints.filter(function (p) { return p.isChange; });
    var unchanged = diff.diffPoints.filter(function (p) { return !p.isChange; });

    var html = '';

    if (changes.length > 0) {
      html += '<div class="diff-summary-bar">';
      html += '<span class="diff-summary-icon"><i class="bi bi-lightning-charge-fill"></i></span>';
      html += '<span>共 <strong>' + changes.length + '</strong> 项政策变化</span>';
      html += '</div>';
      html += '<div class="diff-cards">';
      changes.forEach(function (p) {
        var vA = swap ? p.valueB : p.valueA;
        var vB = swap ? p.valueA : p.valueB;
        html += '<div class="diff-card">';
        html += '<div class="diff-card-topic"><i class="bi bi-tag-fill"></i>' + p.topic + '</div>';
        html += '<div class="diff-card-body">';
        html += '<div class="diff-card-side diff-card-old">';
        html += '<span class="diff-card-year">' + yA + '</span>';
        html += '<span class="diff-card-val">' + vA + '</span>';
        html += '</div>';
        html += '<div class="diff-card-arrow"><i class="bi bi-arrow-right"></i></div>';
        html += '<div class="diff-card-side diff-card-new">';
        html += '<span class="diff-card-year">' + yB + '</span>';
        html += '<span class="diff-card-val">' + vB + '</span>';
        html += '</div>';
        html += '</div>';
        if (p.changeNote) {
          html += '<div class="diff-card-note"><i class="bi bi-info-circle"></i>' + p.changeNote + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    if (unchanged.length > 0) {
      html += '<details class="diff-unchanged-details">';
      html += '<summary><i class="bi bi-check-circle"></i>未变化项（' + unchanged.length + '项）</summary>';
      html += '<div class="diff-unchanged-list">';
      unchanged.forEach(function (p) {
        html += '<div class="diff-unchanged-item"><i class="bi bi-dash-circle"></i><span>' + p.topic + '</span><span class="text-muted">' + (swap ? p.valueB : p.valueA) + '</span></div>';
      });
      html += '</div>';
      html += '</details>';
    }

    resultEl.innerHTML = html;
  }

  function uniq(arr) {
    var out = [];
    arr.forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
    return out;
  }

  return {
    init: init,
    renderPolicies: renderPolicies,
    renderFilters: renderFilters,
    applyFilters: applyFilters,
  };
})();
