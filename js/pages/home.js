// ========================================
// 首頁邏輯 (Home Page)
// 步驟 4.1 ~ 4.4
// ========================================

// ----------------------------------------
// 工具函數：計算折扣百分比
// Calculate discount percentage
// @param {number} original - 原價
// @param {number} current  - 現價
// @returns {string} e.g. "-25%"
// ----------------------------------------
function _calcDiscount(original, current) {
  if (!original || original <= current) return '';
  return `-${Math.round((1 - current / original) * 100)}%`;
}

// ----------------------------------------
// 工具函數：渲染星星評分
// Render star rating HTML
// @param {number} rating - 評分（0~5）
// @returns {string} HTML 字串
// ----------------------------------------
function _renderStars(rating) {
  const full  = Math.floor(rating);       // 整顆星數量
  const half  = rating - full >= 0.5;     // 半顆星？
  const empty = 5 - full - (half ? 1 : 0); // 空星數量

  let html = '';
  for (let i = 0; i < full; i++) html += '<i class="bi bi-star-fill star" aria-hidden="true"></i>';
  if (half) html += '<i class="bi bi-star-half star" aria-hidden="true"></i>';
  for (let i = 0; i < empty; i++) html += '<i class="bi bi-star star empty" aria-hidden="true"></i>';
  return `<span class="star-rating yr-rating-stars" aria-label="評分 ${rating.toFixed(1)} 分">${html}</span>`;
}

// ----------------------------------------
// 工具函數：產生商品卡片 HTML
// Generate product card HTML
// @param {Object} product - 商品資料
// @param {string} badgeType - 'new' | 'hot' | ''（標籤類型）
// @returns {string} HTML 字串
// ----------------------------------------
function _buildProductCard(product, badgeType = '') {
  const discount = _calcDiscount(product.originalPrice, product.price);

  // 標籤文字（依據傳入類型）
  // Badge label based on type
  let badgeHTML = '';
  if (badgeType === 'new') {
    badgeHTML = '<span class="product-card-badge badge-new">NEW</span>';
  } else if (badgeType === 'hot') {
    badgeHTML = '<span class="product-card-badge badge-hot">熱銷</span>';
  }

  // 格式化價格（加千分位）
  const priceFormatted    = product.price.toLocaleString('zh-TW');
  const origPriceFormatted = product.originalPrice
    ? product.originalPrice.toLocaleString('zh-TW')
    : null;

  return `
    <div class="product-card" data-product-id="${product.id}" role="article">

      <!-- 商品圖片 + 標籤 -->
      <div class="product-card-image-wrap">
        <img
          src="${product.image}"
          alt="${product.name}"
          loading="lazy"
          onerror="this.src='https://placehold.co/400x300/f2f2f2/999?text=圖片載入中'"
        >
        ${badgeHTML}
      </div>

      <!-- 商品資訊 -->
      <div class="product-card-body">
        <p class="product-card-brand">${product.brand}</p>
        <h3 class="product-card-name">${product.name}</h3>

        <!-- 評分 -->
        <div class="product-card-rating">
          ${_renderStars(product.rating)}
          <span>${product.rating}</span>
          <span>(${product.reviews})</span>
        </div>

        <!-- 價格：現價 + 原價刪除線 -->
        <div class="product-card-price">
          <span class="price-current">NT$ ${priceFormatted}</span>
          ${origPriceFormatted
            ? `<span class="price-original">NT$ ${origPriceFormatted}</span>`
            : ''}
        </div>
        
        <!-- 折扣百分比（獨立換行顯示） -->
        ${discount
          ? `<span class="price-discount">${discount}</span>`
          : ''}

        <!-- 加入購物車按鈕 -->
        <button
          class="product-card-add-btn"
          data-product-id="${product.id}"
        >
          加入購物車
        </button>
      </div>
    </div>
  `;
}

// ----------------------------------------
// 渲染商品列表到指定容器
// Render products into a container element
// @param {Array}       products      - 商品資料陣列
// @param {HTMLElement} container     - 目標容器 DOM
// @param {string}      badgeType     - 'new' | 'hot' | ''
// ----------------------------------------
function _renderProducts(products, container, badgeType = '') {
  if (!container) return;

  if (products.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon"><i class="bi bi-compass" aria-hidden="true"></i></span>
        <p class="empty-state-title">目前沒有商品</p>
      </div>
    `;
    return;
  }

  // 把每張卡片 HTML 拼接後一次寫入 DOM（效能優化）
  container.innerHTML = products.map(p => _buildProductCard(p, badgeType)).join('');
}

// ----------------------------------------
// 步驟 4.3：初始化商品列表（最新 + 熱銷）
// Initialize product sections (new + bestsellers)
// ----------------------------------------
async function _initProductSections() {
  const newRow        = document.getElementById('newProductsRow');
  const bestsellerRow = document.getElementById('bestsellerProductsRow');

  if (!newRow && !bestsellerRow) return;

  try {
    // 從 Mock API 取得所有商品
    // Fetch all products via Mock API
    const allProducts = await window.API.products.getAll();

    // ── 最新商品：isNew = true 的前 6 筆 ──
    const newProducts = allProducts
      .filter(p => p.isNew === true)
      .slice(0, 6);

    // ── 熱銷商品：isBestSeller = true，依評論數排序，前 6 筆 ──
    const bestsellerProducts = allProducts
      .filter(p => p.isBestSeller === true)
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 6);

    _renderProducts(newProducts, newRow, 'new');
    _renderProducts(bestsellerProducts, bestsellerRow, 'hot');

    // 綁定商品卡片點擊事件（購物車 + 詳情頁跳轉）
    _bindCardEvents();

  } catch (error) {
    console.error('商品載入失敗 | Failed to load products:', error);

    // 若載入失敗，顯示錯誤提示
    if (newRow) newRow.innerHTML = '<p class="text-muted text-center" style="padding:2rem;">商品載入失敗，請重新整理頁面</p>';
    if (bestsellerRow) bestsellerRow.innerHTML = '<p class="text-muted text-center" style="padding:2rem;">商品載入失敗，請重新整理頁面</p>';
  }
}

// ----------------------------------------
// 綁定商品卡片的點擊事件
// Bind click events on product cards
// ----------------------------------------
function _bindCardEvents() {
  // 使用事件委派（Event Delegation）：只在容器上監聽一次
  // Using event delegation: listen once on the parent

  ['newProductsRow', 'bestsellerProductsRow'].forEach(rowId => {
    const row = document.getElementById(rowId);
    if (!row) return;

    row.addEventListener('click', async (e) => {
      // ① 點擊「加入購物車」底部按鈕
      if (e.target.classList.contains('product-card-add-btn')) {
        const productId = e.target.dataset.productId;
        await _handleAddToCart(productId);
        return;
      }

      // ② 點擊卡片其他區域 → 跳轉商品詳情頁
      const card = e.target.closest('.product-card');
      if (card) {
        const productId = card.dataset.productId;
        window.location.href = `product-detail.html?id=${productId}`;
      }
    });
  });
}

// ----------------------------------------
// 處理加入購物車
// Handle add to cart action
// @param {string} productId - 商品 ID
// ----------------------------------------
async function _handleAddToCart(productId) {
  try {
    // 取得商品資料
    const product = await window.API.products.getById(productId);

    // 呼叫全局購物車功能（定義在 cart.js）
    window.addToCart({
      id:    product.id,
      name:  product.name,
      price: product.price,
      image: product.image,
      brand: product.brand,
    }, 1);

    // 購物車 Badge 動畫效果（透過 CSS class）
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
// 首頁初始化入口
// Home page init entry point
// ========================================
window.initHomePage = async () => {
  console.log('📌 首頁初始化中...');

  
  // 載入商品區塊
  await _initProductSections();

  console.log('✓ 首頁初始化完成');
};


console.log('✓ home.js 已載入');
