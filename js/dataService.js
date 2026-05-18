/* dataService.js - 数据加载服务 */

window.DataService = (function () {
  function loadFile(path) {
    if (!path) {
      return Promise.reject(new Error("Path is undefined"));
    }
    return fetch(path).then(function (resp) {
      if (!resp.ok) {
        throw new Error("加载失败:" + path + "(HTTP " + resp.status + ")");
      }
      return resp.json();
    });
  }

  function loadAllData() {
    var paths = window.AppConfig.dataPaths;
    return Promise.all([
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
    ]).then(function (results) {
      return {
        zones: results[0],
        schools: results[1],
        policies: results[2],
        materials: results[3],
        faq: results[4],
        contacts: results[5],
        policyDiff: results[6],
        addressPoints: results[7],
        keywordsIndex: results[8],
        zonesHistory: results[9],
      };
    });
  }

  return {
    loadAllData: loadAllData,
  };
})();
