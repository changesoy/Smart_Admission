/**
 * simulatorService.js - 入学条件自查 / 情形判断助手服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 根据 data/simulator_rules.json 中的表单配置与规则数据,渲染"入学条件自查"
 *       表单;用户选择情形后匹配规则,输出情形分类、需要核验的条件、建议准备材料、
 *       相关政策条目、需要人工咨询的事项和官方来源。规则更换年度时无需修改本模块。
 *
 * 设计原则:
 *   - 表单与规则全部由数据驱动,JS 只负责解释和渲染;
 *   - 不做任何录取概率/分值预测;
 *   - 未命中规则时明确提示"需要人工确认",不强行给出结论。
 *
 * 关键接口:
 *   init(data) - 初始化,接收 { simulatorRules, policies, materials }
 *
 * 数据格式 (data/simulator_rules.json):
 *   meta  = { title, effectiveYear, dataStatus, ruleBase, disclaimer }
 *   form  = [{ field, label, showWhen: {field,value}|null, options: [{value,label}] }]
 *   rules = [{ ruleId, effectiveYear, stage: "any"|stage|Array, resultType, resultClass,
 *              resultTitle, resultSummary, conditions: [{field,op,value}],
 *              requiredMaterialIds[], warnings[], manualCheckNotes[], policyIds[],
 *              sourceUrl, dataStatus }]
 */
import RenderService from "./render.js";

const SimulatorService = (() => {
  let _meta = {};
  let _form = [];
  let _rules = [];
  let _policies = [];
  let _materialsData = [];

  /** 未命中规则时的兜底结果 */
  const FALLBACK = {
    resultType: "需要人工确认",
    resultClass: "category-c",
    resultTitle: "您的情形暂未覆盖在现有规则中",
    resultSummary:
      "本工具现有规则无法覆盖您选择的情形。为避免误导，我们不对该情形给出结论，建议直接咨询泰山区教育和体育局或相关学校招生部门。",
    warnings: [],
    manualCheckNotes: [
      "携带相关证件材料，直接向泰山区教育和体育局咨询具体入学条件",
      "或致电目标学校招生咨询电话，确认该情形的认定与材料要求",
    ],
    policyIds: [],
    requiredMaterialIds: [],
  };

  /** 初始化:存储数据并渲染表单与初始结果 */
  const init = (data) => {
    const rulesData = (data && data.simulatorRules) || {};
    _meta = rulesData.meta || {};
    _form = rulesData.form || [];
    _rules = rulesData.rules || [];
    _policies = data.policies || [];
    _materialsData = data.materials || [];

    renderForm();
    renderMeta();
    renderResult(getInput());
  };

  /** 在区块顶部展示数据年份与规则依据说明 */
  const renderMeta = () => {
    const el = document.getElementById("simulatorMeta");
    if (!el) return;
    const safe = RenderService.safeText;
    el.innerHTML =
      `<i class="bi bi-calendar-check"></i> 参考数据年份：${safe(_meta.effectiveYear)}${safe(_meta.dataStatus) ? `（${safe(_meta.dataStatus)}）` : ""}` +
      ` · ` +
      `<i class="bi bi-journal-text"></i> ${safe(_meta.ruleBase || "")}`;
  };

  // ==================== 表单渲染 ====================

  /** 根据 form 配置渲染自查表单(select 下拉),并绑定联动显示与变更事件 */
  const renderForm = () => {
    const container = document.getElementById("simulatorForm");
    if (!container) return;

    if (_form.length === 0) {
      container.innerHTML =
        `<div class="simulator-empty">` +
        `<i class="bi bi-clipboard-x"></i>` +
        `<div>自查规则数据未配置，该功能暂不可用。</div>` +
        `</div>`;
      return;
    }

    const safe = RenderService.safeText;

    let html = `<div class="simulator-form">`;
    html += `<div class="simulator-form-intro small text-muted mb-3">`;
    html += `<i class="bi bi-info-circle"></i> 选择以下选项，系统将结合${safe(_meta.effectiveYear)}年政策规则给出入学条件自查结果（不含录取概率）。`;
    html += `</div>`;

    _form.forEach((field) => {
      html += `<div class="simulator-field" data-field="${safe(field.field)}">`;
      html += `<label class="form-label">${safe(field.label)}</label>`;
      html += `<select class="form-select simulator-select" data-field="${safe(field.field)}">`;
      field.options.forEach((opt) => {
        html += `<option value="${safe(opt.value)}">${safe(opt.label)}</option>`;
      });
      html += `</select>`;
      html += `</div>`;
    });

    html += `<button type="button" id="simulatorResetBtn" class="btn btn-outline-secondary btn-sm w-100 mt-3">`;
    html += `<i class="bi bi-arrow-counterclockwise"></i> 重置为默认情形`;
    html += `</button>`;
    html += `</div>`;

    container.innerHTML = html;

    container.querySelectorAll(".simulator-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        updateVisibility();
        renderResult(getInput());
      });
    });

    const resetBtn = document.getElementById("simulatorResetBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        container.querySelectorAll(".simulator-select").forEach((sel) => {
          sel.selectedIndex = 0; // 重置为默认情形（各字段第一个选项）
        });
        updateVisibility();
        renderResult(getInput());
      });
    }

    updateVisibility();
  };

  /** 根据 showWhen 配置显示/隐藏字段;隐藏字段取值视为"不适用" */
  const updateVisibility = () => {
    const container = document.getElementById("simulatorForm");
    if (!container) return;
    const selects = container.querySelectorAll(".simulator-select");
    if (selects.length === 0) return;

    const valueOf = (field) => {
      const sel = container.querySelector(
        `.simulator-select[data-field="${field}"]`,
      );
      return sel ? sel.value : "";
    };

    _form.forEach((field) => {
      const wrap = container.querySelector(
        `.simulator-field[data-field="${field.field}"]`,
      );
      if (!wrap) return;
      let show = true;
      if (field.showWhen && field.showWhen.field) {
        show = valueOf(field.showWhen.field) === field.showWhen.value;
      }
      wrap.style.display = show ? "" : "none";
    });
  };

  /** 收集当前表单输入值(隐藏字段返回 "na") */
  const getInput = () => {
    const container = document.getElementById("simulatorForm");
    const input = {};
    if (!container) return input;

    _form.forEach((field) => {
      const wrap = container.querySelector(
        `.simulator-field[data-field="${field.field}"]`,
      );
      const sel = container.querySelector(
        `.simulator-select[data-field="${field.field}"]`,
      );
      if (!sel) {
        input[field.field] = "na";
      } else if (wrap && wrap.style.display === "none") {
        input[field.field] = "na";
      } else {
        input[field.field] = sel.value;
      }
    });
    return input;
  };

  // ==================== 规则匹配 ====================

  /** 判断规则是否适用于所选学段 */
  const matchStage = (rule, stage) => {
    if (!rule.stage || rule.stage === "any") return true;
    if (Array.isArray(rule.stage)) return rule.stage.includes(stage);
    return rule.stage === stage;
  };

  /** 匹配条件:eq 精确相等 / in 属于集合 / any 恒真 */
  const matchCondition = (cond, input) => {
    if (!cond || cond.op === "any") return true;
    const actual = input[cond.field];
    if (actual === undefined || actual === null || actual === "") return false;
    if (cond.op === "eq") return actual === cond.value;
    if (cond.op === "in") return cond.value.includes(actual);
    return false;
  };

  /** 按顺序返回第一条命中的规则,未命中返回 null */
  const matchRule = (input) => {
    for (const rule of _rules) {
      if (!matchStage(rule, input.stage)) continue;
      const matched = (rule.conditions || []).every((cond) =>
        matchCondition(cond, input),
      );
      if (matched) return rule;
    }
    return null;
  };

  // ==================== 结果渲染 ====================

  /** 在材料分组中查找指定 materialId 的材料项 */
  const findMaterials = (ids) => {
    const out = [];
    if (!ids || ids.length === 0) return out;
    _materialsData.forEach((group) => {
      (group.items || []).forEach((item) => {
        if (ids.includes(item.materialId)) out.push(item);
      });
    });
    return out;
  };

  /** 根据 policyIds 查找政策条目 */
  const findPolicies = (ids) => {
    if (!ids || ids.length === 0) return [];
    return (ids || [])
      .map((pid) => _policies.find((p) => p.policyId === pid))
      .filter(Boolean);
  };

  /** 渲染"建议准备材料"区块 */
  const renderMaterials = (rule) => {
    const materials = findMaterials(rule.requiredMaterialIds);
    if (materials.length === 0) {
      return (
        `<div class="simulator-section-title"><i class="bi bi-list-check"></i>建议准备材料</div>` +
        `<div class="text-muted small">无固定材料清单，需按人工核验结果准备。</div>`
      );
    }

    let html =
      `<div class="simulator-section-title"><i class="bi bi-list-check"></i>建议准备材料</div>`;
    html += `<ul class="simulator-list">`;
    materials.forEach((m) => {
      html += `<li>`;
      html += `<span class="simulator-material-name">${RenderService.safeText(m.name)}</span>`;
      html += m.required
        ? `<span class="simulator-tag simulator-tag-required">必需</span>`
        : `<span class="simulator-tag simulator-tag-optional">可选</span>`;
      if (m.note) {
        html += `<div class="simulator-material-note">${RenderService.safeText(m.note)}</div>`;
      }
      html += `</li>`;
    });
    html += `</ul>`;
    html += `<a class="btn btn-outline-primary btn-sm" href="#section-material">`;
    html += `<i class="bi bi-arrow-down-circle"></i> 前往材料清单勾选进度`;
    html += `</a>`;
    return html;
  };

  /** 渲染"需要重点核验的条件 / 需要人工咨询的事项"列表 */
  const renderNoteList = (title, icon, items) => {
    if (!items || items.length === 0) return "";
    let html = `<div class="simulator-section-title"><i class="bi ${icon}"></i>${title}</div>`;
    html += `<ul class="simulator-list">`;
    items.forEach((t) => {
      html += `<li>${RenderService.safeText(t)}</li>`;
    });
    html += `</ul>`;
    return html;
  };

  /** 渲染"相关政策条目"区块 */
  const renderPolicies = (rule) => {
    const policies = findPolicies(rule.policyIds);
    if (policies.length === 0) return "";

    let html =
      `<div class="simulator-section-title"><i class="bi bi-file-earmark-text"></i>相关政策依据</div>`;
    html += `<ul class="simulator-list">`;
    policies.forEach((p) => {
      const hasUrl = p.url && p.url !== "#";
      if (hasUrl) {
        html += `<li><a href="${RenderService.safeUrl(p.url)}" target="_blank" rel="noopener noreferrer" class="policy-link-text">${RenderService.safeText(p.title)}</a><span class="text-muted">（${RenderService.safeText(p.year)}年·${RenderService.safeText(p.source)}）</span></li>`;
      } else {
        html += `<li>${RenderService.safeText(p.title)}<span class="text-muted">（${RenderService.safeText(p.year)}年）</span></li>`;
      }
    });
    html += `</ul>`;
    return html;
  };

  /** 渲染"官方来源"与"数据年份/状态" */
  const renderSource = (rule) => {
    const safe = RenderService.safeText;
    let html = `<div class="simulator-source">`;
    html += `<span class="simulator-source-label">数据年份：</span>${safe(rule.effectiveYear || _meta.effectiveYear)}`;
    html += `<span class="simulator-source-divider">·</span>`;
    html += `<span class="simulator-source-label">数据状态：</span>${safe(rule.dataStatus || _meta.dataStatus)}`;
    if (rule.sourceUrl) {
      html += `<div class="mt-1"><i class="bi bi-box-arrow-up-right"></i> <a href="${RenderService.safeUrl(rule.sourceUrl)}" target="_blank" rel="noopener noreferrer">官方政策原文（泰山区人民政府）</a></div>`;
    }
    html += `</div>`;
    return html;
  };

  /** 渲染主结果面板:情形分类 + 材料 + 核验点 + 政策 + 咨询事项 + 来源 */
  const renderResult = (input) => {
    const container = document.getElementById("simulatorResult");
    if (!container) return;

    if (!input || !input.stage) {
      container.innerHTML = renderEmpty();
      return;
    }

    const rule = matchRule(input) || FALLBACK;
    const safe = RenderService.safeText;

    let html = `<div class="simulator-result-card">`;

    html += `<div class="simulator-result-head">`;
    html += `<div class="simulator-result-type simulator-result-${safe(rule.resultClass)}">`;
    html += `<i class="bi bi-tag-fill"></i> ${safe(rule.resultType)}`;
    html += `</div>`;
    html += `<div class="simulator-result-title">${safe(rule.resultTitle)}</div>`;
    html += `<div class="simulator-result-stage small text-muted">申请学段：${safe(input.stage)}</div>`;
    html += `<div class="simulator-result-summary">${safe(rule.resultSummary)}</div>`;
    html += `</div>`;

    html += renderMaterials(rule);
    html += renderNoteList(
      "需要重点核验的条件",
      "bi-exclamation-triangle",
      rule.warnings,
    );
    html += renderPolicies(rule);
    html += renderNoteList(
      "需要人工咨询的事项",
      "bi-person-lines-fill",
      rule.manualCheckNotes,
    );
    html += renderSource(rule);
    html += renderDisclaimer();

    html += `</div>`;

    container.innerHTML = html;
  };

  /** 未选择学段时的引导空状态 */
  const renderEmpty = () => {
    return (
      `<div class="simulator-empty">` +
      `<i class="bi bi-clipboard2-check"></i>` +
      `<div>请选择左侧选项，查看入学条件自查结果。</div>` +
      `<div class="small text-muted">本工具不预测录取概率，仅根据现有政策规则提示需要准备的材料与核验事项。</div>` +
      `</div>`
    );
  };

  /** 底部免责声明 */
  const renderDisclaimer = () => {
    if (!_meta.disclaimer) return "";
    return (
      `<div class="simulator-disclaimer"><i class="bi bi-shield-exclamation"></i> ` +
      `${RenderService.safeText(_meta.disclaimer)}</div>`
    );
  };

  /** 公共接口 */
  return {
    init,
  };
})();

export default SimulatorService;
