/* faqService.js - 常见问题服务 */

window.FaqService = (function () {
  var _faqData = [];
  var _currentCategory = "全部";
  var _searchQuery = "";

  function init(data) {
    _faqData = data || [];
    renderCategories();
    renderFaqs();
    bindSearch();
  }

  function bindSearch() {
    var searchInput = document.getElementById("faq-search");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        _searchQuery = e.target.value.trim();
        renderFaqs();
      });
    }
  }

  function getCategories() {
    var categories = ["全部"];
    var categorySet = {};
    _faqData.forEach(function (faq) {
      if (faq.category) {
        categorySet[faq.category] = true;
      }
    });
    Object.keys(categorySet).forEach(function (cat) {
      categories.push(cat);
    });
    return categories;
  }

  function renderCategories() {
    var container = document.getElementById("faq-categories");
    if (!container) return;

    var categories = getCategories();
    var html = "";
    categories.forEach(function (cat) {
      var activeClass = _currentCategory === cat ? " active" : "";
      html += '<button class="faq-chip' + activeClass + '"';
      html += ' onclick="window.FaqService.filterByCategory(\'' + cat + '\')">';
      html += cat;
      html += "</button>";
    });
    container.innerHTML = html;
  }

  function filterByCategory(category) {
    _currentCategory = category;
    renderCategories();
    renderFaqs();
  }

  function filterFaqs() {
    var filtered = _faqData.slice();

    if (_currentCategory !== "全部") {
      filtered = filtered.filter(function (faq) {
        return faq.category === _currentCategory;
      });
    }

    if (_searchQuery) {
      var query = _searchQuery.toLowerCase();
      filtered = filtered.filter(function (faq) {
        var questionMatch = faq.question && faq.question.toLowerCase().indexOf(query) !== -1;
        var answerMatch = faq.answer && faq.answer.toLowerCase().indexOf(query) !== -1;
        var keywordMatch = faq.keywords && faq.keywords.some(function (kw) {
          return kw.toLowerCase().indexOf(query) !== -1;
        });
        return questionMatch || answerMatch || keywordMatch;
      });
    }

    filtered.sort(function (a, b) {
      return (b.priority || 0) - (a.priority || 0);
    });

    return filtered;
  }

  function getFaqById(faqId) {
    return _faqData.find(function (faq) {
      return faq.faqId === faqId;
    });
  }

  function renderFaqs() {
    var container = document.getElementById("faq-list");
    if (!container) return;

    var filtered = filterFaqs();

    if (filtered.length === 0) {
      container.innerHTML = '<div class="faq-empty">暂无匹配的常见问题</div>';
      return;
    }

    var html = "";
    filtered.forEach(function (faq) {
      var icon = faq.priority && faq.priority >= 80 ? "\u2605" : "\u25B6";
      html += '<div class="faq-item" data-faq-id="' + faq.faqId + '">';
      html += '<div class="faq-question" onclick="window.FaqService.toggleFaq(\'' + faq.faqId + '\')">';
      html += '<span class="faq-icon">' + icon + "</span>";
      html += "<span class=\"faq-text\">" + faq.question + "</span>";
      html += "</div>";
      html += '<div class="faq-answer" id="faq-answer-' + faq.faqId + '">';
      html += "<p>" + faq.answer + "</p>";
      if (faq.relatedFaqIds && faq.relatedFaqIds.length > 0) {
        html += renderRelatedFaqs(faq.relatedFaqIds);
      }
      html += "</div>";
      html += "</div>";
    });
    container.innerHTML = html;
  }

  function renderRelatedFaqs(relatedIds) {
    var relatedFaqs = relatedIds
      .map(function (id) { return getFaqById(id); })
      .filter(Boolean);

    if (relatedFaqs.length === 0) return "";

    var html = '<div class="faq-related">';
    html += '<span class="related-title">相关问题：</span>';
    html += '<div class="related-list">';
    relatedFaqs.forEach(function (rf) {
      html += '<button class="related-item" onclick="window.FaqService.showFaq(\'' + rf.faqId + '\')">';
      html += rf.question;
      html += "</button>";
    });
    html += "</div>";
    html += "</div>";
    return html;
  }

  function toggleFaq(faqId) {
    var answer = document.getElementById("faq-answer-" + faqId);
    var question = document.querySelector('[data-faq-id="' + faqId + '"] .faq-question');

    if (answer) {
      answer.classList.toggle("show");
    }
    if (question) {
      question.classList.toggle("expanded");
    }
  }

  function showFaq(faqId) {
    toggleFaq(faqId);
    var element = document.querySelector('[data-faq-id="' + faqId + '"]');
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return {
    init: init,
    filterByCategory: filterByCategory,
    toggleFaq: toggleFaq,
    showFaq: showFaq
  };
})();
