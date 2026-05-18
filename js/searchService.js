/* searchService.js - 搜索服务(本地地址点 + 关键词匹配) */

window.SearchService = (function () {
  var _addressPoints = [];
  var _keywordsIndex = [];
  var _zones = null;
  var _onZoneMatched = null;
  var _onPointResolved = null;

  var _searchInput = null;
  var _searchClearBtn = null;
  var _searchSuggestions = null;

  function init(data) {
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
      _searchClearBtn.addEventListener("click", function () {
        _searchInput.value = "";
        hideSuggestions();
        _searchClearBtn.style.display = "none";
        _searchInput.focus();
      });
    }

    document.addEventListener("click", function (e) {
      if (_searchSuggestions && !_searchSuggestions.contains(e.target) && e.target !== _searchInput) {
        hideSuggestions();
      }
    });
  }

  function setOnZoneMatched(fn) {
    _onZoneMatched = fn;
  }

  function setOnPointResolved(fn) {
    _onPointResolved = fn;
  }

  function handleInput() {
    var query = (_searchInput.value || "").trim();
    if (_searchClearBtn) {
      _searchClearBtn.style.display = query ? "inline-block" : "none";
    }
    if (!query) {
      hideSuggestions();
      return;
    }
    var results = search(query);
    renderSuggestions(results, query);
  }

  function handleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var query = (_searchInput.value || "").trim();
      if (!query) return;
      var results = search(query);
      if (results.length > 0) {
        selectItem(results[0]);
      } else {
        showNoResult();
      }
    }
  }

  function search(query) {
    var q = query.toLowerCase();
    var results = [];

    var i, item;
    for (i = 0; i < _addressPoints.length; i++) {
      item = _addressPoints[i];
      if (matchText(item.name, q) || matchText(item.fullAddress, q) || matchAliases(item.aliases, q)) {
        results.push({
          source: "addressPoint",
          data: item
        });
      }
    }

    for (i = 0; i < _keywordsIndex.length; i++) {
      item = _keywordsIndex[i];
      if (matchText(item.keyword, q) || matchAliases(item.aliases, q)) {
        results.push({
          source: "keyword",
          data: item
        });
      }
    }

    return results;
  }

  function matchText(text, q) {
    if (!text) return false;
    return text.toLowerCase().indexOf(q) !== -1;
  }

  function matchAliases(aliases, q) {
    if (!aliases || !aliases.length) return false;
    for (var i = 0; i < aliases.length; i++) {
      if (aliases[i] && aliases[i].toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  function renderSuggestions(results, query) {
    if (!_searchSuggestions) return;

    if (results.length === 0) {
      showNoResult();
      return;
    }

    var html = "";
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var item = r.data;
      var typeTag = r.source === "addressPoint" ? "地址" : (item.type || "关键词");
      var displayName = r.source === "addressPoint" ? item.name : (item.displayName || item.keyword);
      var subText = r.source === "addressPoint" ? item.fullAddress : "";

      html += '<div class="search-suggestion-item" data-index="' + i + '">';
      html += '<span class="search-type-tag">' + escapeHtml(typeTag) + '</span>';
      html += '<span class="search-keyword">' + escapeHtml(displayName) + '</span>';
      if (subText) {
        html += '<small class="text-muted ms-1">' + escapeHtml(subText) + '</small>';
      }
      html += '</div>';
    }

    _searchSuggestions.innerHTML = html;
    _searchSuggestions.style.display = "block";

    var items = _searchSuggestions.querySelectorAll(".search-suggestion-item");
    for (var j = 0; j < items.length; j++) {
      (function (idx) {
        items[idx].addEventListener("click", function () {
          selectItem(results[idx]);
        });
      })(j);
    }
  }

  function selectItem(result) {
    hideSuggestions();
    if (!result) return;

    if (result.source === "addressPoint") {
      var item = result.data;
      if (typeof _onPointResolved === "function") {
        _onPointResolved(item.lng, item.lat, item);
      }
    } else if (result.source === "keyword") {
      var kw = result.data;
      var zoneIds = kw.matchedZoneIds || [];
      if (zoneIds.length === 0) {
        console.warn("关键词未关联任何学区:", kw.keyword);
        return;
      }
      var zoneId = zoneIds[0];
      if (zoneIds.length > 1) {
        console.warn("多个候选学区，当前使用第一个:", zoneIds);
      }
      if (typeof _onZoneMatched === "function") {
        _onZoneMatched(zoneId, kw);
      }
    }
  }

  function showNoResult() {
    if (!_searchSuggestions) return;
    _searchSuggestions.innerHTML = '<div class="search-no-result">未找到匹配结果</div>';
    _searchSuggestions.style.display = "block";
  }

  function hideSuggestions() {
    if (_searchSuggestions) {
      _searchSuggestions.style.display = "none";
      _searchSuggestions.innerHTML = "";
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    init: init,
    setOnZoneMatched: setOnZoneMatched,
    setOnPointResolved: setOnPointResolved
  };
})();
