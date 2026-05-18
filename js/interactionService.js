/**
 * interactionService.js - 政民互动服务
 *
 * 功能: 渲染联系信息卡片,提供在线留言表单(含字数统计和分类选择),
 *       留言数据持久化到 localStorage,支持 Toast 提示。
 *
 * 关键接口:
 *   init(data) - 初始化,接收完整数据对象(使用 data.contacts)
 *
 * 数据格式:
 *   contact = { type, name, phone, email, address, hours, note }
 *   message = { id, name, category, content, createdAt }
 */
window.InteractionService = (() => {
  const STORAGE_KEY = "sa_messages_v1";
  let _contacts = [];

  /** 初始化:渲染联系卡片、绑定留言表单、渲染留言列表 */
  const init = (data) => {
    _contacts = data.contacts || [];
    renderContacts();
    bindMessageForm();
    renderMessages();
  };

  /** 渲染联系信息卡片列表 */
  const renderContacts = () => {
    const el = document.getElementById("contactList");
    if (!el) return;

    if (!_contacts.length) {
      el.innerHTML = `<div class="text-muted small">暂无联系信息</div>`;
      return;
    }

    let html = "";
    _contacts.forEach((c) => {
      html += `<div class="contact-card">`;
      html +=
        `<div class="contact-card-header">` +
        `<span class="contact-type-tag">${c.type}</span>` +
        `<span class="contact-name">${c.name}</span>` +
        `</div>`;
      if (c.phone)
        html += `<div class="contact-row"><i class="bi bi-telephone"></i>${c.phone}</div>`;
      if (c.email)
        html += `<div class="contact-row"><i class="bi bi-envelope"></i>${c.email}</div>`;
      if (c.address)
        html += `<div class="contact-row"><i class="bi bi-geo-alt"></i>${c.address}</div>`;
      if (c.hours)
        html += `<div class="contact-row"><i class="bi bi-clock"></i>${c.hours}</div>`;
      if (c.note)
        html += `<div class="contact-note small text-muted">${c.note}</div>`;
      html += `</div>`;
    });
    el.innerHTML = html;
  };

  /** 绑定留言表单:字数统计、提交按钮、保存到 localStorage */
  const bindMessageForm = () => {
    const content = document.getElementById("msgContent");
    const counter = document.querySelector(".contact-message-counter");
    const submitBtn = document.getElementById("msgSubmitBtn");

    if (content && counter) {
      content.addEventListener("input", () => {
        counter.textContent = `${content.value.length}/200`;
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        const name =
          (document.getElementById("msgName").value || "").trim() || "匿名";
        const category = document.getElementById("msgCategory").value;
        const contentText = (
          document.getElementById("msgContent").value || ""
        ).trim();

        if (!contentText) {
          alert("请填写留言内容");
          return;
        }

        const msg = {
          id: Date.now(),
          name,
          category,
          content: contentText,
          createdAt: new Date().toLocaleString("zh-CN"),
        };

        const list = loadMessages();
        list.unshift(msg);
        saveMessages(list);

        document.getElementById("msgName").value = "";
        document.getElementById("msgContent").value = "";
        counter.textContent = "0/200";

        renderMessages();

        showToast("留言已提交");
      });
    }
  };

  /** 渲染留言列表,从 localStorage 读取 */
  const renderMessages = () => {
    const el = document.getElementById("messageList");
    if (!el) return;

    const list = loadMessages();
    if (!list.length) {
      el.innerHTML =
        `<div class="contact-message-empty">` +
        `<i class="bi bi-inbox"></i><div>暂无留言,您可以是第一个留言的人</div>` +
        `</div>`;
      return;
    }

    let html = "";
    list.forEach((m) => {
      html +=
        `<div class="contact-message-item">` +
        `<div class="contact-message-meta">` +
        `<span class="contact-message-name">${m.name}</span>` +
        `<span class="contact-message-cat">${m.category}</span>` +
        `<span class="contact-message-time">${m.createdAt}</span>` +
        `</div>` +
        `<div class="contact-message-content">${m.content}</div>` +
        `</div>`;
    });
    el.innerHTML = html;
  };

  /** 从 localStorage 加载留言列表,解析失败返回空数组 */
  const loadMessages = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  };

  /** 将留言列表保存到 localStorage */
  const saveMessages = (list) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("localStorage 保存失败");
    }
  };

  /** 显示 Toast 提示,2.2秒后自动消失 */
  const showToast = (msg) => {
    const toast = document.createElement("div");
    toast.className = "sa-toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("sa-toast-show");
    }, 10);
    setTimeout(() => {
      toast.classList.remove("sa-toast-show");
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 2200);
  };

  /** 公共接口 */
  return { init };
})();
