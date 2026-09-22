/**
 * searchService.js - 搜索服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 提供本地地址点和关键词索引的模糊匹配搜索,渲染搜索建议下拉列表,
 *       支持上下键导航和 Enter 选中。本地无匹配或地址点坐标缺失时,
 *       经服务端 /api/search 代理联网查询(支持取消前次请求、多结果选择),
 *       选中结果后通过回调触发地图定位。
 *
 * 边界说明: 联网查询不直连天地图。搜索 token 只存在于服务端环境变量,范围过滤
 *           (泰山区/岱岳区/泰山景区) 也在服务端完成,前端不持有搜索地址与 token。
 *
 * 关键接口:
 *   init(data)                          - 初始化,接收完整数据对象
 *   setOnZoneMatched(fn)                - 设置关键词匹配学区后的回调
 *   setOnPointResolved(fn)              - 设置地址点/在线POI坐标解析后的回调
 *
 * 数据格式:
 *   addressPoint = { name, fullAddress, lng, lat, aliases[] }
 *   keywordsIndex = { keyword, aliases[], matchedZoneIds[], type, displayName }
 *   在线结果(服务端已归一) = { uid, name, address, lng, lat }
 *
 * 搜索算法: 大小写不敏感的 includes 匹配,同时搜索 name/fullAddress/aliases
 *           关键词命中多个 matchedZoneIds 时展开为多个候选项
 */
import AppConfig from "./config.js";
import RenderService from "./render.js";

/** 本地无命中后等待多久(ms)再联网查询,兼顾响应速度与后端 30 次/分钟的限流 */
const ONLINE_DEBOUNCE_MS = 400;

const SearchService = (() => {
  let _addressPoints = [];
  let _keywordsIndex = [];
  let _onZoneMatched = null;
  let _onPointResolved = null;

  let _searchInput = null;
  let _searchClearBtn = null;
  let _searchSuggestions = null;

  let _lastResults = [];
  let _activeIndex = -1;

  /** 在线查询状态: AbortController,发起新请求前取消前一次 */
  let _onlineAbort = null;

  /** 输入防抖定时器: 本地无命中时延迟触发联网查询,避免逐字符打满上游限流 */
  let _inputTimer = null;

  /** 在线查询序号: 只有最新一次请求的响应允许落地,防止旧响应覆盖新结果 */
  let _onlineSeq = 0;

  /** 作废待发的联网查询与进行中的请求(输入变化、清空、重新发起时调用) */
  const cancelPendingOnline = () => {
    if (_inputTimer) {
      clearTimeout(_inputTimer);
      _inputTimer = null;
    }
    if (_onlineAbort) {
      _onlineAbort.abort();
      _onlineAbort = null;
    }
  };

  const escapeHtml = (str) => RenderService.safeText(str);

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
        cancelPendingOnline();
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

  /** 搜索框 input 事件处理:实时搜索并渲染建议列表,本地无命中时防抖联网查询 */
  const handleInput = () => {
    const query = (_searchInput.value || "").trim();

    // 输入变化即作废上一次待发/进行中的联网查询
    cancelPendingOnline();

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
    renderSuggestions(_lastResults);

    // 本地无命中时自动联网查询(防抖 400ms),与 Enter 走同一分支
    if (_lastResults.length === 0) {
      _inputTimer = setTimeout(() => {
        _inputTimer = null;
        queryOnline(query);
      }, ONLINE_DEBOUNCE_MS);
    }
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
        const index = _activeIndex >= 0 ? _activeIndex : 0;
        const result = _lastResults[index];
        // 本地地址点坐标无效时，走联网查询
        if (
          result.source === "addressPoint" &&
          (result.data.lng == null || result.data.lat == null)
        ) {
          console.log("[Search] Enter - 本地匹配坐标为空，走联网查询:", query);
          queryOnline(query);
          return;
        }
        console.log("[Search] Enter - 走本地匹配，选中第", index, "项");
        selectItem(result);
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

  /** 服务端错误码 → 面向用户的提示文案;细节保留在 console 里供排查 */
  const errorMessageOf = (code) => {
    switch (code) {
      case "RATE_LIMITED":
        return "查询过于频繁，请稍后重试";
      case "TOKEN_MISSING":
        return "搜索服务未配置密钥，请联系管理员";
      case "UPSTREAM_TIMEOUT":
        return "联网查询超时，请稍后重试";
      default:
        return "联网查询失败，请稍后重试";
    }
  };

  /** 联网查询:经服务端 /api/search 代理查询 POI(token 与范围过滤均在服务端) */
  const queryOnline = (query) => {
    if (!_searchSuggestions) return;
    console.log("[Search] queryOnline 被调用，query:", query);

    cancelPendingOnline();

    _searchSuggestions.innerHTML = `<div class="search-no-result">正在联网查询"${escapeHtml(query)}"...</div>`;
    _searchSuggestions.style.display = "block";

    const url = `${AppConfig.searchApi}?q=${encodeURIComponent(query)}&count=10`;

    _onlineAbort = new AbortController();
    const { signal } = _onlineAbort;
    const seq = ++_onlineSeq;

    fetch(url, { signal })
      .then((res) =>
        res
          .json()
          .then((payload) => ({ res, payload }))
          .catch(() => ({ res, payload: null })),
      )
      .then(({ res, payload }) => {
        if (seq !== _onlineSeq) return;
        _onlineAbort = null;

        if (!res.ok || !payload || payload.ok !== true) {
          const code =
            payload && payload.error
              ? payload.error.code
              : `HTTP_${res.status}`;
          console.warn("[Search] 搜索代理返回错误:", code);
          showNoResult(errorMessageOf(code));
          return;
        }

        const pois = payload.results || [];
        console.log(
          "[Search] 服务端返回结果数:",
          pois.length,
          "cached:",
          payload.cached,
        );

        if (pois.length === 0) {
          showNoResult(
            "未找到匹配结果，请尝试更完整的地址（服务范围限泰山区、岱岳区、泰山景区）",
          );
          return;
        }

        if (pois.length === 1) {
          hideSuggestions();
          if (typeof _onPointResolved === "function") {
            _onPointResolved(pois[0].lng, pois[0].lat);
          }
          return;
        }

        // 多个结果：展示建议列表让用户选择
        _lastResults = pois.map((poi) => ({
          source: "onlinePoi",
          data: poi,
        }));
        _activeIndex = 0;
        renderSuggestions(_lastResults);
      })
      .catch((err) => {
        if (seq !== _onlineSeq) return;
        _onlineAbort = null;
        if (err && err.name === "AbortError") return;
        console.warn("[Search] 联网查询请求失败:", err);
        showNoResult("联网查询失败，请稍后重试");
      });
  };

  /** 渲染搜索建议下拉列表,当前高亮项添加 active 类,绑定点击事件 */
  const renderSuggestions = (results) => {
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
          : r.source === "onlinePoi"
            ? "联网"
            : r.source === "keywordZone"
              ? "学区"
              : item.type || "关键词";
      const displayName =
        r.source === "addressPoint"
          ? item.name
          : r.source === "onlinePoi"
            ? item.name
            : item.displayName || item.keyword;
      const subText =
        r.source === "addressPoint"
          ? item.fullAddress
          : r.source === "onlinePoi"
            ? item.address
            : "";
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

  /** 选中搜索结果:地址点/在线POI触发 onPointResolved,关键词/关键词学区触发 onZoneMatched */
  const selectItem = (result) => {
    hideSuggestions();
    if (!result) return;

    if (result.source === "addressPoint") {
      const item = result.data;
      if (item.lng == null || item.lat == null) {
        console.warn("selectItem: 地址点坐标为空，走联网查询:", item.name);
        queryOnline(item.name || item.fullAddress || "");
        return;
      }
      if (typeof _onPointResolved === "function") {
        _onPointResolved(item.lng, item.lat, item);
      }
    } else if (result.source === "onlinePoi") {
      const poi = result.data;
      if (typeof _onPointResolved === "function") {
        _onPointResolved(poi.lng, poi.lat);
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

  const showNoResult = (msg) => {
    if (!_searchSuggestions) return;
    _searchSuggestions.innerHTML = `<div class="search-no-result">${msg || "未找到匹配结果"}</div>`;
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

export default SearchService;
