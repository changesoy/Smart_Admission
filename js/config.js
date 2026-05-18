/**
 * config.js - 全局配置
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 为项目所有模块提供集中式配置,包括地图参数、天地图瓦片、数据路径、
 *       学区样式和提示文案。其他脚本通过 window.AppConfig 读取配置。
 *
 * 关键结构:
 *   mapCenter    - [纬度, 经度], Leaflet setView 格式
 *   dataPaths    - 各 JSON/GeoJSON 文件的相对路径映射
 *   zoneStyle    - 按 stage(初中middle/小学primary)和状态(default/hover/selected)分组的 Leaflet Path 选项
 *   tianditu     - 天地图 WMTS 瓦片模板 URL,需替换 {token} 占位符
 */
window.AppConfig = {
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

  /** 数据文件路径映射,键名与 DataService.loadAllData 解构顺序对应 */
  dataPaths: {
    zones: "./data/zones.geojson",
    schools: "./data/schools.json",
    policies: "./data/policies.json",
    materials: "./data/materials.json",
    faq: "./data/faq.json",
    contacts: "./data/contacts.json",
    policyDiff: "./data/policy_diff.json",
    addressPoints: "./data/address_points.json",
    keywordsIndex: "./data/keywords_index.json",
    zonesHistory: "./data/zones_history.json",
  },

  /** 学区图层样式,按学段(stage)和交互状态分组,值为 Leaflet Path 选项 */
  zoneStyle: {
    middle: {
      default: {
        color: "#1E3A5F",
        weight: 2,
        fillColor: "#3388ff",
        fillOpacity: 0.2,
      },
      hover: {
        color: "#1E3A5F",
        weight: 2,
        fillColor: "#3388ff",
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

  /** 界面提示文案,供 RenderService 等模块引用 */
  texts: {
    defaultResultTip: "请点击地图上的学区或任意点位以查询学区信息。",
    noMatchTip:
      "该位置暂未匹配到示例学区,请尝试点击地图中彩色边界范围内的位置。",
    loadingTip: "数据加载中…",
    loadErrorTip:
      "数据加载失败。请确认通过 HTTP 服务运行(如 python -m http.server 5500),而不是直接双击 HTML。",
  },
};
