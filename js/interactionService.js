/* interactionService.js - 政民互动:留言 + 联系卡片 */

window.InteractionService = (function () {

  var STORAGE_KEY = 'sa_messages_v1';
  var _contacts = [];

  function init(data) {
    _contacts = data.contacts || [];
    renderContacts();
    bindMessageForm();
    renderMessages();
  }

  // ===== 联系卡片 =====
  function renderContacts() {
    var el = document.getElementById('contactList');
    if (!el) return;

    if (!_contacts.length) {
      el.innerHTML = '<div class="text-muted small">暂无联系信息</div>';
      return;
    }

    var html = '';
    _contacts.forEach(function (c) {
      html += '<div class="contact-card">';
      html += '<div class="contact-card-header">' +
                '<span class="contact-type-tag">' + c.type + '</span>' +
                '<span class="contact-name">' + c.name + '</span>' +
              '</div>';
      if (c.phone) html += '<div class="contact-row"><i class="bi bi-telephone"></i>' + c.phone + '</div>';
      if (c.email) html += '<div class="contact-row"><i class="bi bi-envelope"></i>' + c.email + '</div>';
      if (c.address) html += '<div class="contact-row"><i class="bi bi-geo-alt"></i>' + c.address + '</div>';
      if (c.hours) html += '<div class="contact-row"><i class="bi bi-clock"></i>' + c.hours + '</div>';
      if (c.note) html += '<div class="contact-note small text-muted">' + c.note + '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  }

  // ===== 留言表单 =====
  function bindMessageForm() {
    var content = document.getElementById('msgContent');
    var counter = document.querySelector('.contact-message-counter');
    var submitBtn = document.getElementById('msgSubmitBtn');

    if (content && counter) {
      content.addEventListener('input', function () {
        counter.textContent = content.value.length + '/200';
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var name = (document.getElementById('msgName').value || '').trim() || '匿名';
        var category = document.getElementById('msgCategory').value;
        var contentText = (document.getElementById('msgContent').value || '').trim();

        if (!contentText) {
          alert('请填写留言内容');
          return;
        }

        var msg = {
          id: Date.now(),
          name: name,
          category: category,
          content: contentText,
          createdAt: new Date().toLocaleString('zh-CN')
        };

        var list = loadMessages();
        list.unshift(msg);
        saveMessages(list);

        // 清空表单
        document.getElementById('msgName').value = '';
        document.getElementById('msgContent').value = '';
        counter.textContent = '0/200';

        renderMessages();

        // 友好提示
        showToast('留言已提交');
      });
    }
  }

  // ===== 留言列表 =====
  function renderMessages() {
    var el = document.getElementById('messageList');
    if (!el) return;

    var list = loadMessages();
    if (!list.length) {
      el.innerHTML = '<div class="contact-message-empty">' +
                       '<i class="bi bi-inbox"></i><div>暂无留言,您可以是第一个留言的人</div>' +
                     '</div>';
      return;
    }

    var html = '';
    list.forEach(function (m) {
      html += '<div class="contact-message-item">' +
                '<div class="contact-message-meta">' +
                  '<span class="contact-message-name">' + m.name + '</span>' +
                  '<span class="contact-message-cat">' + m.category + '</span>' +
                  '<span class="contact-message-time">' + m.createdAt + '</span>' +
                '</div>' +
                '<div class="contact-message-content">' + m.content + '</div>' +
              '</div>';
    });
    el.innerHTML = html;
  }

  // ===== localStorage 工具 =====
  function loadMessages() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveMessages(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('localStorage 保存失败');
    }
  }

  // ===== 简易 Toast =====
  function showToast(msg) {
    var toast = document.createElement('div');
    toast.className = 'sa-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('sa-toast-show'); }, 10);
    setTimeout(function () {
      toast.classList.remove('sa-toast-show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2200);
  }

  return { init: init };
})();