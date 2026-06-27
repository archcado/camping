// ========================================
// Header component controller
// ========================================

const SEARCH_SUGGESTIONS = [
  '帳篷', '睡袋', '登山背包', '折疊椅', '露營燈',
  '炊具組', '防水外套', '登山杖', '野餐墊', '保溫瓶',
  '頭燈', '急救包', '防蚊液', '地釘', '帳篷地布',
  'Coleman', 'Snow Peak', 'Ogawa', 'MSR', 'Primus',
];

const HEADER_CONTEXTS = {
  shop: {
    label: '裝備商城',
    homeHref: '/pages/home.html',
    navigation: [
      { label: '商品', href: '/pages/products.html' },
      { label: '部落格', href: '/pages/blog.html' },
      { label: '分店', href: '/pages/branches.html' },
      { label: '常見問題', href: '/pages/faq.html' },
    ],
    switchAction: { label: '前往營地預約', href: '/booking/pages/camp-search.html' },
    utilityType: 'cart',
    utilityLabel: '購物車',
  },
  camp: {
    label: '營地預約',
    homeHref: '/booking/pages/camp-search.html',
    navigation: [
      { label: '探索營區', href: '/booking/pages/camp-search.html' },
      { label: '租借體驗說明', href: '/booking/pages/rental-guide.html' },
      { label: '常見問題', href: '/booking/pages/booking-faq.html' },
      { label: '會員中心', href: '/booking/pages/member-center.html' },
    ],
    switchAction: { label: '前往裝備商城', href: '/pages/home.html' },
    utilityType: 'booking',
    utilityLabel: '預約背包',
  },
};

let _activeSharedState = null;
let _sharedEscapeBound = false;

function _normalizePath(pathname) {
  if (!pathname) return '/';
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

function _getUser() {
  if (window.YuruiAuth && typeof window.YuruiAuth.getUser === 'function') {
    return window.YuruiAuth.getUser();
  }

  if (window.AppState && window.AppState.isLoggedIn && window.AppState.currentUser) {
    return window.AppState.currentUser;
  }

  return null;
}

function _resolveHeaderRoot() {
  const sharedRoot = document.getElementById('header');
  if (!sharedRoot) return null;

  const contextAttr = (sharedRoot.dataset.headerContext || '').toLowerCase();
  if (HEADER_CONTEXTS[contextAttr]) {
    return {
      root: sharedRoot,
      context: contextAttr,
      fallbackSource: '',
    };
  }

  console.warn('Missing or invalid #header[data-header-context], fallback to "shop".');
  return {
    root: sharedRoot,
    context: 'shop',
    fallbackSource: '#header context invalid -> shop (compat)',
  };
}

function _findNearestHeaderRoot(node) {
  if (node && typeof node.closest === 'function') {
    const scopedRoot = node.closest('#header');
    if (scopedRoot) return scopedRoot;
  }
  const resolved = _resolveHeaderRoot();
  return resolved ? resolved.root : null;
}

function _getDrawerElements(root) {
  return {
    drawer: root.querySelector('[data-header-drawer]'),
    overlay: root.querySelector('[data-header-overlay]'),
    toggle: root.querySelector('.yr-site-menu-toggle'),
    close: root.querySelector('[data-header-close]'),
  };
}

function _isSharedHeader(root) {
  return !!root.querySelector('[data-header-drawer]');
}

function _sharedHeaderStructureReady(root) {
  return Boolean(
    root.querySelector('.yr-site-header-shell')
    && root.querySelector('[data-header-actions]')
    && root.querySelector('[data-header-navigation]')
    && root.querySelector('[data-header-context-label]')
    && root.querySelector('[data-header-switch-action]')
    && root.querySelector('[data-header-utility]')
  );
}

function _sharedHeaderContentReady(root) {
  const actions = root.querySelector('[data-header-actions]');
  const navigation = root.querySelector('[data-header-navigation]');
  return Boolean(actions && navigation && actions.children.length > 0 && navigation.children.length > 0);
}

function _sharedHeaderFullyInitialized(root, context) {
  return (
    root.dataset.headerInitialized === 'true'
    && root.dataset.headerInitializedContext === context
    && _sharedHeaderStructureReady(root)
    && _sharedHeaderContentReady(root)
  );
}

function _isDrawerOpen(root) {
  const { drawer } = _getDrawerElements(root);
  return !!(drawer && drawer.classList.contains('is-open'));
}

function _applyDrawerState(root, shouldOpen) {
  const { drawer, overlay, toggle } = _getDrawerElements(root);
  if (!drawer || !toggle) return;

  drawer.classList.toggle('is-open', shouldOpen);
  overlay?.classList.toggle('is-visible', shouldOpen);
  document.body.classList.toggle('yr-site-drawer-open', shouldOpen);
  document.body.style.overflow = shouldOpen ? 'hidden' : '';

  toggle.setAttribute('aria-expanded', String(shouldOpen));
  drawer.setAttribute('aria-hidden', String(!shouldOpen));
  overlay?.setAttribute('aria-hidden', String(!shouldOpen));

  if (shouldOpen) {
    _activeSharedState = root;
  } else if (_activeSharedState === root) {
    _activeSharedState = null;
  }
}

function _bindSharedEscape() {
  if (_sharedEscapeBound) return;
  _sharedEscapeBound = true;

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!_activeSharedState) return;
    window.closeDrawer();
  });
}

function _renderSearchWrapper() {
  return `
    <div class="navbar-search-wrapper yr-site-search">
      <button type="button" class="navbar-search-btn navbar-search-toggle yr-site-icon-button" aria-expanded="false" title="搜尋">
        <i class="bi bi-search" aria-hidden="true"></i>
      </button>
      <form class="navbar-search-form" role="search" aria-hidden="true">
        <input type="text" class="navbar-search-input" placeholder="搜尋商品、品牌..." autocomplete="off" aria-label="搜尋">
        <button type="submit" class="navbar-search-submit" title="送出搜尋">搜尋</button>
      </form>
      <div class="navbar-search-dropdown"></div>
    </div>
  `;
}

function _formatProviderLabel(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value) return '';
  if (window.YuruiAuth && typeof window.YuruiAuth.getProviderLabel === 'function') {
    return window.YuruiAuth.getProviderLabel(value);
  }
  if (value === 'line') return 'LINE';
  if (value === 'facebook') return 'Facebook';
  if (value === 'google') return 'Google';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function _isPlaceholderAccountName(name, providerLabel) {
  const value = String(name || '').trim();
  const provider = String(providerLabel || '').trim();
  if (!value) return true;
  if (['用戶', '會員', '會員中心'].includes(value)) return true;
  if (!provider) return false;
  return value === provider || value === `${provider} 會員` || value === `${provider}會員`;
}

function _getAccountPrimaryLabel(user) {
  const rawName = String((user && (user.displayName || user.name)) || '').trim();
  const providerLabel = _formatProviderLabel(user && user.provider);
  if (_isPlaceholderAccountName(rawName, providerLabel)) {
    return '會員中心';
  }
  return rawName;
}

function _getAccountProviderLabel(user) {
  const providerLabel = _formatProviderLabel(user && user.provider);
  return providerLabel ? `${providerLabel} 登入` : '';
}

function _getAccountAvatarMarkup(user, primaryLabel) {
  const name = String((user && (user.displayName || user.name)) || '').trim();
  if (name && primaryLabel && primaryLabel !== '會員中心') {
    return primaryLabel.charAt(0).toUpperCase();
  }
  return '<i class="bi bi-person" aria-hidden="true"></i>';
}

function _renderUserBlock(context) {
  const memberHref = context === 'camp' ? '/booking/pages/member-center.html' : '/pages/member-center.html';
  return `
    <button
      class="navbar-login-btn yr-site-login-btn"
      type="button"
      title="登入"
      data-auth-login-trigger
      onclick="window.openModal('loginModal')"
    >登入</button>
    <div class="navbar-user-menu yr-site-user-menu" hidden>
      <button class="user-info yr-site-account-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="navbarUserDropdown">
        <span class="user-avatar yr-site-account-avatar" title="個人資料" aria-hidden="true"><i class="bi bi-person" aria-hidden="true"></i></span>
        <span class="user-copy yr-site-account-copy">
          <span class="user-name yr-site-account-name">會員中心</span>
          <span class="user-provider yr-site-account-provider">Google 登入</span>
        </span>
        <span class="user-menu-chevron yr-site-account-chevron" aria-hidden="true"><i class="bi bi-chevron-down" aria-hidden="true"></i></span>
      </button>
      <div class="navbar-user-dropdown" id="navbarUserDropdown" hidden>
        <a href="${memberHref}" class="dropdown-item">
          <i class="bi bi-person" aria-hidden="true"></i> 會員中心
        </a>
        <button class="navbar-logout-btn" type="button">
          <i class="bi bi-box-arrow-right" aria-hidden="true"></i> 登出
        </button>
      </div>
    </div>
  `;
}

function _renderSharedActions(root, contextKey) {
  const context = HEADER_CONTEXTS[contextKey];
  const actions = root.querySelector('[data-header-actions]');
  if (!actions || !context) return;

  if (contextKey === 'shop') {
    actions.innerHTML = `
      ${_renderSearchWrapper()}
      <a href="${context.switchAction.href}" class="yr-site-switch-link">${context.switchAction.label}</a>
      <button type="button" class="navbar-cart-btn yr-site-utility-btn" title="購物車" aria-controls="siteCartDrawer" aria-expanded="false">
        <i class="bi bi-bag" aria-hidden="true"></i>
        <span class="cart-badge yr-site-utility-badge" hidden>0</span>
      </button>
      ${_renderUserBlock(contextKey)}
    `;
    return;
  }

  actions.innerHTML = `
    <a href="${context.navigation[0].href}" class="yr-site-context-link">${context.navigation[0].label}</a>
    <a href="${context.switchAction.href}" class="yr-site-switch-link">${context.switchAction.label}</a>
    <button id="bkCartBtn" type="button" class="yr-site-utility-btn yr-site-utility-btn--booking" title="${context.utilityLabel}" aria-label="${context.utilityLabel}">
      <i class="bi bi-bag-heart" aria-hidden="true"></i>
      <span class="yr-site-utility-text">${context.utilityLabel}</span>
      <span class="yr-site-utility-badge" id="bookingBadge" hidden>0</span>
    </button>
    ${_renderUserBlock(contextKey)}
  `;
}

function _renderDrawerContent(root, contextKey) {
  const context = HEADER_CONTEXTS[contextKey];
  if (!context) return;

  const labelEl = root.querySelector('[data-header-context-label]');
  const homeLink = root.querySelector('[data-header-home-link]');
  const navContainer = root.querySelector('[data-header-navigation]');
  const switchAction = root.querySelector('[data-header-switch-action]');
  const utilityButton = root.querySelector('[data-header-utility]');

  if (labelEl) labelEl.textContent = context.label;
  if (homeLink) homeLink.href = context.homeHref;

  if (navContainer) {
    navContainer.innerHTML = context.navigation.map((item) => `
      <a class="yr-site-drawer__link" href="${item.href}" data-nav-href="${item.href}">
        <span>${item.label}</span>
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </a>
    `).join('');
  }

  if (switchAction) {
    switchAction.href = context.switchAction.href;
    switchAction.textContent = context.switchAction.label;
  }

  if (utilityButton) {
    utilityButton.innerHTML = context.utilityType === 'shop'
      ? `<i class="bi bi-bag" aria-hidden="true"></i><span>${context.utilityLabel}</span><span class="yr-site-utility-badge" data-header-utility-badge hidden>0</span>`
      : `<i class="bi bi-bag-heart" aria-hidden="true"></i><span>${context.utilityLabel}</span><span class="yr-site-utility-badge" id="bookingBadgeMobile" hidden>0</span>`;
    utilityButton.setAttribute('aria-label', context.utilityLabel);
  }
}

function _bindSharedDrawerEvents(root, contextKey) {
  const { toggle, close, overlay } = _getDrawerElements(root);
  const navLinks = root.querySelectorAll('.yr-site-drawer__link, [data-header-switch-action]');
  const utilityButton = root.querySelector('[data-header-utility]');

  if (toggle && toggle.dataset.drawerBound !== 'true') {
    toggle.dataset.drawerBound = 'true';
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      window.toggleDrawer();
    });
  }

  if (close && close.dataset.drawerBound !== 'true') {
    close.dataset.drawerBound = 'true';
    close.addEventListener('click', (event) => {
      event.preventDefault();
      window.closeDrawer();
    });
  }

  if (overlay && overlay.dataset.drawerBound !== 'true') {
    overlay.dataset.drawerBound = 'true';
    overlay.addEventListener('click', () => {
      window.closeDrawer();
    });
  }

  navLinks.forEach((link) => {
    if (link.dataset.drawerBound === 'true') return;
    link.dataset.drawerBound = 'true';
    link.addEventListener('click', () => {
      window.closeDrawer();
    });
  });

  if (utilityButton && utilityButton.dataset.drawerBound !== 'true') {
    utilityButton.dataset.drawerBound = 'true';
    utilityButton.addEventListener('click', (event) => {
      event.preventDefault();
      window.closeDrawer();

      if (contextKey === 'shop') {
        if (typeof window.openCartDrawer === 'function') {
          window.openCartDrawer();
          return;
        }
        root.querySelector('.navbar-cart-btn')?.click();
        return;
      }

      root.querySelector('#bkCartBtn')?.click();
    });
  }
}

function _highlightActiveLinks(root) {
  const currentPath = _normalizePath(window.location.pathname);
  root.querySelectorAll('.yr-site-drawer__link').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;
    let targetPath = '';
    try {
      targetPath = _normalizePath(new URL(href, window.location.origin).pathname);
    } catch {
      targetPath = '';
    }

    const isActive = !!targetPath && (currentPath === targetPath || currentPath.endsWith(targetPath));
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function _syncShopDrawerUtilityBadge(root) {
  const headerBadge = root.querySelector('.navbar-cart-btn .cart-badge');
  const drawerBadge = root.querySelector('[data-header-utility-badge]');
  if (!headerBadge || !drawerBadge) return;
  drawerBadge.textContent = headerBadge.textContent || '0';
  drawerBadge.hidden = headerBadge.hidden;
}

function _initSharedHeader(root, contextKey) {
  _renderSharedActions(root, contextKey);
  _renderDrawerContent(root, contextKey);

  _applyDrawerState(root, false);
  _bindSharedDrawerEvents(root, contextKey);
  _bindSharedEscape();
  _highlightActiveLinks(root);

  _initSearchBar(root);
  return true;
}

window.openDrawer = () => {
  const root = _resolveHeaderRoot()?.root;
  if (!root || !_isSharedHeader(root)) return;
  _applyDrawerState(root, true);
};

window.closeDrawer = () => {
  const root = _resolveHeaderRoot()?.root;
  if (!root || !_isSharedHeader(root)) return;
  _applyDrawerState(root, false);
};

window.toggleDrawer = () => {
  const root = _resolveHeaderRoot()?.root;
  if (!root || !_isSharedHeader(root)) return;
  _applyDrawerState(root, !_isDrawerOpen(root));
};

window.initNavbar = () => {
  const resolved = _resolveHeaderRoot();
  if (!resolved) return;

  const { root, context, fallbackSource } = resolved;
  root.dataset.headerContextResolved = context;
  if (fallbackSource) root.dataset.headerContextFallback = fallbackSource;

  if (_isSharedHeader(root)) {
    if (_sharedHeaderFullyInitialized(root, context)) {
      _highlightActiveLinks(root);
      window.updateNavbarLoginState();
      if (context === 'shop') {
        window.updateCartBadge();
        _syncShopDrawerUtilityBadge(root);
      }
      return;
    }

    if (!_sharedHeaderStructureReady(root)) {
      root.dataset.headerInitialized = 'false';
      delete root.dataset.headerInitializedContext;
      return;
    }

    _initSharedHeader(root, context);
    if (!_sharedHeaderContentReady(root)) {
      root.dataset.headerInitialized = 'false';
      delete root.dataset.headerInitializedContext;
      return;
    }
    window.__sharedHeaderControllerActive = true;
  } else {
    root.dataset.headerInitialized = 'false';
    delete root.dataset.headerInitializedContext;
    console.error('shared-site-header structure missing: expected [data-header-drawer].');
    return;
  }

  window.updateNavbarLoginState();
  _bindAuthStateEvents();
  if (context === 'shop') {
    window.updateCartBadge();
    _syncShopDrawerUtilityBadge(root);
  }

  root.dataset.headerInitialized = 'true';
  root.dataset.headerInitializedContext = context;
};

function _initSearchBar(root) {
  const searchInput = root.querySelector('.navbar-search-input');
  const searchDropdown = root.querySelector('.navbar-search-dropdown');
  const searchForm = root.querySelector('.navbar-search-form');
  const searchWrapper = root.querySelector('.navbar-search-wrapper');
  const searchToggle = root.querySelector('.navbar-search-toggle');

  if (!searchInput || !searchDropdown || !searchWrapper) return;
  const debounceFn = typeof window.debounce === 'function' ? window.debounce : ((fn) => fn);

  if (searchToggle && searchToggle.dataset.searchBound !== 'true') {
    searchToggle.dataset.searchBound = 'true';
    searchToggle.addEventListener('click', (event) => {
      event.preventDefault();
      const willOpen = !searchWrapper.classList.contains('is-open');
      searchWrapper.classList.toggle('is-open', willOpen);
      searchForm?.setAttribute('aria-hidden', String(!willOpen));
      searchToggle.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) searchInput.focus();
    });
  }

  if (searchInput.dataset.searchBound !== 'true') {
    searchInput.dataset.searchBound = 'true';
    searchInput.addEventListener('input', debounceFn(() => {
      const query = searchInput.value.trim().toLowerCase();
      if (query.length < 1) {
        _renderDropdown(SEARCH_SUGGESTIONS.slice(0, 6), searchDropdown, '熱門搜尋');
      } else {
        const filtered = SEARCH_SUGGESTIONS.filter((keyword) => keyword.toLowerCase().includes(query));
        _renderDropdown(filtered.slice(0, 6), searchDropdown, filtered.length ? '搜尋建議' : '');
      }
    }, 200));

    searchInput.addEventListener('focus', () => {
      _renderDropdown(SEARCH_SUGGESTIONS.slice(0, 6), searchDropdown, '熱門搜尋');
      searchDropdown.classList.add('active');
    });
  }

  if (searchForm && searchForm.dataset.searchBound !== 'true') {
    searchForm.dataset.searchBound = 'true';
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = searchInput.value.trim();
      if (!query) return;
      window.showToast(`搜尋：${query}`, 'info');
      searchWrapper.classList.remove('is-open');
      searchForm.setAttribute('aria-hidden', 'true');
      searchToggle?.setAttribute('aria-expanded', 'false');
      searchDropdown.classList.remove('active');
    });
  }

  if (root.dataset.searchOutsideBound !== 'true') {
    root.dataset.searchOutsideBound = 'true';
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.navbar-search-wrapper')) {
        searchWrapper.classList.remove('is-open');
        searchForm?.setAttribute('aria-hidden', 'true');
        searchToggle?.setAttribute('aria-expanded', 'false');
        searchDropdown.classList.remove('active');
      }
    });
  }
}

window.closeMainHeaderDialogs = () => {
  const root = _resolveHeaderRoot()?.root;
  if (!root) return;
  root.querySelector('.navbar-search-wrapper')?.classList.remove('is-open');
  root.querySelector('.navbar-search-form')?.setAttribute('aria-hidden', 'true');
  root.querySelector('.navbar-search-toggle')?.setAttribute('aria-expanded', 'false');
  root.querySelector('.navbar-search-dropdown')?.classList.remove('active');
  root.querySelector('.navbar-user-dropdown')?.setAttribute('hidden', '');
  root.querySelector('.navbar-user-menu .user-info')?.setAttribute('aria-expanded', 'false');
  window.closeDrawer?.();
  document.querySelectorAll('#loginModal.active, #personalizationModal.active').forEach((modal) => {
    modal.classList.remove('active');
  });
};

function _renderDropdown(items, dropdown, title) {
  if (!dropdown) return;
  if (items.length === 0) {
    dropdown.innerHTML = '<div class="search-dropdown-empty">找不到相關搜尋</div>';
    dropdown.classList.add('active');
    return;
  }

  dropdown.innerHTML = `
    ${title ? `<div class="search-dropdown-title">${title}</div>` : ''}
    <ul class="search-dropdown-list">
      ${items.map((item) => `
        <li class="search-dropdown-item" data-keyword="${item}">
          <i class="bi bi-search" aria-hidden="true"></i> ${item}
        </li>
      `).join('')}
    </ul>
  `;
  dropdown.classList.add('active');

  dropdown.querySelectorAll('.search-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      const root = _findNearestHeaderRoot(dropdown);
      const searchInput = root ? root.querySelector('.navbar-search-input') : null;
      if (searchInput) searchInput.value = item.dataset.keyword;
      dropdown.classList.remove('active');
      window.showToast(`搜尋：${item.dataset.keyword}`, 'info');
    });
  });
}

window.updateCartBadge = () => {
  const root = _resolveHeaderRoot()?.root;
  if (!root) return;
  const cartBadge = root.querySelector('.cart-badge');
  if (!cartBadge) return;

  const count = (window.AppState && Array.isArray(window.AppState.cart))
    ? window.AppState.cart.reduce((sum, item) => sum + item.quantity, 0)
    : 0;
  cartBadge.textContent = count;
  cartBadge.hidden = count <= 0;
  _syncShopDrawerUtilityBadge(root);
};

window.updateNavbarLoginState = () => {
  const root = _resolveHeaderRoot()?.root;
  if (!root) return;
  const loginBtn = root.querySelector('.navbar-login-btn');
  const userMenu = root.querySelector('.navbar-user-menu');
  const user = _getUser();
  if (!loginBtn || !userMenu) return;

  if (user) {
    loginBtn.hidden = true;
    userMenu.hidden = false;
    const dropdown = userMenu.querySelector('.navbar-user-dropdown');
    const userName = userMenu.querySelector('.user-name');
    const userProvider = userMenu.querySelector('.user-provider');
    const userAvatar = userMenu.querySelector('.user-avatar');
    const userInfo = userMenu.querySelector('.user-info');
    const primaryLabel = _getAccountPrimaryLabel(user);
    const providerLabel = _getAccountProviderLabel(user);
    if (userName) userName.textContent = primaryLabel;
    if (userProvider) {
      userProvider.textContent = providerLabel;
      userProvider.hidden = !providerLabel;
    }
    if (userAvatar) {
      const avatarMarkup = _getAccountAvatarMarkup(user, primaryLabel);
      if (avatarMarkup.indexOf('<') === 0) {
        userAvatar.innerHTML = avatarMarkup;
      } else {
        userAvatar.textContent = avatarMarkup;
      }
    }
    if (dropdown) dropdown.hidden = true;
    if (userInfo) {
      userInfo.setAttribute('aria-expanded', 'false');
    }
    _initUserMenuDropdown(userMenu);
    return;
  }

  loginBtn.hidden = false;
  userMenu.hidden = true;
  const dropdown = userMenu.querySelector('.navbar-user-dropdown');
  const userInfo = userMenu.querySelector('.user-info');
  if (dropdown) dropdown.hidden = true;
  if (userInfo) userInfo.setAttribute('aria-expanded', 'false');
};

function _bindAuthStateEvents() {
  if (document.body.dataset.mainAuthStateBound === 'true') return;
  document.body.dataset.mainAuthStateBound = 'true';

  window.addEventListener('yurui:auth-changed', window.updateNavbarLoginState);
  window.addEventListener('storage', (event) => {
    if (['isLoggedIn', 'currentUser', 'yuruiUser'].includes(event.key)) {
      window.updateNavbarLoginState();
    }
  });
}

function _initUserMenuDropdown(userMenu) {
  const userInfo = userMenu.querySelector('.user-info');
  const dropdown = userMenu.querySelector('.navbar-user-dropdown');
  const logoutBtn = userMenu.querySelector('[data-action="logout"], .navbar-logout-btn');

  if (!userInfo || !dropdown) return;
  if (userMenu.dataset.dropdownBound === 'true') return;
  userMenu.dataset.dropdownBound = 'true';

  userInfo.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = dropdown.hidden;
    dropdown.hidden = !willOpen;
    userInfo.setAttribute('aria-expanded', String(willOpen));
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (event) => {
      event.preventDefault();
      window.handleLogout();
    });
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.navbar-user-menu')) {
      dropdown.hidden = true;
      userInfo.setAttribute('aria-expanded', 'false');
    }
  });

  dropdown.querySelectorAll('.dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      dropdown.hidden = true;
      userInfo.setAttribute('aria-expanded', 'false');
    });
  });
}

function _closeNavbarUserDropdown() {
  const root = _resolveHeaderRoot()?.root;
  if (!root) return;
  const userInfo = root.querySelector('.navbar-user-menu .user-info');
  const dropdown = root.querySelector('.navbar-user-dropdown');
  if (dropdown) dropdown.hidden = true;
  if (userInfo) userInfo.setAttribute('aria-expanded', 'false');
}

window.handleLogout = () => {
  if (window.YuruiAuth && typeof window.YuruiAuth.logout === 'function') {
    window.YuruiAuth.logout({ close: _closeNavbarUserDropdown });
    return;
  }

  if (typeof window.logout === 'function') {
    window.logout();
  }
  _closeNavbarUserDropdown();
  window.updateNavbarLoginState();
  window.showToast?.('已成功登出', 'success');
};
