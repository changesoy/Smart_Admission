/* config.js - 全局配置(供其它脚本引用) */

window.AppConfig = {
  mapCenter: [36.1947, 117.1297],
  mapZoom: 14,

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

  texts: {
    defaultResultTip: "请点击地图上的学区或任意点位以查询学区信息。",
    noMatchTip:
      "该位置暂未匹配到示例学区,请尝试点击地图中彩色边界范围内的位置。",
    loadingTip: "数据加载中…",
    loadErrorTip:
      "数据加载失败。请确认通过 HTTP 服务运行(如 python -m http.server 5500),而不是直接双击 HTML。",
  },
};
