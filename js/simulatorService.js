/* simulatorService.js - 录取建议模拟器 */

window.SimulatorService = (function () {
  var _rules = null;

  function init(data) {
    _rules = data.simulatorRules;
    if (!_rules) {
      console.warn('simulatorRules 数据未加载');
      return;
    }
    renderForm();
    bindEvents();
  }

  function renderForm() {
    var container = document.getElementById('simulatorForm');
    if (!container) return;

    var html = '';

    html += '<div class="col-md-6">';
    html += '<label class="form-label">户籍类型</label>';
    html += '<select id="simCategory" class="form-select">';
    _rules.categories.forEach(function (c) {
      html += '<option value="' + c.key + '">' + c.label + '</option>';
    });
    html += '</select></div>';

    _rules.factors.forEach(function (f) {
      html += '<div class="col-md-6">';
      html += '<label class="form-label">' + f.label + '</label>';
      html += '<select class="form-select sim-factor" data-factor-key="' + f.key + '">';
      f.options.forEach(function (o) {
        html += '<option value="' + o.value + '" data-score="' + o.score + '">' + o.label + '</option>';
      });
      html += '</select></div>';
    });

    container.innerHTML = html;
  }

  function bindEvents() {
    var simulateBtn = document.getElementById('simulateBtn');
    var resetBtn = document.getElementById('resetBtn');
    if (simulateBtn) simulateBtn.addEventListener('click', simulate);
    if (resetBtn) resetBtn.addEventListener('click', resetForm);
  }

  function simulate() {
    var totalScore = 0;
    document.querySelectorAll('.sim-factor').forEach(function (sel) {
      var opt = sel.options[sel.selectedIndex];
      var score = parseInt(opt.getAttribute('data-score')) || 0;
      totalScore += score;
    });

    var suggestion = _rules.scoreToSuggestion.find(function (s) {
      return totalScore >= s.minScore;
    }) || _rules.scoreToSuggestion[_rules.scoreToSuggestion.length - 1];

    renderResult(totalScore, suggestion);
  }

  function renderResult(score, sug) {
    var el = document.getElementById('simulatorResult');
    if (!el) return;

    el.innerHTML =
      '<div class="sim-result-card sim-result-' + sug.color + '">' +
        '<div class="sim-result-score">' +
          '<div class="sim-score-num">' + score + '</div>' +
          '<div class="sim-score-label">综合评分（满分100）</div>' +
        '</div>' +
        '<div class="sim-result-body">' +
          '<div class="sim-result-level">参考等级：<strong>' + sug.level + '</strong></div>' +
          '<div class="sim-result-suggest">' + sug.suggestion + '</div>' +
          '<div class="sim-result-advice"><i class="bi bi-lightbulb"></i>' + sug.advice + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="text-muted small mt-3 text-center">' +
        '<i class="bi bi-exclamation-triangle"></i>本结果为示例，实际录取以官方政策为准' +
      '</div>';

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetForm() {
    var form = document.getElementById('simulatorForm');
    if (form) {
      form.querySelectorAll('select').forEach(function (sel) {
        sel.selectedIndex = 0;
      });
    }
    var result = document.getElementById('simulatorResult');
    if (result) result.innerHTML = '';
  }

  return {
    init: init
  };
})();