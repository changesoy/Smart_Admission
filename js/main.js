/**
 * main.js - 应用主入口
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 协调数据加载、渲染和各模块初始化。使用 async IIFE 在 DOMContentLoaded
 *       时加载数据,成功后依次初始化各业务模块,失败则显示错误状态。
 *       各模块初始化通过 safeInit 隔离,单个模块异常不影响其他模块。
 *
 * 初始化顺序:
 *   1. DataService.loadAllData()  - 分级加载数据(核心阻断,可选降级)
 *   2. RenderService              - 渲染统计卡片/默认提示/免责声明
 *   3. PolicyService.init()       - 初始化政策模块
 *   4. MaterialService.init()     - 初始化材料模块
 *   5. FaqService.init()          - 初始化FAQ模块
 *   6. InteractionService.init()  - 初始化互动模块
 *   7. MapService.initMap()       - 初始化地图(含 onZoneSelected/onNoMatch 回调)
 *   8. SearchService.init()       - 初始化搜索(含 onZoneMatched/onPointResolved 回调)
 *   9. StageFilter                - 绑定学段筛选复选框
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

  /** 模块初始化隔离:捕获异常并 console.error,防止一个模块拖垮后续模块 */
  const safeInit = (name, fn) => {
    try {
      fn();
    } catch (err) {
      console.error(`${name} 初始化失败`, err);
    }
  };

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

  /** 绑定学段筛选复选框,勾选变化时调用 MapService.filterByStage */
  const bindStageFilter = () => {
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

  /** 数据加载成功后初始化所有业务模块,每个模块用 safeInit 隔离 */
  const bootstrapPage = (data) => {
    safeInit("RenderService", () => {
      window.RenderService.renderStats(data);
      window.RenderService.renderDefaultResultTip();
      window.RenderService.setBoundaryNotice();
    });

    safeInit("PolicyService", () => {
      window.PolicyService.init({
        policies: data.policies,
        policyDiff: data.policyDiff,
        rumors: data.rumors,
      });
    });

    safeInit("MaterialService", () => {
      window.MaterialService.init(data.materials);
    });

    safeInit("FaqService", () => {
      window.FaqService.init(data.faq);
    });

    safeInit("InteractionService", () => {
      window.InteractionService.init(data);
    });

    safeInit("MapService", () => {
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
    });

    safeInit("SearchService", () => {
      if (!window.SearchService) return;
      window.SearchService.init(data);
      window.SearchService.setOnZoneMatched((zoneId) => {
        if (
          window.MapService &&
          typeof window.MapService.flyToZoneById === "function"
        ) {
          window.MapService.flyToZoneById(zoneId);
        }
      });
      window.SearchService.setOnPointResolved((lng, lat) => {
        if (
          !window.MapService ||
          typeof window.MapService.findZoneByPoint !== "function"
        )
          return;
        const zoneId = window.MapService.findZoneByPoint(lng, lat);
        if (zoneId && typeof window.MapService.flyToZoneById === "function") {
          window.MapService.flyToZoneById(zoneId);
        } else {
          // 坐标未命中任何学区，飞行到该点并提示用户
          if (typeof window.MapService.flyToPoint === "function") {
            window.MapService.flyToPoint(lng, lat);
          }
          window.RenderService.renderNoMatch();
        }
      });
    });

    safeInit("StageFilter", bindStageFilter);
  };
})();
