// ========================================
// 部落格首頁邏輯 Blog Page Logic
// ========================================
// 此文件負責：
// 1. 從 API 或 JSON 檔案取得文章資料
// 2. 渲染精選文章（Featured Article）
// 3. 渲染文章卡片網格（Articles Grid）
// 4. 分類篩選功能（Category Filter）

/**
 * 全局狀態：存放所有文章資料
 * Global state: stores all article data
 */
let _allArticles = [];        // 全部文章 All articles
let _currentCategory = 'all'; // 目前選中的分類 Current selected category
let _featuredArticle = null;  // 精選文章 Featured article

function _findCategoryTab(category) {
  const buttons = document.querySelectorAll('#categoryTabs .filter-btn');
  return Array.from(buttons).find(btn => btn.dataset.cat === category) || null;
}

function _syncThemeCards(category) {
  const cards = document.querySelectorAll('.yr-blog-theme-card');
  cards.forEach(card => {
    const isActive = category !== 'all' && card.dataset.blogCategory === category;
    card.classList.toggle('is-active', isActive);
    card.setAttribute('aria-pressed', String(isActive));
  });
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
  if (!tab) return;

  tab.click();
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
 * 渲染精選文章（大幅橫幅樣式）
 * Render the featured article as a large banner
 * @param {Object} article - 精選文章資料
 */
function _renderFeaturedArticle(article) {
  const container = document.getElementById('featuredArticle');
  if (!container || !article) return;

  // 格式化日期
  const dateStr = _formatDateCompact(article.publishedDate);
  const excerpt = article.description || article.excerpt || article.summary || '';

  // 建立精選文章的 HTML 結構
  container.innerHTML = `
    <div class="blog-featured-img"
         onclick="window.location='blog-detail.html?id=${article.id}'">
      <img 
        src="${article.image}" 
        alt="${article.title}" 
        loading="eager"
      >
      <div class="blog-featured-content">
        <div class="blog-featured-eyebrow">
          <span class="blog-featured-kicker">Featured Story</span>
          <span class="blog-featured-tag">${article.category}</span>
        </div>

        <h2 class="blog-featured-title">${article.title}</h2>

        <p class="blog-featured-excerpt">${excerpt}</p>

        <div class="blog-featured-meta">
          <div class="blog-featured-author-wrap">
            <img src="${article.authorAvatar}" alt="${article.author}" class="blog-featured-author-img">
            <span class="blog-featured-author">${article.author}</span>
          </div>
          <div class="blog-featured-submeta">
            <span>${dateStr}</span>
            <span class="blog-featured-separator">·</span>
            <span>閱讀 ${article.readTime} 分鐘</span>
          </div>
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
  _syncThemeCards(category);

  // 過濾文章（排除精選文章，精選文章已顯示在上方）
  // Filter articles (excluding featured article, which is shown above)
  let filtered = _allArticles.filter(a => a.id !== (_featuredArticle ? _featuredArticle.id : null));

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
    document.getElementById('featuredArticle').innerHTML =
      '<div style="text-align:center;padding:3rem;color:#999;">暫無文章資料</div>';
    return;
  }

  // 找出精選文章（isFeatured === true 的第一篇）
  // Find the featured article (first one with isFeatured === true)
  _featuredArticle = _allArticles.find(a => a.isFeatured === true) || _allArticles[0];
  _renderFeaturedArticle(_featuredArticle);

  // 渲染文章網格（初始顯示全部，排除精選文章）
  // Render articles grid (show all initially, exclude featured)
  const nonFeatured = _allArticles.filter(a => a.id !== _featuredArticle.id);
  _renderArticlesGrid(nonFeatured);

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

  const blogThemesRail = document.getElementById('blogThemesRail');
  if (blogThemesRail && blogThemesRail.dataset.blogBound !== 'true') {
    blogThemesRail.addEventListener('click', function (e) {
      const card = e.target.closest('.yr-blog-theme-card');
      if (!card || !blogThemesRail.contains(card)) return;

      _activateThemeCategory(card.dataset.blogCategory);
    });
    blogThemesRail.dataset.blogBound = 'true';
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
