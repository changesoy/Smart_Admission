/* main.js - 主入口(协调数据加载、渲染、地图初始化) */

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    showLoading(true);

    window.DataService.loadAllData()
      .then(function (data) {
        showLoading(false);
        bootstrapPage(data);
      })
      .catch(function (err) {
        console.error("数据加载失败:", err);
        showLoading(false);
        window.RenderService.renderError(
          err && err.message ? err.message : "未知错误",
        );
      });
  });

  function showLoading(visible) {
    var loadEl = document.getElementById("loadingState");
    var mainEl = document.getElementById("mainContent");
    if (loadEl) loadEl.style.display = visible ? "block" : "none";
    if (mainEl) mainEl.style.display = visible ? "none" : "block";
    if (visible) {
      var tip = document.getElementById("loadingTip");
      if (tip) tip.textContent = window.AppConfig.texts.loadingTip;
    }
  }

  function bootstrapPage(data) {
    window.RenderService.renderStats(data);
    window.RenderService.renderDefaultResultTip();

    window.PolicyService.init({
      policies: data.policies,
      policyDiff: data.policyDiff,
    });

    window.RenderService.renderMaterials(data.materials);
    window.RenderService.renderFaq(data.faq);
    window.RenderService.bindFaqSearch();
    window.RenderService.setBoundaryNotice();

    window.MapService.initMap({
      zones: data.zones,
      schools: data.schools,
      policies: data.policies,
      onZoneSelected: function (feature) {
        var zoneId = feature && feature.properties ? feature.properties.zoneId : "";
        var historyEntry = (data.zonesHistory || []).find(function (h) {
          return h.zoneId === zoneId;
        });
        window.RenderService.renderResult({
          zoneFeature: feature,
          schools: data.schools,
          policies: data.policies,
          history: historyEntry ? historyEntry.history : [],
        });
        if (window.innerWidth < 992) {
          var panel = document.getElementById("resultPanel");
          if (panel)
            panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      },
      onNoMatch: function () {
        window.RenderService.renderNoMatch();
      },
    });

    if (window.SearchService) {
      window.SearchService.init(data);
      window.SearchService.setOnZoneMatched(function (zoneId, item) {
        if (window.MapService && typeof window.MapService.flyToZoneById === "function") {
          window.MapService.flyToZoneById(zoneId);
        } else {
          console.warn("MapService.flyToZoneById 尚未实现，匹配到的 zoneId:", zoneId, item);
        }
      });
      window.SearchService.setOnPointResolved(function (lng, lat, item) {
        if (window.MapService && typeof window.MapService.findZoneByPoint === "function") {
          var zoneId = window.MapService.findZoneByPoint(lng, lat);
          if (zoneId && typeof window.MapService.flyToZoneById === "function") {
            window.MapService.flyToZoneById(zoneId);
          } else {
            console.warn("未通过坐标匹配到学区:", lng, lat, item);
          }
        } else {
          console.warn("MapService.findZoneByPoint 尚未实现，解析到的坐标:", lng, lat, item);
        }
      });
    }

    var checks = document.querySelectorAll(".zone-stage-check");
    checks.forEach(function (cb) {
      cb.addEventListener("change", function () {
        var stages = [];
        checks.forEach(function (c) {
          if (c.checked) stages.push(c.value);
        });
        if (window.MapService && typeof window.MapService.filterByStage === "function") {
          window.MapService.filterByStage(stages);
        }
      });
    });
  }
})();
