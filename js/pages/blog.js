// ========================================
// 部落格首頁邏輯 Blog Page Logic
// ========================================
// 此文件負責：
// 1. 從 API 或 JSON 檔案取得文章資料
// 2. 渲染文章卡片網格（Articles Grid）
// 3. 分類篩選功能（Category Filter）
// 4. 輪播探索文章按鈕的篩選

/**
 * 全局狀態：存放所有文章資料
 * Global state: stores all article data
 */
let _allArticles = [];        // 全部文章 All articles
let _currentCategory = 'all'; // 目前選中的分類 Current selected category

function _findCategoryTab(category) {
  const buttons = document.querySelectorAll('#categoryTabs .filter-btn');
  return Array.from(buttons).find(btn => btn.dataset.cat === category) || null;
}

function _scrollToCategoryTabs() {
  const categoryTabs = document.getElementById('categoryTabs');
  if (!categoryTabs) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  categoryTabs.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'start',
  });
}

function _activateThemeCategory(category) {
  if (!category) return;

  const tab = _findCategoryTab(category);
  if (!tab) {
    console.warn(`[Blog] 找不到分類 Tab: "${category}"，仍套用文章篩選`);
  }

  _filterByCategory(category);
  _scrollToCategoryTabs();
}

// ========================================
// 工具函數 Utility Functions
// ========================================

/**
 * 格式化日期（將 "2026-03-15" 轉為 "2026年3月15日"）
 * Format date string to Traditional Chinese format
 * @param {string} dateStr - ISO 格式日期字串（e.g. "2026-03-15"）
 * @returns {string} 格式化後的日期
 */
function _formatDate(dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // getMonth() 從 0 開始，所以要 +1
  const day = date.getDate();
  return `${year}年${month}月${day}日`;
}

/**
 * 格式化日期（將 "2026-03-15" 轉為 "2026.03.15"）
 * @param {string} dateStr - ISO 格式日期字串
 * @returns {string}
 */
function _formatDateCompact(dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

// ========================================
// 渲染函數 Render Functions
// ========================================

/**
 * 建立單一文章卡片的 HTML 字串
 * Build HTML string for a single article card
 * @param {Object} article - 文章資料物件
 * @returns {string} 文章卡片的 HTML 字串
 */
function _buildArticleCard(article) {
  return `
    <div class="article-card" onclick="window.location='blog-detail.html?id=${article.id}'" style="cursor:pointer;">
      <div class="article-card-img">
        <img src="${article.image}" alt="${article.title}" loading="lazy">
      </div>
      <div class="article-card-body">
        <span class="article-tag">${article.category}</span>
        <h3 class="article-title">${article.title}</h3>
        <p class="article-excerpt">${article.excerpt}</p>
        <div class="article-meta">
          <img class="article-author-img" src="${article.authorAvatar}" alt="${article.author}">
          <span>${article.author}</span>
          <span class="article-read-time">${article.readTime} 分鐘閱讀</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * 渲染文章卡片網格
 * Render the articles grid based on current category filter
 * @param {Array} articles - 要渲染的文章陣列
 */
function _renderArticlesGrid(articles) {
  const grid = document.getElementById('articlesGrid');
  const noArticles = document.getElementById('noArticles');
  if (!grid) return;

  if (articles.length === 0) {
    // 沒有文章時顯示空狀態 Show empty state
    grid.innerHTML = '';
    if (noArticles) noArticles.style.display = 'block';
    return;
  }

  // 有文章時隱藏空狀態並渲染卡片
  if (noArticles) noArticles.style.display = 'none';
  grid.innerHTML = articles.map(_buildArticleCard).join('');
}

// ========================================
// 篩選函數 Filter Functions
// ========================================

/**
 * 根據分類過濾文章並重新渲染
 * Filter articles by category and re-render
 * @param {string} category - 分類名稱，'all' 表示全部
 */
function _filterByCategory(category) {
  _currentCategory = category;

  // 更新篩選按鈕的 active class
  // Update filter buttons' active state
  const buttons = document.querySelectorAll('#categoryTabs .filter-btn');
  buttons.forEach(btn => {
    if (btn.dataset.cat === category) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 過濾文章
  // Filter articles
  let filtered = _allArticles;

  if (category !== 'all') {
    filtered = filtered.filter(a => a.category === category);
  }

  _renderArticlesGrid(filtered);
}

// ========================================
// 資料載入函數 Data Loading Functions
// ========================================

/**
 * 載入文章資料
 * Load articles data from API or JSON file
 * @returns {Promise<Array>} 文章陣列
 */
async function _loadArticles() {
  // 優先使用 window.API（由 api-mock.js 提供）
  // Prefer window.API provided by api-mock.js
  if (window.API && typeof window.API.articles?.getAll === 'function') {
    try {
      const data = await window.API.articles.getAll();
      return data || [];
    } catch (err) {
      console.warn('window.API.articles.getAll() 失敗，改用 fetch', err);
    }
  }

  // 備用方案：直接 fetch JSON 檔案
  // Fallback: fetch JSON file directly
  try {
    const res = await fetch('../data/articles.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('載入文章資料失敗 Failed to load articles:', err);
    return [];
  }
}

// ========================================
// 頁面初始化函數 Page Initialization
// ========================================

/**
 * 部落格首頁初始化函數
 * Blog page initialization function
 * 由 main.js 的 initApp() 呼叫，或頁面載入時自動呼叫
 */
window.initBlogPage = async function () {
  console.log('📖 部落格頁初始化開始 Blog page init start');

  // 載入文章資料
  // Load article data
  _allArticles = await _loadArticles();
  console.log(`✓ 載入 ${_allArticles.length} 篇文章 Loaded ${_allArticles.length} articles`);

  if (_allArticles.length === 0) {
    return;
  }

  // 綁定分類篩選按鈕點擊事件
  // Bind category filter button click events
  const categoryTabs = document.getElementById('categoryTabs');
  if (categoryTabs && categoryTabs.dataset.blogBound !== 'true') {
    categoryTabs.addEventListener('click', function (e) {
      // 找到被點擊的 filter-btn
      // Find the clicked filter button
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;

      const cat = btn.dataset.cat; // 取得分類值 Get category value
      _filterByCategory(cat);
    });
    categoryTabs.dataset.blogBound = 'true';
  }

  // 綁定輪播 CTA 按鈕點擊事件
  // Bind carousel CTA button click events
  const blogThemeCarousel = document.getElementById('blogThemeCarousel');
  if (blogThemeCarousel && blogThemeCarousel.dataset.ctaBound !== 'true') {
    blogThemeCarousel.addEventListener('click', function (e) {
      const ctaBtn = e.target.closest('.yr-blog-carousel__cta');
      if (!ctaBtn) return;

      const category = ctaBtn.dataset.ctaCategory;
      _activateThemeCategory(category);
    });
    blogThemeCarousel.dataset.ctaBound = 'true';
  }

  _filterByCategory(_currentCategory);

  console.log('✓ 部落格頁初始化完成 Blog page init done');
};

// ========================================
// 自動初始化 Auto Initialization
// ========================================
// DOMContentLoaded 確保 DOM 已載入完成才執行
// DOMContentLoaded ensures DOM is fully loaded before execution
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initBlogPage);
} else {
  window.initBlogPage();
}

console.log('✓ blog.js 已載入 blog.js loaded');
