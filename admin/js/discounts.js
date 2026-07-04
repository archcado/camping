/**
 * admin/js/discounts.js
 * 折扣優惠管理模組
 * 使用 jQuery Event Namespace (.discounts) 防止重複導覽時事件堆疊
 *
 * 表單為 inline（非 Modal），欄位 ID：
 *   #newCouponCode, #newCouponDiscount, #newCouponQty
 *   #newCouponStart, #newCouponEnd（起始/結束時間，datetime-local）
 *   #discountTypeSwitch（折扣類型切換，checkbox form-switch）
 *   #generateCouponCode（隨機產生按鈕）, #submitAddCoupon（新增按鈕）
 *   #setCouponStartNow（填入現在時間按鈕）
 */

/**
 * 將 "YYYY-MM-DDTHH:MM" 格式的時間字串轉為 "YYYY/MM/DD HH:MM" 顯示格式
 * Convert datetime-local string to a readable display format
 * 若傳入空值或 undefined，回傳 "—"
 *
 * @param {string} val - datetime-local 格式，例如 "2026-08-31T23:59"
 * @returns {string} 例如 "2026/08/31 23:59"，或 "—"
 */
function formatDateDisplay(val) {
  if (!val) return '—';
  var parts = val.split('T'); // ["2026-08-31", "23:59"]
  var datePart = parts[0].replace(/-/g, '/'); // "2026/08/31"
  return datePart + ' ' + (parts[1] || ''); // "2026/08/31 23:59"
}

function parseCouponDate(val) {
  if (!val) return null;
  var parsed = new Date(val);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  var normalized = String(val).replace(/\//g, '-');
  parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function getCouponStatusMeta(coupon) {
  var status = String((coupon && coupon.status) || '').toLowerCase();
  var endDate = parseCouponDate(coupon && coupon.endDate);
  var now = new Date();

  if (status === 'disabled') {
    return {
      label: '已停用',
      badgeClass: 'yr-admin-coupon-status--inactive',
      iconClass: 'fa-circle-pause',
    };
  }

  if (endDate && endDate.getTime() < now.getTime()) {
    return {
      label: '已失效',
      badgeClass: 'yr-admin-coupon-status--expired',
      iconClass: 'fa-circle-xmark',
    };
  }

  if (endDate) {
    var msPerDay = 24 * 60 * 60 * 1000;
    var daysToExpire = Math.ceil((endDate.getTime() - now.getTime()) / msPerDay);
    if (daysToExpire <= 7) {
      return {
        label: '即將到期',
        badgeClass: 'yr-admin-coupon-status--expiring',
        iconClass: 'fa-hourglass-half',
      };
    }
  }

  return {
    label: '已啟用',
    badgeClass: 'yr-admin-coupon-status--active',
    iconClass: 'fa-circle-check',
  };
}

function renderCouponStatusBadge(coupon) {
  var meta = getCouponStatusMeta(coupon);
  var statusLabel = meta.label;
  return (
    '<span class="status-badge yr-admin-discount-status yr-admin-coupon-status ' +
    meta.badgeClass +
    '" title="目前狀態：' +
    statusLabel +
    '" aria-label="目前狀態：' +
    statusLabel +
    '">' +
    '<i class="fas ' +
    meta.iconClass +
    ' yr-admin-coupon-status__icon" aria-hidden="true"></i>' +
    '<span class="yr-admin-coupon-status__text">' +
    statusLabel +
    '</span>' +
    '</span>'
  );
}

function getCouponActionMeta(couponStatus) {
  if (String(couponStatus || '').toLowerCase() === 'active') {
    return {
      label: '停用',
      actionClass: 'yr-admin-coupon-action--deactivate',
      iconClass: 'fa-toggle-off',
      title: '停用此優惠券',
      ariaLabel: '停用此優惠券',
    };
  }

  return {
    label: '啟用',
    actionClass: 'yr-admin-coupon-action--activate',
    iconClass: 'fa-toggle-on',
    title: '啟用此優惠券',
    ariaLabel: '啟用此優惠券',
  };
}

function renderCouponActionButton(couponStatus, code) {
  var actionMeta = getCouponActionMeta(couponStatus);
  var targetCode = String(code || '');
  return (
    '<button type="button" class="btn btn-sm btn-toggle-coupon yr-admin-coupon-action ' +
    actionMeta.actionClass +
    ' me-1" title="' +
    actionMeta.title +
    '：' +
    targetCode +
    '" aria-label="' +
    actionMeta.ariaLabel +
    '：' +
    targetCode +
    '">' +
    '<i class="fas ' +
    actionMeta.iconClass +
    ' yr-admin-coupon-action__icon" aria-hidden="true"></i>' +
    '<span class="yr-admin-coupon-action__text">' +
    actionMeta.label +
    '</span>' +
    '</button>'
  );
}

window.initDiscounts = function () {
  $(document).off('.discounts');

  $.getJSON('data/coupons.json', function (coupons) {
    renderCouponsTable(coupons);
  }).fail(function () {
    $('#couponsTableBody').html(
      '<tr><td colspan="9" class="text-center text-danger py-4">' +
        '<i class="fas fa-exclamation-triangle me-2"></i>載入優惠券數據失敗' +
        '</td></tr>'
    );
  });

  // 折扣類型 Switch：切換「折扣金額」和「折數」模式
  // Switch 勾選 = 折數模式；未勾選 = 折扣金額模式（預設）
  $(document).on('change.discounts', '#discountTypeSwitch', function () {
    var isPercent = $(this).is(':checked'); // true = 折數；false = 金額

    if (isPercent) {
      // 折數模式：輸入 0.1 ~ 9.9，step 0.1
      $('#discountLabel').html('折數（幾折）<span class="text-danger">*</span>');
      $('#newCouponDiscount')
        .attr('placeholder', '例：8')
        .attr('min', '0.1')
        .attr('max', '9.9')
        .attr('step', '0.1')
        .val('');
    } else {
      // 折扣金額模式：輸入正整數，無上限
      $('#discountLabel').html('折扣金額 (NT$) <span class="text-danger">*</span>');
      $('#newCouponDiscount')
        .attr('placeholder', '例：200')
        .attr('min', '1')
        .removeAttr('max')
        .attr('step', '1')
        .val('');
    }
  });

  // 「現在」按鈕：將起始時間填入當下時間（精度到分鐘）
  $(document).on('click.discounts', '#setCouponStartNow', function () {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var hour = String(now.getHours()).padStart(2, '0');
    var minute = String(now.getMinutes()).padStart(2, '0');
    // datetime-local 格式必須是 "YYYY-MM-DDTHH:MM"
    $('#newCouponStart').val(year + '-' + month + '-' + day + 'T' + hour + ':' + minute);
  });

  // 產生隨機優惠碼（8碼英數）
  $(document).on('click.discounts', '#generateCouponCode', function () {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var code = '';
    for (var i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    $('#newCouponCode').val(code);
  });

  // 啟用 / 停用優惠券
  $(document).on('click.discounts', '.btn-toggle-coupon', function () {
    var $btn = $(this);
    var $row = $btn.closest('tr');
    var code = $row.data('coupon-code');
    var isActive = $row.data('coupon-status') === 'active';
    var couponStatus = isActive ? 'disabled' : 'active';

    $row.data('coupon-status', couponStatus);
    var badgeHtml = renderCouponStatusBadge({
      status: couponStatus,
      endDate: $row.data('coupon-end-date'),
    });
    $row.find('.status-badge').replaceWith(badgeHtml);
    $btn.replaceWith(renderCouponActionButton(couponStatus, code));

    if (isActive) {
      window.showAdminToast('優惠券 ' + code + ' 已停用');
    } else {
      window.showAdminToast('優惠券 ' + code + ' 已啟用');
    }
  });

  // 刪除優惠券
  $(document).on('click.discounts', '.btn-delete-coupon', function () {
    var $row = $(this).closest('tr');
    var code = $row.data('coupon-code');
    if (!window.confirm('確定要刪除優惠券「' + code + '」嗎？')) return;
    $row.fadeOut(300, function () {
      $(this).remove();
    });
    window.showAdminToast('優惠券 ' + code + ' 已刪除', 'danger');
  });

  // 新增優惠券（inline form，無 Modal）
  $(document).on('click.discounts', '#submitAddCoupon', function () {
    var code = $('#newCouponCode').val().trim().toUpperCase();
    var discountRaw = parseFloat($('#newCouponDiscount').val()) || 0;
    var quantity = parseInt($('#newCouponQty').val(), 10) || 50;
    var startVal = $('#newCouponStart').val(); // "YYYY-MM-DDTHH:MM" 或空字串
    var endVal = $('#newCouponEnd').val(); // "YYYY-MM-DDTHH:MM" 或空字串
    var isPercent = $('#discountTypeSwitch').is(':checked'); // true = 折數

    // --- 驗證 ---
    if (!code) {
      window.showAdminToast('請填寫優惠碼', 'danger');
      return;
    }
    if (isPercent) {
      // 折數須在 0 < x < 10 之間，且最多一位小數
      if (discountRaw <= 0 || discountRaw >= 10) {
        window.showAdminToast('折數須介於 0 到 10 之間（不含）', 'danger');
        return;
      }
      // 確保最多一位小數（例如 8.55 不合法）
      if (Math.round(discountRaw * 10) / 10 !== discountRaw) {
        window.showAdminToast('折數最多輸入小數後一位，例如 8 或 8.5', 'danger');
        return;
      }
    } else {
      if (discountRaw <= 0) {
        window.showAdminToast('請填寫有效的折扣金額', 'danger');
        return;
      }
    }

    // --- 折扣欄位顯示文字 ---
    // 金額：NT$ 200；折數：8 折
    var discountDisplay = isPercent ? discountRaw + ' 折' : 'NT$ ' + Math.floor(discountRaw).toLocaleString();

    // --- 組合新表格列 ---
    // startVal / endVal 直接傳入 formatDateDisplay()，空值自動顯示 "—"
    var discountCellClass = isPercent ? '' : ' class="admin-cell-amount"';
    var newRow =
      '<tr data-coupon-code="' +
      code +
      '" data-coupon-status="active" data-coupon-end-date="' +
      (endVal || '') +
      '">' +
      '<td><code class="fw-bold yr-admin-discount-code">' +
      code +
      '</code></td>' +
      '<td' +
      discountCellClass +
      '>' +
      discountDisplay +
      '</td>' +
      '<td class="text-center">' +
      quantity +
      '</td>' +
      '<td class="text-center">0</td>' +
      '<td class="text-center">' +
      quantity +
      '</td>' +
      '<td>' +
      formatDateDisplay(startVal) +
      '</td>' +
      '<td>' +
      formatDateDisplay(endVal) +
      '</td>' +
      '<td>' +
      renderCouponStatusBadge({
        status: 'active',
        endDate: endVal,
      }) +
      '</td>' +
      '<td>' +
      renderCouponActionButton('active', code) +
      '<button class="btn btn-sm btn-outline-danger btn-delete-coupon">刪除</button>' +
      '</td></tr>';

    $('#couponsTableBody').prepend($(newRow).hide().fadeIn(400));

    // --- 重設表單欄位 ---
    $('#newCouponCode').val('');
    $('#newCouponDiscount').val('');
    $('#newCouponQty').val('50');
    $('#newCouponStart').val('');
    $('#newCouponEnd').val('');
    // Switch 重設回「折扣金額」模式
    $('#discountTypeSwitch').prop('checked', false).trigger('change');

    window.showAdminToast('優惠券「' + code + '」已新增');
  });
};

/**
 * 將 coupons 陣列渲染成 HTML 表格列，填入 #couponsTableBody
 * @param {Array} coupons - coupons.json 的資料陣列
 */
function renderCouponsTable(coupons) {
  if (!coupons || coupons.length === 0) {
    $('#couponsTableBody').html(
      '<tr><td colspan="9" class="text-center text-muted py-4">目前沒有優惠券</td></tr>'
    );
    return;
  }

  var html = coupons
    .map(function (coupon) {
      var isActive = coupon.status === 'active';
      var remaining = coupon.quantity - coupon.used;

      var remainDisplay =
        remaining <= 5 ? '<span class="text-danger fw-bold">' + remaining + '</span>' : remaining;

      var statusBadge = renderCouponStatusBadge(coupon);

      var toggleBtn = renderCouponActionButton(coupon.status, coupon.code);

      return (
        '<tr data-coupon-code="' +
        coupon.code +
        '" data-coupon-status="' +
        coupon.status +
        '" data-coupon-end-date="' +
        (coupon.endDate || '') +
        '">' +
        '<td><code class="fw-bold yr-admin-discount-code">' +
        coupon.code +
        '</code></td>' +
        '<td class="admin-cell-amount">NT$ ' +
        coupon.discount.toLocaleString() +
        '</td>' +
        '<td class="text-center">' +
        coupon.quantity +
        '</td>' +
        '<td class="text-center">' +
        coupon.used +
        '</td>' +
        '<td class="text-center">' +
        remainDisplay +
        '</td>' +
        '<td>' +
        formatDateDisplay(coupon.startDate) +
        '</td>' +
        '<td>' +
        formatDateDisplay(coupon.endDate) +
        '</td>' +
        '<td>' +
        statusBadge +
        '</td>' +
        '<td>' +
        toggleBtn +
        '<button class="btn btn-sm btn-outline-danger btn-delete-coupon">刪除</button>' +
        '</td></tr>'
      );
    })
    .join('');

  $('#couponsTableBody').html(html);

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('discounts', $('#contentArea'));
  }
}
