/**
 * report-common.js - 数据工具台报告页共用工具
 *
 * 只被 reports/ 下的查看页使用：加载 JSON（明确区分 HTTP 失败与 SPA 回退成 HTML）、
 * 创建天地图底图、格式化数值、生成详情面板。
 */
import AppConfig from "/js/config.js";

/** 读取查询参数，缺省时使用 fallback */
export const param = (name, fallback) => {
  const value = new URLSearchParams(window.location.search).get(name);
  return value && value.trim() !== "" ? value.trim() : fallback;
};

/**
 * 加载 JSON。Vite dev / Nginx try_files 对缺失文件会回退 index.html，
 * 因此必须自行解析并给出可定位的错误。
 */
export const loadJson = async (path) => {
  const resp = await fetch(path, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`${path} 加载失败（HTTP ${resp.status}）`);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${path} 响应不是合法 JSON，文件可能不存在（被服务器回退成 HTML）`,
    );
  }
};

/** 创建带天地图底图的 Leaflet 地图 */
export const createMap = (id = "map") => {
  const map = L.map(id, {
    zoomControl: true,
    preferCanvas: true,
    attributionControl: true,
  }).setView(AppConfig.mapCenter, 13);
  const { token, vecUrl, cvaUrl, subdomains, attribution } = AppConfig.tianditu;
  const options = { subdomains, maxZoom: 18, attribution };
  L.tileLayer(vecUrl.replace("{token}", token), options).addTo(map);
  L.tileLayer(cvaUrl.replace("{token}", token), {
    ...options,
    attribution: "",
  }).addTo(map);
  return map;
};

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const formatM = (value, digits = 2) =>
  Number.isFinite(value) ? `${value.toFixed(digits)} m` : "—";

export const formatArea = (m2) =>
  Number.isFinite(m2)
    ? `${(m2 / 10000).toFixed(2)} 万 m²`
    : "—";

export const formatPct = (value) =>
  Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";

/** 经纬度距离（米），用于质心偏移等 */
export const metersBetween = (a, b) => {
  if (!a || !b) return NaN;
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
};

/** 线长度（米） */
export const lineLength = (coords = []) => {
  let total = 0;
  for (let index = 1; index < coords.length; index += 1) {
    total += metersBetween(coords[index - 1], coords[index]);
  }
  return total;
};

/** 渲染详情面板：rows 为 [标签, 值] 数组 */
export const renderDetail = (container, rows, emptyText = "点击左侧条目查看详情") => {
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = rows
    .map(
      ([key, value]) =>
        `<div class="row"><span class="k">${escapeHtml(key)}</span><span class="v">${escapeHtml(
          value,
        )}</span></div>`,
    )
    .join("");
};

/** 统一处理页面级错误：显示在 #status */
export const showError = (message) => {
  const status = document.getElementById("status");
  if (status) {
    status.classList.add("error");
    status.textContent = message;
  }
  console.error(message);
};

/** 返回要素的坐标边界（兼容 Polygon / MultiPolygon / LineString / MultiLineString） */
export const boundsOfGeometry = (geometry) => {
  if (!geometry) return null;
  const coords =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.type === "MultiLineString" ||
          geometry.type === "Polygon" ||
          geometry.type === "MultiPolygon"
        ? geometry.coordinates.flat(2)
        : [];
  if (coords.length === 0) return null;
  return L.latLngBounds(coords.map(([lng, lat]) => [lat, lng]));
};

/** 读取当前数据版本（用于比对页默认旧路网） */
export const currentDataVersion = async () => {
  try {
    const pointer = await loadJson("/data/current.json");
    return pointer?.version ?? null;
  } catch {
    return null;
  }
};
