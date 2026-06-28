// ========================================
// 購物車組件
// ========================================

/**
 * Escapes cart item text before rendering it into the drawer.
 * @param {*} value - Value to render as text.
 * @returns {string} Safe HTML text.
 */
function _escapeCartHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

/**
 * Finds the shared cart drawer nodes injected by components/header.partial.
 * @returns {{drawer: HTMLElement|null, body: HTMLElement|null, footer: HTMLElement|null, backdrop: HTMLElement|null}}
 */
function _getCartDrawerElements() {
  return {
    drawer: document.getElementById('siteCartDrawer'),
    body: document.getElementById('siteCartDrawerBody'),
    footer: document.getElementById('siteCartDrawerFooter'),
    backdrop: document.getElementById('siteCartBackdrop'),
  };
}

/**
 * Builds a page-relative URL for main-site pages used inside the shared drawer.
 * @param {string} pageName - Target page filename.
 * @returns {string} URL that works from index.html and pages/*.html.
 */
function _getMainPageUrl(pageName) {
  return window.location.pathname.includes('/pages/') ? pageName : `pages/${pageName}`;
}

/**
 * Renders the empty-cart state inside the shared drawer.
 * @returns {string} Empty-cart HTML.
 */
function _renderCartDrawerEmpty() {
  return [
    '<div class="cart-drawer-empty">',
    '  <div class="cart-drawer-empty__icon"><i class="bi bi-bag" aria-hidden="true"></i></div>',
    '  <h3 class="cart-drawer-empty__title">購物車還是空的</h3>',
    '  <p class="cart-drawer-empty__text">去探索一些露營好物，加入購物車吧。</p>',
    '</div>',
  ].join('');
}

/**
 * Renders one cart item row for the shared drawer.
 * @param {Object} item - Cart item from AppState.cart.
 * @returns {string} Cart item HTML.
 */
function _renderCartDrawerItem(item) {
  const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
  return `
    <article class="cart-drawer-item" data-product-id="${_escapeCartHtml(item.id)}">
      <a class="cart-drawer-item__image-link" href="${_getMainPageUrl('product-detail.html')}?id=${encodeURIComponent(item.id)}">
        <img class="cart-drawer-item__image"
             src="${_escapeCartHtml(item.image || 'https://picsum.photos/seed/default/80/80')}"
             alt="${_escapeCartHtml(item.name)}">
      </a>
      <div class="cart-drawer-item__content">
        <div class="cart-drawer-item__brand">${_escapeCartHtml(item.brand || '')}</div>
        <a class="cart-drawer-item__name" href="${_getMainPageUrl('product-detail.html')}?id=${encodeURIComponent(item.id)}">
          ${_escapeCartHtml(item.name)}
        </a>
        <div class="cart-drawer-item__price">${window.formatCurrency(Number(item.price || 0))}</div>
        <div class="cart-drawer-item__actions">
          <button class="cart-qty-decrease" data-product-id="${_escapeCartHtml(item.id)}" type="button" aria-label="減少數量">−</button>
          <span class="cart-drawer-item__qty">${Number(item.quantity || 0)}</span>
          <button class="cart-qty-increase" data-product-id="${_escapeCartHtml(item.id)}" type="button" aria-label="增加數量">+</button>
          <strong class="cart-drawer-item__subtotal">${window.formatCurrency(itemTotal)}</strong>
          <button class="cart-remove-btn" data-product-id="${_escapeCartHtml(item.id)}" type="button" aria-label="移除商品"><i class="bi bi-trash3" aria-hidden="true"></i></button>
        </div>
      </div>
    </article>
  `;
}

/**
 * Updates the drawer summary and checkout visibility from the current cart.
 */
function _updateCartDrawerSummary() {
  const { footer } = _getCartDrawerElements();
  const subtotal = window.calculateCartTotal(window.AppState.cart);
  const shipping = window.calculateShippingFee(subtotal);
  const total = subtotal + shipping;

  const subtotalEl = document.getElementById('summarySubtotal');
  const shippingEl = document.getElementById('summaryShipping');
  const totalEl = document.getElementById('summaryTotal');

  if (subtotalEl) subtotalEl.textContent = window.formatCurrency(subtotal);
  if (shippingEl) shippingEl.textContent = shipping === 0 ? '免運費' : window.formatCurrency(shipping);
  if (totalEl) totalEl.textContent = window.formatCurrency(total);
  if (footer) footer.hidden = window.AppState.cart.length === 0;
}

/**
 * 廣播購物車更新事件，供其他頁面元件同步使用。
 */
function _emitCartUpdated() {
  const subtotal = window.calculateCartTotal(window.AppState.cart);
  const threshold = Number(window.AppConfig?.CART?.FREE_SHIPPING_THRESHOLD) || 0;
  window.dispatchEvent(new CustomEvent('yurui:cart-updated', {
    detail: {
      subtotal,
      threshold,
      cartSize: window.AppState.cart.length,
    },
  }));
}

/**
 * Renders the shared cart drawer body from AppState.cart.
 */
window.renderCartDrawer = () => {
  const { body } = _getCartDrawerElements();
  if (!body || !window.AppState) return;

  const cart = window.AppState.cart || [];
  body.innerHTML = cart.length === 0
    ? _renderCartDrawerEmpty()
    : cart.map(_renderCartDrawerItem).join('');

  _updateCartDrawerSummary();
};

/**
 * Opens the right-side cart drawer and refreshes its content first.
 */
window.openCartDrawer = () => {
  const { drawer, backdrop } = _getCartDrawerElements();
  if (!drawer) return;

  // Closing other header layers prevents stacked dialogs from covering the cart drawer.
  window.closeMainHeaderDialogs?.();
  window.renderCartDrawer();
  drawer.classList.add('is-open');
  if (backdrop) backdrop.classList.add('is-visible');
  document.body.style.overflow = 'hidden';

  const cartBtn = document.querySelector('.navbar-cart-btn');
  if (cartBtn) cartBtn.setAttribute('aria-expanded', 'true');
};

/**
 * Closes the right-side cart drawer and restores page scrolling.
 */
window.closeCartDrawer = () => {
  const { drawer, backdrop } = _getCartDrawerElements();
  if (drawer) drawer.classList.remove('is-open');
  if (backdrop) backdrop.classList.remove('is-visible');
  document.body.style.overflow = '';

  const cartBtn = document.querySelector('.navbar-cart-btn');
  if (cartBtn) cartBtn.setAttribute('aria-expanded', 'false');
};

/**
 * 添加商品到購物車
 * @param {Object} product - 商品對象 {id, name, price, image}
 * @param {number} quantity - 數量
 */
window.addToCart = (product, quantity = 1) => {
  const existingItem = window.AppState.cart.find(item => item.id === product.id);
  
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    window.AppState.cart.push({
      ...product,
      quantity,
    });
  }
  
  window.saveAppState();
  window.updateCartBadge();
  window.renderCartDrawer();
  _emitCartUpdated();
  window.showToast(`已加入購物車`, 'success');
};

/**
 * 從購物車移除商品
 * @param {string} productId - 商品 ID
 */
window.removeFromCart = (productId) => {
  window.AppState.cart = window.AppState.cart.filter(item => item.id !== productId);
  window.saveAppState();
  window.updateCartBadge();
  window.renderCartDrawer();
  _emitCartUpdated();
  window.showToast('已從購物車移除', 'info');
};

/**
 * 更新購物車商品數量
 * @param {string} productId - 商品 ID
 * @param {number} quantity - 新數量
 */
window.updateCartQuantity = (productId, quantity) => {
  const item = window.AppState.cart.find(item => item.id === productId);
  
  if (item) {
    if (quantity <= 0) {
      window.removeFromCart(productId);
    } else if (quantity <= window.AppConfig.CART.MAX_QUANTITY) {
      item.quantity = quantity;
      window.saveAppState();
      window.updateCartBadge();
      window.renderCartDrawer();
      _emitCartUpdated();
    }
  }
};

/**
 * 清空購物車
 */
window.clearCart = () => {
  window.AppState.cart = [];
  window.saveAppState();
  window.updateCartBadge();
  window.renderCartDrawer();
  _emitCartUpdated();
};

/**
 * Sends the user to checkout when the drawer checkout link is clicked.
 */
function _handleDrawerCheckout(event) {
  if (event) event.preventDefault();
  if (!window.AppState.cart || window.AppState.cart.length === 0) {
    window.showToast && window.showToast('購物車目前是空的', 'warning');
    return;
  }

  window.location.href = _getMainPageUrl('checkout.html');
}

/**
 * Binds the shared cart drawer controls once after header markup is loaded.
 */
function _initCartDrawer() {
  const { drawer, backdrop } = _getCartDrawerElements();
  const closeBtn = drawer ? drawer.querySelector('.cart-drawer__close') : null;
  const cartBtn = document.querySelector('.navbar-cart-btn');
  const checkoutBtn = document.getElementById('checkoutBtn');

  if (cartBtn && cartBtn.dataset.cartDrawerBound !== 'true') {
    cartBtn.dataset.cartDrawerBound = 'true';
    cartBtn.addEventListener('click', (event) => {
      event.preventDefault();
      window.openCartDrawer();
    });
  }
  if (closeBtn && closeBtn.dataset.cartDrawerBound !== 'true') {
    closeBtn.dataset.cartDrawerBound = 'true';
    closeBtn.addEventListener('click', window.closeCartDrawer);
  }
  if (backdrop && backdrop.dataset.cartDrawerBound !== 'true') {
    backdrop.dataset.cartDrawerBound = 'true';
    backdrop.addEventListener('click', window.closeCartDrawer);
  }
  if (checkoutBtn && checkoutBtn.dataset.cartDrawerBound !== 'true') {
    checkoutBtn.dataset.cartDrawerBound = 'true';
    checkoutBtn.addEventListener('click', _handleDrawerCheckout);
  }
}

/**
 * 初始化購物車面板事件
 */
window.initCartListeners = () => {
  _initCartDrawer();
  window.renderCartDrawer();

  // 購物車中數量增減
  if (document.body.dataset.cartActionsBound === 'true') return;
  document.body.dataset.cartActionsBound = 'true';
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('cart-qty-increase')) {
      const productId = e.target.dataset.productId;
      const item = window.AppState.cart.find(i => i.id === productId);
      if (item) {
        window.updateCartQuantity(productId, item.quantity + 1);
      }
    }
    
    if (e.target.classList.contains('cart-qty-decrease')) {
      const productId = e.target.dataset.productId;
      const item = window.AppState.cart.find(i => i.id === productId);
      if (item) {
        window.updateCartQuantity(productId, item.quantity - 1);
      }
    }
    
    const removeBtn = e.target.closest('.cart-remove-btn');
    if (removeBtn) {
      const productId = removeBtn.dataset.productId;
      window.removeFromCart(productId);
    }
  });
};

console.log('✓ Cart 組件已初始化');
