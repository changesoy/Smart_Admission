/**
 * mapService.js - 地图服务
 *
 * 功能: 基于 Leaflet 渲染学区地图,使用 Turf.js 实现点面判断(判断点击位置所属学区),
 *       管理学区图层的显示/隐藏/选中状态,支持按学段筛选和按 zoneId 飞行定位。
 *
 * 关键接口:
 *   initMap(params)              - 初始化地图,渲染学区图层并绑定交互
 *   flyToZoneById(zoneId)        - 飞行到指定学区并选中
 *   findZoneByPoint(lng, lat)    - 根据经纬度查找所属学区的 zoneId
 *   filterByStage(stages)        - 按学段(初中/小学)筛选可见图层
 *
 * 核心算法:
 *   handleMapClick → turf.point + turf.booleanPointInPolygon 遍历可见图层判断命中
 *
 * 坐标顺序提醒(关键!容易混淆):
 *   GeoJSON coordinates:[经度, 纬度] (lng, lat)
 *   Leaflet setView / latlng:[纬度, 经度] (lat, lng)
 *   turf.point():[经度, 纬度] (lng, lat)
 *   Leaflet e.latlng → 传给 Turf 时必须转为 [e.latlng.lng, e.latlng.lat]
 */

window.MapService = (() => {
  let _map = null;
  let _selectedLayer = null;
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

  /** 在 _zoneLayers 中查找指定 Leaflet layer 对应的条目 */
  const findLayerEntry = (layer) =>
    _zoneLayers.find((entry) => entry.layer === layer) || null;

  /** 替换天地图 URL 模板中的 {token} 占位符 */
  const buildTiandituUrl = (template, token) =>
    template.replace("{token}", token);

  /** 加载天地图矢量底图+标注层 */
  const loadTiandituBaseLayers = (map) => {
    const td = window.AppConfig.tianditu;

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
    const styles = window.AppConfig.zoneStyle;
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
      window.AppConfig.mapCenter,
      window.AppConfig.mapZoom,
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
        if (l !== _selectedLayer) l.setStyle(hoverStyle);
      });
      l.on("mouseout", () => {
        if (l !== _selectedLayer) l.setStyle(defaultStyle);
      });

      l.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectLayer(l, feature);
      });
    });

    geoLayer.addTo(_map);

    applyVisibility(feature);
  };

  /** 选中指定图层:取消前一个选中状态,应用选中样式,触发 onZoneSelected 回调 */
  const selectLayer = (layer, feature) => {
    const stage = getFeatureStage(feature);
    const selectedStyle = getStageStyle(stage, "selected");

    if (_selectedLayer && _selectedLayer !== layer) {
      const prevEntry = findLayerEntry(_selectedLayer);
      if (prevEntry) {
        const prevStage = getFeatureStage(prevEntry.feature);
        _selectedLayer.setStyle(getStageStyle(prevStage, "default"));
      }
    }
    _selectedLayer = layer;
    layer.setStyle(selectedStyle);
    if (typeof _onZoneSelected === "function") {
      _onZoneSelected(feature);
    }
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

  /** 按学段筛选可见图层,若当前选中图层被隐藏则取消选中 */
  const filterByStage = (stages) => {
    _visibleStages = {};
    if (stages && stages.length) {
      stages.forEach((s) => {
        _visibleStages[s] = true;
      });
    }

    if (_selectedLayer) {
      const selEntry = findLayerEntry(_selectedLayer);
      if (selEntry) {
        const selStage = getFeatureStage(selEntry.feature);
        if (!_visibleStages[selStage]) {
          _selectedLayer = null;
        }
      }
    }

    if (_zonesData && _zonesData.features) {
      _zonesData.features.forEach((feature) => {
        applyVisibility(feature);
      });
    }
  };

  /** 地图点击处理:使用 Turf booleanPointInPolygon 遍历可见图层判断命中学区 */
  const handleMapClick = (e) => {
    if (
      !_zonesData ||
      !_zonesData.features ||
      _zonesData.features.length === 0
    ) {
      if (typeof _onNoMatch === "function") _onNoMatch();
      return;
    }

    let pt;
    try {
      pt = turf.point([e.latlng.lng, e.latlng.lat]);
    } catch (err) {
      console.error("turf.point 构造失败:", err);
      if (typeof _onNoMatch === "function") _onNoMatch();
      return;
    }

    let matchedEntry = null;
    for (const entry of _zoneLayers) {
      const entryStage = getFeatureStage(entry.feature);
      if (!_visibleStages[entryStage]) continue;
      if (!_map.hasLayer(entry.layer)) continue;
      try {
        if (turf.booleanPointInPolygon(pt, entry.feature)) {
          matchedEntry = entry;
          break;
        }
      } catch (err) {
        console.warn("booleanPointInPolygon 异常:", err);
      }
    }

    if (matchedEntry) {
      selectLayer(matchedEntry.layer, matchedEntry.feature);
    } else {
      if (_selectedLayer) {
        const selEntry = findLayerEntry(_selectedLayer);
        if (selEntry) {
          const selStage = getFeatureStage(selEntry.feature);
          _selectedLayer.setStyle(getStageStyle(selStage, "default"));
        }
        _selectedLayer = null;
      }
      if (typeof _onNoMatch === "function") _onNoMatch();
    }
  };

  /** 根据经纬度坐标查找所属学区的 zoneId,供 SearchService 调用 */
  const findZoneByPoint = (lng, lat) => {
    if (!_zoneLayers || _zoneLayers.length === 0) return null;
    let pt;
    try {
      pt = turf.point([lng, lat]);
    } catch (err) {
      console.warn("findZoneByPoint: turf.point 构造失败:", err);
      return null;
    }
    for (const entry of _zoneLayers) {
      const entryStage = getFeatureStage(entry.feature);
      if (!_visibleStages[entryStage]) continue;
      try {
        if (turf.booleanPointInPolygon(pt, entry.feature)) {
          return getFeatureZoneId(entry.feature);
        }
      } catch (err) {
        console.warn("findZoneByPoint: booleanPointInPolygon 异常:", err);
      }
    }
    return null;
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

  /** 公共接口 */
  return {
    initMap,
    flyToZoneById,
    findZoneByPoint,
    filterByStage,
  };
})();
