/* mapService.js - 地图服务(Leaflet 渲染 + Turf 点面判断) */

/*
 * 坐标顺序提醒(关键!容易混淆):
 * - GeoJSON coordinates:[经度, 纬度] (lng, lat)
 * - Leaflet setView / latlng:[纬度, 经度] (lat, lng)
 * - turf.point():[经度, 纬度] (lng, lat)
 * - Leaflet e.latlng → 传给 Turf 时必须转为 [e.latlng.lng, e.latlng.lat]
 */

window.MapService = (function () {
  var _map = null;
  var _selectedLayer = null;
  var _zonesData = null;
  var _zoneLayers = [];
  var _onZoneSelected = null;
  var _onNoMatch = null;
  var _visibleStages = { "初中": true, "小学": true };

  function buildTiandituUrl(template, token) {
    return template.replace("{token}", token);
  }

  function loadTiandituBaseLayers(map) {
    var td = window.AppConfig.tianditu;

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
  }

  function getStageStyle(stage, state) {
    var styles = window.AppConfig.zoneStyle;
    var group = stage === "小学" ? styles.primary : styles.middle;
    return group[state] || group.default;
  }

  function initMap(params) {
    var container = document.getElementById("mapContainer");
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
      _zonesData.features.forEach(function (feature) {
        addZoneLayer(feature);
      });
      try {
        var geoLayer = L.geoJSON(_zonesData);
        _map.fitBounds(geoLayer.getBounds(), { padding: [20, 20] });
      } catch (err) {
        console.warn("fitBounds 失败,使用默认中心:", err);
      }
    } else {
      console.warn("学区数据为空,仅显示底图");
    }

    _map.on("click", function (e) {
      handleMapClick(e);
    });
  }

  function addZoneLayer(feature) {
    var stage = (feature.properties && feature.properties.stage) || "初中";
    var defaultStyle = getStageStyle(stage, "default");
    var hoverStyle = getStageStyle(stage, "hover");

    var geoLayer = L.geoJSON(feature, {
      style: function () {
        return defaultStyle;
      },
    });

    geoLayer.eachLayer(function (l) {
      _zoneLayers.push({ layer: l, feature: feature });

      l.on("mouseover", function () {
        if (l !== _selectedLayer) l.setStyle(hoverStyle);
      });
      l.on("mouseout", function () {
        if (l !== _selectedLayer) l.setStyle(defaultStyle);
      });

      l.on("click", function (e) {
        L.DomEvent.stopPropagation(e);
        selectLayer(l, feature);
      });
    });

    geoLayer.addTo(_map);

    applyVisibility(feature);
  }

  function selectLayer(layer, feature) {
    var stage = (feature.properties && feature.properties.stage) || "初中";
    var defaultStyle = getStageStyle(stage, "default");
    var selectedStyle = getStageStyle(stage, "selected");

    if (_selectedLayer && _selectedLayer !== layer) {
      var prevFeature = null;
      for (var i = 0; i < _zoneLayers.length; i++) {
        if (_zoneLayers[i].layer === _selectedLayer) {
          prevFeature = _zoneLayers[i].feature;
          break;
        }
      }
      if (prevFeature) {
        var prevStage = (prevFeature.properties && prevFeature.properties.stage) || "初中";
        _selectedLayer.setStyle(getStageStyle(prevStage, "default"));
      }
    }
    _selectedLayer = layer;
    layer.setStyle(selectedStyle);
    if (typeof _onZoneSelected === "function") {
      _onZoneSelected(feature);
    }
  }

  function applyVisibility(feature) {
    var stage = (feature.properties && feature.properties.stage) || "初中";
    var visible = !!_visibleStages[stage];
    for (var i = 0; i < _zoneLayers.length; i++) {
      if (_zoneLayers[i].feature === feature) {
        if (visible) {
          if (!_map.hasLayer(_zoneLayers[i].layer)) {
            _zoneLayers[i].layer.addTo(_map);
          }
        } else {
          if (_map.hasLayer(_zoneLayers[i].layer)) {
            _map.removeLayer(_zoneLayers[i].layer);
          }
        }
      }
    }
  }

  function filterByStage(stages) {
    _visibleStages = {};
    if (stages && stages.length) {
      stages.forEach(function (s) {
        _visibleStages[s] = true;
      });
    }

    if (_selectedLayer) {
      var selVisible = false;
      for (var i = 0; i < _zoneLayers.length; i++) {
        if (_zoneLayers[i].layer === _selectedLayer) {
          var selStage = (_zoneLayers[i].feature.properties && _zoneLayers[i].feature.properties.stage) || "初中";
          selVisible = !!_visibleStages[selStage];
          break;
        }
      }
      if (!selVisible) {
        _selectedLayer = null;
      }
    }

    if (_zonesData && _zonesData.features) {
      _zonesData.features.forEach(function (feature) {
        applyVisibility(feature);
      });
    }
  }

  function handleMapClick(e) {
    if (
      !_zonesData ||
      !_zonesData.features ||
      _zonesData.features.length === 0
    ) {
      if (typeof _onNoMatch === "function") _onNoMatch();
      return;
    }

    var pt;
    try {
      pt = turf.point([e.latlng.lng, e.latlng.lat]);
    } catch (err) {
      console.error("turf.point 构造失败:", err);
      if (typeof _onNoMatch === "function") _onNoMatch();
      return;
    }

    var matchedEntry = null;
    for (var i = 0; i < _zoneLayers.length; i++) {
      var entry = _zoneLayers[i];
      var entryStage = (entry.feature.properties && entry.feature.properties.stage) || "初中";
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
        var selStage = "初中";
        for (var j = 0; j < _zoneLayers.length; j++) {
          if (_zoneLayers[j].layer === _selectedLayer) {
            selStage = (_zoneLayers[j].feature.properties && _zoneLayers[j].feature.properties.stage) || "初中";
            break;
          }
        }
        _selectedLayer.setStyle(getStageStyle(selStage, "default"));
        _selectedLayer = null;
      }
      if (typeof _onNoMatch === "function") _onNoMatch();
    }
  }

  function findZoneByPoint(lng, lat) {
    if (!_zoneLayers || _zoneLayers.length === 0) return null;
    var pt;
    try {
      pt = turf.point([lng, lat]);
    } catch (err) {
      console.warn("findZoneByPoint: turf.point 构造失败:", err);
      return null;
    }
    for (var i = 0; i < _zoneLayers.length; i++) {
      var entry = _zoneLayers[i];
      var entryStage = (entry.feature.properties && entry.feature.properties.stage) || "初中";
      if (!_visibleStages[entryStage]) continue;
      try {
        if (turf.booleanPointInPolygon(pt, entry.feature)) {
          return entry.feature && entry.feature.properties
            ? entry.feature.properties.zoneId
            : null;
        }
      } catch (err) {
        console.warn("findZoneByPoint: booleanPointInPolygon 异常:", err);
      }
    }
    return null;
  }

  function flyToZoneById(zoneId) {
    if (!_zoneLayers || _zoneLayers.length === 0) {
      console.warn("flyToZoneById: 学区图层为空");
      return;
    }
    for (var i = 0; i < _zoneLayers.length; i++) {
      var entry = _zoneLayers[i];
      var id =
        entry.feature && entry.feature.properties
          ? entry.feature.properties.zoneId
          : null;
      if (id === zoneId) {
        var stage = (entry.feature.properties && entry.feature.properties.stage) || "初中";
        if (!_visibleStages[stage]) {
          _visibleStages[stage] = true;
          applyVisibility(entry.feature);
          var cb = stage === "小学" ? document.getElementById("showPrimaryZone") : document.getElementById("showMiddleZone");
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
  }

  return {
    initMap: initMap,
    flyToZoneById: flyToZoneById,
    findZoneByPoint: findZoneByPoint,
    filterByStage: filterByStage,
  };
})();
