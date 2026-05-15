/* render.js - 渲染服务(所有 DOM 渲染逻辑集中在此) */

window.RenderService = (function () {
  // 缓存当前 FAQ 全量,供搜索过滤
  var _allFaq = [];

  // ========== 数据概览卡片 ==========
  function renderStats(data) {
    var row = document.getElementById("statsRow");
    if (!row) return;

    var stats = [
      {
        icon: "bi-geo-alt-fill",
        label: "示例学区",
        number:
          data.zones && data.zones.features ? data.zones.features.length : 0,
      },
      {
        icon: "bi-building",
        label: "示例学校",
        number: (data.schools || []).length,
      },
      {
        icon: "bi-file-earmark-text-fill",
        label: "招生政策",
        number: (data.policies || []).length,
      },
      {
        icon: "bi-question-circle-fill",
        label: "常见问题",
        number: (data.faq || []).length,
      },
    ];

    var html = "";
    stats.forEach(function (s) {
      html +=
        '<div class="col-6 col-md-3">' +
        '<div class="stat-card">' +
        '<div class="stat-icon"><i class="bi ' +
        s.icon +
        '"></i></div>' +
        '<div class="stat-number">' +
        s.number +
        "</div>" +
        '<div class="stat-label">' +
        s.label +
        "</div>" +
        "</div>" +
        "</div>";
    });
    row.innerHTML = html;
  }

  // ========== 结果面板:默认提示 ==========
  function renderDefaultResultTip() {
    var panel = document.getElementById("resultPanel");
    if (!panel) return;
    panel.innerHTML =
      '<div class="result-tip">' +
      '<i class="bi bi-cursor-fill"></i>' +
      "<div>" +
      window.AppConfig.texts.defaultResultTip +
      "</div>" +
      "</div>";
  }

  // ========== 结果面板:未匹配提示 ==========
  function renderNoMatch() {
    var panel = document.getElementById("resultPanel");
    if (!panel) return;
    panel.innerHTML =
      '<div class="result-tip">' +
      '<i class="bi bi-question-diamond-fill"></i>' +
      "<div>" +
      window.AppConfig.texts.noMatchTip +
      "</div>" +
      "</div>";
  }

  // ========== 结果面板:学区详情 ==========
  // ctx = { zoneFeature, schools, policies }
  function renderResult(ctx) {
    var panel = document.getElementById("resultPanel");
    if (!panel) return;

    var feature = ctx && ctx.zoneFeature;
    if (!feature || !feature.properties) {
      panel.innerHTML = '<div class="result-tip"><div>暂无学区数据</div></div>';
      return;
    }
    var props = feature.properties;

    var primary = (ctx.schools || []).find(function (s) {
      return s.schoolId === props.primarySchoolId;
    });
    var middle = (ctx.schools || []).find(function (s) {
      return s.schoolId === props.middleSchoolId;
    });

    var policyIds = props.policyIds || [];
    var relatedPolicies = (ctx.policies || []).filter(function (p) {
      return policyIds.indexOf(p.policyId) !== -1;
    });

    var html = "";
    html +=
      '<div class="result-zone-name"><i class="bi bi-bookmark-fill text-warning"></i> ' +
      (props.zoneName || "—") +
      "</div>";
    html +=
      '<div class="text-muted small mb-2">学区年份:' +
      (props.year || "—") +
      "</div>";

    html += '<div class="result-section-title">招生范围说明</div>';
    html += '<div class="small">' + (props.description || "—") + "</div>";

    html += '<div class="result-section-title">对口小学</div>';
    html += renderSchoolBlock(primary);

    html += '<div class="result-section-title">对口初中</div>';
    html += renderSchoolBlock(middle);

    html += '<div class="result-section-title">关联政策</div>';
    if (relatedPolicies.length === 0) {
      html += '<div class="text-muted small">暂无关联政策</div>';
    } else {
      html += '<ul class="small mb-0">';
      relatedPolicies.forEach(function (p) {
        html += "<li>" + (p.title || "—") + "</li>";
      });
      html += "</ul>";
    }

    panel.innerHTML = html;
  }

  // 学校信息块(防御性:school 可能为 undefined)
  function renderSchoolBlock(school) {
    if (!school) {
      return '<div class="result-school-block"><div class="text-muted small">暂无关联数据</div></div>';
    }
    var html = '<div class="result-school-block">';
    html +=
      '<div class="result-school-name">' + (school.name || "—") + "</div>";
    html +=
      '<div class="result-school-detail"><i class="bi bi-geo-alt"></i>' +
      (school.address || "—") +
      "</div>";
    html +=
      '<div class="result-school-detail"><i class="bi bi-telephone"></i>' +
      (school.phone || "—") +
      "</div>";
    html += "</div>";
    return html;
  }

  // ========== 政策筛选器(分类 + 年份) ==========
  function renderPolicyFilters(policies, onChange) {
    var container = document.getElementById("policyFilters");
    if (!container) return;

    var categories = uniq(
      (policies || []).map(function (p) {
        return p.category;
      }),
    ).filter(Boolean);
    var years = uniq(
      (policies || []).map(function (p) {
        return p.year;
      }),
    )
      .filter(Boolean)
      .sort(function (a, b) {
        return b - a;
      });

    var catOptions = '<option value="">全部分类</option>';
    categories.forEach(function (c) {
      catOptions += '<option value="' + c + '">' + c + "</option>";
    });

    var yearOptions = '<option value="">全部年份</option>';
    years.forEach(function (y) {
      yearOptions += '<option value="' + y + '">' + y + "</option>";
    });

    container.innerHTML =
      '<div class="col-md-4 mb-3"><label class="form-label small text-muted mb-1">按分类筛选</label>' +
      '<select id="policyCategoryFilter" class="form-select">' +
      catOptions +
      "</select></div>" +
      '<div class="col-md-4 mb-3"><label class="form-label small text-muted mb-1">按年份筛选</label>' +
      '<select id="policyYearFilter" class="form-select">' +
      yearOptions +
      "</select></div>";

    var catEl = document.getElementById("policyCategoryFilter");
    var yearEl = document.getElementById("policyYearFilter");
    if (catEl)
      catEl.addEventListener("change", function () {
        if (typeof onChange === "function")
          onChange(catEl.value, yearEl ? yearEl.value : "");
      });
    if (yearEl)
      yearEl.addEventListener("change", function () {
        if (typeof onChange === "function")
          onChange(catEl ? catEl.value : "", yearEl.value);
      });
  }

  // 数组去重
  function uniq(arr) {
    var out = [];
    arr.forEach(function (v) {
      if (out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }

  // ========== 政策列表 ==========
  function renderPolicies(policies) {
    var container = document.getElementById("policyList");
    if (!container) return;

    if (!policies || policies.length === 0) {
      container.innerHTML =
        '<div class="text-muted text-center py-3">当前筛选条件下暂无政策</div>';
      return;
    }

    var html = "";
    policies.forEach(function (p) {
      html += '<div class="policy-item">';
      html += '<div class="policy-title">' + (p.title || "—") + "</div>";
      html += '<div class="policy-meta">';
      html += '<span class="badge bg-primary">' + (p.year || "—") + "</span>";
      html +=
        '<span class="badge bg-secondary">' + (p.category || "—") + "</span>";
      html +=
        '<span class="text-muted small">来源:' + (p.source || "—") + "</span>";
      html +=
        '<span class="text-muted small">·发布日期:' +
        (p.publishDate || "—") +
        "</span>";
      html += "</div>";
      html += '<div class="policy-summary">' + (p.summary || "—") + "</div>";
      html += "</div>";
    });
    container.innerHTML = html;
  }

  // ========== 入学材料(Tab + 勾选 + 进度) ==========
  function renderMaterials(materials) {
    var container = document.getElementById("materialContainer");
    if (!container) return;

    if (!materials || materials.length === 0) {
      container.innerHTML =
        '<div class="text-muted text-center py-3">暂无材料数据</div>';
      return;
    }

    // Tab 头
    var tabsHtml =
      '<ul class="nav nav-tabs material-tabs mb-3" role="tablist">';
    materials.forEach(function (m, i) {
      var id = "matTab_" + i;
      tabsHtml +=
        '<li class="nav-item" role="presentation">' +
        '<button class="nav-link ' +
        (i === 0 ? "active" : "") +
        '" ' +
        'data-bs-toggle="tab" data-bs-target="#' +
        id +
        '" type="button" role="tab">' +
        (m.group || "—") +
        "</button>" +
        "</li>";
    });
    tabsHtml += "</ul>";

    // Tab 内容
    var contentHtml = '<div class="tab-content">';
    materials.forEach(function (m, i) {
      var id = "matTab_" + i;
      var items = m.items || [];
      contentHtml +=
        '<div class="tab-pane fade ' +
        (i === 0 ? "show active" : "") +
        '" id="' +
        id +
        '" role="tabpanel">';
      contentHtml +=
        '<p class="text-muted small mb-2">' + (m.description || "") + "</p>";
      contentHtml +=
        '<div class="material-progress" data-group-index="' +
        i +
        '">已完成 0/' +
        items.length +
        " 项</div>";
      items.forEach(function (item, j) {
        var checkboxId = "mat_chk_" + i + "_" + j;
        contentHtml +=
          '<div class="material-item form-check">' +
          '<input class="form-check-input material-checkbox" type="checkbox" id="' +
          checkboxId +
          '" data-group-index="' +
          i +
          '">' +
          '<label class="form-check-label" for="' +
          checkboxId +
          '">' +
          item +
          "</label>" +
          "</div>";
      });
      contentHtml += "</div>";
    });
    contentHtml += "</div>";

    container.innerHTML = tabsHtml + contentHtml;

    // 绑定勾选事件
    var checkboxes = container.querySelectorAll(".material-checkbox");
    checkboxes.forEach(function (cb) {
      cb.addEventListener("change", function () {
        updateMaterialProgress(container, cb.getAttribute("data-group-index"));
      });
    });
  }

  // 更新材料勾选进度
  function updateMaterialProgress(container, groupIndex) {
    var checkboxes = container.querySelectorAll(
      '.material-checkbox[data-group-index="' + groupIndex + '"]',
    );
    var checked = 0;
    checkboxes.forEach(function (cb) {
      if (cb.checked) checked++;
    });
    var progressEl = container.querySelector(
      '.material-progress[data-group-index="' + groupIndex + '"]',
    );
    if (progressEl) {
      progressEl.textContent =
        "已完成 " + checked + "/" + checkboxes.length + " 项";
    }
  }

  // ========== FAQ ==========
  function renderFaq(faqList) {
    _allFaq = faqList || [];
    renderFaqList(_allFaq);
  }

  // 内部:渲染 FAQ 列表
  function renderFaqList(list) {
    var container = document.getElementById("faqList");
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML =
        '<div class="text-muted text-center py-3">未找到相关问题,请尝试其他关键词</div>';
      return;
    }

    var html = "";
    list.forEach(function (f) {
      html += '<div class="faq-item">';
      html +=
        '<div class="faq-question"><i class="bi bi-patch-question-fill"></i>' +
        (f.question || "—") +
        "</div>";
      html += '<div class="faq-answer">' + (f.answer || "—") + "</div>";
      if (f.category) {
        html += '<div class="faq-category">' + f.category + "</div>";
      }
      html += "</div>";
    });
    container.innerHTML = html;
  }

  // 绑定 FAQ 搜索框
  function bindFaqSearch() {
    var input = document.getElementById("faqSearch");
    if (!input) return;
    input.addEventListener("input", function () {
      var kw = (input.value || "").trim().toLowerCase();
      if (!kw) {
        renderFaqList(_allFaq);
        return;
      }
      var filtered = _allFaq.filter(function (f) {
        var q = (f.question || "").toLowerCase();
        var a = (f.answer || "").toLowerCase();
        return q.indexOf(kw) !== -1 || a.indexOf(kw) !== -1;
      });
      renderFaqList(filtered);
    });
  }

  // ========== 全页错误状态 ==========
  function renderError(message) {
    var errEl = document.getElementById("errorState");
    var mainEl = document.getElementById("mainContent");
    var loadEl = document.getElementById("loadingState");
    if (loadEl) loadEl.style.display = "none";
    if (mainEl) mainEl.style.display = "none";
    if (errEl) {
      errEl.style.display = "block";
      errEl.innerHTML =
        '<strong><i class="bi bi-exclamation-octagon-fill"></i> 加载失败:</strong> ' +
        (message || "未知错误") +
        '<hr><div class="small">' +
        window.AppConfig.texts.loadErrorTip +
        "</div>";
    }
  }

  // ========== 项目边界说明 ==========
  function setBoundaryNotice() {
    var container = document.getElementById("boundaryNotice");
    if (!container) return;
    container.innerHTML =
      '<div class="boundary-notice">' +
      "<ul>" +
      "<li>当前项目为<strong>阶段性本地前端原型</strong>。</li>" +
      "<li>系统不包含后端、数据库、登录注册、真实在线咨询功能。</li>" +
      "<li>地图底图使用 OpenStreetMap 在线瓦片。</li>" +
      "<li>业务数据来自本地示例 JSON / GeoJSON 文件。</li>" +
      "<li>学区边界为示例或简化示意数据,<strong>不代表官方学区划分</strong>。</li>" +
      "<li>示例数据仅用于展示技术路线,<strong>不代表真实招生政策</strong>。</li>" +
      '<li>学校名采用"泰山区示范第一小学"等明显示例化命名;电话统一为 0538-XXXXXXX 占位格式。</li>' +
      "<li>实际入学政策以教育主管部门官方发布为准。</li>" +
      "</ul>" +
      "</div>";
  }

  return {
    renderStats: renderStats,
    renderResult: renderResult,
    renderNoMatch: renderNoMatch,
    renderDefaultResultTip: renderDefaultResultTip,
    renderPolicies: renderPolicies,
    renderPolicyFilters: renderPolicyFilters,
    renderMaterials: renderMaterials,
    renderFaq: renderFaq,
    bindFaqSearch: bindFaqSearch,
    renderError: renderError,
    setBoundaryNotice: setBoundaryNotice,
  };
})();
