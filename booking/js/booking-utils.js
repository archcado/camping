/**
 * booking-utils.js
 * 預約系統共用工具函式
 * showToast(message, type) — 取代原生 alert，顯示右上角訊息提示框
 *   type: 'info' | 'warning' | 'error' | 'success'（預設 'info'）
 */
(function () {
  'use strict';

  var ICONS = {
    info:    'bi bi-info-circle-fill',
    warning: 'bi bi-exclamation-triangle-fill',
    error:   'bi bi-x-octagon-fill',
    success: 'bi bi-check-circle-fill'
  };

  function getContainer() {
    var el = document.getElementById('bk-toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bk-toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function dismiss(toast) {
    toast.classList.add('bk-toast--hiding');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  function showToast(message, type) {
    type = (type && ICONS[type]) ? type : 'info';
    var container = getContainer();

    var toast = document.createElement('div');
    toast.className = 'bk-toast bk-toast--' + type;

    var icon = document.createElement('i');
    icon.className = ICONS[type];
    icon.setAttribute('aria-hidden', 'true');

    var text = document.createElement('span');
    text.className = 'bk-toast__text';
    text.textContent = message;

    var closeBtn = document.createElement('button');
    closeBtn.className = 'bk-toast__close';
    closeBtn.setAttribute('aria-label', '關閉');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () { dismiss(toast); });

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    var timer = setTimeout(function () { dismiss(toast); }, 3500);
    toast.addEventListener('mouseenter', function () { clearTimeout(timer); });
    toast.addEventListener('mouseleave', function () {
      timer = setTimeout(function () { dismiss(toast); }, 2000);
    });
  }

  // Install only when the canonical implementation (js/components/toast.js, loaded via
  // layout.js) has not yet been registered. On pages where layout.js loads toast.js
  // dynamically, that later load will override this and become the active implementation.
  if (typeof window.showToast !== 'function') {
    window.showToast = showToast;
  }

}());
