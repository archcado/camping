/**
 * booking-checkout.js
 * 功能：預約結帳頁邏輯
 *   ① 讀取 LocalStorage 取得完整 bookingCart
 *   ② 渲染住宿明細、裝備明細、費用加總
 *   ③ 聯絡資訊表單驗證
 *   ④ 模擬送出結帳（未來對接 Java 後端）
 *   ⑤ 結帳成功後清除 LocalStorage，顯示導購橫幅
 */

var BOOKING_CART_STORAGE_KEY = 'bookingCart';
var BOOKING_CART_UPDATED_EVENT = 'bookingCartUpdated';

$(document).ready(function () {
  var cartState = readBookingCartState();
  if (cartState.status === 'missing') {
    showToast('購物車資料為空，請重新選擇。', 'warning');
    window.location.href = './booking-cart.html';
    return;
  }
  if (cartState.status === 'invalid') {
    showToast('購物車資料異常，請重新選擇。', 'warning');
    window.location.href = './booking-cart.html';
    return;
  }
  const bookingCart = cartState.cart;

  renderCheckoutPage(bookingCart);
  initAccordionPanels();
  initPaymentMethod();

  $('#confirmPayBtn').on('click', function () {
    handleCheckout(bookingCart);
  });
});

// ============================================================
// 渲染整頁預約明細
// ============================================================

function renderCheckoutPage(cart) {
  const info = isPlainObject(cart.booking_info) ? cart.booking_info : {};
  const zones = Array.isArray(cart.selected_zones) ? cart.selected_zones : [];
  const rentals = Array.isArray(cart.selected_rentals) ? cart.selected_rentals : [];
  const summary = normalizeSummary(cart.summary);

  // 住宿資訊
  const zoneRowsHTML = zones
    .map(
      (z) => `
    <div class="detail-row">
      <span>
        <strong>${String(info.campground_name || '')}</strong>・${String(z.zone_type || '')}・×${toSafeCount(z.quantity)} 個營位
      </span>
      <span><strong>NT$${toSafeMoney(z.subtotal).toLocaleString()}</strong></span>
    </div>
  `
    )
    .join('');

  $('#stayDetail').html(`
    <div class="detail-row detail-row--meta">
      <i class="bi bi-calendar3"></i>
      ${String(info.check_in || '')} ～ ${String(info.check_out || '')}
      （${toSafeCount(info.total_days)} 晚｜平日 ${toSafeCount(info.weekday_count)} 晚、假日 ${toSafeCount(info.holiday_count)} 晚）
    </div>
    <div class="detail-row detail-row--meta">
      <i class="bi bi-geo-alt"></i> ${String(info.region || '')}
      &nbsp;&nbsp;
      <i class="bi bi-people"></i> ${toSafeCount(info.guest_count)} 人
    </div>
    ${zoneRowsHTML}
  `);

  // 租借裝備
  if (!rentals || rentals.length === 0) {
    $('#rentalDetail').html('<p class="no-rental">本次未選擇租借裝備。</p>');
  } else {
    const rentalRowsHTML = rentals
      .map(
        (r) => `
      <div class="detail-row">
        <span>${String(r.name || '')} ×${toSafeCount(r.quantity)}</span>
        <span><strong>NT$${toSafeMoney(r.subtotal).toLocaleString()}</strong></span>
      </div>
    `
      )
      .join('');
    $('#rentalDetail').html(rentalRowsHTML);
  }

  // 費用明細
  let breakdownHTML = `
    <div class="cost-row">
      <span>住宿費</span>
      <span>NT$${toSafeMoney(summary.zone_total).toLocaleString()}</span>
    </div>
    <div class="cost-row">
      <span>裝備租借費</span>
      <span>NT$${toSafeMoney(summary.rental_total).toLocaleString()}</span>
    </div>
  `;

  if (summary.applied_discount > 0) {
    breakdownHTML += `
      <div class="cost-row cost-row--discount">
        <span><i class="bi bi-tag"></i> 租借折扣優惠</span>
        <span>-NT$${toSafeMoney(summary.applied_discount).toLocaleString()}</span>
      </div>
    `;
  }

  $('#costBreakdown').html(breakdownHTML);
  $('#finalAmount').text(`NT$${toSafeMoney(summary.final_amount).toLocaleString()}`);
}

// ============================================================
// 登入守衛
// ============================================================

window.onBookingHeaderReady = function () {
  initLoginGuard();
};

function initLoginGuard() {
  function isLoggedIn() {
    try {
      var user = JSON.parse(localStorage.getItem('yuruiUser'));
      return !!(user && user.name);
    } catch (e) {
      return false;
    }
  }

  function showNotice() {
    $('#loginNotice').addClass('isVisible');
  }
  function hideNotice() {
    $('#loginNotice').removeClass('isVisible');
  }

  if (!isLoggedIn()) {
    setTimeout(function () {
      if (typeof window.openModal === 'function') {
        window.openModal('loginModal');
      }
      showNotice();
    }, 400);
  }

  $('#loginNoticeBtn').on('click', function () {
    if (typeof window.openModal === 'function') {
      window.openModal('loginModal');
    }
  });

  window.addEventListener('storage', function (e) {
    if (e.key === 'yuruiUser') {
      isLoggedIn() ? hideNotice() : showNotice();
    }
  });
}

// ============================================================
// 手風琴面板
// ============================================================

function initAccordionPanels() {
  $('.bk-panel__header').on('click', function () {
    const $panel = $(this).closest('.bk-panel');
    const $body = $panel.find('> .bk-panel__body');
    const isOpen = $panel.hasClass('is-open');

    if (isOpen) {
      $body.slideUp(200);
      $panel.removeClass('is-open');
    } else {
      $body.slideDown(200);
      $panel.addClass('is-open');
    }
  });
}

// ============================================================
// 付款方式互動
// ============================================================

function initPaymentMethod() {
  $('input[name="paymentMethod"]').on('change', function () {
    const val = $(this).val();

    $('#payOptCredit').toggleClass('is-selected', val === 'credit');
    $('#payOptLine').toggleClass('is-selected', val === 'linepay');

    if (val === 'credit') {
      $('#creditCardSection').slideDown(200);
    } else {
      $('#creditCardSection').slideUp(200);
    }
  });

  $('#cardNumber').on('input', function () {
    let v = $(this).val().replace(/\D/g, '').substring(0, 16);
    v = v.replace(/(.{4})/g, '$1 ').trim();
    $(this).val(v);
  });

  $('#cardExpiry').on('input', function () {
    let v = $(this).val().replace(/\D/g, '').substring(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + ' / ' + v.slice(2);
    $(this).val(v);
  });

  $('#cardCvv').on('input', function () {
    $(this).val($(this).val().replace(/\D/g, '').substring(0, 4));
  });
}

// ============================================================
// 送出結帳
// ============================================================

function handleCheckout(cart) {
  try {
    var u = JSON.parse(localStorage.getItem('yuruiUser'));
    if (!u || !u.name) {
      if (typeof window.openModal === 'function') window.openModal('loginModal');
      return;
    }
  } catch (e) {
    if (typeof window.openModal === 'function') window.openModal('loginModal');
    return;
  }

  const name = $('#contactName').val().trim();
  const phone = $('#contactPhone').val().trim();
  const email = $('#contactEmail').val().trim();

  if (!name) {
    highlightError('#contactName', '請填寫訂購人姓名');
    return;
  }
  if (!phone || !/^[0-9]{8,12}$/.test(phone)) {
    highlightError('#contactPhone', '請填寫正確的手機號碼（8-12 位數字）');
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    highlightError('#contactEmail', '請填寫有效的電子信箱格式');
    return;
  }

  const paymentMethod = $('input[name="paymentMethod"]:checked').val();
  if (paymentMethod === 'credit') {
    const cardNum = $('#cardNumber').val().replace(/\s/g, '');
    const cardExpiry = $('#cardExpiry').val().trim();
    const cardCvv = $('#cardCvv').val().trim();
    if (cardNum.length < 16) {
      highlightError('#cardNumber', '請填寫完整的信用卡卡號（16 位）');
      return;
    }
    if (!/^\d{2} \/ \d{2}$/.test(cardExpiry)) {
      highlightError('#cardExpiry', '請填寫正確的到期日格式（MM / YY）');
      return;
    }
    if (cardCvv.length < 3) {
      highlightError('#cardCvv', '請填寫 CVV（3-4 位數字）');
      return;
    }
  }

  const payload = {
    ...cart,
    contact: { name, phone, email },
    payment_method: paymentMethod,
    submitted_at: new Date().toISOString(),
  };

  $('#confirmPayBtn').prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> 送出中...');

  // TODO: 未來替換為 fetch Java 後端 API
  // POST /api/bookings → { success: true, booking_id: 'BK202606110001' }
  console.log('[booking-checkout] 預約送出資料:', payload);

  setTimeout(function () {
    onCheckoutSuccess();
  }, 1000);
}

// ============================================================
// 結帳成功後處理
// ============================================================

function onCheckoutSuccess() {
  localStorage.removeItem(BOOKING_CART_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(BOOKING_CART_UPDATED_EVENT));
  console.log('[booking-checkout] bookingCart 已清除');

  $('#confirmPayBtn')
    .removeClass('btn--primary')
    .addClass('btn--outline')
    .html('<i class="bi bi-check-circle-fill"></i> ✓ 預約已成功送出')
    .prop('disabled', true)
    .css({ color: 'var(--bk-success)', 'border-color': 'var(--bk-success)' });

  $('#backToCartLink').hide();
  $('#upsellBanner').slideDown(400);
  $('#upsellSection').slideDown(400);

  $('html, body').animate({ scrollTop: 0 }, 600);
}

// ============================================================
// 工具函式
// ============================================================

function highlightError(selector, message) {
  const $input = $(selector);
  $input.css('border-color', 'var(--bk-danger)');
  $input.focus();
  setTimeout(() => $input.css('border-color', ''), 2000);
  showToast(message, 'warning');
}

function isPlainObject(value) {
  return !!value && Object.prototype.toString.call(value) === '[object Object]';
}

function toSafeFiniteNumber(value, fallback) {
  var num = Number(value);
  return isFinite(num) ? num : fallback;
}

function toSafeMoney(value) {
  var amount = Math.floor(toSafeFiniteNumber(value, 0));
  return amount >= 0 ? amount : 0;
}

function toSafeCount(value) {
  var qty = Math.floor(toSafeFiniteNumber(value, 0));
  return qty > 0 ? qty : 0;
}

function normalizeSummary(summary) {
  var source = isPlainObject(summary) ? summary : {};
  return {
    zone_total: toSafeMoney(source.zone_total),
    rental_total: toSafeMoney(source.rental_total),
    applied_discount: toSafeMoney(source.applied_discount),
    final_amount: toSafeMoney(source.final_amount)
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
