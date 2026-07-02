const DRAWER_SELECTOR = '.yr-drawer-overlay';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const state = {
  activeOverlay: null,
  opener: null,
};

function getDrawer(overlay) {
  return overlay ? overlay.querySelector('.yr-drawer') : null;
}

function getFocusableElements(root) {
  return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(function (element) {
    return element.offsetParent !== null || element === document.activeElement;
  });
}

function setBodyLock(locked) {
  document.body.classList.toggle('drawer-system-locked', locked);
}

function finishClosing(overlay) {
  if (!overlay || overlay.classList.contains('is-open')) return;
  overlay.hidden = true;
}

function closeDrawer(restoreFocus) {
  const overlay = state.activeOverlay;
  const opener = state.opener;

  if (!overlay) return;

  window.clearTimeout(overlay._drawerCloseTimer);
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');

  const drawer = getDrawer(overlay);
  if (drawer) drawer.setAttribute('aria-hidden', 'true');

  overlay._drawerCloseTimer = window.setTimeout(function () {
    finishClosing(overlay);
  }, 340);

  state.activeOverlay = null;
  state.opener = null;

  if (!document.querySelector(DRAWER_SELECTOR + '.is-open')) {
    setBodyLock(false);
  }

  if (restoreFocus !== false && opener && typeof opener.focus === 'function') {
    opener.focus();
  }
}

function openDrawer(name, trigger) {
  const overlay = document.querySelector(DRAWER_SELECTOR + '[data-drawer-overlay="' + name + '"]');
  const drawer = getDrawer(overlay);

  if (!overlay || !drawer) return;

  if (state.activeOverlay && state.activeOverlay !== overlay) {
    closeDrawer(false);
  }

  state.activeOverlay = overlay;
  state.opener = trigger || document.activeElement;

  window.clearTimeout(overlay._drawerCloseTimer);
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  drawer.setAttribute('aria-hidden', 'false');
  setBodyLock(true);

  window.requestAnimationFrame(function () {
    overlay.classList.add('is-open');
    const preferredFocus = drawer.querySelector('[data-drawer-initial-focus]');
    const focusables = getFocusableElements(drawer);
    const focusTarget = preferredFocus || focusables[0] || drawer;
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  });
}

function toggleDrawer(name, trigger) {
  const overlay = document.querySelector(DRAWER_SELECTOR + '[data-drawer-overlay="' + name + '"]');
  if (!overlay) return;
  if (overlay.classList.contains('is-open')) {
    closeDrawer();
    return;
  }
  openDrawer(name, trigger);
}

function handleDocumentClick(event) {
  const openTrigger = event.target.closest('[data-open-drawer]');
  if (openTrigger) {
    event.preventDefault();
    toggleDrawer(openTrigger.getAttribute('data-open-drawer'), openTrigger);
    return;
  }

  const closeTrigger = event.target.closest('.yr-drawer__close');
  if (closeTrigger) {
    event.preventDefault();
    closeDrawer();
    return;
  }

  const overlay = event.target.closest(DRAWER_SELECTOR);
  if (overlay && event.target === overlay) {
    closeDrawer();
  }
}

function handleKeydown(event) {
  const overlay = state.activeOverlay;
  if (!overlay) return;

  const drawer = getDrawer(overlay);
  if (!drawer) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeDrawer();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusables = getFocusableElements(drawer);
  if (focusables.length === 0) {
    event.preventDefault();
    drawer.focus();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || active === drawer) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

function initDrawerSystem() {
  document.querySelectorAll(DRAWER_SELECTOR).forEach(function (overlay) {
    const drawer = getDrawer(overlay);
    if (drawer) {
      drawer.setAttribute('aria-hidden', 'true');
    }
    overlay.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
  });

  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleKeydown);
}

document.addEventListener('DOMContentLoaded', initDrawerSystem);

window.YuruicampDrawerSandbox = {
  open: openDrawer,
  close: function () {
    closeDrawer();
  },
};
