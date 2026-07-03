/**
 * booking-cart.js
 * 功能：預約背包確認頁（步驟 4）
 *   ① 讀取 LocalStorage，渲染住宿 + 裝備項目（含數量調整器）
 *   ② 「修改日期」連結帶入正確 campground_id
 *   ③ 住宿：調整營位數量，即時重算小計
 *   ④ 裝備：調整數量 / 刪除項目，即時重算小計
 *   ⑤ 右側摘要隨數量變化同步更新
 *   ⑥ 所有變更即時寫回 localStorage
 */

// 目前操作中的 bookingCart，初始從 localStorage 讀取
var bookingCart = null;
var BOOKING_CART_STORAGE_KEY = 'bookingCart';
var BOOKING_CART_UPDATED_EVENT = 'bookingCartUpdated';

$(document).ready(function () {
  var cartState = readBookingCartState();
  if (cartState.status === 'missing') {
    showEmptyState();
    return;
  }
  if (cartState.status === 'invalid') {
    showEmptyState();
    if (typeof showToast === 'function') {
      showToast('購物車資料異常，請重新選擇。', 'warning');
    }
    return;
  }

  bookingCart = cartState.cart;
  renderAll();

  // 清除背包
  $('#bkClearCartBtn').on('click', function () {
    showConfirmToast('確定清除背包中的所有預約資料？', function () {
      localStorage.removeItem(BOOKING_CART_STORAGE_KEY);
      triggerBookingCartUpdated();
      bookingCart = null;
      showToast('背包已清除', 'info');
      $('#bkCartContent').fadeOut(250, function () {
        showEmptyState();
      });
    });
  });

  // 住宿數量調整：事件委派到 stayBody
  $('#bkStayBody').on('click', '.bk-qty-btn', function () {
    var $btn   = $(this);
    var action = $btn.data('action');
    var idx    = parseInt($btn.data('idx'), 10);
    if (!isFinite(idx) || idx < 0) return;
    var zone   = bookingCart.selected_zones[idx];
    if (!zone) return;

    var currentQty = toSafePositiveInteger(zone.quantity, 1);
    var currentSubtotal = toSafeNonNegativeNumber(zone.subtotal, 0);
    var unitPrice = currentQty > 0 ? currentSubtotal / currentQty : 0;
    if (!isFinite(unitPrice) || unitPrice < 0) unitPrice = 0;

    var newQty    = currentQty + (action === 'inc' ? 1 : -1);
    if (newQty < 1 || newQty > 10) return;

    zone.quantity = newQty;
    zone.subtotal = Math.round(unitPrice * newQty);

    recalcSummary();
    saveCart();
    renderStayBody();
    renderSummary();
  });

  // 裝備數量調整：事件委派到 rentalBody
  $('#bkRentalBody').on('click', '.bk-qty-btn', function () {
    var $btn   = $(this);
    var action = $btn.data('action');
    var idx    = parseInt($btn.data('idx'), 10);
    if (!isFinite(idx) || idx < 0) return;
    var rental = bookingCart.selected_rentals[idx];
    if (!rental) return;

    var currentQty = toSafePositiveInteger(rental.quantity, 1);
    var currentSubtotal = toSafeNonNegativeNumber(rental.subtotal, 0);
    var unitPrice = currentQty > 0 ? currentSubtotal / currentQty : 0;
    if (!isFinite(unitPrice) || unitPrice < 0) unitPrice = 0;

    var newQty    = currentQty + (action === 'inc' ? 1 : -1);
    if (newQty < 1 || newQty > 20) return;

    rental.quantity = newQty;
    rental.subtotal = Math.round(unitPrice * newQty);

    recalcSummary();
    saveCart();
    renderRentalBody();
    renderSummary();
  });

  // 裝備刪除
  $('#bkRentalBody').on('click', '.bk-rental-remove', function () {
    var idx = parseInt($(this).data('idx'), 10);
    if (!isFinite(idx) || idx < 0) return;
    bookingCart.selected_rentals.splice(idx, 1);

    recalcSummary();
    saveCart();
    renderRentalBody();
    renderSummary();

    if (bookingCart.selected_rentals.length === 0) {
      showToast('裝備已全部移除', 'info');
    }
  });

});

// ============================================================
// 渲染整頁
// ============================================================

function renderAll() {
  if (!bookingCart) {
    showEmptyState();
    return;
  }
  bookingCart = normalizeBookingCart(bookingCart);

  var info = bookingCart.booking_info;

  // 設定「修改日期」連結：帶入 campground_id
  var campId = info.campground_id || '';
  $('#bkEditDateLink').attr('href', './camp-detail.html?id=' + encodeURIComponent(campId));

  // 項目總數
  updateItemCount();

  renderStayBody();
  renderRentalBody();
  renderSummary();

  $('#bkCartEmpty').hide();
  $('#bkCartContent').show();
}

// ── 住宿卡內容 ──
function renderStayBody() {
  var info  = bookingCart.booking_info;
  var zones = bookingCart.selected_zones;

  if (zones.length === 0) {
    $('#bkStayCard').hide();
    return;
  }

  var html = zones.map(function (z, idx) {
    var quantity = toSafePositiveInteger(z.quantity, 1);
    var subtotal = toSafeNonNegativeNumber(z.subtotal, 0);
    var atMin = quantity <= 1;
    var atMax = quantity >= 10;
    return `
      <div class="bk-cart-item">
        <div class="bk-cart-item__info">
          <div class="bk-cart-item__name">${esc(info.campground_name || '')} · ${esc(z.zone_type || '')}</div>
          <div class="bk-cart-item__meta">
            <span><i class="bi bi-calendar3"></i> ${esc(info.check_in || '')} ～ ${esc(info.check_out || '')}</span>
            <span><i class="bi bi-moon"></i> ${info.total_days || 0} 晚</span>
            <span><i class="bi bi-people"></i> ${info.guest_count || ''} 人</span>
          </div>
        </div>
        <div class="bk-cart-item__right">
          <div class="bk-qty-stepper">
            <button class="bk-qty-btn" data-action="dec" data-idx="${idx}"${atMin ? ' disabled' : ''}>−</button>
            <span class="bk-qty-val">${quantity}</span>
            <button class="bk-qty-btn" data-action="inc" data-idx="${idx}"${atMax ? ' disabled' : ''}>+</button>
          </div>
          <div class="bk-cart-item__price" id="zonePrice${idx}">NT$${Math.round(subtotal).toLocaleString()}</div>
          <div style="font-size:0.72rem;color:var(--bk-text-muted);">營位數量</div>
        </div>
      </div>
    `;
  }).join('');

  $('#bkStayBody').html(html);
  $('#bkStayCard').show();
}

// ── 裝備租借卡內容 ──
function renderRentalBody() {
  var rentals = bookingCart.selected_rentals;

  if (rentals.length === 0) {
    $('#bkRentalBody').html(
      '<div style="padding:1rem 1.25rem;color:var(--bk-text-muted);font-size:0.85rem;">本次未選擇租借裝備。</div>'
    );
    return;
  }

  var html = rentals.map(function (r, idx) {
    var quantity = toSafePositiveInteger(r.quantity, 1);
    var subtotal = toSafeNonNegativeNumber(r.subtotal, 0);
    var perUnitPrice = quantity > 0 ? subtotal / quantity : 0;
    if (!isFinite(perUnitPrice) || perUnitPrice < 0) perUnitPrice = 0;
    var atMax = quantity >= 20;
    return `
      <div class="bk-cart-item">
        <div class="bk-cart-item__info">
          <div class="bk-cart-item__name">${esc(r.name || '')}</div>
          <div class="bk-cart-item__meta">
            <span>單價 NT$${Math.round(perUnitPrice).toLocaleString()}</span>
          </div>
        </div>
        <div class="bk-cart-item__right">
          <div class="bk-qty-stepper">
            <button class="bk-qty-btn" data-action="dec" data-idx="${idx}">−</button>
            <span class="bk-qty-val">${quantity}</span>
            <button class="bk-qty-btn" data-action="inc" data-idx="${idx}"${atMax ? ' disabled' : ''}>+</button>
          </div>
          <div class="bk-cart-item__price">NT$${Math.round(subtotal).toLocaleString()}</div>
          <button class="bk-rental-remove" data-idx="${idx}">
            <i class="bi bi-trash3"></i> 移除
          </button>
        </div>
      </div>
    `;
  }).join('');

  $('#bkRentalBody').html(html);
  $('#bkRentalCard').show();
}

// ── 右側費用摘要 ──
function renderSummary() {
  var s = normalizeSummary(bookingCart.summary);

  var html = `
    <div class="cost-row">
      <span>住宿費</span>
      <span>NT$${(s.zone_total || 0).toLocaleString()}</span>
    </div>
    <div class="cost-row">
      <span>裝備租借費</span>
      <span>NT$${(s.rental_total || 0).toLocaleString()}</span>
    </div>
  `;

  if (s.applied_discount > 0) {
    html += `
      <div class="cost-row cost-row--discount">
        <span><i class="bi bi-tag"></i> 租借折扣優惠</span>
        <span>-NT$${s.applied_discount.toLocaleString()}</span>
      </div>
    `;
  }

  $('#bkCostRows').html(html);
  $('#bkFinalAmount').text('NT$' + (s.final_amount || 0).toLocaleString());
}

// ============================================================
// 工具函式
// ============================================================

// 重新計算 summary（zone_total / rental_total / final_amount）
function recalcSummary() {
  var zones   = Array.isArray(bookingCart.selected_zones) ? bookingCart.selected_zones : [];
  var rentals = Array.isArray(bookingCart.selected_rentals) ? bookingCart.selected_rentals : [];

  var zoneTotal = zones.reduce(function (s, z) {
    return s + toSafeNonNegativeNumber(z.subtotal, 0);
  }, 0);
  var rentalTotal = rentals.reduce(function (s, r) {
    return s + toSafeNonNegativeNumber(r.subtotal, 0);
  }, 0);

  // discount 保持不變（沒有儲存單件折扣，無法精確重算）
  var discount = normalizeSummary(bookingCart.summary).applied_discount;

  bookingCart.summary = {
    zone_total:       Math.round(zoneTotal),
    rental_total:     Math.round(rentalTotal),
    applied_discount: discount,
    final_amount:     Math.round(Math.max(0, zoneTotal + rentalTotal - discount))
  };

  updateItemCount();
}

function updateItemCount() {
  var zones   = Array.isArray(bookingCart.selected_zones) ? bookingCart.selected_zones : [];
  var rentals = Array.isArray(bookingCart.selected_rentals) ? bookingCart.selected_rentals : [];
  var total   = zones.reduce(function (s, z) { return s + toSafeCount(z.quantity); }, 0)
              + rentals.reduce(function (s, r) { return s + toSafeCount(r.quantity); }, 0);
  $('#bkCartCount').text('共 ' + total + ' 項');
}

function saveCart() {
  localStorage.setItem(BOOKING_CART_STORAGE_KEY, JSON.stringify(bookingCart));
  triggerBookingCartUpdated();
}

function showEmptyState() {
  $('#bkCartEmpty').show();
  $('#bkCartContent').hide();
  $('#bkCartCount').text('');
}

// XSS 防護：轉義 HTML 特殊字元
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function triggerBookingCartUpdated() {
  window.dispatchEvent(new CustomEvent(BOOKING_CART_UPDATED_EVENT));
}

function isPlainObject(value) {
  return !!value && Object.prototype.toString.call(value) === '[object Object]';
}

function toSafeFiniteNumber(value, fallback) {
  var num = Number(value);
  return isFinite(num) ? num : fallback;
}

function toSafeNonNegativeNumber(value, fallback) {
  var num = toSafeFiniteNumber(value, fallback);
  return num >= 0 ? num : fallback;
}

function toSafeCount(value) {
  var qty = Math.floor(toSafeFiniteNumber(value, 0));
  return qty > 0 ? qty : 0;
}

function toSafePositiveInteger(value, fallback) {
  var fallbackQty = fallback > 0 ? Math.floor(fallback) : 1;
  var qty = Math.floor(toSafeFiniteNumber(value, fallbackQty));
  return qty > 0 ? qty : fallbackQty;
}

function normalizeSummary(summary) {
  var source = isPlainObject(summary) ? summary : {};
  return {
    zone_total: Math.round(toSafeNonNegativeNumber(source.zone_total, 0)),
    rental_total: Math.round(toSafeNonNegativeNumber(source.rental_total, 0)),
    applied_discount: Math.round(toSafeNonNegativeNumber(source.applied_discount, 0)),
    final_amount: Math.round(toSafeNonNegativeNumber(source.final_amount, 0))
  };
}

function normalizeBookingCart(raw) {
  if (!isPlainObject(raw)) return null;
  return {
    booking_info: isPlainObject(raw.booking_info) ? raw.booking_info : {},
    selected_zones: Array.isArray(raw.selected_zones) ? raw.selected_zones : [],
    selected_rentals: Array.isArray(raw.selected_rentals) ? raw.selected_rentals : [],
    summary: normalizeSummary(raw.summary)
  };
}

function readBookingCartState() {
  var raw = localStorage.getItem(BOOKING_CART_STORAGE_KEY);
  var parsed = null;
  var normalized = null;

  if (raw === null) {
    return { status: 'missing', cart: null };
  }

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('Unable to read bookingCart: invalid JSON.');
    return { status: 'invalid', cart: null };
  }

  normalized = normalizeBookingCart(parsed);
  if (!normalized) {
    console.error('Unable to read bookingCart: invalid top-level schema.');
    return { status: 'invalid', cart: null };
  }

  return { status: 'valid', cart: normalized };
}

// showConfirmToast 定義在 booking-header.js，此處不重複
