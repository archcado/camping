// ============================================================
// toast.js — 全站共用 Toast 通知元件
//
// API: window.showToast(message, type, duration)
//   message  {string}  顯示訊息
//   type     {string}  'success' | 'error' | 'warning' | 'info'（預設 'info'）
//   duration {number}  顯示毫秒（預設 3500）
//
// CSS: css/theme/theme-toast.css
// ============================================================

(function () {
  'use strict';

  var ICONS = {
    success: 'bi bi-check-circle-fill',
    error:   'bi bi-x-circle-fill',
    warning: 'bi bi-exclamation-triangle-fill',
    info:    'bi bi-info-circle-fill',
  };

  /**
   * 取得或建立 Toast 容器（每頁只建立一次）。
   * @returns {HTMLElement}
   */
  function getContainer() {
    var el = document.getElementById('yr-toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yr-toast-container';
      el.className = 'yr-toast-container';
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-label', '通知訊息');
      document.body.appendChild(el);
    }
    return el;
  }

  /**
   * 執行退場動畫後移除 Toast。
   * @param {HTMLElement} toast
   */
  function dismiss(toast) {
    if (toast.dataset.dismissed === 'true') return;
    toast.dataset.dismissed = 'true';
    toast.classList.add('is-hiding');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 280);
  }

  /**
   * 顯示 Toast 提示。
   * @param {string} message - 提示文字
   * @param {string} [type='info'] - 類型：success / error / warning / info
   * @param {number} [duration=3500] - 顯示毫秒
   */
  window.showToast = function showToast(message, type, duration) {
    type = (type && ICONS[type]) ? type : 'info';
    duration = typeof duration === 'number' ? duration : 3500;

    var container = getContainer();

    var toast = document.createElement('div');
    toast.className = 'yr-toast yr-toast--' + type;
    toast.setAttribute('role', 'status');

    var icon = document.createElement('i');
    icon.className = ICONS[type] + ' yr-toast__icon';
    icon.setAttribute('aria-hidden', 'true');

    var msg = document.createElement('span');
    msg.className = 'yr-toast__message';
    msg.textContent = message;

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'yr-toast__close';
    closeBtn.setAttribute('aria-label', '關閉通知');
    closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    closeBtn.addEventListener('click', function () { dismiss(toast); });

    toast.appendChild(icon);
    toast.appendChild(msg);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    var timer = setTimeout(function () { dismiss(toast); }, duration);

    toast.addEventListener('mouseenter', function () { clearTimeout(timer); });
    toast.addEventListener('mouseleave', function () {
      timer = setTimeout(function () { dismiss(toast); }, Math.min(duration, 2000));
    });
  };

  console.log('✓ Toast 元件已初始化');
}());
