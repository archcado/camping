// ========================================
// 商品列表頁面邏輯 (Product List Page)
// 步驟 5.1 ~ 5.4
// ========================================

// ----------------------------------------
// 應用狀態（只在這個頁面用到）
// Page-level state
// ----------------------------------------
const _state = {
  allProducts: [], // 從 API 取得的全部商品
  filteredProducts: [], // 套用篩選後的商品
  currentPage: 1, // 當前頁碼
  pageSize: 12, // 每頁顯示幾筆

  // 篩選條件
  filters: {
    category: '', // 分類（空 = 全部）
    brands: [], // 品牌（空陣列 = 全部）
    minPrice: null, // 最低價格
    maxPrice: null, // 最高價格
    tag: '', // 快選標籤（'new' | 'bestseller' | ''）
    keyword: '', // URL keyword（?keyword=...）
  },

  sortBy: 'default', // 排序方式
};

let _adCarouselTimer = null; // 重點：輪播可因 survey-tags 更新而重算，需保留 timer 供重置。
let _adCarouselCleanup = null;
const _FILTER_COLLAPSE_STORAGE_KEY = 'yr-products-filter-collapsed';

// ----------------------------------------
// 工具：計算折扣百分比
// ----------------------------------------
function _calcDiscount(original, current) {
  if (!original || original <= current) return '';
  return `-${Math.round((1 - current / original) * 100)}%`;
}

// ----------------------------------------
// 工具：渲染星星
// ----------------------------------------
function _renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  let html = '';
  for (let i = 0; i < full; i++) html += '<i class="bi bi-star-fill star" aria-hidden="true"></i>';
  if (half) html += '<i class="bi bi-star-half star" aria-hidden="true"></i>';
  for (let i = 0; i < empty; i++) html += '<i class="bi bi-star star empty" aria-hidden="true"></i>';
  return `<span class="star-rating yr-rating-stars" aria-label="評分 ${rating.toFixed(1)} 分">${html}</span>`;
}

/**
 * Normalize survey preference storage from AppState or profile localStorage.
 * @param {Array|string|Object} preferences - Survey preferences saved by the shared header modal
 * @returns {string[]} Flat survey-tag values
 */
function _normalizeSurveyTagValues(preferences) {
  if (Array.isArray(preferences)) return preferences;
  if (typeof preferences === 'string' && preferences) return [preferences];
  if (!preferences || typeof preferences !== 'object') return [];

  // 重點：header 問卷用 styles / equipment 分開存，member-center 與商品推薦使用同一份攤平後的 survey-tags。
  return [...(preferences.styles || []), ...(preferences.equipment || [])];
}

/**
 * Read JSON from localStorage without breaking carousel rendering on corrupt values.
 * @param {string} key - localStorage key
 * @param {*} fallback - Value used when parsing fails
 * @returns {*}
 */
function _readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`讀取 ${key} 偏好失敗，改用預設推薦`, error);
    return fallback;
  }
}

/**
 * Get the same survey-tag values that pages/member-center.html displays as active.
 * @returns {string[]} Saved survey-tag values
 */
function _getSavedSurveyTags() {
  const appPrefs = _normalizeSurveyTagValues(window.AppState && window.AppState.preferences);
  if (appPrefs.length > 0) return appPrefs;

  const profilePrefs = _normalizeSurveyTagValues(_readStorageJson('yurui_profile', {}).preferences);
  if (profilePrefs.length > 0) return profilePrefs;

  return _normalizeSurveyTagValues(_readStorageJson('preferences', {}));
}

/**
 * Randomize carousel products so matching interest_tags do not always show in JSON order.
 * @param {Array} products - Products selected for the ad carousel
 * @returns {Array} Shuffled products
 */
function _shuffleProducts(products) {
  const shuffled = [...products];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Select ad-carousel products by matching saved survey-tags with products.interest_tags.
 * @returns {Array} Personalized products, or NEW products when no preference match exists
 */
function _selectAdCarouselProducts() {
  const selectedTags = new Set(_getSavedSurveyTags());

  // 重點：products.json 的 interest_tags 直接對應 header.partial / member-center 的 survey-tag data-value。
  const matchedProducts =
    selectedTags.size === 0
      ? []
      : _state.allProducts.filter((product) => {
          const interestTags = Array.isArray(product.interest_tags) ? product.interest_tags : [];
          return interestTags.some((tag) => selectedTags.has(tag));
        });

  // 重點：沒有使用者偏好或沒有符合 interest_tags 時，維持原本 NEW 商品輪播作為備援。
  const fallbackProducts = _state.allProducts.filter((product) => product.isNew);
  return _shuffleProducts(matchedProducts.length > 0 ? matchedProducts : fallbackProducts);
}

// ----------------------------------------
// 工具：建立商品卡片 HTML
// Build product card HTML
// ----------------------------------------
function _buildCard(product) {
  const discount = _calcDiscount(product.originalPrice, product.price);

  let badgeHTML = '';
  if (product.isNew) badgeHTML = '<span class="product-card-badge badge-new">新品選物</span>';
  else if (product.isBestSeller) badgeHTML = '<span class="product-card-badge badge-hot">熱銷</span>';

  const priceFormatted = product.price.toLocaleString('zh-TW');
  const origPriceFormatted = product.originalPrice ? product.originalPrice.toLocaleString('zh-TW') : null;

  return `
    <div class="product-card" data-product-id="${product.id}" role="article">
      <div class="product-card-image-wrap">
        <img
          src="${product.image}"
          alt="${product.brand} ${product.name}"
          loading="lazy"
          onerror="this.onerror=null; this.src='../assets/images/products/prod-001/main.webp'"
        >
        ${badgeHTML}
      </div>
      <div class="product-card-body">
        <p class="product-card-brand">${product.brand}</p>
        <h3 class="product-card-name">${product.name}</h3>
        <div class="product-card-rating">
          ${_renderStars(product.rating)}
          <span>${product.rating}</span>
          <span>(${product.reviews})</span>
        </div>
        <div class="product-card-price">
          <span class="price-current">NT$ ${priceFormatted}</span>
          ${origPriceFormatted ? `<span class="price-original">NT$ ${origPriceFormatted}</span>` : ''}
        </div>
        ${discount ? `<span class="price-discount">${discount}</span>` : ''}
        <button class="product-card-add-btn" data-product-id="${product.id}">
          加入購物車
        </button>
      </div>
    </div>
  `;
}

// ----------------------------------------
// 渲染商品網格（含空狀態）
// Render products grid
// ----------------------------------------
function _renderGrid() {
  const grid = document.getElementById('productsGrid');
  const countEl = document.getElementById('productCount');
  if (!grid) return;

  // 計算當前頁的商品
  const start = (_state.currentPage - 1) * _state.pageSize;
  const end = start + _state.pageSize;
  const paginated = _state.filteredProducts.slice(start, end);

  // 更新商品數量顯示
  if (countEl) {
    countEl.textContent = `共 ${_state.filteredProducts.length} 件商品`;
  }

  // 沒有商品 → 顯示空狀態
  if (_state.filteredProducts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <span class="empty-state-icon"><i class="bi bi-search" aria-hidden="true"></i></span>
        <p class="empty-state-title">沒有符合條件的商品</p>
        <p class="empty-state-desc">試著調整篩選條件看看</p>
        <button class="btn btn-outline" style="margin-top:1rem;" onclick="_resetAllFilters()">
          清除篩選
        </button>
      </div>
    `;
    _renderPagination();
    return;
  }

  grid.innerHTML = paginated.map((p) => _buildCard(p)).join('');
  _renderPagination();
  _bindCardEvents();
}

// ----------------------------------------
// 渲染分頁控制列
// Render pagination buttons
// ----------------------------------------
function _renderPagination() {
  const paginationEl = document.getElementById('pagination');
  if (!paginationEl) return;

  const totalPages = Math.ceil(_state.filteredProducts.length / _state.pageSize);

  // 商品數不超過一頁就不顯示分頁
  if (totalPages <= 1) {
    paginationEl.style.display = 'none';
    return;
  }

  paginationEl.style.display = 'flex';

  let html = '';

  // 上一頁按鈕
  html += `<button
    class="pagination-btn"
    ${_state.currentPage === 1 ? 'disabled' : ''}
    data-page="${_state.currentPage - 1}"
    aria-label="上一頁"
  ><i class="bi bi-chevron-left" aria-hidden="true"></i></button>`;

  // 頁碼按鈕（最多顯示 5 頁）
  const range = 2;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= _state.currentPage - range && i <= _state.currentPage + range)) {
      html += `<button
        class="pagination-btn${i === _state.currentPage ? ' active' : ''}"
        data-page="${i}"
        aria-label="第 ${i} 頁"
        ${i === _state.currentPage ? 'aria-current="page"' : ''}
      >${i}</button>`;
    } else if (i === _state.currentPage - range - 1 || i === _state.currentPage + range + 1) {
      html += `<span style="padding:0 0.25rem; color:#999;">…</span>`;
    }
  }

  // 下一頁按鈕
  html += `<button
    class="pagination-btn"
    ${_state.currentPage === totalPages ? 'disabled' : ''}
    data-page="${_state.currentPage + 1}"
    aria-label="下一頁"
  ><i class="bi bi-chevron-right" aria-hidden="true"></i></button>`;

  paginationEl.innerHTML = html;

  // 綁定頁碼點擊
  paginationEl.querySelectorAll('.pagination-btn:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page, 10);
      _goToPage(page);
    });
  });
}

// ----------------------------------------
// 跳轉至指定頁
// ----------------------------------------
function _goToPage(page) {
  const totalPages = Math.ceil(_state.filteredProducts.length / _state.pageSize);
  if (page < 1 || page > totalPages) return;
  _state.currentPage = page;
  _renderGrid();
  // 捲回頂部
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function _getAppliedFilterCount() {
  const filters = _state.filters || {};
  let count = 0;

  if (typeof filters.category === 'string' && filters.category.trim() !== '') {
    count += 1;
  }

  if (Array.isArray(filters.brands)) {
    count += filters.brands.length;
  }

  if (
    (filters.minPrice !== null && filters.minPrice !== undefined) ||
    (filters.maxPrice !== null && filters.maxPrice !== undefined)
  ) {
    count += 1;
  }

  if (typeof filters.tag === 'string' && filters.tag.trim() !== '') {
    count += 1;
  }

  if (typeof filters.keyword === 'string' && filters.keyword.trim() !== '') {
    count += 1;
  }

  return count;
}

function _updateFilterHeaderState() {
  const resetButton = document.getElementById('resetFiltersBtn');
  const summary = document.getElementById('productFilterSummary');
  const appliedCount = _getAppliedFilterCount();

  if (resetButton) {
    resetButton.disabled = appliedCount === 0;
  }

  if (summary) {
    summary.textContent = appliedCount === 0 ? '尚未選擇條件' : `已選 ${appliedCount} 項條件`;
  }
}

function _readFilterCollapseState() {
  try {
    return window.sessionStorage.getItem(_FILTER_COLLAPSE_STORAGE_KEY);
  } catch (error) {
    console.warn('讀取篩選面板收合狀態失敗，改用預設展開', error);
    return null;
  }
}

function _writeFilterCollapseState(isCollapsed) {
  try {
    window.sessionStorage.setItem(_FILTER_COLLAPSE_STORAGE_KEY, String(isCollapsed));
  } catch (error) {
    console.warn('儲存篩選面板收合狀態失敗，重新整理後將回到預設展開', error);
  }
}

function _setDesktopFilterCollapsed(isCollapsed, options = {}) {
  const { persist = true } = options;
  const panel = document.getElementById('filterSidebar');
  const panelBody = document.getElementById('productFilterPanelBody');
  const toggleButton = document.getElementById('productFilterToggle');
  if (!panel || !panelBody || !toggleButton) return;

  const label = toggleButton.querySelector('.yr-product-filter-toggle-label');
  const icon = toggleButton.querySelector('i');

  panelBody.hidden = isCollapsed;
  panel.classList.toggle('is-collapsed', isCollapsed);
  toggleButton.setAttribute('aria-expanded', String(!isCollapsed));

  if (label) {
    label.textContent = isCollapsed ? '展開篩選' : '收合篩選';
  }

  if (icon) {
    icon.classList.toggle('bi-chevron-up', !isCollapsed);
    icon.classList.toggle('bi-chevron-down', isCollapsed);
  }

  if (persist) {
    _writeFilterCollapseState(isCollapsed);
  }
}

function _initDesktopFilterCollapse() {
  const toggleButton = document.getElementById('productFilterToggle');
  const panelBody = document.getElementById('productFilterPanelBody');
  if (!toggleButton || !panelBody) return;

  const storedState = _readFilterCollapseState();
  _setDesktopFilterCollapsed(storedState === 'true', { persist: false });

  toggleButton.addEventListener('click', () => {
    _setDesktopFilterCollapsed(!panelBody.hidden);
  });
}

// ----------------------------------------
// 套用所有篩選條件，更新 filteredProducts
// Apply all current filters to allProducts
// ----------------------------------------
function _applyFilters() {
  let result = [..._state.allProducts];
  const f = _state.filters;

  // ① URL keyword 篩選（名稱 / 品牌 / 分類 / 標籤）
  const keyword = (f.keyword || '').trim().toLowerCase();
  if (keyword) {
    result = result.filter((p) => {
      const searchable = [
        p.name,
        p.brand,
        p.category,
        ...(Array.isArray(p.tags) ? p.tags : []),
        ...(Array.isArray(p.keywords) ? p.keywords : []),
        ...(Array.isArray(p.interest_tags) ? p.interest_tags : []),
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(keyword);
    });
  }

  // ② 分類篩選
  if (f.category) {
    result = result.filter((p) => p.category === f.category);
  }

  // ③ 品牌篩選（多選）
  if (f.brands.length > 0) {
    result = result.filter((p) => f.brands.includes(p.brand));
  }

  // ④ 價格範圍
  if (f.minPrice !== null) {
    result = result.filter((p) => p.price >= f.minPrice);
  }
  if (f.maxPrice !== null) {
    result = result.filter((p) => p.price <= f.maxPrice);
  }

  // ⑤ 快選標籤
  if (f.tag === 'new') {
    result = result.filter((p) => p.isNew === true);
  } else if (f.tag === 'bestseller') {
    result = result.filter((p) => p.isBestSeller === true);
  }

  // ⑥ 排序
  switch (_state.sortBy) {
    case 'price-asc':
      result.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      result.sort((a, b) => b.price - a.price);
      break;
    case 'rating':
      result.sort((a, b) => b.rating - a.rating);
      break;
    case 'reviews':
      result.sort((a, b) => b.reviews - a.reviews);
      break;
    default:
      break;
  }

  _state.filteredProducts = result;
  _state.currentPage = 1; // 篩選後從第一頁開始
  _updateFilterHeaderState();
  _renderGrid();
}

// ----------------------------------------
// 重置全部篩選
// ----------------------------------------
window._resetAllFilters = function () {
  _state.filters = { category: '', brands: [], minPrice: null, maxPrice: null, tag: '', keyword: '' };

  // 重置 UI
  document.querySelectorAll('.filter-category-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.category === '');
  });
  document.querySelectorAll('.filter-brand-list input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });

  const priceMinEls = document.querySelectorAll('#priceMin, #mobilePriceMin');
  const priceMaxEls = document.querySelectorAll('#priceMax, #mobilePriceMax');
  priceMinEls.forEach((el) => {
    if (el) el.value = '';
  });
  priceMaxEls.forEach((el) => {
    if (el) el.value = '';
  });

  // 快選標籤
  document.querySelectorAll('[data-tag]').forEach((b) => b.classList.remove('active'));

  _applyFilters();
};

// ----------------------------------------
// 步驟 5.1：初始化 PC 版篩選器
// Initialize desktop sidebar filters
// ----------------------------------------
function _initSidebarFilters() {
  // 從所有商品取得不重複的分類和品牌
  const categories = ['全部', ...new Set(_state.allProducts.map((p) => p.category))];
  const brands = [...new Set(_state.allProducts.map((p) => p.brand))].sort();

  // 渲染分類按鈕（Desktop + Mobile）
  ['categoryFilterList', 'mobileCategoryFilterList'].forEach((listId) => {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = categories
      .map((cat) => {
        const value = cat === '全部' ? '' : cat;
        return `<li><button class="filter-category-btn${value === '' ? ' active' : ''}" data-category="${value}">${cat}</button></li>`;
      })
      .join('');

    // 點擊事件
    list.querySelectorAll('.filter-category-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        list.querySelectorAll('.filter-category-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        _state.filters.category = btn.dataset.category;

        // 同步兩個篩選器的選中狀態
        _syncCategoryFilters(btn.dataset.category);

        if (listId === 'categoryFilterList') {
          _applyFilters();
        }
      });
    });
  });

  // 渲染品牌 Checkbox（Desktop + Mobile）
  ['brandFilterList', 'mobileBrandFilterList'].forEach((listId) => {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = brands
      .map(
        (brand) => `
      <li class="filter-brand-item">
        <input
          type="checkbox"
          id="${listId}-${brand}"
          name="brand"
          value="${brand}"
          aria-label="${brand}"
        >
        <label for="${listId}-${brand}">${brand}</label>
      </li>
    `
      )
      .join('');

    // PC 版品牌 Checkbox 直接觸發篩選
    if (listId === 'brandFilterList') {
      list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          _state.filters.brands = Array.from(document.querySelectorAll('#brandFilterList input:checked')).map(
            (el) => el.value
          );
          _applyFilters();
        });
      });
    }
  });

  // PC 版：套用價格
  const applyPriceBtn = document.getElementById('applyPriceBtn');
  if (applyPriceBtn) {
    applyPriceBtn.addEventListener('click', () => {
      const minVal = parseFloat(document.getElementById('priceMin').value);
      const maxVal = parseFloat(document.getElementById('priceMax').value);
      _state.filters.minPrice = isNaN(minVal) ? null : minVal;
      _state.filters.maxPrice = isNaN(maxVal) ? null : maxVal;
      _applyFilters();
    });
  }

  // PC 版：重置按鈕
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', window._resetAllFilters);
  }

  // 快選標籤（最新/熱銷）
  const filterNewBtn = document.getElementById('filterNewBtn');
  const filterBestBtn = document.getElementById('filterBestBtn');

  if (filterNewBtn) {
    filterNewBtn.addEventListener('click', () => {
      const isActive = filterNewBtn.classList.toggle('active');
      _state.filters.tag = isActive ? 'new' : '';
      if (filterBestBtn) filterBestBtn.classList.remove('active');
      _applyFilters();
    });
  }

  if (filterBestBtn) {
    filterBestBtn.addEventListener('click', () => {
      const isActive = filterBestBtn.classList.toggle('active');
      _state.filters.tag = isActive ? 'bestseller' : '';
      if (filterNewBtn) filterNewBtn.classList.remove('active');
      _applyFilters();
    });
  }
}

// ----------------------------------------
// 同步兩個篩選器的分類選中狀態
// Sync category selection between desktop and mobile
// ----------------------------------------
function _syncCategoryFilters(category) {
  ['categoryFilterList', 'mobileCategoryFilterList'].forEach((listId) => {
    const list = document.getElementById(listId);
    if (!list) return;
    list.querySelectorAll('.filter-category-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.category === category);
    });
  });
}

// ----------------------------------------
// 步驟 5.3：初始化手機版 Bottom Sheet
// Initialize mobile filter sheet
// ----------------------------------------
function _initMobileFilterSheet() {
  const openBtn = document.getElementById('mobileFilterBtn');
  const sheet = document.getElementById('filterSheet');
  const closeBtn = document.getElementById('filterSheetClose');
  const backdrop = document.getElementById('filterSheetBackdrop');
  const applyBtn = document.getElementById('mobileApplyBtn');
  const resetBtn = document.getElementById('mobileResetBtn');

  if (!openBtn || !sheet) return;

  // 開啟 Sheet
  function openSheet() {
    sheet.classList.add('active');
    if (backdrop) backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // 關閉 Sheet
  function closeSheet() {
    sheet.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
  }

  openBtn.addEventListener('click', openSheet);
  if (closeBtn) closeBtn.addEventListener('click', closeSheet);
  if (backdrop) backdrop.addEventListener('click', closeSheet);

  // 套用篩選
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      // 讀取手機篩選表單的值
      _state.filters.brands = Array.from(
        document.querySelectorAll('#mobileBrandFilterList input:checked')
      ).map((el) => el.value);

      const mobileMin = parseFloat(document.getElementById('mobilePriceMin')?.value);
      const mobileMax = parseFloat(document.getElementById('mobilePriceMax')?.value);
      _state.filters.minPrice = isNaN(mobileMin) ? null : mobileMin;
      _state.filters.maxPrice = isNaN(mobileMax) ? null : mobileMax;

      closeSheet();
      _applyFilters();
    });
  }

  // 重置
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      window._resetAllFilters();
      closeSheet();
    });
  }
}

// ----------------------------------------
// 初始化排序下拉
// Initialize sort dropdown
// ----------------------------------------
function _initSortSelect() {
  const select = document.getElementById('sortSelect');
  if (!select) return;

  select.addEventListener('change', () => {
    _state.sortBy = select.value;
    _applyFilters();
  });
}

// ----------------------------------------
// 處理從 URL 參數帶入的快選篩選
// Handle URL query params (e.g. ?filter=new)
// ----------------------------------------
function _handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get('filter');
  const rawKeyword = params.get('keyword');

  let keyword = '';
  if (typeof rawKeyword === 'string') {
    try {
      keyword = decodeURIComponent(rawKeyword);
    } catch (error) {
      keyword = rawKeyword;
    }
    keyword = keyword.trim();
  }

  if (keyword) {
    _state.filters.keyword = keyword;
  }

  if (filter === 'new') {
    _state.filters.tag = 'new';
    const btn = document.getElementById('filterNewBtn');
    if (btn) btn.classList.add('active');
  } else if (filter === 'bestseller') {
    _state.filters.tag = 'bestseller';
    const btn = document.getElementById('filterBestBtn');
    if (btn) btn.classList.add('active');
  }
}

// ----------------------------------------
// 綁定商品卡片點擊事件
// Bind click events on product cards
// ----------------------------------------
function _bindCardEvents() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  // 移除舊的監聽器再加新的，避免重複綁定
  const newGrid = grid.cloneNode(true);
  grid.parentNode.replaceChild(newGrid, grid);

  newGrid.addEventListener('click', async (e) => {
    // ① 底部「加入購物車」按鈕
    if (e.target.classList.contains('product-card-add-btn')) {
      e.stopPropagation();
      await _handleAddToCart(e.target.dataset.productId);
      return;
    }

    // ② 點卡片其他區域 → 跳轉詳情頁
    const card = e.target.closest('.product-card');
    if (card) {
      window.location.href = `product-detail.html?id=${card.dataset.productId}`;
    }
  });
}

// ----------------------------------------
// 處理加入購物車
// ----------------------------------------
async function _handleAddToCart(productId) {
  try {
    const product = _state.allProducts.find((p) => p.id === productId);
    if (!product) return;

    window.addToCart(
      {
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        brand: product.brand,
      },
      1
    );

    // Badge 動畫
    const badge = document.querySelector('.cart-badge');
    if (badge) {
      badge.classList.add('badge-bounce');
      setTimeout(() => badge.classList.remove('badge-bounce'), 600);
    }
  } catch (error) {
    console.error('加入購物車失敗:', error);
    window.showToast('加入失敗，請稍後再試', 'error');
  }
}

// ========================================
// 廣告輪播初始化（依 survey-tags 對應 interest_tags）
// ========================================
function _initAdCarousel() {
  const slidesContainer = document.getElementById('adCarouselSlides');
  const dotsContainer = document.getElementById('adCarouselDots');
  const prevBtn = document.getElementById('adCarouselPrev');
  const nextBtn = document.getElementById('adCarouselNext');
  const carouselRoot = document.querySelector('.ad-carousel');

  if (!slidesContainer || !dotsContainer) return;

  if (typeof _adCarouselCleanup === 'function') {
    _adCarouselCleanup();
    _adCarouselCleanup = null;
  }
  if (_adCarouselTimer) {
    clearInterval(_adCarouselTimer);
    _adCarouselTimer = null;
  }

  const adProducts = _selectAdCarouselProducts();
  const container = document.querySelector('.ad-carousel-container');
  if (!adProducts || adProducts.length === 0) {
    // 重點：偏好與 NEW 商品都沒有資料時才隱藏廣告輪播容器。
    if (container) container.style.display = 'none';
    slidesContainer.innerHTML = '';
    dotsContainer.innerHTML = '';
    if (prevBtn) prevBtn.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
    dotsContainer.hidden = true;
    return;
  }
  if (container) container.style.display = '';

  const realSlideCount = adProducts.length;
  const isLooping = realSlideCount > 1;
  const renderedProducts = isLooping
    ? [adProducts[realSlideCount - 1], ...adProducts, adProducts[0]]
    : adProducts;
  let renderedIndex = isLooping ? 1 : 0;
  let isTransitionResetting = false;

  // 生成 slides 和 dots
  slidesContainer.innerHTML = renderedProducts
    .map(
      (product) => `
    <div class="ad-carousel-slide" data-product-id="${product.id}">
      <div class="ad-carousel-content">
        <span class="ad-carousel-badge">${product.isNew ? '<i class="bi bi-stars" aria-hidden="true"></i> 新品選物' : '推薦選物'}</span>
        <h3 class="ad-carousel-title">${product.name}</h3>
        <p class="ad-carousel-desc">${product.brand}</p>
        <p class="ad-carousel-price">NT$ ${product.price.toLocaleString('zh-TW')}</p>
      </div>
      <div class="ad-carousel-media">
        <img src="${product.image}" alt="${product.name}" class="ad-carousel-image" loading="lazy" onerror="this.src='https://placehold.co/200x200/f2f2f2/999?text=Image'">
      </div>
    </div>
  `
    )
    .join('');

  dotsContainer.innerHTML = adProducts
    .map(
      (_, idx) =>
        `<button class="ad-carousel-dot ${idx === 0 ? 'active' : ''}" data-slide="${idx}" title="第 ${idx + 1} 個廣告"></button>`
    )
    .join('');

  if (prevBtn) prevBtn.hidden = !isLooping;
  if (nextBtn) nextBtn.hidden = !isLooping;
  dotsContainer.hidden = !isLooping;

  const dotElements = Array.from(dotsContainer.querySelectorAll('.ad-carousel-dot'));
  const getRealIndex = () => {
    if (!isLooping) return 0;
    return (renderedIndex - 1 + realSlideCount) % realSlideCount;
  };
  const syncDots = () => {
    const realIndex = getRealIndex();
    dotElements.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === realIndex);
    });
  };
  const moveToRenderedIndex = (nextRenderedIndex, animate = true) => {
    renderedIndex = nextRenderedIndex;
    if (!animate) {
      slidesContainer.style.transition = 'none';
    }
    slidesContainer.style.transform = `translateX(${-renderedIndex * 100}%)`;
    syncDots();
    if (!animate) {
      void slidesContainer.offsetHeight;
      slidesContainer.style.transition = '';
    }
  };
  const nextSlide = () => {
    if (!isLooping || isTransitionResetting) return;
    moveToRenderedIndex(renderedIndex + 1, true);
  };
  const previousSlide = () => {
    if (!isLooping || isTransitionResetting) return;
    moveToRenderedIndex(renderedIndex - 1, true);
  };
  const startAutoplay = () => {
    if (!isLooping) return;
    if (_adCarouselTimer) clearInterval(_adCarouselTimer);
    _adCarouselTimer = setInterval(() => {
      nextSlide();
    }, 5000);
  };
  const stopAutoplay = () => {
    if (_adCarouselTimer) {
      clearInterval(_adCarouselTimer);
      _adCarouselTimer = null;
    }
  };
  const handleTransitionEnd = () => {
    if (!isLooping || isTransitionResetting) return;
    if (renderedIndex === 0) {
      isTransitionResetting = true;
      moveToRenderedIndex(realSlideCount, false);
      isTransitionResetting = false;
      return;
    }
    if (renderedIndex === realSlideCount + 1) {
      isTransitionResetting = true;
      moveToRenderedIndex(1, false);
      isTransitionResetting = false;
    }
  };
  const handlePrevClick = () => previousSlide();
  const handleNextClick = () => nextSlide();
  const handleDotClick = (event) => {
    const dot = event.target.closest('.ad-carousel-dot');
    if (!dot || !isLooping) return;
    const targetRealIndex = parseInt(dot.dataset.slide, 10);
    if (!Number.isFinite(targetRealIndex)) return;
    moveToRenderedIndex(targetRealIndex + 1, true);
  };
  const handleSlideClick = (event) => {
    const slide = event.target.closest('.ad-carousel-slide');
    if (slide) {
      window.location.href = `product-detail.html?id=${slide.dataset.productId}`;
    }
  };
  const handleMouseEnter = () => stopAutoplay();
  const handleMouseLeave = () => startAutoplay();
  const handleVisibilityChange = () => {
    if (document.hidden) stopAutoplay();
    else startAutoplay();
  };
  const handleResize = () => {
    moveToRenderedIndex(renderedIndex, false);
  };

  if (prevBtn) prevBtn.addEventListener('click', handlePrevClick);
  if (nextBtn) nextBtn.addEventListener('click', handleNextClick);
  dotsContainer.addEventListener('click', handleDotClick);
  slidesContainer.addEventListener('click', handleSlideClick);
  slidesContainer.addEventListener('transitionend', handleTransitionEnd);
  if (carouselRoot) {
    carouselRoot.addEventListener('mouseenter', handleMouseEnter);
    carouselRoot.addEventListener('mouseleave', handleMouseLeave);
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('resize', handleResize);

  moveToRenderedIndex(renderedIndex, false);
  startAutoplay();

  _adCarouselCleanup = () => {
    stopAutoplay();
    if (prevBtn) prevBtn.removeEventListener('click', handlePrevClick);
    if (nextBtn) nextBtn.removeEventListener('click', handleNextClick);
    dotsContainer.removeEventListener('click', handleDotClick);
    slidesContainer.removeEventListener('click', handleSlideClick);
    slidesContainer.removeEventListener('transitionend', handleTransitionEnd);
    if (carouselRoot) {
      carouselRoot.removeEventListener('mouseenter', handleMouseEnter);
      carouselRoot.removeEventListener('mouseleave', handleMouseLeave);
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('resize', handleResize);
  };
}

/**
 * Rebuild the ad carousel when the shared header survey updates preferences.
 */
function _initAdCarouselPreferenceListener() {
  if (window.__productInterestCarouselBound) return;
  window.__productInterestCarouselBound = true;

  // 重點：使用者在商品頁完成問卷時，立即用新的 survey-tags 重算 interest_tags 輪播。
  window.addEventListener('yurui:preferences-updated', () => {
    _initAdCarousel();
  });
}

// ========================================
// 商品列表頁初始化入口
// Product list page init entry point
// ========================================
window.initProductListPage = async () => {
  console.log('📌 商品列表頁初始化中...');

  try {
    // ① 從 Mock API 取得所有商品
    _state.allProducts = await window.API.products.getAll();

    // ② 處理 URL 參數（如 ?filter=new）
    _handleUrlParams();

    // ③ 初始化各種篩選 UI
    _initSidebarFilters();
    _initDesktopFilterCollapse();
    _initMobileFilterSheet();
    _initSortSelect();

    // ④ 套用初始篩選（可能來自 URL 參數）並渲染
    _applyFilters();

    // ⑤ 初始化廣告輪播（優先抓取符合 survey-tags / interest_tags 的商品）
    _initAdCarousel();
    _initAdCarouselPreferenceListener();

    console.log(`✓ 商品列表載入完成，共 ${_state.allProducts.length} 件商品`);
  } catch (error) {
    console.error('商品列表載入失敗:', error);
    const grid = document.getElementById('productsGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <span class="empty-state-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></span>
          <p class="empty-state-title">商品載入失敗</p>
          <p class="empty-state-desc">請重新整理頁面，或稍後再試</p>
        </div>
      `;
    }
  }
};

// 等 DOM 完成後自動執行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initProductListPage);
} else {
  window.initProductListPage();
}

console.log('✓ product-list.js 已載入');
