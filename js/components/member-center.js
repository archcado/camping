/**
 * member-center.js - shared member-center component
 * 重點：pages/member-center.html 與 booking/pages/member-center.html 共用此檔，頁面只用 window.MemberCenterConfig 提供資料路徑與登入來源。
 */
(function () {
  'use strict';

  var DEFAULT_CONFIG = {
    dataBasePath: '../data',
    authStorageKey: 'currentUser',
    fallbackAuthStorageKey: 'yuruiUser',
    homeHref: 'home.html',
    requireLogin: true,
    pointsRefreshMs: 5000
  };

  var config = Object.assign({}, DEFAULT_CONFIG, window.MemberCenterConfig || {});
  var DATA_PATHS = {
    users: joinPath(config.dataBasePath, 'users.json'),
    orders: joinPath(config.dataBasePath, 'orders.json'),
    rentalOrders: joinPath(config.dataBasePath, 'rentalOrders.json'),
    products: joinPath(config.dataBasePath, 'products.json')
  };

  var REWARD_POINT_RATE = 0.1;
  var REVIEW_STORAGE_KEY = 'member_center_reviews';
  var MOCK_ORDERS_STORAGE_KEY = 'mockOrders';
  var MOCK_USER_POINT_DELTAS_STORAGE_KEY = 'mockUserPointDeltas';
  var DEFAULT_PRODUCT_IMAGE_FALLBACK = '../assets/images/products/prod-001/main.webp';

  var state = {
    root: null,
    initialized: false,
    user: null,
    users: [],
    orders: [],
    products: [],
    productsById: new Map(),
    productImageFallback: '',
    rentalOrders: [],
    activeFilters: {
      purchase: 'all',
      rental: 'all'
    },
    review: {
      orderId: null,
      itemName: '',
      rating: 0
    },
    pointsTimer: null,
    loginTimer: null
  };

  /** 重點：購買紀錄狀態沿用先前 data/orders.json 合約，cod 併入 paid，processing 併入 unshipped。 */
  var PURCHASE_ORDER_STATUS_META = [
    { value: 'paid', label: '待付款', cls: 'status--pending' },
    { value: 'unpaid', label: '已付款', cls: 'status--upcoming' },
    { value: 'unshipped', label: '待出貨', cls: 'status--pending' },
    { value: 'shipped', label: '已出貨', cls: 'status--upcoming' },
    { value: 'delivered', label: '已完成', cls: 'status--done' },
    { value: 'returned', label: '已退貨', cls: 'status--cancelled' },
    { value: 'cancelled', label: '已取消', cls: 'status--cancelled' }
  ];

  /** 重點：預約與租借紀錄狀態沿用 data/rentalOrders.json，舊狀態由 aliases 統一轉換。 */
  var RENTAL_ORDER_STATUS_META = [
    { value: 'refunded', label: '已退款', cls: 'status--cancelled' },
    { value: 'paid', label: '已付款', cls: 'status--upcoming' },
    { value: 'pending', label: '待確認', cls: 'status--pending' },
    { value: 'confirmed', label: '已確認', cls: 'status--upcoming' },
    { value: 'completed', label: '已完成', cls: 'status--done' },
    { value: 'cancelled', label: '已取消', cls: 'status--cancelled' }
  ];

  var PURCHASE_ORDER_ALIASES = {
    processing: 'unshipped',
    cod: 'paid'
  };

  var RENTAL_ORDER_ALIASES = {
    processing: 'pending',
    shipped: 'confirmed',
    delivered: 'completed'
  };

  var PURCHASE_META_MAP = toMetaMap(PURCHASE_ORDER_STATUS_META);
  var RENTAL_META_MAP = toMetaMap(RENTAL_ORDER_STATUS_META);
  var PREFERENCE_STYLE_VALUES = ['glamping', 'backpacking', 'family', 'solo', 'hiking', 'car-camping', 'ultralight', 'base-camp'];
  var PREFERENCE_EQUIPMENT_VALUES = ['tent', 'sleeping-bag', 'backpack', 'cooking', 'lighting', 'clothing', 'chair', 'navigation', 'safety', 'photography'];
  var PURCHASE_TAB_FILTERS = ['all', 'unshipped', 'shipped', 'returned'];
  var RENTAL_TAB_FILTERS = ['all', 'pending', 'confirmed', 'refunded'];
  var BOOTSTRAP_ICON_CLASS_PATTERN = /^bi-[a-z0-9-]+$/;
  var EMOJI_ICON_PATTERN = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u;
  var NOTIFICATION_TYPE_ICON_MAP = {
    order: 'bi-box-seam',
    promo: 'bi-tag',
    coupon: 'bi-tag',
    shipping: 'bi-truck',
    security: 'bi-shield-lock',
    account: 'bi-person',
    system: 'bi-bell'
  };

  function joinPath(base, fileName) {
    return String(base || '').replace(/\/+$/, '') + '/' + fileName;
  }

  function toMetaMap(items) {
    return items.reduce(function (map, item) {
      map[item.value] = item;
      return map;
    }, {});
  }

  function safeJsonParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function normalizeIdentifier(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function resolveDataAssetPath(path) {
    var value = normalizeIdentifier(path);
    if (!value) return '';
    if (/^(?:https?:)?\/\//i.test(value) || value.indexOf('data:') === 0 || value.indexOf('blob:') === 0) {
      return value;
    }
    if (value.charAt(0) === '/') return value;

    try {
      var dataBaseUrl = new URL(joinPath(config.dataBasePath || '../data', ''), window.location.href);
      var resolved = new URL(value, dataBaseUrl);
      return resolved.pathname + resolved.search + resolved.hash;
    } catch (_error) {
      return value;
    }
  }

  function getItemProductId(item) {
    if (!item || typeof item !== 'object') return '';
    return normalizeIdentifier(item.productId || item.id || item.product_id);
  }

  function getProductPrimaryImage(product) {
    if (!product || typeof product !== 'object') return '';
    var image = normalizeIdentifier(product.image || product.imageUrl || product.thumbnail);
    if (!image && Array.isArray(product.images) && product.images.length > 0) {
      image = normalizeIdentifier(product.images[0]);
    }
    return resolveDataAssetPath(image);
  }

  function buildProductsById(products) {
    return (Array.isArray(products) ? products : []).reduce(function (map, product) {
      var productId = normalizeIdentifier(product && (product.id || product.productId || product.product_id));
      if (productId) map.set(productId, product);
      return map;
    }, new Map());
  }

  function getOrderImageFallback() {
    if (state.productImageFallback) return state.productImageFallback;

    var firstCatalogImage = getProductPrimaryImage(state.products[0]);
    state.productImageFallback = firstCatalogImage || resolveDataAssetPath(DEFAULT_PRODUCT_IMAGE_FALLBACK);
    return state.productImageFallback;
  }

  function resolveOrderItemImage(item) {
    var productId = getItemProductId(item);
    var product = productId ? state.productsById.get(productId) : null;
    var latestProductImage = getProductPrimaryImage(product);
    var snapshotImage = resolveDataAssetPath(item && item.image);

    return latestProductImage || snapshotImage || getOrderImageFallback();
  }

  /** 重點：安全讀取 localStorage 陣列，避免 checkout 暫存資料壞掉時影響會員中心。 */
  function readStorageArray(key) {
    var value = safeJsonParse(localStorage.getItem(key), []);
    return Array.isArray(value) ? value : [];
  }

  /** 重點：data/orders.json 與 mockOrders 以 id 合併，讓結帳後的新訂單可即時出現在會員中心。 */
  function mergeOrders(baseOrders, mockOrders) {
    var orderMap = new Map();
    (Array.isArray(baseOrders) ? baseOrders : [])
      .concat(Array.isArray(mockOrders) ? mockOrders : [])
      .forEach(function (order) {
        if (order && order.id) orderMap.set(order.id, order);
      });
    return Array.from(orderMap.values());
  }

  /** 重點：cardPoints 只加總 delivered 的 mockOrders，避免 checkout 新增 unshipped 訂單時先發點數。 */
  function getDeliveredMockOrderPointDeltas() {
    return readStorageArray(MOCK_ORDERS_STORAGE_KEY).reduce(function (deltas, order) {
      if (normalizeFilterValue('purchase', order && order.status) !== 'delivered') return deltas;

      var userId = order.userId || 'user-001';
      deltas[userId] = (Number(deltas[userId]) || 0) + getOrderRewardPoints(order);
      return deltas;
    }, {});
  }

  /** 重點：users.json points 搭配 delivered 訂單暫存點數，只有已完成訂單才更新會員卡點數。 */
  function applyUserPointDeltas(users) {
    var deltas = getDeliveredMockOrderPointDeltas();
    return (Array.isArray(users) ? users : []).map(function (user) {
      return Object.assign({}, user, {
        points: (Number(user.points) || 0) + (Number(deltas[user.id]) || 0)
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getNotificationFallbackIconClass(type) {
    var normalizedType = normalizeIdentifier(type).toLowerCase();
    return NOTIFICATION_TYPE_ICON_MAP[normalizedType] || 'bi-bell';
  }

  function isEmojiIcon(value) {
    var icon = normalizeIdentifier(value);
    return Boolean(icon) && EMOJI_ICON_PATTERN.test(icon);
  }

  /** 重點：通知圖示只允許安全的 bi-* class，其他值改走 emoji 或 type fallback。 */
  function getNotificationIconHtml(notification) {
    var icon = normalizeIdentifier(notification && notification.icon);
    if (BOOTSTRAP_ICON_CLASS_PATTERN.test(icon)) {
      return '<div class="notif-item__icon" aria-hidden="true"><i class="bi ' + icon + '" aria-hidden="true"></i></div>';
    }

    if (isEmojiIcon(icon)) {
      return '<div class="notif-item__icon notif-item__icon--emoji" aria-hidden="true">' + escapeHtml(icon) + '</div>';
    }

    var fallbackClass = getNotificationFallbackIconClass(notification && notification.type);
    return '<div class="notif-item__icon" aria-hidden="true"><i class="bi ' + fallbackClass + '" aria-hidden="true"></i></div>';
  }

  function showMcToast(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info');
      return;
    }
    console.log(message);
  }

  async function fetchJson(path, fallback) {
    try {
      var response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      console.error('會員中心資料讀取失敗：' + path, error);
      return fallback;
    }
  }

  function formatMoney(value) {
    return 'NT$ ' + Number(value || 0).toLocaleString('zh-TW');
  }

  /** 重點：升等進度只採計 delivered 購買訂單 subtotal，讓已完成訂單才會推進會員等級。 */
  function getDeliveredPurchaseSubtotal() {
    return state.orders.reduce(function (total, order) {
      if (normalizeFilterValue('purchase', order && order.status) !== 'delivered') return total;
      return total + (Number(order.subtotal) || 0);
    }, 0);
  }

  /** 重點：依目前 delivered subtotal 更新會員卡進度條與距下一級文字。 */
  function renderTierProgress(user) {
    var nextTierSpend = Number(user && user.nextTierSpend) || 0;
    var totalSpend = getDeliveredPurchaseSubtotal();
    var remaining = Math.max(nextTierSpend - totalSpend, 0);
    var progress = nextTierSpend > 0 ? Math.min(Math.round((totalSpend / nextTierSpend) * 100), 100) : 0;
    var progressBar = document.getElementById('tierProgressBar');

    setText('nextTierSpend', formatMoney(remaining));
    if (progressBar) progressBar.style.width = progress + '%';
  }

  function formatDate(value) {
    return value || '--';
  }

  function getStoredUserFromKey(key) {
    return key ? safeJsonParse(localStorage.getItem(key), null) : null;
  }

  function getLoginUser() {
    if (window.AppState && window.AppState.isLoggedIn && window.AppState.currentUser) {
      return window.AppState.currentUser;
    }

    var keys = [
      config.authStorageKey,
      config.fallbackAuthStorageKey,
      'currentUser',
      'yuruiUser'
    ].filter(Boolean);

    for (var index = 0; index < keys.length; index += 1) {
      var user = getStoredUserFromKey(keys[index]);
      if (user) return user;
    }

    if (localStorage.getItem('isLoggedIn') === 'true') {
      return { id: 'user-001' };
    }

    return null;
  }

  function isLoggedIn() {
    return config.requireLogin === false || Boolean(getLoginUser());
  }

  function getSavedProfile() {
    return safeJsonParse(localStorage.getItem('yurui_profile'), {});
  }

  function getCurrentMemberId() {
    var loginUser = getLoginUser();
    return (loginUser && (loginUser.id || loginUser.userId)) || 'user-001';
  }

  function selectUser(users) {
    var safeUsers = Array.isArray(users) ? users : [];
    var loginUser = getLoginUser() || {};
    var loginId = loginUser.id || loginUser.userId;
    var loginEmail = loginUser.email;

    return safeUsers.find(function (user) {
      return user.id === loginId || (loginEmail && user.email === loginEmail);
    }) || safeUsers.find(function (user) {
      return user.id === 'user-001';
    }) || safeUsers[0] || null;
  }

  function normalizePreferenceValues(preferences) {
    if (Array.isArray(preferences)) return preferences.filter(Boolean);
    if (typeof preferences === 'string' && preferences) return [preferences];
    if (!preferences || typeof preferences !== 'object') return [];

    return []
      .concat(preferences.styles || [])
      .concat(preferences.equipment || [])
      .filter(Boolean);
  }

  function getPreferenceGroup(value) {
    if (PREFERENCE_STYLE_VALUES.includes(value)) return 'styles';
    if (PREFERENCE_EQUIPMENT_VALUES.includes(value)) return 'equipment';
    return null;
  }

  function uniqueValues(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
  }

  function normalizePreferenceObject(preferences) {
    var normalized = { styles: [], equipment: [] };

    // 重點：舊資料可能是攤平陣列，新資料則固定拆回 styles / equipment。
    normalizePreferenceValues(preferences).forEach(function (value) {
      var group = getPreferenceGroup(value);
      if (group) normalized[group].push(value);
    });

    normalized.styles = uniqueValues(normalized.styles);
    normalized.equipment = uniqueValues(normalized.equipment);
    return normalized;
  }

  function getStoredPreferenceObject() {
    return normalizePreferenceObject(getStoredPreferenceValues());
  }

  function getActivePreferenceObject() {
    var preferences = { styles: [], equipment: [] };

    document.querySelectorAll('#prefTags .survey-tag.active').forEach(function (tag) {
      var group = getPreferenceGroup(tag.dataset.value);
      if (group) preferences[group].push(tag.dataset.value);
    });

    preferences.styles = uniqueValues(preferences.styles);
    preferences.equipment = uniqueValues(preferences.equipment);
    return preferences;
  }

  function persistPreferenceObject(preferences) {
    var normalized = normalizePreferenceObject(preferences);
    var savedProfile = getSavedProfile();

    // 重點：同步保存分類結構，避免重新渲染時把剛切換的 active 狀態復原。
    savedProfile.preferences = normalized;
    localStorage.setItem('yurui_profile', JSON.stringify(savedProfile));
    localStorage.setItem('preferences', JSON.stringify(normalized));

    if (window.AppState) {
      window.AppState.preferences = normalized;
      if (typeof window.saveAppState === 'function') window.saveAppState();
    }

    return normalized;
  }

  function updatePreferenceObjectValue(preferences, value, isActive) {
    var normalized = normalizePreferenceObject(preferences);
    var group = getPreferenceGroup(value);
    if (!group) return normalized;

    // 重點：active 被取消就從對應陣列移除，新啟用則新增到對應陣列。
    normalized[group] = normalized[group].filter(function (item) { return item !== value; });
    if (isActive) normalized[group].push(value);
    normalized[group] = uniqueValues(normalized[group]);
    return normalized;
  }

  function getStoredPreferenceValues() {
    var appPrefs = normalizePreferenceValues(window.AppState && window.AppState.preferences);
    if (appPrefs.length) return appPrefs;

    var profilePrefs = normalizePreferenceValues(getSavedProfile().preferences);
    if (profilePrefs.length) return profilePrefs;

    var localPrefs = normalizePreferenceValues(safeJsonParse(localStorage.getItem('preferences'), {}));
    if (localPrefs.length) return localPrefs;

    return normalizePreferenceValues(state.user && state.user.preferences);
  }

  function normalizeFilterValue(orderType, value) {
    var aliases = orderType === 'rental' ? RENTAL_ORDER_ALIASES : PURCHASE_ORDER_ALIASES;
    return aliases[value] || value;
  }

  function getStatusInfo(status) {
    var normalized = normalizeFilterValue('purchase', status);
    return PURCHASE_META_MAP[normalized] || { value: normalized, label: normalized || '未設定', cls: 'status--pending' };
  }

  function getRentalStatusInfo(status) {
    var normalized = normalizeFilterValue('rental', status);
    return RENTAL_META_MAP[normalized] || { value: normalized, label: normalized || '未設定', cls: 'status--pending' };
  }

  function orderMatchesFilter(order, filter, orderType) {
    if (!filter || filter === 'all') return true;

    var normalizedStatus = normalizeFilterValue(orderType, order.status);
    var normalizedPayment = normalizeFilterValue(orderType, order.paymentStatus);

    // 重點：待付款篩選可吃 paymentStatus，但已退貨訂單不可被帶進待付款列表。
    if (orderType === 'purchase' && filter === 'paid' && normalizedStatus === 'returned') {
      return false;
    }

    return normalizedStatus === filter || normalizedPayment === filter;
  }

  function buildFilterDefinitions(orderType, orders) {
    var meta = orderType === 'rental' ? RENTAL_ORDER_STATUS_META : PURCHASE_ORDER_STATUS_META;
    var allowed = orderType === 'rental' ? RENTAL_TAB_FILTERS : PURCHASE_TAB_FILTERS;

    // 重點：訂單可保留更多 status，但 tab 只渲染需求指定的篩選選項。
    return allowed.map(function (value) {
      if (value === 'all') return { value: 'all', label: '全部', cls: '' };
      return meta.find(function (item) { return item.value === value; }) || { value: value, label: value, cls: 'status--pending' };
    });
  }

  function renderOrderStatusTabs(orderType, orders) {
    var container = document.getElementById(orderType === 'rental' ? 'rentalOrderStatusTabs' : 'purchaseOrderStatusTabs');
    if (!container) return;

    var filters = buildFilterDefinitions(orderType, orders);
    var active = filters.some(function (item) { return item.value === state.activeFilters[orderType]; })
      ? state.activeFilters[orderType]
      : 'all';

    state.activeFilters[orderType] = active;

    // 重點：篩選標籤完全由 JSON 狀態動態產生，保留兩個會員中心一致的預設全部選項。
    container.innerHTML = filters.map(function (item) {
      var isActive = item.value === active;
      return '<button class="order-status-tab' + (isActive ? ' active' : '') + '"'
        + ' type="button" data-filter="' + escapeHtml(item.value) + '" aria-pressed="' + isActive + '">'
        + escapeHtml(item.label)
        + '</button>';
    }).join('');
  }

  function buildItemSummary(items) {
    var safeItems = Array.isArray(items) ? items : [];
    if (safeItems.length === 0) return '未命名商品';
    if (safeItems.length === 1) return safeItems[0].name || '未命名商品';
    return (safeItems[0].name || '未命名商品') + ' 等 ' + safeItems.length + ' 件';
  }

  function buildThumbsHtml(items) {
    var safeItems = Array.isArray(items) ? items : [];
    if (safeItems.length === 0) return '';
    var fallbackImage = getOrderImageFallback();

    return '<div class="rec-item__thumbs">'
      + safeItems.slice(0, 3).map(function (item) {
        var image = resolveOrderItemImage(item);
        return '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.name || '商品') + '" class="rec-item__thumb"'
          + ' onerror="this.onerror=null; this.src=\'' + escapeHtml(fallbackImage) + '\'">';
      }).join('')
      + (safeItems.length > 3 ? '<span class="rec-item__more">+' + (safeItems.length - 3) + '</span>' : '')
      + '</div>';
  }

  function getStoredReviews() {
    return safeJsonParse(localStorage.getItem(REVIEW_STORAGE_KEY), []);
  }

  function isOrderReviewed(order) {
    if (order.reviewed || order.review) return true;
    return getStoredReviews().some(function (review) {
      return review.orderId === order.id;
    });
  }

  function canReviewOrder(order) {
    return Boolean(order && order.canReview && normalizeFilterValue('purchase', order.status) === 'delivered' && !isOrderReviewed(order));
  }

  function renderPurchaseOrders() {
    var container = document.getElementById('ordersList');
    if (!container) return;

    var filtered = state.orders.filter(function (order) {
      return orderMatchesFilter(order, state.activeFilters.purchase, 'purchase');
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div class="rec-empty"><div class="rec-empty__icon"><i class="bi bi-bag-x"></i></div>目前沒有符合條件的購買紀錄</div>';
      return;
    }

    container.innerHTML = filtered.map(function (order) {
      var status = getStatusInfo(order.status);
      var itemName = buildItemSummary(order.items);
      var reviewButton = canReviewOrder(order)
        ? '<button class="rec-item__detail-btn" type="button" data-review-order="' + escapeHtml(order.id) + '" data-review-item="' + escapeHtml((order.items && order.items[0] && order.items[0].name) || itemName) + '">寫評價</button>'
        : '';

      return '<div class="rec-item" data-order-id="' + escapeHtml(order.id) + '">'
        + '<div class="rec-item__info">'
        + '<div class="rec-item__title">' + escapeHtml(itemName) + '</div>'
        + '<div class="rec-item__meta">' + escapeHtml(order.orderNumber || order.id) + ' ｜ ' + escapeHtml(formatDate(order.createdAt)) + ' ｜ ' + ((order.items || []).length || 0) + ' 件商品</div>'
        + buildThumbsHtml(order.items)
        + '</div>'
        + '<div class="rec-item__right">'
        + '<div class="rec-item__amount">' + formatMoney(order.total) + '</div>'
        + '<span class="rec-item__status ' + status.cls + '">' + escapeHtml(status.label) + '</span>'
        + '<button class="rec-item__detail-btn" type="button" data-order-detail="' + escapeHtml(order.id) + '">查看明細</button>'
        + reviewButton
        + '</div>'
        + '</div>';
    }).join('');
  }

  function renderRentalOrders() {
    var container = document.getElementById('rentalOrdersList');
    if (!container) return;

    var filtered = state.rentalOrders.filter(function (order) {
      return orderMatchesFilter(order, state.activeFilters.rental, 'rental');
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div class="rec-empty"><div class="rec-empty__icon"><i class="bi bi-tent-x"></i></div>目前沒有符合條件的預約與租借紀錄</div>';
      return;
    }

    container.innerHTML = filtered.map(function (order) {
      var status = getRentalStatusInfo(order.status);
      return '<div class="rec-item" data-rental-order-id="' + escapeHtml(order.id) + '">'
        + '<div class="rec-item__info">'
        + '<div class="rec-item__title">' + escapeHtml(buildItemSummary(order.items)) + '</div>'
        + '<div class="rec-item__meta">' + escapeHtml(order.orderNumber || order.id) + ' ｜ ' + escapeHtml(order.rentalStart || '--') + ' - ' + escapeHtml(order.rentalEnd || '--') + ' ｜ ' + escapeHtml(order.pickupStore || '--') + ' / ' + escapeHtml(order.returnStore || '--') + '</div>'
        + buildThumbsHtml(order.items)
        + '</div>'
        + '<div class="rec-item__right">'
        + '<div class="rec-item__amount">' + formatMoney(order.total) + '</div>'
        + '<span class="rec-item__status ' + status.cls + '">' + escapeHtml(status.label) + '</span>'
        + '<button class="rec-item__detail-btn" type="button" data-rental-detail="' + escapeHtml(order.id) + '">查看明細</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function calculateOrderRewardPoints(subtotal) {
    return Math.ceil((Number(subtotal) || 0) * REWARD_POINT_RATE);
  }

  function getOrderRewardPoints(order) {
    var points = Number(order && order.points);
    return Number.isFinite(points) ? points : calculateOrderRewardPoints(order && order.subtotal);
  }

  function getOrderCoupons(order) {
    if (Array.isArray(order.coupons)) return order.coupons;
    return order && order.coupon ? [order.coupon] : [];
  }

  function formatOrderCoupon(coupon) {
    var code = coupon.code || '未命名折扣';
    if (coupon.type === 'percent') {
      var amountText = coupon.amount ? '，折抵 ' + formatMoney(coupon.amount) : '';
      return code + '（' + coupon.discount + '%' + amountText + '）';
    }
    return code + '（折抵 ' + formatMoney(coupon.amount || coupon.discount || 0) + '）';
  }

  function buildOrderCouponRow(order) {
    var coupons = getOrderCoupons(order);
    if (!coupons.length) return '';

    return '<div class="bk-detail-row bk-detail-row--success">'
      + '<span>使用折價券</span><span>' + coupons.map(function (coupon) {
        return escapeHtml(formatOrderCoupon(coupon));
      }).join('<br>') + '</span>'
      + '</div>';
  }

  function buildOrderPointsRow(order) {
    return '<div class="bk-detail-row bk-detail-row--success">'
      + '<span>回饋點數</span><span>' + getOrderRewardPoints(order).toLocaleString('zh-TW') + ' 點</span>'
      + '</div>';
  }

  function getPaymentLabel(payment) {
    var map = {
      'credit-card': '信用卡',
      'line-pay': 'LINE Pay',
      cod: '貨到付款'
    };
    return map[payment] || payment || '未設定';
  }

  function openDetailModal(title, bodyHtml) {
    var titleEl = document.getElementById('orderDetailTitle');
    var bodyEl = document.getElementById('orderDetailBody');
    var overlay = document.getElementById('orderDetailOverlay');
    if (!titleEl || !bodyEl || !overlay) return;

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeDetailModal() {
    var overlay = document.getElementById('orderDetailOverlay');
    if (overlay) overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  window.openOrderDetail = function (orderId) {
    var order = state.orders.find(function (item) { return item.id === orderId; });
    if (!order) return;

    var status = getStatusInfo(order.status);
    var fallbackImage = getOrderImageFallback();
    var itemsHtml = (order.items || []).map(function (item) {
      var quantity = Number(item.quantity || 0);
      var subtotal = Number(item.price || 0) * quantity;
      var image = resolveOrderItemImage(item);
      return '<div class="bk-order-item-row">'
        + '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.name || '商品') + '" class="bk-order-item-img"'
        + ' onerror="this.onerror=null; this.src=\'' + escapeHtml(fallbackImage) + '\'">'
        + '<div>'
        + '<div class="bk-order-item-name">' + escapeHtml(item.name || '未命名商品') + '</div>'
        + '<div class="bk-order-item-qty">x ' + quantity + '，' + formatMoney(subtotal) + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    // 重點：購買明細同時顯示 coupons、discount、points，資料全從 data/orders.json 取得。
    openDetailModal('訂單詳情 ' + (order.orderNumber || order.id), ''
      + '<div class="bk-detail-head">'
      + '<div class="bk-detail-date">' + escapeHtml(formatDate(order.createdAt)) + '</div>'
      + '<span class="bk-status-badge ' + status.cls + '">' + escapeHtml(status.label) + '</span>'
      + '</div>'
      + '<div class="bk-detail-section-title"><i class="bi bi-receipt"></i> 商品明細</div>'
      + itemsHtml
      + '<hr class="bk-detail-sep">'
      + '<div class="bk-detail-rows">'
      + '<div class="bk-detail-row"><span>商品小計</span><span>' + formatMoney(order.subtotal) + '</span></div>'
      + '<div class="bk-detail-row"><span>運費</span><span>' + (Number(order.shippingFee) === 0 ? '免費' : formatMoney(order.shippingFee)) + '</span></div>'
      + (order.discount ? '<div class="bk-detail-row bk-detail-row--danger"><span>折扣</span><span>- ' + formatMoney(order.discount) + '</span></div>' : '')
      + buildOrderCouponRow(order)
      + '<div class="bk-detail-row bk-detail-row--total"><span>訂單總計</span><span>' + formatMoney(order.total) + '</span></div>'
      + buildOrderPointsRow(order)
      + '</div>'
      + '<div class="bk-detail-note"><i class="bi bi-credit-card"></i> 付款方式：' + escapeHtml(getPaymentLabel(order.payment)) + '</div>'
      + (order.shippingAddress ? '<div class="bk-detail-note"><i class="bi bi-geo-alt"></i> 配送地址：' + escapeHtml(order.shippingAddress) + '</div>' : '')
      + (order.trackingNumber ? '<div class="bk-detail-note"><i class="bi bi-truck"></i> 物流追蹤：' + escapeHtml(order.trackingNumber) + '</div>' : '')
      // 重點：checkout 寫入的 userNote 只在有內容時顯示，避免舊訂單產生空白備註列。
      + (order.userNote ? '<div class="bk-detail-note"><i class="bi bi-chat-left-text"></i> 使用者備註：' + escapeHtml(order.userNote) + '</div>' : '')
      + buildLineSupportLink('詢問訂單'));
  };

  window.openRentalOrderDetail = function (orderId) {
    var order = state.rentalOrders.find(function (item) { return item.id === orderId; });
    if (!order) return;

    var status = getRentalStatusInfo(order.status);
    var fallbackImage = getOrderImageFallback();
    var itemsHtml = (order.items || []).map(function (item) {
      var quantity = Number(item.quantity || 0);
      var subtotal = Number(item.price || 0) * quantity;
      var image = resolveOrderItemImage(item);
      return '<div class="bk-order-item-row">'
        + '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.name || '商品') + '" class="bk-order-item-img"'
        + ' onerror="this.onerror=null; this.src=\'' + escapeHtml(fallbackImage) + '\'">'
        + '<div>'
        + '<div class="bk-order-item-name">' + escapeHtml(item.name || '未命名租借品') + '</div>'
        + '<div class="bk-order-item-qty">x ' + quantity + '，' + formatMoney(subtotal) + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    // 重點：租借明細補齊租期、押金、取還門市與付款方式，供兩個會員中心共用。
    openDetailModal('預約與租借詳情 ' + (order.orderNumber || order.id), ''
      + '<div class="bk-detail-head">'
      + '<div class="bk-detail-date">' + escapeHtml(formatDate(order.createdAt)) + '</div>'
      + '<span class="bk-status-badge ' + status.cls + '">' + escapeHtml(status.label) + '</span>'
      + '</div>'
      + '<div class="bk-detail-section-title"><i class="bi bi-tent"></i> 租借品項</div>'
      + itemsHtml
      + '<hr class="bk-detail-sep">'
      + '<div class="bk-detail-rows">'
      + '<div class="bk-detail-row"><span>租借費用</span><span>' + formatMoney(order.subtotal) + '</span></div>'
      + '<div class="bk-detail-row"><span>押金</span><span>' + formatMoney(order.deposit) + '</span></div>'
      + '<div class="bk-detail-row bk-detail-row--total"><span>訂單總計</span><span>' + formatMoney(order.total) + '</span></div>'
      + '</div>'
      + '<div class="bk-detail-note">租借期間：' + escapeHtml(order.rentalStart || '--') + ' - ' + escapeHtml(order.rentalEnd || '--') + '</div>'
      + '<div class="bk-detail-note">取貨 / 還貨：' + escapeHtml(order.pickupStore || '--') + ' / ' + escapeHtml(order.returnStore || '--') + '</div>'
      + '<div class="bk-detail-note"><i class="bi bi-credit-card"></i> 付款方式：' + escapeHtml(getPaymentLabel(order.payment)) + '</div>'
      + (order.cancelReason ? '<div class="bk-detail-note bk-detail-row--danger">取消原因：' + escapeHtml(order.cancelReason) + '</div>' : '')
      + buildLineSupportLink('詢問租借'));
  };

  window.openMcOrderDetail = window.openOrderDetail;
  window.openMcBookingDetail = window.openRentalOrderDetail;

  function buildLineSupportLink(label) {
    return '<div class="bk-detail-support">'
      + '<a href="https://line.me/R/ti/p/@yuruicamp" target="_blank" rel="noopener">'
      + '<i class="bi bi-chat-dots"></i> 使用 LINE ' + escapeHtml(label)
      + '</a>'
      + '</div>';
  }

  function renderMemberRewardPoints(points) {
    var pointsEl = document.getElementById('cardPoints');
    if (!pointsEl) return;

    var safePoints = Number.isFinite(Number(points)) ? Number(points) : 0;
    pointsEl.textContent = '回饋點數：' + safePoints.toLocaleString('zh-TW') + ' 點';
  }

  async function refreshMemberRewardPoints() {
    // 重點：點數以 users.json 為唯一顯示來源，讓結帳後更新 JSON 時會員卡可定時同步。
    var users = applyUserPointDeltas(await fetchJson(DATA_PATHS.users, []));
    var user = selectUser(users);
    state.users = users;
    state.user = user || state.user;
    renderMemberRewardPoints(state.user && state.user.points);
  }

  function initMemberRewardPoints() {
    renderMemberRewardPoints(state.user && state.user.points);
    window.clearInterval(state.pointsTimer);
    state.pointsTimer = window.setInterval(refreshMemberRewardPoints, Number(config.pointsRefreshMs) || 5000);
  }

  function applyProfileData() {
    var user = state.user || {};
    var saved = getSavedProfile();
    var loginUser = getLoginUser() || {};
    var displayName = saved.name || loginUser.name || user.name || '露友';
    var displayEmail = loginUser.email || user.email || saved.email || 'camper@example.com';

    setText('mcAvatar', displayName.charAt(0).toUpperCase());
    setText('mcName', displayName);
    setText('mcEmail', displayEmail);
    setText('cardName', displayName);
    setText('cardTier', user.tierName || '探險家');
    setText('cardSince', '加入日期：' + (user.joinDate || user.joinedAt || '2026-01-01'));
    renderTierProgress(user);

    setInputValue('profileName', saved.name || user.name || displayName);
    setInputValue('profilePhone', saved.phone || user.phone || '0912-345-678');
    setInputValue('profileEmail', displayEmail);
    setInputValue('profileBirthday', user.birthday || saved.birthday || '1990-06-15');
    setInputValue('profileAddress', saved.address || user.address || '台北市信義區信義路五段 100 號');

    renderMemberRewardPoints(user.points);
    syncPreferenceTags(getStoredPreferenceValues());
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setInputValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  function syncPreferenceTags(preferences) {
    var selected = new Set(normalizePreferenceValues(preferences));
    document.querySelectorAll('#prefTags .survey-tag').forEach(function (tag) {
      tag.classList.toggle('active', selected.has(tag.dataset.value));
    });
  }

  window.syncMemberPreferenceTags = function (preferences) {
    var selectedPrefs = normalizePreferenceObject(preferences);
    syncPreferenceTags(selectedPrefs);

    // 重點：外部問卷同步進來時，也保留 styles / equipment 分類結構。
    persistPreferenceObject(selectedPrefs);
  };

  function initPreferenceTags() {
    syncPreferenceTags(getStoredPreferenceValues());
    document.querySelectorAll('#prefTags .survey-tag').forEach(function (tag) {
      if (tag.dataset.prefToggleBound === 'true') return;
      tag.dataset.prefToggleBound = 'true';
      tag.addEventListener('click', function () {
        var willBeActive = !tag.classList.contains('active');
        var preferences = updatePreferenceObjectValue(getStoredPreferenceObject(), tag.dataset.value, willBeActive);

        // 重點：先寫入資料再更新畫面，避免下一次重繪把 active 狀態復原。
        persistPreferenceObject(preferences);
        syncPreferenceTags(preferences);
      });
    });
  }

  function getInputValue(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function initProfileForm() {
    var form = document.getElementById('profileForm');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var selectedPreferences = getActivePreferenceObject();
      var profileData = {
        name: getInputValue('profileName'),
        phone: getInputValue('profilePhone'),
        email: (state.user && state.user.email) || (getLoginUser() && getLoginUser().email) || getInputValue('profileEmail'),
        birthday: (state.user && state.user.birthday) || getInputValue('profileBirthday'),
        address: getInputValue('profileAddress'),
        preferences: selectedPreferences
      };

      // 重點：Email 與生日為唯讀資料，儲存時保留原始值，避免前端表單覆寫會員識別資料。
      localStorage.setItem('yurui_profile', JSON.stringify(profileData));
      updateLoginStorage(profileData);
      persistPreferenceObject(selectedPreferences);

      if (window.AppState) {
        window.AppState.preferences = selectedPreferences;
        if (typeof window.saveAppState === 'function') window.saveAppState();
      }

      applyProfileData();
      showMcToast('個人資料已儲存', 'success');
    });
  }

  function updateLoginStorage(profileData) {
    var keys = [config.authStorageKey, config.fallbackAuthStorageKey, 'currentUser', 'yuruiUser'].filter(Boolean);
    keys.forEach(function (key) {
      var user = getStoredUserFromKey(key);
      if (!user) return;
      user.name = profileData.name || user.name;
      user.email = profileData.email || user.email;
      localStorage.setItem(key, JSON.stringify(user));
    });

    if (window.AppState && window.AppState.currentUser) {
      window.AppState.currentUser.name = profileData.name || window.AppState.currentUser.name;
      window.AppState.currentUser.email = profileData.email || window.AppState.currentUser.email;
      if (typeof window.updateNavbarLoginState === 'function') window.updateNavbarLoginState();
    }
  }

  function isCouponExpired(coupon) {
    if (coupon.used) return true;
    if (!coupon.expiry) return false;
    var expiry = new Date(coupon.expiry + 'T23:59:59');
    return Number.isFinite(expiry.getTime()) && expiry < new Date();
  }

  function formatCoupon(coupon) {
    var isPercent = coupon.type === 'percent';
    var discountVal = isPercent ? coupon.discount + '%' : Number(coupon.discount || 0).toLocaleString('zh-TW');
    var discountUnit = isPercent ? 'OFF' : '元';
    var title = isPercent ? '會員折扣券' : '現金折抵券';
    var condition = coupon.minOrder ? '滿 NT$ ' + Number(coupon.minOrder).toLocaleString('zh-TW') + ' 可使用' : '不限金額';
    return {
      code: coupon.code,
      expired: isCouponExpired(coupon),
      discountVal: discountVal,
      discountUnit: discountUnit,
      title: title,
      condition: condition,
      expiry: coupon.expiry ? coupon.expiry + ' 到期' : '無期限'
    };
  }

  function renderCoupons() {
    var activeContainer = document.getElementById('activeCoupons');
    var expiredContainer = document.getElementById('expiredCoupons');
    if (!activeContainer || !expiredContainer) return;

    var coupons = ((state.user && state.user.coupons) || []).map(formatCoupon);
    var active = coupons.filter(function (coupon) { return !coupon.expired; });
    var expired = coupons.filter(function (coupon) { return coupon.expired; });

    activeContainer.innerHTML = active.length
      ? active.map(buildCouponHtml).join('')
      : '<div class="rec-empty">目前沒有可使用的折價券</div>';

    expiredContainer.innerHTML = expired.length
      ? expired.map(buildCouponHtml).join('')
      : '<div class="rec-empty">目前沒有已失效的折價券</div>';
  }

  function buildCouponHtml(coupon) {
    return '<div class="coupon-ticket' + (coupon.expired ? ' expired' : '') + '">'
      + '<div class="coupon-left">'
      + '<div class="coupon-discount-val">' + escapeHtml(coupon.discountVal) + '</div>'
      + '<div class="coupon-discount-unit">' + escapeHtml(coupon.discountUnit) + '</div>'
      + '</div>'
      + '<div class="coupon-sep"></div>'
      + '<div class="coupon-right">'
      + '<div class="coupon-title">' + escapeHtml(coupon.title) + '</div>'
      + '<div class="coupon-condition">' + escapeHtml(coupon.condition) + '</div>'
      + '<div class="coupon-expiry"><i class="bi bi-clock"></i> ' + escapeHtml(coupon.expiry) + '</div>'
      + '<div class="coupon-code-row">'
      + '<span class="coupon-code">' + escapeHtml(coupon.code) + '</span>'
      + (!coupon.expired ? '<button class="copy-btn" type="button" data-copy-coupon="' + escapeHtml(coupon.code) + '">複製</button>' : '')
      + '</div>'
      + '</div>'
      + '</div>';
  }

  window.copyMcCouponCode = function (code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code)
        .then(function () { showMcToast('已複製折扣碼：' + code, 'success'); })
        .catch(function () { fallbackCopy(code); });
      return;
    }
    fallbackCopy(code);
  };

  function fallbackCopy(code) {
    var el = document.createElement('textarea');
    el.value = code;
    el.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showMcToast('已複製折扣碼：' + code, 'success');
  }

  /** 重點：建立通知可辨識的訂單編號清單，讓訊息中的編號可導向對應明細。 */
  function getNotificationOrderTokens() {
    var tokens = [];
    state.orders.forEach(function (order) {
      [order.id, order.orderNumber].filter(Boolean).forEach(function (token) {
        tokens.push({ token: String(token), type: 'purchase', id: order.id });
      });
    });
    state.rentalOrders.forEach(function (order) {
      [order.id, order.orderNumber].filter(Boolean).forEach(function (token) {
        tokens.push({ token: String(token), type: 'rental', id: order.id });
      });
    });
    return tokens.sort(function (a, b) { return b.token.length - a.token.length; });
  }

  /** 重點：通知文字會保留原文順序，只將確定存在的訂單 / 預約編號轉成可點擊明細連結。 */
  function linkNotificationText(value) {
    var text = String(value == null ? '' : value);
    var tokens = getNotificationOrderTokens();
    var matches = [];

    tokens.forEach(function (item) {
      var start = text.indexOf(item.token);
      while (start !== -1) {
        var end = start + item.token.length;
        var overlaps = matches.some(function (match) {
          return start < match.end && end > match.start;
        });
        if (!overlaps) matches.push({ start: start, end: end, item: item });
        start = text.indexOf(item.token, end);
      }
    });

    if (!matches.length) return escapeHtml(text);

    matches.sort(function (a, b) { return a.start - b.start; });
    var html = '';
    var cursor = 0;
    matches.forEach(function (match) {
      html += escapeHtml(text.slice(cursor, match.start));
      html += '<button class="notif-item__link" type="button" data-notification-'
        + (match.item.type === 'rental' ? 'rental' : 'order')
        + '-detail="' + escapeHtml(match.item.id) + '">'
        + escapeHtml(text.slice(match.start, match.end))
        + '</button>';
      cursor = match.end;
    });
    return html + escapeHtml(text.slice(cursor));
  }

  function renderNotifications() {
    var container = document.getElementById('notificationList');
    if (!container) return;

    var notifications = (state.user && state.user.notifications) || [];
    if (!notifications.length) {
      container.innerHTML = '<div class="rec-empty">目前沒有通知</div>';
      return;
    }

    // 重點：通知讀取後只更新畫面內狀態，不回寫 JSON，避免靜態資料檔被瀏覽器直接改寫。
    container.innerHTML = notifications.map(function (notification) {
      var read = Boolean(notification.read);
      return '<div class="notif-item' + (read ? ' read' : '') + '" id="notif-' + escapeHtml(notification.id) + '" data-notif-id="' + escapeHtml(notification.id) + '">'
        + '<div class="notif-item__dot' + (read ? ' read' : '') + '"></div>'
        + getNotificationIconHtml(notification)
        + '<div class="notif-item__content">'
        + '<div class="notif-item__title">' + linkNotificationText(notification.title) + '</div>'
        + '<div class="notif-item__body">' + linkNotificationText(notification.message) + '</div>'
        + '<div class="notif-item__date">' + escapeHtml(notification.time) + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function renderRecentActivity() {
    var container = document.getElementById('recentActivity');
    if (!container) return;

    var activities = [];
    state.orders.slice(0, 3).forEach(function (order) {
      activities.push({
        date: order.createdAt,
        title: '訂單 ' + (order.orderNumber || order.id) + ' ' + getStatusInfo(order.status).label,
        type: 'purchase',
        id: order.id
      });
    });
    state.rentalOrders.slice(0, 2).forEach(function (order) {
      activities.push({
        date: order.createdAt,
        title: '預約與租借 ' + (order.orderNumber || order.id) + ' ' + getRentalStatusInfo(order.status).label,
        type: 'rental',
        id: order.id
      });
    });
    ((state.user && state.user.notifications) || []).slice(0, 2).forEach(function (notification) {
      activities.push({
        date: notification.time,
        title: notification.title
      });
    });

    activities.sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    if (!activities.length) {
      container.innerHTML = '<div class="rec-empty">目前沒有最近活動</div>';
      return;
    }

    container.innerHTML = activities.slice(0, 4).map(function (activity) {
      var detailAttr = activity.type === 'rental'
        ? ' data-notification-rental-detail="' + escapeHtml(activity.id) + '"'
        : (activity.type === 'purchase' ? ' data-notification-order-detail="' + escapeHtml(activity.id) + '"' : '');
      var titleHtml = detailAttr
        ? '<button class="mc-activity-item__title mc-activity-item__title--button" type="button"' + detailAttr + '>' + escapeHtml(activity.title) + '</button>'
        : '<div class="mc-activity-item__title">' + escapeHtml(activity.title) + '</div>';
      return '<div class="mc-activity-item">'
        + '<div>'
        + titleHtml
        + '<div class="mc-activity-item__date">' + escapeHtml(formatDate(activity.date)) + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function updateStats() {
    var activeCoupons = ((state.user && state.user.coupons) || []).filter(function (coupon) {
      return !isCouponExpired(coupon);
    }).length;
    var unread = ((state.user && state.user.notifications) || []).filter(function (item) {
      return !item.read;
    }).length;
    var pendingOrders = state.orders.filter(function (order) {
      return ['paid', 'unshipped', 'shipped'].includes(normalizeFilterValue('purchase', order.status));
    }).length;
    var upcomingRentals = state.rentalOrders.filter(function (order) {
      return ['paid', 'pending', 'confirmed'].includes(normalizeFilterValue('rental', order.status));
    }).length;

    setText('statOrders', String(pendingOrders));
    setText('statBookings', String(upcomingRentals));
    setText('statCoupons', String(activeCoupons));
    setText('statUnread', String(unread));
  }

  function initCouponTabs() {
    document.querySelectorAll('.rec-tab[data-coupon-tab]').forEach(function (tab) {
      if (tab.dataset.bound === 'true') return;
      tab.dataset.bound = 'true';
      tab.addEventListener('click', function () {
        var selected = tab.dataset.couponTab;
        document.querySelectorAll('.rec-tab[data-coupon-tab]').forEach(function (item) {
          item.classList.toggle('active', item.dataset.couponTab === selected);
        });
        var active = document.getElementById('activeCoupons');
        var expired = document.getElementById('expiredCoupons');
        if (active) active.style.display = selected === 'active' ? '' : 'none';
        if (expired) expired.style.display = selected === 'expired' ? '' : 'none';
      });
    });
  }

  function initOrderStatusTabs() {
    document.querySelectorAll('.order-status-tabs[data-order-status-tabs]').forEach(function (container) {
      if (container.dataset.bound === 'true') return;
      container.dataset.bound = 'true';

      container.addEventListener('click', function (event) {
        var tab = event.target.closest('.order-status-tab[data-filter]');
        if (!tab || !container.contains(tab)) return;

        var orderType = container.dataset.orderStatusTabs === 'rental' ? 'rental' : 'purchase';
        state.activeFilters[orderType] = tab.dataset.filter || 'all';

        if (orderType === 'rental') {
          renderOrderStatusTabs('rental', state.rentalOrders);
          renderRentalOrders();
          return;
        }

        renderOrderStatusTabs('purchase', state.orders);
        renderPurchaseOrders();
      });
    });
  }

  function initDynamicActionButtons() {
    if (document.body.dataset.memberCenterActionsBound === 'true') return;
    document.body.dataset.memberCenterActionsBound = 'true';

    // 重點：所有動態按鈕改用 data-* 事件代理，partial 被兩個頁面載入時不需要 inline onclick。
    document.addEventListener('click', function (event) {
      var purchaseBtn = event.target.closest('[data-order-detail]');
      if (purchaseBtn) {
        window.openOrderDetail(purchaseBtn.dataset.orderDetail);
        return;
      }

      var rentalBtn = event.target.closest('[data-rental-detail]');
      if (rentalBtn) {
        window.openRentalOrderDetail(rentalBtn.dataset.rentalDetail);
        return;
      }

      var reviewBtn = event.target.closest('[data-review-order]');
      if (reviewBtn) {
        window.openReviewModal(reviewBtn.dataset.reviewOrder, reviewBtn.dataset.reviewItem);
        return;
      }

      var copyBtn = event.target.closest('[data-copy-coupon]');
      if (copyBtn) {
        window.copyMcCouponCode(copyBtn.dataset.copyCoupon);
        return;
      }

      var notificationOrderBtn = event.target.closest('[data-notification-order-detail]');
      if (notificationOrderBtn) {
        openRecordDetailFromNotification('purchase', notificationOrderBtn.dataset.notificationOrderDetail);
        return;
      }

      var notificationRentalBtn = event.target.closest('[data-notification-rental-detail]');
      if (notificationRentalBtn) {
        openRecordDetailFromNotification('rental', notificationRentalBtn.dataset.notificationRentalDetail);
      }
    });
  }

  /** 重點：通知與最近活動點擊編號時，先切到紀錄分頁再開啟對應明細。 */
  function openRecordDetailFromNotification(orderType, orderId) {
    switchMemberPanel('records');
    switchRecordTab(orderType === 'rental' ? 'rental' : 'purchase');
    if (orderType === 'rental') {
      window.openRentalOrderDetail(orderId);
      return;
    }
    window.openOrderDetail(orderId);
  }

  /** 重點：抽出紀錄內部 tab 切換，通知連結與使用者點擊 tab 共用同一流程。 */
  function switchRecordTab(rec) {
    document.querySelectorAll('.rec-tab[data-rec]').forEach(function (item) {
      item.classList.toggle('active', item.dataset.rec === rec);
    });
    document.querySelectorAll('.rec-panel[data-rec-panel]').forEach(function (panel) {
      panel.classList.toggle('active', panel.dataset.recPanel === rec);
    });
  }

  function initRecordTabs() {
    document.querySelectorAll('.rec-tab[data-rec]').forEach(function (tab) {
      if (tab.dataset.bound === 'true') return;
      tab.dataset.bound = 'true';

      tab.addEventListener('click', function () {
        switchRecordTab(tab.dataset.rec);
      });
    });
  }

  /** 重點：抽出會員中心主分頁切換，URL、導覽列與通知深連結共用同一流程。 */
  function switchMemberPanel(tab) {
    var normalizedTab = tab === 'orders' ? 'records' : tab;
    document.querySelectorAll('.mc-nav-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.tab === normalizedTab);
    });
    document.querySelectorAll('.mc-tab-mobile').forEach(function (button) {
      button.classList.toggle('active', button.dataset.tab === normalizedTab);
    });
    document.querySelectorAll('.mc-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.dataset.panel === normalizedTab);
    });
  }

  function initPanelTabs() {
    document.querySelectorAll('.mc-nav-item').forEach(function (item) {
      if (item.dataset.bound === 'true') return;
      item.dataset.bound = 'true';
      item.addEventListener('click', function () {
        switchMemberPanel(item.dataset.tab);
      });
    });

    document.querySelectorAll('.mc-tab-mobile').forEach(function (button) {
      if (button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', function () {
        switchMemberPanel(button.dataset.tab);
      });
    });

    var urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab) switchMemberPanel(urlTab);
  }

  function applyLoginState() {
    var guard = document.getElementById('mcLoginGuard');
    var page = document.getElementById('mcPage');
    var loggedIn = isLoggedIn();

    if (guard) guard.style.display = loggedIn ? 'none' : 'flex';
    if (page) page.style.display = loggedIn ? '' : 'none';

    if (loggedIn) {
      applyProfileData();
    }
  }

  function initLoginGuard() {
    applyLoginState();

    var guardLoginBtn = document.getElementById('guardLoginBtn');
    if (guardLoginBtn && guardLoginBtn.dataset.bound !== 'true') {
      guardLoginBtn.dataset.bound = 'true';
      guardLoginBtn.addEventListener('click', function () {
        if (typeof window.openModal === 'function') {
          window.openModal('loginModal');
        }
      });
    }

    window.clearInterval(state.loginTimer);
    state.loginTimer = window.setInterval(function () {
      applyLoginState();
    }, 1500);
  }

  function initNotificationActions() {
    var list = document.getElementById('notificationList');
    if (list && list.dataset.bound !== 'true') {
      list.dataset.bound = 'true';
      list.addEventListener('click', function (event) {
        var item = event.target.closest('.notif-item[data-notif-id]');
        if (!item || !state.user) return;

        var notification = (state.user.notifications || []).find(function (entry) {
          return entry.id === item.dataset.notifId;
        });
        if (notification) notification.read = true;
        renderNotifications();
        updateStats();
      });
    }

    var markAllBtn = document.getElementById('markAllReadBtn');
    if (markAllBtn && markAllBtn.dataset.bound !== 'true') {
      markAllBtn.dataset.bound = 'true';
      markAllBtn.addEventListener('click', function () {
        if (state.user && Array.isArray(state.user.notifications)) {
          state.user.notifications.forEach(function (item) { item.read = true; });
        }
        renderNotifications();
        updateStats();
      });
    }
  }

  function initModalClose() {
    var overlay = document.getElementById('orderDetailOverlay');
    var closeBtn = document.getElementById('orderDetailClose');
    if (closeBtn && closeBtn.dataset.bound !== 'true') {
      closeBtn.dataset.bound = 'true';
      closeBtn.addEventListener('click', closeDetailModal);
    }
    if (overlay && overlay.dataset.bound !== 'true') {
      overlay.dataset.bound = 'true';
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeDetailModal();
      });
    }
  }

  function updateReviewStars(rating) {
    state.review.rating = Number(rating) || 0;
    document.querySelectorAll('.mc-review-star').forEach(function (button) {
      button.classList.toggle('is-active', Number(button.dataset.reviewRating) <= state.review.rating);
    });
  }

  window.openReviewModal = function (orderId, itemName) {
    var overlay = document.getElementById('reviewOverlay');
    if (!overlay) return;

    state.review.orderId = orderId;
    state.review.itemName = itemName || '';
    state.review.rating = 0;
    setText('reviewProductName', itemName || '商品評價');
    setInputValue('reviewContent', '');
    updateReviewStars(0);
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  };

  function closeReviewModal() {
    var overlay = document.getElementById('reviewOverlay');
    if (overlay) overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function initReviewModal() {
    var overlay = document.getElementById('reviewOverlay');
    var closeBtn = document.getElementById('reviewClose');
    var form = document.getElementById('reviewForm');

    document.querySelectorAll('.mc-review-star').forEach(function (button) {
      if (button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', function () {
        updateReviewStars(button.dataset.reviewRating);
      });
    });

    if (closeBtn && closeBtn.dataset.bound !== 'true') {
      closeBtn.dataset.bound = 'true';
      closeBtn.addEventListener('click', closeReviewModal);
    }
    if (overlay && overlay.dataset.bound !== 'true') {
      overlay.dataset.bound = 'true';
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeReviewModal();
      });
    }
    if (form && form.dataset.bound !== 'true') {
      form.dataset.bound = 'true';
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!state.review.orderId || !state.review.rating) {
          showMcToast('請選擇評分', 'warning');
          return;
        }

        // 重點：靜態 JSON 無法直接由瀏覽器寫回，評價結果以 localStorage 保存並即時更新訂單畫面。
        var reviews = getStoredReviews();
        reviews.push({
          orderId: state.review.orderId,
          itemName: state.review.itemName,
          rating: state.review.rating,
          content: getInputValue('reviewContent'),
          createdAt: new Date().toISOString()
        });
        localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviews));

        var order = state.orders.find(function (item) { return item.id === state.review.orderId; });
        if (order) order.reviewed = true;
        renderPurchaseOrders();
        closeReviewModal();
        showMcToast('評價已送出', 'success');
      });
    }
  }

  function initGlobalEvents() {
    if (window.__memberCenterGlobalEventsBound) return;
    window.__memberCenterGlobalEventsBound = true;

    window.addEventListener('storage', function (event) {
      if (['currentUser', 'yuruiUser', 'isLoggedIn', 'yurui_profile', 'preferences', MOCK_USER_POINT_DELTAS_STORAGE_KEY, MOCK_ORDERS_STORAGE_KEY].includes(event.key)) {
        applyLoginState();
        if (event.key === MOCK_USER_POINT_DELTAS_STORAGE_KEY) refreshMemberRewardPoints();
        if (event.key === MOCK_ORDERS_STORAGE_KEY) loadMemberData();
      }
    });

    window.addEventListener('yurui:preferences-updated', function (event) {
      window.syncMemberPreferenceTags(event.detail || []);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      closeDetailModal();
      closeReviewModal();
    });
  }

  function setConfigLinks() {
    document.querySelectorAll('[data-member-center-home-link]').forEach(function (link) {
      link.setAttribute('href', config.homeHref || 'home.html');
    });
  }

  async function loadMemberData() {
    var results = await Promise.all([
      fetchJson(DATA_PATHS.users, []),
      fetchJson(DATA_PATHS.orders, []),
      fetchJson(DATA_PATHS.rentalOrders, []),
      fetchJson(DATA_PATHS.products, [])
    ]);
    var memberId = getCurrentMemberId();

    state.users = applyUserPointDeltas(results[0]);
    state.user = selectUser(state.users);
    state.products = Array.isArray(results[3]) ? results[3] : [];
    state.productsById = buildProductsById(state.products);
    state.productImageFallback = '';
    state.orders = mergeOrders(results[1], readStorageArray(MOCK_ORDERS_STORAGE_KEY)).filter(function (order) {
      return !order.userId || order.userId === memberId || (state.user && order.userId === state.user.id);
    });
    state.rentalOrders = (Array.isArray(results[2]) ? results[2] : []).filter(function (order) {
      return !order.userId || order.userId === memberId || (state.user && order.userId === state.user.id);
    });

    applyProfileData();
    renderOrderStatusTabs('purchase', state.orders);
    renderOrderStatusTabs('rental', state.rentalOrders);
    renderPurchaseOrders();
    renderRentalOrders();
    renderCoupons();
    renderNotifications();
    renderRecentActivity();
    updateStats();
    applyLoginState();
  }

  function initAll() {
    state.root = document.getElementById('memberCenterComponentRoot');
    if (!state.root) return;

    setConfigLinks();
    initPanelTabs();
    initRecordTabs();
    initCouponTabs();
    initOrderStatusTabs();
    initDynamicActionButtons();
    initPreferenceTags();
    initProfileForm();
    initNotificationActions();
    initModalClose();
    initReviewModal();
    initLoginGuard();
    initGlobalEvents();

    // 重點：初始化時一次載入 users、orders、rentalOrders，讓兩個頁面共用同一個資料渲染流程。
    loadMemberData();
    initMemberRewardPoints();
  }

  window.initMemberCenterComponent = function () {
    var currentRoot = document.getElementById('memberCenterComponentRoot');
    if (!currentRoot) return;

    if (state.initialized && state.root === currentRoot) {
      loadMemberData();
      applyLoginState();
      return;
    }

    state.initialized = true;
    initAll();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.getElementById('memberCenterComponentRoot')) {
        window.initMemberCenterComponent();
      }
    });
  } else if (document.getElementById('memberCenterComponentRoot')) {
    window.initMemberCenterComponent();
  }
})();
