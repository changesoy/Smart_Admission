/* render.js - 渲染服务(统计卡片、结果面板、错误状态、网站说明) */

window.RenderService = (function () {
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

  function safeText(value) {
    if (value === undefined || value === null || value === "") return "—";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderResult(ctx) {
    var panel = document.getElementById("resultPanel");
    if (!panel) return;

    var feature = ctx && ctx.zoneFeature;
    if (!feature || !feature.properties) {
      panel.innerHTML = '<div class="result-tip"><div>暂无学区数据</div></div>';
      return;
    }
    var props = feature.properties;

    var school = (ctx.schools || []).find(function (s) {
      return s.schoolId === props.schoolId;
    });

    var policyIds = props.policyIds || [];
    var relatedPolicies = (ctx.policies || []).filter(function (p) {
      return policyIds.indexOf(p.policyId) !== -1;
    });

    var displayName = props.zoneName || "";
    displayName = displayName.replace(/学区$/, "");

    var html = "";
    html +=
      '<div class="result-zone-name"><i class="bi bi-bookmark-fill text-warning"></i> ' +
      safeText(displayName) +
      "</div>";
    html +=
      '<div class="text-muted small mb-2">学区年份:' +
      safeText(props.year) +
      "</div>";

    html += '<div class="result-section-title">招生范围说明</div>';
    html += '<div class="small">' + safeText(props.description) + "</div>";

    html += '<div class="result-section-title">对应学校</div>';
    html += '<div class="zone-school-card">';
    html +=
      '<div class="zone-school-name">' +
      safeText(school ? school.name : "未找到关联学校") +
      "</div>";
    html +=
      '<span class="zone-school-stage">' + safeText(props.stage) + "</span>";
    html += '<div class="zone-meta-grid">';
    html +=
      "<div><span>学校地址</span><strong>" +
      safeText(school ? school.address : "—") +
      "</strong></div>";
    html +=
      "<div><span>联系电话</span><strong>" +
      safeText(school ? school.phone : "—") +
      "</strong></div>";
    html +=
      "<div><span>所属区县</span><strong>" +
      safeText(school ? school.district : "—") +
      "</strong></div>";
    html +=
      "<div><span>学校类型</span><strong>" +
      safeText(school ? school.type : "—") +
      "</strong></div>";
    html += "</div>";
    if (school && school.website) {
      html +=
        '<div class="zone-school-website"><i class="bi bi-globe"></i><a href="' +
        safeText(school.website) +
        '" target="_blank" rel="noopener noreferrer">学校官网</a></div>';
    }
    html += "</div>";

    html += '<div class="result-section-title">关联政策</div>';
    if (relatedPolicies.length === 0) {
      html += '<div class="text-muted small">暂无关联政策</div>';
    } else {
      html += '<ul class="small mb-0">';
      relatedPolicies.forEach(function (p) {
        var hasValidUrl = p.url && p.url !== "#";
        if (hasValidUrl) {
          html +=
            '<li><a href="' +
            safeText(p.url) +
            '" target="_blank" rel="noopener noreferrer" class="policy-link-text">' +
            safeText(p.title) +
            "</a></li>";
        } else {
          html += "<li>" + safeText(p.title) + "</li>";
        }
      });
      html += "</ul>";
    }

    html += '<div class="result-section-title">历年调整记录</div>';
    var history = ctx.history || [];
    if (history.length === 0) {
      html += '<div class="text-muted small">暂无调整记录</div>';
    } else {
      html += '<div class="zone-history-timeline">';
      history.forEach(function (h) {
        html += '<div class="zone-history-item">';
        html += '<div class="zone-history-year">' + safeText(h.year) + "</div>";
        html +=
          '<span class="zone-history-change">' +
          safeText(h.changeType || h.change) +
          "</span>";
        html +=
          '<div class="zone-history-title">' + safeText(h.title) + "</div>";
        if (h.description) {
          html +=
            '<div class="zone-history-desc">' +
            safeText(h.description) +
            "</div>";
        }
        if (h.reason) {
          html +=
            '<div class="zone-history-reason">原因: ' +
            safeText(h.reason) +
            "</div>";
        }
        html += "</div>";
      });
      html += "</div>";
    }

    panel.innerHTML = html;
  }

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

  return {
    renderStats: renderStats,
    renderResult: renderResult,
    renderNoMatch: renderNoMatch,
    renderDefaultResultTip: renderDefaultResultTip,
    renderError: renderError,
    setBoundaryNotice: setBoundaryNotice,
  };
})();
