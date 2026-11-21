/**
 * 连接候选审核页
 *
 * 约束：
 * - 只读 reports/network 候选报告与 data/ 几何、学区规格；
 * - 审核结果只能经 /__tools/save-candidate-review 保存到 reports/network/；
 * - 本页不提供任何写入 data/ 的入口；
 * - pending / needsGeometryFix 不产出正式连接语义。
 */
import AppConfig from "../../js/config.js";

const CANDIDATES_URL = "/reports/network/connection-candidates.json";
const REVIEWED_URL = "/reports/network/connection-candidates.reviewed.json";
const FEATURES_URL = "/data/boundary_features.v2.geojson";
const ZONE_SPECS_URL = "/data/zone_specs.v2.json";

const CATEGORY_LABELS = {
  exactSharedVertex: "完全共点",
  segmentCrossing: "线段相交",
  nearMiss: "近邻不共点",
  collinearOverlap: "共线重叠",
};

const STATUS_LABELS = {
  pending: "pending · 暂不处理",
  connected: "acceptedIntersection · 接受边界交点",
  nonConnectingCrossing: "legacy · 非常规状态",
  needsGeometryFix: "needsGeometryFix · 修复边界几何",
};

const STATUS_TYPE = {
  pending: null,
  connected: "connected",
  nonConnectingCrossing: "nonConnectingCrossing",
  needsGeometryFix: null,
};

const STATUS_COLORS = {
  pending: "#64748b",
  connected: "#16a34a",
  nonConnectingCrossing: "#b45309",
  needsGeometryFix: "#b91c1c",
};

const state = {
  report: null,
  reviewed: null,
  features: null,
  zoneSpecs: null,
  featureMap: new Map(),
  zoneStepsByFeature: new Map(),
  reviewById: new Map(),
  selectedId: null,
  dirty: false,
  map: null,
  featureLayer: null,
  highlightLayer: null,
  candidateLayer: null,
  markerById: new Map(),
  filters: {
    categories: new Set(Object.keys(CATEGORY_LABELS)),
    combination: "all",
    status: "all",
    search: "",
  },
};

const $ = (id) => document.getElementById(id);

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const latLng = (coordinate) => [coordinate[1], coordinate[0]];

const showBanner = (message, tone = "info") => {
  const banner = $("banner");
  banner.textContent = message;
  banner.className = `banner ${tone}`;
};

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
  return response.json();
};

const featureParts = (feature) => {
  const geometry = feature?.geometry;
  if (geometry?.type === "LineString") return [geometry.coordinates];
  if (geometry?.type === "MultiLineString") return geometry.coordinates;
  return [];
};

const buildFeatureMap = () => {
  state.featureMap.clear();
  (state.features?.features ?? []).forEach((feature) => {
    const featureId = feature?.properties?.featureId;
    if (featureId) state.featureMap.set(featureId, feature);
  });
};

const coordinateOf = (placement) =>
  featureParts(state.featureMap.get(placement.featureId))[placement.partIndex]?.[
    placement.vertexIndex
  ] ?? null;

const buildZoneStepIndex = () => {
  state.zoneStepsByFeature.clear();
  const zones = state.zoneSpecs?.zones ?? [];
  zones.forEach((zone) => {
    (zone.rings ?? []).forEach((ring) => {
      (ring.steps ?? []).forEach((step) => {
        state.featureMap.forEach((feature, featureId) => {
          const props = feature.properties ?? {};
          const names = [props.canonicalName, ...(props.aliases ?? [])].filter(
            (name) => typeof name === "string" && name.length > 0,
          );
          if (!names.some((name) => step.text?.includes(name))) return;
          if (!state.zoneStepsByFeature.has(featureId)) {
            state.zoneStepsByFeature.set(featureId, []);
          }
          state.zoneStepsByFeature.get(featureId).push({
            zoneId: zone.zoneId,
            zoneName: zone.zoneName,
            ringId: ring.ringId,
            stepId: step.stepId,
            side: step.side,
            text: step.text,
          });
        });
      });
    });
  });
};

const initReviewState = () => {
  state.reviewById.clear();
  const sameSnapshot =
    state.reviewed &&
    state.report &&
    String(state.reviewed.source?.featuresSha256 ?? "").toUpperCase() ===
      String(state.report.source?.featuresSha256 ?? "").toUpperCase();
  const previous = new Map();
  if (sameSnapshot) {
    (state.reviewed.candidates ?? []).forEach((candidate) => {
      previous.set(candidate.candidateId, candidate);
    });
  } else if (state.reviewed) {
    showBanner(
      "已忽略旧审核文件：坐标源指纹与当前候选报告不一致，请重新审核。",
      "warning",
    );
  }

  (state.report?.candidates ?? []).forEach((candidate) => {
    const saved = previous.get(candidate.candidateId);
    state.reviewById.set(candidate.candidateId, {
      reviewStatus: saved?.reviewStatus ?? "pending",
      proposedConnectionType: saved?.proposedConnectionType ?? null,
      rulingIds: saved?.rulingIds ?? [],
      reviewer: saved?.reviewer ?? "",
      reviewNote: saved?.reviewNote ?? "",
    });
  });
};

const featureCombination = (candidate) => {
  const types = new Set(
    [...(candidate.placements ?? []), ...(candidate.segments ?? [])]
      .map((item) => item.featureType)
      .filter((type) => typeof type === "string" && type.length > 0),
  );
  const list = [...types].sort();
  if (list.length === 0) return "unknown";
  if (list.length > 2) return "mixed";
  return list.join("-");
};

const participantNames = (candidate) => {
  const names = new Set(
    [...(candidate.placements ?? []), ...(candidate.segments ?? [])].map(
      (item) => item.featureName || item.featureId,
    ),
  );
  return [...names].join(" × ");
};

const matchesFilters = (candidate) => {
  if (!state.filters.categories.has(candidate.category)) return false;
  if (
    state.filters.combination !== "all" &&
    featureCombination(candidate) !== state.filters.combination
  ) {
    return false;
  }
  const review = state.reviewById.get(candidate.candidateId);
  if (state.filters.status !== "all" && review.reviewStatus !== state.filters.status) {
    return false;
  }
  const search = state.filters.search.trim().toLowerCase();
  if (!search) return true;
  return (
    candidate.candidateId.toLowerCase().includes(search) ||
    participantNames(candidate).toLowerCase().includes(search)
  );
};

const filteredCandidates = () =>
  (state.report?.candidates ?? []).filter((candidate) => matchesFilters(candidate));

const renderSourceInfo = () => {
  $("source-sha").textContent = state.report.source?.featuresSha256
    ? `${state.report.source.featuresSha256.slice(0, 16)}…`
    : "-";
  $("source-commit").textContent = state.report.source?.gitCommit
    ? state.report.source.gitCommit.slice(0, 12)
    : "未记录";
  $("source-sha").title = state.report.source?.featuresSha256 ?? "";
};

const initMap = () => {
  if (state.map) return;
  state.map = L.map("map", { zoomControl: true }).setView(AppConfig.mapCenter, 13);
  const { token, vecUrl, cvaUrl, subdomains, attribution } = AppConfig.tianditu;
  const tileOptions = { subdomains, maxZoom: 18, attribution };
  L.tileLayer(vecUrl.replace("{token}", token), tileOptions).addTo(state.map);
  L.tileLayer(cvaUrl.replace("{token}", token), { ...tileOptions, attribution: "" }).addTo(
    state.map,
  );

  state.featureLayer = L.layerGroup().addTo(state.map);
  state.highlightLayer = L.layerGroup().addTo(state.map);
  state.candidateLayer = L.layerGroup().addTo(state.map);

  const allCoordinates = [];
  state.featureMap.forEach((feature) => {
    featureParts(feature).forEach((part) => {
      part.forEach((coordinate) => allCoordinates.push(latLng(coordinate)));
      L.polyline(part.map(latLng), {
        color: "#94a3b8",
        weight: 1,
        opacity: 0.6,
        interactive: false,
      }).addTo(state.featureLayer);
    });
  });
  if (allCoordinates.length > 0) {
    state.map.fitBounds(L.latLngBounds(allCoordinates), { padding: [24, 24] });
  }
};

const markerStyle = (candidate) => {
  const review = state.reviewById.get(candidate.candidateId);
  const status = review?.reviewStatus ?? "pending";
  const category = candidate.category;
  return {
    radius: category === "nearMiss" ? 5 : 7,
    color: STATUS_COLORS[status],
    weight: state.selectedId === candidate.candidateId ? 3 : 2,
    fillColor: STATUS_COLORS[status],
    fillOpacity: status === "pending" ? 0.35 : 0.65,
    dashArray:
      category === "segmentCrossing"
        ? "2,2"
        : category === "nearMiss"
          ? "4,4"
          : category === "collinearOverlap"
            ? "8,3"
            : null,
  };
};

const markerTooltip = (candidate) =>
  `<strong>${escapeHtml(candidate.candidateId)}</strong> · ${escapeHtml(
    CATEGORY_LABELS[candidate.category] ?? candidate.category,
  )}<br/>${escapeHtml(participantNames(candidate))}<br/>` +
  `<span class="mono">${escapeHtml(candidate.coordinate.join(", "))}</span>`;

const renderMarkers = () => {
  state.candidateLayer.clearLayers();
  state.markerById.clear();
  const candidates = filteredCandidates();
  candidates.forEach((candidate) => {
    const marker = L.circleMarker(latLng(candidate.coordinate), markerStyle(candidate));
    marker.bindTooltip(markerTooltip(candidate), {
      className: "edge-tooltip",
      direction: "top",
    });
    marker.on("click", () => selectCandidate(candidate.candidateId));
    marker.addTo(state.candidateLayer);
    state.markerById.set(candidate.candidateId, marker);
  });
  $("filter-summary").textContent = `共 ${state.report.candidates.length} 项，当前显示 ${candidates.length} 项`;
};

const renderList = () => {
  const list = $("candidate-list");
  const candidates = filteredCandidates();
  const limit = 400;
  list.innerHTML = candidates
    .slice(0, limit)
    .map((candidate) => {
      const review = state.reviewById.get(candidate.candidateId);
      return `<button type="button" class="candidate-item${
        candidate.candidateId === state.selectedId ? " selected" : ""
      }" data-id="${escapeHtml(candidate.candidateId)}">
        <span class="dot ${escapeHtml(review.reviewStatus)}"></span>
        <span class="meta">
          <strong>${escapeHtml(participantNames(candidate))}</strong>
          <span>${escapeHtml(CATEGORY_LABELS[candidate.category] ?? candidate.category)} · ${
            escapeHtml(featureCombination(candidate))
          } · ${escapeHtml(review.reviewStatus)}</span>
        </span>
      </button>`;
    })
    .join("");
  if (candidates.length > limit) {
    list.insertAdjacentHTML(
      "beforeend",
      `<p class="hint">仅渲染前 ${limit} 项，请用筛选缩小范围。</p>`,
    );
  }
  list.querySelectorAll(".candidate-item").forEach((button) => {
    button.addEventListener("click", () => selectCandidate(button.dataset.id));
  });
};

const renderDetail = () => {
  const candidate = state.report.candidates.find(
    (item) => item.candidateId === state.selectedId,
  );
  if (!candidate) {
    $("detail-empty").classList.remove("hidden");
    $("detail-body").classList.add("hidden");
    return;
  }
  const review = state.reviewById.get(candidate.candidateId);
  $("detail-empty").classList.add("hidden");
  $("detail-body").classList.remove("hidden");
  $("detail-id").textContent = candidate.candidateId;
  $("detail-category").textContent =
    CATEGORY_LABELS[candidate.category] ?? candidate.category;
  $("detail-coordinate").textContent = candidate.coordinate.join(", ");
  $("detail-metric").textContent =
    candidate.distanceM != null
      ? `${candidate.distanceM} 米`
      : candidate.overlapLengthM != null
        ? `重叠 ${candidate.overlapLengthM} 米`
        : "-";
  $("detail-status").textContent = STATUS_LABELS[review.reviewStatus];

  $("detail-placements").innerHTML =
    candidate.placements.length === 0
      ? '<p class="hint">没有共同顶点，需要插点才能形成 placement。</p>'
      : candidate.placements
          .map(
            (placement) =>
              `<div class="mini-row"><strong>${escapeHtml(
                placement.featureName || placement.featureId,
              )}</strong> · ${escapeHtml(placement.featureType)}<br/>` +
              `<span class="mono">${escapeHtml(placement.featureId)} · part ${placement.partIndex} · vertex ${placement.vertexIndex} · ${escapeHtml(
                placement.position,
              )}</span></div>`,
          )
          .join("");

  $("detail-segments").innerHTML =
    candidate.segments.length === 0
      ? '<p class="hint">无</p>'
      : candidate.segments
          .map(
            (segment) =>
              `<div class="mini-row"><strong>${escapeHtml(
                segment.featureName || segment.featureId,
              )}</strong> · ${escapeHtml(segment.featureType)}<br/>` +
              `<span class="mono">${escapeHtml(segment.featureId)} · part ${segment.partIndex} · ${segment.fromVertexIndex}→${segment.toVertexIndex}</span></div>`,
          )
          .join("");

  const stepRows = [];
  const placeholders = new Set([
    ...candidate.placements.map((placement) => placement.featureId),
    ...candidate.segments.map((segment) => segment.featureId),
  ]);
  placeholders.forEach((featureId) => {
    (state.zoneStepsByFeature.get(featureId) ?? []).forEach((step) => {
      stepRows.push(
        `<div class="mini-row"><strong>${escapeHtml(step.zoneName)}</strong> · ${escapeHtml(
          step.zoneId,
        )}<br/><span class="mono">${escapeHtml(step.stepId)} · ${escapeHtml(
          step.side,
        )} · ${escapeHtml(step.text)}</span></div>`,
      );
    });
  });
  $("detail-steps").innerHTML =
    stepRows.length === 0
      ? '<p class="hint">没有按名称匹配到学区步骤；名称匹配只是线索，不构成绑定。</p>'
      : stepRows.join("");

  $("review-note").value = review.reviewNote;
  document.querySelectorAll(".action-grid button").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === review.reviewStatus);
  });
};

const drawHighlight = () => {
  state.highlightLayer.clearLayers();
  const candidate = state.report.candidates.find(
    (item) => item.candidateId === state.selectedId,
  );
  if (!candidate) return;

  const bounds = [];
  const featureIds = new Set([
    ...candidate.placements.map((placement) => placement.featureId),
    ...candidate.segments.map((segment) => segment.featureId),
  ]);
  featureIds.forEach((featureId) => {
    featureParts(state.featureMap.get(featureId)).forEach((part) => {
      L.polyline(part.map(latLng), {
        color: "#f97316",
        weight: 4,
        opacity: 0.85,
        interactive: false,
      }).addTo(state.highlightLayer);
      part.forEach((coordinate) => bounds.push(latLng(coordinate)));
    });
  });

  candidate.placements.forEach((placement) => {
    const coordinate = coordinateOf(placement);
    if (!coordinate) return;
    bounds.push(latLng(coordinate));
    L.circleMarker(latLng(coordinate), {
      radius: 6,
      color: "#0f172a",
      weight: 2,
      fillColor: "#f8fafc",
      fillOpacity: 1,
    }).addTo(state.highlightLayer);
  });

  candidate.segments.forEach((segment) => {
    const part = featureParts(state.featureMap.get(segment.featureId))[segment.partIndex];
    if (!part) return;
    const slice = part.slice(segment.fromVertexIndex, segment.toVertexIndex + 1);
    L.polyline(slice.map(latLng), {
      color: "#1d4ed8",
      weight: 6,
      opacity: 0.9,
      interactive: false,
    }).addTo(state.highlightLayer);
    slice.forEach((coordinate) => bounds.push(latLng(coordinate)));
  });

  L.circleMarker(latLng(candidate.coordinate), {
    radius: 10,
    color: "#0f172a",
    weight: 2,
    fillColor: "#f43f5e",
    fillOpacity: 0.8,
  }).addTo(state.highlightLayer);
  bounds.push(latLng(candidate.coordinate));

  if (bounds.length > 0) {
    state.map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 18 });
  }
};

const refreshSelection = () => {
  renderMarkers();
  renderList();
  renderDetail();
  drawHighlight();
};

const selectCandidate = (candidateId) => {
  state.selectedId = candidateId;
  refreshSelection();
};

const placementConnected = (candidate) => {
  if (candidate.placements.length < 2) return false;
  const coordinates = candidate.placements.map(coordinateOf);
  if (coordinates.some((coordinate) => !coordinate)) return false;
  const round = (value) => Math.round(value * 1e7) / 1e7;
  return coordinates.every(
    (coordinate) =>
      round(coordinate[0]) === round(coordinates[0][0]) &&
      round(coordinate[1]) === round(coordinates[0][1]),
  );
};

const applyStatus = (status) => {
  const candidate = state.report.candidates.find(
    (item) => item.candidateId === state.selectedId,
  );
  if (!candidate) return;
  const review = state.reviewById.get(candidate.candidateId);
  const reviewer = $("reviewer").value.trim();

  if (status !== "pending" && !reviewer) {
    showBanner("请先填写审核人。", "warning");
    return;
  }
  if (status === "connected" && !placementConnected(candidate)) {
    showBanner(
      "该候选尚未形成两个共点 placement，请先执行自动插点或修复边界几何。",
      "warning",
    );
    return;
  }
  if (status === "needsGeometryFix" && review.reviewNote.trim() === "") {
    showBanner("退回修几何必须填写审核说明。", "warning");
    return;
  }

  review.reviewStatus = status;
  review.proposedConnectionType = STATUS_TYPE[status];
  review.reviewer = status === "pending" ? "" : reviewer;
  state.dirty = true;
  refreshSelection();
};

const buildReviewDoc = () => ({
  schemaVersion: 1,
  reviewId: `ncr_${String(state.report.source.featuresSha256).slice(0, 8).toLowerCase()}`,
  source: {
    featuresSha256: state.report.source.featuresSha256,
    gitCommit: state.report.source.gitCommit,
    candidatesPath: "reports/network/connection-candidates.json",
  },
  reviewer: $("reviewer").value.trim(),
  reviewedAt: new Date().toISOString(),
  candidates: state.report.candidates.map((candidate) => {
    const review = state.reviewById.get(candidate.candidateId);
    return {
      candidateId: candidate.candidateId,
      category: candidate.category,
      coordinate: candidate.coordinate,
      placements: candidate.placements,
      segments: candidate.segments,
      distanceM: candidate.distanceM,
      overlapLengthM: candidate.overlapLengthM,
      evidence: candidate.evidence,
      reviewStatus: review.reviewStatus,
      proposedConnectionType: review.proposedConnectionType,
      rulingIds: review.rulingIds,
      reviewer: review.reviewer,
      reviewNote: review.reviewNote,
    };
  }),
});

const saveReview = async () => {
  const reviewer = $("reviewer").value.trim();
  if (!reviewer) {
    showBanner("请先填写审核人。", "warning");
    return;
  }
  const doc = buildReviewDoc();
  if (!window.confirm(`确认保存到 reports/network/connection-candidates.reviewed.json？`)) {
    return;
  }

  try {
    const response = await fetch("/__tools/save-candidate-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review: doc, confirm: doc.reviewId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      const detail = (payload.errors ?? [])
        .slice(0, 3)
        .map((item) => item.message)
        .join("；");
      showBanner(`保存失败：${payload.error ?? detail ?? `HTTP ${response.status}`}`, "danger");
      return;
    }
    state.dirty = false;
    showBanner(
      `已保存到 ${payload.path}：connected ${payload.counts.connected}，` +
        `nonConnectingCrossing ${payload.counts.nonConnectingCrossing}，` +
        `pending ${payload.counts.pending}，needsGeometryFix ${payload.counts.needsGeometryFix}。`,
      "success",
    );
  } catch (error) {
    showBanner(`保存失败：${error.message}`, "danger");
  }
};

const downloadReview = () => {
  const doc = buildReviewDoc();
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "connection-candidates.reviewed.json";
  anchor.click();
  URL.revokeObjectURL(url);
};

const buildFilters = () => {
  const container = $("category-filters");
  container.innerHTML = Object.entries(CATEGORY_LABELS)
    .map(
      ([category, label]) =>
        `<label><input type="checkbox" value="${category}" checked />${escapeHtml(label)}</label>`,
    )
    .join("");
  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.filters.categories.add(input.value);
      else state.filters.categories.delete(input.value);
      refreshSelection();
    });
  });
  $("combo-filter").addEventListener("change", (event) => {
    state.filters.combination = event.target.value;
    refreshSelection();
  });
  $("status-filter").addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    refreshSelection();
  });
  let timer = null;
  $("search-input").addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.filters.search = event.target.value;
      refreshSelection();
    }, 150);
  });
};

const main = async () => {
  try {
    state.report = await loadJson(CANDIDATES_URL);
    state.features = await loadJson(FEATURES_URL);
    state.zoneSpecs = await loadJson(ZONE_SPECS_URL, { optional: true });
    state.reviewed = await loadJson(REVIEWED_URL, { optional: true });
  } catch (error) {
    showBanner(
      `${error.message}。请先运行：npm run candidates:network -- --out reports/network/connection-candidates.json`,
      "danger",
    );
    return;
  }

  buildFeatureMap();
  buildZoneStepIndex();
  initReviewState();
  renderSourceInfo();
  initMap();
  buildFilters();

  document.querySelectorAll(".action-grid button").forEach((button) => {
    button.dataset.status = {
      "btn-connected": "connected",
      "btn-pending": "pending",
      "btn-geometry": "needsGeometryFix",
    }[button.id];
    button.addEventListener("click", () => applyStatus(button.dataset.status));
  });

  refreshSelection();

  $("btn-save").addEventListener("click", saveReview);
  $("btn-download").addEventListener("click", downloadReview);
  $("review-note").addEventListener("input", (event) => {
    const review = state.reviewById.get(state.selectedId);
    if (!review) return;
    review.reviewNote = event.target.value;
    state.dirty = true;
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
};

main();
