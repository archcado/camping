// ========================================
// 文章閱讀頁邏輯 Blog Detail Page Logic
// ========================================
// 此文件負責：
// 1. 從 URL ?id=xxx 取得文章 ID
// 2. 從 articles.json 載入對應文章
// 3. 渲染文章內容（標題、圖片、正文、相關商品）
// 4. 渲染相關文章推薦

// ========================================
// 工具函數 Utility Functions
// ========================================

/**
 * 從 URL 查詢字串取得指定參數值
 * Get a URL query string parameter value
 * 例如：?id=art-001 → getUrlParam('id') → 'art-001'
 * @param {string} key - 要取得的參數名稱
 * @returns {string|null} 參數值，若不存在則為 null
 */
function _getUrlParam(key) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

/**
 * 格式化日期
 * Format date string to Traditional Chinese format
 * @param {string} dateStr - ISO 格式日期字串
 * @returns {string} 格式化後的日期（e.g. "2026年3月15日"）
 */
function _formatDate(dateStr) {
  const date = new Date(dateStr);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

// ========================================
// 資料載入函數 Data Loading Functions
// ========================================

/**
 * 載入所有文章資料
 * Load all articles from JSON file
 * @returns {Promise<Array>} 文章陣列
 */
async function _loadAllArticles() {
  try {
    const res = await fetch('../data/articles.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('載入文章失敗 Failed to load articles:', err);
    return [];
  }
}

/**
 * 載入所有商品資料（用來渲染相關商品卡片）
 * Load all products from JSON file (for inline product cards)
 * @returns {Promise<Array>} 商品陣列
 */
async function _loadAllProducts() {
  try {
    const res = await fetch('../data/products.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('載入商品失敗 Failed to load products:', err);
    return [];
  }
}

// ========================================
// 渲染函數 Render Functions
// ========================================

/**
 * 渲染相關商品卡片（內嵌在文章內容中）
 * Render an inline product card inside article content
 * @param {Object} product - 商品資料物件
 * @returns {string} 商品卡片 HTML 字串
 */
function _buildInlineProductCard(product) {
  if (!product) return '';

  const price = product.price ? `NT$${product.price.toLocaleString()}` : '';
  const image = product.image || `https://picsum.photos/seed/${product.id}/200/200`;

  return `
    <div class="inline-product-card" onclick="window.location='product-detail.html?id=${product.id}'" title="查看商品">
      <img src="${image}" alt="${product.name || '商品圖片'}">
      <div class="inline-product-info">
        <div class="inline-product-label"><i class="bi bi-box-seam" aria-hidden="true"></i> 文章推薦商品</div>
        <h4>${product.name || '商品名稱'}</h4>
        ${price ? `<div class="price">${price}</div>` : ''}
        <div style="font-size:0.8rem; color:#888; margin-top:0.25rem;">點擊查看詳情 →</div>
      </div>
    </div>
  `;
}

/**
 * 渲染相關文章卡片
 * Render a related article card
 * @param {Object} article - 文章資料物件
 * @returns {string} 相關文章卡片 HTML 字串
 */
function _buildRelatedArticleCard(article) {
  return `
    <div class="related-article-card" onclick="window.location='blog-detail.html?id=${article.id}'" title="${article.title}">
      <img src="${article.image}" alt="${article.title}" loading="lazy">
      <div class="related-article-card-body">
        <span class="article-tag">${article.category}</span>
        <h4>${article.title}</h4>
      </div>
    </div>
  `;
}

/**
 * 將文章 content 陣列渲染為 HTML
 * Render article content array into HTML
 * content 每個元素可能是：
 *   { type: "text", value: "..." }    → <p>
 *   { type: "heading", value: "..." } → <h2>
 *   { type: "product", productId: "prod-001" } → 相關商品卡片
 *
 * @param {Array} contentItems - 文章內容陣列
 * @param {Array} allProducts - 所有商品資料（用於查找相關商品）
 * @returns {string} 渲染後的 HTML 字串
 */
function _renderContentItems(contentItems, allProducts) {
  if (!Array.isArray(contentItems) || contentItems.length === 0) {
    return '<p style="color:#999;">此文章尚無內容。</p>';
  }

  return contentItems.map(item => {
    switch (item.type) {
      case 'text':
        // 純文字段落 Plain text paragraph
        return `<p>${item.value}</p>`;

      case 'heading':
        // 小節標題 Section heading
        return `<h2>${item.value}</h2>`;

      case 'product': {
        // 相關商品卡片：從 allProducts 找對應 id
        // Inline product card: find matching product by id
        const product = allProducts.find(p => p.id === item.productId);
        return _buildInlineProductCard(product);
      }

      default:
        // 未知類型直接忽略 Unknown type, skip
        return '';
    }
  }).join('');
}

// ========================================
// 頁面初始化函數 Page Initialization
// ========================================

/**
 * 文章閱讀頁初始化函數
 * Blog detail page initialization function
 */
window.initBlogDetailPage = async function () {
  console.log('文章閱讀頁初始化開始 Blog detail page init start');

  // 從 URL 取得文章 id
  // Get article id from URL query string
  const articleId = _getUrlParam('id');
  if (!articleId) {
    document.getElementById('articleContent').innerHTML =
      '<div style="text-align:center;padding:3rem;color:#999;">找不到文章 ID，請回到<a href="blog.html">部落格</a>重新選擇。</div>';
    return;
  }

  // 同時載入文章和商品資料（Promise.all 讓兩個 fetch 並行，速度更快）
  // Load articles and products in parallel for better performance
  const [allArticles, allProducts] = await Promise.all([
    _loadAllArticles(),
    _loadAllProducts()
  ]);

  // 找出對應的文章
  // Find the target article
  const article = allArticles.find(a => a.id === articleId);

  if (!article) {
    document.getElementById('articleContent').innerHTML =
      `<div style="text-align:center;padding:3rem;color:#999;">找不到文章 "${articleId}"，請回到<a href="blog.html">部落格</a>重新選擇。</div>`;
    return;
  }

  // ----------------------------------------
  // 更新頁面 Title
  // Update page <title>
  // ----------------------------------------
  document.title = `${article.title} - Yuruicamp 露營選物`;

  // ----------------------------------------
  // 填充 Hero 圖片
  // Fill hero image
  // ----------------------------------------
  const heroImg = document.getElementById('articleHeroImg');
  if (heroImg) {
    heroImg.src = article.image;
    heroImg.alt = article.title;
  }

  // ----------------------------------------
  // 更新麵包屑最後一項
  // Update breadcrumb last item
  // ----------------------------------------
  const breadcrumbTitle = document.getElementById('breadcrumbTitle');
  if (breadcrumbTitle) {
    // 標題太長時截短顯示 Truncate if title is too long
    breadcrumbTitle.textContent = article.title.length > 20
      ? article.title.slice(0, 20) + '...'
      : article.title;
  }

  // ----------------------------------------
  // 填充文章 Metadata
  // Fill article metadata
  // ----------------------------------------
  const catEl = document.getElementById('articleCategory');
  if (catEl) catEl.textContent = article.category;

  const avatarEl = document.getElementById('articleAuthorAvatar');
  if (avatarEl) {
    avatarEl.src = article.authorAvatar;
    avatarEl.alt = article.author;
  }

  const authorNameEl = document.getElementById('articleAuthorName');
  if (authorNameEl) authorNameEl.textContent = article.author;

  const dateEl = document.getElementById('articleDate');
  if (dateEl) dateEl.textContent = _formatDate(article.publishedDate);

  const readTimeEl = document.getElementById('articleReadTime');
  if (readTimeEl) readTimeEl.textContent = `${article.readTime} 分鐘閱讀`;

  // ----------------------------------------
  // 填充文章標題
  // Fill article title (h1)
  // ----------------------------------------
  const titleEl = document.getElementById('articleTitle');
  if (titleEl) titleEl.textContent = article.title;

  // ----------------------------------------
  // 渲染文章內容
  // Render article content
  // ----------------------------------------
  const contentEl = document.getElementById('articleContent');
  if (contentEl) {
    contentEl.innerHTML = _renderContentItems(article.content || [], allProducts);
  }

  // ----------------------------------------
  // 渲染標籤
  // Render tags
  // ----------------------------------------
  const tagsEl = document.getElementById('articleTags');
  if (tagsEl && Array.isArray(article.tags)) {
    tagsEl.innerHTML = article.tags.map(tag =>
      `<span style="background:#f0f9f4; color:#244d4d; padding:0.25rem 0.75rem; border-radius:99px; font-size:0.8rem; font-weight:600;"># ${tag}</span>`
    ).join('');
  }

  // ----------------------------------------
  // 渲染相關文章（同類別，排除自身，最多 2 篇）
  // Render related articles (same category, exclude self, max 2)
  // ----------------------------------------
  const relatedGrid = document.getElementById('relatedArticlesGrid');
  if (relatedGrid) {
    const related = allArticles
      .filter(a => a.id !== article.id && a.category === article.category)
      .slice(0, 2);

    if (related.length === 0) {
      // 若無同類別文章，取任意其他 2 篇
      // If no same-category articles, take any 2 others
      const others = allArticles.filter(a => a.id !== article.id).slice(0, 2);
      relatedGrid.innerHTML = others.map(_buildRelatedArticleCard).join('');
    } else {
      relatedGrid.innerHTML = related.map(_buildRelatedArticleCard).join('');
    }
  }

  console.log(`✓ 文章渲染完成 Article rendered: ${article.title}`);
};

// ========================================
// 自動初始化 Auto Initialization
// ========================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initBlogDetailPage);
} else {
  window.initBlogDetailPage();
}

console.log('✓ blog-detail.js 已載入 blog-detail.js loaded');
