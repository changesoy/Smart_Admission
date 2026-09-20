/**
 * main.js - 应用主入口 (ES Module)
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 协调数据加载、渲染和各模块初始化。加载数据成功后依次初始化各业务模块,
 *       失败则显示错误状态。各模块初始化通过 safeInit 隔离,单个模块异常不影响
 *       其他模块。
 *
 * 依赖关系全部通过 ES Module import 显式声明,不再依赖 window 全局对象
 * 和 <script> 标签加载顺序。
 *
 * 初始化顺序:
 *   1. DataService.loadAllData()  - 分级加载数据(核心阻断,可选降级)
 *   2. RenderService              - 渲染统计卡片/默认提示/免责声明
 *   3. PolicyService.init()       - 初始化政策模块
 *   4. SimulatorService.init()    - 初始化入学条件自查助手
 *   5. FaqService.init()          - 初始化FAQ模块
 *   6. InteractionService.init()  - 初始化互动模块
 *   7. MapService.initMap()       - 初始化地图(含 onZoneSelected/onNoMatch 回调)
 *   8. SearchService.init()       - 初始化搜索(含 onZoneMatched/onPointResolved 回调)
 *   9. StageFilter                - 绑定学段筛选复选框
 */

import AppConfig from "./config.js";
import DataService from "./dataService.js";
import RenderService from "./render.js";
import PolicyService from "./policyService.js";
import FaqService from "./faqService.js";
import InteractionService from "./interactionService.js";
import MapService from "./mapService.js";
import SearchService from "./searchService.js";
import SimulatorService from "./simulatorService.js";

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
    if (tip) tip.textContent = AppConfig.texts.loadingTip;
  }
};

/** 绑定学段筛选复选框,勾选变化时调用 MapService.filterByStage(只影响地图显示) */
const bindStageFilter = () => {
  const checks = document.querySelectorAll(".zone-stage-check");
  checks.forEach((cb) => {
    cb.addEventListener("change", () => {
      const stages = [];
      checks.forEach((c) => {
        if (c.checked) stages.push(c.value);
      });
      MapService.filterByStage(stages);
    });
  });
};

/** 数据加载成功后初始化所有业务模块,每个模块用 safeInit 隔离 */
const bootstrapPage = (data) => {
  safeInit("RenderService", () => {
    RenderService.renderStats(data);
    RenderService.renderDefaultResultTip();
    RenderService.setBoundaryNotice();
  });

  safeInit("PolicyService", () => {
    PolicyService.init({
      policies: data.policies,
      policyDiff: data.policyDiff,
      rumors: data.rumors,
    });
  });

  safeInit("SimulatorService", () => {
    SimulatorService.init({
      simulatorRules: data.simulatorRules,
      policies: data.policies,
    });
  });

  safeInit("FaqService", () => {
    FaqService.init(data.faq);
  });

  safeInit("InteractionService", () => {
    InteractionService.init(data);
  });

  safeInit("MapService", () => {
    MapService.initMap({
      zones: data.zones,
      schools: data.schools,
      policies: data.policies,
      onZoneSelected: (features) => {
        const arr = Array.isArray(features) ? features : [];
        // 同一坐标可同时命中小学/初中学段,按学段分组渲染
        const zonesByStage = {
          primary: arr.filter(
            (f) => f && f.properties && f.properties.stage === "小学",
          ),
          middle: arr.filter(
            (f) => f && f.properties && f.properties.stage !== "小学",
          ),
        };
        RenderService.renderResult({
          zonesByStage,
          schools: data.schools,
          policies: data.policies,
          zonesHistory: data.zonesHistory || [],
        });
        if (window.innerWidth < 992) {
          const panel = document.getElementById("resultPanel");
          if (panel)
            panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      },
      onNoMatch: () => {
        RenderService.renderNoMatch();
      },
    });
  });

  safeInit("SearchService", () => {
    SearchService.init(data);
    SearchService.setOnZoneMatched((zoneId) => {
      MapService.flyToZoneById(zoneId);
    });
    SearchService.setOnPointResolved((lng, lat) => {
      // 联网/地址点结果:与地图点击共用 selectZonesAt 业务查询入口,
      // 选中命中的全部学区(按学段)并渲染分组面板
      const grouped = MapService.selectZonesAt(lng, lat);
      if (grouped) {
        RenderService.renderResult({
          zonesByStage: grouped,
          schools: data.schools,
          policies: data.policies,
          zonesHistory: data.zonesHistory || [],
        });
      } else {
        // 坐标未命中任何学区:飞行到该点并展示明确的空状态
        MapService.flyToPoint(lng, lat);
        RenderService.renderNoMatch();
      }
    });
  });

  safeInit("StageFilter", bindStageFilter);
};

/** 模块脚本在 DOM 解析完成后执行,直接启动应用 */
(async () => {
  showLoading(true);

  try {
    const data = await DataService.loadAllData();
    showLoading(false);
    bootstrapPage(data);
  } catch (err) {
    console.error("数据加载失败:", err);
    showLoading(false);
    RenderService.renderError(err && err.message ? err.message : "未知错误");
  }
})();
