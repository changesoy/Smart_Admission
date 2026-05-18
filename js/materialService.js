/* materialService.js - 入学材料清单服务 */

window.MaterialService = (function () {
  var _materialsData = [];
  var _currentGroupIndex = 0;
  var _selectedMaterials = {};

  function init(data) {
    _materialsData = data || [];
    renderMaterialTabs();
    renderCurrentGroup();
    updateProgress();
  }

  function renderMaterialTabs() {
    var tabsContainer = document.getElementById("material-tabs");
    if (!tabsContainer) return;

    var html = "";
    _materialsData.forEach(function (group, index) {
      var activeClass = index === _currentGroupIndex ? " active" : "";
      html += '<button class="material-tab' + activeClass + '"';
      html += ' onclick="window.MaterialService.switchGroup(' + index + ')">';
      html += group.group;
      html += "</button>";
    });
    tabsContainer.innerHTML = html;
  }

  function switchGroup(index) {
    if (index >= 0 && index < _materialsData.length) {
      _currentGroupIndex = index;
      renderMaterialTabs();
      renderCurrentGroup();
      updateProgress();
    }
  }

  function renderCurrentGroup() {
    var container = document.getElementById("material-list");
    if (!container || !_materialsData[_currentGroupIndex]) return;

    var group = _materialsData[_currentGroupIndex];
    document.getElementById("material-group-title").textContent = group.group;
    document.getElementById("material-group-desc").textContent = group.description;

    var stageText = "适用学段：";
    if (group.applicableStage && group.applicableStage.length > 0) {
      stageText += group.applicableStage.join("、");
    } else {
      stageText += "小学、初中";
    }
    document.getElementById("material-stage").textContent = stageText;

    var html = '<div class="material-grid">';
    group.items.forEach(function (item) {
      var isSelected = _selectedMaterials[item.materialId] || false;
      var selectedClass = isSelected ? " selected" : "";

      html += '<div class="material-item' + selectedClass + '" data-material-id="' + item.materialId + '">';
      html += '<div class="material-checkbox" onclick="window.MaterialService.toggleMaterial(\'' + item.materialId + '\')">';
      html += '<span class="check-icon">' + (isSelected ? "\u2713" : "") + "</span>";
      html += "</div>";
      html += '<div class="material-content">';
      html += '<div class="material-header">';
      html += '<span class="material-name">' + item.name + "</span>";
      if (item.required) {
        html += '<span class="material-required">必需</span>';
      } else {
        html += '<span class="material-optional">可选</span>';
      }
      html += "</div>";
      if (item.note) {
        html += '<p class="material-note">' + item.note + "</p>";
      }
      html += '<div class="material-meta">';
      if (item.validity) {
        html += '<span class="material-validity">有效期：' + item.validity + "</span>";
      }
      if (item.templateUrl) {
        html += '<a href="' + item.templateUrl + '" class="material-download" target="_blank">下载模板</a>';
      }
      html += "</div>";
      if (item.rejectReasons && item.rejectReasons.length > 0) {
        html += '<div class="material-reject">';
        html += '<span class="reject-title">常见被拒原因：</span>';
        html += '<ul class="reject-list">';
        item.rejectReasons.forEach(function (reason) {
          html += "<li>" + reason + "</li>";
        });
        html += "</ul>";
        html += "</div>";
      }
      html += "</div>";
      html += "</div>";
    });
    html += "</div>";

    container.innerHTML = html;
  }

  function toggleMaterial(materialId) {
    _selectedMaterials[materialId] = !_selectedMaterials[materialId];
    var item = document.querySelector('[data-material-id="' + materialId + '"]');
    if (item) {
      item.classList.toggle("selected");
    }
    updateProgress();
  }

  function updateProgress() {
    var progressContainer = document.getElementById("material-progress");
    if (!progressContainer || !_materialsData[_currentGroupIndex]) return;

    var group = _materialsData[_currentGroupIndex];
    var total = group.items.length;
    var selected = group.items.filter(function (item) {
      return _selectedMaterials[item.materialId];
    }).length;

    var percent = total > 0 ? (selected / total) * 100 : 0;
    var html = '<div class="progress-bar">';
    html += '<div class="progress-fill" style="width: ' + percent + '%"></div>';
    html += "</div>";
    html += '<span class="progress-text">已完成 ' + selected + "/" + total + " 项</span>";
    progressContainer.innerHTML = html;

    checkCompletion(selected === total);
  }

  function checkCompletion(isComplete) {
    var completionAlert = document.getElementById("material-completion-alert");
    var section = document.querySelector(".material-section");

    if (!section) return;

    if (!completionAlert) {
      completionAlert = document.createElement("div");
      completionAlert.id = "material-completion-alert";
      completionAlert.className = "completion-alert";
      completionAlert.innerHTML =
        '<div class="completion-icon">\u2713</div>' +
        '<div class="completion-text">材料已齐全</div>';
      section.appendChild(completionAlert);
    }

    if (isComplete) {
      completionAlert.classList.add("show");
    } else {
      completionAlert.classList.remove("show");
    }
  }

  return {
    init: init,
    switchGroup: switchGroup,
    toggleMaterial: toggleMaterial
  };
})();
