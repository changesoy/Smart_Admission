/**
 * searchService.js - 搜索服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 提供本地地址点和关键词索引的模糊匹配搜索,渲染搜索建议下拉列表,
 *       支持上下键导航和 Enter 选中。选中结果后通过回调触发地图定位。
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
 *           关键词命中多个 matchedZoneIds 时展开为多个候选项
 */
window.SearchService = (() => {
  var _addressPoints = [];
  var _keywordsIndex = [];
  var _onZoneMatched = null;
  var _onPointResolved = null;

  var _searchInput = null;
  var _searchClearBtn = null;
  var _searchSuggestions = null;

  var _lastResults = [];
  var _activeIndex = -1;

  /** 在线查询状态: 防止并发重复请求 */
  var _onlinePending = false;
  var _onlineAbort = null;

  const escapeHtml = (str) => window.RenderService.safeText(str);

  /** 初始化:存储搜索数据,绑定搜索框 input/keydown 事件和清除按钮 */
  const init = (data) => {
    _addressPoints = (data && data.addressPoints) || [];
    _keywordsIndex = (data && data.keywordsIndex) || [];

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
        _lastResults = [];
        _activeIndex = -1;
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

  /** 搜索框 input 事件处理:实时搜索并渲染建议列表,维护 _lastResults 和 _activeIndex */
  const handleInput = () => {
    const query = (_searchInput.value || "").trim();
    if (_searchClearBtn) {
      _searchClearBtn.style.display = query ? "inline-block" : "none";
    }
    if (!query) {
      _lastResults = [];
      _activeIndex = -1;
      hideSuggestions();
      return;
    }
    _lastResults = search(query).slice(0, 10);
    _activeIndex = _lastResults.length > 0 ? 0 : -1;
    console.log("[Search] 输入:", query, "本地结果数:", _lastResults.length);
    renderSuggestions(_lastResults, query);
  };

  /** 搜索框 keydown 事件处理:↑↓ 切换高亮,Enter 选中,Esc 关闭 */
  const handleKeydown = (e) => {
    if (!_lastResults.length && e.key !== "Enter") return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      _activeIndex = (_activeIndex + 1) % _lastResults.length;
      updateActiveSuggestion();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      _activeIndex =
        (_activeIndex - 1 + _lastResults.length) % _lastResults.length;
      updateActiveSuggestion();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const query = (_searchInput.value || "").trim();
      if (!query) return;
      if (_lastResults.length > 0) {
        console.log(
          "[Search] Enter - 走本地匹配，选中第",
          _activeIndex >= 0 ? _activeIndex : 0,
          "项",
        );
        const index = _activeIndex >= 0 ? _activeIndex : 0;
        selectItem(_lastResults[index]);
      } else {
        console.log("[Search] Enter - 本地无结果，走联网查询:", query);
        queryOnline(query);
      }
    }

    if (e.key === "Escape") {
      hideSuggestions();
    }
  };

  /** 更新建议列表中高亮项的 CSS 类 */
  const updateActiveSuggestion = () => {
    if (!_searchSuggestions) return;
    const items = _searchSuggestions.querySelectorAll(
      ".search-suggestion-item",
    );
    items.forEach((item, index) => {
      item.classList.toggle("active", index === _activeIndex);
    });
  };

  /** 核心搜索:遍历地址点和关键词索引,关键词命中多学区时展开为多个候选项 */
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
        const zoneIds = item.matchedZoneIds || [];
        if (zoneIds.length > 1) {
          zoneIds.forEach((zoneId) => {
            results.push({
              source: "keywordZone",
              data: {
                ...item,
                zoneId,
                displayName: `${item.displayName || item.keyword} - ${zoneId}`,
              },
            });
          });
        } else {
          results.push({
            source: "keyword",
            data: item,
          });
        }
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

  /** 联网查询: 调用天地图地理编码 API，返回坐标后走 Turf 点面判断 */
  var queryOnline = function (query) {
    if (!_searchSuggestions) return;
    console.log("[Search] queryOnline 被调用，query:", query);

    // 取消上一轮尚未完成的请求
    if (_onlineAbort) {
      _onlineAbort.abort();
      _onlineAbort = null;
    }

    _onlinePending = true;
    _searchSuggestions.innerHTML =
      '<div class="search-no-result">正在联网查询"' +
      escapeHtml(query) +
      '"...</div>';
    _searchSuggestions.style.display = "block";

    // 加上"泰安市"前缀，避免天地图匹配到其他城市同名地址
    var ds = JSON.stringify({ keyWord: "泰安市" + query });
    var token =
      window.AppConfig && window.AppConfig.tianditu
        ? window.AppConfig.tianditu.token
        : "";
    var url =
      "https://api.tianditu.gov.cn/geocoder?ds=" +
      encodeURIComponent(ds) +
      "&tk=" +
      token;

    _onlineAbort = new AbortController();
    var signal = _onlineAbort.signal;

    fetch(url, { signal: signal })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        _onlinePending = false;
        _onlineAbort = null;
        console.log(
          "[Search] API 返回:",
          data && data.status,
          data && data.location,
        );
        if (data && data.status === "0" && data.location) {
          var lng = parseFloat(data.location.lon);
          var lat = parseFloat(data.location.lat);
          if (
            !isNaN(lng) &&
            !isNaN(lat) &&
            typeof _onPointResolved === "function"
          ) {
            // 校验坐标是否在泰山区/岱岳区/泰山景区范围内
            var bounds = window.AppConfig && window.AppConfig.searchBounds;
            if (bounds) {
              if (
                lng < bounds.minLng ||
                lng > bounds.maxLng ||
                lat < bounds.minLat ||
                lat > bounds.maxLat
              ) {
                console.log(
                  "[Search] 坐标超出范围:",
                  lng,
                  lat,
                  "允许:",
                  bounds,
                );
                showNoResult(
                  "查询结果不在泰山区/岱岳区/泰山景区范围内，请尝试更完整的地址",
                );
                return;
              }
            }
            hideSuggestions();
            _onPointResolved(lng, lat);
            return;
          }
        }
        // 在线查询也无结果，区分于本地无结果
        showNoResult("联网查询也无结果，请尝试更完整的地址");
      })
      .catch(function (err) {
        _onlinePending = false;
        _onlineAbort = null;
        if (err && err.name === "AbortError") return;
        showNoResult("联网查询失败，请稍后重试");
      });
  };

  /** 渲染搜索建议下拉列表,当前高亮项添加 active 类,绑定点击事件 */
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
        r.source === "addressPoint"
          ? "地址"
          : r.source === "keywordZone"
            ? "学区"
            : item.type || "关键词";
      const displayName =
        r.source === "addressPoint"
          ? item.name
          : item.displayName || item.keyword;
      const subText = r.source === "addressPoint" ? item.fullAddress : "";
      const activeClass = i === _activeIndex ? " active" : "";

      html += `<div class="search-suggestion-item${activeClass}" data-index="${i}">`;
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

  /** 选中搜索结果:地址点触发 onPointResolved,关键词/关键词学区触发 onZoneMatched */
  const selectItem = (result) => {
    hideSuggestions();
    if (!result) return;

    if (result.source === "addressPoint") {
      const item = result.data;
      if (typeof _onPointResolved === "function") {
        _onPointResolved(item.lng, item.lat, item);
      }
    } else if (result.source === "keywordZone") {
      const kw = result.data;
      if (typeof _onZoneMatched === "function") {
        _onZoneMatched(kw.zoneId, kw);
      }
    } else if (result.source === "keyword") {
      const kw = result.data;
      const zoneIds = kw.matchedZoneIds || [];
      if (zoneIds.length === 0) {
        console.warn("关键词未关联任何学区:", kw.keyword);
        return;
      }
      if (typeof _onZoneMatched === "function") {
        _onZoneMatched(zoneIds[0], kw);
      }
    }
  };

  var showNoResult = function (msg) {
    if (!_searchSuggestions) return;
    _searchSuggestions.innerHTML =
      '<div class="search-no-result">' + (msg || "未找到匹配结果") + "</div>";
    _searchSuggestions.style.display = "block";
  };

  var hideSuggestions = function () {
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
