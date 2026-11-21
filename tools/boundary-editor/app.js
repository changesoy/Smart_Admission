/**
 * 学区边界点选编辑器（独立工具页）
 *
 * 约束：
 * - 只读 boundary_features / network_nodes / network_edges / zone_specs / zones.geojson；
 * - 写入只能走 /__tools/import-draft 转交 import-zone-draft CLI，本页不直接改文件；
 * - 所有选择落为 edgeRefs，导出不含自由坐标；
 * - 几何相交不等于连通，只读节点 connectionType。
 */
import AppConfig from "../../js/config.js";
import {
  buildUsageIndex,
  clearRing,
  clearStep,
  createDraftId,
  createEditorState,
  draftFromState,
  edgeAvailability,
  edgeEndpoints,
  expandRefsToCoordinates,
  findCandidatePaths,
  findReuseOptions,
  flattenRingRefs,
  ringDiagnostics,
  selectEdge,
  serializeDraft,
  reverseEdge,
  undo,
  redo,
  unselectEdge,
} from "../../scripts/lib/draft-core.mjs";
import { validateZoneDraft } from "../../scripts/lib/zone-draft-schema.mjs";

const ui = {
  mode: "mock",
  zoneSpecs: null,
  zonesGeo: null,
  features: null,
  nodes: [],
  edges: [],
  nodeMap: new Map(),
  edgeMap: new Map(),
  featureMap: new Map(),
  usageIndex: new Map(),
  editor: null,
  zoneSpec: null,
  ringIndex: 0,
  activeStepId: null,
  pathStart: null,
  pathTarget: null,
  pathResult: null,
  exportText: "",
  map: null,
  featureLayer: null,
  edgeLayerGroup: null,
  nodeLayerGroup: null,
  edgeLayers: new Map(),
  nodeLayers: new Map(),
};

const $ = (id) => document.getElementById(id);

const pad = (value) => String(value).padStart(2, "0");
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const latLng = (coordinate) => [coordinate[1], coordinate[0]];

const loadJson = async (url, { optional = false } = {}) => {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    if (optional) return null;
    throw new Error(`无法请求 ${url}：${error.message}`);
  }
  if (!response.ok) {
    if (optional) return null;
    throw new Error(`读取 ${url} 失败（HTTP ${response.status}）`);
  }
  try {
    return await response.json();
  } catch (error) {
    if (optional) return null;
    throw new Error(`解析 ${url} 失败：${error.message}`);
  }
};

const mockUrl = (name) => new URL(`./mock/${name}`, import.meta.url).href;

const showBanner = (message, kind = "info") => {
  const banner = $("banner");
  banner.textContent = message;
  banner.className = `banner ${kind}`;
  banner.onclick = () => banner.classList.add("hidden");
};

const hideBanner = () => $("banner").classList.add("hidden");

const featureName = (featureId) =>
  ui.featureMap.get(featureId)?.properties?.canonicalName ?? featureId;

const nodeLabel = (nodeId) => {
  const node = ui.nodeMap.get(nodeId);
  return node?.label ?? nodeId;
};

const edgeLabel = (edgeId) => {
  const edge = ui.edgeMap.get(edgeId);
  return edge ? featureName(edge.featureId) : edgeId;
};

const partCoordinates = (feature, partIndex) => {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  if (geometry.type === "LineString") return partIndex === 0 ? geometry.coordinates : [];
  if (geometry.type === "MultiLineString") return geometry.coordinates[partIndex] ?? [];
  return [];
};

const edgeCoordinates = (edge) => {
  const feature = ui.featureMap.get(edge.featureId);
  const part = partCoordinates(feature, edge.partIndex);
  return part.slice(edge.fromVertexIndex, edge.toVertexIndex + 1);
};

const zoneIndexOf = (edgeId) => ui.usageIndex.get(edgeId) ?? [];

const currentRing = () => ui.editor?.rings[ui.ringIndex] ?? null;

const currentStep = () => {
  const ring = currentRing();
  if (!ring) return null;
  if (ui.activeStepId) {
    const step = ring.steps.find((item) => item.stepId === ui.activeStepId);
    if (step) return step;
  }
  return ring.steps[0] ?? null;
};

const currentEndNodeId = () => {
  const ring = currentRing();
  if (!ring) return null;
  const refs = flattenRingRefs(ring);
  if (refs.length === 0) return null;
  const last = refs[refs.length - 1];
  const edge = ui.edgeMap.get(last.edgeId);
  if (!edge) return null;
  return edgeEndpoints(edge, last.direction).endNodeId;
};

const formalStepOf = (stepId) => {
  for (const ring of ui.zoneSpec?.rings ?? []) {
    const step = (ring.steps ?? []).find((item) => item.stepId === stepId);
    if (step) return step;
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* 数据加载与编辑器初始化                                               */
/* ------------------------------------------------------------------ */

const loadDataSource = async (mode) => {
  let zoneSpecs;
  let nodes;
  let edges;
  let features;
  let zonesGeo = null;

  if (mode === "mock") {
    zoneSpecs = await loadJson(mockUrl("mock-zone-spec.json"));
    nodes = await loadJson(mockUrl("network_nodes.json"));
    edges = await loadJson(mockUrl("network_edges.json"));
    features = await loadJson(mockUrl("boundary_features.geojson"));
  } else {
    try {
      nodes = await loadJson("/data/network_nodes.json");
      edges = await loadJson("/data/network_edges.json");
    } catch (error) {
      throw new Error(
        `${error.message}。请先运行 npm run generate:network -- --effective-date ${today()} --write 生成网络数据。`,
      );
    }
    zoneSpecs = await loadJson("/data/zone_specs.v2.json");
    features = await loadJson("/data/boundary_features.v2.geojson");
    zonesGeo = await loadJson("/data/zones.geojson", { optional: true });
  }

  if (!Array.isArray(zoneSpecs?.zones) || zoneSpecs.zones.length === 0) {
    throw new Error("zone_specs 中没有可用学区");
  }
  if (!Array.isArray(nodes?.nodes)) throw new Error("network_nodes 缺少 nodes 数组");
  if (!Array.isArray(edges?.edges)) throw new Error("network_edges 缺少 edges 数组");
  if (features?.type !== "FeatureCollection") {
    throw new Error("boundary_features 不是 FeatureCollection");
  }

  ui.zoneSpecs = zoneSpecs;
  ui.zonesGeo = zonesGeo;
  ui.features = features;
  ui.nodes = nodes.nodes;
  ui.edges = edges.edges;
  ui.nodeMap = new Map(ui.nodes.map((node) => [node.nodeId, node]));
  ui.edgeMap = new Map(ui.edges.map((edge) => [edge.edgeId, edge]));
  ui.featureMap = new Map(
    features.features.map((feature) => [feature.properties?.featureId, feature]),
  );
  ui.usageIndex = buildUsageIndex(zoneSpecs);
};

const ZONE_SELECT_STORAGE_KEY = "boundary-editor.selectedZoneId";
const zoneCollator = new Intl.Collator("zh-Hans-CN", { sensitivity: "base" });

const zoneSteps = (zone) => (zone.rings ?? []).flatMap((ring) => ring.steps ?? []);

const zoneBindingState = (zone) => {
  const steps = zoneSteps(zone);
  const boundSteps = steps.filter((step) => (step.edgeRefs?.length ?? 0) > 0).length;
  if (boundSteps === 0) return { key: "unbound", label: "未绑定" };
  if (boundSteps < steps.length) {
    return { key: "partial", label: `部分绑定 ${boundSteps}/${steps.length}` };
  }
  const outer = (zone.rings ?? []).find((ring) => ring.role === "outer");
  const coordinates = expandRefsToCoordinates(flattenRingRefs(outer), ui.edges, ui.featureMap);
  const first = coordinates.at(0);
  const last = coordinates.at(-1);
  const closed =
    coordinates.length > 2 &&
    Array.isArray(first) &&
    Array.isArray(last) &&
    first[0] === last[0] &&
    first[1] === last[1];
  return closed
    ? { key: "closed", label: "已闭环" }
    : { key: "bound", label: "已绑定未闭合" };
};

const currentZoneId = () => $("zone-select").value;

const rememberZoneId = (zoneId) => {
  try {
    localStorage.setItem(ZONE_SELECT_STORAGE_KEY, zoneId);
  } catch {
    /* 隐私模式下忽略 */
  }
};

const rememberedZoneId = () => {
  try {
    return localStorage.getItem(ZONE_SELECT_STORAGE_KEY);
  } catch {
    return null;
  }
};

const setZoneValue = (zoneId) => {
  $("zone-select").value = zoneId;
  const zone = ui.zoneSpecs?.zones.find((item) => item.zoneId === zoneId);
  $("zone-picker-current").textContent = zone
    ? `${zone.zoneId} · ${zone.zoneName ?? ""}`
    : "未选择学区";
};

const renderZoneList = (keyword = "") => {
  const list = $("zone-picker-list");
  const normalized = keyword.trim().toLowerCase();
  const zones = ui.zoneSpecs.zones
    .filter(
      (zone) =>
        normalized.length === 0 ||
        `${zone.zoneId} ${zone.zoneName ?? ""} ${zone.stage ?? ""}`
          .toLowerCase()
          .includes(normalized),
    )
    .sort((left, right) => zoneCollator.compare(left.zoneName ?? "", right.zoneName ?? ""));

  list.innerHTML = "";
  $("zone-picker-empty").classList.toggle("hidden", zones.length > 0);
  if (zones.length === 0) return;

  const groups = new Map();
  zones.forEach((zone) => {
    const key = zone.stage || "其他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(zone);
  });

  groups.forEach((items, stage) => {
    const title = document.createElement("div");
    title.className = "zone-picker-group";
    title.textContent = stage;
    list.append(title);

    items.forEach((zone) => {
      const state = zoneBindingState(zone);
      const option = document.createElement("button");
      option.type = "button";
      option.className = "zone-option";
      option.dataset.zoneId = zone.zoneId;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", zone.zoneId === currentZoneId() ? "true" : "false");
      option.innerHTML =
        `<span class="zone-option-name">${escapeHtml(zone.zoneName ?? zone.zoneId)}</span>` +
        `<span class="zone-option-meta"><code>${escapeHtml(zone.zoneId)}</code>` +
        `<span class="zone-badge ${state.key}">${escapeHtml(state.label)}</span></span>`;
      option.addEventListener("click", () => applyZoneSelection(zone.zoneId));
      list.append(option);
    });
  });
};

const openZonePicker = () => {
  $("zone-picker-popup").hidden = false;
  $("zone-picker-button").setAttribute("aria-expanded", "true");
  $("zone-search").value = "";
  renderZoneList("");
  $("zone-search").focus();
};

const closeZonePicker = () => {
  $("zone-picker-popup").hidden = true;
  $("zone-picker-button").setAttribute("aria-expanded", "false");
};

const moveZoneActive = (delta) => {
  const options = [...$("zone-picker-list").querySelectorAll(".zone-option")];
  if (options.length === 0) return;
  const current = options.findIndex((option) => option.classList.contains("active"));
  const next =
    current < 0
      ? delta > 0
        ? 0
        : options.length - 1
      : (current + delta + options.length) % options.length;
  options.forEach((option, index) => option.classList.toggle("active", index === next));
  options[next].scrollIntoView({ block: "nearest" });
};

const applyZoneSelection = (zoneId) => {
  setZoneValue(zoneId);
  rememberZoneId(zoneId);
  closeZonePicker();
  try {
    initEditorForZone(zoneId);
    hideBanner();
  } catch (error) {
    showBanner(error.message, "error");
  }
};

const populateZoneSelect = (preferredZoneId = null) => {
  const { zones } = ui.zoneSpecs;
  const candidate = preferredZoneId ?? rememberedZoneId();
  const selected = zones.some((zone) => zone.zoneId === candidate) ? candidate : zones[0].zoneId;
  setZoneValue(selected);
  renderZoneList("");
};

const initEditorForZone = (zoneId) => {
  const zoneSpec = ui.zoneSpecs.zones.find((zone) => zone.zoneId === zoneId);
  if (!zoneSpec) throw new Error(`未找到学区 ${zoneId}`);
  ui.zoneSpec = zoneSpec;
  ui.editor = createEditorState({
    zoneSpec,
    draftId: createDraftId({ zoneId, date: today(), sequence: 1 }),
    createdBy: $("created-by").value.trim() || "用户",
    date: today(),
  });
  ui.ringIndex = 0;
  const outer = ui.editor.rings.find((ring) => ring.role === "outer");
  ui.activeStepId = outer?.steps?.[0]?.stepId ?? null;
  ui.pathStart = null;
  ui.pathTarget = null;
  ui.pathResult = null;
  ui.exportText = "";
  $("status-select").value = "editing";
  renderAll();
};

/* ------------------------------------------------------------------ */
/* 地图                                                                 */
/* ------------------------------------------------------------------ */

const initMap = () => {
  if (ui.map) return;
  ui.map = L.map("map", { zoomControl: true }).setView(AppConfig.mapCenter, 14);

  const { token, vecUrl, cvaUrl, subdomains, attribution } = AppConfig.tianditu;
  const tileOptions = { subdomains, maxZoom: 18, attribution };
  L.tileLayer(vecUrl.replace("{token}", token), tileOptions).addTo(ui.map);
  L.tileLayer(cvaUrl.replace("{token}", token), { ...tileOptions, attribution: "" }).addTo(ui.map);
  ui.featureLayer = L.layerGroup().addTo(ui.map);
  ui.edgeLayerGroup = L.layerGroup().addTo(ui.map);
  ui.nodeLayerGroup = L.layerGroup().addTo(ui.map);
};

const drawMap = () => {
  initMap();
  ui.featureLayer.clearLayers();
  ui.edgeLayerGroup.clearLayers();
  ui.nodeLayerGroup.clearLayers();
  ui.edgeLayers.clear();
  ui.nodeLayers.clear();

  const allCoordinates = [];

  ui.features.features.forEach((feature) => {
    const geometry = feature.geometry;
    const parts =
      geometry?.type === "LineString"
        ? [geometry.coordinates]
        : geometry?.type === "MultiLineString"
          ? geometry.coordinates
          : [];
    parts.forEach((part) => {
      part.forEach((coordinate) => allCoordinates.push(coordinate));
      L.polyline(part.map(latLng), {
        color: "#94a3b8",
        weight: 1,
        opacity: 0.7,
        interactive: false,
      }).addTo(ui.featureLayer);
    });
  });

  ui.edges.forEach((edge) => {
    if (edge.lifecycle !== "active") return;
    const coordinates = edgeCoordinates(edge);
    if (coordinates.length < 2) return;
    coordinates.forEach((coordinate) => allCoordinates.push(coordinate));
    const layer = L.polyline(coordinates.map(latLng), {
      color: "#2563eb",
      weight: 3,
      opacity: 0.9,
    });
    layer.bindTooltip(edgeTooltipHtml(edge), {
      sticky: true,
      className: "edge-tooltip",
      direction: "top",
    });
    layer.on("click", () => handleEdgeClick(edge.edgeId));
    layer.addTo(ui.edgeLayerGroup);
    ui.edgeLayers.set(edge.edgeId, layer);
  });

  ui.nodes.forEach((node) => {
    const placements = node.placements ?? [];
    if (placements.length === 0) return;
    const placement = placements[0];
    const coordinate = partCoordinates(
      ui.featureMap.get(placement.featureId),
      placement.partIndex,
    )[placement.vertexIndex];
    if (!coordinate) return;
    const connected = node.connectionType === "connected";
    const marker = L.circleMarker(latLng(coordinate), {
      radius: 5,
      color: connected ? "#0f172a" : "#b45309",
      weight: 2,
      fillColor: connected ? "#f8fafc" : "#fef3c7",
      fillOpacity: connected ? 0.9 : 0.7,
      dashArray: connected ? null : "3,3",
    });
    marker.bindTooltip(
      `<strong>${escapeHtml(node.label ?? node.nodeId)}</strong><br/>` +
        `<span class="mono">${escapeHtml(node.nodeId)}</span> · ${escapeHtml(node.nodeType)} / ${escapeHtml(node.connectionType)}<br/>` +
        `点击设置路径终点${connected ? "" : "（该节点不可通行）"}`,
      { className: "edge-tooltip", direction: "top" },
    );
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      handleNodeClick(node.nodeId, event.originalEvent);
    });
    marker.addTo(ui.nodeLayerGroup);
    ui.nodeLayers.set(node.nodeId, marker);
  });

  if (allCoordinates.length > 0) {
    ui.map.fitBounds(L.latLngBounds(allCoordinates.map(latLng)), {
      padding: [24, 24],
    });
  }
  renderMapColors();
};

const edgeTooltipHtml = (edge) => {
  const usage = zoneIndexOf(edge.edgeId).filter((item) => item.zoneId !== ui.editor?.zoneId);
  const selected = currentRing()?.steps?.some((step) =>
    (step.edgeRefs ?? []).some((ref) => ref.edgeId === edge.edgeId),
  );
  const availability = edgeAvailability(edge, ui.nodeMap);
  const usedText =
    usage.length === 0
      ? "无"
      : usage
          .map((item) => `${item.zoneName}（${item.zoneId}·${item.ringRole}）`)
          .join("、");
  return (
    `<strong>${escapeHtml(featureName(edge.featureId))} · ${escapeHtml(edge.edgeId)}</strong>` +
    `<span class="mono">${escapeHtml(nodeLabel(edge.fromNodeId))} → ${escapeHtml(nodeLabel(edge.toNodeId))}</span><br/>` +
    `状态：${escapeHtml(edge.lifecycle)} · ${edge.boundaryEligible ? "可作边界" : "不可作边界"} · ${escapeHtml(edge.verificationStatus)}<br/>` +
    `长度：${edge.lengthM} m<br/>` +
    `<span class="${usage.length > 0 ? "used" : ""}">已使用：${escapeHtml(usedText)}</span>` +
    (selected ? "<br/>当前草稿：已选" : "") +
    (availability.selectable ? "" : `<br/><span class="used">不可选：${escapeHtml(availability.reason)}</span>`)
  );
};

const ringsWithRefs = () =>
  (ui.editor?.rings ?? []).flatMap((ring) =>
    (ring.steps ?? []).flatMap((step) => step.edgeRefs ?? []),
  );

const renderMapColors = () => {
  if (!ui.map || !ui.editor) return;
  const selected = new Set();
  ringsWithRefs().forEach((ref) => selected.add(ref.edgeId));

  ui.edgeLayers.forEach((layer, edgeId) => {
    const edge = ui.edgeMap.get(edgeId);
    if (!edge) return;
    const isSelected = selected.has(edgeId);
    const availability = edgeAvailability(edge, ui.nodeMap);
    const usedByOther = zoneIndexOf(edgeId).some(
      (item) => item.zoneId !== ui.editor.zoneId,
    );
    if (isSelected) {
      layer.setStyle({ color: "#16a34a", weight: 6, opacity: 1, dashArray: null });
      layer.bringToFront();
    } else if (!availability.selectable) {
      layer.setStyle({ color: "#94a3b8", weight: 2, opacity: 0.6, dashArray: "5,5" });
    } else if (usedByOther) {
      layer.setStyle({ color: "#f59e0b", weight: 4, opacity: 0.95, dashArray: null });
    } else {
      layer.setStyle({ color: "#2563eb", weight: 3, opacity: 0.9, dashArray: null });
    }
  });

  ui.nodeLayers.forEach((marker, nodeId) => {
    const node = ui.nodeMap.get(nodeId);
    const connected = node?.connectionType === "connected";
    const base = connected ? "#0f172a" : "#b45309";
    if (nodeId === ui.pathTarget) {
      marker.setStyle({ color: "#dc2626", fillColor: "#fecaca", weight: 3, radius: 7 });
    } else if (nodeId === (ui.pathStart ?? currentEndNodeId())) {
      marker.setStyle({ color: "#16a34a", fillColor: "#dcfce7", weight: 3, radius: 7 });
    } else {
      marker.setStyle({
        color: base,
        fillColor: connected ? "#f8fafc" : "#fef3c7",
        weight: 2,
        radius: 5,
      });
    }
  });
};

/* ------------------------------------------------------------------ */
/* 交互                                                                 */
/* ------------------------------------------------------------------ */

const invalidateValidation = () => {
  ui.exportText = "";
  const preview = $("export-preview");
  preview.classList.add("hidden");
  preview.textContent = "";
  $("validation").textContent = "尚未校验";
  $("validation").className = "validation";
};

const renderAll = () => {
  renderDraftMeta();
  renderRingTabs();
  renderSteps();
  renderPathPanel();
  renderReusePanel();
  renderMapColors();
};

const renderDraftMeta = () => {
  if (!ui.editor) return;
  $("draft-id").textContent = ui.editor.draftId;
  $("status-select").value = ui.editor.status;
  $("created-by").value = ui.editor.createdBy;
  const ring = currentRing();
  const state = $("closure-state");
  if (!ring) {
    state.textContent = "无环";
    state.className = "state bad";
    return;
  }
  const diagnostics = ringDiagnostics(ring, ui.edges);
  if (diagnostics.closed) {
    state.textContent = "已闭合 ✓";
    state.className = "state ok";
  } else {
    state.textContent = "未闭合";
    state.className = "state bad";
  }
};

const renderRingTabs = () => {
  const tabs = $("ring-tabs");
  tabs.innerHTML = "";
  const holeNote = $("hole-note");
  if (!ui.editor) return;

  ui.editor.rings.forEach((ring, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${index === ui.ringIndex ? " active" : ""}`;
    button.textContent =
      ring.role === "outer" ? `外环 ${ring.steps.length} 步` : `洞环 ${ring.steps.length} 步`;
    button.onclick = () => {
      ui.ringIndex = index;
      ui.activeStepId = ring.steps[0]?.stepId ?? null;
      ui.pathResult = null;
      renderAll();
    };
    tabs.append(button);
  });

  const ring = currentRing();
  const formalHoles = (ui.zoneSpec?.rings ?? []).filter((item) => item.role === "hole");
  if (ring?.role === "hole") {
    holeNote.classList.remove("hidden");
    holeNote.textContent =
      `洞环 appliesToRingId = ${ring.appliesToRingId ?? "（缺失）"}。` +
      "仅完全内嵌、独立闭合的排除区建洞环；与外环相接的排除区按契约 9.6 并入外环凹口。";
  } else if (formalHoles.length === 0) {
    holeNote.classList.remove("hidden");
    holeNote.textContent =
      "当前学区没有正式洞环步骤。完全内嵌的排除区需先由 B 在 zone_specs 中补充步骤，编辑器不会自行新建步骤。";
  } else {
    holeNote.classList.add("hidden");
  }
};

const renderSteps = () => {
  const container = $("step-list");
  container.innerHTML = "";
  const ring = currentRing();
  if (!ring) {
    container.textContent = "没有可编辑的环";
    return;
  }

  ring.steps.forEach((step) => {
    const formal = formalStepOf(step.stepId);
    const row = document.createElement("div");
    row.className = `step${step.stepId === ui.activeStepId ? " active" : ""}`;
    row.onclick = () => {
      ui.activeStepId = step.stepId;
      renderSteps();
      renderMapColors();
    };

    const side = formal?.side ?? "说明";
    row.innerHTML =
      `<div class="step-head">` +
      `<span class="side${side === "排除" ? " exclude" : ""}">${escapeHtml(side)}</span>` +
      `<span class="step-text">${escapeHtml(formal?.text ?? "")}</span>` +
      `<span class="step-id">${escapeHtml(step.stepId)}</span>` +
      `</div>` +
      `<div class="chips"></div>`;

    const chips = row.querySelector(".chips");
    if ((step.edgeRefs ?? []).length === 0) {
      const empty = document.createElement("div");
      empty.className = "chip-empty";
      empty.textContent = "未绑定边：点击地图上的边加入此步骤";
      chips.append(empty);
    }

    (step.edgeRefs ?? []).forEach((ref) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML =
        `<span class="edge-id">${escapeHtml(ref.edgeId)}</span>` +
        `<span class="dir">${ref.direction === "forward" ? "正向 →" : "反向 ←"}</span>` +
        `<span class="chip-name">${escapeHtml(edgeLabel(ref.edgeId))}</span>`;
      const locate = document.createElement("button");
      locate.type = "button";
      locate.textContent = "定位";
      locate.onclick = (event) => {
        event.stopPropagation();
        const edge = ui.edgeMap.get(ref.edgeId);
        if (!edge) return;
        const coordinates = edgeCoordinates(edge);
        ui.map.fitBounds(L.latLngBounds(coordinates.map(latLng)), { maxZoom: 18 });
      };
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "取消";
      remove.onclick = (event) => {
        event.stopPropagation();
        const result = unselectEdge(ui.editor, {
          ringIndex: ui.ringIndex,
          stepId: step.stepId,
          edgeId: ref.edgeId,
          decidedBy: ui.editor.createdBy,
          decidedAt: today(),
        });
        if (!result.ok) showBanner(result.error, "error");
        invalidateValidation();
        renderAll();
      };
      const flip = document.createElement("button");
      flip.type = "button";
      flip.textContent = "反向";
      flip.onclick = (event) => {
        event.stopPropagation();
        const result = reverseEdge(ui.editor, {
          ringIndex: ui.ringIndex,
          stepId: step.stepId,
          edgeId: ref.edgeId,
          decidedBy: ui.editor.createdBy,
          decidedAt: today(),
        });
        if (!result.ok) showBanner(result.error, "error");
        invalidateValidation();
        renderAll();
      };
      chip.append(locate, flip, remove);
      chips.append(chip);
    });

    container.append(row);
  });

  const diagnostics = ringDiagnostics(ring, ui.edges);
  if (diagnostics.breaks.length > 0) {
    const message = document.createElement("div");
    message.className = "message error";
    message.textContent = `断链/未闭合：${diagnostics.breaks
      .map((item) => item.reason)
      .join("；")}`;
    container.append(message);
  }
  if (diagnostics.duplicateEdgeIds.length > 0) {
    const message = document.createElement("div");
    message.className = "message error";
    message.textContent = `同一环内重复引用：${[...new Set(diagnostics.duplicateEdgeIds)].join("、")}`;
    container.append(message);
  }
};

const handleEdgeClick = (edgeId) => {
  if (!ui.editor) return;
  const ring = currentRing();
  const step =
    ring.steps.find((item) =>
      (item.edgeRefs ?? []).some((ref) => ref.edgeId === edgeId),
    ) ?? null;
  let result;
  if (step) {
    result = unselectEdge(ui.editor, {
      ringIndex: ui.ringIndex,
      stepId: step.stepId,
      edgeId,
      decidedBy: ui.editor.createdBy,
      decidedAt: today(),
    });
  } else {
    const target = currentStep();
    if (!target) {
      showBanner("当前环没有步骤", "error");
      return;
    }
    result = selectEdge(
      ui.editor,
      { edges: ui.edges, nodes: ui.nodes },
      {
        ringIndex: ui.ringIndex,
        stepId: target.stepId,
        edgeId,
        decidedBy: ui.editor.createdBy,
        decidedAt: today(),
      },
    );
  }

  if (!result.ok) {
    showBanner(result.error, "error");
    return;
  }
  hideBanner();
  ui.pathResult = null;
  invalidateValidation();
  renderAll();
};

const handleNodeClick = (nodeId, originalEvent) => {
  if (originalEvent?.shiftKey) {
    ui.pathStart = nodeId;
    ui.pathTarget = null;
  } else if (ui.pathTarget === nodeId) {
    ui.pathTarget = null;
  } else if (!ui.pathStart && !currentEndNodeId()) {
    ui.pathStart = nodeId;
  } else {
    ui.pathTarget = nodeId;
  }
  ui.pathResult = null;
  renderPathPanel();
  renderMapColors();
};

const renderPathPanel = () => {
  const start = ui.pathStart ?? currentEndNodeId();
  $("path-start").textContent = start ? `${nodeLabel(start)}（${start}）` : "未确定（点击节点设置）";
  $("path-target").textContent = ui.pathTarget
    ? `${nodeLabel(ui.pathTarget)}（${ui.pathTarget}）`
    : "点击地图节点选择";

  const container = $("path-list");
  container.innerHTML = "";
  const result = ui.pathResult;
  if (!result) return;

  if (result.paths.length === 0) {
    const message = document.createElement("div");
    message.className = "message error";
    message.textContent = `无解：${result.reason ?? "无符合条件的通路"}。不会补画直线，也不会退化为最近道路。`;
    container.append(message);
    return;
  }

  if (result.truncated) {
    const message = document.createElement("div");
    message.className = "message warn";
    message.textContent = "候选路径超过上限，已截断；请缩小起终点范围或人工指定中间节点。";
    container.append(message);
  }

  result.paths.forEach((path, index) => {
    const item = document.createElement("div");
    item.className = "path-item";
    const usedZones = [
      ...new Set(
        path.edgeRefs.flatMap((ref) =>
          zoneIndexOf(ref.edgeId)
            .filter((usage) => usage.zoneId !== ui.editor.zoneId)
            .map((usage) => usage.zoneName),
        ),
      ),
    ];
    item.innerHTML =
      `<div class="path-head"><span>候选 ${index + 1}</span><span>${path.edgeRefs.length} 条边 · ${path.lengthM} m</span></div>` +
      `<div class="path-edges">${path.edgeRefs
        .map((ref) => `${escapeHtml(ref.edgeId)}${ref.direction === "reverse" ? "←" : "→"}`)
        .join(" ")}</div>` +
      (usedZones.length > 0
        ? `<div class="message warn">已被其他学区使用：${escapeHtml(usedZones.join("、"))}</div>`
        : "");
    const actions = document.createElement("div");
    actions.className = "path-actions";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "确认应用到当前步骤";
    apply.onclick = () =>
      applyEdgeSequence(path.edgeRefs.map((ref) => ref.edgeId), "候选路径");
    actions.append(apply);
    item.append(actions);
    container.append(item);
  });
};

const snapshotEditor = () => ({
  rings: JSON.parse(JSON.stringify(ui.editor.rings)),
  operations: JSON.parse(JSON.stringify(ui.editor.operations)),
  undoStack: ui.editor.undoStack.map((entry) => ({
    operation: JSON.parse(JSON.stringify(entry.operation)),
    previousRings: JSON.parse(JSON.stringify(entry.previousRings)),
  })),
  redoStack: ui.editor.redoStack.map((entry) => ({
    operation: JSON.parse(JSON.stringify(entry.operation)),
    afterRings: JSON.parse(JSON.stringify(entry.afterRings)),
  })),
  updatedAt: ui.editor.updatedAt,
});

const restoreEditor = (snapshot) => {
  ui.editor.rings = snapshot.rings;
  ui.editor.operations = snapshot.operations;
  ui.editor.undoStack = snapshot.undoStack;
  ui.editor.redoStack = snapshot.redoStack;
  ui.editor.updatedAt = snapshot.updatedAt;
};

const applyEdgeSequence = (edgeIds, sourceLabel) => {
  const step = currentStep();
  if (!step) {
    showBanner("当前环没有可写入的步骤", "error");
    return false;
  }
  const snapshot = snapshotEditor();
  for (const edgeId of edgeIds) {
    const result = selectEdge(
      ui.editor,
      { edges: ui.edges, nodes: ui.nodes },
      {
        ringIndex: ui.ringIndex,
        stepId: step.stepId,
        edgeId,
        decidedBy: ui.editor.createdBy,
        decidedAt: today(),
      },
    );
    if (!result.ok) {
      restoreEditor(snapshot);
      showBanner(`${sourceLabel}应用失败，已整体回滚：${result.error}`, "error");
      renderAll();
      return false;
    }
  }
  hideBanner();
  ui.pathResult = null;
  invalidateValidation();
  renderAll();
  return true;
};

const renderReusePanel = () => {
  const container = $("reuse-list");
  container.innerHTML = "";
  if (!ui.editor) return;
  const end = currentEndNodeId();
  const options = findReuseOptions({
    zoneSpecs: ui.zoneSpecs,
    edges: ui.edges,
    excludeZoneId: ui.editor.zoneId,
    atNodeId: end,
  });
  const all = findReuseOptions({
    zoneSpecs: ui.zoneSpecs,
    edges: ui.edges,
    excludeZoneId: ui.editor.zoneId,
  });

  if (all.length === 0) {
    const message = document.createElement("div");
    message.className = "message warn";
    message.textContent =
      "暂无其他学区已绑定的连续边链。真实数据在正式步骤补齐 edgeRefs 前不会出现可复用链。";
    container.append(message);
    return;
  }

  const candidates = options.length > 0 ? options : all;
  candidates.forEach((chain) => {
    const applicable = !end || chain.nodeIds[0] === end || chain.nodeIds.at(-1) === end;
    const orderedEdgeIds =
      !end || chain.nodeIds[0] === end
        ? chain.refs.map((ref) => ref.edgeId)
        : [...chain.refs].reverse().map((ref) => ref.edgeId);

    const item = document.createElement("div");
    item.className = "path-item";
    item.innerHTML =
      `<div class="path-head"><span>${escapeHtml(chain.zoneName)}（${escapeHtml(chain.zoneId)}）</span><span>${chain.refs.length} 条边 · ${chain.lengthM} m</span></div>` +
      `<div class="path-edges">${chain.refs
        .map((ref) => escapeHtml(ref.edgeId))
        .join(" → ")}</div>` +
      `<div class="message${applicable ? " ok" : " warn"}">${
        applicable
          ? end
            ? "与当前终点衔接，可整链加入"
            : "当前环为空，将从链首开始"
          : "与当前终点不衔接，需先补齐中间边"
      }</div>`;
    const actions = document.createElement("div");
    actions.className = "path-actions";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "确认整链加入当前步骤";
    apply.disabled = !applicable;
    apply.onclick = () => applyEdgeSequence(orderedEdgeIds, "共边链");
    actions.append(apply);
    item.append(actions);
    container.append(item);
  });
};

/* ------------------------------------------------------------------ */
/* 校验与导出                                                           */
/* ------------------------------------------------------------------ */

const buildDraft = () => {
  if (!ui.editor) return null;
  const status = $("status-select").value;
  const createdBy = $("created-by").value.trim() || "用户";
  ui.editor.createdBy = createdBy;
  return draftFromState(ui.editor, {
    status,
    createdBy,
    updatedAt: today(),
    rejectReason: status === "rejected" ? "人工驳回，待补充依据" : null,
  });
};

const unboundStepCount = (draft) =>
  (draft.rings ?? []).reduce(
    (sum, ring) =>
      sum +
      (ring.steps ?? []).filter((step) => (step.edgeRefs ?? []).length === 0).length,
    0,
  );

const runValidation = ({ render = true } = {}) => {
  const draft = buildDraft();
  if (!draft) return { errors: [], warnings: [], text: "" };
  const validation = validateZoneDraft(draft, {
    zoneSpec: ui.zoneSpec,
    nodes: ui.nodes,
    edges: ui.edges,
  });
  ui.exportText = serializeDraft(draft);

  if (render) {
    const container = $("validation");
    container.className = "validation";
    container.innerHTML = "";
    if (validation.errors.length === 0 && validation.warnings.length === 0) {
      if (draft.status === "editing") {
        const unbound = unboundStepCount(draft);
        container.innerHTML =
          unbound > 0
            ? `<div class="ok">editing：结构检查通过，尚有 ${unbound} 个步骤未绑定边；补齐后切到 readyForReview 才能导入。</div>`
            : '<div class="ok">editing：结构检查通过；切到 readyForReview 完成闭合校验后才能导入。</div>';
      } else {
        container.innerHTML = '<div class="ok">通过 D01–D17 校验，可导出待审核草稿。</div>';
      }
    } else {
      validation.errors.forEach(({ section, message }) => {
        const line = document.createElement("div");
        line.className = "error";
        line.textContent = `错误 [${section}] ${message}`;
        container.append(line);
      });
      validation.warnings.forEach(({ section, message }) => {
        const line = document.createElement("div");
        line.className = "warning";
        line.textContent = `警告 [${section}] ${message}`;
        container.append(line);
      });
    }
  }

  return { ...validation, text: ui.exportText };
};

const ensureExport = () => {
  const result = runValidation();
  const status = $("status-select").value;
  if (result.errors.length > 0) {
    if (status !== "editing") {
      showBanner(
        `状态为 ${status} 时导出被阻断：${result.errors.length} 个错误。请修正或切回 editing。`,
        "error",
      );
      return null;
    }
    showBanner(`草稿存在 ${result.errors.length} 个错误，仍以 editing 状态导出。`, "warn");
  }
  return result.text;
};

const downloadDraft = () => {
  const text = ensureExport();
  if (!text) return;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${ui.editor.draftId}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  $("export-preview").textContent = text;
  $("export-preview").classList.remove("hidden");
};

const copyDraft = async () => {
  const text = ensureExport();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showBanner("草稿 JSON 已复制到剪贴板", "info");
  } catch {
    showBanner("浏览器禁止剪贴板写入，请使用「下载 JSON」", "warn");
  }
};

const writeDraft = async () => {
  if (ui.mode !== "real") {
    showBanner("mock 模式只用于演示，不能写入项目数据", "warn");
    return;
  }
  const draft = buildDraft();
  if (!draft) return;
  const result = runValidation();
  if (draft.status !== "readyForReview") {
    showBanner(`只有 readyForReview 的草稿允许写入，当前为 ${draft.status}`, "error");
    return;
  }
  if (result.errors.length > 0) {
    showBanner(`草稿存在 ${result.errors.length} 个错误，拒绝写入`, "error");
    return;
  }
  const confirmed = window.confirm(
    `将把 ${draft.zoneId} 的 edgeRefs 写入 data/zone_specs.v2.json\n` +
      `草稿：${draft.draftId}\n\n这会修改正式数据，继续？`,
  );
  if (!confirmed) return;

  try {
    const response = await fetch("/__tools/import-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, confirm: draft.draftId }),
    });
    const payload = await response.json();
    const detail = payload.report ?? payload.stdout ?? "";
    if (payload.ok) {
      $("export-preview").textContent = detail;
      $("export-preview").classList.remove("hidden");
      showBanner(`已写入 ${draft.zoneId}（草稿 ${draft.draftId}），刷新页面可看到最新绑定。`, "info");
      return;
    }
    if (detail) {
      $("export-preview").textContent = detail;
      $("export-preview").classList.remove("hidden");
    }
    showBanner(payload.error || payload.stderr || `写入失败（退出码 ${payload.code}）`, "error");
  } catch (error) {
    showBanner(`写入请求失败：${error.message}（需通过 npm run ui 启动）`, "error");
  }
};

const importDraft = async (file) => {
  let draft;
  try {
    draft = JSON.parse(await file.text());
  } catch (error) {
    showBanner(`导入失败：${error.message}`, "error");
    return;
  }
  const zoneSpec = ui.zoneSpecs.zones.find((zone) => zone.zoneId === draft.zoneId);
  if (!zoneSpec) {
    showBanner(`当前数据源没有 zoneId=${draft.zoneId} 的学区`, "error");
    return;
  }
  ui.zoneSpec = zoneSpec;
  setZoneValue(zoneSpec.zoneId);
  rememberZoneId(zoneSpec.zoneId);
  ui.editor = createEditorState({ zoneSpec, draft, date: today() });
  ui.ringIndex = 0;
  ui.activeStepId = ui.editor.rings[0]?.steps?.[0]?.stepId ?? null;
  ui.pathStart = null;
  ui.pathTarget = null;
  ui.pathResult = null;
  invalidateValidation();
  renderAll();
  showBanner(`已载入草稿 ${draft.draftId}（${draft.status}）`, "info");
};

/* ------------------------------------------------------------------ */
/* 事件绑定与启动                                                       */
/* ------------------------------------------------------------------ */

const bindEvents = () => {
  $("mode-select").addEventListener("change", async (event) => {
    const previous = ui.mode;
    const mode = event.target.value;
    try {
      ui.mode = mode;
      await loadDataSource(mode);
      const preferred = ui.zoneSpec?.zoneId ?? null;
      populateZoneSelect(preferred);
      drawMap();
      initEditorForZone(currentZoneId());
      rememberZoneId(currentZoneId());
      hideBanner();
    } catch (error) {
      ui.mode = previous;
      event.target.value = previous;
      showBanner(error.message, "error");
    }
  });

  $("zone-picker-button").addEventListener("click", () => {
    if ($("zone-picker-popup").hidden) openZonePicker();
    else closeZonePicker();
  });

  $("zone-search").addEventListener("input", (event) => {
    renderZoneList(event.target.value);
  });

  $("zone-search").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveZoneActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveZoneActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = $("zone-picker-list").querySelector(".zone-option.active");
      const zoneId = active?.dataset.zoneId ?? currentZoneId();
      applyZoneSelection(zoneId);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeZonePicker();
      $("zone-picker-button").focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!$("zone-picker").contains(event.target)) closeZonePicker();
  });

  $("btn-undo").addEventListener("click", () => {
    const result = undo(ui.editor, {
      decidedBy: ui.editor.createdBy,
      decidedAt: today(),
    });
    if (!result.ok) showBanner(result.error, "warn");
    invalidateValidation();
    renderAll();
  });

  $("btn-redo").addEventListener("click", () => {
    const result = redo(ui.editor, {
      decidedBy: ui.editor.createdBy,
      decidedAt: today(),
    });
    if (!result.ok) showBanner(result.error, "warn");
    invalidateValidation();
    renderAll();
  });

  $("btn-clear-step").addEventListener("click", () => {
    const step = currentStep();
    if (!step) return;
    const result = clearStep(ui.editor, {
      ringIndex: ui.ringIndex,
      stepId: step.stepId,
      decidedBy: ui.editor.createdBy,
      decidedAt: today(),
    });
    if (!result.ok) showBanner(result.error, "error");
    invalidateValidation();
    renderAll();
  });

  $("btn-clear-ring").addEventListener("click", () => {
    const result = clearRing(ui.editor, {
      ringIndex: ui.ringIndex,
      decidedBy: ui.editor.createdBy,
      decidedAt: today(),
    });
    if (!result.ok) showBanner(result.error, "error");
    invalidateValidation();
    renderAll();
  });

  $("btn-paths").addEventListener("click", () => {
    const start = ui.pathStart ?? currentEndNodeId();
    const target = ui.pathTarget;
    if (!start || !target) {
      showBanner("请先确定路径起点与终点（点击地图节点，Shift+点击设置起点）", "warn");
      return;
    }
    ui.pathResult = findCandidatePaths({
      fromNodeId: start,
      toNodeId: target,
      edges: ui.edges,
      nodes: ui.nodes,
    });
    renderPathPanel();
  });

  $("btn-clear-nodes").addEventListener("click", () => {
    ui.pathStart = null;
    ui.pathTarget = null;
    ui.pathResult = null;
    renderPathPanel();
    renderMapColors();
  });

  $("btn-validate").addEventListener("click", () => {
    const result = runValidation();
    $("export-preview").textContent = result.text;
    $("export-preview").classList.remove("hidden");
  });

  $("btn-export").addEventListener("click", () => {
    const result = runValidation();
    $("export-preview").textContent = result.text;
    $("export-preview").classList.remove("hidden");
    showBanner(
      `草稿已生成：${ui.editor.draftId}（${result.text.length} 字节），请使用「下载 JSON」保存。`,
      "info",
    );
  });

  $("btn-write").addEventListener("click", writeDraft);
  $("btn-download").addEventListener("click", downloadDraft);
  $("btn-copy").addEventListener("click", copyDraft);

  $("import-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importDraft(file);
    event.target.value = "";
  });

  $("status-select").addEventListener("change", () => {
    runValidation();
  });

  $("created-by").addEventListener("change", () => {
    if (ui.editor) ui.editor.createdBy = $("created-by").value.trim() || "用户";
    invalidateValidation();
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) $("btn-redo").click();
      else $("btn-undo").click();
    } else if (event.key.toLowerCase() === "y") {
      event.preventDefault();
      $("btn-redo").click();
    }
  });
};

const boot = async () => {
  bindEvents();
  try {
    await loadDataSource(ui.mode);
    populateZoneSelect();
    drawMap();
    initEditorForZone(currentZoneId());
    showBanner(
      "mock 模式：矩形演示网络。切换「真实 data/」可编辑正式网络（需先运行生成器）。",
      "info",
    );
  } catch (error) {
    showBanner(error.message, "error");
  }
};

boot();
