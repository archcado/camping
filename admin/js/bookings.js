/**
 * admin/js/bookings.js
 * 預約/租借管理模組
 *
 * 設計重點：
 *   1. 從 bookings.json 載入後存入 window.bookingsCache，避免重複 fetch
 *   2. 付款狀態 2 種：已付款 / 已退款（顧客結帳即付款，取消時自動退款）
 *   3. 訂單狀態 4 種：待確認 / 已確認 / 已完成 / 已取消
 *   4. 點擊預約單號開啟明細 Modal（#bookingDetailModal）
 *   5. 「確認預約」直接更新狀態 + Toast
 *   6. 「取消」開啟取消確認 Modal（#bookingCancelModal），填寫原因後確認
 *   7. 「標記已完成」在明細 Modal 內，僅 confirmed 狀態顯示
 *   8. 顧客姓名連結：設定 window.pendingCustomerId 後觸發切換至客戶管理
 *   9. KPI 導航：讀取 window.pendingNavFilter，預先套用日期 + 狀態篩選
 *  10. 篩選：欄位標頭漏斗 icon（付款狀態/訂單狀態/含租借/地區）多選 checkbox Dropdown
 *  11. 排序：預約單號、下單日期、訂單金額（可疊加，三段循環）
 *  12. 日期：快速選鈕（近7天/近30天/本月/近3個月/自定義）+ flatpickr
 *
 * 使用 jQuery Event Namespace (.bookings) 防止重複導覽時事件堆疊
 */

// ─────────────────────────────────────────────
// 模組層級狀態變數（不掛 window，避免污染全域）
// ─────────────────────────────────────────────

/**
 * 排序堆疊：依點擊時間順序排列
 * 每個元素：{ key: 'id' | 'submitted_at' | 'final_amount', dir: 'asc' | 'desc' }
 * 初始值設為下單日期降冪（最新預約在最上面）
 */
var bookingSortStack = [{ key: 'submitted_at', dir: 'desc' }];

/**
 * 篩選條件：各欄位目前勾選的值
 * 空陣列 = 不篩選（顯示全部）
 * dateStart / dateEnd 為 YYYY-MM-DD 字串，null = 不篩選
 */
var bookingFilterState = {
  paymentStatus: [],   // e.g. ['paid', 'refunded']
  bookingStatus: [],   // e.g. ['pending', 'confirmed']
  hasRental:     [],   // e.g. ['true', 'false']
  region:        [],   // e.g. ['北部', '中部']
  dateStart:     null, // e.g. '2026-05-23'
  dateEnd:       null  // e.g. '2026-06-22'
};

/**
 * 日期快速選鈕狀態
 * days: 7 | 30 | 90 | 'month' | 'custom' | 'all'
 *   'all'    = 無日期限制（無任何按鈕 active）
 *   'custom' = 由 flatpickr 自選
 * startDate / endDate 為 Date 物件，供 updateBookingPeriodLabel 格式化文字使用
 */
var bookingDateState = { days: 30, startDate: null, endDate: null };
var bookingViewState = {
  activeView: 'stays',
  searchTerm: '',
  rentalStatus: '',
  rentalPayment: '',
  rentalOverdue: '',
};
var bookingCalendarState = {
  currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
};
var BOOKING_CALENDAR_MAX_EVENTS_PER_DAY = 3;
var BOOKING_REQUIRED_SELECTORS = [
  '#bookingsTable',
  '#bookingsTableBody',
  '#bookingPeriodBtns',
  '#bookingDateRangePicker',
  '#bookingPeriodLabel',
  '#btnClearBookingSort',
  '#btnClearBookingFilters',
  '#bookingResultCount',
  '#bookingsSearchInput',
  '#bookingCalendarGrid',
  '#bookingCalendarLabel',
  '#rentalBookingsTableBody',
  '#rentalStatusFilter',
  '#rentalPaymentFilter',
  '#rentalOverdueFilter',
  '#bookingDetailModal',
  '#bookingCancelModal',
];
var DEFAULT_BOOKING_SORT = [{ key: 'submitted_at', dir: 'desc' }];
var DEFAULT_RENTAL_SORT = [{ key: 'rental_start', dir: 'desc' }];

// ─────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────

window.initBookings = function () {
  // 移除舊有事件，防止切換頁面時事件重複綁定
  // 同時清除 orders 的事件：兩個模組共用 .sortable-th / .filter-icon / .filter-dropdown 選擇器，
  // 若 orders 事件殘留，點擊漏斗 icon 會被雙重觸發（toggle 兩次 = 無效果）
  $(document).off('.orders');
  $(document).off('.bookings');

  // ── 每次進入預約頁重置排序與篩選狀態 ──
  bookingSortStack = [];
  bookingFilterState = { paymentStatus: [], bookingStatus: [], hasRental: [], region: [], dateStart: null, dateEnd: null };
  bookingDateState = { days: 30, startDate: null, endDate: null };
  bookingViewState = { activeView: 'stays', searchTerm: '', rentalStatus: '', rentalPayment: '', rentalOverdue: '' };
  bookingCalendarState = { currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1) };

  if (!validateBookingsDom()) {
    return;
  }

  // ── 初始化日期篩選器 UI ─────────────────────────
  setupBookingPeriodFilter(); // 綁定快速選鈕點擊事件
  initBookingFlatpickr();     // 初始化 flatpickr

  // ── 讀取並消費 pendingNavFilter（從 KPI 卡片點擊跳來時） ──
  if (window.pendingNavFilter && window.pendingNavFilter.section === 'bookings') {
    var nav = window.pendingNavFilter;
    // 單字串包裝成陣列，對應新的 filterState 陣列格式
    if (nav.bookingStatus) bookingFilterState.bookingStatus = [nav.bookingStatus];
    if (nav.paymentStatus) bookingFilterState.paymentStatus = [nav.paymentStatus];
    window.pendingNavFilter = null; // 消費後立即清除，避免切換回來時重複套用

    if (nav.dateStart && nav.dateEnd) {
      // KPI 帶日期 → 自定義範圍
      applyBookingCustomRange(nav.dateStart, nav.dateEnd);
    } else {
      // KPI 不帶日期 → 無日期限制，全部期間
      applyBookingDayRange('all');
    }
  } else {
    // 一般進入預約管理頁：預設顯示「近 30 天」
    applyBookingDayRange(30);
  }
  // 注意：applyBookingDayRange / applyBookingCustomRange 內部已呼叫 applyBookingFiltersAndSort()
  // 若快取尚未就緒，下面的資料載入 callback 會再呼叫一次 applyBookingFiltersAndSort()

  // ── 確保 customersCache 已載入，再載入 bookings ──
  // 顧客姓名查詢需要 customersCache；若直接進入預約管理頁則先 fetch
  if (window.customersCache && window.customersCache.length > 0) {
    loadBookingsData();
  } else {
    $.getJSON('data/customers.json', function (customers) {
      window.customersCache = customers;
      loadBookingsData();
    }).fail(function () {
      // customers 載入失敗不阻斷 bookings 渲染（顧客名稱顯示 id 即可）
      loadBookingsData();
    });
  }

  // ── 排序：點擊 .sortable-th 標頭 ──────────────────
  // 三段式循環：無排序 → asc ↑ → desc ↓ → 移除（回無排序）
  $(document).on('click.bookings', '.sortable-th', function () {
    var key = $(this).data('sort-key'); // 欄位 key：id / submitted_at / final_amount
    var idx = bookingSortStack.findIndex(function (s) { return s.key === key; });

    if (idx === -1) {
      // 此欄尚未在排序堆疊中 → 加入，預設升冪
      bookingSortStack.push({ key: key, dir: 'asc' });
    } else if (bookingSortStack[idx].dir === 'asc') {
      // 目前升冪 → 改為降冪
      bookingSortStack[idx].dir = 'desc';
    } else {
      // 目前降冪 → 從堆疊移除（回無排序）
      bookingSortStack.splice(idx, 1);
    }

    applyBookingFiltersAndSort();
  });

  // ── 篩選 Dropdown 開關：點擊漏斗 icon ──────────────
  // 點擊 .filter-icon → 顯示/隱藏同一個 th 內的 .filter-dropdown
  $(document).on('click.bookings', '.filter-icon', function (e) {
    e.stopPropagation(); // 防止冒泡到 document，避免立即被關閉
    var $th = $(this).closest('.filter-th');
    var $dropdown = $th.find('.filter-dropdown');

    // 先關閉所有其他已開啟的 Dropdown，再 toggle 當前的
    $('.filter-dropdown').not($dropdown).addClass('d-none');
    $dropdown.toggleClass('d-none');
  });

  // ── 點擊 Dropdown 內部（checkbox / label）時，阻止冒泡關閉 ──
  $(document).on('click.bookings', '.filter-dropdown', function (e) {
    e.stopPropagation();
  });

  // ── 點擊頁面其他地方 → 關閉所有 Dropdown ──────────
  $(document).on('click.bookings', function () {
    $('.filter-dropdown').addClass('d-none');
  });

  // ── 篩選 checkbox 勾選/取消 ────────────────────────
  $(document).on('change.bookings', '.filter-dropdown input[type="checkbox"]', function () {
    var $th  = $(this).closest('.filter-th');
    var key  = $th.data('filter-key'); // 'paymentStatus' / 'bookingStatus' / 'hasRental' / 'region'

    // 收集該欄位所有勾選中的 checkbox 值
    var selected = [];
    $th.find('input[type="checkbox"]:checked').each(function () {
      selected.push($(this).val());
    });

    bookingFilterState[key] = selected;
    applyBookingFiltersAndSort();
  });

  // ── 清除排序按鈕 ───────────────────────────────────
  $(document).on('click.bookings', '#btnClearBookingSort', function () {
    bookingSortStack = [];
    applyBookingFiltersAndSort();
  });

  // ── 清除篩選按鈕 ───────────────────────────────────
  $(document).on('click.bookings', '#btnClearBookingFilters', function () {
    bookingFilterState.paymentStatus = [];
    bookingFilterState.bookingStatus = [];
    bookingFilterState.hasRental = [];
    bookingFilterState.region = [];
    bookingViewState.searchTerm = '';
    bookingViewState.rentalStatus = '';
    bookingViewState.rentalPayment = '';
    bookingViewState.rentalOverdue = '';
    if (bookingDateState.days === 'custom') {
      $('#bookingDateRangePicker').hide().val('');
      applyBookingDayRange('all');
    } else {
      applyBookingFiltersAndSort();
    }
  });

  $(document).on('input.bookings', '#bookingsSearchInput', function () {
    bookingViewState.searchTerm = String($(this).val() || '').trim().toLowerCase();
    applyBookingFiltersAndSort();
  });

  $(document).on('change.bookings', '#rentalStatusFilter, #rentalPaymentFilter, #rentalOverdueFilter', function () {
    bookingViewState.rentalStatus = $('#rentalStatusFilter').val() || '';
    bookingViewState.rentalPayment = $('#rentalPaymentFilter').val() || '';
    bookingViewState.rentalOverdue = $('#rentalOverdueFilter').val() || '';
    applyBookingFiltersAndSort();
  });

  $(document).on('click.bookings', '[data-bookings-view]', function () {
    var view = $(this).data('bookings-view');
    if (!view || bookingViewState.activeView === view) {
      return;
    }
    bookingViewState.activeView = view;
    bookingSortStack = [];
    syncBookingViewPanels();
    applyBookingFiltersAndSort();
  });

  $(document).on('click.bookings', '#bookingCalendarPrevMonth', function () {
    bookingCalendarState.currentMonth = new Date(
      bookingCalendarState.currentMonth.getFullYear(),
      bookingCalendarState.currentMonth.getMonth() - 1,
      1
    );
    if (bookingViewState.activeView === 'calendar') {
      applyBookingFiltersAndSort();
    }
  });

  $(document).on('click.bookings', '#bookingCalendarNextMonth', function () {
    bookingCalendarState.currentMonth = new Date(
      bookingCalendarState.currentMonth.getFullYear(),
      bookingCalendarState.currentMonth.getMonth() + 1,
      1
    );
    if (bookingViewState.activeView === 'calendar') {
      applyBookingFiltersAndSort();
    }
  });

  $(document).on('click.bookings', '#bookingCalendarToday', function () {
    bookingCalendarState.currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (bookingViewState.activeView === 'calendar') {
      applyBookingFiltersAndSort();
    }
  });

  // ── 點擊預約單號 → 開啟明細 Modal ────────────────────────────
  $(document).on('click.bookings', '.booking-id-link', function () {
    var bookingId = $(this).data('booking-id');
    var booking = (window.bookingsCache || []).find(function (b) {
      return b.id === bookingId;
    });
    if (!booking) return;
    showBookingModal(booking);
  });

  $(document).on('click.bookings', '.booking-calendar-item, .rental-booking-link', function (e) {
    e.preventDefault();
    var bookingId = $(this).data('booking-id');
    var booking = (window.bookingsCache || []).find(function (b) {
      return b.id === bookingId;
    });
    if (!booking) return;
    showBookingModal(booking);
  });

  // ── 確認預約按鈕 ──────────────────────────────────────────────
  // 直接更新狀態為 confirmed，不需額外確認框（正向操作）
  $(document).on('click.bookings', '.btn-confirm-booking', function () {
    var $btn = $(this);
    var $row = $btn.closest('tr');
    var bookingId = $row.data('booking-id');

    var booking = (window.bookingsCache || []).find(function (b) {
      return b.id === bookingId;
    });
    if (!booking) return;

    // 更新記憶體快取
    booking.status = 'confirmed';
    var timeStr = getCurrentTimeStr();
    booking.history = booking.history || [];
    booking.history.push({ time: timeStr, action: '已確認預約' });

    // 更新畫面：badge、data 屬性、操作欄
    $row.find('.booking-status-badge')
        .replaceWith(renderBookingStatusTag('confirmed'));
    $row.attr('data-booking-status', 'confirmed');

    // 確認後操作欄改為只顯示「取消」
    $row.find('.btn-confirm-booking').remove();

    applyBookingFiltersAndSort();
    window.showAdminToast('預約 ' + bookingId + ' 已確認');
  });

  // ── 取消按鈕 → 開啟取消確認 Modal ───────────────────────────
  $(document).on('click.bookings', '.btn-cancel-booking', function () {
    var $row = $(this).closest('tr');
    // 暫存目標 booking id，供 #confirmCancelBtn click 讀取
    window._cancelTargetId = $row.data('booking-id');
    // 清空上次輸入的原因
    $('#cancelReasonInput').val('');
    new bootstrap.Modal('#bookingCancelModal').show();
  });

  // ── 確認取消（取消 Modal 內的按鈕）─────────────────────────
  $(document).on('click.bookings', '#confirmCancelBtn', function () {
    var bookingId = window._cancelTargetId;
    if (!bookingId) return;

    var reason = $('#cancelReasonInput').val().trim();
    var actionText = reason
      ? '已取消（原因：' + reason + '）'
      : '已取消';

    var booking = (window.bookingsCache || []).find(function (b) {
      return b.id === bookingId;
    });
    if (booking) {
      booking.status = 'cancelled';
      booking.payment_status = 'refunded';
      var timeStr = getCurrentTimeStr();
      booking.history = booking.history || [];
      booking.history.push({ time: timeStr, action: actionText });
      booking.history.push({ time: timeStr, action: '已退款' });
    }

    // 更新畫面上的 badge
    var $row = $('#bookingsTableBody tr[data-booking-id="' + bookingId + '"]');
    $row.find('.booking-status-badge')
        .replaceWith(renderBookingStatusTag('cancelled'));
    $row.attr('data-booking-status', 'cancelled');
    $row.attr('data-payment-status', 'refunded');
    $row.find('.payment-status-badge').replaceWith(getPayBadgeHtml('refunded'));
    $row.find('.equipment-return-badge').replaceWith(getEquipmentReturnBadgeHtml(booking));
    // 清空操作欄（已取消無操作）
    $row.find('td:last-child').empty();

    // 關閉 Modal
    bootstrap.Modal.getInstance(document.getElementById('bookingCancelModal')).hide();
    window._cancelTargetId = null;

    applyBookingFiltersAndSort();
    window.showAdminToast('預約 ' + bookingId + ' 已取消', 'info');
  });

  // ── 顧客名稱連結 → 切換至客戶管理並展開該顧客 ───────────────
  $(document).on('click.bookings', '.booking-customer-link', function (e) {
    e.preventDefault();
    var customerId = $(this).data('customer-id');
    // 設定全域目標顧客 id，customers.js 渲染後會讀取此值並自動展開
    window.pendingCustomerId = customerId;
    // 觸發 Sidebar 切換至客戶管理（桌面版第一個符合的連結）
    $('.sidebar-link[data-section="customers"]').first().trigger('click');
  });

  // ── 標記已完成（在明細 Modal 內）──────────────────────────
  $(document).on('click.bookings', '#btnCompleteBooking', function () {
    var bookingId = $('#bkModalId').text();
    var booking = (window.bookingsCache || []).find(function (b) {
      return b.id === bookingId;
    });
    if (!booking) return;

    booking.status = 'completed';
    booking.equipment_returned = true;
    var timeStr = getCurrentTimeStr();
    booking.history = booking.history || [];
    booking.history.push({ time: timeStr, action: '已完成' });

    // 更新表格列的 badge
    var $row = $('#bookingsTableBody tr[data-booking-id="' + bookingId + '"]');
    $row.find('.booking-status-badge')
        .replaceWith(renderBookingStatusTag('completed'));
    $row.attr('data-booking-status', 'completed');
    $row.find('.equipment-return-badge').replaceWith(getEquipmentReturnBadgeHtml(booking));
    // 已完成無操作按鈕
    $row.find('td:last-child').empty();

    // 關閉 Modal
    bootstrap.Modal.getInstance(document.getElementById('bookingDetailModal')).hide();

    applyBookingFiltersAndSort();
    window.showAdminToast('預約 ' + bookingId + ' 已標記為完成');
  });

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('bookings', $('#contentArea'));
  }
  syncBookingViewPanels();
};

// ─────────────────────────────────────────────
// 資料載入
// ─────────────────────────────────────────────

/**
 * 載入 bookings.json（若快取已存在則不重新 fetch），載入後觸發管線
 * 需在 customersCache 確認後呼叫
 */
function loadBookingsData() {
  if (window.bookingsCache && window.bookingsCache.length > 0) {
    window.bookingsCache = window.bookingsCache.map(normalizeBookingRecord);
    applyBookingFiltersAndSort();
  } else {
    $.getJSON('data/bookings.json', function (bookings) {
      if (!Array.isArray(bookings)) {
        renderBookingsMessage('預約資料格式錯誤');
        renderRentalBookingsMessage('租借資料格式錯誤');
        renderBookingCalendarMessage('預約資料格式錯誤');
        updateBookingResultCount(0, 'error', '資料格式錯誤');
        return;
      }
      window.bookingsCache = bookings.map(normalizeBookingRecord);
      applyBookingFiltersAndSort();
    }).fail(function () {
      renderBookingsMessage('載入預約數據失敗');
      renderRentalBookingsMessage('載入租借資料失敗');
      renderBookingCalendarMessage('載入預約資料失敗');
      updateBookingResultCount(0, 'error', '載入失敗');
    });
  }
}

// ─────────────────────────────────────────────
// 日期篩選器輔助函式（對齊 orders.js 架構）
// ─────────────────────────────────────────────

/**
 * 將 Date 物件格式化為 "YYYY/MM/DD" 字串，供期間標籤顯示
 * @param {Date} d
 * @returns {string}
 */
function fmtBookingDate(d) {
  if (!d) return '';
  return d.getFullYear() + '/' +
    String(d.getMonth() + 1).padStart(2, '0') + '/' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * 將 Date 物件格式化為 "YYYY-MM-DD" 字串，供 filterState 使用
 * @param {Date} d
 * @returns {string|null}
 */
function fmtBookingDateISO(d) {
  if (!d) return null;
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * 依 days 數值計算起迄日，更新 bookingDateState 和 filterState，
 * 再刷新期間文字與表格資料
 *
 * @param {number|string} days - 7 | 30 | 90 | 'month' | 'all'
 *   'all' = 清空日期（無限制，全部顯示）
 */
function applyBookingDayRange(days) {
  if (days === 'all') {
    // 清空日期限制
    bookingDateState.days      = 'all';
    bookingDateState.startDate = null;
    bookingDateState.endDate   = null;
    bookingFilterState.dateStart = null;
    bookingFilterState.dateEnd   = null;
  } else if (days === 'month') {
    // 本月：從本月 1 日到今天
    var now   = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);

    bookingDateState.days      = 'month';
    bookingDateState.startDate = start;
    bookingDateState.endDate   = new Date(now);
    bookingFilterState.dateStart = fmtBookingDateISO(start);
    bookingFilterState.dateEnd   = fmtBookingDateISO(new Date(now));
  } else {
    // 往前推 days-1 天（含今天共 days 天）
    var now   = new Date();
    var start = new Date(now);
    start.setDate(start.getDate() - (days - 1));

    bookingDateState.days      = days;
    bookingDateState.startDate = start;
    bookingDateState.endDate   = new Date(now);
    bookingFilterState.dateStart = fmtBookingDateISO(start);
    bookingFilterState.dateEnd   = fmtBookingDateISO(new Date(now));
  }
  // 非 custom 模式：收起 flatpickr input
  if (days !== 'custom') {
    $('#bookingDateRangePicker').hide();
  }
  updateBookingPeriodLabel();
  applyBookingFiltersAndSort();
}

/**
 * 接受兩個 YYYY-MM-DD 字串，設定為自定義日期範圍，
 * 更新 bookingDateState 和 filterState，再刷新表格
 *
 * @param {string} dateStart - e.g. '2026-05-23'
 * @param {string} dateEnd   - e.g. '2026-06-22'
 */
function applyBookingCustomRange(dateStart, dateEnd) {
  bookingDateState.days      = 'custom';
  bookingDateState.startDate = dateStart ? new Date(dateStart + 'T00:00:00') : null;
  bookingDateState.endDate   = dateEnd   ? new Date(dateEnd   + 'T00:00:00') : null;
  bookingFilterState.dateStart = dateStart || null;
  bookingFilterState.dateEnd   = dateEnd   || null;
  updateBookingPeriodLabel();
  applyBookingFiltersAndSort();
}

/**
 * 依 bookingDateState 更新期間文字標籤 #bookingPeriodLabel
 * 以及 #bookingPeriodBtns 各按鈕的 active 樣式
 */
function updateBookingPeriodLabel() {
  var days = bookingDateState.days;

  // 更新按鈕群 active 狀態
  $('#bookingPeriodBtns button').removeClass('active');
  if (days !== 'all') {
    $('#bookingPeriodBtns button[data-days="' + days + '"]').addClass('active');
  }

  // 更新期間文字標籤
  if (days === 'all') {
    $('#bookingPeriodLabel').text('全部期間');
  } else if (bookingDateState.startDate && bookingDateState.endDate) {
    $('#bookingPeriodLabel').text(
      fmtBookingDate(bookingDateState.startDate) + ' ～ ' + fmtBookingDate(bookingDateState.endDate)
    );
  } else {
    $('#bookingPeriodLabel').text('');
  }
}

/**
 * 初始化 #bookingDateRangePicker 的 flatpickr 日期範圍選擇器
 * mode: range，繁體中文語系，格式 Y-m-d
 */
function initBookingFlatpickr() {
  if (typeof flatpickr === 'undefined') return; // CDN 未載入時安全跳過

  var locale = (flatpickr.l10ns && flatpickr.l10ns.zh_tw)
    ? flatpickr.l10ns.zh_tw
    : 'default';

  flatpickr('#bookingDateRangePicker', {
    mode: 'range',
    dateFormat: 'Y-m-d',
    locale: locale,
    onClose: function (selectedDates) {
      // 必須兩個日期都選完才觸發；只選一個就關閉時維持上一次狀態
      if (selectedDates.length === 2) {
        var start = fmtBookingDateISO(selectedDates[0]);
        var end   = fmtBookingDateISO(selectedDates[1]);
        applyBookingCustomRange(start, end);
      }
    }
  });
}

/**
 * 綁定 #bookingPeriodBtns 內按鈕的點擊事件
 *
 * 行為：
 *  - 點擊「近 7 天 / 近 30 天 / 近 3 個月」：
 *      • 若該按鈕已 active → toggle off，回到「全部期間」
 *      • 否則 → 套用對應天數
 *  - 點擊「本月」：已 active → 全部期間；否則 → 套用本月
 *  - 點擊「自定義」：顯示 flatpickr input 並觸發開啟
 */
function setupBookingPeriodFilter() {
  $(document).on('click.bookings', '#bookingPeriodBtns button[data-days]', function () {
    var days = $(this).data('days');

    if (days === 'custom') {
      // 顯示 flatpickr input 並開啟選擇器
      $('#bookingDateRangePicker').show().trigger('click');
    } else if (days === 'month') {
      if ($(this).hasClass('active')) {
        applyBookingDayRange('all');
      } else {
        applyBookingDayRange('month');
      }
    } else if ($(this).hasClass('active')) {
      // 再次點擊已 active 的按鈕 → 取消，回到「全部期間」
      applyBookingDayRange('all');
    } else {
      applyBookingDayRange(parseInt(days, 10));
    }
  });
}

// ─────────────────────────────────────────────
// 核心資料管線
// ─────────────────────────────────────────────

/**
 * 依目前的 bookingFilterState 篩選、依 bookingSortStack 排序，再重新渲染表格
 * 所有排序/篩選條件變動後都呼叫此函式
 */
function applyBookingFiltersAndSort() {
  // 複製陣列，確保不改動 window.bookingsCache 原始資料
  var data = (window.bookingsCache || []).slice();

  // ── Step 1：篩選 ──────────────────────────────────

  // 付款狀態篩選（OR）：有勾選時才篩；空陣列 = 顯示全部
  if (bookingFilterState.paymentStatus.length > 0) {
    data = data.filter(function (b) {
      return bookingFilterState.paymentStatus.indexOf(b.payment_status) !== -1;
    });
  }

  // 訂單狀態篩選（OR）：有勾選時才篩；空陣列 = 顯示全部
  if (bookingFilterState.bookingStatus.length > 0) {
    data = data.filter(function (b) {
      return bookingFilterState.bookingStatus.indexOf(b.status) !== -1;
    });
  }

  // 含租借篩選（OR）：比對 selected_rentals.length > 0
  // checkbox value 為字串 'true'/'false'，需轉換後比對
  if (bookingFilterState.hasRental.length > 0) {
    data = data.filter(function (b) {
      var hasRentalStr = (b.selected_rentals && b.selected_rentals.length > 0) ? 'true' : 'false';
      return bookingFilterState.hasRental.indexOf(hasRentalStr) !== -1;
    });
  }

  // 地區篩選（OR）：來自 booking_info.region
  if (bookingFilterState.region.length > 0) {
    data = data.filter(function (b) {
      return bookingFilterState.region.indexOf(b.booking_info.region) !== -1;
    });
  }

  // 日期範圍篩選：依 submitted_at 欄位（格式 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS）
  if (bookingFilterState.dateStart) {
    data = data.filter(function (b) {
      return (b.submitted_at || '').slice(0, 10) >= bookingFilterState.dateStart;
    });
  }
  if (bookingFilterState.dateEnd) {
    data = data.filter(function (b) {
      return (b.submitted_at || '').slice(0, 10) <= bookingFilterState.dateEnd;
    });
  }

  if (bookingViewState.searchTerm) {
    data = data.filter(function (b) {
      return getBookingSearchText(b).indexOf(bookingViewState.searchTerm) !== -1;
    });
  }

  // ── Step 2：排序 ──────────────────────────────────
  // 依 bookingSortStack 的優先順序逐層比較（多鍵穩定排序）
  var activeSortStack = getActiveBookingSortStack();
  if (bookingViewState.activeView === 'rentals') {
    var rentalRecords = buildFilteredRentalRecords(data);
    if (activeSortStack.length > 0) {
      rentalRecords.sort(function (a, b) {
        for (var i = 0; i < activeSortStack.length; i++) {
          var rentalKey = activeSortStack[i].key;
          var rentalDir = activeSortStack[i].dir === 'asc' ? 1 : -1;
          var rentalValA = getBookingSortValue(a, rentalKey);
          var rentalValB = getBookingSortValue(b, rentalKey);

          if (rentalValA < rentalValB) return -1 * rentalDir;
          if (rentalValA > rentalValB) return 1 * rentalDir;
        }
        return 0;
      });
    }
    syncBookingViewPanels();
    renderRentalBookingsTable(rentalRecords);
    updateBookingSortUI();
    updateBookingFilterUI();
    return;
  }

  if (activeSortStack.length > 0) {
    data.sort(function (a, b) {
      for (var i = 0; i < activeSortStack.length; i++) {
        var key = activeSortStack[i].key;
        var dir = activeSortStack[i].dir === 'asc' ? 1 : -1;
        var valA = getBookingSortValue(a, key);
        var valB = getBookingSortValue(b, key);

        if (valA < valB) return -1 * dir;
        if (valA > valB) return  1 * dir;
        // 相等時繼續比下一層
      }
      return 0;
    });
  }

  // ── Step 3：渲染 + 更新 UI ────────────────────────
  syncBookingViewPanels();
  if (bookingViewState.activeView === 'calendar') {
    renderBookingCalendar(data);
  } else {
    renderBookingsTable(data);
  }
  updateBookingSortUI();
  updateBookingFilterUI();
}

// ─────────────────────────────────────────────
// UI 同步更新
// ─────────────────────────────────────────────

/**
 * 依 bookingSortStack 更新欄位標頭的箭頭 icon 和「清除排序」按鈕的顯隱
 */
function updateBookingSortUI() {
  // 所有排序 icon 先重置為雙箭頭（灰色、未排序狀態）
  $('.sort-icon')
    .removeClass('fa-sort-up fa-sort-down sort-active')
    .addClass('fa-sort');

  // 依 bookingSortStack 設定對應欄位的箭頭方向和顏色
  bookingSortStack.forEach(function (s) {
    var $icon = $('.sortable-th[data-sort-key="' + s.key + '"] .sort-icon');
    $icon
      .removeClass('fa-sort')
      .addClass(s.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down')
      .addClass('sort-active'); // 換成品牌色
  });

  // 有排序條件時顯示「清除排序」按鈕；否則隱藏
  // bookingSortStack 長度 > 1 或第一層不是預設的日期降冪 → 視為「有排序」
  if (bookingSortStack.length === 0) {
    $('#btnClearBookingSort').addClass('d-none');
  } else {
    $('#btnClearBookingSort').removeClass('d-none');
  }
}

/**
 * 依 bookingFilterState 更新漏斗 icon 的顏色和紅點的顯隱
 * 同時同步 checkbox 的勾選狀態（讓 pendingNavFilter 套用後 UI 可見）
 * 同時同步日期按鈕 active 狀態與期間文字標籤
 */
function updateBookingFilterUI() {
  // 遍歷四個可篩選的欄位（漏斗 icon + 紅點）
  ['paymentStatus', 'bookingStatus', 'hasRental', 'region'].forEach(function (key) {
    var $th   = $('.filter-th[data-filter-key="' + key + '"]');
    var $icon = $th.find('.filter-icon');
    var $dot  = $th.find('.filter-dot');

    if (bookingFilterState[key].length > 0) {
      // 有啟用中的篩選條件：icon 變品牌色 + 顯示紅點
      $icon.addClass('active');
      $dot.removeClass('d-none');
      // 同步 checkbox 勾選狀態（KPI 跳來時讓 UI 可見）
      $th.find('input[type="checkbox"]').each(function () {
        $(this).prop('checked', bookingFilterState[key].indexOf($(this).val()) !== -1);
      });
    } else {
      // 無篩選條件：icon 回灰色 + 隱藏紅點 + 取消所有勾選
      $icon.removeClass('active');
      $dot.addClass('d-none');
      $th.find('input[type="checkbox"]').prop('checked', false);
    }
  });

  // 同步日期篩選器按鈕 active 狀態與期間文字標籤
  updateBookingPeriodLabel();

  var hasFilter =
    bookingFilterState.paymentStatus.length > 0 ||
    bookingFilterState.bookingStatus.length > 0 ||
    bookingFilterState.hasRental.length > 0 ||
    bookingFilterState.region.length > 0 ||
    Boolean(bookingViewState.searchTerm) ||
    Boolean(bookingViewState.rentalStatus) ||
    Boolean(bookingViewState.rentalPayment) ||
    Boolean(bookingViewState.rentalOverdue);
  $('#bookingsSearchInput').val(bookingViewState.searchTerm);
  $('#rentalStatusFilter').val(bookingViewState.rentalStatus);
  $('#rentalPaymentFilter').val(bookingViewState.rentalPayment);
  $('#rentalOverdueFilter').val(bookingViewState.rentalOverdue);
  $('#btnClearBookingFilters').toggleClass('d-none', !hasFilter);
}

// ═══════════════════════════════════════════════════════════════
// renderBookingsTable(bookings)
// 將 bookings 陣列渲染成 HTML 表格列，填入 #bookingsTableBody
// ═══════════════════════════════════════════════════════════════
/**
 * @param {Array} bookings - 已篩選並排序完畢的預約陣列
 */
function renderBookingsTable(bookings) {
  if (!bookings || bookings.length === 0) {
    renderBookingsMessage('沒有符合條件的預約');
    updateBookingResultCount(0, 'empty');
    return;
  }

  var html = bookings.map(function (booking) {
    var info = booking.booking_info;

    // ── 付款 / 狀態 badge ──
    var payBadge    = getPayBadgeHtml(booking.payment_status);
    var statusBadge = renderBookingStatusTag(booking.status);
    var equipmentBadge = getEquipmentReturnBadgeHtml(booking);

    // ── 含租借 badge（同時計算 hasRental 字串供 data 屬性使用）──
    var hasRental = booking.selected_rentals && booking.selected_rentals.length > 0;
    var rentalBadge = hasRental
      ? '<span class="yr-admin-booking-rental-flag yr-admin-booking-rental-flag--yes">有租借</span>'
      : '<span class="yr-admin-booking-rental-flag yr-admin-booking-rental-flag--none">無租借</span>';

    // ── 操作按鈕（依狀態顯示）──
    var actionBtns = '';
    if (booking.status === 'pending') {
      actionBtns =
        '<button class="btn btn-sm btn-outline-primary btn-confirm-booking yr-admin-bookings-action-btn yr-admin-bookings-action-btn--primary me-1" ' +
        'title="確認預約"><i class="fas fa-check me-1"></i>確認預約</button>' +
        '<button class="btn btn-sm btn-outline-danger btn-cancel-booking yr-admin-bookings-action-btn yr-admin-bookings-action-btn--danger" ' +
        'title="取消預約"><i class="fas fa-times me-1"></i>取消</button>';
    } else if (booking.status === 'confirmed') {
      actionBtns =
        '<button class="btn btn-sm btn-outline-danger btn-cancel-booking yr-admin-bookings-action-btn yr-admin-bookings-action-btn--danger" ' +
        'title="取消預約"><i class="fas fa-times me-1"></i>取消</button>';
    }
    if (!actionBtns) {
      actionBtns = '<span class="text-muted small">—</span>';
    }

    // ── 訂單金額 ──
    var finalAmount = (booking.summary && booking.summary.final_amount) || 0;
    var amountStr = 'NT$ ' + finalAmount.toLocaleString();

    var campStr = info.campground_name;
    var zoneSummary = (booking.selected_zones || []).map(function (zone) {
      return zone.zone_type + ' x' + zone.quantity;
    }).join('<br>');

    // ── 預約單號連結 ──
    var idLink =
      '<span class="booking-id-link text-primary fw-semibold" ' +
      'data-booking-id="' + booking.id + '" ' +
      'style="cursor:pointer; text-decoration:underline dotted;" ' +
      'title="點擊查看預約明細">' + booking.id + '</span>';

    // ── 顧客姓名超連結 ──
    var customerLink =
      '<a href="#" class="booking-customer-link text-decoration-underline" ' +
      'data-customer-id="' + booking.customer_id + '" ' +
      'title="查看顧客檔案">' +
      getCustomerName(booking.customer_id) +
      '</a>';

    // ── <tr> 包含新增的 data-region 和 data-has-rental 屬性 ──
    return '<tr data-booking-id="' + booking.id + '"' +
           ' class="yr-admin-bookings-row"' +
           ' data-booking-status="' + booking.status + '"' +
           ' data-payment-status="' + booking.payment_status + '"' +
           ' data-submitted-at="' + (booking.submitted_at || '').slice(0, 10) + '"' +
           ' data-region="' + info.region + '"' +
           ' data-has-rental="' + (hasRental ? 'true' : 'false') + '">' +
           '<td class="yr-admin-booking-id">' + idLink + '</td>' +
           '<td>' + escapeHtml(info.check_in || '') + '</td>' +
           '<td>' + escapeHtml(info.check_out || '') + '</td>' +
           '<td>' + customerLink + '</td>' +
           '<td class="text-end yr-admin-booking-amount">' + amountStr + '</td>' +
           '<td><div class="fw-semibold">' + escapeHtml(campStr) + '</div><div class="text-muted small">' + (zoneSummary || '—') + '</div></td>' +
           '<td class="text-center"><div class="yr-admin-booking-rental-stack">' + rentalBadge + equipmentBadge + '</div></td>' +
           '<td class="yr-admin-bookings-status-col">' + payBadge + '</td>' +
           '<td class="yr-admin-bookings-status-col">' + statusBadge + '</td>' +
           '<td>' + escapeHtml(info.region || '') + '</td>' +
           '<td class="yr-admin-bookings-actions">' + actionBtns + '</td>' +
           '</tr>';
  }).join('');

  $('#bookingsTableBody').html(html);
  updateBookingResultCount(bookings.length, 'normal');

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('bookings', $('#contentArea'));
  }
}

// ═══════════════════════════════════════════════════════════════
// showBookingModal(booking)
// 將預約資料填入 #bookingDetailModal 並開啟
// ═══════════════════════════════════════════════════════════════
/**
 * @param {Object} booking - 來自 window.bookingsCache 的單筆預約物件
 */
function showBookingModal(booking) {
  if (!booking || !booking.booking_info) {
    $('#bkModalHistory').html('<li class="yr-admin-bookings-error"><i class="fas fa-circle-exclamation me-2"></i>預約資料不存在</li>');
    return;
  }
  var info    = booking.booking_info;
  var rentals = booking.selected_rentals || [];
  var zones   = booking.selected_zones   || [];
  var summary = booking.summary          || {};

  // ── 標題：預約單號 + 狀態 badge ──
  $('#bkModalId').text(booking.id);

  $('#bkModalStatus').html(renderBookingStatusTag(booking.status));

  // ── 訂購人資訊（需查詢 customersCache 取得電話/Email）──
  var customerName  = getCustomerName(booking.customer_id);
  var customerPhone = getCustomerField(booking.customer_id, 'phone');
  var customerEmail = getCustomerField(booking.customer_id, 'email');
  $('#bkModalName').text(customerName);
  $('#bkModalPhone').text(customerPhone || '—');
  $('#bkModalEmail').text(customerEmail || '—');
  $('#bkModalPaymentStatus').html(getPayBadgeHtml(booking.payment_status));

  // ── 住宿明細 ──
  var zoneRows = zones.map(function (z) {
    return '<tr>' +
      '<td>' + z.zone_type + '</td>' +
      '<td class="text-center">× ' + z.quantity + ' 個營位</td>' +
      '<td class="text-end">NT$ ' + z.subtotal.toLocaleString() + '</td>' +
      '</tr>';
  }).join('');

  $('#bkModalStayDetail').html(
    '<div class="mb-2 text-muted small">' +
    '<i class="fas fa-campground me-1"></i>' + info.campground_name +
    '&ensp;<span class="yr-admin-booking-status yr-admin-booking-status--unknown">' + info.region + '</span>' +
    '</div>' +
    '<div class="mb-2 text-muted small">' +
    '<i class="fas fa-calendar-alt me-1"></i>' +
    info.check_in + ' ～ ' + info.check_out +
    '（共 ' + info.total_days + ' 晚，平日 ' + info.weekday_count +
    ' 晚・假日 ' + info.holiday_count + ' 晚）' +
    '</div>' +
    '<div class="mb-2 text-muted small">' +
    '<i class="fas fa-users me-1"></i>' + info.guest_count + ' 人' +
    '</div>' +
    '<table class="table table-sm table-bordered mt-2 mb-0">' +
    '<thead class="table-light"><tr>' +
    '<th>營位類型</th><th class="text-center">數量</th><th class="text-end">小計</th>' +
    '</tr></thead>' +
    '<tbody>' + zoneRows + '</tbody>' +
    '</table>'
  );

  // ── 裝備租借明細 ──
  if (rentals.length === 0) {
    $('#bkModalRentalDetail').html(
      '<p class="text-muted small mb-0"><i class="fas fa-info-circle me-1"></i>本次未選擇租借裝備。</p>'
    );
  } else {
    var rentalRows = rentals.map(function (r) {
      return '<tr>' +
        '<td>' + r.name + '</td>' +
        '<td class="text-center">× ' + r.quantity + '</td>' +
        '<td class="text-end">NT$ ' + r.subtotal.toLocaleString() + '</td>' +
        '</tr>';
    }).join('');
    $('#bkModalRentalDetail').html(
      '<table class="table table-sm table-bordered mb-0">' +
      '<thead class="table-light"><tr>' +
      '<th>裝備名稱</th><th class="text-center">數量</th><th class="text-end">小計</th>' +
      '</tr></thead>' +
      '<tbody>' + rentalRows + '</tbody>' +
      '</table>'
    );
  }

  // ── 費用明細 ──
  var costHtml =
    '<div class="d-flex justify-content-between mb-1">' +
    '<span class="text-muted">住宿費</span>' +
    '<span>NT$ ' + (summary.zone_total || 0).toLocaleString() + '</span></div>' +
    '<div class="d-flex justify-content-between mb-1">' +
    '<span class="text-muted">裝備租借費</span>' +
    '<span>NT$ ' + (summary.rental_total || 0).toLocaleString() + '</span></div>';

  if (summary.applied_discount > 0) {
    costHtml +=
      '<div class="d-flex justify-content-between mb-1 yr-admin-booking-cost-discount">' +
      '<span><i class="fas fa-tag me-1"></i>租借折扣</span>' +
      '<span>- NT$ ' + summary.applied_discount.toLocaleString() + '</span></div>';
  }

  costHtml +=
    '<hr class="my-2">' +
    '<div class="d-flex justify-content-between fw-bold yr-admin-booking-detail-total">' +
    '<span>合計</span>' +
    '<span>NT$ ' + (summary.final_amount || 0).toLocaleString() + '</span></div>';

  $('#bkModalCostBreakdown').html(costHtml);

  // ── 裝備歸還區塊：僅 confirmed + 有租借時顯示 ──
  var showReturn = (booking.status === 'confirmed') && (rentals.length > 0);
  if (showReturn) {
    $('#equipmentReturnSection').removeClass('d-none');
    $('#equipmentReturnedCheck').prop('checked', booking.equipment_returned || false);
    var returnState = booking.equipment_returned ? 'returned' : 'pending';
    $('#equipmentReturnSection').find('.form-check-label').html(
      '確認裝備已全數歸還 &ensp;' + renderEquipmentReturnTag(returnState)
    );
  } else {
    $('#equipmentReturnSection').addClass('d-none');
    $('#equipmentReturnSection').find('.form-check-label').text('確認裝備已全數歸還');
  }

  // ── 完成按鈕：僅 confirmed 狀態顯示 ──
  if (booking.status === 'confirmed') {
    $('#btnCompleteBooking').removeClass('d-none');
  } else {
    $('#btnCompleteBooking').addClass('d-none');
  }

  // ── 狀態紀錄時間軸 ──
  var historyHtml = (booking.history || []).map(function (entry) {
    return '<li class="yr-admin-booking-history__item">' +
           '<span class="yr-admin-booking-history__dot" aria-hidden="true"></span>' +
           '<span><span class="yr-admin-booking-history__time">' + entry.time + '</span>' +
           '<span class="yr-admin-booking-history__action">' + entry.action + '</span></span>' +
           '</li>';
  }).join('');
  $('#bkModalHistory').html(historyHtml || '<li class="yr-admin-booking-history__item"><span class="yr-admin-booking-history__action text-muted">無紀錄</span></li>');

  // 開啟 Modal
  new bootstrap.Modal('#bookingDetailModal').show();

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('bookings', $('#contentArea'));
  }
}

function validateBookingsDom() {
  var missing = BOOKING_REQUIRED_SELECTORS.filter(function (selector) {
    return !$(selector).length;
  });
  if (missing.length === 0) {
    return true;
  }
  renderBookingsMessage('預約管理初始化失敗：缺少必要元件');
  renderRentalBookingsMessage('租借管理初始化失敗：缺少必要元件');
  renderBookingCalendarMessage('行事曆初始化失敗：缺少必要元件');
  updateBookingResultCount(0, 'error', '缺少必要元件');
  return false;
}

function normalizeBookingRecord(booking) {
  var normalized = booking || {};
  normalized.booking_info = normalized.booking_info || {};
  normalized.selected_zones = Array.isArray(normalized.selected_zones) ? normalized.selected_zones : [];
  normalized.selected_rentals = Array.isArray(normalized.selected_rentals) ? normalized.selected_rentals : [];
  normalized.summary = normalized.summary || {};
  normalized.history = Array.isArray(normalized.history) ? normalized.history : [];
  normalized.id = String(normalized.id || '');
  normalized.customer_id = String(normalized.customer_id || '');
  return normalized;
}

function syncBookingViewPanels() {
  var activeView = bookingViewState.activeView || 'stays';
  $('[data-bookings-view]').removeClass('active').attr('aria-pressed', 'false');
  $('[data-bookings-view="' + activeView + '"]').addClass('active').attr('aria-pressed', 'true');
  $('[data-bookings-panel]').addClass('d-none');
  $('[data-bookings-panel="' + activeView + '"]').removeClass('d-none');
  $('#rentalToolbarFilters').toggleClass('d-none', activeView !== 'rentals');
}

function getActiveBookingSortStack() {
  if (bookingSortStack.length > 0) {
    return bookingSortStack;
  }
  return bookingViewState.activeView === 'rentals' ? DEFAULT_RENTAL_SORT : DEFAULT_BOOKING_SORT;
}

function getBookingSortValue(record, key) {
  if (!record) return '';
  if (key === 'final_amount' || key === 'rental_amount') {
    return Number((record.summary && record.summary.final_amount) || record.rental_amount || 0);
  }
  if (key === 'submitted_at' || key === 'check_in' || key === 'check_out' || key === 'rental_start' || key === 'rental_end') {
    return String(record[key] || (record.booking_info && record.booking_info[key]) || '').slice(0, 10);
  }
  if (key === 'rental_quantity') {
    return Number(record.rental_quantity || 0);
  }
  if (key === 'rental_id') {
    return String(record.rental_id || '');
  }
  return String(record[key] || '');
}

function getBookingSearchText(booking) {
  var info = booking.booking_info || {};
  var rentals = (booking.selected_rentals || []).map(function (item) {
    return item.name || '';
  }).join(' ');
  var customerName = getCustomerName(booking.customer_id);
  var customerEmail = getCustomerField(booking.customer_id, 'email');
  return [
    booking.id,
    booking.customer_id,
    customerName,
    customerEmail,
    info.campground_name,
    info.region,
    rentals
  ].join(' ').toLowerCase();
}

function buildFilteredRentalRecords(bookings) {
  var today = fmtBookingDateISO(new Date());
  var records = [];
  bookings.forEach(function (booking) {
    (booking.selected_rentals || []).forEach(function (rental, index) {
      var record = {
        booking_id: booking.id,
        rental_id: booking.id + '-R' + String(index + 1).padStart(2, '0'),
        customer_id: booking.customer_id,
        customer_name: getCustomerName(booking.customer_id),
        product_name: rental.name || '',
        rental_product_id: String(rental.equipment_id || ''),
        rental_quantity: Number(rental.quantity || 0),
        rental_amount: Number(rental.subtotal || 0),
        rental_start: (booking.booking_info && booking.booking_info.check_in) || '',
        rental_end: (booking.booking_info && booking.booking_info.check_out) || '',
        payment_status: booking.payment_status || '',
        status: booking.status || '',
        equipment_returned: Boolean(booking.equipment_returned),
        overdue_state: 'active'
      };
      if (record.equipment_returned || record.status === 'completed') {
        record.overdue_state = 'returned';
      } else if (record.status !== 'cancelled' && record.rental_end && record.rental_end < today) {
        record.overdue_state = 'overdue';
      }
      records.push(record);
    });
  });

  return records.filter(function (record) {
    if (bookingViewState.rentalStatus && record.status !== bookingViewState.rentalStatus) {
      return false;
    }
    if (bookingViewState.rentalPayment && record.payment_status !== bookingViewState.rentalPayment) {
      return false;
    }
    if (bookingViewState.rentalOverdue && record.overdue_state !== bookingViewState.rentalOverdue) {
      return false;
    }
    if (bookingViewState.searchTerm) {
      var rentalSearchText = [
        record.rental_id,
        record.booking_id,
        record.customer_name,
        getCustomerField(record.customer_id, 'email'),
        record.product_name
      ].join(' ').toLowerCase();
      return rentalSearchText.indexOf(bookingViewState.searchTerm) !== -1;
    }
    return true;
  });
}

function renderBookingsMessage(message) {
  $('#bookingsTableBody').html(
    '<tr><td colspan="11" class="text-center py-4 yr-admin-bookings-empty">' +
    '<i class="fas fa-inbox me-2"></i>' + escapeHtml(message) +
    '</td></tr>'
  );
}

function renderRentalBookingsMessage(message) {
  $('#rentalBookingsTableBody').html(
    '<tr><td colspan="11" class="text-center py-4 yr-admin-bookings-empty">' +
    '<i class="fas fa-inbox me-2"></i>' + escapeHtml(message) +
    '</td></tr>'
  );
}

function renderBookingCalendarMessage(message) {
  $('#bookingCalendarLabel').text('預約行事曆');
  $('#bookingCalendarGrid').html(
    '<div class="yr-admin-bookings-calendar-empty"><i class="fas fa-calendar-times me-2"></i>' +
    escapeHtml(message) +
    '</div>'
  );
}

function renderRentalBookingsTable(rentalRecords) {
  if (!rentalRecords || rentalRecords.length === 0) {
    renderRentalBookingsMessage('沒有符合條件的租借資料');
    updateBookingResultCount(0, 'empty');
    return;
  }

  var html = rentalRecords.map(function (record) {
    var payBadge = getPayBadgeHtml(record.payment_status);
    var bookingBadge = renderBookingStatusTag(record.status);
    var overdueLabel = record.overdue_state === 'returned'
      ? '<span class="yr-admin-equipment-return yr-admin-equipment-return--returned">已歸還</span>'
      : record.overdue_state === 'overdue'
        ? '<span class="yr-admin-equipment-return yr-admin-equipment-return--pending">逾期中</span>'
        : '<span class="yr-admin-equipment-return yr-admin-equipment-return--pending">未逾期</span>';
    var actionBtns = record.status === 'pending'
      ? '<button class="btn btn-sm btn-outline-primary btn-confirm-booking yr-admin-bookings-action-btn yr-admin-bookings-action-btn--primary me-1" title="確認預約"><i class="fas fa-check me-1"></i>確認預約</button>' +
        '<button class="btn btn-sm btn-outline-danger btn-cancel-booking yr-admin-bookings-action-btn yr-admin-bookings-action-btn--danger" title="取消預約"><i class="fas fa-times me-1"></i>取消</button>'
      : record.status === 'confirmed'
        ? '<button class="btn btn-sm btn-outline-danger btn-cancel-booking yr-admin-bookings-action-btn yr-admin-bookings-action-btn--danger" title="取消預約"><i class="fas fa-times me-1"></i>取消</button>'
        : '<span class="text-muted small">—</span>';
    return '<tr data-booking-id="' + escapeHtml(record.booking_id) + '">' +
      '<td class="yr-admin-rental-id-col"><a href="#" class="rental-booking-link yr-admin-rental-id-link" data-booking-id="' + escapeHtml(record.booking_id) + '" title="' + escapeHtml(record.rental_id) + '" aria-label="查看租借單號 ' + escapeHtml(record.rental_id) + ' 詳情"><span class="yr-admin-rental-id-link__code">' + escapeHtml(record.rental_id) + '</span></a></td>' +
      '<td>' + escapeHtml(record.rental_start) + '</td>' +
      '<td>' + escapeHtml(record.rental_end) + '</td>' +
      '<td><a href="#" class="booking-customer-link text-decoration-underline" data-customer-id="' + escapeHtml(record.customer_id) + '">' + escapeHtml(record.customer_name) + '</a></td>' +
      '<td>' + escapeHtml(record.product_name) + '</td>' +
      '<td class="text-center">' + record.rental_quantity + '</td>' +
      '<td class="text-end">NT$ ' + record.rental_amount.toLocaleString() + '</td>' +
      '<td>' + payBadge + '</td>' +
      '<td>' + bookingBadge + '</td>' +
      '<td>' + overdueLabel + '</td>' +
      '<td class="yr-admin-bookings-actions">' + actionBtns + '</td>' +
      '</tr>';
  }).join('');

  $('#rentalBookingsTableBody').html(html);
  updateBookingResultCount(rentalRecords.length, 'normal');
  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('bookings', $('#contentArea'));
  }
}

function renderBookingCalendar(bookings) {
  var monthStart = bookingCalendarState.currentMonth || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  var nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  var firstGridDate = new Date(monthStart);
  firstGridDate.setDate(monthStart.getDate() - monthStart.getDay());
  var todayIso = fmtBookingDateISO(new Date());
  var itemsByDate = {};
  bookings.forEach(function (booking) {
    var checkIn = (booking.booking_info && booking.booking_info.check_in) || '';
    if (!checkIn) return;
    if (!itemsByDate[checkIn]) {
      itemsByDate[checkIn] = [];
    }
    itemsByDate[checkIn].push(booking);
  });

  var label = monthStart.getFullYear() + ' 年 ' + String(monthStart.getMonth() + 1).padStart(2, '0') + ' 月';
  $('#bookingCalendarLabel').text(label);

  var cells = [];
  for (var i = 0; i < 42; i++) {
    var cellDate = new Date(firstGridDate);
    cellDate.setDate(firstGridDate.getDate() + i);
    var isoDate = fmtBookingDateISO(cellDate);
    var isOtherMonth = cellDate < monthStart || cellDate >= nextMonth;
    var isToday = isoDate === todayIso;
    var bookingsForDay = itemsByDate[isoDate] || [];
    var visibleBookings = bookingsForDay.slice(0, BOOKING_CALENDAR_MAX_EVENTS_PER_DAY);
    var overflowCount = Math.max(bookingsForDay.length - visibleBookings.length, 0);

    var itemsHtml = visibleBookings.map(function (booking) {
      var customerName = getCustomerName(booking.customer_id);
      var statusClass = getCalendarEventStatusClass(booking.status);
      var itemTitle = booking.id + '｜' + customerName;
      return '<button type="button" class="booking-calendar-item yr-admin-booking-calendar__event ' +
        statusClass +
        '" data-booking-id="' +
        escapeHtml(booking.id) +
        '" title="' +
        escapeHtml(itemTitle) +
        '">' +
        '<span class="yr-admin-booking-calendar__event-id">' + escapeHtml(booking.id) + '</span>' +
        '<span class="yr-admin-booking-calendar__event-name">' + escapeHtml(customerName) + '</span>' +
        '</button>';
    }).join('');

    if (overflowCount > 0) {
      itemsHtml += '<span class="yr-admin-booking-calendar__more" title="' +
        escapeHtml(isoDate + ' 尚有 ' + overflowCount + ' 筆預約') +
        '">+' +
        overflowCount +
        ' 筆</span>';
    }

    var emptyHtml = isOtherMonth
      ? ''
      : '<span class="yr-admin-booking-calendar__empty">無預約</span>';
    cells.push(
      '<div class="yr-admin-bookings-calendar-day yr-admin-booking-calendar__day' +
      (isOtherMonth ? ' yr-admin-booking-calendar__day--outside is-outside' : '') +
      (isToday ? ' yr-admin-booking-calendar__day--today is-today' : '') +
      '">' +
      '<div class="yr-admin-bookings-calendar-day__header yr-admin-booking-calendar__date">' + escapeHtml(isoDate.slice(8, 10)) + '</div>' +
      '<div class="yr-admin-bookings-calendar-day__items yr-admin-booking-calendar__events">' + (itemsHtml || emptyHtml) + '</div>' +
      '</div>'
    );
  }

  $('#bookingCalendarGrid').html(cells.join(''));
  updateBookingResultCount(bookings.length, bookings.length ? 'normal' : 'empty');
}

function getCalendarEventStatusClass(status) {
  var map = {
    pending: 'yr-admin-booking-calendar__event--pending',
    confirmed: 'yr-admin-booking-calendar__event--confirmed',
    completed: 'yr-admin-booking-calendar__event--completed',
    'checked-out': 'yr-admin-booking-calendar__event--completed',
    cancelled: 'yr-admin-booking-calendar__event--cancelled'
  };
  return map[status] || 'yr-admin-booking-calendar__event--unknown';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════
// 工具函式
// ═══════════════════════════════════════════════════════════════

/**
 * 產生付款狀態 badge HTML
 * @param {string} paymentStatus - paid | refunded
 * @returns {string}
 */
function getPayBadgeHtml(paymentStatus) {
  var labelMap = {
    paid: '已付款',
    unpaid: '未付款',
    refunded: '已退款',
    failed: '付款失敗'
  };
  var label = labelMap[paymentStatus] || '未知';
  return '<span class="payment-status-badge yr-admin-booking-payment ' +
    getBookingPaymentClass(paymentStatus) + '">' + label + '</span>';
}

function renderBookingStatusTag(status) {
  var labelMap = {
    pending: '待確認',
    confirmed: '已確認',
    completed: '已完成',
    cancelled: '已取消'
  };
  var label = labelMap[status] || '未知';
  return '<span class="booking-status-badge yr-admin-booking-status ' +
    getBookingStatusClass(status) + '">' + label + '</span>';
}

function getEquipmentReturnBadgeHtml(booking) {
  var state = 'unknown';
  if (!booking) {
    state = 'unknown';
  } else if (!booking.selected_rentals || booking.selected_rentals.length === 0) {
    state = 'not-required';
  } else if (booking.equipment_returned) {
    state = 'returned';
  } else {
    state = 'pending';
  }
  return renderEquipmentReturnTag(state);
}

function renderEquipmentReturnTag(state) {
  var labelMap = {
    pending: '待歸還',
    returned: '已歸還',
    'not-required': '免歸還',
    unknown: '狀態未知'
  };
  var label = labelMap[state] || labelMap.unknown;
  return '<span class="equipment-return-badge yr-admin-equipment-return ' +
    getEquipmentReturnClass(state) + '">' + label + '</span>';
}

function getBookingStatusClass(status) {
  var map = {
    pending: 'yr-admin-booking-status--pending',
    confirmed: 'yr-admin-booking-status--confirmed',
    completed: 'yr-admin-booking-status--completed',
    cancelled: 'yr-admin-booking-status--cancelled'
  };
  return map[status] || 'yr-admin-booking-status--unknown';
}

function getBookingPaymentClass(status) {
  var map = {
    paid: 'yr-admin-booking-payment--paid',
    unpaid: 'yr-admin-booking-payment--unpaid',
    refunded: 'yr-admin-booking-payment--refunded',
    failed: 'yr-admin-booking-payment--failed'
  };
  return map[status] || 'yr-admin-booking-payment--unknown';
}

function getEquipmentReturnClass(state) {
  var map = {
    pending: 'yr-admin-equipment-return--pending',
    returned: 'yr-admin-equipment-return--returned',
    'not-required': 'yr-admin-equipment-return--not-required',
    unknown: 'yr-admin-equipment-return--unknown'
  };
  return map[state] || 'yr-admin-equipment-return--unknown';
}

function updateBookingResultCount(count, state, detail) {
  var $node = $('#bookingResultCount');
  if (!$node.length) return;
  $node.removeClass('yr-admin-bookings-result-count--error');
  if (state === 'error') {
    $node.addClass('yr-admin-bookings-result-count--error');
    $node.text('預約資料讀取異常：' + (detail || '請稍後重試'));
    return;
  }
  if (state === 'empty') {
    $node.text('篩選結果：0 筆');
    return;
  }
  $node.text('篩選結果：' + count + ' 筆');
}

/**
 * 從 customersCache 查詢顧客姓名
 * 若快取尚未載入，回傳 customer_id 作為備用顯示
 * @param {string} customerId - 顧客 id（例："U001"）
 * @returns {string}
 */
function getCustomerName(customerId) {
  var cache = window.customersCache || [];
  var customer = cache.find(function (c) { return c.id === customerId; });
  return customer ? customer.name : customerId;
}

/**
 * 從 customersCache 查詢顧客的指定欄位
 * @param {string} customerId - 顧客 id
 * @param {string} field      - 欄位名稱（例："phone"、"email"）
 * @returns {string}
 */
function getCustomerField(customerId, field) {
  var cache = window.customersCache || [];
  var customer = cache.find(function (c) { return c.id === customerId; });
  return customer ? (customer[field] || '') : '';
}

/**
 * 產生當下時間字串，格式：YYYY-MM-DD HH:MM:SS
 * @returns {string}
 */
function getCurrentTimeStr() {
  var now = new Date();
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return now.getFullYear() + '-' +
         pad(now.getMonth() + 1) + '-' +
         pad(now.getDate()) + ' ' +
         pad(now.getHours()) + ':' +
         pad(now.getMinutes()) + ':' +
         pad(now.getSeconds());
}
