/**
 * render.js - 渲染服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 负责所有 DOM 渲染,包括统计卡片、查询结果面板、错误状态和网站说明。
 *       其他模块通过 window.RenderService 调用渲染方法。
 *
 * 关键接口:
 *   renderStats(data)           - 渲染顶部4张统计卡片(学区/学校/政策/FAQ数量)
 *   renderResult(ctx)           - 渲染学区查询结果(学区信息+对应学校+关联政策+历年调整)
 *   renderNoMatch()             - 渲染"未匹配学区"提示
 *   renderDefaultResultTip()    - 渲染默认引导提示
 *   renderError(message)        - 渲染加载错误状态
 *   setBoundaryNotice()         - 渲染网站说明/免责声明
 *   safeText(value)             - XSS 安全的文本转义工具
 *
 * 数据格式:
 *   ctx = { zoneFeature: GeoJSON Feature, schools: Array, policies: Array, history: Array }
 */
window.RenderService = (() => {
  /** 渲染顶部统计卡片,从 data 中提取学区/学校/政策/FAQ 数量 */
  const renderStats = (data) => {
    const row = document.getElementById("statsRow");
    if (!row) return;

    const stats = [
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

    let html = "";
    stats.forEach((s) => {
      html +=
        `<div class="col-6 col-md-3">` +
        `<div class="stat-card">` +
        `<div class="stat-icon"><i class="bi ${s.icon}"></i></div>` +
        `<div class="stat-number">${s.number}</div>` +
        `<div class="stat-label">${s.label}</div>` +
        `</div>` +
        `</div>`;
    });
    row.innerHTML = html;
  };

  /** 渲染默认引导提示(点击地图查询) */
  const renderDefaultResultTip = () => {
    const panel = document.getElementById("resultPanel");
    if (!panel) return;
    panel.innerHTML =
      `<div class="result-tip">` +
      `<i class="bi bi-cursor-fill"></i>` +
      `<div>${window.AppConfig.texts.defaultResultTip}</div>` +
      `</div>`;
  };

  /** 渲染"未匹配学区"提示 */
  const renderNoMatch = () => {
    const panel = document.getElementById("resultPanel");
    if (!panel) return;
    panel.innerHTML =
      `<div class="result-tip">` +
      `<i class="bi bi-question-diamond-fill"></i>` +
      `<div>${window.AppConfig.texts.noMatchTip}</div>` +
      `</div>`;
  };

  /** XSS 安全文本转义:将特殊字符转为 HTML 实体,防止注入 */
  const safeText = (value) => {
    if (value === undefined || value === null || value === "") return "—";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  /** 渲染学区查询结果面板:学区名+对应学校+关联政策+历年调整记录时间线 */
  const renderResult = (ctx) => {
    const panel = document.getElementById("resultPanel");
    if (!panel) return;

    const feature = ctx && ctx.zoneFeature;
    if (!feature || !feature.properties) {
      panel.innerHTML = `<div class="result-tip"><div>暂无学区数据</div></div>`;
      return;
    }
    const props = feature.properties;

    const school = (ctx.schools || []).find(
      (s) => s.schoolId === props.schoolId,
    );

    const policyIds = props.policyIds || [];
    const relatedPolicies = (ctx.policies || []).filter((p) =>
      policyIds.includes(p.policyId),
    );

    let displayName = props.zoneName || "";
    displayName = displayName.replace(/学区$/, "");

    let html = "";
    html += `<div class="result-zone-name"><i class="bi bi-bookmark-fill text-warning"></i> ${safeText(displayName)}</div>`;
    html += `<div class="text-muted small mb-2">学区年份:${safeText(props.year)}</div>`;

    html += `<div class="result-section-title">招生范围说明</div>`;
    html += `<div class="small">${safeText(props.description)}</div>`;

    html += `<div class="result-section-title">对应学校</div>`;
    html += `<div class="zone-school-card">`;
    html += `<div class="zone-school-name">${safeText(school ? school.name : "未找到关联学校")}</div>`;
    html += `<span class="zone-school-stage">${safeText(props.stage)}</span>`;
    html += `<div class="zone-meta-grid">`;
    html += `<div><span>学校地址</span><strong>${safeText(school ? school.address : "—")}</strong></div>`;
    html += `<div><span>联系电话</span><strong>${safeText(school ? school.phone : "—")}</strong></div>`;
    html += `<div><span>所属区县</span><strong>${safeText(school ? school.district : "—")}</strong></div>`;
    html += `<div><span>学校类型</span><strong>${safeText(school ? school.type : "—")}</strong></div>`;
    html += `</div>`;
    if (school && school.website) {
      html += `<div class="zone-school-website"><i class="bi bi-globe"></i><a href="${safeText(school.website)}" target="_blank" rel="noopener noreferrer">学校官网</a></div>`;
    }
    html += `</div>`;

    html += `<div class="result-section-title">关联政策</div>`;
    if (relatedPolicies.length === 0) {
      html += `<div class="text-muted small">暂无关联政策</div>`;
    } else {
      html += `<ul class="small mb-0">`;
      relatedPolicies.forEach((p) => {
        const hasValidUrl = p.url && p.url !== "#";
        if (hasValidUrl) {
          html += `<li><a href="${safeText(p.url)}" target="_blank" rel="noopener noreferrer" class="policy-link-text">${safeText(p.title)}</a></li>`;
        } else {
          html += `<li>${safeText(p.title)}</li>`;
        }
      });
      html += `</ul>`;
    }

    html += `<div class="result-section-title">历年调整记录</div>`;
    const history = ctx.history || [];
    if (history.length === 0) {
      html += `<div class="text-muted small">暂无调整记录</div>`;
    } else {
      html += `<div class="zone-history-timeline">`;
      history.forEach((h) => {
        html += `<div class="zone-history-item">`;
        html += `<div class="zone-history-year">${safeText(h.year)}</div>`;
        html += `<span class="zone-history-change">${safeText(h.changeType || h.change)}</span>`;
        html += `<div class="zone-history-title">${safeText(h.title)}</div>`;
        if (h.description) {
          html += `<div class="zone-history-desc">${safeText(h.description)}</div>`;
        }
        if (h.reason) {
          html += `<div class="zone-history-reason">原因: ${safeText(h.reason)}</div>`;
        }
        html += `</div>`;
      });
      html += `</div>`;
    }

    panel.innerHTML = html;
  };

  /** 渲染数据加载失败错误状态,隐藏主内容并显示错误提示 */
  const renderError = (message) => {
    const errEl = document.getElementById("errorState");
    const mainEl = document.getElementById("mainContent");
    const loadEl = document.getElementById("loadingState");
    if (loadEl) loadEl.style.display = "none";
    if (mainEl) mainEl.style.display = "none";
    if (errEl) {
      errEl.style.display = "block";
      errEl.innerHTML =
        `<strong><i class="bi bi-exclamation-octagon-fill"></i> 加载失败:</strong> ${message || "未知错误"}` +
        `<hr><div class="small">${window.AppConfig.texts.loadErrorTip}</div>`;
    }
  };

  /** 渲染网站说明/免责声明区块 */
  const setBoundaryNotice = () => {
    const container = document.getElementById("boundaryNotice");
    if (!container) return;
    container.innerHTML =
      `<div class="boundary-notice">` +
      `<ul>` +
      `<li>本网站为泰安市泰山区义务教育入学信息公示平台，旨在为家长提供便捷的入学信息查询服务。</li>` +
      `<li>网站提供学区查询、学校信息、招生政策、入学材料清单等服务。</li>` +
      `<li>学区划分信息根据泰山区教育和体育局发布的招生政策编制。</li>` +
      `<li>入学材料清单根据不同学生类型（本地户籍、随迁子女、集体户等）分类整理。</li>` +
      `<li>常见问题解答涵盖入学过程中的各类常见疑问，帮助家长顺利完成报名。</li>` +
      `<li>留言建议功能为家长提供咨询反馈渠道，您的建议将有助于我们改进服务。</li>` +
      `<li>最终入学政策以教育主管部门官方发布为准。</li>` +
      `</ul>` +
      `</div>`;
  };

  /** 公共接口 */
  return {
    renderStats,
    renderResult,
    renderNoMatch,
    renderDefaultResultTip,
    renderError,
    setBoundaryNotice,
    safeText,
  };
})();
