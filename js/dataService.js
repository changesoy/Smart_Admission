/* dataService.js - 数据加载服务(并行加载 5 个本地数据文件) */

window.DataService = (function () {
  // 加载单个 JSON / GeoJSON 文件,返回 Promise
  function loadFile(path) {
    return fetch(path).then(function (resp) {
      if (!resp.ok) {
        throw new Error("加载失败:" + path + "(HTTP " + resp.status + ")");
      }
      return resp.json();
    });
  }

  // 并行加载所有数据文件,任一失败则整体 reject
  function loadAllData() {
    var paths = window.AppConfig.dataPaths;
    return Promise.all([
      loadFile(paths.zones),
      loadFile(paths.schools),
      loadFile(paths.policies),
      loadFile(paths.materials),
      loadFile(paths.faq),
      loadFile(paths.policyDiff),
      loadFile(paths.rumors),
      loadFile(paths.simulatorRules),
      loadFile(paths.addressPoints),
      loadFile(paths.keywordsIndex),
      loadFile(paths.zonesHistory),
    ]).then(function (results) {
      return {
        zones: results[0],
        schools: results[1],
        policies: results[2],
        materials: results[3],
        faq: results[4],
        policyDiff: results[5],
        rumors: results[6],
        simulatorRules: results[7],
        addressPoints: results[8],
        keywordsIndex: results[9],
        zonesHistory: results[10],
      };
    });
  }

  return {
    loadAllData: loadAllData,
  };
})();
