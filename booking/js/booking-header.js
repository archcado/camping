/**
 * booking-header.js
 * Controls the Booking header shell while sharing auth state with the main site.
 */
(function () {
  'use strict';

  var campPreferenceCompletedInSession = false;
  var CAMP_PREFERENCE_COMPLETED_KEY = 'campPreferencesCompleted';
  var CAMP_PREFERENCE_ANSWERS_KEY = 'campPreferenceAnswers';

  /**
   * Creates the toast container when booking utility scripts are not loaded yet.
   */
  function getToastContainer() {
    var el = document.getElementById('bk-toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bk-toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  /**
   * Removes a toast with the same exit animation used by booking pages.
   */
  function dismissToast(toast) {
    toast.classList.add('bk-toast--hiding');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  /**
   * Ensures window.showToast exists as a last-resort fallback.
   * js/components/toast.js (loaded by layout.js) provides the canonical implementation
   * and will already be defined before this runs in the normal loading chain.
   */
  function ensureToastFallback() {
    if (typeof window.showToast === 'function') return;

    // Minimal fallback: log to console so messages are not silently lost.
    window.showToast = function fallbackToast(message, type) {
      console.warn('[Toast fallback] ' + (type || 'info') + ': ' + message);
    };
  }

  /**
   * Reads JSON from localStorage and returns a fallback when parsing fails.
   */
  function readJsonStorage(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  /**
   * Counts the total selected booking and rental items stored in the cart.
   */
  function getBookingCartTotal(cart) {
    var zoneCount = (cart.selected_zones || []).reduce(function (sum, zone) {
      return sum + (zone.quantity || 0);
    }, 0);
    var rentalCount = (cart.selected_rentals || []).reduce(function (sum, rental) {
      return sum + (rental.quantity || 0);
    }, 0);
    return zoneCount + rentalCount;
  }

  /**
   * Updates desktop and mobile booking-cart badges from localStorage.bookingCart.
   */
  function updateBookingBadge() {
    var badge = document.getElementById('bookingBadge');
    var badgeMobile = document.getElementById('bookingBadgeMobile');
    var cart = readJsonStorage('bookingCart', null);
    var total = cart ? getBookingCartTotal(cart) : 0;
    var displayText = total > 9 ? '9+' : String(total);

    [badge, badgeMobile].forEach(function (el) {
      if (!el) return;
      el.textContent = displayText;
      el.hidden = total <= 0;
    });
  }

  /**
   * Gets the current shared auth user from YuruiAuth or legacy storage.
   */
  function getCurrentUser() {
    if (window.YuruiAuth && typeof window.YuruiAuth.getUser === 'function') {
      return window.YuruiAuth.getUser();
    }
    if (localStorage.getItem('isLoggedIn') !== 'true') return null;
    return readJsonStorage('currentUser', null) || readJsonStorage('yuruiUser', null);
  }

  /**
   * Hides the shared user dropdown in the booking header.
   */
  function closeUserDropdown() {
    var dropdown = document.querySelector('.booking-header .navbar-user-dropdown');
    if (dropdown) dropdown.hidden = true;
  }

  /**
   * Logs the user out through the shared auth service and refreshes booking UI.
   */
  function logout() {
    if (window.YuruiAuth && typeof window.YuruiAuth.logout === 'function') {
      window.YuruiAuth.logout({ close: closeUserDropdown });
      return;
    }

    localStorage.setItem('isLoggedIn', 'false');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('yuruiUser');
    window.dispatchEvent(new CustomEvent('yurui:auth-changed', { detail: { type: 'logout', user: null } }));
    closeUserDropdown();
    checkLoginState();
    window.showToast('已登出', 'success');
  }

  /**
   * Wires the shared user dropdown and logout button for the booking header.
   */
  function initUserDropdown() {
    var userMenu = document.querySelector('.booking-header .navbar-user-menu');
    var userInfo = userMenu ? userMenu.querySelector('.user-info') : null;
    var dropdown = userMenu ? userMenu.querySelector('.navbar-user-dropdown') : null;
    var logoutBtn = userMenu ? userMenu.querySelector('[data-action="logout"], .navbar-logout-btn') : null;

    if (!userMenu || !userInfo || !dropdown) return;
    if (userMenu.dataset.dropdownBound === 'true') return;
    userMenu.dataset.dropdownBound = 'true';

    userInfo.addEventListener('click', function (event) {
      event.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
    });

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (event) {
        event.preventDefault();
        logout();
      });
    }
  }

  /**
   * Refreshes login button, user menu, and mobile logout visibility from auth state.
   */
  function checkLoginState() {
    var loginBtn = document.querySelector('.booking-header .navbar-login-btn');
    var userMenu = document.querySelector('.booking-header .navbar-user-menu');
    var logoutItemMobile = document.getElementById('bkOffcanvasLogoutItem');
    var user = getCurrentUser();

    if (!loginBtn || !userMenu) return;

    if (user && user.name) {
      var userName = userMenu.querySelector('.user-name');
      var userAvatar = userMenu.querySelector('.user-avatar');
      loginBtn.hidden = true;
      userMenu.hidden = false;
      if (userName) userName.textContent = user.name;
      if (userAvatar) userAvatar.textContent = (user.avatar || user.name.charAt(0)).toUpperCase();
      if (logoutItemMobile) logoutItemMobile.hidden = false;
      initUserDropdown();
    } else {
      loginBtn.hidden = false;
      userMenu.hidden = true;
      if (logoutItemMobile) logoutItemMobile.hidden = true;
      closeUserDropdown();
    }

    window.updateBookingHeaderLoginState = checkLoginState;
  }

  /**
   * Closes the booking mobile offcanvas from any event handler.
   */
  function closeOffcanvasFromAnywhere() {
    var offcanvas = document.getElementById('bkOffcanvas');
    var backdrop = document.getElementById('bkBackdrop');
    var hamburger = document.getElementById('bkHamburger');
    if (offcanvas) offcanvas.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-visible');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  /**
   * Opens the booking mobile offcanvas and locks page scrolling.
   */
  function openOffcanvas() {
    var offcanvas = document.getElementById('bkOffcanvas');
    var backdrop = document.getElementById('bkBackdrop');
    var hamburger = document.getElementById('bkHamburger');
    if (!offcanvas || !hamburger) return;
    closePanels();
    closeSharedModal('loginModal', { force: true });
    closeSharedModal('campPreferenceModal', { force: true });
    closeSharedModal('campPreferenceCloseConfirmModal', { force: true });
    offcanvas.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-visible');
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Binds the booking hamburger, offcanvas close controls, and mobile cart/logout buttons.
   */
  function initOffcanvas() {
    var hamburger = document.getElementById('bkHamburger');
    var backdrop = document.getElementById('bkBackdrop');
    var closeBtn = document.getElementById('bkOffcanvasClose');
    var cartBtnMobile = document.getElementById('bkCartBtnMobile');
    var logoutBtnMobile = document.getElementById('bkLogoutBtnMobile');

    if (hamburger && hamburger.dataset.offcanvasBound !== 'true') {
      hamburger.dataset.offcanvasBound = 'true';
      hamburger.addEventListener('click', openOffcanvas);
    }
    if (closeBtn && closeBtn.dataset.offcanvasBound !== 'true') {
      closeBtn.dataset.offcanvasBound = 'true';
      closeBtn.addEventListener('click', closeOffcanvasFromAnywhere);
    }
    if (backdrop && backdrop.dataset.offcanvasBound !== 'true') {
      backdrop.dataset.offcanvasBound = 'true';
      backdrop.addEventListener('click', closeOffcanvasFromAnywhere);
    }
    if (cartBtnMobile && cartBtnMobile.dataset.cartBound !== 'true') {
      cartBtnMobile.dataset.cartBound = 'true';
      cartBtnMobile.addEventListener('click', function () {
        closeOffcanvasFromAnywhere();
        renderCartPanel();
        openPanel(document.getElementById('cartPanel'));
      });
    }
    if (logoutBtnMobile && logoutBtnMobile.dataset.logoutBound !== 'true') {
      logoutBtnMobile.dataset.logoutBound = 'true';
      logoutBtnMobile.addEventListener('click', function (event) {
        // Prevent auth.js delegated handler (document-level) from triggering a second logout.
        event.preventDefault();
        event.stopPropagation();
        closeOffcanvasFromAnywhere();
        logout();
      });
    }
  }

  /**
   * Opens a booking slide panel such as the cart panel.
   */
  function openPanel(panelEl) {
    var backdrop = document.getElementById('bkPanelBackdrop');
    if (!panelEl) return;
    panelEl.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-visible');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Closes booking slide panels without touching shared auth modals.
   */
  function closePanels() {
    var cartPanel = document.getElementById('cartPanel');
    var backdrop = document.getElementById('bkPanelBackdrop');
    if (cartPanel) cartPanel.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-visible');
    document.body.style.overflow = '';
  }

  /**
   * Opens a shared modal and marks it active for either main or booking pages.
   */
  function openSharedModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = false;
    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Returns whether the current booking page should auto-show camp preference survey.
   */
  function shouldAutoShowCampPreference() {
    var path = window.location.pathname;
    if (path.indexOf('/booking/pages/booking-checkout') !== -1) return false;
    if (path.indexOf('/booking/pages/booking-cart') !== -1) return false;
    return path.indexOf('/booking/pages/') !== -1;
  }

  /**
   * Reads booking-only camp preference completion state.
   */
  function isCampPreferenceCompleted() {
    return localStorage.getItem(CAMP_PREFERENCE_COMPLETED_KEY) === 'true';
  }

  /**
   * Checks whether there are unsaved in-modal selections.
   */
  function hasCampPreferenceSelections(modal) {
    if (!modal) return false;
    return modal.querySelectorAll('.survey-tag.active').length > 0;
  }

  /**
   * Ask before closing unfinished camp preference setup.
   */
  function requestCampPreferenceClose() {
    var confirmModal = document.getElementById('campPreferenceCloseConfirmModal');
    if (!confirmModal) return false;
    openSharedModal('campPreferenceCloseConfirmModal');
    return true;
  }

  /**
   * Closes a shared modal, optionally bypassing unfinished-camp-preference confirmation.
   */
  function closeSharedModal(modalId, options) {
    var modal = document.getElementById(modalId);
    var shouldConfirm = false;
    if (!modal) return;

    shouldConfirm = modalId === 'campPreferenceModal'
      && !(options && options.force)
      && !campPreferenceCompletedInSession
      && !isCampPreferenceCompleted()
      && hasCampPreferenceSelections(modal);
    if (shouldConfirm && requestCampPreferenceClose()) return;

    modal.classList.remove('active');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    modal.hidden = true;
    document.body.style.overflow = document.querySelector('.modal.active') ? 'hidden' : '';
  }

  /**
   * Derives the shared auth provider name from a clicked login button.
   */
  function getLoginProvider(button) {
    if (button.classList.contains('btn-google-login')) return 'Google';
    if (button.classList.contains('btn-facebook-login')) return 'Facebook';
    if (button.classList.contains('btn-line-login')) return 'LINE';
    return 'Google';
  }

  /**
   * Logs in with the shared auth service and keeps booking camp preference flow isolated.
   */
  function loginWithProvider(provider) {
    if (window.YuruiAuth && typeof window.YuruiAuth.loginWithProvider === 'function') {
      window.YuruiAuth.loginWithProvider(provider, {
        close: function () { closeSharedModal('loginModal', { force: true }); },
        openSurvey: false
      });
      return;
    }

    var user = {
      name: provider + ' 使用者',
      email: 'user@' + provider.toLowerCase() + '.example',
      avatar: provider.charAt(0),
      provider: provider.toLowerCase()
    };
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('yuruiUser', JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('yurui:auth-changed', { detail: { type: 'login', user: user } }));
    closeSharedModal('loginModal', { force: true });
    checkLoginState();
    maybeOpenCampPreferenceModal();
  }

  /**
   * Resets the two-step camp preference survey to its initial state.
   */
  function resetCampPreferenceModal() {
    var modal = document.getElementById('campPreferenceModal');
    if (!modal) return;
    campPreferenceCompletedInSession = false;
    modal.querySelectorAll('.survey-tag.active').forEach(function (tag) {
      tag.classList.remove('active');
    });
    goToSurveyStep(1);
  }

  /**
   * Opens the booking camp preference modal.
   */
  function openCampPreferenceModal() {
    resetCampPreferenceModal();
    closeSharedModal('loginModal', { force: true });
    closeSharedModal('campPreferenceCloseConfirmModal', { force: true });
    openSharedModal('campPreferenceModal');
  }

  /**
   * Opens booking camp preference when user is logged in and booking preference is incomplete.
   */
  function maybeOpenCampPreferenceModal() {
    var user = getCurrentUser();
    if (!user) return;
    if (!shouldAutoShowCampPreference()) return;
    if (isCampPreferenceCompleted()) return;
    var modal = document.getElementById('campPreferenceModal');
    if (modal && modal.classList.contains('active')) return;
    openCampPreferenceModal();
  }

  /**
   * Returns selected survey values grouped by the booking camp-preference step.
   */
  function getSurveySelections() {
    var modal = document.getElementById('campPreferenceModal');
    if (!modal) return { styles: [], environments: [] };
    return {
      styles: Array.from(modal.querySelectorAll('[data-step="1"] .survey-tag.active')).map(function (tag) {
        return tag.dataset.value;
      }),
      environments: Array.from(modal.querySelectorAll('[data-step="2"] .survey-tag.active')).map(function (tag) {
        return tag.dataset.value;
      })
    };
  }

  /**
   * Persists booking camp preference answers and completion state.
   */
  function persistCampPreferenceStorage(preferences) {
    localStorage.setItem(CAMP_PREFERENCE_ANSWERS_KEY, JSON.stringify(preferences));
    localStorage.setItem(CAMP_PREFERENCE_COMPLETED_KEY, 'true');
    window.dispatchEvent(new CustomEvent('yurui:camp-preferences-updated', { detail: preferences }));
  }

  /**
   * Validates that a survey step has enough selected tags.
   */
  function validateSurveySelection(count) {
    if (count >= 2) return true;
    window.showToast('請至少選擇 2 個項目', 'warning');
    return false;
  }

  /**
   * Switches the camp preference modal to the requested step.
   */
  function goToSurveyStep(step) {
    var modal = document.getElementById('campPreferenceModal');
    if (!modal) return;
    modal.querySelectorAll('.survey-step').forEach(function (panel) {
      panel.classList.toggle('active', parseInt(panel.dataset.step, 10) === step);
    });
    modal.querySelectorAll('.stepper-dot').forEach(function (dot, index) {
      dot.classList.toggle('active', index + 1 <= step);
    });
    var stepText = modal.querySelector('.stepper-text');
    if (stepText) stepText.textContent = step + ' / 2';
  }

  /**
   * Completes booking camp preference and closes the modal.
   */
  function finishCampPreference() {
    var preferences = getSurveySelections();
    if (!validateSurveySelection(preferences.styles.length)) {
      goToSurveyStep(1);
      return;
    }
    if (!validateSurveySelection(preferences.environments.length)) return;

    persistCampPreferenceStorage(preferences);
    campPreferenceCompletedInSession = true;
    closeSharedModal('campPreferenceModal', { force: true });
    window.showToast('露營偏好設定已儲存', 'success');
  }

  /**
   * Binds shared login and booking camp-preference modal controls.
   */
  function initSharedAuthModals() {
    var loginModal = document.getElementById('loginModal');
    var campPreferenceModal = document.getElementById('campPreferenceModal');
    var campPreferenceCloseConfirmModal = document.getElementById('campPreferenceCloseConfirmModal');
    var loginBtn = document.querySelector('.booking-header .navbar-login-btn');

    window.openModal = openSharedModal;
    window.closeModal = closeSharedModal;
    window.openCampPreferenceModal = openCampPreferenceModal;

    if (loginBtn && loginBtn.dataset.loginBound !== 'true') {
      loginBtn.dataset.loginBound = 'true';
      loginBtn.addEventListener('click', function (event) {
        event.preventDefault();
        openSharedModal('loginModal');
      });
    }

    if (loginModal && loginModal.dataset.sharedBound !== 'true') {
      loginModal.dataset.sharedBound = 'true';
      loginModal.querySelectorAll('.btn-google-login, .btn-facebook-login, .btn-line-login').forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.preventDefault();
          loginWithProvider(getLoginProvider(button));
        });
      });
    }

    if (campPreferenceModal && campPreferenceModal.dataset.sharedBound !== 'true') {
      campPreferenceModal.dataset.sharedBound = 'true';
      campPreferenceModal.addEventListener('click', function (event) {
        if (event.target.classList.contains('survey-tag')) {
          event.target.classList.toggle('active');
          return;
        }
        if (event.target.id === 'campSurveyNextBtn') {
          var preferences = getSurveySelections();
          if (validateSurveySelection(preferences.styles.length)) goToSurveyStep(2);
          return;
        }
        if (event.target.id === 'campSurveyFinishBtn') finishCampPreference();
      });
    }

    if (campPreferenceCloseConfirmModal && campPreferenceCloseConfirmModal.dataset.confirmBound !== 'true') {
      campPreferenceCloseConfirmModal.dataset.confirmBound = 'true';
      campPreferenceCloseConfirmModal
        .querySelector('[data-camp-survey-close-cancel]')
        ?.addEventListener('click', function () {
          closeSharedModal('campPreferenceCloseConfirmModal', { force: true });
        });
      campPreferenceCloseConfirmModal
        .querySelector('[data-camp-survey-close-confirm]')
        ?.addEventListener('click', function () {
          closeSharedModal('campPreferenceCloseConfirmModal', { force: true });
          closeSharedModal('campPreferenceModal', { force: true });
        });
    }

    document.querySelectorAll('#loginModal .modal-close, #campPreferenceModal .modal-close, #campPreferenceCloseConfirmModal .modal-close').forEach(function (button) {
      if (button.dataset.closeBound === 'true') return;
      button.dataset.closeBound = 'true';
      button.addEventListener('click', function () {
        closeSharedModal(button.closest('.modal').id);
      });
    });

    document.querySelectorAll('#loginModal, #campPreferenceModal, #campPreferenceCloseConfirmModal').forEach(function (modal) {
      if (modal.dataset.backdropBound === 'true') return;
      modal.dataset.backdropBound = 'true';
      modal.addEventListener('click', function (event) {
        if (event.target === modal) closeSharedModal(modal.id);
      });
    });

    maybeOpenCampPreferenceModal();
  }

  /**
   * Escapes cart text before rendering it into panel HTML.
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  /**
   * Formats a number as a localized currency fragment.
   */
  function formatMoney(value) {
    return 'NT$' + Number(value || 0).toLocaleString();
  }

  /**
   * Renders one selected cart row for zones or rentals.
   */
  function renderCartRow(label, amount) {
    return '<div class="cart-panel__row"><span>' + escapeHtml(label) + '</span><span>' + formatMoney(amount) + '</span></div>';
  }

  /**
   * Renders the booking cart slide panel from localStorage.bookingCart.
   */
  function renderCartPanel() {
    var body = document.getElementById('cartPanelBody');
    var footer = document.getElementById('cartPanelFooter');
    var cart = readJsonStorage('bookingCart', null);
    var html = '';

    if (!body) return;
    if (!cart) {
      body.innerHTML = [
        '<div class="cart-panel__empty">',
        '  <i class="bi bi-bag-x"></i>',
        '  <p>預約背包目前是空的</p>',
        '  <a href="./camp-search.html" class="btn btn--outline cart-panel__empty-link">前往找營地</a>',
        '</div>'
      ].join('');
      if (footer) footer.hidden = true;
      return;
    }

    var info = cart.booking_info || {};
    var zones = cart.selected_zones || [];
    var rentals = cart.selected_rentals || [];
    var summary = cart.summary || {};

    if (zones.length > 0) {
      html += '<div class="cart-panel__section">';
      html += '<div class="cart-panel__label">營位</div>';
      zones.forEach(function (zone) {
        html += renderCartRow((info.campground_name || '') + ' - ' + (zone.zone_type || '') + ' x' + (zone.quantity || 0), zone.subtotal);
      });
      if (info.check_in) {
        html += '<div class="cart-panel__meta"><i class="bi bi-calendar3"></i> '
          + escapeHtml(info.check_in) + ' 至 ' + escapeHtml(info.check_out || '')
          + '，' + escapeHtml(info.total_days || 0) + ' 晚</div>';
      }
      if (info.guest_count) {
        html += '<div class="cart-panel__meta"><i class="bi bi-people"></i> '
          + escapeHtml(info.guest_count) + ' 人'
          + (info.region ? '&nbsp;&nbsp;<i class="bi bi-geo-alt"></i> ' + escapeHtml(info.region) : '')
          + '</div>';
      }
      html += '</div>';
    }

    if (rentals.length > 0) {
      html += '<div class="cart-panel__section">';
      html += '<div class="cart-panel__label">租借裝備</div>';
      rentals.forEach(function (rental) {
        html += renderCartRow((rental.name || '') + ' x' + (rental.quantity || 0), rental.subtotal);
      });
      html += '</div>';
    }

    if (summary.final_amount !== undefined) {
      html += '<div class="cart-panel__total"><span>總計</span><span>' + formatMoney(summary.final_amount) + '</span></div>';
    }
    html += '<button class="cart-panel__clear" id="cartPanelClear" type="button">清空預約背包</button>';

    body.innerHTML = html;
    if (footer) footer.hidden = false;

    var clearBtn = document.getElementById('cartPanelClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        showConfirmToast('確定要清空預約背包嗎？', function () {
          localStorage.removeItem('bookingCart');
          updateBookingBadge();
          renderCartPanel();
        });
      });
    }
  }

  /**
   * Binds the desktop cart button and panel close controls.
   */
  function initCartPanel() {
    var cartBtn = document.getElementById('bkCartBtn');
    var panel = document.getElementById('cartPanel');
    var closeBtn = document.getElementById('cartPanelClose');
    var backdrop = document.getElementById('bkPanelBackdrop');

    if (cartBtn && cartBtn.dataset.cartBound !== 'true') {
      cartBtn.dataset.cartBound = 'true';
      cartBtn.addEventListener('click', function (event) {
        event.preventDefault();
        renderCartPanel();
        openPanel(panel);
      });
    }
    if (closeBtn && closeBtn.dataset.closeBound !== 'true') {
      closeBtn.dataset.closeBound = 'true';
      closeBtn.addEventListener('click', closePanels);
    }
    if (backdrop && backdrop.dataset.panelBound !== 'true') {
      backdrop.dataset.panelBound = 'true';
      backdrop.addEventListener('click', closePanels);
    }
  }

  /**
   * Highlights the current booking navigation link from the active URL.
   */
  function setActiveNavLink() {
    var path = window.location.pathname;
    var navMap = [
      ['navSearch', 'camp-search'],
      ['navRentalGuide', 'rental-guide'],
      ['navFaq', 'booking-faq'],
      ['navMember', 'member-center']
    ];
    var matchedLegacy = false;
    navMap.forEach(function (item) {
      var el = document.getElementById(item[0]);
      if (el && path.indexOf(item[1]) !== -1) {
        matchedLegacy = true;
        el.classList.add('active');
      }
    });

    if (matchedLegacy) return;

    document.querySelectorAll('.yr-site-context-link, .yr-site-drawer__link').forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href) return;
      if (path.indexOf('camp-search') !== -1 && href.indexOf('camp-search') !== -1) link.classList.add('active');
      if (path.indexOf('rental-guide') !== -1 && href.indexOf('rental-guide') !== -1) link.classList.add('active');
      if (path.indexOf('booking-faq') !== -1 && href.indexOf('booking-faq') !== -1) link.classList.add('active');
      if (path.indexOf('member-center') !== -1 && href.indexOf('member-center') !== -1) link.classList.add('active');
    });
  }

  /**
   * Closes open booking UI layers on Escape.
   */
  function handleEscapeKey(event) {
    if (event.key !== 'Escape') return;
    var activeModal = document.querySelector('#loginModal.active, #campPreferenceModal.active, #campPreferenceCloseConfirmModal.active');
    if (activeModal) {
      closeSharedModal(activeModal.id);
      return;
    }
    if (!window.__sharedHeaderControllerActive) {
      closeOffcanvasFromAnywhere();
    }
    closePanels();
  }

  /**
   * Keeps booking UI synchronized when another tab or shared auth flow changes storage.
   */
  function handleStorageChange(event) {
    if (event.key === 'bookingCart') updateBookingBadge();
    if (['isLoggedIn', 'currentUser', 'yuruiUser'].indexOf(event.key) !== -1) checkLoginState();
  }

  /**
   * Refreshes booking header user UI after shared auth events.
   */
  function handleAuthChanged() {
    checkLoginState();
    if (getCurrentUser()) {
      maybeOpenCampPreferenceModal();
    } else {
      closeSharedModal('campPreferenceCloseConfirmModal', { force: true });
      closeSharedModal('campPreferenceModal', { force: true });
    }
  }

  /**
   * Builds a confirm-style toast for destructive booking actions.
   */
  function showConfirmToast(message, onConfirm) {
    var container = getToastContainer();
    var toast = document.createElement('div');
    var icon = document.createElement('i');
    var text = document.createElement('span');
    var actions = document.createElement('div');
    var confirmBtn = document.createElement('button');
    var cancelBtn = document.createElement('button');

    toast.className = 'bk-toast bk-toast--warning bk-toast--confirm';
    icon.className = 'bi bi-exclamation-triangle-fill';
    icon.setAttribute('aria-hidden', 'true');
    text.className = 'bk-toast__text';
    text.textContent = message;
    actions.className = 'bk-toast__actions';
    confirmBtn.className = 'bk-toast__action-btn bk-toast__action-btn--confirm';
    confirmBtn.textContent = '確認清空';
    cancelBtn.className = 'bk-toast__action-btn bk-toast__action-btn--cancel';
    cancelBtn.textContent = '取消';

    confirmBtn.addEventListener('click', function () {
      dismissToast(toast);
      onConfirm();
    });
    cancelBtn.addEventListener('click', function () { dismissToast(toast); });

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(actions);
    container.appendChild(toast);
  }

  /**
   * Binds global document/window listeners once for the booking header runtime.
   */
  function bindGlobalEvents() {
    if (window.__bookingHeaderGlobalEventsBound) return;
    window.__bookingHeaderGlobalEventsBound = true;

    document.addEventListener('click', function (event) {
      if (!event.target.closest('.booking-header .navbar-user-menu')) closeUserDropdown();
    });
    document.addEventListener('keydown', handleEscapeKey);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('yurui:auth-changed', handleAuthChanged);
  }

  /**
   * Initializes the Booking header after its partial and shared auth markup are available.
   */
  function initBookingHeader() {
    ensureToastFallback();
    updateBookingBadge();
    if (!window.__sharedHeaderControllerActive) {
      initOffcanvas();
    }
    initSharedAuthModals();
    initCartPanel();
    setActiveNavLink();
    checkLoginState();
    bindGlobalEvents();
  }

  initBookingHeader();

  if (typeof window.onBookingHeaderReady === 'function') {
    window.onBookingHeaderReady();
  }
}());
