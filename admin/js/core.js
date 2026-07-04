/**
 * admin/js/core.js
 * 後台核心功能：
 *  1. Auth 守衛：未登入自動跳轉登入頁
 *  2. 權限 helper：canView / canEdit / Sidebar 灰階 / 編輯按鈕 disabled
 *  3. Sidebar 導覽點擊 → AJAX 載入對應 partial + 呼叫初始化函式
 *  4. Topbar 頁面標題動態更新
 *  5. 登出邏輯
 *  6. Toast 工廠函式（供所有模組呼叫）
 */

// ==========================================================
// === 各模組「無 edit 權限」時需停用的選擇器 ===
// ==========================================================
var EDIT_PERMISSION_SELECTORS = {
  orders: '.btn-ship-order',
  products: '[data-bs-target="#addProductModal"]:not(.edit-product-btn), .edit-product-btn, .stock-confirm-btn, .stock-step-btn, #submitAddProduct',
  customers: '.tier-edit-btn, .points-edit-btn, .coupons-edit-btn, .tier-save-btn, .tier-cancel-btn, .points-save-btn, .coupons-save-btn',
  discounts: '#submitAddCoupon, .btn-toggle-coupon, .btn-delete-coupon, #generateCouponCode, #addCouponForm input, #addCouponForm select, #addCouponForm textarea, #addCouponForm button:not(.btn-close)',
  reviews: '.btn-reply-toggle, .btn-submit-reply, .review-card textarea',
  bookings: '.btn-confirm-booking, .btn-cancel-booking',
  permissions: '#addEmployeeBtn, .btn-edit-employee, .btn-toggle-employee, #employeeModal input:not([readonly]), #employeeModal button:not(.btn-close):not([data-bs-dismiss]), #saveEmployeeBtn, .perm-view-cb, .perm-edit-cb, #empIsSuperAdmin',
};

/**
 * 從 sessionStorage 解析權限物件
 * Parse permissions JSON from sessionStorage
 */
window.getAdminPermissions = function () {
  try {
    var raw = sessionStorage.getItem('adminPermissions');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
};

/** 超級管理員擁有全部權限 / Super admin has full access */
function isCurrentSuperAdmin() {
  return sessionStorage.getItem('isSuperAdmin') === 'true';
}

/**
 * 檢查某 section 是否有查看權限
 * Check view permission for a section
 */
window.canView = function (section) {
  if (isCurrentSuperAdmin()) return true;
  var perms = window.getAdminPermissions();
  return !!(perms[section] && perms[section].view);
};

/**
 * 檢查某 section 是否有編輯權限
 * Check edit permission for a section
 */
window.canEdit = function (section) {
  if (isCurrentSuperAdmin()) return true;
  var perms = window.getAdminPermissions();
  return !!(perms[section] && perms[section].edit);
};

/**
 * 依權限渲染 Sidebar（無 view 權限 → 灰色 disabled）
 * Apply sidebar link enabled/disabled state from permissions
 */
window.applySidebarPermissions = function () {
  $('.sidebar-link').each(function () {
    var section = $(this).data('section');
    if (!section) return;

    if (window.canView(section)) {
      $(this).removeClass('disabled');
    } else {
      $(this).addClass('disabled').removeClass('active');
    }
  });
};

/**
 * 取得第一個可查看的 section（登入後預設首頁）
 * First viewable section in sidebar order, or null if none
 */
window.getDefaultSection = function () {
  var sections = window.ADMIN_SECTIONS || [];
  for (var i = 0; i < sections.length; i++) {
    if (window.canView(sections[i].key)) {
      return sections[i].key;
    }
  }
  return null;
};

/** 依 section 取得 Topbar 標題 / Get display title for section */
function getSectionTitle(section) {
  var sections = window.ADMIN_SECTIONS || [];
  var found = sections.find(function (s) { return s.key === section; });
  return found ? found.label : '後台管理';
}

/**
 * 對容器內編輯元素套用 disabled（無 edit 權限時）
 * Disable edit controls when user lacks edit permission
 */
window.applyEditPermission = function (section, $container) {
  var $scope = $container && $container.length ? $container : $('#contentArea');
  var selectors = EDIT_PERMISSION_SELECTORS[section];
  var noEditTitle = '無編輯權限';

  if (window.canEdit(section)) {
    if (selectors) {
      $scope.find(selectors).prop('disabled', false).removeAttr('data-permission-disabled');
    }
    // 商品新增 Modal 在 dashboard 全域
    if (section === 'products') {
      $('#submitAddProduct, #addProductForm input, #addProductForm select, #addProductForm textarea, #addProductForm button:not(.btn-close):not([data-bs-dismiss="modal"])')
        .prop('disabled', false)
        .removeAttr('data-permission-disabled');
    }
    // 預約 Modal 在 dashboard 全域，需另外還原
    if (section === 'bookings') {
      $('#btnCompleteBooking, #equipmentReturnedCheck, #confirmCancelBtn, #cancelReasonInput')
        .prop('disabled', false)
        .removeAttr('data-permission-disabled');
    }
    $scope.removeClass('permission-readonly');
    return;
  }

  $scope.addClass('permission-readonly');

  if (selectors) {
    $scope.find(selectors).each(function () {
      $(this).prop('disabled', true).attr('data-permission-disabled', 'true').attr('title', noEditTitle);
    });
  }

  if (section === 'products') {
    $('#submitAddProduct, #addProductForm input, #addProductForm select, #addProductForm textarea, #addProductForm button:not(.btn-close):not([data-bs-dismiss="modal"])')
      .prop('disabled', true)
      .attr('data-permission-disabled', 'true')
      .attr('title', noEditTitle);
  }

  // 預約相關全域 Modal 控制項
  if (section === 'bookings') {
    $('#btnCompleteBooking, #equipmentReturnedCheck, #confirmCancelBtn, #cancelReasonInput')
      .prop('disabled', true)
      .attr('data-permission-disabled', 'true')
      .attr('title', noEditTitle);
  }
};

/** 無任何頁面權限時的提示畫面 / Empty state when no view permissions */
function showNoPermissionPage() {
  $('#contentArea').html(
    '<div class="text-center py-5">' +
    '<i class="fas fa-lock fa-3x text-muted mb-3"></i>' +
    '<p class="text-muted fs-5">您目前沒有任何頁面權限，請聯絡管理員。</p>' +
    '</div>'
  );
  $('#pageTitle').text('後台管理');
}

/** 載入預設首頁（第一個有 view 權限的 section） */
function loadDefaultHomeSection() {
  var defaultSection = window.getDefaultSection();

  if (!defaultSection) {
    showNoPermissionPage();
    return;
  }

  var title = getSectionTitle(defaultSection);
  $('#pageTitle').text(title);
  $('.sidebar-link').removeClass('active');
  $('.sidebar-link[data-section="' + defaultSection + '"]').addClass('active');
  loadSection(defaultSection);
}

/** 登出時清除全部 session 資料（5 個 key） */
function clearAdminSession() {
  sessionStorage.removeItem('adminLoggedIn');
  sessionStorage.removeItem('adminId');
  sessionStorage.removeItem('adminName');
  sessionStorage.removeItem('isSuperAdmin');
  sessionStorage.removeItem('adminPermissions');
}

$(document).ready(function () {

  // ==========================================================
  // === 1. Auth 守衛：驗證是否已登入 ===
  // ==========================================================
  // 說明：進入 dashboard.html 時，先檢查 sessionStorage 是否有登入標記
  //       若未登入則踢回 login.html
  // API 預留：實際串接後，改為向後端驗證 token 是否有效
  const isLoggedIn = sessionStorage.getItem('adminLoggedIn');
  if (!isLoggedIn) {
    window.location.href = 'login.html';
    return; // 停止後續 JS 執行
  }

  // 顯示管理員名稱（從 sessionStorage 取出）
  const adminName = sessionStorage.getItem('adminName') || '管理員';
  $('#sidebarAdminName').text(adminName);
  $('#topbarAdminName').html(`<i class="fas fa-user me-2"></i>${adminName}`);

  // 頭像縮寫（取名字第一個字）
  const initial = adminName.charAt(0).toUpperCase();
  $('#adminAvatarBtn').text(initial);

  // ==========================================================
  // === 2. Sidebar 權限 + 預設載入第一個可查看頁面 ===
  // ==========================================================
  window.applySidebarPermissions();
  loadDefaultHomeSection();

  // ==========================================================
  // === 3. Sidebar 導覽點擊事件 ===
  // ==========================================================
  // 說明：使用 $(document).on() 是因為手機版 Offcanvas 裡也有一份 Sidebar
  //       $(document).on() 能同時捕捉靜態 Sidebar 與 Offcanvas 裡的連結點擊
  $(document).on('click', '.sidebar-link', function (e) {
    e.preventDefault(); // 阻止連結跳頁

    const section = $(this).data('section');   // 取得模組名稱（例："orders"）
    const title = $(this).data('title');       // 取得頁面標題（例："訂單管理"）

    // 更新 Active 狀態：移除所有 active，只加在被點擊的連結
    // 注意：使用 class 選擇器 `.sidebar-link` 同時更新兩個 Sidebar（桌面版 + 手機版）
    $('.sidebar-link').removeClass('active');
    // 找到所有 data-section 相同的連結（桌面版 + Offcanvas 各一個）
    $(`.sidebar-link[data-section="${section}"]`).addClass('active');

    // 更新 Topbar 頁面標題
    $('#pageTitle').text(title || '後台管理');

    // 載入對應模組的 partial HTML
    loadSection(section);

    // 手機版：關閉 Offcanvas（如果目前是手機版且 Offcanvas 是開著的）
    const offcanvasEl = document.getElementById('mobileSidebar');
    if (offcanvasEl) {
      const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasEl);
      if (offcanvasInstance) offcanvasInstance.hide();
    }
  });

  // ==========================================================
  // === 4. 登出邏輯（Sidebar 底部 + Topbar 下拉選單）===
  // ==========================================================
  // 說明：點擊任意登出按鈕，清除 sessionStorage 並跳回登入頁
  $(document).on('click', '#logoutBtn, #logoutBtnTopbar, .sidebar-logout-mobile', function (e) {
    e.preventDefault();

    // 清除登入狀態（5 個 sessionStorage key）
    clearAdminSession();

    // 跳回登入頁
    window.location.href = 'login.html';
  });

}); // end $(document).ready()

// ==========================================================
// === loadSection(sectionName) — AJAX Partial 載入系統 ===
// ==========================================================
/**
 * 功能：載入指定功能模組的 HTML partial 到 #contentArea，
 *       載入完成後呼叫對應模組的初始化函式
 *
 * @param {string} sectionName - 模組名稱
 *   可選值：'analytics' | 'orders' | 'movement' | 'products' | 'customers' | 'discounts' | 'reviews' | 'bookings'
 *
 * --- API 預留說明 ---
 * 目前從本地 partials/ 資料夾載入靜態 HTML。
 * 若要串接後端，只需將 url 變數改為：
 *   const url = `/api/admin/partials/${sectionName}`;
 * 後端回傳動態 HTML 即可，其餘邏輯完全不變。
 */
function loadSection(sectionName) {
  // 1. 查看權限守衛：無 view 權限則阻擋
  if (!window.canView(sectionName)) {
    window.showAdminToast('您沒有「' + getSectionTitle(sectionName) + '」的查看權限', 'error');
    return;
  }

  // 本地 partial 路徑
  const url = `partials/${sectionName}.html`;

  // 顯示 Loading 動畫（在內容出現之前給使用者視覺回饋）
  $('#contentArea').html(`
    <div class="text-center py-5">
      <div class="spinner-border" style="color: var(--admin-brand-accent);"></div>
      <p class="mt-2 text-muted small">載入中...</p>
    </div>
  `);

  // 使用 jQuery $.load() 載入 HTML 到 #contentArea
  // $.load() 說明：
  //   - 第一個參數：要載入的 URL
  //   - 第二個參數（callback）：載入完成後執行的函式
  //   - callback 的 status 參數：'success' 代表成功，'error' 代表失敗
  $('#contentArea').load(url, function (response, status) {

    // 載入失敗時顯示錯誤訊息
    if (status === 'error') {
      $('#contentArea').html(`
        <div class="alert yr-admin-alert yr-admin-alert--danger d-flex align-items-center gap-2" role="alert">
          <i class="fas fa-exclamation-triangle yr-admin-alert__icon" aria-hidden="true"></i>
          <span class="yr-admin-alert__content">
            <span class="yr-admin-alert__message">載入 <strong>${sectionName}</strong> 模組失敗，請重新整理頁面。</span>
          </span>
        </div>
      `);
      return;
    }

    // 載入成功：加上淡入動畫效果
    $('#contentArea').addClass('section-fade-in');
    setTimeout(() => $('#contentArea').removeClass('section-fade-in'), 300);

    // 呼叫對應模組的初始化函式
    // 說明：各模組的 JS 檔（analytics.js、orders.js 等）都把初始化函式
    //       掛載到 window 上（window.initXxx = function(){}），
    //       這樣 core.js 就能統一用字典的方式呼叫，不需要 if/else 判斷
    const initFunctions = {
      analytics:   window.initAnalytics,
      orders:      window.initOrders,
      movement:    window.initMovement,
      products:    window.initProducts,
      customers:   window.initCustomers,
      discounts:   window.initDiscounts,
      reviews:     window.initReviews,
      bookings:    window.initBookings,
      permissions: window.initPermissions,
    };

    // 確認初始化函式存在後再呼叫
    if (typeof initFunctions[sectionName] === 'function') {
      initFunctions[sectionName]();
    }

    // 3. 靜態元素套用編輯權限（動態渲染的由各自模組 render 後再呼叫）
    window.applyEditPermission(sectionName, $('#contentArea'));
  });
}

// ==========================================================
// === showAdminToast(message, type) — Toast 工廠函式 ===
// ==========================================================
/**
 * 功能：在後台右下角顯示短暫提示訊息（Toast Notification）
 *
 * @param {string} message - 提示文字
 * @param {string} type    - 類型：'success'（預設）| 'error' | 'info'
 *
 * 呼叫範例：
 *   window.showAdminToast('訂單已更新');
 *   window.showAdminToast('請填寫完整資料', 'error');
 *   window.showAdminToast('操作記錄已儲存', 'info');
 */
window.showAdminToast = function (message, type = 'success') {

  // 顏色與圖示的對照表
  const toneMap = {
    success: 'yr-admin-alert--success',
    warning: 'yr-admin-alert--warning',
    error:   'yr-admin-alert--danger',
    danger:  'yr-admin-alert--danger',
    info:    'yr-admin-alert--info',
  };
  const iconMap = {
    success: 'fa-check-circle',
    warning: 'fa-circle-exclamation',
    error:   'fa-times-circle',
    danger:  'fa-times-circle',
    info:    'fa-info-circle',
  };

  const toneClass = toneMap[type] || toneMap.success;
  const iconClass = iconMap[type] || iconMap.success;

  // Toast HTML 結構（Bootstrap 5 原生 Toast 元件）
  const toastHtml = `
    <div class="toast align-items-center yr-admin-alert ${toneClass} yr-admin-toast"
         role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center gap-2 yr-admin-alert__content">
          <i class="fas ${iconClass} yr-admin-alert__icon" aria-hidden="true"></i>
          <span class="yr-admin-alert__message">${message}</span>
        </div>
        <button type="button" class="btn-close me-2 m-auto yr-admin-alert__close"
                data-bs-dismiss="toast" aria-label="關閉"></button>
      </div>
    </div>`;

  // 確保 Toast 容器存在（固定在右下角）
  // 若不存在則動態建立
  if ($('#toastContainer').length === 0) {
    $('body').append(
      '<div id="toastContainer" class="toast-container position-fixed bottom-0 end-0 p-3"' +
      ' style="z-index: 1100;"></div>'
    );
  }

  // 建立 Toast 並加到容器，然後顯示
  const $container = $('#toastContainer');
  if ($container.children('.toast').length >= 3) {
    $container.children('.toast').first().remove();
  }
  const $toast = $(toastHtml).appendTo('#toastContainer');
  const bsToast = new bootstrap.Toast($toast[0], {
    delay: 3000,    // 3 秒後自動消失
    autohide: true, // 自動隱藏
  });
  bsToast.show();

  // Toast 消失後從 DOM 移除，避免越堆越多造成記憶體浪費
  $toast[0].addEventListener('hidden.bs.toast', function () {
    $toast.remove();
  });
};
