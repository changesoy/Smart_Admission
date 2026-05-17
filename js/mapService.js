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

  function getStageStyle(feature, state) {
    var styles = window.AppConfig.zoneStyle;
    var stage =
      (feature && feature.properties && feature.properties.stage) || "middle";
    var stageStyles = styles[stage] || styles.middle;
    return stageStyles[state] || stageStyles.default;
  }

  function loadBaseLayer(map) {
    var config = window.AppConfig.tianditu;
    var vecUrl = config.vecUrl.replace("{token}", config.token);
    var cvaUrl = config.cvaUrl.replace("{token}", config.token);

    L.tileLayer(vecUrl, {
      attribution: config.attribution,
      maxZoom: 18,
      minZoom: 1,
      subdomains: config.subdomains,
    }).addTo(map);

    L.tileLayer(cvaUrl, {
      attribution: config.attribution,
      maxZoom: 18,
      minZoom: 1,
      subdomains: config.subdomains,
    }).addTo(map);
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

    loadBaseLayer(_map);

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
    var geoLayer = L.geoJSON(feature, {
      style: function () {
        return getStageStyle(feature, "default");
      },
    });

    geoLayer.eachLayer(function (l) {
      _zoneLayers.push({ layer: l, feature: feature });

      l.on("mouseover", function () {
        if (l !== _selectedLayer) l.setStyle(getStageStyle(feature, "hover"));
      });
      l.on("mouseout", function () {
        if (l !== _selectedLayer) l.setStyle(getStageStyle(feature, "default"));
      });

      l.on("click", function (e) {
        L.DomEvent.stopPropagation(e);
        selectLayer(l, feature);
      });
    });

    geoLayer.addTo(_map);
  }

  function selectLayer(layer, feature) {
    if (_selectedLayer && _selectedLayer !== layer) {
      var prevEntry = _zoneLayers.find(function (e) {
        return e.layer === _selectedLayer;
      });
      var prevFeature = prevEntry ? prevEntry.feature : null;
      _selectedLayer.setStyle(getStageStyle(prevFeature, "default"));
    }
    _selectedLayer = layer;
    layer.setStyle(getStageStyle(feature, "selected"));
    if (typeof _onZoneSelected === "function") {
      _onZoneSelected(feature);
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
        var prevEntry = _zoneLayers.find(function (e) {
          return e.layer === _selectedLayer;
        });
        var prevFeature = prevEntry ? prevEntry.feature : null;
        _selectedLayer.setStyle(getStageStyle(prevFeature, "default"));
        _selectedLayer = null;
      }
      if (typeof _onNoMatch === "function") _onNoMatch();
    }
  }

  function flyToZoneById(zoneId) {
    var entry = _zoneLayers.find(function (e) {
      return (
        e.feature &&
        e.feature.properties &&
        e.feature.properties.zoneId === zoneId
      );
    });
    if (entry) {
      selectLayer(entry.layer, entry.feature);
      try {
        var bounds = entry.layer.getBounds();
        if (bounds) {
          _map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }
      } catch (err) {
        console.warn("flyToBounds 失败:", err);
      }
    }
  }

  function findZoneByPoint(lng, lat) {
    var pt;
    try {
      pt = turf.point([lng, lat]);
    } catch (err) {
      return null;
    }
    for (var i = 0; i < _zoneLayers.length; i++) {
      try {
        if (turf.booleanPointInPolygon(pt, _zoneLayers[i].feature)) {
          return _zoneLayers[i].feature.properties.zoneId || null;
        }
      } catch (err) {
        // skip
      }
    }
    return null;
  }

  function filterByStage(stages) {
    if (!stages || stages.length === 0) {
      _zoneLayers.forEach(function (entry) {
        entry.layer.setStyle(getStageStyle(entry.feature, "default"));
      });
      return;
    }
    _zoneLayers.forEach(function (entry) {
      var stage =
        (entry.feature.properties && entry.feature.properties.stage) ||
        "middle";
      if (stages.indexOf(stage) !== -1) {
        entry.layer.setStyle(getStageStyle(entry.feature, "default"));
      } else {
        entry.layer.setStyle({ fillOpacity: 0.05, opacity: 0.2 });
      }
    });
  }

  return {
    initMap: initMap,
    flyToZoneById: flyToZoneById,
    findZoneByPoint: findZoneByPoint,
    filterByStage: filterByStage,
  };
})();
