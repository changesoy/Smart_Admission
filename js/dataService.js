/**
 * dataService.js - 数据加载服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 通过 fetch + async/await 加载项目所有 JSON/GeoJSON 数据文件,
 *       核心数据(zones/schools/policies)失败则阻断,可选数据失败降级为默认值。
 *
 * 关键接口:
 *   loadAllData() → Promise<Object>
 *     返回结构: { zones, schools, policies, materials, faq, contacts,
 *                 policyDiff, addressPoints, keywordsIndex, zonesHistory, rumors }
 *     - zones: GeoJSON FeatureCollection (学区多边形)
 *     - 其余: 普通 JSON 数组或对象
 *
 * 依赖: window.AppConfig.dataPaths 提供文件路径
 */
window.DataService = (() => {
  /** 核心数据键名与路径键的映射,加载失败将阻断整个页面 */
  const requiredKeys = ["zones", "schools", "policies"];

  /** 可选数据键名及其降级默认值,加载失败仅 console.warn 并使用默认值 */
  const optionalDefaults = {
    materials: [],
    faq: [],
    contacts: [],
    policyDiff: [],
    addressPoints: [],
    keywordsIndex: [],
    zonesHistory: [],
    rumors: [],
  };

  /** 加载单个 JSON/GeoJSON 文件,失败时抛出含 HTTP 状态的 Error */
  const loadFile = async (path) => {
    if (!path) {
      return Promise.reject(new Error("Path is undefined"));
    }
    const resp = await fetch(path);
    if (!resp.ok) {
      throw new Error(`加载失败:${path}(HTTP ${resp.status})`);
    }
    return resp.json();
  };

  /** 加载全部数据:核心数据顺序加载(失败即抛出),可选数据并行加载(失败降级) */
  const loadAllData = async () => {
    const paths = window.AppConfig.dataPaths;
    const data = {};

    for (const key of requiredKeys) {
      data[key] = await loadFile(paths[key]);
    }

    const optionalEntries = Object.keys(optionalDefaults)
      .filter((key) => paths[key])
      .map((key) => [key, paths[key]]);

    const optionalResults = await Promise.allSettled(
      optionalEntries.map(([, path]) => loadFile(path))
    );

    optionalResults.forEach((result, index) => {
      const [key] = optionalEntries[index];
      if (result.status === "fulfilled") {
        data[key] = result.value;
      } else {
        console.warn(`可选数据加载失败: ${key}`, result.reason);
        data[key] = optionalDefaults[key];
      }
    });

    Object.keys(optionalDefaults).forEach((key) => {
      if (!data[key]) {
        data[key] = optionalDefaults[key];
      }
    });

    return data;
  };

  /** 公共接口 */
  return {
    loadAllData,
  };
})();
