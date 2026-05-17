/* render.js - 渲染服务(所有 DOM 渲染逻辑集中在此) */

/**
 * 渲染服务模块
 * 负责所有页面元素的渲染逻辑
 * 包括：统计卡片、结果面板、政策列表、材料列表、FAQ等
 */
window.RenderService = (function () {
  // 缓存当前 FAQ 全量,供搜索过滤
  var _allFaq = [];

  // ========== 数据概览卡片 ==========
  /**
   * 渲染数据概览统计卡片
   * @param {Object} data - 包含各类型数据的对象
   * @param {Object} data.zones - 学区数据 (GeoJSON)
   * @param {Array} data.schools - 学校数据数组
   * @param {Array} data.policies - 政策数据数组
   * @param {Array} data.faq - FAQ数据数组
   */
  function renderStats(data) {
    var row = document.getElementById("statsRow");
    if (!row) return;

    var stats = [
      {
        icon: "bi-geo-alt-fill",
        label: "学区",
        number:
          data.zones && data.zones.features ? data.zones.features.length : 0,
      },
      {
        icon: "bi-building",
        label: "学校",
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
  /**
   * 渲染结果面板的默认提示
   */
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
  /**
   * 渲染结果面板的未匹配提示
   */
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
  /**
   * 渲染结果面板的学区详情
   * @param {Object} ctx - 上下文对象
   * @param {Object} ctx.zoneFeature - 选中的学区要素
   * @param {Array} ctx.schools - 学校数据数组
   * @param {Array} ctx.policies - 政策数据数组
   */
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
        var hasValidUrl = p.url && p.url !== "#";
        if (hasValidUrl) {
          html += '<li><a href="' + p.url + '" target="_blank" rel="noopener noreferrer" class="policy-link-text">' + (p.title || "—") + '</a></li>';
        } else {
          html += "<li>" + (p.title || "—") + "</li>";
        }
      });
      html += '</ul>';
    }

    panel.innerHTML = html;
  }

  // 学校信息块(防御性:school 可能为 undefined)
  /**
   * 渲染学校信息块
   * @param {Object} school - 学校对象
   * @returns {string} 学校信息的HTML字符串
   */
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
  /**
   * 渲染政策筛选器
   * @param {Array} policies - 政策数据数组
   * @param {Function} onChange - 筛选条件变更时的回调函数
   */
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
  /**
   * 数组去重
   * @param {Array} arr - 要去重的数组
   * @returns {Array} 去重后的新数组
   */
  function uniq(arr) {
    var out = [];
    arr.forEach(function (v) {
      if (out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }

  // ========== 政策列表 ==========
  /**
   * 渲染政策列表
   * @param {Array} policies - 政策数据数组
   */
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
      var hasValidUrl = p.url && p.url !== "#";
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
      if (hasValidUrl) {
        html +=
          '<div class="policy-link">' +
          '<a href="' +
          p.url +
          '" target="_blank" rel="noopener noreferrer" class="policy-link-btn">' +
          '<i class="bi bi-box-arrow-up-right"></i> 查看原文' +
          "</a>" +
          "</div>";
      }
      html += "</div>";
    });
    container.innerHTML = html;
  }

  // ========== 入学材料(Tab + 勾选 + 进度) ==========
  /**
   * 渲染入学材料列表
   * @param {Array} materials - 材料数据数组
   */
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
      items.forEach(function (item, j) {
        contentHtml +=
          '<div class="material-item">' +
          '<span class="material-item-text">' +
          item +
          "</span>" +
          "</div>";
      });
      contentHtml += "</div>";
    });
    contentHtml += "</div>";

    container.innerHTML = tabsHtml + contentHtml;
  }

  // ========== FAQ ==========
  /**
   * 渲染FAQ列表
   * @param {Array} faqList - FAQ数据数组
   */
  function renderFaq(faqList) {
    _allFaq = faqList || [];
    renderFaqList(_allFaq);
  }

  // 内部:渲染 FAQ 列表
  /**
   * 内部方法：渲染FAQ列表
   * @param {Array} list - FAQ数据数组
   */
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
  /**
   * 绑定FAQ搜索框事件
   */
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
  /**
   * 渲染全页错误状态
   * @param {string} message - 错误信息
   */
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

  // ========== 网站说明 ==========
  /**
   * 设置网站说明
   */
  function setBoundaryNotice() {
    var container = document.getElementById("boundaryNotice");
    if (!container) return;
    container.innerHTML =
      '<div class="boundary-notice">' +
      "<ul>" +
      "<li>本网站为泰安市泰山区义务教育入学信息公示平台，旨在为家长提供便捷的入学信息查询服务。</li>" +
      "<li>网站提供学区查询、学校信息、招生政策、入学材料清单等服务。</li>" +
      "<li>学区划分信息根据泰山区教育和体育局发布的招生政策编制。</li>" +
      "<li>入学材料清单根据不同学生类型（本地户籍、随迁子女、集体户等）分类整理。</li>" +
      "<li>常见问题解答涵盖入学过程中的各类常见疑问，帮助家长顺利完成报名。</li>" +
      "<li>留言建议功能为家长提供咨询反馈渠道，您的建议将有助于我们改进服务。</li>" +
      "<li>最终入学政策以教育主管部门官方发布为准。</li>" +
      "</ul>" +
      "</div>";
  }

  /**
   * 渲染服务暴露的方法
   */
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