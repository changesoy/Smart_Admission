/**
 * materialService.js - 入学材料清单服务
 *
 * 功能: 渲染入学材料分组标签页和材料项列表,支持勾选进度追踪和完成提示。
 *
 * 关键接口:
 *   init(data)                    - 初始化,接收材料分组数组
 *   switchGroup(index)            - 切换到指定分组标签页
 *   toggleMaterial(materialId)    - 勾选/取消勾选材料项
 *
 * 数据格式:
 *   group = { group, description, applicableStage[], items: [{ materialId, name, required, note, validity, templateUrl, rejectReasons[] }] }
 */
window.MaterialService = (() => {
  let _materialsData = [];
  let _currentGroupIndex = 0;
  let _selectedMaterials = {};

  /** 初始化:存储数据,渲染标签页、材料列表和进度条 */
  const init = (data) => {
    _materialsData = data || [];
    renderMaterialTabs();
    renderCurrentGroup();
    updateProgress();
  };

  /** 渲染材料分组标签按钮 */
  const renderMaterialTabs = () => {
    const tabsContainer = document.getElementById("material-tabs");
    if (!tabsContainer) return;

    let html = "";
    _materialsData.forEach((group, index) => {
      const activeClass = index === _currentGroupIndex ? " active" : "";
      html += `<button class="material-tab${activeClass}"`;
      html += ` onclick="window.MaterialService.switchGroup(${index})">`;
      html += group.group;
      html += `</button>`;
    });
    tabsContainer.innerHTML = html;
  };

  /** 切换到指定分组索引,重新渲染标签页、列表和进度 */
  const switchGroup = (index) => {
    if (index >= 0 && index < _materialsData.length) {
      _currentGroupIndex = index;
      renderMaterialTabs();
      renderCurrentGroup();
      updateProgress();
    }
  };

  /** 渲染当前分组的材料项列表,含勾选状态、必填标签和被拒原因 */
  const renderCurrentGroup = () => {
    const container = document.getElementById("material-list");
    if (!container || !_materialsData[_currentGroupIndex]) return;

    const group = _materialsData[_currentGroupIndex];
    document.getElementById("material-group-title").textContent = group.group;
    document.getElementById("material-group-desc").textContent =
      group.description;

    let stageText = "适用学段：";
    if (group.applicableStage && group.applicableStage.length > 0) {
      stageText += group.applicableStage.join("、");
    } else {
      stageText += "小学、初中";
    }
    document.getElementById("material-stage").textContent = stageText;

    let html = `<div class="material-grid">`;
    group.items.forEach((item) => {
      const isSelected = _selectedMaterials[item.materialId] || false;
      const selectedClass = isSelected ? " selected" : "";

      html += `<div class="material-item${selectedClass}" data-material-id="${item.materialId}">`;
      html += `<div class="material-checkbox" onclick="window.MaterialService.toggleMaterial('${item.materialId}')">`;
      html += `<span class="check-icon">${isSelected ? "\u2713" : ""}</span>`;
      html += `</div>`;
      html += `<div class="material-content">`;
      html += `<div class="material-header">`;
      html += `<span class="material-name">${item.name}</span>`;
      if (item.required) {
        html += `<span class="material-required">必需</span>`;
      } else {
        html += `<span class="material-optional">可选</span>`;
      }
      html += `</div>`;
      if (item.note) {
        html += `<p class="material-note">${item.note}</p>`;
      }
      html += `<div class="material-meta">`;
      if (item.validity) {
        html += `<span class="material-validity">有效期：${item.validity}</span>`;
      }
      if (item.templateUrl) {
        html += `<a href="${item.templateUrl}" class="material-download" target="_blank">下载模板</a>`;
      }
      html += `</div>`;
      if (item.rejectReasons && item.rejectReasons.length > 0) {
        html += `<div class="material-reject">`;
        html += `<span class="reject-title">常见被拒原因：</span>`;
        html += `<ul class="reject-list">`;
        item.rejectReasons.forEach((reason) => {
          html += `<li>${reason}</li>`;
        });
        html += `</ul>`;
        html += `</div>`;
      }
      html += `</div>`;
      html += `</div>`;
    });
    html += `</div>`;

    container.innerHTML = html;
  };

  /** 切换材料项的勾选状态,更新进度 */
  const toggleMaterial = (materialId) => {
    _selectedMaterials[materialId] = !_selectedMaterials[materialId];
    const item = document.querySelector(`[data-material-id="${materialId}"]`);
    if (item) {
      item.classList.toggle("selected");
    }
    updateProgress();
  };

  /** 更新进度条和完成计数,全部勾选时触发完成提示 */
  const updateProgress = () => {
    const progressContainer = document.getElementById("material-progress");
    if (!progressContainer || !_materialsData[_currentGroupIndex]) return;

    const group = _materialsData[_currentGroupIndex];
    const total = group.items.length;
    const selected = group.items.filter(
      (item) => _selectedMaterials[item.materialId],
    ).length;

    const percent = total > 0 ? (selected / total) * 100 : 0;
    let html = `<div class="progress-bar">`;
    html += `<div class="progress-fill" style="width: ${percent}%"></div>`;
    html += `</div>`;
    html += `<span class="progress-text">已完成 ${selected}/${total} 项</span>`;
    progressContainer.innerHTML = html;

    checkCompletion(selected === total);
  };

  /** 控制"材料已齐全"完成提示的显示/隐藏 */
  const checkCompletion = (isComplete) => {
    let completionAlert = document.getElementById("material-completion-alert");
    const section = document.querySelector(".material-section");

    if (!section) return;

    if (!completionAlert) {
      completionAlert = document.createElement("div");
      completionAlert.id = "material-completion-alert";
      completionAlert.className = "completion-alert";
      completionAlert.innerHTML =
        `<div class="completion-icon">\u2713</div>` +
        `<div class="completion-text">材料已齐全</div>`;
      section.appendChild(completionAlert);
    }

    if (isComplete) {
      completionAlert.classList.add("show");
    } else {
      completionAlert.classList.remove("show");
    }
  };

  /** 公共接口 */
  return {
    init,
    switchGroup,
    toggleMaterial,
  };
})();
