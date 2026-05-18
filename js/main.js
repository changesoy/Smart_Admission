/* main.js - 主入口(协调数据加载、渲染、地图初始化) */

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
        const zoneId = feature && feature.properties ? feature.properties.zoneId : "";
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
        if (window.MapService && typeof window.MapService.flyToZoneById === "function") {
          window.MapService.flyToZoneById(zoneId);
        }
      });
      window.SearchService.setOnPointResolved((lng, lat, item) => {
        if (window.MapService && typeof window.MapService.findZoneByPoint === "function") {
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
        if (window.MapService && typeof window.MapService.filterByStage === "function") {
          window.MapService.filterByStage(stages);
        }
      });
    });
  };
})();
