/**
 * config.js - 全局配置
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 为项目所有模块提供集中式配置,包括地图参数、天地图瓦片、数据路径、
 *       学区样式和提示文案。其他模块通过 `import AppConfig from "./config.js"` 读取配置。
 *
 * 关键结构:
 *   mapCenter    - [纬度, 经度], Leaflet setView 格式
 *   dataRelease  - 数据版本入口(指针文件 + 版本目录),决定本次会话使用哪一版数据
 *   dataPaths    - 数据文件名映射,实际路径由版本的版本目录前缀拼接得到
 *   zoneStyle    - 按 stage(初中middle/小学primary)和状态(default/hover/selected)分组的 Leaflet Path 选项
 *   tianditu     - 天地图 WMTS 瓦片模板 URL,需替换 {token} 占位符
 */
const AppConfig = {
  /** 地图初始中心 [纬度, 经度] (Leaflet 格式) */
  mapCenter: [36.1947, 117.1297],
  /** 地图初始缩放级别 */
  mapZoom: 14,

  /** 天地图瓦片服务配置,含 vec(矢量)/cva(标注)/img(影像)/cia(影像标注) 四层 */
  tianditu: {
    token: "913914b9096fb242c196babc64950515",
    vecUrl:
      "https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}",
    cvaUrl:
      "https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}",
    imgUrl:
      "https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}",
    ciaUrl:
      "https://t{s}.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}",
    subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
    attribution:
      '© <a href="https://www.tianditu.gov.cn/" target="_blank">天地图</a> · 国家地理信息公共服务平台',
  },

  /** 数据版本入口:先读指针拿到版本号,再按版本目录整包加载 */
  dataRelease: {
    currentPointer: "./data/current.json",
    releasesDir: "./data/releases",
  },

  /**
   * 数据文件名映射,键名与 DataService.loadAllData 解构顺序对应。
   * 实际请求路径由 DataService 拼成 `${releasesDir}/${version}/${文件名}`,
   * 因此这里只写文件名,不写目录。
   */
  dataPaths: {
    zones: "zones.geojson",
    schools: "schools.json",
    policies: "policies.json",
    faq: "faq.json",
    contacts: "contacts.json",
    policyDiff: "policy_diff.json",
    addressPoints: "address_points.json",
    keywordsIndex: "keywords_index.json",
    zonesHistory: "zones_history.json",
    rumors: "rumors.json",
    simulatorRules: "simulator_rules.json",
  },

  /** 学区图层样式,按学段(stage)和交互状态分组,值为 Leaflet Path 选项 */
  zoneStyle: {
    middle: {
      default: {
        color: "#0066CC",
        weight: 2,
        fillColor: "#0066CC",
        fillOpacity: 0.2,
      },
      hover: {
        color: "#0066CC",
        weight: 2,
        fillColor: "#0066CC",
        fillOpacity: 0.35,
      },
      selected: {
        color: "#F0A04B",
        weight: 3,
        fillColor: "#F0A04B",
        fillOpacity: 0.45,
      },
    },
    primary: {
      default: {
        color: "#1B7A43",
        weight: 2,
        fillColor: "#2ECC71",
        fillOpacity: 0.2,
      },
      hover: {
        color: "#1B7A43",
        weight: 2,
        fillColor: "#2ECC71",
        fillOpacity: 0.35,
      },
      selected: {
        color: "#F0A04B",
        weight: 3,
        fillColor: "#F0A04B",
        fillOpacity: 0.45,
      },
    },
  },

  /** 联网查询坐标范围限制（泰山区 + 岱岳区 + 泰山景区） */
  searchBounds: {
    minLng: 116.85,
    maxLng: 117.3,
    minLat: 35.85,
    maxLat: 36.35,
  },

  /** 界面提示文案,供 RenderService 等模块引用 */
  texts: {
    defaultResultTip: "请点击地图上的学区或任意点位以查询学区信息。",
    noMatchTip:
      "未匹配到当前数据范围内学区。请尝试点击地图中彩色边界范围内的位置,或查询泰山区范围内的地址。",
    loadingTip: "数据加载中…",
    loadErrorTip:
      "数据加载失败。请确认通过 HTTP 服务运行(如 npm run dev),而不是直接双击 HTML。",
  },
};

export default AppConfig;
