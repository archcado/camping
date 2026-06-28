// ========================================
// 商品詳情頁邏輯 Product Detail Page Logic
// ========================================
// 此檔案負責：
// 1. 從 URL 讀取商品 ID 並呼叫 API 取得資料
// 2. 渲染圖片 Gallery（主圖 + 縮圖）
// 3. 渲染品牌、商品名、評分、價格
// 4. 渲染規格選擇按鈕（顏色/尺寸）
// 5. 數量 Stepper 控制
// 6. 免運進度條計算
// 7. 加入購物車 / 直接購買
// 8. Tab 頁籤切換（商品介紹 / 評價）

/**
 * 初始化商品詳情頁
 * Initialize product detail page
 * 這是頁面的主入口函數，會在 DOMContentLoaded 後呼叫
 */
window.initProductDetailPage = async () => {
  console.log('商品詳情頁初始化...');

  // -----------------------------------------------
  // Step 1: 從 URL 讀取商品 ID
  // Read product ID from URL query string
  // 例：product-detail.html?id=prod-001 → id = 'prod-001'
  // -----------------------------------------------
  const params = new URLSearchParams(window.location.search);
  let productId = params.get('id');

  // 若沒有傳入 id，就預設顯示 prod-001
  // If no id in URL, fall back to prod-001
  if (!productId) {
    productId = 'prod-001';
  }

  console.log(`正在載入商品 ID: ${productId}`);

  // 顯示載入中狀態 / Show loading state
  document.getElementById('productLoading').style.display = 'block';
  document.getElementById('productError').style.display = 'none';
  document.getElementById('productDetailContent').style.display = 'none';

  try {
    // -----------------------------------------------
    // Step 2: 呼叫 API 取得商品資料
    // Call API to get product data
    // -----------------------------------------------
    const product = await window.API.products.getById(productId);
    console.log('商品資料取得成功:', product);

    // 隱藏載入中，顯示商品內容
    // Hide loading, show content
    document.getElementById('productLoading').style.display = 'none';
    document.getElementById('productDetailContent').style.display = 'block';

    // -----------------------------------------------
    // Step 3: 渲染所有商品資訊
    // Render all product information
    // -----------------------------------------------
    renderProductInfo(product);
    renderGallery(product);
    renderColorOptions(product);
    renderSizeOptions(product);
    renderSpecTable(product);
    renderShippingProgress();
    initShippingProgressSync();
    initQtyStepper();
    initActionButtons(product);
    initTabSwitching();

    // 更新麵包屑導覽
    // Update breadcrumb navigation
    const breadcrumb = document.getElementById('breadcrumbProductName');
    if (breadcrumb) {
      breadcrumb.textContent = product.name;
    }

    // 更新頁面標題
    document.title = `${product.name} - Yuruicamp 露營選物`;

  } catch (error) {
    // 發生錯誤：顯示錯誤狀態
    // Error occurred: show error state
    console.error('商品載入失敗:', error);
    document.getElementById('productLoading').style.display = 'none';
    document.getElementById('productError').style.display = 'block';
  }

  // 共用 header/modal/cart 必須等 main.js 注入 header partial 後再綁定事件。
  // Let main.js initialize shared header/modal/cart after their partial markup exists.
};

// -----------------------------------------------
// 渲染商品基本資訊（品牌、名稱、評分、價格）
// Render basic product info: brand, name, rating, price
// -----------------------------------------------
function renderProductInfo(product) {
  // 品牌名稱 Brand name
  const brandEl = document.getElementById('productBrand');
  if (brandEl) brandEl.textContent = product.brand || '';

  // 商品名稱 Product name
  const nameEl = document.getElementById('productName');
  if (nameEl) nameEl.textContent = product.name || '';

  // 評分星星（根據 review-card 的星數平均）
  // Rating stars (average of review-card star values)
  const reviewRatings = getReviewCardRatings();
  const averageRating = reviewRatings.length
    ? reviewRatings.reduce((sum, value) => sum + value, 0) / reviewRatings.length
    : null;
  const rating = averageRating !== null ? averageRating : product.rating || 0;
  const reviewCount = reviewRatings.length || product.reviews || 0;

  const starsEl = document.getElementById('productStars');
  if (starsEl) {
    starsEl.innerHTML = renderStars(rating);
    starsEl.setAttribute('data-rating', rating.toFixed(2));
    // 設定 CSS 變數以支援進度條背景
    const ratingPercent = (rating / 5) * 100;
    starsEl.style.setProperty('--rating-percent', `${ratingPercent}%`);
  }
  const ratingNumEl = document.getElementById('productRatingNum');
  if (ratingNumEl) ratingNumEl.textContent = rating.toFixed(1);
  const reviewCountEl = document.getElementById('productReviewCount');
  if (reviewCountEl) reviewCountEl.textContent = `（${reviewCount} 則評價）`;

  // 現價 Current price
  const priceEl = document.getElementById('productPrice');
  if (priceEl) priceEl.textContent = window.formatCurrency(product.price);

  // 原價 Original price（若與現價相同則隱藏）
  const origPriceEl = document.getElementById('productOriginalPrice');
  if (origPriceEl) {
    if (product.originalPrice && product.originalPrice > product.price) {
      origPriceEl.textContent = window.formatCurrency(product.originalPrice);
      origPriceEl.style.display = '';
    } else {
      origPriceEl.style.display = 'none';
    }
  }

  // 折扣百分比 Discount percentage
  const discountEl = document.getElementById('productDiscount');
  if (discountEl) {
    if (product.originalPrice && product.originalPrice > product.price) {
      // 計算折扣：Math.round((1 - 現價/原價) * 100)
      const discountPct = Math.round((1 - product.price / product.originalPrice) * 100);
      discountEl.textContent = `-${discountPct}%`;
      discountEl.style.display = '';
    } else {
      discountEl.style.display = 'none';
    }
  }

  // 商品描述 Product description
  const descEl = document.getElementById('productDescription');
  if (descEl) descEl.textContent = product.description || '';

  // 商品標籤 Tags（用小 badge 顯示）
  const tagsEl = document.getElementById('productTags');
  if (tagsEl && product.tags && product.tags.length > 0) {
    tagsEl.innerHTML = product.tags
      .map(tag => `<span style="background:#e8f5e9;color:#2e7d32;font-size:0.8rem;padding:0.25rem 0.6rem;border-radius:99px;font-weight:600;">#${tag}</span>`)
      .join('');
  }
}

/**
 * 把數字評分轉成星星 icon HTML
 * Convert numeric rating to star icon HTML
 * @param {number} rating - 評分（0~5）
 * @returns {string}
 */
function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  let html = '';
  for (let i = 0; i < full; i++) html += '<i class="bi bi-star-fill star" aria-hidden="true"></i>';
  if (half) html += '<i class="bi bi-star-half star" aria-hidden="true"></i>';
  for (let i = 0; i < empty; i++) html += '<i class="bi bi-star star empty" aria-hidden="true"></i>';
  return `<span class="yr-rating-stars" aria-label="評分 ${rating.toFixed(1)} 分">${html}</span>`;
}

/**
 * 從 review-card 讀取星數，並回傳有效的 rating 陣列
 * Read star values from review-card ratings and return an array of valid ratings
 * @returns {number[]} review ratings
 */
function getReviewCardRatings() {
  const ratingElements = document.querySelectorAll('.product-tab-panel[data-panel="reviews"] .review-card');
  const ratings = [];

  ratingElements.forEach(card => {
    const ratedEl = card.querySelector('[data-rating]');
    if (ratedEl) {
      const parsed = parseFloat(ratedEl.getAttribute('data-rating'));
      if (Number.isFinite(parsed)) {
        ratings.push(parsed);
        return;
      }
    }

    const starText = Array.from(card.querySelectorAll('*'))
      .map(el => el.textContent || '')
      .join(' ')
      .match(/[★☆]+/g);

    if (!starText || starText.length === 0) return;

    const starString = starText.find(fragment => /★/.test(fragment));
    if (!starString) return;

    const ratingValue = parseStarString(starString);
    if (ratingValue !== null) ratings.push(ratingValue);
  });

  return ratings;
}

/**
 * 解析 review-card 的星星文字為數字評分
 * Parse star text into numeric rating
 * @param {string} starString
 * @returns {number|null}
 */
function parseStarString(starString) {
  let value = 0;

  for (const char of starString) {
    if (char === '★') value += 1;
    if (char === '☆') value += 0;
  }

  return Number.isFinite(value) ? value : null;
}

// -----------------------------------------------
// 渲染圖片 Gallery（主圖 + 縮圖）
// Render image gallery: main image + thumbnails
// -----------------------------------------------
function renderGallery(product) {
  // 使用 product.images 陣列，若不存在就只用 product.image
  // Use product.images array, fall back to product.image if not available
  const images = product.images && product.images.length > 0
    ? product.images
    : [product.image].filter(Boolean);

  // 設定主圖 Set main image
  const mainImg = document.getElementById('galleryMainImg');
  if (mainImg && images.length > 0) {
    mainImg.src = images[0];
    mainImg.alt = product.name;
  }

  // 渲染縮圖 Render thumbnails
  const thumbsContainer = document.getElementById('galleryThumbs');
  if (!thumbsContainer) return;

  thumbsContainer.innerHTML = images.map((imgSrc, index) => `
    <div class="gallery-thumb ${index === 0 ? 'active' : ''}"
         data-index="${index}"
         data-src="${imgSrc}"
         style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid ${index === 0 ? '#244d4d' : '#e5e7eb'};flex-shrink:0;width:72px;height:72px;transition:border-color 0.2s;">
      <img src="${imgSrc}"
           alt="商品圖片 ${index + 1}"
           style="width:100%;height:100%;object-fit:cover;">
    </div>
  `).join('');

  // 縮圖點擊事件：切換主圖
  // Thumbnail click event: switch main image
  thumbsContainer.addEventListener('click', (e) => {
    const thumb = e.target.closest('.gallery-thumb');
    if (!thumb) return;

    const newSrc = thumb.dataset.src;

    // 切換主圖圖片 Switch main image
    if (mainImg) {
      // 加入淡入淡出效果 Add fade effect
      mainImg.style.opacity = '0';
      mainImg.style.transition = 'opacity 0.2s ease';
      setTimeout(() => {
        mainImg.src = newSrc;
        mainImg.style.opacity = '1';
      }, 200);
    }

    // 更新縮圖 active 狀態（高亮邊框）
    // Update thumbnail active state (highlight border)
    thumbsContainer.querySelectorAll('.gallery-thumb').forEach(t => {
      t.classList.remove('active');
      t.style.borderColor = '#e5e7eb';
    });
    thumb.classList.add('active');
    thumb.style.borderColor = '#244d4d';
  });
}

// -----------------------------------------------
// 渲染顏色規格選擇按鈕
// Render color spec selection buttons
// -----------------------------------------------
function renderColorOptions(product) {
  const colorOptions = product.colors;
  const colorGroup = document.getElementById('colorSpecGroup');
  const colorContainer = document.getElementById('colorOptions');
  const selectedLabel = document.getElementById('selectedColorLabel');

  // 若商品沒有顏色資料，隱藏整個區塊
  // If no color data, hide the block
  if (!colorOptions || colorOptions.length === 0) {
    if (colorGroup) colorGroup.style.display = 'none';
    return;
  }

  // 預設選第一個顏色 Default select first color
  if (selectedLabel) selectedLabel.textContent = colorOptions[0];

  // 渲染顏色按鈕 Render color buttons
  if (colorContainer) {
    colorContainer.innerHTML = colorOptions.map((color, index) => `
      <button class="spec-btn ${index === 0 ? 'active' : ''}"
              data-color="${color}"
              type="button"
              style="margin:0.2rem;">${color}</button>
    `).join('');

    // 顏色按鈕點擊事件 Color button click event
    colorContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.spec-btn');
      if (!btn) return;

      // 移除其他按鈕的 active，給點擊按鈕加上 active
      // Remove active from others, add to clicked button
      colorContainer.querySelectorAll('.spec-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 更新顯示的顏色標籤 Update color label
      if (selectedLabel) selectedLabel.textContent = btn.dataset.color;
    });
  }
}

// -----------------------------------------------
// 渲染尺寸規格選擇按鈕
// Render size spec selection buttons
// -----------------------------------------------
function renderSizeOptions(product) {
  const sizeOptions = product.sizes;
  const sizeGroup = document.getElementById('sizeSpecGroup');
  const sizeContainer = document.getElementById('sizeOptions');
  const selectedLabel = document.getElementById('selectedSizeLabel');

  // 若商品沒有尺寸資料，隱藏整個區塊
  // If no size data, hide the block
  if (!sizeOptions || sizeOptions.length === 0) {
    if (sizeGroup) sizeGroup.style.display = 'none';
    return;
  }

  // 顯示尺寸區塊 Show size block
  if (sizeGroup) sizeGroup.style.display = 'block';

  // 預設選第一個尺寸 Default select first size
  if (selectedLabel) selectedLabel.textContent = sizeOptions[0];

  // 渲染尺寸按鈕 Render size buttons
  if (sizeContainer) {
    sizeContainer.innerHTML = sizeOptions.map((size, index) => `
      <button class="spec-btn ${index === 0 ? 'active' : ''}"
              data-size="${size}"
              type="button"
              style="margin:0.2rem;">${size}</button>
    `).join('');

    // 尺寸按鈕點擊事件 Size button click event
    sizeContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.spec-btn');
      if (!btn) return;

      sizeContainer.querySelectorAll('.spec-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (selectedLabel) selectedLabel.textContent = btn.dataset.size;
    });
  }
}

// -----------------------------------------------
// 渲染商品規格表（下方 Tab 介紹區）
// Render product specification table (in description tab)
// -----------------------------------------------
function renderSpecTable(product) {
  const specTable = document.getElementById('productSpecTable');
  if (!specTable || !product.specifications) return;

  // 將 specifications 物件轉成表格 HTML
  // Convert specifications object to table HTML
  const specs = product.specifications;
  const specLabels = {
    weight: '重量',
    capacity: '容量',
    material: '材質',
    waterproof: '防水係數',
    frameType: '背架類型',
    power: '功率',
    fuelType: '燃料類型',
    lumens: '亮度',
    batteryLife: '電池壽命',
    windSpeed: '耐風速度',
    poles: '帳竿材質',
  };

  const rows = Object.entries(specs).map(([key, value]) => {
    const label = specLabels[key] || key; // 若找不到對應中文，就直接顯示 key
    return `
      <div style="display:flex;border-bottom:1px solid #e5e7eb;">
        <div style="width:40%;background:#f9fafb;padding:0.6rem 0.875rem;font-weight:600;color:#374151;font-size:0.875rem;">${label}</div>
        <div style="flex:1;padding:0.6rem 0.875rem;color:#4b5563;font-size:0.875rem;">${value}</div>
      </div>
    `;
  }).join('');

  specTable.innerHTML = rows || '<div style="padding:1rem;color:#9ca3af;">暫無規格資料</div>';

  // 渲染商品特色 Render product features
  const featuresEl = document.getElementById('productFeatures');
  if (featuresEl && product.tags && product.tags.length > 0) {
    featuresEl.innerHTML = `
      <span class="yr-product-feature-heading"><i class="bi bi-stars" aria-hidden="true"></i> 商品特色</span>
      <ul style="padding-left:1.25rem;color:#4b5563;font-size:0.9rem;line-height:2;">
        ${product.tags.map(tag => `<li>${tag}</li>`).join('')}
      </ul>
    `;
  }
}

// -----------------------------------------------
// 渲染免運進度條
// Render free shipping progress bar
// -----------------------------------------------
function renderShippingProgress() {
  const configuredThreshold = Number(window.AppConfig?.CART?.FREE_SHIPPING_THRESHOLD);
  const threshold = Number.isFinite(configuredThreshold) && configuredThreshold > 0 ? configuredThreshold : 3000;

  const rawSubtotal = window.calculateCartTotal ? Number(window.calculateCartTotal()) : 0;
  const subtotal = Number.isFinite(rawSubtotal) && rawSubtotal > 0 ? rawSubtotal : 0;

  const progress = Math.min(Math.max((subtotal / threshold) * 100, 0), 100);
  const displayProgress = Math.round(progress);
  const remaining = Math.max(threshold - subtotal, 0);
  const isQualified = subtotal >= threshold;

  const progressBar = document.getElementById('shippingProgressBar');
  const progressText = document.getElementById('shippingProgressText');
  const progressHint = document.getElementById('shippingProgressHint');
  const shippingCard = progressBar ? progressBar.closest('.yr-pd-shipping') : null;
  const progressTrack = progressBar ? progressBar.parentElement : null;

  if (progressBar) {
    progressBar.style.width = `${displayProgress}%`;
  }

  if (progressText) {
    progressText.textContent = `${displayProgress}%`;
  }

  if (progressHint) {
    if (isQualified) {
      progressHint.textContent = '已達免運門檻，本筆訂單可享免運';
    } else if (subtotal === 0) {
      progressHint.textContent = `購物滿 ${window.formatCurrency(threshold)} 享免運，還差 ${window.formatCurrency(remaining)}`;
    } else {
      progressHint.textContent = `距離免運還差 ${window.formatCurrency(remaining)}`;
    }
  }

  if (shippingCard) {
    shippingCard.classList.toggle('is-qualified', isQualified);
  }
  if (progressTrack) {
    progressTrack.classList.add('shipping-progress-track');
  }
}

/**
 * 讓免運進度條在購物車異動後保持同步。
 */
function initShippingProgressSync() {
  if (document.body.dataset.shippingProgressBound === 'true') return;
  document.body.dataset.shippingProgressBound = 'true';

  window.addEventListener('yurui:cart-updated', renderShippingProgress);
  window.addEventListener('storage', (event) => {
    if (event.key === 'yuruiAppState') {
      renderShippingProgress();
    }
  });
}

// -----------------------------------------------
// 初始化數量 Stepper（+ / - 按鈕）
// Initialize quantity stepper (increase/decrease buttons)
// -----------------------------------------------
function initQtyStepper() {
  const qtyInput = document.getElementById('qtyInput');
  const decreaseBtn = document.getElementById('qtyDecrease');
  const increaseBtn = document.getElementById('qtyIncrease');

  if (!qtyInput || !decreaseBtn || !increaseBtn) return;

  // 點擊「-」按鈕：數量減 1，最小值為 1
  // Click '-' button: decrease quantity, min is 1
  decreaseBtn.addEventListener('click', () => {
    const current = parseInt(qtyInput.value, 10);
    if (current > 1) {
      qtyInput.value = current - 1;
    }
  });

  // 點擊「+」按鈕：數量加 1，最大值為 99
  // Click '+' button: increase quantity, max is 99
  increaseBtn.addEventListener('click', () => {
    const current = parseInt(qtyInput.value, 10);
    if (current < 99) {
      qtyInput.value = current + 1;
    }
  });

  // 直接輸入時的驗證（避免輸入 0 或負數）
  // Direct input validation (prevent 0 or negative)
  qtyInput.addEventListener('change', () => {
    let val = parseInt(qtyInput.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 99) val = 99;
    qtyInput.value = val;
  });
}

// -----------------------------------------------
// 初始化操作按鈕（加入購物車 / 直接購買）
// Initialize action buttons (add to cart / buy now)
// -----------------------------------------------
function initActionButtons(product) {
  const addToCartBtn = document.getElementById('addToCartBtn');
  const buyNowBtn = document.getElementById('buyNowBtn');
  const qtyInput = document.getElementById('qtyInput');

  /**
   * 取得目前選擇的規格資訊
   * Get currently selected spec information
   */
  function getSelectedSpecs() {
    const selectedColor = document.querySelector('#colorOptions .spec-btn.active');
    const selectedSize = document.querySelector('#sizeOptions .spec-btn.active');
    return {
      color: selectedColor ? selectedColor.dataset.color : null,
      size: selectedSize ? selectedSize.dataset.size : null,
    };
  }

  // 加入購物車按鈕
  // Add to cart button
  if (addToCartBtn) {
    addToCartBtn.addEventListener('click', () => {
      const qty = parseInt(qtyInput?.value || '1', 10);
      const specs = getSelectedSpecs();

      // 組合商品名（含規格）
      // Compose product name (with spec)
      const specSuffix = [specs.color, specs.size].filter(Boolean).join(' / ');
      const productName = specSuffix ? `${product.name}（${specSuffix}）` : product.name;

      // 加入購物車
      // Add to cart
      window.addToCart({
        id: product.id,
        name: productName,
        price: product.price,
        image: product.image,
        brand: product.brand,
      }, qty);

      // 更新免運進度條（因為購物車金額變了）
      // Update shipping progress (cart total changed)
      renderShippingProgress();
    });
  }

  // 直接購買按鈕 Buy Now button
  if (buyNowBtn) {
    buyNowBtn.addEventListener('click', () => {
      const qty = parseInt(qtyInput?.value || '1', 10);
      const specs = getSelectedSpecs();
      const specSuffix = [specs.color, specs.size].filter(Boolean).join(' / ');
      const productName = specSuffix ? `${product.name}（${specSuffix}）` : product.name;

      // 先加入購物車，然後直接進入結帳頁，避免使用已移除的 cart.html。
      // Add to cart first, then go straight to checkout because cart.html is removed.
      window.addToCart({
        id: product.id,
        name: productName,
        price: product.price,
        image: product.image,
        brand: product.brand,
      }, qty);

      // 短暫延遲後跳轉（確保 toast 有時間顯示）
      // Brief delay before redirect (let toast show)
      setTimeout(() => {
        window.location.href = 'checkout.html';
      }, 500);
    });
  }
}

// -----------------------------------------------
// 初始化 Tab 頁籤切換邏輯
// Initialize tab switching logic
// -----------------------------------------------
function initTabSwitching() {
  const tabBtns = document.querySelectorAll('.product-tab-btn');
  const tabPanels = document.querySelectorAll('.product-tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      // 更新按鈕樣式：移除所有 active，給點擊按鈕加上 active
      // Update button styles: remove all active, add to clicked
      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.style.color = '#6b7280';
        b.style.borderBottomColor = 'transparent';
      });
      btn.classList.add('active');
      btn.style.color = '#244d4d';
      btn.style.borderBottomColor = '#244d4d';

      // 切換面板顯示 Switch panel visibility
      tabPanels.forEach(panel => {
        if (panel.dataset.panel === targetTab) {
          panel.classList.add('active');
          panel.style.display = 'block';
        } else {
          panel.classList.remove('active');
          panel.style.display = 'none';
        }
      });
    });
  });
}

// ========================================
// 頁面自動初始化
// Auto-initialize when DOM is ready
// ========================================
if (document.readyState === 'loading') {
  // DOM 仍在載入，等待 DOMContentLoaded 事件
  document.addEventListener('DOMContentLoaded', window.initProductDetailPage);
} else {
  // DOM 已載入完成，直接執行
  window.initProductDetailPage();
}

console.log('✓ product-detail.js 已載入');
