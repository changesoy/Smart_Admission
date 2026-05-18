/**
 * dataService.js - 数据加载服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 通过 fetch + async/await 并行加载项目所有 JSON/GeoJSON 数据文件,
 *       返回统一数据对象供 main.js 分发给各业务模块。
 *
 * 关键接口:
 *   loadAllData() → Promise<Object>
 *     返回结构: { zones, schools, policies, materials, faq, contacts,
 *                 policyDiff, addressPoints, keywordsIndex, zonesHistory }
 *     - zones: GeoJSON FeatureCollection (学区多边形)
 *     - 其余: 普通 JSON 数组或对象
 *
 * 依赖: window.AppConfig.dataPaths 提供文件路径
 */
window.DataService = (() => {
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

  /** 并行加载全部数据文件,使用 Promise.all + 解构赋值,返回统一数据对象 */
  const loadAllData = async () => {
    const paths = window.AppConfig.dataPaths;
    const [
      zones,
      schools,
      policies,
      materials,
      faq,
      contacts,
      policyDiff,
      addressPoints,
      keywordsIndex,
      zonesHistory,
    ] = await Promise.all([
      loadFile(paths.zones),
      loadFile(paths.schools),
      loadFile(paths.policies),
      loadFile(paths.materials),
      loadFile(paths.faq),
      loadFile(paths.contacts),
      loadFile(paths.policyDiff),
      loadFile(paths.addressPoints),
      loadFile(paths.keywordsIndex),
      loadFile(paths.zonesHistory),
    ]);

    return {
      zones,
      schools,
      policies,
      materials,
      faq,
      contacts,
      policyDiff,
      addressPoints,
      keywordsIndex,
      zonesHistory,
    };
  };

  /** 公共接口 */
  return {
    loadAllData,
  };
})();
