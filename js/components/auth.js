/**
 * 主站與 booking 共用的前端登入狀態模組。
 * 同步 currentUser、yuruiUser、isLoggedIn 與可用時的 AppState。
 */
(function () {
  'use strict';

  var STORAGE_KEYS = {
    isLoggedIn: 'isLoggedIn',
    currentUser: 'currentUser',
    bookingUser: 'yuruiUser'
  };

  var AUTH_LOGOUT_SELECTORS = '[data-action="logout"], #logoutBtn, .logout-btn, .btn-logout, .navbar-logout-btn, #bkLogoutBtnMobile';

  /**
   * 安全讀取 localStorage JSON。
   * @param {string} key - localStorage key。
   * @param {*} fallback - 解析失敗時回傳值。
   * @returns {*} 解析後資料或 fallback。
   */
  function readJsonStorage(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (error) {
      console.warn('Auth storage parse failed:', key, error);
      return fallback;
    }
  }

  /**
   * 將 provider 正規化成畫面顯示用名稱。
   * @param {string} provider - 社群登入來源。
   * @returns {string} Provider 顯示文字。
   */
  function getProviderLabel(provider) {
    var value = String(provider || 'Google').toLowerCase();
    if (value === 'line') return 'LINE';
    if (value === 'facebook') return 'Facebook';
    return 'Google';
  }

  /**
   * 建立測試用社群登入會員資料。
   * @param {string} provider - 社群登入來源。
   * @returns {{id: string, name: string, email: string, avatar: string, provider: string}} Mock user.
   */
  function createMockUser(provider) {
    var label = getProviderLabel(provider);
    var key = label.toLowerCase();
    return {
      id: 'user-001',
      name: label + ' 會員',
      email: 'user@' + key + '.example',
      avatar: label.charAt(0),
      provider: key
    };
  }

  /**
   * 若主站 AppState 存在，同步目前登入狀態。
   * @param {Object|null} user - 目前登入會員或 null。
   */
  function syncAppState(user) {
    if (!window.AppState) return;
    window.AppState.isLoggedIn = Boolean(user);
    window.AppState.currentUser = user || null;
    if (typeof window.saveAppState === 'function') window.saveAppState();
  }

  /**
   * 將登入狀態寫入主站與 booking 共用 key。
   * @param {Object|null} user - 目前登入會員或 null。
   */
  function persistUser(user) {
    localStorage.setItem(STORAGE_KEYS.isLoggedIn, JSON.stringify(Boolean(user)));
    if (user) {
      localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(user));
      localStorage.setItem(STORAGE_KEYS.bookingUser, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEYS.currentUser);
      localStorage.removeItem(STORAGE_KEYS.bookingUser);
    }
    syncAppState(user);
  }

  /**
   * Close all auth-related UI surfaces without touching carts or preferences.
   * @param {Function=} closeCallback - Optional UI close callback.
   */
  function closeAuthUi(closeCallback) {
    if (typeof closeCallback === 'function') {
      closeCallback();
    }

    if (typeof window.closeMainHeaderDialogs === 'function') {
      window.closeMainHeaderDialogs();
    }

    if (typeof window.updateNavbarLoginState === 'function') {
      window.updateNavbarLoginState();
    }

    if (typeof window.updateBookingHeaderLoginState === 'function') {
      window.updateBookingHeaderLoginState();
    }
  }

  /**
   * Clears only authentication state keys that are used by the site.
   */
  function clearAuthStorage() {
    localStorage.removeItem(STORAGE_KEYS.isLoggedIn);
    localStorage.removeItem(STORAGE_KEYS.currentUser);
    localStorage.removeItem(STORAGE_KEYS.bookingUser);
  }

  /**
   * Shared sign-out implementation used by main and booking headers.
   * @param {{ close?: Function, showToast?: boolean }=} options - UI callback options.
   */
  function performLogout(options) {
    options = options || {};

    syncAppState(null);
    clearAuthStorage();
    emitAuthChanged('logout', null);
    closeAuthUi(options.close);

    if (options.showToast !== false && typeof window.showToast === 'function') {
      window.showToast('已成功登出', 'success');
    }
  }

  /**
   * 發送登入狀態變更事件，讓兩邊 header 即時重繪。
   * @param {'login'|'logout'|'sync'} type - 事件類型。
   * @param {Object|null} user - 目前登入會員或 null。
   */
  function emitAuthChanged(type, user) {
    window.dispatchEvent(new CustomEvent('yurui:auth-changed', {
      detail: { type: type, user: user || null }
    }));
  }

  /**
   * 從任一相容 key 讀取已登入會員。
   * @returns {Object|null} 目前登入會員或 null。
   */
  function readStoredUser() {
    return readJsonStorage(STORAGE_KEYS.currentUser, null)
      || readJsonStorage(STORAGE_KEYS.bookingUser, null);
  }

  /**
   * 取得目前登入會員，並修復缺漏的相容 key。
   * @returns {Object|null} 目前登入會員或 null。
   */
  function getUser() {
    if (window.AppState && window.AppState.isLoggedIn && window.AppState.currentUser) {
      return window.AppState.currentUser;
    }

    var user = readStoredUser();
    if (user && user.name) persistUser(user);
    return user && user.name ? user : null;
  }

  /**
   * 判斷目前是否登入。
   * @returns {boolean} 是否已登入。
   */
  function isLoggedIn() {
    return Boolean(getUser());
  }

  /**
   * 執行共用社群登入流程。
   * @param {string} provider - 社群登入來源。
   * @param {{close?: Function, showToast?: boolean, openSurvey?: boolean}=} options - UI callback 選項。
   * @returns {Object} 登入後會員。
   */
  function loginWithProvider(provider, options) {
    options = options || {};
    var label = getProviderLabel(provider);
    var user = createMockUser(label);

    persistUser(user);
    emitAuthChanged('login', user);

    if (typeof options.close === 'function') options.close();
    if (options.showToast !== false && typeof window.showToast === 'function') {
      window.showToast('已使用 ' + label + ' 登入', 'success');
    }
    if (options.openSurvey !== false && typeof window.openPersonalizationModal === 'function') {
      setTimeout(window.openPersonalizationModal, 300);
    }

    return user;
  }

  /**
   * 執行共用登出流程，保留 cart 與 bookingCart。
   * @param {{close?: Function, showToast?: boolean}=} options - UI callback 選項。
   */
  function logout(options) {
    performLogout(options);
  }

  window.YuruiAuth = {
    getProviderLabel: getProviderLabel,
    createMockUser: createMockUser,
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    loginWithProvider: loginWithProvider,
    logout: logout,
    /**
     * 重新發送目前登入狀態，供較晚載入的 UI 同步。
     */
    sync: function () {
      emitAuthChanged('sync', getUser());
    }
  };

  /**
   * Re-initializes shared auth state after late-inserted header/auth markup.
   * Safe to call multiple times.
   * @returns {Object} Shared auth API.
   */
  window.initAuth = function initAuth() {
    if (window.YuruiAuth && typeof window.YuruiAuth.sync === 'function') {
      window.YuruiAuth.sync();
    }
    bindLogoutHandler();
    return window.YuruiAuth;
  };

  /**
   * Installs a single delegated logout click handler.
   */
  function bindLogoutHandler() {
    if (document.documentElement.dataset.logoutBound === 'true') return;
    document.documentElement.dataset.logoutBound = 'true';

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest(AUTH_LOGOUT_SELECTORS);
      if (!trigger || event.defaultPrevented) return;

      event.preventDefault();
      if (typeof window.handleLogout === 'function') {
        window.handleLogout();
        return;
      }

      performLogout();
    });
  }

  bindLogoutHandler();
}());
