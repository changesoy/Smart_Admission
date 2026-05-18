/**
 * main.js - 应用主入口
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 协调数据加载、渲染和各模块初始化。使用 async IIFE 在 DOMContentLoaded
 *       时加载数据,成功后依次初始化各业务模块,失败则显示错误状态。
 *
 * 初始化顺序:
 *   1. DataService.loadAllData()  - 并行加载全部数据
 *   2. RenderService.renderStats() - 渲染统计卡片
 *   3. PolicyService.init()       - 初始化政策模块
 *   4. MaterialService.init()     - 初始化材料模块
 *   5. FaqService.init()          - 初始化FAQ模块
 *   6. InteractionService.init()  - 初始化互动模块
 *   7. MapService.initMap()       - 初始化地图(含 onZoneSelected/onNoMatch 回调)
 *   8. SearchService.init()       - 初始化搜索(含 onZoneMatched/onPointResolved 回调)
 */

(async () => {
  document.addEventListener("DOMContentLoaded", async () => {
    showLoading(true);

    try {
      const data = await window.DataService.loadAllData();
      showLoading(false);
      bootstrapPage(data);
    } catch (err) {
      console.error("数据加载失败:", err);
      showLoading(false);
      window.RenderService.renderError(
        err && err.message ? err.message : "未知错误",
      );
    }
  });

  /** 切换加载状态和主内容的显示 */
  const showLoading = (visible) => {
    const loadEl = document.getElementById("loadingState");
    const mainEl = document.getElementById("mainContent");
    if (loadEl) loadEl.style.display = visible ? "block" : "none";
    if (mainEl) mainEl.style.display = visible ? "none" : "block";
    if (visible) {
      const tip = document.getElementById("loadingTip");
      if (tip) tip.textContent = window.AppConfig.texts.loadingTip;
    }
  };

  /** 数据加载成功后初始化所有业务模块,绑定地图回调和学段筛选 */
  const bootstrapPage = (data) => {
    window.RenderService.renderStats(data);
    window.RenderService.renderDefaultResultTip();

    window.PolicyService.init({
      policies: data.policies,
      policyDiff: data.policyDiff,
    });

    window.MaterialService.init(data.materials);

    window.FaqService.init(data.faq);

    window.InteractionService.init(data);

    window.RenderService.setBoundaryNotice();

    window.MapService.initMap({
      zones: data.zones,
      schools: data.schools,
      policies: data.policies,
      onZoneSelected: (feature) => {
        const zoneId =
          feature && feature.properties ? feature.properties.zoneId : "";
        const historyEntry = (data.zonesHistory || []).find(
          (h) => h.zoneId === zoneId,
        );
        window.RenderService.renderResult({
          zoneFeature: feature,
          schools: data.schools,
          policies: data.policies,
          history: historyEntry ? historyEntry.history : [],
        });
        if (window.innerWidth < 992) {
          const panel = document.getElementById("resultPanel");
          if (panel)
            panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      },
      onNoMatch: () => {
        window.RenderService.renderNoMatch();
      },
    });

    if (window.SearchService) {
      window.SearchService.init(data);
      window.SearchService.setOnZoneMatched((zoneId, item) => {
        if (
          window.MapService &&
          typeof window.MapService.flyToZoneById === "function"
        ) {
          window.MapService.flyToZoneById(zoneId);
        }
      });
      window.SearchService.setOnPointResolved((lng, lat, item) => {
        if (
          window.MapService &&
          typeof window.MapService.findZoneByPoint === "function"
        ) {
          const zoneId = window.MapService.findZoneByPoint(lng, lat);
          if (zoneId && typeof window.MapService.flyToZoneById === "function") {
            window.MapService.flyToZoneById(zoneId);
          }
        }
      });
    }

    const checks = document.querySelectorAll(".zone-stage-check");
    checks.forEach((cb) => {
      cb.addEventListener("change", () => {
        const stages = [];
        checks.forEach((c) => {
          if (c.checked) stages.push(c.value);
        });
        if (
          window.MapService &&
          typeof window.MapService.filterByStage === "function"
        ) {
          window.MapService.filterByStage(stages);
        }
      });
    });
  };
})();
