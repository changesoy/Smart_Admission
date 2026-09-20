/**
 * dataService.js - 数据加载服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 先解析当前数据版本(读 data/current.json),再通过 fetch + async/await
 *       从该版本目录加载全部 JSON/GeoJSON 文件。核心数据(zones/schools/policies)
 *       失败则阻断,可选数据失败降级为默认值。
 *
 * 关键接口:
 *   loadAllData() → Promise<Object>
 *     返回结构: { dataVersion, zones, schools, policies, faq, contacts,
 *                 policyDiff, addressPoints, keywordsIndex, zonesHistory, rumors }
 *     - dataVersion: 本次加载的数据版本号,取自 data/current.json
 *     - zones: GeoJSON FeatureCollection (学区多边形)
 *     - 其余: 普通 JSON 数组或对象
 *
 * 依赖: ./config.js 导出的 AppConfig.dataRelease(版本入口)与 AppConfig.dataPaths(文件名映射)。
 *       实际请求路径 = `{releasesDir}/{version}/{文件名}`,同一会话内版本只解析一次。
 */
import AppConfig from "./config.js";

const DataService = (() => {
  /** 核心数据键名与路径键的映射,加载失败将阻断整个页面 */
  const requiredKeys = ["zones", "schools", "policies"];

  /** 可选数据键名及其降级默认值,加载失败仅 console.warn 并使用默认值 */
  const optionalDefaults = {
    faq: [],
    contacts: [],
    policyDiff: [],
    addressPoints: [],
    keywordsIndex: [],
    zonesHistory: [],
    rumors: [],
    simulatorRules: { meta: {}, form: [], rules: [] },
  };

  /** 版本解析结果,整个会话内复用,避免同一会话混用两个数据版本 */
  let _releasePromise = null;

  /**
   * 加载单个 JSON/GeoJSON 文件,失败时抛出含文件路径的 Error。
   * 这里不用 resp.json() 而是自行解析:部分静态服务器(Vite dev 的 SPA fallback、
   * Nginx try_files 回退)对缺失文件返回 200 + HTML,此时 resp.ok 为真,直接
   * resp.json() 只会抛出难以定位的 "Unexpected token '<'";自行解析才能点明是哪个文件不可用。
   */
  const loadFile = async (path) => {
    if (!path) {
      return Promise.reject(new Error("Path is undefined"));
    }
    const resp = await fetch(path);
    if (!resp.ok) {
      throw new Error(`加载失败:${path}(HTTP ${resp.status})`);
    }
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`加载失败:${path}(响应不是合法 JSON,该文件可能不存在)`);
    }
  };

  /** 解析当前数据版本:读指针文件拿到版本号,拼出版本目录前缀 */
  const resolveRelease = () => {
    if (!_releasePromise) {
      const { currentPointer, releasesDir } = AppConfig.dataRelease;
      _releasePromise = loadFile(currentPointer).then((pointer) => {
        const version = pointer ? pointer.version : null;
        if (!version) {
          throw new Error(`数据版本指针 ${currentPointer} 缺少 version 字段`);
        }
        return { version, base: `${releasesDir}/${version}/` };
      });
    }
    return _releasePromise;
  };

  /** 加载全部数据:核心数据并行加载(任一失败即抛出),可选数据并行加载(失败降级) */
  const loadAllData = async () => {
    const { version, base } = await resolveRelease();
    const paths = Object.fromEntries(
      Object.entries(AppConfig.dataPaths).map(([key, file]) => [
        key,
        base + file,
      ]),
    );
    const data = {};

    const requiredResults = await Promise.all(
      requiredKeys.map((key) => loadFile(paths[key])),
    );
    requiredKeys.forEach((key, index) => {
      data[key] = requiredResults[index];
    });

    const optionalEntries = Object.keys(optionalDefaults)
      .filter((key) => paths[key])
      .map((key) => [key, paths[key]]);

    const optionalResults = await Promise.allSettled(
      optionalEntries.map(([, path]) => loadFile(path)),
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

    data.dataVersion = version;
    return data;
  };

  /** 公共接口 */
  return {
    loadAllData,
  };
})();

export default DataService;
