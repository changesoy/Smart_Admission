/* dataService.js - 数据加载服务 */

window.DataService = (() => {
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

  return {
    loadAllData,
  };
})();
