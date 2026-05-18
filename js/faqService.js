const FaqService = (function() {
  let faqData = [];
  let currentCategory = '全部';
  let searchQuery = '';

  function init(data) {
    faqData = data || [];
    renderCategories();
    renderFaqs();
    bindSearch();
  }

  function bindSearch() {
    const searchInput = document.getElementById('faq-search');
    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        searchQuery = e.target.value.trim();
        renderFaqs();
      });
    }
  }

  function getCategories() {
    const categories = ['全部'];
    const categorySet = new Set();
    
    faqData.forEach(faq => {
      if (faq.category) {
        categorySet.add(faq.category);
      }
    });
    
    categories.push(...Array.from(categorySet));
    return categories;
  }

  function renderCategories() {
    const container = document.getElementById('faq-categories');
    if (!container) return;

    const categories = getCategories();
    container.innerHTML = categories.map(cat => `
      <button 
        class="faq-chip ${currentCategory === cat ? 'active' : ''}"
        onclick="window.FaqService.filterByCategory('${cat}')"
      >
        ${cat}
      </button>
    `).join('');
  }

  function filterByCategory(category) {
    currentCategory = category;
    renderCategories();
    renderFaqs();
  }

  function filterFaqs() {
    let filtered = [...faqData];
    
    if (currentCategory !== '全部') {
      filtered = filtered.filter(faq => faq.category === currentCategory);
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(faq => {
        const questionMatch = faq.question?.toLowerCase().includes(query);
        const answerMatch = faq.answer?.toLowerCase().includes(query);
        const keywordMatch = faq.keywords?.some(kw => kw.toLowerCase().includes(query));
        return questionMatch || answerMatch || keywordMatch;
      });
    }
    
    filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    return filtered;
  }

  function getFaqById(faqId) {
    return faqData.find(faq => faq.faqId === faqId);
  }

  function renderFaqs() {
    const container = document.getElementById('faq-list');
    if (!container) return;

    const filtered = filterFaqs();
    
    if (filtered.length === 0) {
      container.innerHTML = '<div class="faq-empty">暂无匹配的常见问题</div>';
      return;
    }

    container.innerHTML = filtered.map(faq => `
      <div class="faq-item" data-faq-id="${faq.faqId}">
        <div class="faq-question" onclick="window.FaqService.toggleFaq('${faq.faqId}')">
          <span class="faq-icon">${faq.priority && faq.priority >= 80 ? '★' : '▶'}</span>
          <span class="faq-text">${faq.question}</span>
        </div>
        <div class="faq-answer" id="faq-answer-${faq.faqId}">
          <p>${faq.answer}</p>
          ${faq.relatedFaqIds && faq.relatedFaqIds.length > 0 ? renderRelatedFaqs(faq.relatedFaqIds) : ''}
        </div>
      </div>
    `).join('');
  }

  function renderRelatedFaqs(relatedIds) {
    const relatedFaqs = relatedIds
      .map(id => getFaqById(id))
      .filter(Boolean);
    
    if (relatedFaqs.length === 0) return '';

    return `
      <div class="faq-related">
        <span class="related-title">相关问题：</span>
        <div class="related-list">
          ${relatedFaqs.map(rf => `
            <button class="related-item" onclick="window.FaqService.showFaq('${rf.faqId}')">
              ${rf.question}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function toggleFaq(faqId) {
    const answer = document.getElementById(`faq-answer-${faqId}`);
    const question = document.querySelector(`[data-faq-id="${faqId}"] .faq-question`);
    
    if (answer) {
      answer.classList.toggle('show');
    }
    if (question) {
      question.classList.toggle('expanded');
    }
  }

  function showFaq(faqId) {
    toggleFaq(faqId);
    const element = document.querySelector(`[data-faq-id="${faqId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return {
    init,
    filterByCategory,
    toggleFaq,
    showFaq
  };
})();

window.FaqService = FaqService;