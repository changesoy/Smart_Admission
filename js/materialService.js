const MaterialService = (function() {
  let materialsData = [];
  let currentGroupIndex = 0;
  let selectedMaterials = {};

  function init(data) {
    materialsData = data || [];
    renderMaterialTabs();
    renderCurrentGroup();
    updateProgress();
  }

  function renderMaterialTabs() {
    const tabsContainer = document.getElementById('material-tabs');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = materialsData.map((group, index) => `
      <button 
        class="material-tab ${index === currentGroupIndex ? 'active' : ''}"
        onclick="window.MaterialService.switchGroup(${index})"
      >
        ${group.group}
      </button>
    `).join('');
  }

  function switchGroup(index) {
    if (index >= 0 && index < materialsData.length) {
      currentGroupIndex = index;
      renderMaterialTabs();
      renderCurrentGroup();
      updateProgress();
    }
  }

  function renderCurrentGroup() {
    const container = document.getElementById('material-list');
    if (!container || !materialsData[currentGroupIndex]) return;

    const group = materialsData[currentGroupIndex];
    document.getElementById('material-group-title').textContent = group.group;
    document.getElementById('material-group-desc').textContent = group.description;
    document.getElementById('material-stage').textContent = `适用学段：${group.applicableStage?.join('、') || '小学、初中'}`;

    container.innerHTML = `
      <div class="material-grid">
        ${group.items.map(item => {
          const isSelected = selectedMaterials[item.materialId] || false;
          return `
            <div class="material-item ${isSelected ? 'selected' : ''}" data-material-id="${item.materialId}">
              <div class="material-checkbox" onclick="window.MaterialService.toggleMaterial('${item.materialId}')">
                <span class="check-icon">${isSelected ? '✓' : ''}</span>
              </div>
              <div class="material-content">
                <div class="material-header">
                  <span class="material-name">${item.name}</span>
                  ${item.required ? '<span class="material-required">必需</span>' : '<span class="material-optional">可选</span>'}
                </div>
                ${item.note ? `<p class="material-note">${item.note}</p>` : ''}
                <div class="material-meta">
                  ${item.validity ? `<span class="material-validity">有效期：${item.validity}</span>` : ''}
                  ${item.templateUrl ? `<a href="${item.templateUrl}" class="material-download" target="_blank">下载模板</a>` : ''}
                </div>
                ${item.rejectReasons && item.rejectReasons.length > 0 ? `
                  <div class="material-reject">
                    <span class="reject-title">常见被拒原因：</span>
                    <ul class="reject-list">
                      ${item.rejectReasons.map(reason => `<li>${reason}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function toggleMaterial(materialId) {
    selectedMaterials[materialId] = !selectedMaterials[materialId];
    const item = document.querySelector(`[data-material-id="${materialId}"]`);
    if (item) {
      item.classList.toggle('selected');
    }
    updateProgress();
  }

  function updateProgress() {
    const progressContainer = document.getElementById('material-progress');
    if (!progressContainer || !materialsData[currentGroupIndex]) return;

    const group = materialsData[currentGroupIndex];
    const total = group.items.length;
    const selected = group.items.filter(item => selectedMaterials[item.materialId]).length;
    
    progressContainer.innerHTML = `
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${total > 0 ? (selected / total) * 100 : 0}%"></div>
      </div>
      <span class="progress-text">已完成 ${selected}/${total} 项</span>
    `;

    // 检查是否全部完成
    checkCompletion(selected === total);
  }

  function checkCompletion(isComplete) {
    let completionAlert = document.getElementById('material-completion-alert');
    const section = document.querySelector('.material-section');
    
    if (!section) return;
    
    if (!completionAlert) {
      completionAlert = document.createElement('div');
      completionAlert.id = 'material-completion-alert';
      completionAlert.className = 'completion-alert';
      completionAlert.innerHTML = `
        <div class="completion-icon">✓</div>
        <div class="completion-text">材料已齐全</div>
      `;
      section.appendChild(completionAlert);
    }

    if (isComplete) {
      completionAlert.classList.add('show');
    } else {
      completionAlert.classList.remove('show');
    }
  }

  return {
    init,
    switchGroup,
    toggleMaterial
  };
})();

window.MaterialService = MaterialService;