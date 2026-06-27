/**
 * Creates the floating scroll-to-top and LINE shortcut buttons on booking pages.
 */
function initFloatingActions() {
  if (document.querySelector('.floating-actions')) return;

  const floatingActions = document.createElement('div');
  floatingActions.className = 'floating-actions';
  floatingActions.innerHTML = `
    <button
      class="floating-top-btn"
      type="button"
      aria-label="回到頁面頂端"
      title="回到頁面頂端"
    >
      <i class="bi bi-chevron-up"></i>
    </button>
    <a
      class="floating-line-btn"
      href="https://line.me"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="LINE 聯絡"
      title="LINE 聯絡"
    >
      <span class="floating-line-label">LINE 聯絡</span>
      <span class="floating-line-icon" aria-hidden="true">
        <i class="bi bi-chat-dots-fill"></i>
      </span>
    </a>
  `;

  document.body.appendChild(floatingActions);

  const topButton = floatingActions.querySelector('.floating-top-btn');

  /**
   * Shows the top button only after the user scrolls past the first viewport segment.
   */
  function toggleTopButton() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const shouldShow = scrollTop > (window.innerHeight / 5);
    topButton.classList.toggle('is-visible', shouldShow);
  }

  topButton.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  window.addEventListener('scroll', toggleTopButton, { passive: true });
  window.addEventListener('resize', toggleTopButton);
  toggleTopButton();
}

/**
 * Loads a script once and uses a window flag to prevent duplicate event bindings.
 * @param {string} src - Script URL to load.
 * @param {string} flagName - Window flag used to mark a loaded script.
 * @returns {Promise<void>} Resolves after the script loads.
 */
function loadScriptOnce(src, flagName) {
  return new Promise(function (resolve, reject) {
    if (window[flagName]) {
      resolve();
      return;
    }

    window[flagName] = true;
    const script = document.createElement('script');
    script.src = src;
    script.onload = function () { resolve(); };
    script.onerror = function () {
      window[flagName] = false;
      reject(new Error('script load failed: ' + src));
    };
    document.body.appendChild(script);
  });
}

/**
 * Loads shared-header runtime first, then booking utilities.
 * toast.js is loaded first so window.showToast is the unified implementation
 * before booking-header.js's ensureToastFallback() runs.
 */
function loadBookingHeaderScriptShared() {
  return loadScriptOnce('../../js/components/toast.js', '__toastScriptLoaded')
    .then(function () {
      return loadScriptOnce('../../js/components/header.js', '__sharedHeaderScriptLoaded');
    })
    .then(function () {
      if (typeof window.initNavbar === 'function') window.initNavbar();
      return loadScriptOnce('../../js/components/auth.js', '__yuruiAuthScriptLoaded');
    })
    .then(function () {
      if (typeof window.initAuth === 'function') window.initAuth();
      return loadScriptOnce('../js/booking-header.js', '__bookingHeaderScriptLoaded');
    })
    .catch(function (error) {
      console.error(error);
      return false;
    });
}

/**
 * Loads booking header runtime scripts in legacy mode.
 */
function loadBookingHeaderScriptLegacy() {
  return loadScriptOnce('../../js/components/toast.js', '__toastScriptLoaded')
    .then(function () {
      return loadScriptOnce('../../js/components/auth.js', '__yuruiAuthScriptLoaded');
    })
    .then(function () {
      if (typeof window.initAuth === 'function') window.initAuth();
      return loadScriptOnce('../js/booking-header.js', '__bookingHeaderScriptLoaded');
    })
    .catch(function (error) {
      console.error(error);
      return false;
    });
}

/**
 * Loads one data-layout-part from a shared partial into a booking page target.
 * @param {string} targetSelector - Target element selector.
 * @param {string} url - Partial URL.
 * @param {string} partSelector - data-layout-part selector to extract.
 * @param {Function=} callback - Optional completion callback.
 * @returns {Promise<boolean>} Whether the partial was loaded.
 */
function loadBookingLayoutPartial(targetSelector, url, partSelector, callback) {
  const target = document.querySelector(targetSelector);
  if (!target) {
    if (callback) callback(false);
    return Promise.resolve(false);
  }

  return fetch(url)
    .then(function (response) {
      if (!response.ok) throw new Error('booking layout partial load failed: ' + url);
      return response.text();
    })
    .then(function (html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      const part = template.content.querySelector(partSelector);
      const content = part ? part.innerHTML : html;

      // Shared auth and business panels are appended; header/footer fragments replace the target shell.
      if (
        partSelector === '[data-layout-part="shared-auth"]'
        || partSelector === '[data-layout-part="shared-booking-cart-panel"]'
        || partSelector === '[data-layout-part="shared-site-cart-panel"]'
      ) {
        target.insertAdjacentHTML('beforeend', content);
      } else {
        target.innerHTML = content;
      }

      if (callback) callback(true);
      return true;
    })
    .catch(function (error) {
      if (partSelector === '[data-layout-part="shared-site-header"]') {
        console.error('[Booking Layout] Failed to load shared-site-header', error);
      } else {
        console.error(error);
      }
      if (callback) callback(false);
      return false;
    });
}

/**
 * Loads the booking header, shared auth modal, and footer for booking pages.
 */
function resolveBookingHeaderTarget() {
  const sharedHeader = document.querySelector('#header[data-header-context="camp"]');
  if (sharedHeader) {
    return {
      selector: '#header',
      target: sharedHeader,
      useSharedController: true,
    };
  }

  const legacyHeader = document.querySelector('#booking-header');
  if (legacyHeader) {
    console.warn('[Booking Layout] Legacy #booking-header is still in use.');
    return {
      selector: '#booking-header',
      target: legacyHeader,
      useSharedController: false,
    };
  }

  return null;
}

function loadBookingHeader() {
  const targetInfo = resolveBookingHeaderTarget();
  if (!targetInfo) {
    console.error('[Booking Layout] Missing header root: expected #header[data-header-context="camp"] or #booking-header.');
    return Promise.resolve(false);
  }

  const target = targetInfo.target;
  if (targetInfo.useSharedController && !target.dataset.headerContext) {
    target.dataset.headerContext = 'camp';
  }

  const injectHeader = target.dataset.bookingHeaderLoaded === 'true'
    ? Promise.resolve(true)
    : loadBookingLayoutPartial(
      targetInfo.selector,
      '../../components/header.partial',
      targetInfo.useSharedController ? '[data-layout-part="shared-site-header"]' : '[data-layout-part="booking-header"]'
    )
      .then(function (ok) {
        if (!ok) return false;
        target.dataset.bookingHeaderLoaded = 'true';
        return true;
      });

  return injectHeader
    .then(function (ok) {
      if (!ok) return false;
      if (target.dataset.sharedAuthLoaded === 'true') return true;
      return loadBookingLayoutPartial(targetInfo.selector, '../../components/header.partial', '[data-layout-part="shared-auth"]')
        .then(function (authOk) {
          if (authOk) target.dataset.sharedAuthLoaded = 'true';
          return authOk;
        });
    })
    .then(function (ok) {
      if (!ok) return false;
      if (!targetInfo.useSharedController) return true;
      if (document.getElementById('cartPanel')) return true;
      return loadBookingLayoutPartial(
        targetInfo.selector,
        '../../components/header.partial',
        '[data-layout-part="shared-booking-cart-panel"]'
      );
    })
    .then(function (ok) { return !!ok; });
}

function loadBookingFooter() {
  const footer = document.querySelector('#booking-footer');
  if (!footer) return Promise.resolve(false);
  if (footer.dataset.bookingFooterLoaded === 'true') return Promise.resolve(true);

  return loadBookingLayoutPartial('#booking-footer', '../../components/footer.partial', '[data-layout-part="booking-footer"]')
    .then(function (ok) {
      if (ok) footer.dataset.bookingFooterLoaded = 'true';
      return ok;
    });
}

window.loadBookingHeader = loadBookingHeader;
window.loadBookingFooter = loadBookingFooter;
window.loadBookingSharedLayout = function () {
  return loadBookingHeader()
    .then(function (headerOk) {
      if (!headerOk) return false;
      return loadBookingFooter().then(function () { return true; });
    })
    .then(function (ok) {
      if (!ok) return false;
      const targetInfo = resolveBookingHeaderTarget();
      if (!targetInfo) return false;
      return targetInfo.useSharedController
        ? loadBookingHeaderScriptShared()
        : loadBookingHeaderScriptLegacy();
    });
};

document.addEventListener('DOMContentLoaded', initFloatingActions);
