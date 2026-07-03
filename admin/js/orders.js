/**
 * admin/js/orders.js
 * 訂單管理模組
 *
 * 設計重點：
 *   1. 從 orders.json 載入後存入 window.ordersCache，避免重複 fetch
 *   2. 付款狀態支援 3 種：已付款 / 未付款 / 貨到付款
 *   3. 訂單狀態支援 3 種：未出貨 / 已出貨 / 已退貨
 *   4. 點擊訂單編號開啟 modal，modal 內顯示訂單紀錄時間軸
 *   5. 點擊出貨按鈕後更新 orderStatus 並 push 新 history 紀錄
 *   6. 欄位排序（可疊加）：訂單日期、總金額
 *   7. 多選篩選：付款狀態、訂單狀態（漏斗 icon + checkbox Dropdown）
 *
 * 使用 jQuery Event Namespace (.orders) 防止重複導覽時事件堆疊
 */

// ─────────────────────────────────────────────
// 模組層級狀態變數（不掛 window，避免污染全域）
// ─────────────────────────────────────────────

/**
 * 使用者明確設定的排序堆疊（空陣列 = 使用隱含預設排序）
 * 每個元素：{ key: 'createdAt' | 'total', dir: 'asc' | 'desc' }
 */
var sortStack = [];

/** 隱含預設：最新訂單在最上面（sortStack 為空時套用） */
var DEFAULT_ORDER_SORT = [{ key: 'createdAt', dir: 'desc' }];

/**
 * 篩選條件：各欄位目前勾選的值
 * 空陣列 = 不篩選（顯示全部）
 * dateStart / dateEnd 為 YYYY-MM-DD 字串，null = 不篩選
 */
var filterState = {
  paymentStatus: [], // e.g. ['paid', 'unpaid']
  orderStatus: [], // e.g. ['unshipped']
  dateStart: null, // e.g. '2026-05-23'
  dateEnd: null, // e.g. '2026-06-22'
};

/**
 * 日期快速選鈕狀態（獨立追蹤 UI 狀態，與 filterState 的字串欄位分開）
 * days: 7 | 30 | 90 | 'custom' | 'all'
 *   'all'    = 無日期限制（無任何按鈕 active）
 *   'custom' = 由 flatpickr 自選（自定義按鈕 active）
 * startDate / endDate 為 Date 物件，僅供 updateOrderPeriodLabel 格式化文字使用
 */
var orderDateState = { days: 30, startDate: null, endDate: null };

// ─────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────

window.initOrders = function () {
  // 移除舊有事件，防止切換頁面時事件重複綁定
  // 多個模組共用 .sortable-th / .filter-icon / .filter-dropdown 選擇器，
  // 若其他頁事件殘留，點擊漏斗 icon 會被雙重觸發（toggle 兩次 = 無效果）
  $(document).off('.bookings');
  $(document).off('.orders');
  $(document).off('.movement');
  $(document).off('.customers');

  // ── 每次進入訂單頁重置排序與篩選狀態（排序回到隱含預設：日期降冪） ──
  sortStack = [];
  filterState = { paymentStatus: [], orderStatus: [], dateStart: null, dateEnd: null };
  // 日期選鈕狀態也同步重置（預設「近 30 天」）
  orderDateState = { days: 30, startDate: null, endDate: null };

  // ── 初始化日期篩選器 UI ─────────────────────────
  setupOrderPeriodFilter(); // 綁定快速選鈕點擊事件
  initOrderFlatpickr(); // 初始化 flatpickr

  // ── 讀取並消費 pendingNavFilter（從 KPI 卡片點擊跳來時） ──
  if (window.pendingNavFilter && window.pendingNavFilter.section === 'orders') {
    var nav = window.pendingNavFilter;
    filterState.orderStatus = nav.orderStatus || [];
    filterState.paymentStatus = nav.paymentStatus || [];
    window.pendingNavFilter = null; // 消費後立即清除，避免切換回來時重複套用

    if (nav.dateStart && nav.dateEnd) {
      // KPI 帶日期（如「本期訂單數」）→ 自定義範圍，自定義按鈕 active
      applyOrderCustomRange(nav.dateStart, nav.dateEnd);
    } else {
      // KPI 不帶日期（如「待出貨訂單」）→ 無日期限制，全部期間
      applyOrderDayRange('all');
    }
  } else {
    // 一般進入訂單管理頁：預設顯示「近 30 天」
    applyOrderDayRange(30);
  }
  // 注意：applyOrderDayRange / applyOrderCustomRange 內部已呼叫 applyFiltersAndSort()
  // 若快取尚未就緒，下面的 $.getJSON callback 會再呼叫一次 applyFiltersAndSort()

  // ── 載入訂單資料（若快取已存在則不重新 fetch） ──────
  if (!window.ordersCache || !window.ordersCache.length) {
    $.getJSON('data/orders.json', function (orders) {
      window.ordersCache = orders; // 存入全域快取，供 modal 讀取
      applyFiltersAndSort();
    }).fail(function () {
      $('#ordersTableBody').html(
        '<tr><td colspan="7" class="text-center text-danger py-4">' +
          '<i class="fas fa-exclamation-triangle me-2"></i>載入訂單數據失敗' +
          '</td></tr>'
      );
    });
  } else {
    applyFiltersAndSort();
  }

  // ── 排序：點擊 .sortable-th 標頭（限定 #ordersTable，避免跨頁衝突）──
  // 三段式：asc ↑ → desc ↓ → 移除；sortStack 空時用隱含 createdAt desc
  // 首次點擊某欄只排序該欄（不自動疊加 createdAt，避免日期篩選後點總金額無效）
  $(document).on('click.orders', '#ordersTable .sortable-th', function () {
    var key = $(this).data('sort-key');
    var idx = sortStack.findIndex(function (s) {
      return s.key === key;
    });

    if (idx === -1) {
      sortStack.push({ key: key, dir: 'asc' });
    } else if (sortStack[idx].dir === 'asc') {
      sortStack[idx].dir = 'desc';
    } else {
      sortStack.splice(idx, 1);
    }

    applyFiltersAndSort();
  });

  // ── 篩選 Dropdown 開關：點擊漏斗 icon ──────────────
  // 點擊 .filter-icon → 顯示/隱藏同一個 th 內的 .filter-dropdown
  $(document).on('click.orders', '#ordersTable .filter-icon', function (e) {
    e.stopPropagation(); // 防止冒泡到 document，避免立即被關閉
    var $th = $(this).closest('.filter-th');
    var $dropdown = $th.find('.filter-dropdown');

    // 先關閉所有其他已開啟的 Dropdown，再 toggle 當前的
    $('#ordersTable .filter-dropdown').not($dropdown).addClass('d-none');
    $dropdown.toggleClass('d-none');
  });

  // ── 點擊 Dropdown 內部（checkbox / label）時，阻止冒泡關閉 ──
  $(document).on('click.orders', '#ordersTable .filter-dropdown', function (e) {
    e.stopPropagation();
  });

  // ── 點擊頁面其他地方 → 關閉所有 Dropdown ──────────
  $(document).on('click.orders', function () {
    $('#ordersTable .filter-dropdown').addClass('d-none');
  });

  // ── 篩選 checkbox 勾選/取消 ────────────────────────
  $(document).on('change.orders', '#ordersTable .filter-dropdown input[type="checkbox"]', function () {
    var $th = $(this).closest('.filter-th');
    var key = $th.data('filter-key'); // 'paymentStatus' 或 'orderStatus'

    // 收集該欄位所有勾選中的 checkbox 值
    var selected = [];
    $th.find('input[type="checkbox"]:checked').each(function () {
      selected.push($(this).val());
    });

    filterState[key] = selected;
    applyFiltersAndSort();
  });

  // ── 清除條件按鈕：還原預設排序 + 清空欄位篩選 + 還原預設日期（近 30 天）──
  $(document).on('click.orders', '#btnClearSort', function () {
    sortStack = [];
    filterState.paymentStatus = [];
    filterState.orderStatus = [];
    // applyOrderDayRange 內部會呼叫 applyFiltersAndSort()
    applyOrderDayRange(30);
  });

  // ── 點擊訂單編號 → 開啟訂單明細 modal ───────────────
  $(document).on('click.orders', '.order-id-link', function () {
    var orderId = $(this).data('order-id');
    var order = (window.ordersCache || []).find(function (o) {
      return o.id === orderId;
    });
    if (!order) return;
    showOrderModal(order);
  });

  // ── 「完成」按鈕：已出貨 + 非貨到付款 訂單才可標記完成 ──────────
  // 點擊後：更新 orderStatus → 'completed'，push history，顯示 Toast，重新渲染表格
  $(document).on('click.orders', '.btn-complete-order', function () {
    var $row = $(this).closest('tr');
    var orderId = $row.data('order-id');
    var order = (window.ordersCache || []).find(function (o) {
      return o.id === orderId;
    });
    if (!order) return;

    // 二次防護：COD 訂單不允許完成（按鈕邏輯已過濾，此處防止異常呼叫）
    if (order.paymentStatus === 'cod') return;

    order.orderStatus = 'completed';

    // 產生當下時間字串，格式：YYYY-MM-DD HH:MM:SS（與出貨邏輯一致）
    var now = new Date();
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    var timeStr =
      now.getFullYear() +
      '-' +
      pad(now.getMonth() + 1) +
      '-' +
      pad(now.getDate()) +
      ' ' +
      pad(now.getHours()) +
      ':' +
      pad(now.getMinutes()) +
      ':' +
      pad(now.getSeconds());

    order.history = order.history || [];
    order.history.push({ time: timeStr, action: '已完成' });

    window.showAdminToast('訂單 ' + orderId + ' 已標記為「已完成」');

    // 重新跑管線，讓篩選器即時反映新的 orderStatus
    applyFiltersAndSort();
  });

  // ── 出貨按鈕 ──────────────────────────────────────
  $(document).on('click.orders', '.btn-ship-order', function () {
    var $btn = $(this);
    var $row = $btn.closest('tr');
    var orderId = $row.data('order-id');

    // 更新記憶體中的快取資料
    var order = (window.ordersCache || []).find(function (o) {
      return o.id === orderId;
    });
    if (order) {
      order.orderStatus = 'shipped';

      // 產生當下時間字串，格式：YYYY-MM-DD HH:MM:SS
      var now = new Date();
      var pad = function (n) {
        return String(n).padStart(2, '0');
      };
      var timeStr =
        now.getFullYear() +
        '-' +
        pad(now.getMonth() + 1) +
        '-' +
        pad(now.getDate()) +
        ' ' +
        pad(now.getHours()) +
        ':' +
        pad(now.getMinutes()) +
        ':' +
        pad(now.getSeconds());

      order.history = order.history || [];
      order.history.push({ time: timeStr, action: '已出貨' });
    }

    window.showAdminToast('訂單 ' + orderId + ' 已更新為「已出貨」');

    // 出貨後重新跑管線：讓篩選器能即時反映新的 orderStatus
    // （例如目前篩選「未出貨」，出貨後此列應從結果中消失）
    applyFiltersAndSort();
  });

  // 日期篩選器事件已由 setupOrderPeriodFilter() 和 initOrderFlatpickr() 接手
};

// ─────────────────────────────────────────────
// 日期篩選器輔助函式
// ─────────────────────────────────────────────

/**
 * 將 Date 物件格式化為 "YYYY/MM/DD" 字串，供期間標籤顯示
 * @param {Date} d
 * @returns {string}
 */
function fmtOrderDate(d) {
  if (!d) return '';
  return (
    d.getFullYear() +
    '/' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '/' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * 將 Date 物件格式化為 "YYYY-MM-DD" 字串，供 filterState 使用
 * @param {Date} d
 * @returns {string}
 */
function fmtOrderDateISO(d) {
  if (!d) return null;
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * 依 days 數值計算起迄日，更新 orderDateState 和 filterState，
 * 再刷新期間文字與表格資料
 *
 * @param {number|string} days - 7 | 30 | 90 | 'all'
 *   'all' = 清空日期（無限制，全部顯示）
 */
function applyOrderDayRange(days) {
  if (days === 'all') {
    // 清空日期限制
    orderDateState.days = 'all';
    orderDateState.startDate = null;
    orderDateState.endDate = null;
    filterState.dateStart = null;
    filterState.dateEnd = null;
  } else if (days === 'month') {
    // 本月：從本月 1 日到今天
    // new Date(year, month, 1) 的 month 是 0-indexed，getMonth() 回傳值剛好吻合
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);

    orderDateState.days = 'month';
    orderDateState.startDate = start;
    orderDateState.endDate = new Date(now);
    filterState.dateStart = fmtOrderDateISO(start);
    filterState.dateEnd = fmtOrderDateISO(new Date(now));
  } else {
    // 往前推 days-1 天（含今天共 days 天），與 analytics.js applyDayRange() 邏輯相同
    var now = new Date();
    var start = new Date(now);
    start.setDate(start.getDate() - (days - 1));

    orderDateState.days = days;
    orderDateState.startDate = start;
    orderDateState.endDate = new Date(now);
    filterState.dateStart = fmtOrderDateISO(start);
    filterState.dateEnd = fmtOrderDateISO(new Date(now));
  }
  // 非 custom 模式：收起 flatpickr input
  if (days !== 'custom') {
    $('#orderDateRangePicker').hide();
  }
  updateOrderPeriodLabel();
  applyFiltersAndSort();
}

/**
 * 接受兩個 YYYY-MM-DD 字串，設定為自定義日期範圍，
 * 更新 orderDateState（days = 'custom'）和 filterState，
 * 再刷新期間文字與表格資料
 *
 * @param {string} dateStart - e.g. '2026-05-23'
 * @param {string} dateEnd   - e.g. '2026-06-22'
 */
function applyOrderCustomRange(dateStart, dateEnd) {
  orderDateState.days = 'custom';
  // 解析字串為 Date 物件，供期間文字格式化使用
  orderDateState.startDate = dateStart ? new Date(dateStart + 'T00:00:00') : null;
  orderDateState.endDate = dateEnd ? new Date(dateEnd + 'T00:00:00') : null;
  filterState.dateStart = dateStart || null;
  filterState.dateEnd = dateEnd || null;
  updateOrderPeriodLabel();
  applyFiltersAndSort();

  // 同步 flatpickr 顯示，並確保 input 可見（與 label 格式一致：YYYY-MM-DD 至 YYYY-MM-DD）
  var pickerEl = document.querySelector('#orderDateRangePicker');
  if (pickerEl && pickerEl._flatpickr && orderDateState.startDate && orderDateState.endDate) {
    pickerEl._flatpickr.setDate(
      [orderDateState.startDate, orderDateState.endDate],
      false // 不觸發 onChange，避免重複篩選
    );
  }
  $('#orderDateRangePicker').show();
}

/**
 * 依 orderDateState 更新期間文字標籤 #orderPeriodLabel
 * 以及 #orderPeriodBtns 各按鈕的 active 樣式
 */
function updateOrderPeriodLabel() {
  var days = orderDateState.days;

  // 更新按鈕群 active 狀態
  $('#orderPeriodBtns button').removeClass('active');
  if (days !== 'all') {
    // 'custom' → 對應 data-days="custom"；數字 → 對應 data-days=數字
    $('#orderPeriodBtns button[data-days="' + days + '"]').addClass('active');
  }

  // 更新期間文字標籤
  var $label = $('#orderPeriodLabel');

  // custom 模式：日期已由 flatpickr input 顯示，隱藏 label 避免重複
  if (days === 'custom') {
    $label.addClass('d-none').text('');
    return;
  }

  $label.removeClass('d-none');

  if (days === 'all') {
    $label.text('全部期間');
  } else if (orderDateState.startDate && orderDateState.endDate) {
    // 格式與 flatpickr 一致：YYYY-MM-DD 至 YYYY-MM-DD
    $label.text(fmtOrderDateISO(orderDateState.startDate) + ' 至 ' + fmtOrderDateISO(orderDateState.endDate));
  } else {
    $label.text('');
  }
}

/**
 * 初始化 #orderDateRangePicker 的 flatpickr 日期範圍選擇器
 * mode: range，繁體中文語系，格式 Y-m-d
 * 需在 flatpickr CDN 載入後呼叫（dashboard.html 已全域引入）
 */
function initOrderFlatpickr() {
  if (typeof flatpickr === 'undefined') return; // CDN 未載入時安全跳過

  // 取繁體中文語系（與 analytics.js 邏輯一致）
  var locale = flatpickr.l10ns && flatpickr.l10ns.zh_tw ? flatpickr.l10ns.zh_tw : 'default';

  flatpickr('#orderDateRangePicker', {
    mode: 'range',
    dateFormat: 'Y-m-d',
    locale: locale,
    onClose: function (selectedDates) {
      // 必須兩個日期都選完才觸發；只選一個就關閉時維持上一次狀態
      if (selectedDates.length === 2) {
        var start = fmtOrderDateISO(selectedDates[0]);
        var end = fmtOrderDateISO(selectedDates[1]);
        applyOrderCustomRange(start, end);
      }
      // 否則不更新，維持現狀
    },
  });
}

/**
 * 綁定 #orderPeriodBtns 內按鈕的點擊事件（使用 .orders namespace 方便統一解除）
 *
 * 行為：
 *  - 點擊「近 7 天 / 近 30 天 / 近 3 個月」：
 *      • 若該按鈕已 active → toggle off，回到「全部期間」(applyOrderDayRange('all'))
 *      • 否則 → 套用對應天數 (applyOrderDayRange(days))
 *  - 點擊「自定義」：切換 custom 模式、隱藏期間 label、顯示 flatpickr 並開啟
 */
function enterOrderCustomMode() {
  // 切換為 custom 模式，讓 updateOrderPeriodLabel() 隱藏 #orderPeriodLabel
  orderDateState.days = 'custom';
  updateOrderPeriodLabel();

  // 預填目前篩選區間，避免從固定期間切換時 input 與 label 各顯示各的
  var pickerEl = document.querySelector('#orderDateRangePicker');
  if (pickerEl && pickerEl._flatpickr && orderDateState.startDate && orderDateState.endDate) {
    pickerEl._flatpickr.setDate(
      [orderDateState.startDate, orderDateState.endDate],
      false // 不觸發 onClose，避免重複篩選
    );
  }

  $('#orderDateRangePicker').show().trigger('click');
}

function setupOrderPeriodFilter() {
  $(document).on('click.orders', '#orderPeriodBtns button[data-days]', function () {
    var days = $(this).data('days');

    if (days === 'custom') {
      enterOrderCustomMode();
    } else if (days === 'month') {
      // 本月按鈕：已 active 則 toggle off 回全部期間，否則套用本月範圍
      // 必須在 parseInt 之前處理，因為 parseInt('month', 10) === NaN
      if ($(this).hasClass('active')) {
        applyOrderDayRange('all');
      } else {
        applyOrderDayRange('month');
      }
    } else if ($(this).hasClass('active')) {
      // 再次點擊已 active 的按鈕 → 取消，回到「全部期間」
      applyOrderDayRange('all');
    } else {
      // 套用對應快速天數
      applyOrderDayRange(parseInt(days, 10));
    }
  });
}

// ─────────────────────────────────────────────
// 核心資料管線
// ─────────────────────────────────────────────

/**
 * 取得實際用於排序的堆疊（空 sortStack → 隱含預設 createdAt desc）
 */
function getEffectiveSortStack() {
  return sortStack.length > 0 ? sortStack : DEFAULT_ORDER_SORT;
}

/**
 * 依欄位型別比較兩筆值，回傳 -1 / 0 / 1
 * @param {string} key
 * @param {*} valA
 * @param {*} valB
 */
function compareOrderValues(key, valA, valB) {
  if (key === 'total') {
    var numA = Number(valA) || 0;
    var numB = Number(valB) || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
    return 0;
  }
  var strA = String(valA || '');
  var strB = String(valB || '');
  if (strA < strB) return -1;
  if (strA > strB) return 1;
  return 0;
}

/**
 * 依目前的 filterState 篩選、依 sortStack 排序，再重新渲染表格
 * 所有排序/篩選條件變動後都呼叫此函式
 */
function applyFiltersAndSort() {
  // 複製陣列，確保不改動 window.ordersCache 原始資料
  var data = (window.ordersCache || []).slice();

  // ── Step 1：篩選 ──────────────────────────────────
  // 付款狀態篩選（OR）：有勾選時才篩；空陣列 = 顯示全部
  if (filterState.paymentStatus.length > 0) {
    data = data.filter(function (o) {
      return filterState.paymentStatus.indexOf(o.paymentStatus) !== -1;
    });
  }

  // 訂單狀態篩選（OR）：有勾選時才篩；空陣列 = 顯示全部
  if (filterState.orderStatus.length > 0) {
    data = data.filter(function (o) {
      return filterState.orderStatus.indexOf(o.orderStatus) !== -1;
    });
  }

  // 日期範圍篩選：依 createdAt 欄位（格式 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS）
  // dateStart / dateEnd 皆為 YYYY-MM-DD 字串；null = 不限制
  if (filterState.dateStart) {
    data = data.filter(function (o) {
      return (o.createdAt || '').slice(0, 10) >= filterState.dateStart;
    });
  }
  if (filterState.dateEnd) {
    data = data.filter(function (o) {
      return (o.createdAt || '').slice(0, 10) <= filterState.dateEnd;
    });
  }

  // ── Step 2：排序 ──────────────────────────────────
  // 依有效排序堆疊逐層比較（多鍵穩定排序，支援疊加）
  var stackToUse = getEffectiveSortStack();
  data.sort(function (a, b) {
    for (var i = 0; i < stackToUse.length; i++) {
      var key = stackToUse[i].key;
      var dir = stackToUse[i].dir === 'asc' ? 1 : -1;
      var cmp = compareOrderValues(key, a[key], b[key]);
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });

  // ── Step 3：渲染 + 更新 UI ────────────────────────
  renderOrdersTable(data);
  updateSortUI();
  updateFilterUI();
}

// ─────────────────────────────────────────────
// UI 同步更新
// ─────────────────────────────────────────────

/**
 * 依 sortStack 更新欄位標頭的箭頭 icon 和「清除條件」按鈕的顯隱
 */
function updateSortUI() {
  // 所有排序 icon 先重置為雙箭頭（灰色、未排序狀態）
  $('#ordersTable .sort-icon').removeClass('fa-sort-up fa-sort-down sort-active').addClass('fa-sort');

  // 依有效排序堆疊設定對應欄位的箭頭方向和顏色
  getEffectiveSortStack().forEach(function (s) {
    var $icon = $('#ordersTable .sortable-th[data-sort-key="' + s.key + '"] .sort-icon');
    $icon
      .removeClass('fa-sort')
      .addClass(s.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down')
      .addClass('sort-active'); // 換成品牌色
  });

  // 預設排序：使用者尚未明確修改 sortStack（隱含 createdAt desc）
  var isDefaultSort = sortStack.length === 0;

  // 欄位篩選：付款狀態 / 訂單狀態任一有勾選
  var hasColumnFilter = filterState.paymentStatus.length > 0 || filterState.orderStatus.length > 0;

  // 日期篩選：預設為「近 30 天」
  var isDefaultDate = orderDateState.days === 30;

  // 任一條件成立 → 顯示「清除條件」
  if (!isDefaultSort || hasColumnFilter || !isDefaultDate) {
    $('#btnClearSort').removeClass('d-none');
  } else {
    $('#btnClearSort').addClass('d-none');
  }
}

/**
 * 依 filterState 更新漏斗 icon 的顏色和紅點的顯隱
 * 同時同步日期 input 的值與清除按鈕的顯隱
 * 同時同步 checkbox 的勾選狀態（讓 pendingNavFilter 套用後 UI 可見）
 */
function updateFilterUI() {
  // 遍歷兩個可篩選的欄位（漏斗 icon + 紅點）
  ['paymentStatus', 'orderStatus'].forEach(function (key) {
    var $th = $('#ordersTable .filter-th[data-filter-key="' + key + '"]');
    var $icon = $th.find('.filter-icon');
    var $dot = $th.find('.filter-dot');

    if (filterState[key].length > 0) {
      // 有啟用中的篩選條件：icon 變品牌色 + 顯示紅點
      $icon.addClass('active');
      $dot.removeClass('d-none');
      // 同步 checkbox 勾選狀態（KPI 跳來時讓 UI 可見）
      $th.find('input[type="checkbox"]').each(function () {
        $(this).prop('checked', filterState[key].indexOf($(this).val()) !== -1);
      });
    } else {
      // 無篩選條件：icon 回灰色 + 隱藏紅點 + 取消所有勾選
      $icon.removeClass('active');
      $dot.addClass('d-none');
      $th.find('input[type="checkbox"]').prop('checked', false);
    }
  });

  // 同步日期篩選器按鈕 active 狀態與期間文字標籤
  // 由 updateOrderPeriodLabel() 統一管理，確保 pendingNavFilter 套用後 UI 也正確反映
  updateOrderPeriodLabel();
}

// ─────────────────────────────────────────────
// 表格渲染
// ─────────────────────────────────────────────

/**
 * 將 orders 陣列渲染成 HTML 表格列，填入 #ordersTableBody
 * @param {Array} orders - 已篩選並排序完畢的訂單陣列
 */
function renderOrdersTable(orders) {
  if (!orders || orders.length === 0) {
    $('#ordersTableBody').html(
      '<tr><td colspan="7" class="text-center text-muted py-4">' +
        '<i class="fas fa-inbox me-2"></i>沒有符合條件的訂單' +
        '</td></tr>'
    );
    return;
  }

  // 付款狀態 badge（3 種）
  // paid = 已付款（綠）/ unpaid = 未付款（黃）/ cod = 貨到付款（藍）
  var payBadgeMap = {
    paid: '<span class="badge bg-success">已付款</span>',
    unpaid: '<span class="badge bg-warning text-dark">未付款</span>',
    cod: '<span class="badge bg-info text-dark">貨到付款</span>',
  };

  // 訂單狀態 badge（4 種）
  // unshipped = 黃色 / shipped = 綠色 / returned = 紅色 / completed = 藍色
  var orderStatusMap = {
    unshipped: '<span class="badge bg-warning text-dark order-status-badge">未出貨</span>',
    shipped: '<span class="badge bg-success order-status-badge">已出貨</span>',
    returned: '<span class="badge bg-danger order-status-badge">已退貨</span>',
    completed: '<span class="badge bg-primary order-status-badge">已完成</span>',
  };

  var html = orders
    .map(function (order) {
      var payBadge = payBadgeMap[order.paymentStatus] || '';
      var statusBadge = orderStatusMap[order.orderStatus] || '';

      // 操作欄按鈕邏輯：
      //   未出貨               → 顯示「出貨」按鈕
      //   已出貨 且 非貨到付款 → 顯示「完成」按鈕（COD 訂單送達時無法確認付款，故不允許完成）
      //   其餘狀態             → 不顯示按鈕
      var actionBtn = '';
      if (order.orderStatus === 'unshipped') {
        actionBtn =
          '<button class="btn btn-sm btn-outline-success btn-ship-order" title="確認出貨">' +
          '<i class="fas fa-truck me-1"></i>出貨</button>';
      } else if (order.orderStatus === 'shipped' && order.paymentStatus !== 'cod') {
        actionBtn =
          '<button class="btn btn-sm btn-outline-primary btn-complete-order" title="確認送達完成">' +
          '<i class="fas fa-check-circle me-1"></i>完成</button>';
      }

      // 只取日期部分（YYYY-MM-DD），不顯示時間
      var date = order.createdAt.split(' ')[0] || '';

      // 訂單編號：可點擊連結樣式
      var idLink =
        '<span class="admin-cell-link order-id-link" ' +
        'data-order-id="' +
        order.id +
        '" ' +
        'title="點擊查看訂單明細">' +
        order.id +
        '</span>';

      return (
        '<tr data-order-id="' +
        order.id +
        '"' +
        ' data-order-status="' +
        order.orderStatus +
        '">' +
        '<td>' +
        idLink +
        '</td>' +
        '<td>' +
        date +
        '</td>' +
        '<td class="fw-semibold">' +
        order.buyerName +
        '</td>' +
        '<td class="admin-cell-amount">NT$ ' +
        order.total.toLocaleString() +
        '</td>' +
        '<td>' +
        payBadge +
        '</td>' +
        '<td>' +
        statusBadge +
        '</td>' +
        '<td>' +
        actionBtn +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  $('#ordersTableBody').html(html);

  // 依編輯權限停用出貨按鈕
  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('orders', $('#contentArea'));
  }
}

// ─────────────────────────────────────────────
// 訂單明細 Modal
// ─────────────────────────────────────────────

/**
 * 將訂單資料填入 #orderDetailModal 並開啟
 * @param {Object} order - 來自 window.ordersCache 的單筆訂單物件
 */
window.showOrderModal = function (order) {
  // 基本資訊
  $('#modalOrderId').text(order.id);
  $('#modalBuyerName').text(order.buyerName);

  // 訂單狀態 badge（4 種，需與 renderOrdersTable 的 orderStatusMap 保持一致）
  var statusMap = {
    unshipped: '<span class="badge bg-warning text-dark">未出貨</span>',
    shipped: '<span class="badge bg-success">已出貨</span>',
    returned: '<span class="badge bg-danger">已退貨</span>',
    completed: '<span class="badge bg-primary">已完成</span>',
  };
  $('#modalOrderStatus').html(statusMap[order.orderStatus] || '');

  // 商品清單
  var itemsHtml = (order.items || [])
    .map(function (item) {
      return (
        '<tr>' +
        '<td>' +
        item.name +
        '</td>' +
        '<td class="text-center">' +
        item.qty +
        '</td>' +
        '<td class="text-end">NT$ ' +
        item.price.toLocaleString() +
        '</td>' +
        '<td class="text-end">NT$ ' +
        (item.qty * item.price).toLocaleString() +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  $('#modalItemsList').html(itemsHtml);
  $('#modalTotal').text('NT$ ' + order.total.toLocaleString());

  // 收件地址
  $('#modalAddress').text(order.address);

  // 顧客備註：有值才顯示區塊，空字串或欄位不存在則隱藏
  // 使用 .text() 而非 .html()，自動 Escape HTML，防止 XSS 攻擊
  var note = order.customerNote || '';
  if (note.trim()) {
    $('#modalCustomerNote').text(note);
    $('#modalCustomerNoteSection').removeClass('d-none');
  } else {
    $('#modalCustomerNote').text('');
    $('#modalCustomerNoteSection').addClass('d-none');
  }

  // 訂單紀錄時間軸
  var historyHtml = (order.history || [])
    .map(function (entry) {
      return (
        '<li class="d-flex align-items-start gap-2 mb-1">' +
        '<i class="fas fa-circle mt-1" style="font-size:5px; color:var(--admin-brand-accent); flex-shrink:0;"></i>' +
        '<span><span class="text-muted me-2">' +
        entry.time +
        '</span>' +
        entry.action +
        '</span>' +
        '</li>'
      );
    })
    .join('');
  $('#modalHistory').html(historyHtml || '<li class="text-muted">無紀錄</li>');

  // 開啟 modal
  new bootstrap.Modal('#orderDetailModal').show();
};
