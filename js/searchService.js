/* searchService.js - 搜索服务(本地地址点 + 关键词匹配) */

window.SearchService = (() => {
  let _addressPoints = [];
  let _keywordsIndex = [];
  let _zones = null;
  let _onZoneMatched = null;
  let _onPointResolved = null;

  let _searchInput = null;
  let _searchClearBtn = null;
  let _searchSuggestions = null;

  const escapeHtml = (str) => window.RenderService.safeText(str);

  const init = (data) => {
    _addressPoints = (data && data.addressPoints) || [];
    _keywordsIndex = (data && data.keywordsIndex) || [];
    _zones = (data && data.zones) || null;

    _searchInput = document.getElementById("searchInput");
    _searchClearBtn = document.getElementById("searchClearBtn");
    _searchSuggestions = document.getElementById("searchSuggestions");

    if (!_searchInput || !_searchSuggestions) {
      console.warn("SearchService: 搜索框或建议列表 DOM 未找到");
      return;
    }

    _searchInput.addEventListener("input", handleInput);
    _searchInput.addEventListener("keydown", handleKeydown);

    if (_searchClearBtn) {
      _searchClearBtn.addEventListener("click", () => {
        _searchInput.value = "";
        hideSuggestions();
        _searchClearBtn.style.display = "none";
        _searchInput.focus();
      });
    }

    document.addEventListener("click", (e) => {
      if (
        _searchSuggestions &&
        !_searchSuggestions.contains(e.target) &&
        e.target !== _searchInput
      ) {
        hideSuggestions();
      }
    });
  };

  const setOnZoneMatched = (fn) => {
    _onZoneMatched = fn;
  };

  const setOnPointResolved = (fn) => {
    _onPointResolved = fn;
  };

  const handleInput = () => {
    const query = (_searchInput.value || "").trim();
    if (_searchClearBtn) {
      _searchClearBtn.style.display = query ? "inline-block" : "none";
    }
    if (!query) {
      hideSuggestions();
      return;
    }
    const results = search(query);
    renderSuggestions(results, query);
  };

  const handleKeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const query = (_searchInput.value || "").trim();
      if (!query) return;
      const results = search(query);
      if (results.length > 0) {
        selectItem(results[0]);
      } else {
        showNoResult();
      }
    }
  };

  const search = (query) => {
    const q = query.toLowerCase();
    const results = [];

    for (const item of _addressPoints) {
      if (
        matchText(item.name, q) ||
        matchText(item.fullAddress, q) ||
        matchAliases(item.aliases, q)
      ) {
        results.push({
          source: "addressPoint",
          data: item,
        });
      }
    }

    for (const item of _keywordsIndex) {
      if (matchText(item.keyword, q) || matchAliases(item.aliases, q)) {
        results.push({
          source: "keyword",
          data: item,
        });
      }
    }

    return results;
  };

  const matchText = (text, q) => {
    if (!text) return false;
    return text.toLowerCase().includes(q);
  };

  const matchAliases = (aliases, q) => {
    if (!aliases || !aliases.length) return false;
    return aliases.some((alias) => alias && alias.toLowerCase().includes(q));
  };

  const renderSuggestions = (results, query) => {
    if (!_searchSuggestions) return;

    if (results.length === 0) {
      showNoResult();
      return;
    }

    let html = "";
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const item = r.data;
      const typeTag =
        r.source === "addressPoint" ? "地址" : item.type || "关键词";
      const displayName =
        r.source === "addressPoint"
          ? item.name
          : item.displayName || item.keyword;
      const subText = r.source === "addressPoint" ? item.fullAddress : "";

      html += `<div class="search-suggestion-item" data-index="${i}">`;
      html += `<span class="search-type-tag">${escapeHtml(typeTag)}</span>`;
      html += `<span class="search-keyword">${escapeHtml(displayName)}</span>`;
      if (subText) {
        html += `<small class="text-muted ms-1">${escapeHtml(subText)}</small>`;
      }
      html += `</div>`;
    }

    _searchSuggestions.innerHTML = html;
    _searchSuggestions.style.display = "block";

    const items = _searchSuggestions.querySelectorAll(
      ".search-suggestion-item",
    );
    for (let j = 0; j < items.length; j++) {
      ((idx) => {
        items[idx].addEventListener("click", () => {
          selectItem(results[idx]);
        });
      })(j);
    }
  };

  const selectItem = (result) => {
    hideSuggestions();
    if (!result) return;

    if (result.source === "addressPoint") {
      const item = result.data;
      if (typeof _onPointResolved === "function") {
        _onPointResolved(item.lng, item.lat, item);
      }
    } else if (result.source === "keyword") {
      const kw = result.data;
      const zoneIds = kw.matchedZoneIds || [];
      if (zoneIds.length === 0) {
        console.warn("关键词未关联任何学区:", kw.keyword);
        return;
      }
      const zoneId = zoneIds[0];
      if (zoneIds.length > 1) {
        console.warn("多个候选学区，当前使用第一个:", zoneIds);
      }
      if (typeof _onZoneMatched === "function") {
        _onZoneMatched(zoneId, kw);
      }
    }
  };

  const showNoResult = () => {
    if (!_searchSuggestions) return;
    _searchSuggestions.innerHTML = `<div class="search-no-result">未找到匹配结果</div>`;
    _searchSuggestions.style.display = "block";
  };

  const hideSuggestions = () => {
    if (_searchSuggestions) {
      _searchSuggestions.style.display = "none";
      _searchSuggestions.innerHTML = "";
    }
  };

  return {
    init,
    setOnZoneMatched,
    setOnPointResolved,
  };
})();
