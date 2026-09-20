/**
 * mapService.js - 地图服务
 *
 * ⚠️ 修改前必读: CONTRIBUTING.md
 *
 * 功能: 基于 Leaflet 渲染学区地图,使用 Turf.js 实现点面判断(判断点击位置所属学区),
 *       管理学区图层的显示/隐藏/选中状态,支持按学段筛选和按 zoneId 飞行定位。
 *
 * 关键接口:
 *   initMap(params)              - 初始化地图,渲染学区图层并绑定交互
 *   flyToZoneById(zoneId)        - 飞行到指定学区并选中
 *   findZonesByPoint(lng, lat)   - 根据经纬度查找命中的全部学区,返回 { primary:[], middle:[] }
 *   selectZonesAt(lng, lat)      - 选中点位命中的全部学区并飞行到该点(供搜索定位使用)
 *   filterByStage(stages)        - 按学段(初中/小学)筛选可见图层
 *
 * 核心算法:
 *   handleMapClick → queryZonesAt → turf.booleanPointInPolygon 遍历全部学区要素,
 *   收集全部命中学区(同一坐标可同时命中小学/初中学段),不做提前返回
 *
 * 查询与显示分离(重要设计约束):
 *   queryZonesAt 始终基于完整学区数据计算业务归属,不受图层可见状态影响;
 *   图层开关(_visibleStages)只控制地图显示与选中高亮,不参与业务查询。
 *
 * 选中状态:
 *   _selectedLayers 为数组,支持同时选中多个学区(地图点击命中多学段时全部高亮,
 *   但仅限当前可见图层;被隐藏学区的业务结果仍正常返回)
 *
 * 坐标顺序提醒(关键!容易混淆):
 *   GeoJSON coordinates:[经度, 纬度] (lng, lat)
 *   Leaflet setView / latlng:[纬度, 经度] (lat, lng)
 *   turf.point():[经度, 纬度] (lng, lat)
 *   Leaflet e.latlng → 传给 Turf 时必须转为 [e.latlng.lng, e.latlng.lat]
 */

import AppConfig from "./config.js";

/* Leaflet(L) 与 Turf(turf) 由 index.html 的 CDN script 提供,已在 eslint.config.js 声明为全局只读变量 */

const MapService = (() => {
  let _map = null;
  const _selectedLayers = [];
  let _zonesData = null;
  const _zoneLayers = [];
  let _onZoneSelected = null;
  let _onNoMatch = null;
  let _visibleStages = { 初中: true, 小学: true };

  /** 获取 Feature 的学段,默认"初中" */
  const getFeatureStage = (feature) =>
    (feature && feature.properties && feature.properties.stage) || "初中";

  /** 获取 Feature 的 zoneId */
  const getFeatureZoneId = (feature) =>
    feature && feature.properties ? feature.properties.zoneId : null;

  /** 判断图层当前是否处于选中态 */
  const isLayerSelected = (layer) =>
    _selectedLayers.some((entry) => entry.layer === layer);

  /** 清除全部选中态,恢复默认样式 */
  const clearSelection = () => {
    _selectedLayers.forEach((entry) => {
      const stage = getFeatureStage(entry.feature);
      entry.layer.setStyle(getStageStyle(stage, "default"));
    });
    _selectedLayers.length = 0;
  };

  /** 将图层加入选中集合并应用选中样式(不清除已有选中) */
  const addToSelection = (entry) => {
    if (isLayerSelected(entry.layer)) return;
    const stage = getFeatureStage(entry.feature);
    entry.layer.setStyle(getStageStyle(stage, "selected"));
    _selectedLayers.push(entry);
  };

  /** 选中单个图层:清除其他选中,仅保留该图层 */
  const selectLayer = (layer, feature) => {
    clearSelection();
    addToSelection({ layer, feature });
    if (typeof _onZoneSelected === "function") {
      _onZoneSelected([feature]);
    }
  };

  /** 替换天地图 URL 模板中的 {token} 占位符 */
  const buildTiandituUrl = (template, token) =>
    template.replace("{token}", token);

  /** 加载天地图矢量底图+标注层 */
  const loadTiandituBaseLayers = (map) => {
    const td = AppConfig.tianditu;

    L.tileLayer(buildTiandituUrl(td.vecUrl, td.token), {
      subdomains: td.subdomains,
      attribution: td.attribution,
      maxZoom: 18,
      minZoom: 1,
    }).addTo(map);

    L.tileLayer(buildTiandituUrl(td.cvaUrl, td.token), {
      subdomains: td.subdomains,
      maxZoom: 18,
      minZoom: 1,
    }).addTo(map);
  };

  /** 根据学段和交互状态获取对应的 Leaflet Path 样式 */
  const getStageStyle = (stage, state) => {
    const styles = AppConfig.zoneStyle;
    const group = stage === "小学" ? styles.primary : styles.middle;
    return group[state] || group.default;
  };

  /** 初始化地图:创建 Leaflet 实例、加载底图、渲染学区图层、绑定点击事件 */
  const initMap = (params) => {
    const container = document.getElementById("mapContainer");
    if (!container) {
      console.error("地图容器 #mapContainer 未找到");
      return;
    }

    _zonesData = (params && params.zones) || {
      type: "FeatureCollection",
      features: [],
    };
    _onZoneSelected = params && params.onZoneSelected;
    _onNoMatch = params && params.onNoMatch;

    _map = L.map(container).setView(
      AppConfig.mapCenter,
      AppConfig.mapZoom,
    );

    loadTiandituBaseLayers(_map);

    if (_zonesData.features && _zonesData.features.length > 0) {
      _zonesData.features.forEach((feature) => {
        addZoneLayer(feature);
      });
      try {
        const geoLayer = L.geoJSON(_zonesData);
        _map.fitBounds(geoLayer.getBounds(), { padding: [20, 20] });
      } catch (err) {
        console.warn("fitBounds 失败,使用默认中心:", err);
      }
    } else {
      console.warn("学区数据为空,仅显示底图");
    }

    _map.on("click", (e) => {
      handleMapClick(e);
    });
  };

  /** 将单个学区 Feature 渲染为 Leaflet 图层,绑定悬停/点击事件 */
  const addZoneLayer = (feature) => {
    const stage = getFeatureStage(feature);
    const defaultStyle = getStageStyle(stage, "default");
    const hoverStyle = getStageStyle(stage, "hover");

    const geoLayer = L.geoJSON(feature, {
      style: () => defaultStyle,
    });

    geoLayer.eachLayer((l) => {
      _zoneLayers.push({ layer: l, feature });

      l.on("mouseover", () => {
        if (!isLayerSelected(l)) l.setStyle(hoverStyle);
      });
      l.on("mouseout", () => {
        if (!isLayerSelected(l)) l.setStyle(defaultStyle);
      });

      l.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectLayer(l, feature);
      });
    });

    geoLayer.addTo(_map);

    applyVisibility(feature);
  };

  /** 根据 _visibleStages 控制 Feature 图层的显示/隐藏 */
  const applyVisibility = (feature) => {
    const stage = getFeatureStage(feature);
    const visible = !!_visibleStages[stage];
    for (const entry of _zoneLayers) {
      if (entry.feature === feature) {
        if (visible) {
          if (!_map.hasLayer(entry.layer)) {
            entry.layer.addTo(_map);
          }
        } else {
          if (_map.hasLayer(entry.layer)) {
            _map.removeLayer(entry.layer);
          }
        }
      }
    }
  };

  /** 按学段筛选可见图层,被隐藏学区的选中态一并清除 */
  const filterByStage = (stages) => {
    _visibleStages = {};
    if (stages && stages.length) {
      stages.forEach((s) => {
        _visibleStages[s] = true;
      });
    }

    for (let i = _selectedLayers.length - 1; i >= 0; i--) {
      const entry = _selectedLayers[i];
      const selStage = getFeatureStage(entry.feature);
      if (!_visibleStages[selStage]) {
        entry.layer.setStyle(getStageStyle(selStage, "default"));
        _selectedLayers.splice(i, 1);
      }
    }

    if (_zonesData && _zonesData.features) {
      _zonesData.features.forEach((feature) => {
        applyVisibility(feature);
      });
    }
  };

  /** 地图点击处理:业务查询与显示分离,点击回调返回完整业务结果(不受图层可见性影响) */
  const handleMapClick = (e) => {
    if (
      !_zonesData ||
      !_zonesData.features ||
      _zonesData.features.length === 0
    ) {
      if (typeof _onNoMatch === "function") _onNoMatch();
      return;
    }

    let lng;
    let lat;
    try {
      ({ lng, lat } = e.latlng);
    } catch (err) {
      console.error("读取点击坐标失败:", err);
      if (typeof _onNoMatch === "function") _onNoMatch();
      return;
    }

    const query = queryZonesAt(lng, lat);

    if (query.matchedEntries.length > 0) {
      clearSelection();
      // 选中高亮只应用于当前可见图层;业务结果仍包含被隐藏学段的学区
      query.matchedEntries.forEach((entry) => {
        if (_map.hasLayer(entry.layer)) addToSelection(entry);
      });
      if (typeof _onZoneSelected === "function") {
        _onZoneSelected(query.matchedEntries.map((entry) => entry.feature));
      }
    } else {
      clearSelection();
      if (typeof _onNoMatch === "function") _onNoMatch();
    }
  };

  /**
   * 统一业务查询入口:根据经纬度查找命中的全部学区(按学段分组)。
   * 基于 _zoneLayers 全量要素计算,不受 _visibleStages / 图层显隐影响。
   * 返回 { grouped: {primary:[Feature], middle:[Feature]}, matchedEntries: [{layer, feature}] }
   */
  const queryZonesAt = (lng, lat) => {
    const grouped = { primary: [], middle: [] };
    const matchedEntries = [];
    if (!_zoneLayers || _zoneLayers.length === 0) {
      return { grouped, matchedEntries };
    }
    let pt;
    try {
      pt = turf.point([lng, lat]);
    } catch (err) {
      console.warn("queryZonesAt: turf.point 构造失败:", err);
      return { grouped, matchedEntries };
    }
    for (const entry of _zoneLayers) {
      try {
        if (turf.booleanPointInPolygon(pt, entry.feature)) {
          matchedEntries.push(entry);
          const key = getFeatureStage(entry.feature) === "小学" ? "primary" : "middle";
          grouped[key].push(entry.feature);
        }
      } catch (err) {
        console.warn(
          "queryZonesAt: booleanPointInPolygon 异常:",
          err,
          "zoneId:",
          getFeatureZoneId(entry.feature),
        );
      }
    }
    return { grouped, matchedEntries };
  };

  /** 根据经纬度查找命中的全部学区,按学段分组返回(纯业务查询,不含显示逻辑) */
  const findZonesByPoint = (lng, lat) => queryZonesAt(lng, lat).grouped;

  /** 选中点位命中的全部学区并飞行到该点,返回分组业务结果;未命中返回 null。
   *  与地图点击共用 queryZonesAt 业务查询入口;选中高亮只应用于当前可见图层。 */
  const selectZonesAt = (lng, lat) => {
    if (!_zoneLayers || _zoneLayers.length === 0) return null;
    const query = queryZonesAt(lng, lat);
    if (query.matchedEntries.length === 0) return null;

    clearSelection();
    query.matchedEntries.forEach((entry) => {
      if (_map.hasLayer(entry.layer)) addToSelection(entry);
    });

    if (_map) {
      _map.flyTo([lat, lng], 16, { duration: 0.8 });
    }

    return query.grouped;
  };

  /** 飞行到指定 zoneId 的学区并选中,若该学段被隐藏则自动勾选显示 */
  const flyToZoneById = (zoneId) => {
    if (!_zoneLayers || _zoneLayers.length === 0) {
      console.warn("flyToZoneById: 学区图层为空");
      return;
    }
    for (const entry of _zoneLayers) {
      const id = getFeatureZoneId(entry.feature);
      if (id === zoneId) {
        const stage = getFeatureStage(entry.feature);
        if (!_visibleStages[stage]) {
          _visibleStages[stage] = true;
          applyVisibility(entry.feature);
          const cb =
            stage === "小学"
              ? document.getElementById("showPrimaryZone")
              : document.getElementById("showMiddleZone");
          if (cb) cb.checked = true;
        }
        if (_map) {
          _map.flyToBounds(entry.layer.getBounds(), {
            padding: [40, 40],
            duration: 0.8,
          });
        }
        selectLayer(entry.layer, entry.feature);
        return;
      }
    }
    console.warn("flyToZoneById: 未找到 zoneId:", zoneId);
  };

  /** 飞行到指定经纬度坐标点 */
  const flyToPoint = (lng, lat) => {
    if (!_map) {
      console.warn("flyToPoint: 地图未初始化");
      return;
    }
    _map.flyTo([lat, lng], 16, { duration: 0.8 });
  };

  /** 公共接口 */
  return {
    initMap,
    flyToZoneById,
    flyToPoint,
    findZonesByPoint,
    selectZonesAt,
    filterByStage,
  };
})();

export default MapService;
