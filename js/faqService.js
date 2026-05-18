/**
 * faqService.js - 常见问题服务
 *
 * 功能: 渲染 FAQ 列表,支持关键词搜索和分类筛选,问题可展开/收起,
 *       支持关联问题跳转。
 *
 * 关键接口:
 *   init(data)                    - 初始化,接收 faq 数组
 *   filterByCategory(category)    - 按分类筛选(供 onclick 调用)
 *   toggleFaq(faqId)              - 展开/收起指定问题
 *   showFaq(faqId)                - 展开并滚动到指定问题
 *
 * 数据格式:
 *   faq = { faqId, question, answer, category, priority, keywords[], relatedFaqIds[] }
 */
window.FaqService = (() => {
  let _faqData = [];
  let _currentCategory = "全部";
  let _searchQuery = "";

  /** 初始化:存储 FAQ 数据,渲染分类标签、列表和搜索框 */
  const init = (data) => {
    _faqData = data || [];
    renderCategories();
    renderFaqs();
    bindSearch();
  };

  /** 绑定搜索框 input 事件,实时过滤 FAQ */
  const bindSearch = () => {
    const searchInput = document.getElementById("faq-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        _searchQuery = e.target.value.trim();
        renderFaqs();
      });
    }
  };

  /** 从 FAQ 数据中提取去重后的分类列表,前置"全部" */
  const getCategories = () => {
    const categories = ["全部"];
    const categorySet = {};
    _faqData.forEach((faq) => {
      if (faq.category) {
        categorySet[faq.category] = true;
      }
    });
    Object.keys(categorySet).forEach((cat) => {
      categories.push(cat);
    });
    return categories;
  };

  /** 渲染分类标签按钮组 */
  const renderCategories = () => {
    const container = document.getElementById("faq-categories");
    if (!container) return;

    const categories = getCategories();
    let html = "";
    categories.forEach((cat) => {
      const activeClass = _currentCategory === cat ? " active" : "";
      html += `<button class="faq-chip${activeClass}"`;
      html += ` onclick="window.FaqService.filterByCategory('${cat}')">`;
      html += cat;
      html += `</button>`;
    });
    container.innerHTML = html;
  };

  /** 按分类筛选并重新渲染分类标签和 FAQ 列表 */
  const filterByCategory = (category) => {
    _currentCategory = category;
    renderCategories();
    renderFaqs();
  };

  /** 过滤 FAQ:按分类和搜索关键词过滤,结果按 priority 降序排列 */
  const filterFaqs = () => {
    let filtered = _faqData.slice();

    if (_currentCategory !== "全部") {
      filtered = filtered.filter((faq) => faq.category === _currentCategory);
    }

    if (_searchQuery) {
      const query = _searchQuery.toLowerCase();
      filtered = filtered.filter((faq) => {
        const questionMatch =
          faq.question && faq.question.toLowerCase().includes(query);
        const answerMatch =
          faq.answer && faq.answer.toLowerCase().includes(query);
        const keywordMatch =
          faq.keywords &&
          faq.keywords.some((kw) => kw.toLowerCase().includes(query));
        return questionMatch || answerMatch || keywordMatch;
      });
    }

    filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return filtered;
  };

  /** 根据 faqId 查找 FAQ 项 */
  const getFaqById = (faqId) => _faqData.find((faq) => faq.faqId === faqId);

  /** 渲染 FAQ 列表,高优先级(≥80)显示星标图标 */
  const renderFaqs = () => {
    const container = document.getElementById("faq-list");
    if (!container) return;

    const filtered = filterFaqs();

    if (filtered.length === 0) {
      container.innerHTML = `<div class="faq-empty">暂无匹配的常见问题</div>`;
      return;
    }

    let html = "";
    filtered.forEach((faq) => {
      const icon = faq.priority && faq.priority >= 80 ? "\u2605" : "\u25B6";
      html += `<div class="faq-item" data-faq-id="${faq.faqId}">`;
      html += `<div class="faq-question" onclick="window.FaqService.toggleFaq('${faq.faqId}')">`;
      html += `<span class="faq-icon">${icon}</span>`;
      html += `<span class="faq-text">${faq.question}</span>`;
      html += `</div>`;
      html += `<div class="faq-answer" id="faq-answer-${faq.faqId}">`;
      html += `<p>${faq.answer}</p>`;
      if (faq.relatedFaqIds && faq.relatedFaqIds.length > 0) {
        html += renderRelatedFaqs(faq.relatedFaqIds);
      }
      html += `</div>`;
      html += `</div>`;
    });
    container.innerHTML = html;
  };

  /** 渲染关联问题按钮列表 */
  const renderRelatedFaqs = (relatedIds) => {
    const relatedFaqs = relatedIds.map((id) => getFaqById(id)).filter(Boolean);

    if (relatedFaqs.length === 0) return "";

    let html = `<div class="faq-related">`;
    html += `<span class="related-title">相关问题：</span>`;
    html += `<div class="related-list">`;
    relatedFaqs.forEach((rf) => {
      html += `<button class="related-item" onclick="window.FaqService.showFaq('${rf.faqId}')">`;
      html += rf.question;
      html += `</button>`;
    });
    html += `</div>`;
    html += `</div>`;
    return html;
  };

  /** 切换指定 FAQ 的展开/收起状态 */
  const toggleFaq = (faqId) => {
    const answer = document.getElementById(`faq-answer-${faqId}`);
    const question = document.querySelector(
      `[data-faq-id="${faqId}"] .faq-question`,
    );

    if (answer) {
      answer.classList.toggle("show");
    }
    if (question) {
      question.classList.toggle("expanded");
    }
  };

  /** 展开指定 FAQ 并平滑滚动到该位置 */
  const showFaq = (faqId) => {
    toggleFaq(faqId);
    const element = document.querySelector(`[data-faq-id="${faqId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  /** 公共接口 */
  return {
    init,
    filterByCategory,
    toggleFaq,
    showFaq,
  };
})();
