/**
 * searchService.js - 搜索服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 提供本地地址点和关键词索引的模糊匹配搜索,渲染搜索建议下拉列表,
 *       选中结果后通过回调触发地图定位(地址点→坐标反查学区,关键词→关联 zoneId)。
 *
 * 关键接口:
 *   init(data)                          - 初始化,接收完整数据对象
 *   setOnZoneMatched(fn)                - 设置关键词匹配学区后的回调
 *   setOnPointResolved(fn)              - 设置地址点坐标解析后的回调
 *
 * 数据格式:
 *   addressPoint = { name, fullAddress, lng, lat, aliases[] }
 *   keywordsIndex = { keyword, aliases[], matchedZoneIds[], type, displayName }
 *
 * 搜索算法: 大小写不敏感的 includes 匹配,同时搜索 name/fullAddress/aliases
 */
window.SearchService = (() => {
  let _addressPoints = [];
  let _keywordsIndex = [];
  let _zones = null;
  let _onZoneMatched = null;
  let _onPointResolved = null;

  let _searchInput = null;
  let _searchClearBtn = null;
  let _searchSuggestions = null;

  /** XSS 安全文本转义,委托给 RenderService.safeText */
  const escapeHtml = (str) => window.RenderService.safeText(str);

  /** 初始化:存储搜索数据,绑定搜索框 input/keydown 事件和清除按钮 */
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

  /** 设置关键词匹配学区后的回调函数 */
  const setOnZoneMatched = (fn) => {
    _onZoneMatched = fn;
  };

  /** 设置地址点坐标解析后的回调函数 */
  const setOnPointResolved = (fn) => {
    _onPointResolved = fn;
  };

  /** 搜索框 input 事件处理:实时搜索并渲染建议列表 */
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

  /** 搜索框 keydown 事件处理:Enter 键选中第一个结果 */
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

  /** 核心搜索:遍历地址点和关键词索引,返回匹配结果数组 */
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

  /** 文本匹配:大小写不敏感 includes */
  const matchText = (text, q) => {
    if (!text) return false;
    return text.toLowerCase().includes(q);
  };

  /** 别名数组匹配:任一别名包含查询词即命中 */
  const matchAliases = (aliases, q) => {
    if (!aliases || !aliases.length) return false;
    return aliases.some((alias) => alias && alias.toLowerCase().includes(q));
  };

  /** 渲染搜索建议下拉列表,绑定点击事件 */
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

  /** 选中搜索结果:地址点触发 onPointResolved,关键词触发 onZoneMatched */
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

  /** 显示"未找到匹配结果"提示 */
  const showNoResult = () => {
    if (!_searchSuggestions) return;
    _searchSuggestions.innerHTML = `<div class="search-no-result">未找到匹配结果</div>`;
    _searchSuggestions.style.display = "block";
  };

  /** 隐藏搜索建议下拉列表 */
  const hideSuggestions = () => {
    if (_searchSuggestions) {
      _searchSuggestions.style.display = "none";
      _searchSuggestions.innerHTML = "";
    }
  };

  /** 公共接口 */
  return {
    init,
    setOnZoneMatched,
    setOnPointResolved,
  };
})();
