/**
 * admin/js/products.js
 * 商品 & 庫存管理模組
 * 使用 jQuery Event Namespace (.products) 防止重複導覽時事件堆疊
 *
 * products.json 欄位對應：thumbnail（非 image）、status:"active"/"disabled"（非 active:bool）
 * 分店庫存由 branch.branch-001 / branch-002 / branch-003 保存，總庫存由 total-stock 保存。
 * 低庫存的 <tr> 加上 table-danger class，整列顯示淡紅色背景；單格低於最低值加橘色標示
 * 低庫存閾值由各商品各分店在 min_stock.json 獨立設定（預設 5）
 */

var PRODUCT_IMAGE_PLACEHOLDER = 'https://placehold.co/48x48/cccccc/555555?text=No+Image';
var PRODUCT_REQUIRED_SELECTORS = [
  '#productsSearchInput',
  '#productsCategoryFilter',
  '#productsStatusFilter',
  '#productsStockFilter',
  '#productsSortSelect',
  '#productsClearFilters',
  '#productsResultCount',
  '#productsTable',
  '#productsTableBody',
  '#rentalProductsTable',
  '#rentalProductsTableBody',
];

// 商店主倉固定 ID 與顯示名稱
// Store main warehouse ID and display label
var ADMIN_STORE_WAREHOUSE_ID = 'main';
var ADMIN_STORE_WAREHOUSE_LABEL = '商店主倉';

// 租借主倉固定 ID 與顯示名稱（與商店主倉為不同實體倉庫，ID / 標籤皆獨立）
// Rental main warehouse ID and display label — physically separate from store warehouse
var ADMIN_RENTAL_WAREHOUSE_ID = 'rental-main';
var ADMIN_RENTAL_WAREHOUSE_LABEL = '租借主倉';

// 商店分店 ID 清單：主倉排第一，其餘為實體分店
// Store branch IDs: main warehouse first, then physical branches
var ADMIN_PRODUCT_BRANCH_IDS = ['main', 'branch-001', 'branch-002', 'branch-003'];
var ADMIN_PRODUCT_BRANCH_LABELS = {
  main: '商店主倉',
  'branch-001': '分店 A',
  'branch-002': '分店 B',
  'branch-003': '分店 C',
};

// 租借商品固定地點 ID：租借主倉排第一，其餘為實體營地（對應 ADMIN_RENTAL_CAMP_LABELS 的 key）
// Rental location IDs: rental warehouse first, then fixed camp IDs (keys for ADMIN_RENTAL_CAMP_LABELS)
var ADMIN_RENTAL_CAMP_IDS = ['rental-main', 'camp-001', 'camp-002', 'camp-003', 'camp-004', 'camp-005'];

// 租借商品固定地點顯示名稱（對應 reantal.json 內的 camp[].name）
// Display labels for fixed rental locations (matched against camp[].name in reantal.json)
var ADMIN_RENTAL_CAMP_LABELS = {
  'rental-main': '租借主倉',
  'camp-001': '湖畔星空',
  'camp-002': '松林野營',
  'camp-003': '溪谷森林',
  'camp-004': '雲海高原',
  'camp-005': '海岸微風',
};

// 完整名稱（用於 reantal.json 寫回與 Modal 顯示）
// Full names used when writing back to reantal.json and displaying in Modal
var ADMIN_RENTAL_CAMP_FULL_NAMES = {
  'rental-main': '租借主倉',
  'camp-001': '湖畔星空營地',
  'camp-002': '松林野營基地',
  'camp-003': '溪谷森林營地',
  'camp-004': '雲海高原營地',
  'camp-005': '海岸微風營地',
};

var adminProductsCache = [];
var adminRentalsCache = [];
var adminRentalsLoaded = false;
var pendingMovementItems = [];

// ── 最低庫存功能全域狀態 ──────────────────────────────────────────────────────
// Min-stock feature global state

// 從 min_stock.json 載入的最低庫存快取
// Cache loaded from min_stock.json: { store: { P001: { main:5, ... } }, rental: {...} }
var adminMinStockCache = {};

// 是否目前處於「最低庫存設定模式」
// Whether the table is currently showing the min-stock edit mode
var isMinStockMode = false;

// 找不到對應設定時使用的預設最低庫存值
// Default minimum stock value when no specific setting is found
var PRODUCT_MIN_STOCK_DEFAULT = 5;
// 租借待處理的庫存異動明細（與商店的 pendingMovementItems 分開追蹤）
// Pending rental movement items, tracked separately from store items
var pendingRentalMovementItems = [];
var productViewState = {
  activeView: 'store',
  searchQuery: '',
  category: '',
  status: '',
  stock: '',
  sortBy: 'default',
};

/**
 * 取得指定商品、指定分店 / 營地的最低庫存閾值。
 * 若 adminMinStockCache 裡找不到對應的值，回傳全域預設值 PRODUCT_MIN_STOCK_DEFAULT。
 *
 * Get the minimum stock threshold for a given product and location.
 * Falls back to PRODUCT_MIN_STOCK_DEFAULT if not found in adminMinStockCache.
 *
 * @param {string} productType  - 'store' 或 'rental'
 * @param {string} productId    - 商品 ID，例如 'P001' / 'R001'
 * @param {string} locationId   - 分店 / 營地 ID，例如 'branch-001' / 'camp-001'
 * @returns {number} 最低庫存值（整數，≥ 0）
 */
function getMinStockValue(productType, productId, locationId) {
  var typeCache = adminMinStockCache[productType] || {};
  var productCache = typeCache[productId] || {};
  var val = productCache[locationId];

  if (val !== undefined) {
    var parsed = parseInt(val, 10);
    return isNaN(parsed) ? PRODUCT_MIN_STOCK_DEFAULT : Math.max(parsed, 0);
  }

  return PRODUCT_MIN_STOCK_DEFAULT;
}

/**
 * 判斷商店商品是否處於低庫存狀態（雙層判斷）：
 * ① 任一分店實際庫存 < 該分店最低值
 * ② 總庫存 < 所有分店最低值加總
 *
 * Returns true if the store product is considered low-stock (dual-criteria).
 *
 * @param {Object} product - 商店商品物件（含 branch 欄位）
 * @returns {boolean}
 */
function isStoreProductLowStock(product) {
  if (!product) {
    return false;
  }

  // 判斷①：任一分店庫存低於其最低值
  // Criterion 1: any branch below its individual minimum
  var anyBranchLow = ADMIN_PRODUCT_BRANCH_IDS.some(function (branchId) {
    return getProductBranchStock(product, branchId) < getMinStockValue('store', product.id, branchId);
  });

  if (anyBranchLow) {
    return true;
  }

  // 判斷②：總庫存低於所有分店最低值加總
  // Criterion 2: total stock below sum of all branch minimums
  var totalMinimum = ADMIN_PRODUCT_BRANCH_IDS.reduce(function (sum, branchId) {
    return sum + getMinStockValue('store', product.id, branchId);
  }, 0);

  return (product['total-stock'] || 0) < totalMinimum;
}

/**
 * 取得商店商品中庫存低於最低值的分店 ID 陣列。
 * Returns an array of branchIds where actual stock < minimum stock.
 *
 * @param {Object} product - 商店商品物件
 * @returns {string[]}
 */
function getLowBranchIds(product) {
  if (!product) {
    return [];
  }

  return ADMIN_PRODUCT_BRANCH_IDS.filter(function (branchId) {
    return getProductBranchStock(product, branchId) < getMinStockValue('store', product.id, branchId);
  });
}

/**
 * 判斷租借商品是否處於低庫存狀態（雙層判斷）：
 * ① 任一營地實際庫存 < 該營地最低值
 * ② 總庫存 < 所有營地最低值加總
 *
 * @param {Object} rental - 租借商品物件（含 campByKey 欄位）
 * @returns {boolean}
 */
function isRentalProductLowStock(rental) {
  if (!rental) {
    return false;
  }

  var campByKey = rental.campByKey || {};
  var allKeys = Object.keys(campByKey);

  // 判斷①：任一營地庫存低於其最低值
  var anyLow = allKeys.some(function (key) {
    return normalizeStockValue(campByKey[key]) < getMinStockValue('rental', rental.id, key);
  });

  if (anyLow) {
    return true;
  }

  // 判斷②：總庫存低於所有營地最低值加總
  var totalMinimum = allKeys.reduce(function (sum, key) {
    return sum + getMinStockValue('rental', rental.id, key);
  }, 0);

  var totalStock = allKeys.reduce(function (sum, key) {
    return sum + normalizeStockValue(campByKey[key]);
  }, 0);

  return totalStock < totalMinimum;
}

/**
 * 取得租借商品中庫存低於最低值的營地 key 陣列。
 * Returns an array of campKeys where actual stock < minimum stock.
 *
 * @param {Object} rental - 租借商品物件（含 campByKey 欄位）
 * @returns {string[]}
 */
function getLowCampKeys(rental) {
  if (!rental) {
    return [];
  }

  var campByKey = rental.campByKey || {};

  return Object.keys(campByKey).filter(function (key) {
    return normalizeStockValue(campByKey[key]) < getMinStockValue('rental', rental.id, key);
  });
}

window.initProducts = function () {
  $(document).off('.products');

  // 切換到商品頁時，最低庫存模式重置為正常模式，避免狀態殘留
  // Reset min-stock mode when navigating back to products page
  isMinStockMode = false;
  productViewState.activeView = 'store';
  productViewState.searchQuery = '';
  productViewState.category = '';
  productViewState.status = '';
  productViewState.stock = '';
  productViewState.sortBy = 'default';

  if (!validateProductsDom()) {
    return;
  }

  resetProductsFilterInputs();

  bindProductViewTabs();
  bindProductsFilters();

  // ── 讀取並消費 pendingNavFilter（從 KPI 卡片「低庫存商品」跳來時） ──
  var _showLowStock = false;
  if (window.pendingNavFilter && window.pendingNavFilter.section === 'products') {
    _showLowStock = !!window.pendingNavFilter.lowStockOnly;
    window.pendingNavFilter = null; // 消費後立即清除
  }

  // 並行載入 products.json 與 min_stock.json，兩者都就緒後才渲染表格。
  // min_stock.json 載入失敗時靜默降級，全部使用預設值 PRODUCT_MIN_STOCK_DEFAULT。
  // Load products.json and min_stock.json in parallel; render only when both are ready.
  // If min_stock.json fails, silently fall back to PRODUCT_MIN_STOCK_DEFAULT for all items.
  $.when(
    $.getJSON('data/products.json'),
    $.getJSON('data/min_stock.json').then(null, function () {
      // 靜默降級：min_stock.json 不存在或格式錯誤時，回傳空物件
      // Silent fallback: return empty object if min_stock.json is missing or broken
      return $.Deferred().resolve({}).promise();
    })
  )
    .done(function (productsResult, minStockResult) {
      // $.when 的回傳格式：每個 deferred 的結果被包裝成 [data, status, jqXHR]
      // $.when result format: each deferred result is wrapped as [data, status, jqXHR]
      var products = Array.isArray(productsResult) ? productsResult[0] : productsResult;
      var minStock = Array.isArray(minStockResult) ? minStockResult[0] : minStockResult;

      adminMinStockCache = minStock && typeof minStock === 'object' ? minStock : {};
      adminProductsCache = (products || []).map(normalizeProductBranch);
      renderProductsTable(adminProductsCache);

      // 低庫存導航：渲染完成後，捲動到第一列紅色（低庫存）商品並顯示提示
      if (_showLowStock) {
        // 稍微延遲確保 DOM 已完整插入
        setTimeout(function () {
          var $firstLowStock = $('#productsTableBody tr.table-danger').first();
          if ($firstLowStock.length) {
            // 滾動到低庫存列（目標列上方保留 64px 間距，避免被 topbar 遮住）
            $('html, body').animate(
              {
                scrollTop: $firstLowStock.offset().top - 64,
              },
              300
            );
            window.showAdminToast('已標示庫存不足的商品（紅色列）', 'info');
          } else {
            window.showAdminToast('目前所有商品庫存充足', 'info');
          }
        }, 100);
      }
    })
    .fail(function () {
      $('#productsTableBody').html(
        '<tr><td colspan="10" class="text-center text-danger py-4">' +
          '<i class="fas fa-exclamation-triangle me-2"></i>載入商品數據失敗' +
          '</td></tr>'
      );
    });

  // 頁面初始化時即預載租借資料（Eager Loading）
  // 確保使用者尚未切換到租借頁籤就開啟調撥 Modal 時，adminRentalsCache 已可用
  // loadRentalProducts() 內有 adminRentalsLoaded 冪等保護，不會重複請求
  loadRentalProducts();

  loadProductSpecOptions();

  // ── 最低庫存設定模式切換 ──────────────────────────────────────────────────
  // Min-stock mode toggle: switch between normal stock view and minimum threshold edit view
  $(document).on('click.products', '#toggleMinStockMode', function () {
    isMinStockMode = !isMinStockMode;
    updateMinStockModeUI();
    // 重新渲染目前可見的頁籤表格
    // Re-render the currently visible tab's table
    var $storePanel = $('.admin-products-panel[data-products-panel="store"]');
    if (!$storePanel.hasClass('d-none')) {
      renderProductsTable(adminProductsCache);
    } else {
      renderRentalProductsTable(adminRentalsCache);
    }
  });

  // 最低庫存模式確定按鈕：儲存最低庫存設定（不走庫存異動流程）
  // Min-stock confirm button: save minimum stock settings (no movement record)
  $(document).on('click.products', '.min-stock-confirm-btn', function () {
    var $row = $(this).closest('tr');
    var productId = $row.data('product-id');
    var inventoryType = $row.data('inventory-type') || 'store';
    saveMinStockValues($row, productId, inventoryType);
  });

  // 從列表開啟新增商品 Modal 時，清空上一次編輯狀態
  $(document).on('click.products', '[data-bs-target="#addProductModal"]', function () {
    resetProductModalForm();
  });

  // 新增商品 Modal：切換租借商品 switch
  // 行為依目前模式而異：
  //   新增模式 → 阻止切為 ON（租借商品不可手動新增，需透過商店商品編輯設定）
  //   商店編輯模式 → ON：顯示租借營地設定；OFF：驗證所有租借庫存為 0 後才可切換
  //   租借編輯模式 → switch 不顯示，此 handler 不應被觸發
  $(document).on('change.products', '#newProductIsRental', function () {
    var $form = $('#addProductForm');
    var editType = $form.data('edit-type') || 'store';
    var editProductId = $form.data('edit-product-id');
    var isChecked = $(this).is(':checked');

    // ── 新增模式（無 edit-product-id）──────────────────────────────────────
    // Add mode: prevent switch from being turned ON
    if (!editProductId) {
      if (isChecked) {
        $(this).prop('checked', false);
        window.showAdminToast('租借商品請透過商店商品名稱點擊編輯設定，不可在新增時直接切換', 'warning');
      }
      return;
    }

    // ── 商店編輯模式 ────────────────────────────────────────────────────────
    if (editType === 'store') {
      if (isChecked) {
        // ON：載入或建立租借資料，顯示營地設定區塊
        var product = findAdminProductById(editProductId);
        var existingRentalId = product ? product.rentalId : null;
        if (existingRentalId) {
          // 已有對應租借商品：帶入現有資料
          var linkedRental = findAdminRentalById(existingRentalId);
          syncRentalFormState(true, true, true);
          if (linkedRental) {
            populateRentalCampFields(linkedRental.camp);
          }
        } else {
          // 尚無對應租借商品：顯示空的營地設定（各營地皆為 0）
          syncRentalFormState(true, true, true);
          populateRentalCampFields([]);
        }
      } else {
        // OFF：驗證所有租借營地數量皆為 0，才允許切換
        var allZero = true;
        var $mainQty = $('#rentalEditMainQty');
        if ($mainQty.length && normalizeStockValue($mainQty.val()) > 0) {
          allZero = false;
        }
        if (allZero) {
          $('#rentalCampPresetList .rental-camp-quantity-input').each(function () {
            if (normalizeStockValue($(this).val()) > 0) {
              allZero = false;
              return false;
            }
          });
        }
        if (allZero) {
          $('#rentalCampList .rental-camp-quantity-input').each(function () {
            if (normalizeStockValue($(this).val()) > 0) {
              allZero = false;
              return false;
            }
          });
        }

        if (!allZero) {
          // 阻止切換：恢復 switch 為 ON
          $(this).prop('checked', true);
          window.showAdminToast('請先將所有租借營地庫存歸零，才能停用租借商品設定', 'danger');
          return;
        }

        // 允許切換：隱藏營地區塊
        syncRentalFormState(false, false, true);
      }
    }
  });

  // （已移除固定營地 checkbox 監聽器，所有營地直接顯示可編輯欄位）
  // Rental-camp-check handler removed; all preset camps are always editable.

  // 新增自訂營地按鈕：每次點擊新增一列自訂名稱 + 數量欄位。
  // Add custom camp row on button click.
  $(document).on('click.products', '#addRentalCamp', function () {
    appendRentalCampField('', 0);
    updateRentalStockFromCampFields();
  });

  // 租借營地資料異動時，重新加總各營地數量並同步到唯讀庫存欄位。
  $(document).on(
    'input.products change.products',
    '.rental-camp-name-input, .rental-camp-quantity-input',
    function () {
      updateRentalStockFromCampFields();
    }
  );

  // 自訂營地列可移除。
  // Custom camp rows can be removed.
  $(document).on('click.products', '.remove-rental-camp-btn', function () {
    $(this).closest('.rental-camp-row').remove();
    updateRentalStockFromCampFields();
  });

  // 庫存數量步進：僅最低庫存設定模式使用 ± 步進器。
  // Stock stepper: only used in min-stock edit mode.
  $(document).on('click.products', '.stock-step-btn', function () {
    var $control = $(this).closest('.admin-stock-control');
    var $input = $control.find('.stock-input');
    var action = $(this).data('stock-action');
    var currentQty = getStockInputValue($input);
    var nextQty = action === 'decrement' ? currentQty - 1 : currentQty + 1;

    $input.val(Math.max(nextQty, 0)).trigger('input');
  });

  // 庫存 inline 輸入異動：更新勾選按鈕狀態。
  $(document).on('input.products change.products', '.stock-input', function () {
    syncStockConfirmState($(this).closest('tr'));
  });

  // 鉛筆：整列進入庫存編輯模式 / Pencil → enter row stock edit mode
  $(document).on('click.products', '.stock-edit-btn', function () {
    enterStockEditMode($(this).closest('tr'));
  });

  // X：取消編輯並還原 / Cancel and revert row stock edits
  $(document).on('click.products', '.stock-cancel-btn', function () {
    exitStockEditMode($(this).closest('tr'), true);
  });

  // 勾選：確認庫存異動 / Check → confirm stock change
  $(document).on('click.products', '.stock-confirm-btn', function () {
    var $button = $(this);
    var $row = $button.closest('tr');
    var inventoryType = $row.data('inventory-type') || 'store';
    var productId = $row.data('product-id');

    if (inventoryType === 'rental') {
      confirmRentalStockChange($row, productId, $button);
      return;
    }

    var product = findAdminProductById(productId);

    if (!product) {
      window.showAdminToast('找不到商品 ' + productId + ' 的資料', 'danger');
      return;
    }

    // 讀取所有分店（含主倉）的數值
    // Read all branch values including main warehouse
    var branchStock = {};
    ADMIN_PRODUCT_BRANCH_IDS.forEach(function (branchId) {
      branchStock[branchId] = getRowStockValue($row, branchId);
    });

    // V-001：商店主倉不可為負數
    // V-001: Store main warehouse value must not be negative
    var rowMainQty = normalizeStockValue(branchStock[ADMIN_STORE_WAREHOUSE_ID]);
    if (rowMainQty < 0) {
      window.showAdminToast('商店主倉數量不可為負數', 'danger');
      return;
    }

    // total 由各分店加總自動計算（不再手動輸入）
    // total is always auto-computed from branch sum — no manual input
    var totalStock = getBranchTotal(branchStock);

    confirmStoreStockChange($row, product, branchStock, totalStock);
  });

  // 將商店與租借已通過確定檢查的庫存異動，合併成一筆庫存異動紀錄。
  // Merge store and rental pending items into one movement record.
  $(document).on('click.products', '#generateMovementRecord', function () {
    var allItems = pendingMovementItems.concat(pendingRentalMovementItems);

    if (allItems.length === 0) {
      window.showAdminToast('目前沒有可生成的庫存異動明細', 'info');
      return;
    }

    var record = {
      id: createMovementRecordId(),
      date: formatMovementDate(new Date()),
      employeeId: getCurrentAdminId(),
      items: allItems,
    };

    if (typeof window.addMovementRecord === 'function') {
      window.addMovementRecord(record);
    } else {
      window.generatedMovementRecords = window.generatedMovementRecords || [];
      window.generatedMovementRecords.unshift(record);
    }

    // 清空兩個佇列
    // Clear both store and rental pending queues
    pendingMovementItems = [];
    pendingRentalMovementItems = [];
    updateMovementGenerateButtonState();
    window.showAdminToast('已產生庫存異動紀錄 ' + record.id);
  });

  // 調至租借按鈕（商店 tab）：開啟調撥 Modal 並帶入商品資料
  // Transfer-to-rental button (store tab): open the modal and populate product data
  $(document).on('click.products', '.transfer-to-rental-btn', function () {
    var productId = $(this).data('product-id');
    openTransferToRentalModal(productId);
  });

  // 調撥按鈕（租借 tab）：在商店快取中找對應的商店商品，再開啟同一個調撥 Modal
  // Transfer button (rental tab): find the linked store product, then open the same transfer modal
  $(document).on('click.products', '.transfer-from-rental-btn', function () {
    var rentalId = $(this).data('rental-id');
    // 在商店快取中找 rentalId 吻合的商店商品
    var storeProduct = null;
    for (var i = 0; i < adminProductsCache.length; i++) {
      if (adminProductsCache[i].rentalId === rentalId) {
        storeProduct = adminProductsCache[i];
        break;
      }
    }
    if (storeProduct) {
      openTransferToRentalModal(storeProduct.id);
    } else {
      window.showAdminToast('此租借商品無對應的商店商品，無法從分店調撥；請改用「營地互轉」', 'warning');
    }
  });

  // 來源分店切換：依選取值切換 Mode 1（分店→營地）或 Mode 2（營地互轉）
  // Source branch changed: switch between Mode 1 (branch→camp) and Mode 2 (camp transfer)
  $(document).on('change.products', '#transferSourceBranch', function () {
    var val = $(this).val();
    if (val === 'camp-transfer') {
      switchTransferMode('camp');
    } else {
      switchTransferMode('branch');
    }
  });

  // 「新增營地」按鈕：依目前模式附加一列自訂營地
  // Add camp row button: append a custom row based on current mode
  $(document).on('click.products', '#addTransferCampRow', function () {
    var isCampMode = $('#transferSourceBranch').val() === 'camp-transfer';
    appendCustomTransferCampRow(isCampMode);
    syncTransferDeltaCounter();
  });

  // 刪除自訂營地列：移除該列並重新計算計數器
  // Remove custom camp row: remove row and update counter
  $(document).on('click.products', '.remove-transfer-camp-row', function () {
    $(this).closest('.transfer-camp-row').remove();
    syncTransferDeltaCounter();
  });

  // 更動數量（delta）輸入：即時更新計數器
  // Delta input: update counter on every keystroke
  $(document).on('input.products', '.transfer-camp-delta', function () {
    syncTransferDeltaCounter();
  });

  // 確認調撥
  $(document).on('click.products', '#submitTransferToRental', function () {
    submitTransferToRental();
  });

  // 編輯商品：點擊商品名稱開啟新增商品 Modal，並從快取帶入資料
  $(document).on('click.products', '.edit-product-name', function () {
    var $row = $(this).closest('tr');
    var inventoryType = $row.data('inventory-type') || 'store';
    var productId = $row.data('product-id');

    if (inventoryType === 'rental') {
      var rental = findAdminRentalById(productId);

      if (!rental) {
        window.showAdminToast('找不到租借商品 ' + productId + ' 的資料', 'danger');
        return;
      }

      fillRentalModal(rental);
      bootstrap.Modal.getOrCreateInstance(document.getElementById('addProductModal')).show();
      return;
    }

    var product = findAdminProductById(productId);

    if (!product) {
      window.showAdminToast('找不到商品 ' + productId + ' 的資料', 'danger');
      return;
    }

    fillProductModal(product);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addProductModal')).show();
  });

  // 新增規格欄位
  $(document).on('click.products', '#addSpec', function () {
    var specKey = $('#newProductSpec').val().trim();
    if (!specKey) {
      window.showAdminToast('請先輸入或選擇規格名稱', 'danger');
      return;
    }

    var isDuplicate = $('#productSpecFields input[data-spec-key]')
      .toArray()
      .some(function (input) {
        return input.id === specKey;
      });

    if (isDuplicate) {
      window.showAdminToast('此規格欄位已存在', 'danger');
      return;
    }

    var $field = $('<div>', { class: 'mb-2 product-spec-field' });
    var $label = $('<label>', { class: 'form-label small text-muted mb-1' })
      .attr('for', specKey)
      .text(specKey);
    var $input = $('<input>', {
      type: 'text',
      class: 'form-control form-control-sm',
    })
      .attr('id', specKey)
      .attr('data-spec-key', specKey);

    $field.append($label, $input);
    $('#productSpecFields').append($field);
    $('#newProductSpec').val('').trigger('focus');
  });

  // ── Task 6：分店庫存數量即時加總 ────────────────────────────────────────────
  // 每次輸入數量時，加總所有勾選分店並更新唯讀總庫存顯示。
  // Update the read-only total whenever any branch quantity changes.
  $(document).on('input.products', '.edit-branch-quantity-input', function () {
    updateEditBranchTotal();
  });

  // 新增商品
  $(document).on('click.products', '#submitAddProduct', function () {
    var name = $('#newProductName').val().trim();
    var price = parseInt($('#newProductPrice').val(), 10) || 0;
    var stock = parseInt($('#newProductStock').val(), 10) || 0;
    var category = $('#newProductCategory').val().trim();
    var isRental = $('#newProductIsRental').is(':checked');
    var rentalCampState = collectRentalCampFields();
    var mainImageInput = $('#newProductMainImage')[0];
    var secondaryImageInput = $('#newProductImages')[0];
    var mainImageFile = mainImageInput && mainImageInput.files.length > 0 ? mainImageInput.files[0] : null;
    var secondaryImageFiles = secondaryImageInput
      ? Array.prototype.slice.call(secondaryImageInput.files)
      : [];
    var specifications = getAddedSpecifications();
    var $form = $('#addProductForm');
    var editProductId = $form.data('edit-product-id');
    var existingThumbnail = $form.data('existing-thumbnail');
    var existingImages = $form.data('existing-images') || [];
    var existingStatus = $form.data('existing-status') || 'active';
    var editType = $form.data('edit-type') || 'store';

    // ── 路徑判斷：租借編輯 vs 商店（新增 or 編輯）──────────────────────────
    // Route: rental edit path OR store path (new/edit)
    // 租借編輯：editType === 'rental'
    // 商店新增/編輯：其他情況（含商店編輯時 switch ON 狀態）
    var isRentalEditPath = editType === 'rental';

    // 驗證：名稱必填；非租借編輯路徑時售價也必填
    if (!name || (!isRentalEditPath && price <= 0)) {
      window.showAdminToast(isRentalEditPath ? '請填寫商品名稱' : '請填寫商品名稱和有效的價格', 'danger');
      return;
    }

    if (isRentalEditPath) {
      var rentalEditId = editProductId;
      var rentalCamps;

      if (rentalEditId) {
        // 編輯模式：從 Modal 的營地欄位收集（自訂營地名稱不可為空）
        // Edit mode: collect from Modal camp fields (custom camp names must not be empty)
        if (!rentalCampState.valid) {
          window.showAdminToast('請填寫自訂營地名稱', 'danger');
          return;
        }
        rentalCamps = rentalCampState.camps;
      } else {
        // 新增模式：進貨全進主倉，各營地初始為 0
        // Add mode: all stock goes to main warehouse; camps start at zero
        var rentalWarehouseQty = normalizeStockValue($('#newRentalWarehouseStock').val());
        rentalCamps = buildInitialRentalCamps(rentalWarehouseQty);
      }

      // 編輯租借商品：先做異動驗證，通過後才寫入快取與更新 UI
      // Edit rental: validate movement first, then upsert cache and update UI
      var oldRentalForMovement = rentalEditId ? findAdminRentalById(rentalEditId) : null;
      var rentalMovementItemsToAdd = [];

      if (rentalEditId && oldRentalForMovement) {
        // 將新 camp 陣列轉換為 campByKey 格式，以便與舊的 campByKey 比對
        // Convert new camp[] to campByKey for diff with old campByKey
        var nextCampByKey = {};
        ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
          nextCampByKey[id] = 0;
        });
        rentalCamps.forEach(function (camp) {
          var campId = getCampIdByName(camp.name);
          if (campId) {
            nextCampByKey[campId] = normalizeStockValue(camp.quantity);
          } else {
            nextCampByKey[camp.name] = normalizeStockValue(camp.quantity);
          }
        });

        // V-001（租借）：租借主倉不可為負數
        // V-001 (rental): Rental main warehouse stock must not be negative
        var rentalNewMainQty = normalizeStockValue(nextCampByKey[ADMIN_RENTAL_WAREHOUSE_ID]);
        if (rentalNewMainQty < 0) {
          window.showAdminToast('租借主倉數量不可為負數', 'danger');
          return;
        }

        // 產生租借庫存異動記錄（已移除損耗備註驗證，直接計算異動）
        // Generate rental movement items (loss-reason validation removed)
        var rentalMovementResult = buildMovementItemsForRentalChange(oldRentalForMovement, nextCampByKey);
        if (!rentalMovementResult.valid) {
          window.showAdminToast(rentalMovementResult.message, 'danger');
          return;
        }
        rentalMovementItemsToAdd = rentalMovementResult.items;
      }

      // 驗證通過：寫入快取
      var rentalItem = {
        id: rentalEditId || 'R-NEW-' + Date.now(),
        image: mainImageFile
          ? URL.createObjectURL(mainImageFile)
          : existingThumbnail || PRODUCT_IMAGE_PLACEHOLDER,
        name: name,
        category: category || '其他',
        camp: rentalCamps,
      };

      rentalItem = upsertAdminRentalCache(rentalItem);

      // 異動紀錄推入待處理佇列
      // Push validated movement items into the pending queue
      if (rentalMovementItemsToAdd.length > 0) {
        pendingRentalMovementItems = pendingRentalMovementItems.concat(rentalMovementItemsToAdd);
        updateMovementGenerateButtonState();
      }

      if (rentalEditId) {
        $('#rentalProductsTableBody tr[data-product-id="' + escapeSelector(rentalEditId) + '"]').replaceWith(
          $(buildRentalRow(rentalItem)).hide().fadeIn(400)
        );
      } else {
        $('#rentalProductsTableBody').prepend($(buildRentalRow(rentalItem)).hide().fadeIn(400));
      }

      resetProductModalForm();
      switchProductView('rental');
      var rentalModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('addProductModal'));
      rentalModal.hide();
      window.showAdminToast('租借商品「' + name + '」已' + (editProductId ? '更新' : '新增'));
      return;
    }

    var storeEditId = editType === 'store' ? editProductId : null;

    // 編輯模式：從 #editBranchPresetList 讀取各分店庫存；新增模式：全部進主倉。
    // Edit mode: read branch quantities from modal fields; add mode: all stock goes to main warehouse.
    var newBranchStock;
    if (storeEditId) {
      newBranchStock = collectEditBranchStockFields();
    } else {
      newBranchStock = createInitialBranchStock(stock);
    }

    var newTotalStock = getBranchTotal(newBranchStock);
    var newProduct = {
      id: storeEditId || 'P-NEW-' + Date.now(),
      thumbnail: mainImageFile
        ? URL.createObjectURL(mainImageFile)
        : existingThumbnail || PRODUCT_IMAGE_PLACEHOLDER,
      name: name,
      category: category || '其他',
      spec: $('#newProductSpec').val().trim(),
      price: price,
      'total-stock': newTotalStock,
      branch: newBranchStock,
      status: existingStatus,
      images:
        secondaryImageFiles.length > 0
          ? secondaryImageFiles.map(function (file) {
              return file.name;
            })
          : existingImages,
      specifications: specifications,
    };

    // V-001：商店主倉不可為負數
    // V-001: Store main warehouse stock must not be negative
    var newMainQty = normalizeStockValue(newBranchStock[ADMIN_STORE_WAREHOUSE_ID]);
    if (newMainQty < 0) {
      window.showAdminToast('商店主倉數量不可為負數', 'danger');
      return;
    }

    // 編輯模式：比對舊分店庫存，產生異動紀錄（進貨 / 調撥，已移除損耗備註驗證）
    // Edit mode: compare old branch values and generate movement items (loss-reason validation removed)
    if (storeEditId) {
      var oldProduct = findAdminProductById(storeEditId);
      if (oldProduct) {
        var movementResult = buildMovementItemsForBranchChange(oldProduct, newBranchStock);
        if (!movementResult.valid) {
          window.showAdminToast(movementResult.message, 'danger');
          return;
        }
        if (movementResult.items.length > 0) {
          pendingMovementItems = pendingMovementItems.concat(movementResult.items);
          updateMovementGenerateButtonState();
        }
      }
    }

    // ── CHG-04：管理 rentalId / rentalEnabled ──────────────────────────────
    // rentalId = 背景預建的租借關聯；rentalEnabled = switch「是否為租借商品」
    // rentalId = pre-created link; rentalEnabled = switch "is rental product"
    if (storeEditId) {
      // 商店編輯模式：依 switch 決定是否啟用租借（背景資料保留在 cache）
      // Store EDIT: toggle rentalEnabled; linked rental data stays in cache
      var oldStoreProduct = findAdminProductById(storeEditId);
      if (isRental) {
        // switch ON：啟用租借，保留或新建對應的租借商品
        // Switch ON: enable rental; keep or create linked rental product
        var existingRentalId = oldStoreProduct ? oldStoreProduct.rentalId : null;
        var newRentalId = existingRentalId || 'R-NEW-' + Date.now();

        if (!rentalCampState.valid) {
          window.showAdminToast('請填寫自訂營地名稱', 'danger');
          return;
        }

        var storeLinkedRentalItem = {
          id: newRentalId,
          image: mainImageFile
            ? URL.createObjectURL(mainImageFile)
            : existingThumbnail || PRODUCT_IMAGE_PLACEHOLDER,
          name: name,
          category: category || '其他',
          camp: rentalCampState.camps,
        };

        // 若有舊資料，產生異動記錄
        var oldLinkedRental = existingRentalId ? findAdminRentalById(existingRentalId) : null;
        if (oldLinkedRental) {
          var linkedNextCampByKey = {};
          ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
            linkedNextCampByKey[id] = 0;
          });
          rentalCampState.camps.forEach(function (camp) {
            var cid = getCampIdByName(camp.name);
            if (cid) {
              linkedNextCampByKey[cid] = normalizeStockValue(camp.quantity);
            } else {
              linkedNextCampByKey[camp.name] = normalizeStockValue(camp.quantity);
            }
          });
          var linkedMovementResult = buildMovementItemsForRentalChange(oldLinkedRental, linkedNextCampByKey);
          if (linkedMovementResult.valid && linkedMovementResult.items.length > 0) {
            pendingRentalMovementItems = pendingRentalMovementItems.concat(linkedMovementResult.items);
            updateMovementGenerateButtonState();
          }
        }

        var savedLinkedRental = upsertAdminRentalCache(storeLinkedRentalItem);
        newProduct.rentalId = savedLinkedRental.id;
        newProduct.rentalEnabled = true;
      } else {
        // switch OFF：停用租借（保留 rentalId 與 cache，只從 UI 隱藏）
        // Switch OFF: disable rental; keep rentalId + cache, hide from rental tab
        newProduct.rentalId = oldStoreProduct ? oldStoreProduct.rentalId : null;
        newProduct.rentalEnabled = false;
      }
    } else {
      // 新增商品：背景預建租借資料（全 0），但預設不啟用
      // New product ADD: pre-create rental data (all zeros), rentalEnabled defaults to false
      var autoRentalId = 'R-NEW-' + Date.now();
      var autoRentalItem = upsertAdminRentalCache({
        id: autoRentalId,
        image: mainImageFile
          ? URL.createObjectURL(mainImageFile)
          : existingThumbnail || PRODUCT_IMAGE_PLACEHOLDER,
        name: name,
        category: category || '其他',
        camp: buildInitialRentalCamps(0),
      });
      newProduct.rentalId = autoRentalItem.id;
      newProduct.rentalEnabled = false;
    }

    upsertAdminProductCache(newProduct);

    if (storeEditId) {
      $('#productsTableBody tr[data-product-id="' + escapeSelector(storeEditId) + '"]').replaceWith(
        $(buildProductRow(newProduct)).hide().fadeIn(400)
      );
    } else {
      $('#productsTableBody').prepend($(buildProductRow(newProduct)).hide().fadeIn(400));
    }

    // 依 rentalEnabled 重新渲染租借 tab（未啟用的商品不顯示）
    // Re-render rental tab so only enabled rentals are visible
    if (adminRentalsLoaded) {
      renderRentalProductsTable(adminRentalsCache);
    }

    resetProductModalForm();

    var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('addProductModal'));
    modal.hide();

    window.showAdminToast('商品「' + name + '」已' + (editProductId ? '更新' : '新增'));
  });
};

/**
 * 依 isMinStockMode 狀態更新 UI：
 * - 切換按鈕文字、樣式（outline-warning ↔ warning 填色）
 * - 顯示 / 隱藏 #minStockModeHint 提示文字
 * - 表格 thead 加上 / 移除 min-stock-mode-header class（黃色背景）
 * - 整個 table 加上 / 移除 min-stock-mode class（步進器黃色按鈕樣式）
 *
 * Updates UI elements based on the current isMinStockMode state.
 */
function updateMinStockModeUI() {
  var $btn = $('#toggleMinStockMode');

  if (isMinStockMode) {
    // 進入設定模式
    $btn
      .removeClass('btn-outline-warning')
      .addClass('btn-warning')
      .html('<i class="fas fa-times me-1"></i>離開設定模式');

    $('#minStockModeHint').removeClass('d-none');

    // 表格 header 加黃色背景
    $('#productsTable thead, #rentalProductsTable thead').addClass('min-stock-mode-header');

    // 整個 table 加模式 class（步進器按鈕樣式）
    $('#productsTable, #rentalProductsTable').addClass('min-stock-mode');
  } else {
    // 離開設定模式
    $btn
      .removeClass('btn-warning')
      .addClass('btn-outline-warning')
      .html('<i class="fas fa-sliders-h me-1"></i>設定最低庫存');

    $('#minStockModeHint').addClass('d-none');

    $('#productsTable thead, #rentalProductsTable thead').removeClass('min-stock-mode-header');

    $('#productsTable, #rentalProductsTable').removeClass('min-stock-mode');
  }
}

/**
 * 儲存最低庫存設定：讀取該列所有分店 / 營地的步進器數值，
 * 寫入 adminMinStockCache，顯示 Toast，並重新計算該列紅色 / 橘色標示。
 * 不產生庫存異動紀錄（pendingMovementItems 不受影響）。
 *
 * Saves minimum stock values from the row inputs into adminMinStockCache.
 * Shows a Toast confirmation. Does NOT create any movement record.
 *
 * @param {jQuery} $row          - 目標 <tr>
 * @param {string} productId     - 商品 ID
 * @param {string} inventoryType - 'store' 或 'rental'
 */
function saveMinStockValues($row, productId, inventoryType) {
  if (!productId || !inventoryType) {
    return;
  }

  // 確保 adminMinStockCache 中有此 inventoryType 的命名空間
  if (!adminMinStockCache[inventoryType]) {
    adminMinStockCache[inventoryType] = {};
  }
  if (!adminMinStockCache[inventoryType][productId]) {
    adminMinStockCache[inventoryType][productId] = {};
  }

  // 讀取所有帶 data-min-stock-field 的步進器輸入值並寫入快取
  // Read all inputs with data-min-stock-field and write into cache
  $row.find('.stock-input[data-min-stock-field]').each(function () {
    var fieldId = $(this).data('min-stock-field');
    var val = normalizeStockValue($(this).val());
    adminMinStockCache[inventoryType][productId][fieldId] = val;

    // 更新 data-original-qty，讓步進器變動偵測知道「已確認」
    $(this).attr('data-original-qty', val).data('original-qty', val);
  });

  // 隱藏確定按鈕（已確認，無變動）
  $row.find('.min-stock-confirm-btn').prop('disabled', true).addClass('d-none');

  window.showAdminToast('商品 ' + productId + ' 最低庫存已儲存');
}

function bindProductViewTabs() {
  $(document).on('click.products', '.admin-product-tab', function () {
    switchProductView($(this).data('products-view'));
  });
}

function bindProductsFilters() {
  $(document).on('input.products', '#productsSearchInput', function () {
    productViewState.searchQuery = String($(this).val() || '').trim().toLowerCase();
    renderActiveProductView();
  });

  $(document).on('change.products', '#productsCategoryFilter', function () {
    productViewState.category = String($(this).val() || '').trim();
    renderActiveProductView();
  });

  $(document).on('change.products', '#productsStatusFilter', function () {
    productViewState.status = String($(this).val() || '').trim();
    renderActiveProductView();
  });

  $(document).on('change.products', '#productsStockFilter', function () {
    productViewState.stock = String($(this).val() || '').trim();
    renderActiveProductView();
  });

  $(document).on('change.products', '#productsSortSelect', function () {
    productViewState.sortBy = String($(this).val() || 'default').trim() || 'default';
    renderActiveProductView();
  });

  $(document).on('click.products', '#productsClearFilters', function () {
    productViewState.searchQuery = '';
    productViewState.category = '';
    productViewState.status = '';
    productViewState.stock = '';
    productViewState.sortBy = 'default';
    resetProductsFilterInputs();
    renderActiveProductView();
  });
}

function switchProductView(view) {
  var nextView = view === 'rental' ? 'rental' : 'store';
  productViewState.activeView = nextView;

  $('.admin-product-tab').removeClass('active').attr('aria-selected', 'false');

  $('.admin-product-tab[data-products-view="' + nextView + '"]')
    .addClass('active')
    .attr('aria-selected', 'true');

  $('.admin-products-panel').each(function () {
    var $panel = $(this);
    $panel.toggleClass('d-none', $panel.data('products-panel') !== nextView);
  });

  if (nextView === 'rental') {
    loadRentalProducts();
  } else {
    renderProductsTable(adminProductsCache);
  }
}

function loadRentalProducts() {
  if (adminRentalsLoaded) {
    renderRentalProductsTable(adminRentalsCache);
    return;
  }

  $('#rentalProductsTableBody').html(
    '<tr><td colspan="12" class="text-center py-4">' +
      '<div class="spinner-border spinner-border-sm me-2" style="color: var(--admin-brand-accent);"></div>' +
      '<span class="text-muted">載入租借商品中...</span>' +
      '</td></tr>'
  );

  $.getJSON('data/reantal.json', function (rentals) {
    var pendingItems = adminRentalsCache.slice();
    var rentalIdMap = {};

    adminRentalsCache = (rentals || []).map(normalizeRentalItem);
    adminRentalsCache.forEach(function (item) {
      rentalIdMap[item.id] = true;
    });

    pendingItems.forEach(function (item) {
      if (!rentalIdMap[item.id]) {
        adminRentalsCache.unshift(item);
      }
    });

    adminRentalsLoaded = true;
    renderRentalProductsTable(adminRentalsCache);
  }).fail(function () {
    $('#rentalProductsTableBody').html(
      '<tr><td colspan="12" class="text-center text-danger py-4">' +
        '<i class="fas fa-exclamation-triangle me-2"></i>載入租借商品數據失敗' +
        '</td></tr>'
    );
  });
}

// 將租借商品資料統一成 camp 陣列，庫存由各營地 quantity 加總取得。
// 同時產生 campByKey 物件（含 main + camp-001~005），方便表格按欄位讀取。
// Also builds campByKey {campId: quantity} including 'main', so the table can read each column easily.
function normalizeRentalItem(item) {
  var camps = normalizeRentalCamps(item && (item.camp || item.storageCamp), item && item.quantity);

  // 建立 campByKey：主倉 + 所有固定營地預設 0，再依 camp[] 寫入對應數量
  // Build campByKey: main + all fixed camps default to 0, then fill from camp[]
  var campByKey = {};
  ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
    campByKey[id] = 0;
  });

  camps.forEach(function (camp) {
    var campId = getCampIdByName(camp.name);

    if (campId) {
      // 固定營地（含主倉）：用 campId 寫入
      // Fixed camp (including main): write by campId
      campByKey[campId] = camp.quantity;
    } else {
      // 自訂營地：用完整名稱作為 key（保留自訂）
      campByKey[camp.name] = camp.quantity;
    }
  });

  return {
    id: item && item.id ? item.id : 'R-NEW-' + Date.now(),
    image: (item && (item.image || item.thumbnail)) || PRODUCT_IMAGE_PLACEHOLDER,
    name: (item && item.name) || '未命名租借商品',
    category: (item && item.category) || '其他',
    camp: camps,
    campByKey: campByKey,
  };
}

// 依租借商品 ID 從目前快取中取出資料。
function findAdminRentalById(rentalId) {
  return (adminRentalsCache || []).find(function (item) {
    return item.id === rentalId;
  });
}

// 新增或更新租借商品快取，保留與 reantal.json 相同的 camp 陣列格式。
function upsertAdminRentalCache(rentalItem) {
  var normalizedItem = normalizeRentalItem(rentalItem);
  var index = adminRentalsCache.findIndex(function (item) {
    return item.id === normalizedItem.id;
  });

  if (index >= 0) {
    adminRentalsCache[index] = normalizedItem;
  } else {
    adminRentalsCache.unshift(normalizedItem);
  }

  return normalizedItem;
}

// 租借列表的庫存確認：讀取所有營地（含主倉）的數值，自動計算 total，寫回快取並更新畫面。
// Rental stock confirm: read all camp values (including main), auto-compute total, update cache and UI.
function confirmRentalStockChange($row, rentalId, $button) {
  var rental = findAdminRentalById(rentalId);

  if (!rental) {
    window.showAdminToast('找不到租借商品 ' + rentalId + ' 的資料', 'danger');
    return;
  }

  // 讀取所有固定營地（含主倉）欄位值
  // Read all fixed camp values including main warehouse
  var nextCampByKey = {};

  ADMIN_RENTAL_CAMP_IDS.forEach(function (campId) {
    nextCampByKey[campId] = getRowStockValue($row, campId);
  });

  // 自訂營地（非固定 ID 的 stock-input）也收集進來
  // Also collect custom camp fields (non-fixed IDs)
  var fixedIdSet = {};
  ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
    fixedIdSet[id] = true;
  });

  $row.find('.stock-input').each(function () {
    var fieldName = String($(this).data('stock-field') || '');
    if (fieldName && !fixedIdSet[fieldName]) {
      nextCampByKey[fieldName] = getStockInputValue($(this));
    }
  });

  // V-001（租借表格列）：租借主倉不可為負數
  // V-001 (rental table row): Rental main warehouse stock must not be negative
  var rowRentalMainQty = normalizeStockValue(nextCampByKey[ADMIN_RENTAL_WAREHOUSE_ID]);
  if (rowRentalMainQty < 0) {
    window.showAdminToast('租借主倉數量不可為負數', 'danger');
    return;
  }

  // total 由各營地加總自動計算（不再驗證手動輸入的 rental-total）
  // total is always auto-computed from camp sum — validation check removed
  var totalStock = Object.keys(nextCampByKey).reduce(function (sum, key) {
    return sum + normalizeStockValue(nextCampByKey[key]);
  }, 0);

  confirmRentalStockChangeWithReason($row, rental, rentalId, nextCampByKey, totalStock);
}

/**
 * 租借表格列確認庫存異動的核心邏輯（從 confirmRentalStockChange 拆出）。
 * Core logic for confirming rental stock changes from the table row.
 *
 * @param {jQuery} $row           - 目標 <tr>
 * @param {Object} rental         - 租借商品物件
 * @param {string} rentalId       - 租借商品 ID
 * @param {Object} nextCampByKey  - { campId: qty }
 * @param {number} totalStock     - 新總庫存
 */
function confirmRentalStockChangeWithReason($row, rental, rentalId, nextCampByKey, totalStock) {
  // 先產生異動 items（需在寫回快取前，才能比對舊數量）
  // Must build movement items before updating rental.campByKey (needs old values for comparison)
  var movementResult = buildMovementItemsForRentalChange(rental, nextCampByKey);
  if (!movementResult.valid) {
    window.showAdminToast(movementResult.message, 'danger');
    return;
  }

  // 寫回快取的 campByKey 與 camp 陣列
  rental.campByKey = nextCampByKey;
  rental.camp = buildCampArrayFromKey(nextCampByKey);

  // 更新唯讀 total 欄位的靜態顯示數字
  // Refresh the read-only rental-total display cell
  $row.find('.total-stock-value').text(totalStock);
  $row.toggleClass('table-danger', isRentalProductLowStock(rental));
  refreshRowLowStockCells($row, getLowCampKeys(rental));
  setRowOriginalStockValues($row);
  syncStockConfirmState($row);

  // 將異動明細推入租借待處理佇列，並同步按鈕啟用狀態
  // Push movement items to rental pending queue and refresh button state
  if (movementResult.items.length > 0) {
    pendingRentalMovementItems = pendingRentalMovementItems.concat(movementResult.items);
    updateMovementGenerateButtonState();
  }

  window.showAdminToast('租借商品 ' + rentalId + ' 數量已更新');
  exitStockEditMode($row, false);
}

// 依 campByKey 物件重建 camp 陣列（寫回 reantal.json 格式用）。
// Rebuilds camp[] from campByKey for persistence.
function buildCampArrayFromKey(campByKey) {
  var fixedIdSet = {};
  ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
    fixedIdSet[id] = true;
  });

  var result = [];

  // 先放固定營地（按固定順序）
  ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
    if (campByKey[id] !== undefined) {
      result.push({
        name: ADMIN_RENTAL_CAMP_FULL_NAMES[id],
        quantity: normalizeStockValue(campByKey[id]),
      });
    }
  });

  // 再放自訂營地
  Object.keys(campByKey).forEach(function (key) {
    if (!fixedIdSet[key]) {
      result.push({
        name: key,
        quantity: normalizeStockValue(campByKey[key]),
      });
    }
  });

  return result;
}

// 切換租借模式時，顯示固定營地清單，並讓初始庫存改由營地數量加總決定。
// Show/hide rental camp section and toggle readonly on stock input.
//
// @param {boolean} isRental     - 是否切換為租借狀態
// @param {boolean} isEditMode   - true = 租借編輯，false/undefined = 租借新增
// @param {boolean} isStoreEdit  - true = 商店編輯模式（不修改售價 required / 庫存 readonly）
function syncRentalFormState(isRental, isEditMode, isStoreEdit) {
  $('#rentalCampField').toggleClass('d-none', !isRental);

  // 商店編輯模式下不修改售價的 required 與庫存 readonly（售價仍為必填）
  // In store-edit mode, do NOT change price required or stock readonly
  if (!isStoreEdit) {
    $('#newProductPrice').prop('required', !isRental);
    $('#newProductStock').prop('readonly', isRental).toggleClass('bg-light', isRental);
  }

  if (isRental) {
    if (isEditMode) {
      // 編輯模式：顯示營地分配區，隱藏主倉進貨欄
      $('#rentalAddModeSection').addClass('d-none');
      $('#rentalEditModeSection').removeClass('d-none');
      updateRentalStockFromCampFields();
    } else {
      // 新增模式：顯示主倉進貨欄，隱藏營地分配區
      $('#rentalAddModeSection').removeClass('d-none');
      $('#rentalEditModeSection').addClass('d-none');
    }
  } else {
    // 非租借：兩區都隱藏（由 rentalCampField d-none 覆蓋）
    $('#rentalAddModeSection').addClass('d-none');
    $('#rentalEditModeSection').addClass('d-none');
  }
}

// 產生一列「自訂營地」輸入列，附加到 #rentalCampList。
// Appends a custom camp input row (name + quantity + remove button) to #rentalCampList.
function appendRentalCampField(campName, quantity) {
  var $row = $('<div>', { class: 'input-group input-group-sm rental-camp-row' });
  var $label = $('<span>', { class: 'input-group-text' }).text('自訂');
  var $nameInput = $('<input>', {
    type: 'text',
    class: 'form-control rental-camp-name-input',
    placeholder: '例：山頂日出營地',
  }).val(campName || '');
  var $quantityInput = $('<input>', {
    type: 'number',
    class: 'form-control rental-camp-quantity-input',
    min: '0',
    value: normalizeStockValue(quantity),
    'aria-label': '自訂營地存放數量',
  });
  var $removeButton = $('<button>', {
    type: 'button',
    class: 'btn btn-outline-danger remove-rental-camp-btn',
    title: '移除自訂營地',
  }).html('<i class="fas fa-times"></i>');

  $row.append($label, $nameInput, $quantityInput, $removeButton);
  $('#rentalCampList').append($row);
  return $row;
}

// 將既有 camp 陣列回填到 Modal：所有固定營地直接填入數量，主倉填入固定列，自訂營地動態新增列。
// Populates the modal from camp[]: fills all preset camp inputs directly; main warehouse fills fixed row; custom camps get dynamic rows.
function populateRentalCampFields(camps) {
  var normalizedCamps = normalizeRentalCamps(camps);

  // 重置固定營地（camp-001~005）：全部數量清零（已無 checkbox，input 始終可編輯）
  // Reset preset camps: zero all quantities (no checkboxes; inputs always enabled)
  $('#rentalCampPresetList .rental-camp-preset-row').each(function () {
    $(this).find('.rental-camp-quantity-input').val(0);
  });

  // 清空自訂營地列
  $('#rentalCampList').empty();

  // 主倉固定列：先歸零
  $('#rentalEditMainQty').val(0);

  normalizedCamps.forEach(function (camp) {
    var campId = getCampIdByName(camp.name);

    if (campId === ADMIN_RENTAL_WAREHOUSE_ID) {
      // 租借主倉：填入固定列 #rentalEditMainQty
      // Rental main warehouse: fill into the fixed row
      $('#rentalEditMainQty').val(normalizeStockValue(camp.quantity));
    } else if (campId) {
      // 固定營地（camp-001~005）：直接填入數量
      // Fixed camp (camp-001~005): fill quantity directly
      var $presetRow = $('#rentalCampPresetList .rental-camp-preset-row[data-camp-id="' + campId + '"]');
      $presetRow.find('.rental-camp-quantity-input').val(normalizeStockValue(camp.quantity));
    } else {
      // 自訂營地：動態新增列
      // Custom camp: append a dynamic row
      appendRentalCampField(camp.name, camp.quantity);
    }
  });

  updateRentalStockFromCampFields();
}

/**
 * 從 #editBranchPresetList 收集各分店庫存值，組成 { branchId: qty } 物件。
 * 未勾選的分店視為 0（使用者已歸零後才能取消勾選）。
 *
 * Reads each branch row from #editBranchPresetList and builds a branch stock object.
 * Unchecked branches are treated as 0 (user must zero before unchecking).
 * @returns {Object} { 'main': 0, 'branch-001': 5, ... }
 */
function collectEditBranchStockFields() {
  var branchStock = {};

  ADMIN_PRODUCT_BRANCH_IDS.forEach(function (branchId) {
    branchStock[branchId] = 0;
  });

  // 直接讀取每列的數量（無 checkbox，數量為 0 代表該分店庫存 0 件）
  // Read each row's quantity directly (no checkbox; 0 means that branch has 0 stock)
  $('#editBranchPresetList .edit-branch-row').each(function () {
    var $row = $(this);
    var branchId = $row.data('branch-id');
    branchStock[branchId] = normalizeStockValue($row.find('.edit-branch-quantity-input').val());
  });

  return branchStock;
}

// 收集 Modal 內的所有營地資料（主倉固定列 + 固定勾選 + 自訂列）。
// Collects all camp data: main warehouse fixed row + checked presets + custom rows.
function collectRentalCampFields() {
  var camps = [];
  var hasInvalidCamp = false;

  // 租借主倉固定列（編輯模式才會顯示）：永遠加入
  // Rental main warehouse fixed row (visible in edit mode only): always include
  var $mainRow = $('#rentalEditMainRow');
  if ($mainRow.length && !$mainRow.closest('.d-none').length) {
    var mainQty = normalizeStockValue($('#rentalEditMainQty').val());
    camps.push({
      name: ADMIN_RENTAL_CAMP_FULL_NAMES[ADMIN_RENTAL_WAREHOUSE_ID] || '租借主倉',
      quantity: mainQty,
    });
  }

  // 收集固定營地（無 checkbox，全部收集，數量為 0 代表庫存 0 件）
  // Collect all preset camps (no checkbox; quantity 0 means 0 stock at that camp)
  $('#rentalCampPresetList .rental-camp-preset-row').each(function () {
    var $row = $(this);
    var campId = $row.data('camp-id');
    var name = ADMIN_RENTAL_CAMP_FULL_NAMES[campId] || campId;
    var quantity = normalizeStockValue($row.find('.rental-camp-quantity-input').val());

    camps.push({ name: name, quantity: quantity });
  });

  // 收集自訂營地（名稱不能為空）
  // Collect custom camp rows (name must not be empty)
  $('#rentalCampList .rental-camp-row').each(function () {
    var $row = $(this);
    var $nameInput = $row.find('.rental-camp-name-input');
    var name = $nameInput.val().trim();
    var quantity = normalizeStockValue($row.find('.rental-camp-quantity-input').val());

    $nameInput.toggleClass('is-invalid', !name);

    if (!name) {
      hasInvalidCamp = true;
      return;
    }

    camps.push({ name: name, quantity: quantity });
  });

  // 移除「至少勾選 1 個營地」的限制：只要沒有無效自訂營地即視為有效
  // Removed the "at least 1 checked camp" requirement; valid as long as no invalid custom camps
  return {
    valid: !hasInvalidCamp,
    camps: camps,
  };
}

// 加總所有「主倉固定列」+「已勾選固定營地」+「自訂營地」數量，回填唯讀庫存欄位。
// Sums main warehouse fixed row + checked preset camps + custom camps and updates the readonly stock field.
function updateRentalStockFromCampFields() {
  var total = 0;

  // 主倉固定列（編輯模式才存在）
  // Main warehouse fixed row (edit mode only)
  var $mainRow = $('#rentalEditMainRow');
  if ($mainRow.length && !$mainRow.closest('.d-none').length) {
    total += normalizeStockValue($('#rentalEditMainQty').val());
  }

  // 固定營地：全部加總（無 checkbox，所有列都計入）
  // Preset camps: sum all rows (no checkbox; all rows included)
  $('#rentalCampPresetList .rental-camp-preset-row').each(function () {
    total += normalizeStockValue($(this).find('.rental-camp-quantity-input').val());
  });

  // 自訂營地：全部加總
  // Custom camps: always sum
  $('#rentalCampList .rental-camp-row .rental-camp-quantity-input').each(function () {
    total += normalizeStockValue($(this).val());
  });

  $('#newProductStock').val(total);
}

// 統一設定新增 / 編輯商品 Modal 的標題與送出按鈕文字。
function setProductModalMode(mode) {
  var isEdit = mode === 'edit';
  var iconClass = isEdit ? 'fa-pen' : 'fa-plus';

  $('#addProductModalLabel').html(
    '<i class="fas ' + iconClass + ' me-2"></i>' + (isEdit ? '編輯商品' : '新增商品')
  );
  $('#submitAddProduct').html(
    '<i class="fas ' + iconClass + ' me-1"></i>' + (isEdit ? '更新商品' : '建立商品')
  );
}

function normalizeProductBranch(product) {
  if (!product) {
    return product;
  }

  if (!product.branch || typeof product.branch !== 'object') {
    // 全新商品或無分店資料：依總庫存平均分配到實體分店，主倉設為 0
    // Brand new product or missing branch data: spread across physical branches, main = 0
    var totalForSplit = getProductTotalStock(product);
    product.branch = splitBranchStock(totalForSplit);
  } else {
    // 確保所有分店（含主倉）都有合法的數字，舊資料補 main: 0
    // Ensure every branch (including main) has a valid number; backfill main: 0 for old data
    ADMIN_PRODUCT_BRANCH_IDS.forEach(function (branchId) {
      product.branch[branchId] = normalizeStockValue(product.branch[branchId]);
    });
  }

  // total-stock 永遠由所有分店（含主倉）加總自動計算，不以原始 JSON 值為準
  // total-stock is always auto-computed from all branches including main
  product['total-stock'] = getBranchTotal(product.branch);
  delete product.stock;
  return product;
}

/**
 * 商店表格列確認庫存異動的核心邏輯，從 .stock-confirm-btn handler 拆出。
 * Core logic for confirming store stock changes from the table row.
 *
 * @param {jQuery} $row        - 目標 <tr>
 * @param {Object} product     - 商店商品物件
 * @param {Object} branchStock - { branchId: qty } 新分店庫存
 * @param {number} totalStock  - 新總庫存
 */
function confirmStoreStockChange($row, product, branchStock, totalStock) {
  var movementResult = buildMovementItemsForBranchChange(product, branchStock);
  if (!movementResult.valid) {
    window.showAdminToast(movementResult.message, 'danger');
    return;
  }

  product['total-stock'] = totalStock;
  product.branch = branchStock;
  delete product.stock;

  $row.find('.total-stock-value').text(totalStock);
  $row.toggleClass('table-danger', isStoreProductLowStock(product));
  refreshRowLowStockCells($row, getLowBranchIds(product));
  setRowOriginalStockValues($row);
  syncStockConfirmState($row);

  if (movementResult.items.length > 0) {
    pendingMovementItems = pendingMovementItems.concat(movementResult.items);
    updateMovementGenerateButtonState();
  }

  window.showAdminToast('商品 ' + product.id + ' 庫存數量已更新');
  exitStockEditMode($row, false);
}

function splitBranchStock(totalStock) {
  // 商店主倉設為 0，只將庫存平均分配給實體分店（不含 main）
  // Store main warehouse starts at 0; only distribute among physical branches (excluding main)
  var total = Math.max(parseInt(totalStock, 10) || 0, 0);
  var physicalBranches = ADMIN_PRODUCT_BRANCH_IDS.filter(function (id) {
    return id !== ADMIN_STORE_WAREHOUSE_ID;
  });
  var baseQty = Math.floor(total / physicalBranches.length);
  var remainder = total % physicalBranches.length;
  var branchStock = {};

  branchStock[ADMIN_STORE_WAREHOUSE_ID] = 0;
  physicalBranches.forEach(function (branchId, index) {
    branchStock[branchId] = baseQty + (index < remainder ? 1 : 0);
  });

  return branchStock;
}

/**
 * 新增商品時建立初始分店庫存物件。
 * 進貨全部進主倉，實體分店（A/B/C）初始為 0。
 *
 * When adding a new product, put all initial stock in the main warehouse;
 * physical branches start at zero.
 *
 * @param {number} warehouseQty - 主倉進貨量
 * @returns {Object} { main: qty, 'branch-001': 0, 'branch-002': 0, 'branch-003': 0 }
 */
function createInitialBranchStock(warehouseQty) {
  var qty = Math.max(normalizeStockValue(warehouseQty), 0);
  var result = {};
  result[ADMIN_STORE_WAREHOUSE_ID] = qty;
  ADMIN_PRODUCT_BRANCH_IDS.forEach(function (id) {
    if (id !== ADMIN_STORE_WAREHOUSE_ID) {
      result[id] = 0;
    }
  });
  return result;
}

/**
 * 新增租借商品時建立初始 camp 陣列。
 * 進貨全部進主倉，所有固定營地初始庫存為 0。
 *
 * When adding a new rental product, put all initial stock in the main camp;
 * all other camps start at zero.
 *
 * @param {number} warehouseQty - 主倉進貨量
 * @returns {Array<{name: string, quantity: number}>}
 */
function buildInitialRentalCamps(warehouseQty) {
  var qty = Math.max(normalizeStockValue(warehouseQty), 0);
  // 使用 ADMIN_RENTAL_CAMP_FULL_NAMES 取得完整名稱（對應 reantal.json 的 camp[].name）
  // Use full camp names to match reantal.json camp[].name format
  return ADMIN_RENTAL_CAMP_IDS.map(function (id) {
    var campName = ADMIN_RENTAL_CAMP_FULL_NAMES[id] || id;
    return {
      name: campName,
      quantity: id === ADMIN_RENTAL_WAREHOUSE_ID ? qty : 0,
    };
  });
}

function getProductTotalStock(product) {
  var totalStock = parseInt(product && product['total-stock'], 10);
  if (!isNaN(totalStock)) {
    return Math.max(totalStock, 0);
  }

  if (product && product.branch && typeof product.branch === 'object') {
    return getBranchTotal(product.branch);
  }

  var stock = parseInt(product && product.stock, 10);
  return isNaN(stock) ? 0 : Math.max(stock, 0);
}

function getProductBranchStock(product, branchId) {
  if (!product || !product.branch || typeof product.branch !== 'object') {
    return 0;
  }

  return normalizeStockValue(product.branch[branchId]);
}

function normalizeStockValue(value) {
  var qty = parseInt(value, 10);
  return isNaN(qty) ? 0 : Math.max(qty, 0);
}

// 依租借地點完整名稱反查固定 camp ID；找不到時回傳 null（代表自訂營地）。
// 「租借主倉」直接對應 ADMIN_RENTAL_WAREHOUSE_ID ('rental-main')。
// Returns the fixed rental location ID for a given full name, or null if custom.
// "租借主倉" always maps to ADMIN_RENTAL_WAREHOUSE_ID ('rental-main').
function getCampIdByName(name) {
  var trimmed = String(name || '').trim();

  // 租借主倉特判：名稱完全等於 ADMIN_RENTAL_WAREHOUSE_LABEL 就回傳 'rental-main'
  // Special case: match rental main warehouse label directly
  if (trimmed === ADMIN_RENTAL_WAREHOUSE_LABEL) {
    return ADMIN_RENTAL_WAREHOUSE_ID;
  }

  var found = null;

  Object.keys(ADMIN_RENTAL_CAMP_FULL_NAMES).forEach(function (id) {
    if (ADMIN_RENTAL_CAMP_FULL_NAMES[id] === trimmed) {
      found = id;
    }
  });

  // 同時嘗試比對簡稱（例如 campByKey 存的是簡稱）
  // Also try short labels
  if (!found) {
    Object.keys(ADMIN_RENTAL_CAMP_LABELS).forEach(function (id) {
      if (ADMIN_RENTAL_CAMP_LABELS[id] === trimmed) {
        found = id;
      }
    });
  }

  return found;
}

// 正規化租借商品的 camp 欄位，支援新版陣列與舊版單一字串。
function normalizeRentalCamps(campValue, legacyQuantity) {
  var camps = [];

  if (Array.isArray(campValue)) {
    camps = campValue.map(function (camp) {
      if (typeof camp === 'string') {
        return { name: camp.trim(), quantity: 0 };
      }

      return {
        name: (camp && (camp.name || camp.camp || camp.title)) || '',
        quantity: normalizeStockValue(
          camp && camp.quantity !== undefined ? camp.quantity : camp && camp.stock
        ),
      };
    });
  } else if (campValue && typeof campValue === 'object') {
    if (campValue.name || campValue.camp || campValue.title) {
      camps = [
        {
          name: campValue.name || campValue.camp || campValue.title,
          quantity: normalizeStockValue(
            campValue.quantity !== undefined ? campValue.quantity : campValue.stock
          ),
        },
      ];
    } else {
      camps = Object.keys(campValue).map(function (name) {
        return {
          name: name,
          quantity: normalizeStockValue(campValue[name]),
        };
      });
    }
  } else if (typeof campValue === 'string' && campValue.trim()) {
    camps = [
      {
        name: campValue.trim(),
        quantity: normalizeStockValue(legacyQuantity),
      },
    ];
  }

  return camps
    .filter(function (camp) {
      return camp.name;
    })
    .map(function (camp) {
      return {
        name: String(camp.name).trim(),
        quantity: normalizeStockValue(camp.quantity),
      };
    });
}

// 計算租借商品所有營地的庫存總量。
function getRentalCampTotal(camps) {
  return (camps || []).reduce(function (sum, camp) {
    return sum + normalizeStockValue(camp && camp.quantity);
  }, 0);
}

// 從租借商品物件計算列表要顯示的庫存總量。
function getRentalTotalStock(rental) {
  return getRentalCampTotal(normalizeRentalCamps(rental && rental.camp, rental && rental.quantity));
}

// 快速調整租借總量時，將差額寫回既有營地數量。
function setRentalCampTotal(camps, nextTotal) {
  var targetTotal = normalizeStockValue(nextTotal);
  var normalizedCamps = normalizeRentalCamps(camps);

  if (normalizedCamps.length === 0) {
    return [{ name: '未指定營地', quantity: targetTotal }];
  }

  var currentTotal = getRentalCampTotal(normalizedCamps);
  var delta = targetTotal - currentTotal;

  if (delta > 0) {
    normalizedCamps[0].quantity += delta;
  } else if (delta < 0) {
    var remaining = Math.abs(delta);
    for (var index = normalizedCamps.length - 1; index >= 0 && remaining > 0; index -= 1) {
      var reducibleQty = Math.min(normalizedCamps[index].quantity, remaining);
      normalizedCamps[index].quantity -= reducibleQty;
      remaining -= reducibleQty;
    }
  }

  return normalizedCamps;
}

function getBranchTotal(branchStock) {
  // 加總所有分店（含主倉 main）的庫存
  // Sum all branches including the main warehouse
  return ADMIN_PRODUCT_BRANCH_IDS.reduce(function (sum, branchId) {
    return sum + normalizeStockValue(branchStock && branchStock[branchId]);
  }, 0);
}

function getBranchLabel(branchId) {
  return ADMIN_PRODUCT_BRANCH_LABELS[branchId] || branchId;
}

function buildMovementItemsForBranchChange(product, nextBranchStock) {
  var sources = [];
  var receivers = [];
  var items = [];

  ADMIN_PRODUCT_BRANCH_IDS.forEach(function (branchId) {
    var previousQty = getProductBranchStock(product, branchId);
    var nextQty = normalizeStockValue(nextBranchStock && nextBranchStock[branchId]);
    var delta = nextQty - previousQty;

    if (delta < 0) {
      sources.push({
        branchId: branchId,
        storeName: getBranchLabel(branchId),
        quantity: Math.abs(delta),
      });
    } else if (delta > 0) {
      receivers.push({
        branchId: branchId,
        storeName: getBranchLabel(branchId),
        quantity: delta,
      });
    }
  });

  // 全部只有減少（含主倉）且無任何增加 → V-004 報廢場景，本系統擋住，需管理員處理
  // All locations decreased and none increased → V-004 disposal, must be handled by admin
  if (sources.length > 0 && receivers.length === 0) {
    return {
      valid: false,
      message: '所有倉庫庫存全部為減少，如需報廢請聯繫系統管理員',
      items: [],
    };
  }

  if (sources.length === 0 && receivers.length === 0) {
    return { valid: true, message: '', items: [] };
  }

  if (sources.length === 0) {
    // 只有增加（來自進貨）→ type = '進貨'
    // Only increases → procurement, type = '進貨'
    receivers.forEach(function (receiver) {
      items.push({
        productName: product.name,
        quantity: receiver.quantity,
        fromStore: '進貨',
        toStore: receiver.storeName,
        type: '進貨',
      });
    });
    return { valid: true, message: '', items: items };
  }

  // 有增有減：配對 source → receiver，type = '移轉'（商店內部調配）
  // Has both increases and decreases: pair sources to receivers, type = '移轉' (internal reallocation)
  var sourceIndex = 0;
  receivers.forEach(function (receiver) {
    var remainingReceiverQty = receiver.quantity;

    while (remainingReceiverQty > 0 && sourceIndex < sources.length) {
      var source = sources[sourceIndex];
      var moveQty = Math.min(source.quantity, remainingReceiverQty);

      items.push({
        productName: product.name,
        quantity: moveQty,
        fromStore: source.storeName,
        toStore: receiver.storeName,
        type: '移轉',
      });

      source.quantity -= moveQty;
      remainingReceiverQty -= moveQty;
      if (source.quantity === 0) {
        sourceIndex += 1;
      }
    }

    if (remainingReceiverQty > 0) {
      // 來源不足 → 補充進貨
      // Insufficient source → supplement from procurement
      items.push({
        productName: product.name,
        quantity: remainingReceiverQty,
        fromStore: '進貨',
        toStore: receiver.storeName,
        type: '進貨',
      });
    }
  });

  // 剩餘 source 未被 receiver 吸收 → 損耗
  // Remaining source not absorbed by receiver → loss
  while (sourceIndex < sources.length) {
    var s = sources[sourceIndex];
    if (s.quantity > 0) {
      items.push({
        productName: product.name,
        quantity: s.quantity,
        fromStore: s.storeName,
        toStore: '—',
        type: '損耗',
      });
    }
    sourceIndex += 1;
  }

  return { valid: true, message: '', items: items };
}

/**
 * 比對租借商品各營地的舊數量（rental.campByKey）與新數量（nextCampByKey），
 * 產生庫存異動 items 陣列，格式與商店異動相同。
 *
 * Compare old camp quantities (rental.campByKey) with new (nextCampByKey),
 * return movement items with campName as fromStore/toStore.
 *
 * @param {Object} rental       - 租借商品物件（含 campByKey 舊值）
 * @param {Object} nextCampByKey - 確認後的新數量 { 'camp-001': 5, ... }
 * @returns {{ valid: boolean, message: string, items: Array }}
 */
function buildMovementItemsForRentalChange(rental, nextCampByKey) {
  var sources = [];
  var receivers = [];
  var items = [];

  // 收集所有需比對的 key（舊的聯集新的，確保自訂營地也被涵蓋）
  var allKeys = {};
  Object.keys(rental.campByKey || {}).forEach(function (k) {
    allKeys[k] = true;
  });
  Object.keys(nextCampByKey || {}).forEach(function (k) {
    allKeys[k] = true;
  });

  Object.keys(allKeys).forEach(function (key) {
    var previousQty = normalizeStockValue((rental.campByKey || {})[key]);
    var nextQty = normalizeStockValue((nextCampByKey || {})[key]);
    var delta = nextQty - previousQty;

    // 將 camp ID 轉換為顯示名稱（固定 ID 用 LABELS，自訂用 key 本身）
    var campLabel = ADMIN_RENTAL_CAMP_LABELS[key] || key;

    if (delta < 0) {
      sources.push({ campKey: key, campLabel: campLabel, quantity: Math.abs(delta) });
    } else if (delta > 0) {
      receivers.push({ campKey: key, campLabel: campLabel, quantity: delta });
    }
  });

  // 全部只有減少（含主倉）→ 報廢場景，本系統不支援
  // All camps (including main) decreased → disposal scenario, not supported
  if (sources.length > 0 && receivers.length === 0) {
    return {
      valid: false,
      message: '所有營地庫存全部為減少，如需報廢請聯繫系統管理員',
      items: [],
    };
  }

  // 沒有任何變動
  if (sources.length === 0 && receivers.length === 0) {
    return { valid: true, message: '', items: [] };
  }

  // 只有增加 → 全部標記為「進貨」
  // Only increases → mark all as '進貨'
  if (sources.length === 0) {
    receivers.forEach(function (receiver) {
      items.push({
        productName: rental.name,
        quantity: receiver.quantity,
        fromStore: '進貨',
        toStore: receiver.campLabel,
        type: '進貨',
      });
    });
    return { valid: true, message: '', items: items };
  }

  // 有增有減 → 配對配送（租借內部移轉，type = '移轉'）
  // Has both increases and decreases → internal rental reallocation, type = '移轉'
  var sourceIndex = 0;
  receivers.forEach(function (receiver) {
    var remaining = receiver.quantity;

    while (remaining > 0 && sourceIndex < sources.length) {
      var source = sources[sourceIndex];
      var moveQty = Math.min(source.quantity, remaining);

      items.push({
        productName: rental.name,
        quantity: moveQty,
        fromStore: source.campLabel,
        toStore: receiver.campLabel,
        type: '移轉',
      });

      source.quantity -= moveQty;
      remaining -= moveQty;
      if (source.quantity === 0) {
        sourceIndex += 1;
      }
    }

    if (remaining > 0) {
      // 補充進貨
      items.push({
        productName: rental.name,
        quantity: remaining,
        fromStore: '進貨',
        toStore: receiver.campLabel,
        type: '進貨',
      });
    }
  });

  // 剩餘 source 未被 receiver 吸收 → 損耗
  // Remaining source not absorbed → loss
  while (sourceIndex < sources.length) {
    var s = sources[sourceIndex];
    if (s.quantity > 0) {
      items.push({
        productName: rental.name,
        quantity: s.quantity,
        fromStore: s.campLabel,
        toStore: '—',
        type: '損耗',
      });
    }
    sourceIndex += 1;
  }

  return { valid: true, message: '', items: items };
}

function getStockInputValue($input) {
  return normalizeStockValue($input.val());
}

function getRowStockValue($row, fieldName) {
  return getStockInputValue($row.find('.stock-input[data-stock-field="' + fieldName + '"]'));
}

// 檢查同一列庫存欄位是否異動，並同步確定按鈕狀態。
// 依 isMinStockMode 控制不同的確定按鈕：
// - 正常模式：編輯中才啟用 .stock-confirm-btn（勾選 icon）
// - 最低庫存模式：.min-stock-confirm-btn（黃色，儲存最低庫存）
function syncStockConfirmState($row) {
  var hasChanged = $row
    .find('.stock-input')
    .toArray()
    .some(function (input) {
      var $input = $(input);
      var originalQty = normalizeStockValue($input.attr('data-original-qty'));
      return getStockInputValue($input) !== originalQty;
    });

  if (isMinStockMode) {
    $row.find('.min-stock-confirm-btn').prop('disabled', !hasChanged).toggleClass('d-none', !hasChanged);
    return;
  }

  if (!$row.hasClass('stock-row-editing')) {
    return;
  }

  syncStockInputFeedback($row);
  $row.find('.stock-confirm-btn').prop('disabled', !hasChanged);
}

/**
 * 將 inline input 的數值同步到瀏覽模式的 span 顯示。
 * Sync inline input values to read-only display spans.
 */
function syncStockDisplayFromInputs($row) {
  $row.find('.stock-input-inline').each(function () {
    var $input = $(this);
    var field = $input.data('stock-field');
    var qty = getStockInputValue($input);
    $row.find('.stock-display-value[data-stock-field="' + field + '"]').text(qty);
  });
}

/**
 * 進入整列庫存編輯模式（同時只允許一列）。
 * Enter stock edit mode for the entire row (only one row at a time).
 */
function enterStockEditMode($row) {
  $('tr.stock-row-editing')
    .not($row)
    .each(function () {
      exitStockEditMode($(this), true);
    });

  $row.addClass('stock-row-editing');
  $row.find('.stock-display-value').addClass('d-none');
  $row.find('.stock-input-inline').removeClass('d-none');
  $row.find('.stock-edit-btn').addClass('d-none');
  $row.find('.stock-edit-actions').removeClass('d-none');
  syncStockConfirmState($row);
}

/**
 * 離開整列庫存編輯模式。
 * Exit stock edit mode for the row.
 * @param {jQuery}  $row
 * @param {boolean} revert - true：還原 data-original-qty
 */
function exitStockEditMode($row, revert) {
  if (revert) {
    $row.find('.stock-input-inline').each(function () {
      var original = normalizeStockValue($(this).attr('data-original-qty'));
      $(this).val(original);
    });
    syncStockInputFeedback($row);
  }

  syncStockDisplayFromInputs($row);

  $row.removeClass('stock-row-editing');
  $row.find('.stock-display-value').removeClass('d-none');
  $row.find('.stock-input-inline').addClass('d-none');
  $row.find('.stock-edit-btn').removeClass('d-none');
  $row.find('.stock-edit-actions').addClass('d-none');
  $row.find('.stock-confirm-btn').prop('disabled', true);
}

// 確認庫存後，將目前欄位值寫回原始值，作為下一次異動比較基準。
function setRowOriginalStockValues($row) {
  $row.find('.stock-input').each(function () {
    var $input = $(this);
    var qty = getStockInputValue($input);

    $input.val(qty).attr('data-original-qty', qty).data('original-qty', qty);
  });

  syncStockInputFeedback($row);
  syncStockDisplayFromInputs($row);
}

// 依變更方向標示庫存欄位顏色。
// total-stock / rental-total 已改為靜態顯示，不再是 stock-input，無需處理。
// Colors stock inputs based on change direction.
// total-stock / rental-total are now static displays (not stock-inputs), so skip them.
function syncStockInputFeedback($row) {
  $row.find('.stock-input').each(function () {
    var $input = $(this);
    var currentQty = getStockInputValue($input);
    var originalQty = normalizeStockValue($input.attr('data-original-qty'));

    $input.removeClass('stock-input-increase stock-input-decrease');

    // 所有可編輯的分店/主倉/營地欄位：直接與原始值比較
    // All editable branch / main / camp fields: compare directly to original value
    if (currentQty > originalQty) {
      $input.addClass('stock-input-increase');
    } else if (currentQty < originalQty) {
      $input.addClass('stock-input-decrease');
    }
  });
}

// 商店或租借任一有待處理異動，就啟用「產生異動紀錄」按鈕。
// Enable the button if either store or rental pending queue has items.
function updateMovementGenerateButtonState() {
  var hasItems = pendingMovementItems.length > 0 || pendingRentalMovementItems.length > 0;
  $('#generateMovementRecord').prop('disabled', !hasItems);
}

// 取得目前登入員工 ID，寫入新建立的庫存異動紀錄。
function getCurrentAdminId() {
  return sessionStorage.getItem('adminId') || '—';
}

function createMovementRecordId() {
  var existingRecords = [];

  if (Array.isArray(window.movementCache)) {
    existingRecords = existingRecords.concat(window.movementCache);
  }

  if (Array.isArray(window.generatedMovementRecords)) {
    existingRecords = existingRecords.concat(window.generatedMovementRecords);
  }

  var maxNumber = existingRecords.reduce(function (max, record) {
    var match = String((record && record.id) || '').match(/MV(\d+)/);
    var num = match ? parseInt(match[1], 10) : 0;
    return Math.max(max, isNaN(num) ? 0 : num);
  }, 20);

  return 'MV' + String(maxNumber + 1).padStart(3, '0');
}

function formatMovementDate(date) {
  var pad = function (num) {
    return String(num).padStart(2, '0');
  };

  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  );
}

/**
 * 建立商店商品的單個庫存 <td>。
 * 正常模式：顯示實際庫存，不足格加橘色 class 與 tooltip。
 * 最低庫存模式：顯示最低庫存設定值，無橘色標示，確定按鈕走 saveMinStockValues 流程。
 *
 * Builds a single store product stock <td>.
 * Normal mode: actual stock, low cells get orange class + tooltip.
 * Min-stock mode: show the minimum threshold value, no orange highlighting.
 *
 * @param {Object}   product      - 商店商品物件
 * @param {string}   branchId     - 分店 ID
 * @param {string}   label        - 分店顯示名稱
 * @param {string[]} lowBranchIds - 庫存不足的分店 ID 陣列
 * @returns {string} <td> HTML 字串
 */
function buildStoreStockCell(product, branchId, label, lowBranchIds) {
  var isLowCell = lowBranchIds.indexOf(branchId) !== -1;

  if (isMinStockMode) {
    // 最低庫存模式：顯示最低庫存設定值，使用 data-min-stock-field 標記
    var minVal = getMinStockValue('store', product.id, branchId);
    return '<td class="stock-cell">' + buildMinStockControl(branchId, minVal, label) + '</td>';
  }

  // 正常模式
  var qty = getProductBranchStock(product, branchId);
  var cellClass = isLowCell ? 'stock-cell stock-cell-below-min' : 'stock-cell';
  var tooltipAttr = isLowCell
    ? ' title="目前 ' + qty + ' 件，最低需 ' + getMinStockValue('store', product.id, branchId) + ' 件"'
    : '';

  return (
    '<td class="' +
    cellClass +
    '"' +
    tooltipAttr +
    '>' +
    buildStockCellContent(branchId, qty, label, isLowCell) +
    '</td>'
  );
}

/**
 * 建立租借商品的單個庫存 <td>。
 * 與 buildStoreStockCell 邏輯相同，但針對租借營地。
 *
 * Builds a single rental product stock <td> for a camp/warehouse.
 *
 * @param {Object}   rental      - 租借商品物件
 * @param {string}   campKey     - 營地 ID / 自訂名稱
 * @param {string}   label       - 顯示名稱
 * @param {Object}   campByKey   - 各營地目前庫存 { campKey: qty }
 * @param {string[]} lowCampKeys - 庫存不足的營地 key 陣列
 * @returns {string} <td> HTML 字串
 */
function buildRentalStockCell(rental, campKey, label, campByKey, lowCampKeys) {
  var isLowCell = lowCampKeys.indexOf(campKey) !== -1;

  if (isMinStockMode) {
    var minVal = getMinStockValue('rental', rental.id, campKey);
    return '<td class="stock-cell">' + buildMinStockControl(campKey, minVal, label) + '</td>';
  }

  var qty = normalizeStockValue(campByKey[campKey]);
  var cellClass = isLowCell ? 'stock-cell stock-cell-below-min' : 'stock-cell';
  var tooltipAttr = isLowCell
    ? ' title="目前 ' + qty + ' 件，最低需 ' + getMinStockValue('rental', rental.id, campKey) + ' 件"'
    : '';

  return (
    '<td class="' +
    cellClass +
    '"' +
    tooltipAttr +
    '>' +
    buildStockCellContent(campKey, qty, label, isLowCell) +
    '</td>'
  );
}

/**
 * 建立最低庫存設定模式的步進器 HTML（與 buildStockControl 相似，但使用 data-min-stock-field）。
 * Builds a stepper input for min-stock mode (uses data-min-stock-field instead of data-stock-field).
 *
 * @param {string} fieldName - 分店 / 營地 ID
 * @param {number} minQty    - 目前設定的最低庫存值
 * @param {string} label     - 顯示名稱
 * @returns {string} HTML 字串
 */
function buildMinStockControl(fieldName, minQty, label) {
  var safeQty = normalizeStockValue(minQty);

  return (
    '<div class="input-group input-group-sm admin-stock-control">' +
    '<button type="button" class="btn btn-outline-warning stock-step-btn" ' +
    'data-stock-action="decrement" title="' +
    escapeHtml(label) +
    ' 最低庫存減少">' +
    '<i class="fas fa-minus"></i></button>' +
    '<input type="number" class="form-control text-center stock-input" ' +
    'min="0" value="' +
    safeQty +
    '" data-original-qty="' +
    safeQty +
    '" ' +
    'data-stock-field="' +
    escapeHtml(fieldName) +
    '" ' +
    'data-min-stock-field="' +
    escapeHtml(fieldName) +
    '" ' +
    'aria-label="' +
    escapeHtml(label) +
    ' 最低庫存">' +
    '<button type="button" class="btn btn-outline-warning stock-step-btn" ' +
    'data-stock-action="increment" title="' +
    escapeHtml(label) +
    ' 最低庫存增加">' +
    '<i class="fas fa-plus"></i></button>' +
    '</div>'
  );
}

/**
 * 在確認庫存異動後，重新整理該列各格子的橘色低庫存標示。
 * 僅在正常模式下執行（最低庫存模式下不顯示橘色）。
 *
 * Refreshes orange low-stock cell highlights after a stock confirmation.
 * Only applies in normal (non-min-stock) mode.
 *
 * @param {jQuery}   $row        - 目標 <tr>
 * @param {string[]} lowFieldIds - 庫存不足的 field ID 陣列（branchId 或 campKey）
 */
function refreshRowLowStockCells($row, lowFieldIds) {
  if (isMinStockMode) {
    return;
  }

  $row.find('td.stock-cell').each(function () {
    $(this).removeClass('stock-cell-below-min').removeAttr('title');
  });

  $row.find('.stock-display-value').removeClass('text-danger');

  lowFieldIds.forEach(function (fieldId) {
    var $input = $row.find('.stock-input[data-stock-field="' + fieldId + '"]');
    var $display = $row.find('.stock-display-value[data-stock-field="' + fieldId + '"]');
    if (!$input.length && !$display.length) {
      return;
    }

    var qty = $input.length ? getStockInputValue($input) : parseInt($display.text(), 10) || 0;
    var $td = ($input.length ? $input : $display).closest('td');
    var inventoryType = $row.data('inventory-type') || 'store';
    var productId = $row.data('product-id');
    var minVal = getMinStockValue(inventoryType, productId, fieldId);

    $td.addClass('stock-cell-below-min').attr('title', '目前 ' + qty + ' 件，最低需 ' + minVal + ' 件');
    $display.addClass('text-danger');
  });
}

/**
 * 正常模式庫存格：瀏覽 span + 隱藏 inline input。
 * Normal mode stock cell: display span + hidden inline input.
 */
function buildStockCellContent(fieldName, qty, label, isLowCell) {
  var safeQty = normalizeStockValue(qty);
  var displayClass = isLowCell ? ' text-danger' : '';

  return (
    '<span class="stock-display-value' +
    displayClass +
    '" ' +
    'data-stock-field="' +
    escapeHtml(fieldName) +
    '">' +
    safeQty +
    '</span>' +
    '<input type="number" class="form-control form-control-sm stock-input stock-input-inline d-none" ' +
    'min="0" value="' +
    safeQty +
    '" data-original-qty="' +
    safeQty +
    '" ' +
    'data-stock-field="' +
    escapeHtml(fieldName) +
    '" ' +
    'aria-label="' +
    escapeHtml(label) +
    ' 庫存數量">'
  );
}

/**
 * 最後一欄「修改庫存數量」：右側 sticky，每列一組 ✏️ / ✓ / ✗。
 * Last column: right sticky stock edit actions (one pencil per row).
 */
function buildStockEditColumnCell() {
  var cellClass = 'sticky-col sticky-col-right sticky-col-stock-edit text-center';

  if (isMinStockMode) {
    return (
      '<td class="' +
      cellClass +
      '">' +
      '<button type="button" class="btn btn-sm btn-warning min-stock-confirm-btn d-none" ' +
      'title="儲存最低庫存設定" disabled>確定</button>' +
      '</td>'
    );
  }

  return (
    '<td class="' +
    cellClass +
    '">' +
    '<div class="stock-edit-actions-wrap">' +
    '<button type="button" class="btn btn-link btn-sm p-0 stock-edit-btn" title="修改庫存數量">' +
    '<i class="fas fa-pencil-alt text-primary"></i>' +
    '</button>' +
    '<div class="stock-edit-actions d-none">' +
    '<button type="button" class="btn btn-link btn-sm p-0 stock-confirm-btn" title="儲存" disabled>' +
    '<i class="fas fa-check text-primary"></i>' +
    '</button>' +
    '<button type="button" class="btn btn-link btn-sm p-0 stock-cancel-btn" title="取消">' +
    '<i class="fas fa-times text-danger"></i>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '</td>'
  );
}

/**
 * 從前台 data/products.json 的 specifications 物件收集不重複 key，填入 datalist。
 */
function loadProductSpecOptions() {
  var $specOptions = $('#productSpecOptions');
  if ($specOptions.length === 0) {
    return;
  }

  $.getJSON('../data/products.json', function (products) {
    var keyMap = {};
    (products || []).forEach(function (product) {
      if (!product.specifications || typeof product.specifications !== 'object') {
        return;
      }

      Object.keys(product.specifications).forEach(function (key) {
        keyMap[key] = true;
      });
    });

    var optionsHtml = Object.keys(keyMap)
      .sort()
      .map(function (key) {
        return '<option value="' + escapeHtml(key) + '"></option>';
      })
      .join('');

    $specOptions.html(optionsHtml);
  }).fail(function () {
    window.showAdminToast('載入規格選項失敗', 'danger');
  });
}

function getAddedSpecifications() {
  var specifications = {};

  $('#productSpecFields input[data-spec-key]').each(function () {
    var key = $(this).attr('data-spec-key');
    var value = $(this).val().trim();

    if (key && value) {
      specifications[key] = value;
    }
  });

  return specifications;
}

function findAdminProductById(productId) {
  return (adminProductsCache || []).find(function (product) {
    return product.id === productId;
  });
}

/**
 * 依 rentalId 找對應的商店商品。
 * Find the store product linked to a rental ID.
 */
function findStoreProductByRentalId(rentalId) {
  return (adminProductsCache || []).find(function (product) {
    return product.rentalId === rentalId;
  });
}

/**
 * 判斷商店商品是否已「啟用租借」。
 * rentalEnabled 為 false 時即使已有 rentalId 也視為未啟用；
 * 舊資料沒有 rentalEnabled 欄位時，有 rentalId 視為已啟用（向後相容）。
 *
 * Returns true when rental is enabled on the store product.
 * Missing rentalEnabled + existing rentalId is treated as enabled for backward compatibility.
 */
function isProductRentalEnabled(product) {
  if (!product || !product.rentalId) {
    return false;
  }
  if (product.rentalEnabled === undefined) {
    return true;
  }
  return !!product.rentalEnabled;
}

/**
 * 只保留已啟用租借的租借商品（供租借 tab 表格顯示）。
 * Filter rentals to those whose linked store product has rental enabled.
 */
function filterEnabledRentals(rentals) {
  return (rentals || []).filter(function (rental) {
    var storeProduct = findStoreProductByRentalId(rental.id);
    return storeProduct && isProductRentalEnabled(storeProduct);
  });
}

// 將商店商品資料回填到新增商品 Modal，切換為編輯狀態。
// Populates the modal with store product data and switches to edit mode.
function fillProductModal(product) {
  resetProductModalForm();
  setProductModalMode('edit');

  $('#addProductForm')
    .data('edit-product-id', product.id)
    .data('edit-type', 'store')
    .data('existing-thumbnail', product.thumbnail || PRODUCT_IMAGE_PLACEHOLDER)
    .data('existing-images', product.images || [])
    .data('existing-status', product.status || 'active');

  // 商店編輯模式：隱藏「主倉進貨量」欄位（編輯時直接編輯各分店庫存）
  // Store edit: hide the warehouse qty col (branches are edited directly)
  $('#newProductStockCol').addClass('d-none');

  // 商店編輯模式：顯示「是否為租借商品」switch，依 rentalEnabled 設定初始值
  // Store edit: show the rental toggle; set checked state based on rentalEnabled
  $('#newProductIsRentalWrapper').removeClass('d-none');
  var hasRental = isProductRentalEnabled(product);
  $('#newProductIsRental').prop('checked', hasRental);

  if (hasRental) {
    // 已啟用租借：顯示營地分配區並帶入現有資料（isStoreEdit=true 避免影響售價）
    // Rental enabled: show camp section and populate it (isStoreEdit=true to keep price required)
    var linkedRental = findAdminRentalById(product.rentalId);
    syncRentalFormState(true, true, true);
    if (linkedRental) {
      populateRentalCampFields(linkedRental.camp);
    }
  } else {
    syncRentalFormState(false, false, true);
  }

  $('#newProductStock').prop('readonly', false).removeClass('bg-light');
  $('#newProductName').val(product.name || '');
  $('#newProductCategory').val(product.category || '');
  $('#newProductSpec').val(product.spec || '');
  $('#newProductPrice').val(product.price || '');

  // 顯示分店庫存區塊，並帶入各分店目前庫存值
  // Show branch stock section and fill in each branch's current quantity
  $('#editBranchStockField').removeClass('d-none');
  fillEditBranchStockFields(product);

  if (product.specifications && typeof product.specifications === 'object') {
    Object.keys(product.specifications).forEach(function (key) {
      addSpecificationField(key, product.specifications[key]);
    });
  }
}

/**
 * 將商品各分店庫存帶入 #editBranchPresetList 的輸入欄，
 * 並更新總庫存顯示。
 * Fills #editBranchPresetList inputs with product.branch values and updates total.
 * @param {Object} product - 商店商品物件（含 branch 欄位）
 */
function fillEditBranchStockFields(product) {
  $('#editBranchPresetList .edit-branch-row').each(function () {
    var $row = $(this);
    var branchId = $row.data('branch-id');
    var qty = getProductBranchStock(product, branchId);

    // 直接填入庫存數量（無 checkbox）
    $row.find('.edit-branch-quantity-input').val(qty);
  });

  updateEditBranchTotal();
}

/**
 * 加總所有分店的數量，更新 #editBranchTotalStock 的顯示。
 * 數量為 0 代表該分店庫存 0 件（仍計入加總）。
 * Sums all branch quantities and updates the read-only total display.
 * Zero means that branch has 0 stock (still included in total).
 */
function updateEditBranchTotal() {
  var total = 0;
  $('#editBranchPresetList .edit-branch-row').each(function () {
    total += normalizeStockValue($(this).find('.edit-branch-quantity-input').val());
  });
  $('#editBranchTotalStock').text(total);
}

// 將租借商品資料回填到新增商品 Modal，並帶入各營地庫存明細。
// Populates the modal with rental product data and switches to edit mode.
function fillRentalModal(rental) {
  resetProductModalForm();
  setProductModalMode('edit');

  $('#addProductForm')
    .data('edit-product-id', rental.id)
    .data('edit-type', 'rental')
    .data('existing-thumbnail', rental.image || PRODUCT_IMAGE_PLACEHOLDER)
    .data('existing-images', [])
    .data('existing-status', 'active');

  // 租借編輯模式：隱藏「是否為租借商品」toggle（類型已確定，不可切換）
  // Rental edit: hide the rental toggle — type is already determined
  $('#newProductIsRentalWrapper').addClass('d-none');

  // 租借編輯模式：隱藏「主倉進貨量」欄位（租借商品用營地欄位）
  // Rental edit: hide the warehouse qty col (rental products use camp fields)
  $('#newProductStockCol').addClass('d-none');

  // 分店庫存區塊不顯示（租借商品使用營地區塊）
  // Branch stock section stays hidden for rental products
  $('#editBranchStockField').addClass('d-none');

  $('#newProductIsRental').prop('checked', true);
  syncRentalFormState(true, true); // 編輯模式：顯示營地分配區
  $('#newProductName').val(rental.name || '');
  $('#newProductCategory').val(rental.category || '其他');
  $('#newProductSpec').val('');
  $('#newProductPrice').val('');
  populateRentalCampFields(rental.camp);
  $('#newProductStock').val(getRentalTotalStock(rental)).prop('readonly', true).addClass('bg-light');
}

// 重設新增商品 Modal 的欄位、暫存狀態與租借營地清單。
// Resets all form fields, data attributes, and rental camp states.
function resetProductModalForm() {
  var form = $('#addProductForm')[0];
  if (form) {
    form.reset();
  }

  $('#addProductForm')
    .removeData('edit-product-id')
    .removeData('edit-type')
    .removeData('existing-thumbnail')
    .removeData('existing-images')
    .removeData('existing-status');

  $('#productSpecFields').empty();
  $('#rentalCampList').empty();

  // 重置固定營地：全部數量清零（已無 checkbox）
  // Reset all preset camp inputs to 0 (no checkboxes anymore)
  $('#rentalCampPresetList .rental-camp-preset-row').each(function () {
    $(this).find('.rental-camp-quantity-input').val(0);
  });

  // 清空租借主倉進貨量欄位
  $('#newRentalWarehouseStock').val(0);

  $('#newProductIsRental').prop('checked', false);
  $('#newProductStock').prop('readonly', false).removeClass('bg-light').val('0');
  setProductModalMode('add');
  syncRentalFormState(false);

  // 恢復新增模式：隱藏租借 toggle（新增時不可設定）、顯示主倉進貨量欄位、隱藏分店庫存區塊
  // Restore add mode: hide rental toggle (rental is configured via edit only), show warehouse qty col
  $('#newProductIsRentalWrapper').addClass('d-none');
  $('#newProductStockCol').removeClass('d-none');
  $('#editBranchStockField').addClass('d-none');
  resetEditBranchStockFields();

  // （損耗備註欄位已移除，無需 reset）
  // Loss reason fields have been removed; nothing to reset here.
}

/**
 * 將分店庫存區塊的所有欄位歸零、全部勾選並啟用，準備下一次編輯使用。
 * Resets all branch stock inputs to 0, checks all checkboxes, and enables all inputs.
 */
function resetEditBranchStockFields() {
  // 直接歸零所有分店數量（無 checkbox）
  $('#editBranchPresetList .edit-branch-row').each(function () {
    $(this).find('.edit-branch-quantity-input').val(0);
  });
  $('#editBranchTotalStock').text(0);
}

function addSpecificationField(specKey, value) {
  if (!specKey) {
    return;
  }

  var $field = $('<div>', { class: 'mb-2 product-spec-field' });
  var $label = $('<label>', { class: 'form-label small text-muted mb-1' }).attr('for', specKey).text(specKey);
  var $input = $('<input>', {
    type: 'text',
    class: 'form-control form-control-sm',
  })
    .attr('id', specKey)
    .attr('data-spec-key', specKey)
    .val(value || '');

  $field.append($label, $input);
  $('#productSpecFields').append($field);
}

function upsertAdminProductCache(product) {
  var index = adminProductsCache.findIndex(function (item) {
    return item.id === product.id;
  });

  if (index >= 0) {
    adminProductsCache[index] = product;
  } else {
    adminProductsCache.unshift(product);
  }
}

function buildProductRow(p) {
  var stock = getProductTotalStock(p);
  var isLow = !isMinStockMode && isStoreProductLowStock(p);
  var rowClass = isLow ? ' class="table-danger"' : '';
  var imgSrc = p.thumbnail || PRODUCT_IMAGE_PLACEHOLDER;
  // 在正常模式下，取得庫存不足的分店 ID 清單，用於橘色格子標示
  // In normal mode, get low-branch IDs for orange cell highlighting
  var lowBranchIds = isMinStockMode ? [] : getLowBranchIds(p);

  // 欄位順序（依 SDD v1.0）：圖片 | 名稱 | 分類 | 操作 | 總庫存(唯讀) | 主倉 | 分店A | 分店B | 分店C
  // Column order (SDD v1.0): img | name | category | action | total(readonly) | main | branchA | branchB | branchC
  return (
    '<tr data-product-id="' +
    escapeHtml(p.id) +
    '" data-inventory-type="store"' +
    rowClass +
    '>' +
    // ── 固定欄 1：圖片 ──
    '<td class="sticky-col sticky-col-img">' +
    '<img src="' +
    escapeHtml(imgSrc) +
    '" width="48" height="48" class="rounded object-fit-cover"' +
    ' onerror="this.src=\'' +
    PRODUCT_IMAGE_PLACEHOLDER +
    '\'">' +
    '</td>' +
    // ── 固定欄 2：商品名稱（一般模式可點擊開啟編輯 Modal；最低庫存模式為純文字）──
    '<td class="sticky-col sticky-col-name fw-semibold">' +
    (isMinStockMode
      ? '<span class="product-name-cell" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</span>'
      : '<span class="admin-cell-link product-name-cell edit-product-name" ' +
        'title="編輯商品：' +
        escapeHtml(p.name) +
        '">' +
        escapeHtml(p.name) +
        '</span>') +
    '</td>' +
    // ── 固定欄 3：分類 ──
    '<td class="sticky-col sticky-col-category">' +
    '<span class="badge bg-light text-dark border">' +
    escapeHtml(p.category || '—') +
    '</span>' +
    '</td>' +
    // ── 固定欄 4：操作（調撥；庫存編輯改由最後一欄鉛筆觸發）──
    '<td class="sticky-col sticky-col-action">' +
    '<div class="d-flex flex-column gap-1">' +
    (!isMinStockMode && isProductRentalEnabled(p)
      ? '<button type="button" class="btn btn-sm btn-outline-primary transfer-to-rental-btn" title="調撥" ' +
        'data-product-id="' +
        escapeHtml(p.id) +
        '">' +
        '調撥' +
        '</button>'
      : '') +
    '</div>' +
    '</td>' +
    // ── 固定欄 5：總庫存量 / 閾值合計（唯讀靜態顯示）──
    // Normal mode: actual total stock; Min-stock mode: sum of all branch minimums
    (function () {
      if (isMinStockMode) {
        var totalMin = ADMIN_PRODUCT_BRANCH_IDS.reduce(function (sum, branchId) {
          return sum + getMinStockValue('store', p.id, branchId);
        }, 0);
        return (
          '<td class="sticky-col sticky-col-total-stock stock-cell text-center fw-semibold text-warning" ' +
          'data-total-stock-display>' +
          '<span class="total-stock-value">' +
          totalMin +
          '</span>' +
          '<br><small class="text-muted fw-normal" style="font-size:0.65rem;">閾值合計</small>' +
          '</td>'
        );
      }
      return (
        '<td class="sticky-col sticky-col-total-stock stock-cell text-center fw-semibold" ' +
        'data-total-stock-display>' +
        '<span class="total-stock-value">' +
        stock +
        '</span>' +
        '</td>'
      );
    })() +
    // ── 可捲動欄：商店主倉 + 分店 A / B / C ──
    // 最低庫存模式：步進器顯示最低庫存值；正常模式：顯示實際庫存，不足格加橘色 class + tooltip
    // Min-stock mode: show minimum values; Normal mode: show actual stock, orange class + tooltip for low cells
    buildStoreStockCell(p, ADMIN_STORE_WAREHOUSE_ID, ADMIN_STORE_WAREHOUSE_LABEL, lowBranchIds) +
    buildStoreStockCell(p, 'branch-001', '分店 A', lowBranchIds) +
    buildStoreStockCell(p, 'branch-002', '分店 B', lowBranchIds) +
    buildStoreStockCell(p, 'branch-003', '分店 C', lowBranchIds) +
    buildStockEditColumnCell() +
    '</tr>'
  );
}

function buildRentalRow(item) {
  var rental = normalizeRentalItem(item);
  var stock = getRentalTotalStock(rental);
  var isLow = !isMinStockMode && isRentalProductLowStock(rental);
  var rowClass = isLow ? ' class="table-danger"' : '';
  var campByKey = rental.campByKey || {};
  // 在正常模式下，取得庫存不足的營地 key 清單，用於橘色格子標示
  // In normal mode, get low-camp keys for orange cell highlighting
  var lowCampKeys = isMinStockMode ? [] : getLowCampKeys(rental);

  // 固定地點欄（不含租借主倉，租借主倉獨立置於總庫存後）：每個欄位都是獨立的步進器
  // Fixed location columns (excluding rental main, which has its own slot): each gets its own ± stepper
  var fixedCampCols = ADMIN_RENTAL_CAMP_IDS.filter(function (id) {
    return id !== ADMIN_RENTAL_WAREHOUSE_ID;
  })
    .map(function (campId) {
      return buildRentalStockCell(rental, campId, ADMIN_RENTAL_CAMP_LABELS[campId], campByKey, lowCampKeys);
    })
    .join('');

  // 自訂營地：若 campByKey 有非固定 ID 的 key，附加到最後
  // Custom camps: extra keys not in ADMIN_RENTAL_CAMP_IDS (also in scrollable area)
  var fixedIdSet = {};
  ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
    fixedIdSet[id] = true;
  });
  var customCampCols = Object.keys(campByKey)
    .filter(function (key) {
      return !fixedIdSet[key];
    })
    .map(function (customName) {
      return buildRentalStockCell(rental, customName, customName, campByKey, lowCampKeys);
    })
    .join('');

  // 欄位順序（依 SDD v1.0）：圖片 | 名稱 | 分類 | 操作 | 總租借庫存(唯讀) | 主倉 | 各營區（可捲動）
  // Column order (SDD v1.0): img | name | category | action | rental-total(readonly) | main | camps (scrollable)
  return (
    '<tr data-product-id="' +
    escapeHtml(rental.id) +
    '" data-inventory-type="rental"' +
    rowClass +
    '>' +
    // ── 固定欄 1：圖片 ──
    '<td class="sticky-col sticky-col-img">' +
    '<img src="' +
    escapeHtml(rental.image) +
    '" width="48" height="48" class="rounded object-fit-cover"' +
    ' onerror="this.src=\'' +
    PRODUCT_IMAGE_PLACEHOLDER +
    '\'">' +
    '</td>' +
    // ── 固定欄 2：商品名稱（一般模式可點擊開啟編輯 Modal；最低庫存模式為純文字）──
    '<td class="sticky-col sticky-col-name fw-semibold">' +
    (isMinStockMode
      ? '<span class="product-name-cell" title="' +
        escapeHtml(rental.name) +
        '">' +
        escapeHtml(rental.name) +
        '</span>'
      : '<span class="admin-cell-link product-name-cell edit-product-name" ' +
        'title="編輯商品：' +
        escapeHtml(rental.name) +
        '">' +
        escapeHtml(rental.name) +
        '</span>') +
    '</td>' +
    // ── 固定欄 3：分類 ──
    '<td class="sticky-col sticky-col-category">' +
    '<span class="badge bg-light text-dark border">' +
    escapeHtml(rental.category || '其他') +
    '</span>' +
    '</td>' +
    // ── 固定欄 4：操作（調撥；庫存編輯改由最後一欄鉛筆觸發）──
    '<td class="sticky-col sticky-col-action">' +
    '<div class="d-flex flex-column gap-1">' +
    (!isMinStockMode
      ? '<button type="button" class="btn btn-sm btn-outline-primary transfer-from-rental-btn" title="調撥" ' +
        'data-rental-id="' +
        escapeHtml(rental.id) +
        '">' +
        '調撥' +
        '</button>'
      : '') +
    '</div>' +
    '</td>' +
    // ── 固定欄 5：總租借庫存 / 閾值合計（唯讀靜態顯示）──
    // Normal mode: actual total rental stock; Min-stock mode: sum of all camp minimums
    (function () {
      if (isMinStockMode) {
        var allCampKeys = Object.keys(campByKey);
        var totalMin = allCampKeys.reduce(function (sum, key) {
          return sum + getMinStockValue('rental', rental.id, key);
        }, 0);
        return (
          '<td class="sticky-col sticky-col-total-stock stock-cell text-center fw-semibold text-warning" ' +
          'data-total-stock-display>' +
          '<span class="total-stock-value">' +
          totalMin +
          '</span>' +
          '<br><small class="text-muted fw-normal" style="font-size:0.65rem;">閾值合計</small>' +
          '</td>'
        );
      }
      return (
        '<td class="sticky-col sticky-col-total-stock stock-cell text-center fw-semibold" ' +
        'data-total-stock-display>' +
        '<span class="total-stock-value">' +
        stock +
        '</span>' +
        '</td>'
      );
    })() +
    // ── 可捲動欄：主倉 + 各固定營區 + 自訂營區 ──
    buildRentalStockCell(
      rental,
      ADMIN_RENTAL_WAREHOUSE_ID,
      ADMIN_RENTAL_WAREHOUSE_LABEL,
      campByKey,
      lowCampKeys
    ) +
    fixedCampCols +
    customCampCols +
    buildStockEditColumnCell() +
    '</tr>'
  );
}

// ════════════════════════════════════════════════════════════
// 跨類型調撥：商店 → 租借（單向，不可逆）
// Cross-type transfer: Store → Rental (one-way, irreversible)
// ════════════════════════════════════════════════════════════

/**
 * 開啟調至租借 Modal，並將商品資料帶入各欄位。
 * Opens the transfer-to-rental modal and populates it with product data.
 * 依 product.rentalId 自動對應目標租借商品；無對應則封鎖並顯示 Toast。
 * Uses product.rentalId to auto-match target rental; blocks if not set.
 * @param {string} productId - 商店商品 ID
 */
function openTransferToRentalModal(productId) {
  var product = findAdminProductById(productId);

  if (!product) {
    window.showAdminToast('找不到商品 ' + productId + ' 的資料', 'danger');
    return;
  }

  // 驗證：租借必須已啟用才可調撥
  // Validate: rental must be enabled on the store product
  if (!isProductRentalEnabled(product)) {
    window.showAdminToast('此商品尚未啟用租借，請先於編輯中開啟「是否為租借商品」', 'danger');
    return;
  }

  var rental = findAdminRentalById(product.rentalId);
  if (!rental) {
    window.showAdminToast('租借商品資料不存在，請聯繫管理員', 'danger');
    return;
  }

  // 儲存商品 ID 與租借 ID，供確認調撥時使用
  // Store both IDs for use when confirming transfer
  $('#transferToRentalModal').data('source-product-id', productId).data('target-rental-id', product.rentalId);

  // 填入商品名稱（唯讀）
  $('#transferProductName').text(product.name);

  // 填入來源分店下拉選單（主倉 + 各實體分店 + 營地互轉）
  // Populate source branch dropdown (main + physical branches + camp-transfer option)
  var $sourceBranch = $('#transferSourceBranch').empty();
  ADMIN_PRODUCT_BRANCH_IDS.forEach(function (branchId) {
    var qty = getProductBranchStock(product, branchId);
    var label = ADMIN_PRODUCT_BRANCH_LABELS[branchId] || branchId;
    $('<option>', { value: branchId })
      .text(label + '（' + qty + ' 件）')
      .appendTo($sourceBranch);
  });
  // 最後加入「營地互轉」選項（Mode 2 入口）
  $('<option>', { value: 'camp-transfer' }).text('── 營地互轉 ──').appendTo($sourceBranch);

  // 預設選主倉（index 0），同步目前庫存顯示，並設為 Mode 1 狀態
  $sourceBranch.prop('selectedIndex', 0);
  // 確保目前庫存欄可見、delta 最小值 >= 0（Mode 1 初始狀態）
  $('#transferSourceStockCol').removeClass('d-none');
  syncTransferSourceStock();

  // 重置多行營地分配清單（清空並建立固定營地列）
  // Reset camp distribution rows (clear and build fixed camp rows)
  resetTransferCampRows(rental);
  syncTransferDeltaCounter();

  // 開啟 Modal
  bootstrap.Modal.getOrCreateInstance(document.getElementById('transferToRentalModal')).show();
}

/**
 * 依目前選取的來源分店，更新「目前庫存」靜態顯示。
 * Updates the current stock display based on the selected source branch.
 */
function syncTransferSourceStock() {
  // Mode 2（營地互轉）時目前庫存欄已隱藏，不需更新
  // Mode 2 (camp-transfer): source stock col is hidden, skip update
  if ($('#transferSourceBranch').val() === 'camp-transfer') {
    return;
  }

  var productId = $('#transferToRentalModal').data('source-product-id');
  var product = findAdminProductById(productId);
  var branchId = $('#transferSourceBranch').val();

  if (!product || !branchId) {
    $('#transferSourceStock').text('0');
    return;
  }

  var qty = getProductBranchStock(product, branchId);
  $('#transferSourceStock').text(qty + ' 件');
}

// ════════════════════════════════════════════════════════════
// 多行營地分配輔助函式群
// Multi-row camp distribution helper functions
// ════════════════════════════════════════════════════════════

/**
 * 取得目前來源分店的庫存（數字）。
 * Returns the current source branch stock as a number.
 */
function getTransferSourceStockValue() {
  var productId = $('#transferToRentalModal').data('source-product-id');
  var product = findAdminProductById(productId);
  var branchId = $('#transferSourceBranch').val();
  return getProductBranchStock(product, branchId);
}

/**
 * 清空 #transferCampRows，將目標租借商品「所有已存在的營地（含主倉）」各產生一列，
 * 並預帶每個營地目前的現有庫存數量。
 * 使用者可再點「新增營地」按鈕加入尚未存放此商品的其他營地。
 *
 * Clears the camp rows container and appends one row per existing camp (including main),
 * each pre-filled with the camp's current stock quantity.
 * @param {Object} rental - 目標租借商品物件
 */
function resetTransferCampRows(rental) {
  $('#transferCampRows').empty();

  var campOptions = buildTransferCampOptions(rental);

  // 每個固定營地（含主倉）產生靜態列（無 ✕，無下拉）
  // Each fixed camp (incl. main) gets a static preset row (no X, no dropdown)
  campOptions.forEach(function (opt) {
    appendTransferCampRow(opt.value, opt.label, opt.currentQty);
  });
}

/**
 * 產生租借商品所有可選的營地選項清單（主倉優先，再固定營地，再自訂營地）。
 * Builds an ordered array of { value, label, currentQty } for all camps.
 * @param {Object} rental - 目標租借商品物件
 * @returns {Array} 選項陣列
 */
function buildTransferCampOptions(rental) {
  var campByKey = rental.campByKey || {};
  var fixedIdSet = {};
  ADMIN_RENTAL_CAMP_IDS.forEach(function (id) {
    fixedIdSet[id] = true;
  });

  var options = [];

  // 固定營地（含主倉）依預設順序排列
  ADMIN_RENTAL_CAMP_IDS.forEach(function (campId) {
    var label = ADMIN_RENTAL_CAMP_LABELS[campId] || campId;
    var qty = normalizeStockValue(campByKey[campId]);
    options.push({ value: campId, label: label, currentQty: qty });
  });

  // 自訂營地排在最後
  Object.keys(campByKey).forEach(function (key) {
    if (!fixedIdSet[key]) {
      options.push({ value: key, label: key, currentQty: normalizeStockValue(campByKey[key]) });
    }
  });

  return options;
}

/**
 * 在 #transferCampRows 新增一列「固定營地列」（靜態格式，無 ✕，無下拉）。
 * 格式：[靜態營地名稱] [當前庫存（唯讀）] [更動數量（delta input，預設 0）]
 *
 * Appends a preset fixed camp row (static name, read-only stock, delta input).
 * @param {string} campKey    - 營地 key（存入 data-camp-key）
 * @param {string} campLabel  - 顯示名稱
 * @param {number} currentQty - 該營地目前庫存（0 以上）
 */
function appendTransferCampRow(campKey, campLabel, currentQty) {
  // 營地名稱（靜態文字）
  var $name = $('<span>', { class: 'transfer-camp-name flex-grow-1' }).text(campLabel);

  // 當前庫存（唯讀標籤，存入 data-current-qty 方便讀取）
  var $curQty = $('<span>', {
    class: 'input-group-text transfer-camp-current-qty text-muted',
    style: 'min-width: 56px;',
    'data-current-qty': currentQty,
  }).text(currentQty + ' 件');

  // 更動數量（delta）輸入框，Mode 1 預設 min=0，Mode 2 時由 switchTransferMode 移除 min
  var $delta = $('<input>', {
    type: 'number',
    class: 'form-control form-control-sm transfer-camp-delta',
    min: 0,
    value: 0,
    style: 'width: 60px;',
  });

  // 組合成一列（row），data-camp-key 供提交時識別
  var $row = $('<div>', {
    class: 'd-flex gap-2 align-items-center transfer-camp-row',
    'data-camp-key': campKey,
  })
    .append($name)
    .append($curQty)
    .append($delta);

  $('#transferCampRows').append($row);
}

/**
 * 在 #transferCampRows 新增一列「自訂營地列」（可填名稱，含 ✕ 刪除按鈕）。
 * 格式：[名稱輸入框] [0 件（唯讀）] [更動數量（delta input）] [✕ 刪除]
 *
 * Appends a custom camp row with name input and delete button.
 * @param {boolean} isCampMode - 是否為 Mode 2（影響 delta 的 min 屬性）
 */
function appendCustomTransferCampRow(isCampMode) {
  // 名稱輸入框
  var $nameInput = $('<input>', {
    type: 'text',
    class: 'form-control form-control-sm transfer-camp-custom-name flex-grow-1',
    placeholder: '自訂營地名稱',
  });

  // 當前庫存（固定 0 件，唯讀）
  var $curQty = $('<span>', {
    class: 'input-group-text transfer-camp-current-qty text-muted',
    style: 'min-width: 56px;',
    'data-current-qty': 0,
  }).text('0 件');

  // 更動數量（delta）輸入框
  var deltaAttrs = {
    type: 'number',
    class: 'form-control form-control-sm transfer-camp-delta',
    value: 0,
    style: 'width: 60px;',
  };
  // Mode 2 允許負數，Mode 1 最小為 0
  if (!isCampMode) {
    deltaAttrs.min = 0;
  }
  var $delta = $('<input>', deltaAttrs);

  // 刪除按鈕
  var $removeBtn = $('<button>', {
    type: 'button',
    class: 'btn btn-outline-danger btn-sm remove-transfer-camp-row',
    title: '移除此行',
  }).html('<i class="fas fa-times"></i>');

  // 組合成一列（data-camp-key 空白，提交時以名稱輸入框的值為準）
  var $row = $('<div>', {
    class: 'd-flex gap-2 align-items-center transfer-camp-row transfer-camp-row-custom',
    'data-camp-key': '',
  })
    .append($nameInput)
    .append($curQty)
    .append($delta)
    .append($removeBtn);

  $('#transferCampRows').append($row);
}

/**
 * 切換調撥 Modal 的操作模式。
 * Mode 'branch'：分店→營地（來源庫存欄可見，delta >= 0）
 * Mode 'camp'  ：營地互轉（來源庫存欄隱藏，delta 可為負）
 *
 * Switches between Mode 1 (branch→camp) and Mode 2 (camp transfer).
 * @param {string} mode - 'branch' 或 'camp'
 */
function switchTransferMode(mode) {
  if (mode === 'camp') {
    // 隱藏目前庫存欄（Mode 2 不需要來源分店庫存）
    $('#transferSourceStockCol').addClass('d-none');
    // 移除 delta 最小值限制，允許負數（營地可扣減）
    $('.transfer-camp-delta').removeAttr('min');
    // 更新說明文字
    $('#transferModeHint').text('填入各營地的增減數量（正數 = 增加，負數 = 減少；送出時驗證不可出現負庫存）');
  } else {
    // Mode 1 (branch)：顯示目前庫存欄
    $('#transferSourceStockCol').removeClass('d-none');
    syncTransferSourceStock();
    // 恢復 delta 最小值 0（不可輸入負數）並清除已輸入的負值
    $('.transfer-camp-delta')
      .attr('min', 0)
      .each(function () {
        if (parseInt($(this).val()) < 0) {
          $(this).val(0);
        }
      });
    // 更新說明文字
    $('#transferModeHint').text('以下為本次從來源分店調入各營地的數量（0 = 不異動）');
  }
  // 兩種模式都清除紅框
  $('.transfer-camp-delta').removeClass('is-invalid');
  syncTransferDeltaCounter();
}

/**
 * 更新計數器：依目前模式顯示不同資訊，並即時標記負庫存紅框。
 *
 * Mode 1（分店→營地）：計算所有正 delta 合計，顯示「總計轉入 N 件」
 * Mode 2（營地互轉） ：計算淨 delta（可正可負），顯示「淨變動 N 件」，
 *   並對每列檢查「當前庫存 + delta >= 0」，不足者加 is-invalid 紅框。
 *
 * Updates #transferDistributionCounter and per-row validation.
 */
function syncTransferDeltaCounter() {
  var isCampMode = $('#transferSourceBranch').val() === 'camp-transfer';
  var netDelta = 0;

  if (isCampMode) {
    // ── Mode 2：逐列檢查負庫存 ──────────────────────
    $('#transferCampRows .transfer-camp-row').each(function () {
      var $row = $(this);
      var $deltaInp = $row.find('.transfer-camp-delta');
      var delta = parseInt($deltaInp.val()) || 0;
      var curQty = parseInt($row.find('.transfer-camp-current-qty').attr('data-current-qty')) || 0;
      netDelta += delta;

      // 若該列最終庫存會變負數，加紅框警告
      var wouldBeNegative = curQty + delta < 0;
      $deltaInp.toggleClass('is-invalid', wouldBeNegative);
    });

    $('#transferDistributionCounter')
      .text('淨變動 ' + (netDelta >= 0 ? '+' : '') + netDelta + ' 件')
      .toggleClass('text-danger', netDelta < 0)
      .toggleClass('text-muted', netDelta >= 0);
  } else {
    // ── Mode 1：加總正 delta，無紅框驗證 ──────────
    $('#transferCampRows .transfer-camp-delta').each(function () {
      var v = parseInt($(this).val()) || 0;
      if (v > 0) {
        netDelta += v;
      }
      // Mode 1 不做紅框，清除
      $(this).removeClass('is-invalid');
    });

    $('#transferDistributionCounter')
      .text('總計轉入 ' + netDelta + ' 件')
      .removeClass('text-danger')
      .addClass('text-muted');
  }
}

/**
 * 調撥入口：依目前選取的來源分店判斷模式，分派到對應提交函式。
 * Dispatch function: routes to Mode 1 or Mode 2 based on source branch selection.
 */
function submitTransferToRental() {
  var mode = $('#transferSourceBranch').val();
  if (mode === 'camp-transfer') {
    submitCampTransfer();
  } else {
    submitBranchToCampTransfer();
  }
}

/**
 * Mode 1：分店→營地 調撥。
 * 收集各 delta > 0 的列 → 更新商店分店庫存（-totalDelta）→ 更新各租借營地庫存（+delta）→ 產生「調撥」異動記錄。
 *
 * Mode 1: Branch → Camp transfer.
 * Deducts total delta from source branch, adds each delta to target camps.
 */
function submitBranchToCampTransfer() {
  var productId = $('#transferToRentalModal').data('source-product-id');
  var rentalId = $('#transferToRentalModal').data('target-rental-id');
  var branchId = $('#transferSourceBranch').val();

  var product = findAdminProductById(productId);
  var rental = findAdminRentalById(rentalId);

  if (!product) {
    window.showAdminToast('找不到來源商品資料', 'danger');
    return;
  }
  if (!rental) {
    window.showAdminToast('找不到對應租借商品資料', 'danger');
    return;
  }

  // ── 收集所有 delta > 0 的列 ────────────────────
  var distributions = [];
  $('#transferCampRows .transfer-camp-row').each(function () {
    var $row = $(this);
    var campKey = $row.data('camp-key');
    // 自訂列以名稱輸入框的值作為 campKey
    if (!campKey) {
      campKey = $.trim($row.find('.transfer-camp-custom-name').val());
    }
    var delta = parseInt($row.find('.transfer-camp-delta').val()) || 0;
    if (campKey && delta > 0) {
      distributions.push({ campKey: campKey, delta: delta });
    }
  });

  if (distributions.length === 0) {
    window.showAdminToast('請至少填寫一個營地的轉入數量（大於 0）', 'danger');
    return;
  }

  var totalDelta = distributions.reduce(function (sum, d) {
    return sum + d.delta;
  }, 0);

  // ── 更新商店快取：來源分店 -totalDelta（允許負數，不驗證）──
  var sourceQty = getProductBranchStock(product, branchId);
  product.branch[branchId] = sourceQty - totalDelta;
  product['total-stock'] = getBranchTotal(product.branch);

  // ── 更新租借快取：各目標營地各自 +delta ──────────
  distributions.forEach(function (d) {
    var prev = normalizeStockValue((rental.campByKey || {})[d.campKey]);
    rental.campByKey[d.campKey] = prev + d.delta;
  });
  rental.camp = buildCampArrayFromKey(rental.campByKey);

  // ── 更新商店表格列畫面 ─────────────────────────
  var $storeRow = $('#productsTableBody tr[data-product-id="' + escapeSelector(productId) + '"]');
  if ($storeRow.length) {
    $storeRow.find('.total-stock-value').text(product['total-stock']);
    $storeRow.toggleClass('table-danger', !isMinStockMode && isStoreProductLowStock(product));
    refreshRowLowStockCells($storeRow, getLowBranchIds(product));
    var $branchInput = $storeRow.find('.stock-input[data-stock-field="' + branchId + '"]');
    $branchInput
      .val(product.branch[branchId])
      .attr('data-original-qty', product.branch[branchId])
      .data('original-qty', product.branch[branchId]);
    syncStockInputFeedback($storeRow);
  }

  // ── 更新租借表格列畫面（若已載入）──────────────
  _updateRentalTableRow(rentalId, rental, distributions);

  // ── 產生異動記錄（type: '調撥'）────────────────
  var items = buildMultiCampTransferMovementItems(product, branchId, rental, distributions, totalDelta);
  pendingMovementItems = pendingMovementItems.concat(items);
  updateMovementGenerateButtonState();

  // ── 關閉 Modal 並顯示成功訊息 ─────────────────
  bootstrap.Modal.getOrCreateInstance(document.getElementById('transferToRentalModal')).hide();
  var campSummary = distributions
    .map(function (d) {
      return (ADMIN_RENTAL_CAMP_LABELS[d.campKey] || d.campKey) + ' +' + d.delta + ' 件';
    })
    .join('、');
  window.showAdminToast(
    '已將「' +
      product.name +
      '」共 ' +
      totalDelta +
      ' 件從「' +
      (ADMIN_PRODUCT_BRANCH_LABELS[branchId] || branchId) +
      '」調至租借（' +
      campSummary +
      '）'
  );
}

/**
 * Mode 2：營地互轉。
 * 收集所有 delta ≠ 0 的列 → 驗證每列最終庫存 >= 0 → 更新各租借營地庫存（+delta）→ 產生「營地互轉」異動記錄。
 * 商店分店庫存不受影響。
 *
 * Mode 2: Camp-to-camp transfer.
 * Validates no camp goes negative, then applies each delta to the corresponding camp.
 */
function submitCampTransfer() {
  var rentalId = $('#transferToRentalModal').data('target-rental-id');
  var rental = findAdminRentalById(rentalId);

  if (!rental) {
    window.showAdminToast('找不到對應租借商品資料', 'danger');
    return;
  }

  // ── 收集所有 delta ≠ 0 的列 ─────────────────────
  var distributions = [];
  $('#transferCampRows .transfer-camp-row').each(function () {
    var $row = $(this);
    var campKey = $row.data('camp-key');
    if (!campKey) {
      campKey = $.trim($row.find('.transfer-camp-custom-name').val());
    }
    var delta = parseInt($row.find('.transfer-camp-delta').val()) || 0;
    var curQty = parseInt($row.find('.transfer-camp-current-qty').attr('data-current-qty')) || 0;
    if (campKey && delta !== 0) {
      distributions.push({ campKey: campKey, delta: delta, currentQty: curQty });
    }
  });

  if (distributions.length === 0) {
    window.showAdminToast('請至少填寫一個營地的增減數量（非 0）', 'danger');
    return;
  }

  // ── 驗證：任何營地的最終庫存不可為負 ──────────
  var hasNegative = false;
  distributions.forEach(function (d) {
    if (d.currentQty + d.delta < 0) {
      hasNegative = true;
      // 標紅框（syncTransferDeltaCounter 已處理，但送出前再補一次確保）
      $(
        '#transferCampRows .transfer-camp-row[data-camp-key="' +
          escapeSelector(d.campKey) +
          '"] .transfer-camp-delta'
      ).addClass('is-invalid');
    }
  });
  if (hasNegative) {
    window.showAdminToast('部分營地調整後庫存會變為負數，請修正紅框欄位', 'danger');
    return;
  }

  // ── 更新租借快取：各營地各自 ±delta（商店庫存不動）──
  distributions.forEach(function (d) {
    var prev = normalizeStockValue((rental.campByKey || {})[d.campKey]);
    rental.campByKey[d.campKey] = prev + d.delta;
  });
  rental.camp = buildCampArrayFromKey(rental.campByKey);

  // ── 更新租借表格列畫面 ─────────────────────────
  _updateRentalTableRow(rentalId, rental, distributions);

  // ── 產生異動記錄（type: '營地互轉'）────────────
  var items = [];
  distributions.forEach(function (d) {
    var campLabel = ADMIN_RENTAL_CAMP_LABELS[d.campKey] || d.campKey;
    items.push({
      productName: rental.name + '（租借）',
      quantity: Math.abs(d.delta),
      fromStore: d.delta > 0 ? '（增加）' : campLabel,
      toStore: d.delta > 0 ? campLabel : '（減少）',
      type: '營地互轉',
    });
  });
  pendingMovementItems = pendingMovementItems.concat(items);
  updateMovementGenerateButtonState();

  // ── 關閉 Modal 並顯示成功訊息 ─────────────────
  bootstrap.Modal.getOrCreateInstance(document.getElementById('transferToRentalModal')).hide();
  var campSummary = distributions
    .map(function (d) {
      return (
        (ADMIN_RENTAL_CAMP_LABELS[d.campKey] || d.campKey) + ' ' + (d.delta >= 0 ? '+' : '') + d.delta + ' 件'
      );
    })
    .join('、');
  window.showAdminToast('營地互轉完成（' + campSummary + '）');
}

/**
 * 共用：更新租借表格列的庫存數值與低庫存狀態。
 * Shared helper: refreshes the rental table row after any transfer.
 * @param {string} rentalId       - 租借商品 ID
 * @param {Object} rental         - 已更新的租借商品快取物件
 * @param {Array}  distributions  - [{ campKey, delta }, ...] 已異動的列
 */
function _updateRentalTableRow(rentalId, rental, distributions) {
  var $rentalRow = $('#rentalProductsTableBody tr[data-product-id="' + escapeSelector(rentalId) + '"]');
  if (!$rentalRow.length) {
    return;
  }

  var rentalTotal = Object.keys(rental.campByKey).reduce(function (sum, key) {
    return sum + normalizeStockValue(rental.campByKey[key]);
  }, 0);
  $rentalRow.find('.total-stock-value').text(rentalTotal);
  $rentalRow.toggleClass('table-danger', !isMinStockMode && isRentalProductLowStock(rental));
  refreshRowLowStockCells($rentalRow, getLowCampKeys(rental));

  distributions.forEach(function (d) {
    var newQty = normalizeStockValue(rental.campByKey[d.campKey]);
    var $campInput = $rentalRow.find('.stock-input[data-stock-field="' + d.campKey + '"]');
    $campInput.val(newQty).attr('data-original-qty', newQty).data('original-qty', newQty);
  });
  syncStockInputFeedback($rentalRow);
}

/**
 * 產生一筆損耗異動 item。
 * 供需直接建立損耗紀錄的場景使用（如未來的管理員報廢操作）。
 *
 * Builds a single loss movement item.
 *
 * @param {string} productName   - 商品名稱
 * @param {string} locationLabel - 發生損耗的地點標籤（如 '商店主倉'、'租借主倉'、'分店 A'）
 * @param {number} lossQty       - 損耗數量（正整數）
 * @returns {Object} movement item
 */
function buildLossMovementItem(productName, locationLabel, lossQty) {
  return {
    productName: productName,
    quantity: Math.max(0, normalizeStockValue(lossQty)),
    fromStore: locationLabel,
    toStore: '—',
    type: '損耗',
  };
}

/**
 * 產生跨類型調撥的 1+N 筆異動 items。
 * 第 1 筆：商店來源分店扣減（合計）。
 * 第 2~N+1 筆：租借各目標營地各自增加。
 *
 * Builds 1+N movement items: one debit from store, one credit per target camp.
 * @param {Object} product       - 商店商品物件
 * @param {string} branchId      - 來源分店 ID
 * @param {Object} rental        - 租借商品物件
 * @param {Array}  distributions - [{ campKey, quantity }, ...] 各目標營地分配
 * @param {number} totalQty      - 本次調撥合計數量
 * @returns {Array} items 陣列（1 + distributions.length 筆）
 */
function buildMultiCampTransferMovementItems(product, branchId, rental, distributions, totalQty) {
  var branchLabel = ADMIN_PRODUCT_BRANCH_LABELS[branchId] || branchId;
  var items = [];

  // 第 1 筆：商店扣減（總量），type = '調撥'（商店→租借單向）
  // Item 1: deduct from store branch (total qty), type = '調撥' (store→rental, one-way)
  items.push({
    productName: product.name,
    quantity: totalQty,
    fromStore: branchLabel + ' →（調至租借）',
    toStore: rental.name,
    type: '調撥',
  });

  // 第 2~N+1 筆：各目標營地各自增加，type = '調撥'
  // Items 2~N+1: increase at each target camp, type = '調撥'
  distributions.forEach(function (d) {
    var campLabel = ADMIN_RENTAL_CAMP_LABELS[d.campKey] || d.campKey;
    items.push({
      productName: rental.name + '（租借）',
      quantity: d.delta,
      fromStore: '←（來自商店）' + product.name,
      toStore: campLabel,
      type: '調撥',
    });
  });

  return items;
}

function escapeSelector(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char];
  });
}

/**
 * 將 products 陣列渲染成 HTML 表格列，填入 #productsTableBody
 * @param {Array} products - products.json 的資料陣列
 */
function renderProductsTable(products) {
  var visibleProducts = prepareVisibleStoreProducts(products);

  if (!visibleProducts || visibleProducts.length === 0) {
    $('#productsTableBody').html(
      '<tr><td colspan="10" class="text-center text-muted py-4">目前沒有商品</td></tr>'
    );
    syncProductsToolbarUi('store', products || [], 0);
    updateMovementGenerateButtonState();
    if (typeof window.applyEditPermission === 'function') {
      window.applyEditPermission('products', $('#contentArea'));
    }
    return;
  }

  var html = visibleProducts
    .map(function (p) {
      return buildProductRow(p);
    })
    .join('');

  $('#productsTableBody').html(html);
  syncProductsToolbarUi('store', products || [], visibleProducts.length);
  updateMovementGenerateButtonState();

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('products', $('#contentArea'));
  }
}

// 將租借商品快取渲染到租借表格，只顯示已啟用租借的商品。
// Render rental table; only show rentals whose store product has rentalEnabled.
function renderRentalProductsTable(rentals) {
  var visibleRentals = prepareVisibleRentals(rentals);

  if (!visibleRentals || visibleRentals.length === 0) {
    $('#rentalProductsTableBody').html(
      '<tr><td colspan="12" class="text-center text-muted py-4">目前沒有租借商品</td></tr>'
    );
    syncProductsToolbarUi('rental', rentals || [], 0);
    return;
  }

  var html = visibleRentals
    .map(function (item) {
      return buildRentalRow(item);
    })
    .join('');

  $('#rentalProductsTableBody').html(html);
  syncProductsToolbarUi('rental', rentals || [], visibleRentals.length);

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('products', $('#contentArea'));
  }
}

function renderActiveProductView() {
  if (productViewState.activeView === 'rental') {
    renderRentalProductsTable(adminRentalsCache);
    return;
  }
  renderProductsTable(adminProductsCache);
}

function prepareVisibleStoreProducts(products) {
  return sortProductsForView(filterProductsForView(products || [], 'store'), 'store');
}

function prepareVisibleRentals(rentals) {
  return sortProductsForView(filterProductsForView(filterEnabledRentals(rentals || []), 'rental'), 'rental');
}

function filterProductsForView(items, view) {
  return (items || []).filter(function (item) {
    return matchesProductSearch(item, view) && matchesProductCategory(item) && matchesProductStatus(item, view) && matchesProductStock(item, view);
  });
}

function sortProductsForView(items, view) {
  var sortBy = productViewState.sortBy || 'default';
  if (sortBy === 'default') {
    return (items || []).slice();
  }

  var list = (items || []).slice();
  list.sort(function (a, b) {
    if (sortBy === 'name-asc') {
      return normalizeProductSortText(getProductDisplayName(a)).localeCompare(normalizeProductSortText(getProductDisplayName(b)), 'zh-Hant');
    }
    if (sortBy === 'price-asc' || sortBy === 'price-desc') {
      var priceA = getComparableProductPrice(a, view);
      var priceB = getComparableProductPrice(b, view);
      return sortBy === 'price-asc' ? priceA - priceB : priceB - priceA;
    }
    if (sortBy === 'stock-asc' || sortBy === 'stock-desc') {
      var stockA = getComparableProductStock(a, view);
      var stockB = getComparableProductStock(b, view);
      return sortBy === 'stock-asc' ? stockA - stockB : stockB - stockA;
    }
    if (sortBy === 'updated-desc' || sortBy === 'updated-asc') {
      var updatedA = getComparableProductUpdatedAt(a, view);
      var updatedB = getComparableProductUpdatedAt(b, view);
      return sortBy === 'updated-asc' ? updatedA - updatedB : updatedB - updatedA;
    }
    return 0;
  });

  return list;
}

function matchesProductSearch(item, view) {
  if (!productViewState.searchQuery) {
    return true;
  }

  var linkedStore = view === 'rental' ? findStoreProductByRentalId(item.id) : item;
  var haystack = [
    item.id,
    item.sku,
    item.productCode,
    item.code,
    item.name,
    item.category,
    item.spec,
    linkedStore && linkedStore.id,
    linkedStore && linkedStore.sku,
    linkedStore && linkedStore.productCode,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.indexOf(productViewState.searchQuery) !== -1;
}

function matchesProductCategory(item) {
  if (!productViewState.category) {
    return true;
  }
  return String(item.category || '').trim() === productViewState.category;
}

function matchesProductStatus(item, view) {
  if (!productViewState.status) {
    return true;
  }
  return getComparableProductStatus(item, view) === productViewState.status;
}

function matchesProductStock(item, view) {
  if (!productViewState.stock) {
    return true;
  }

  var totalStock = getComparableProductStock(item, view);
  var isLow = view === 'rental' ? isRentalProductLowStock(item) : isStoreProductLowStock(item);

  if (productViewState.stock === 'out') {
    return totalStock <= 0;
  }
  if (productViewState.stock === 'low') {
    return totalStock > 0 && isLow;
  }
  if (productViewState.stock === 'normal') {
    return totalStock > 0 && !isLow;
  }
  return true;
}

function syncProductsToolbarUi(view, items, visibleCount) {
  if (productViewState.activeView !== view) {
    return;
  }

  populateProductsCategoryFilter(items, view);
  $('#productsResultCount').text(
    view === 'rental' ? '顯示 ' + visibleCount + ' 筆租借商品' : '顯示 ' + visibleCount + ' 筆商品'
  );

  var hasFilters =
    productViewState.searchQuery !== '' ||
    productViewState.category !== '' ||
    productViewState.status !== '' ||
    productViewState.stock !== '' ||
    productViewState.sortBy !== 'default';

  $('#productsClearFilters').toggleClass('d-none', !hasFilters);
}

function populateProductsCategoryFilter(items, view) {
  var categories = (items || [])
    .map(function (item) {
      return String(item.category || '').trim();
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.localeCompare(b, 'zh-Hant');
    });

  var uniqueCategories = [];
  categories.forEach(function (category) {
    if (uniqueCategories.indexOf(category) === -1) {
      uniqueCategories.push(category);
    }
  });

  var $filter = $('#productsCategoryFilter');
  if (!$filter.length) {
    return;
  }

  var currentValue = productViewState.category;
  var options = ['<option value="">全部分類</option>'].concat(
    uniqueCategories.map(function (category) {
      return '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>';
    })
  );
  $filter.html(options.join(''));

  if (currentValue && uniqueCategories.indexOf(currentValue) === -1) {
    productViewState.category = '';
    currentValue = '';
  }

  $filter.val(currentValue);
  $('#productsStatusFilter').val(productViewState.status);
  $('#productsStockFilter').val(productViewState.stock);
  $('#productsSortSelect').val(productViewState.sortBy);
}

function getComparableProductPrice(item, view) {
  if (view === 'rental') {
    var linkedStore = findStoreProductByRentalId(item.id);
    return normalizeProductNumericValue(linkedStore && linkedStore.price);
  }
  return normalizeProductNumericValue(item.price);
}

function getComparableProductStock(item, view) {
  return view === 'rental' ? getRentalTotalStock(item) : getProductTotalStock(item);
}

function getComparableProductStatus(item, view) {
  var source = view === 'rental' ? findStoreProductByRentalId(item.id) || item : item;
  return normalizeProductStatus(source && source.status);
}

function getComparableProductUpdatedAt(item, view) {
  var source = view === 'rental' ? findStoreProductByRentalId(item.id) || item : item;
  var raw = source && (source.updatedAt || source.createdAt);
  if (!raw) {
    return 0;
  }
  var parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getProductDisplayName(item) {
  return String((item && item.name) || '').trim();
}

function normalizeProductSortText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeProductNumericValue(value) {
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProductStatus(value) {
  return String(value || 'active').trim().toLowerCase() === 'disabled' ? 'disabled' : 'active';
}

function resetProductsFilterInputs() {
  $('#productsSearchInput').val('');
  $('#productsCategoryFilter').val('');
  $('#productsStatusFilter').val('');
  $('#productsStockFilter').val('');
  $('#productsSortSelect').val('default');
  $('#productsResultCount').text(productViewState.activeView === 'rental' ? '顯示 0 筆租借商品' : '顯示 0 筆商品');
  $('#productsClearFilters').addClass('d-none');
}

function validateProductsDom() {
  var missing = PRODUCT_REQUIRED_SELECTORS.filter(function (selector) {
    return document.querySelector(selector) === null;
  });

  if (missing.length === 0) {
    return true;
  }

  $('#contentArea').html(
    '<div class="alert alert-danger d-flex align-items-center gap-2">' +
      '<i class="fas fa-exclamation-triangle"></i>' +
      '<span>商品模組載入失敗，缺少必要介面元素：' + escapeHtml(missing.join(', ')) + '</span>' +
      '</div>'
  );
  return false;
}
