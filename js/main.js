// ========================================
// Yuruicamp 應用入口
// ========================================
// 此文件初始化應用並設置全局事件監聽器
// ===================================================

// 用來記錄「全局組件是否已被初始化」的旗標
// Guard flag: prevent double-initialization when page JS already called init functions
window._appComponentsInitialized = false;

/**
 * 應用初始化函數（被各頁面 JS 呼叫，或由 main.js 自行呼叫）
 * App init function - called by page JS or by main.js itself
 *
 * 若頁面 JS（如 home.js、product-list.js）已自行初始化過，
 * 這裡只補跑「全局事件監聽」，不重複跑 header/modal/cart。
 */
window.initApp = async () => {
  console.log('========================================');
  console.log('Yuruicamp 應用初始化');
  console.log('========================================');

  // 全局事件監聽（online/offline/beforeunload）始終需要設定
  window.initGlobalListeners();
  // 先載入 header/footer HTML 與 header.js
  await initGlobalLayout();

  // Header partial 注入完成後才綁定共用互動，避免 product-detail 等頁面先初始化造成空 DOM 綁定。
  // Bind shared interactions only after partial markup exists, so page scripts cannot bind empty DOM.
  if (!window._appComponentsInitialized) {
    window.initNavbar();
    window.initModalListeners();
    window.initCartListeners();
    window.initPersonalizationModal();
    window._appComponentsInitialized = true;
  } else {
    // Header markup may be injected after a page script already ran init.
    window.updateNavbarLoginState?.();
    window.updateCartBadge?.();
  }

  initFloatingActions(); // 懸浮按鈕
  window.initLazyLoadingFallback?.();

  // 第 13 階段：offcanvas 開啟時鎖住 body 捲動（iOS Safari 需要）
  // Stage 13: Lock body scroll when offcanvas is open (required for iOS Safari)
  window.initBodyScrollLock();
  // 偵測目前頁面，呼叫對應的頁面初始化函式
  if (typeof window.initHomePage === 'function') {
    await window.initHomePage();
  }

  console.log('✓ 應用初始化完成');
  console.log('AppState:', window.AppState);
};

window.initGlobalListeners = () => { 
  // 記錄頁面卸載
  window.addEventListener('beforeunload', () => {
    window.saveAppState();
  });
  
  // 性能監測（使用 PerformanceObserver 更精確）
  // Performance monitoring using PerformanceObserver
  window.addEventListener('load', () => {
    // 基本計算方式（舊版）
    const perfData = window.performance.timing;
    const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
    console.log(`⏱️ 頁面加載時間: ${pageLoadTime}ms`);

    // 現代 API：LCP（最大內容繪製）監測
    // Largest Contentful Paint monitoring (modern browsers only)
    if ('PerformanceObserver' in window) {
      try {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          console.log(`🎨 LCP（最大內容繪製）: ${lastEntry.startTime.toFixed(0)}ms`);
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (e) {
        // LCP 不支援時靜默跳過 / Silently ignore if LCP not supported
      }
    }

    // 頁面加載時間警告（超過 3 秒提醒）
    // Warn if page takes over 3 seconds to load
    if (pageLoadTime > 3000) {
      console.warn(`⚠️ 頁面加載超過 3 秒（${pageLoadTime}ms），建議優化資源`);
    }
  });
};

/**
 * 第 13 階段：Body Scroll Lock（鎖定 body 捲動）
 * 當 Offcanvas 或 Modal 開啟時，防止背景頁面繼續捲動
 * 特別是 iOS Safari 需要 position: fixed 才有效
 *
 * Body scroll lock for offcanvas/modal open state
 * iOS Safari requires position:fixed to truly prevent background scroll
 */
window.initBodyScrollLock = () => {
  let scrollY = 0; // 記錄捲動位置，關閉時還原

  // 觀察 shared header drawer 是否開啟（body.yr-site-drawer-open）
  // Watch shared drawer open state via body class
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const isOpen = document.body.classList.contains('yr-site-drawer-open');
        if (isOpen) {
          // 記住目前捲動位置，套用固定
          // Remember scroll position and fix body
          scrollY = window.scrollY;
          document.body.style.top = `-${scrollY}px`;
        } else {
          // 還原捲動位置
          // Restore scroll position
          document.body.style.top = '';
          window.scrollTo(0, scrollY);
        }
      }
    });
  });

  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
};

// 全局佈局動態載入 (Header & Footer)
// ===================================================

// 輔助函式：載入局部 HTML
// Shared layout fragments use `.partial` instead of `.html` because VS Code
// Live Server injects reload scripts into HTML responses and can corrupt
// fragment-only files that are fetched into the page.

/**
 * 回傳目前頁面到專案根目錄的相對前綴。
 * @returns {string} 根目錄頁面為 "."，pages 子頁為 ".."。
 */
function getRootPathPrefix() {
  return window.location.pathname.includes('/pages/') ? '..' : '.';
}

/**
 * 載入指定 partial 區塊並取代目標容器內容。
 * @param {string} targetId - 目標容器 id。
 * @param {string} url - partial 檔案路徑。
 * @param {string} partSelector - 要載入的 data-layout-part selector。
 */
async function loadPartial(targetId, url, partSelector) {
  const target = document.getElementById(targetId);
  if (!target) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`無法載入組件: ${url}`);
    const html = await response.text();
    // 重點：header/footer partial 已整合主站與 booking 版型，主站載入時只取 main-* 區塊。
    if (partSelector) {
      const template = document.createElement('template');
      template.innerHTML = html;
      const part = template.content.querySelector(partSelector);
      target.innerHTML = part ? part.innerHTML : html;
      return;
    }
    target.innerHTML = html;
  } catch (error) {
    console.error(error);
  }
}

/**
 * 將指定 partial 區塊附加到既有容器中。
 * @param {string} targetId - 目標容器 id。
 * @param {string} url - partial 檔案路徑。
 * @param {string} partSelector - 要附加的 data-layout-part selector。
 */
async function appendPartial(targetId, url, partSelector) {
  const target = document.getElementById(targetId);
  if (!target) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`無法載入組件: ${url}`);
    const html = await response.text();
    const template = document.createElement('template');
    template.innerHTML = html;
    const part = template.content.querySelector(partSelector);
    if (part) target.insertAdjacentHTML('beforeend', part.innerHTML);
  } catch (error) {
    console.error(error);
  }
}

/**
 * 輔助函式：動態載入 JS 腳本。
 * @param {string} src - Script 路徑。
 * @returns {Promise<void>} 載入完成 promise。
 */
function loadComponentScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

function syncMainHeaderAssetPaths(rootPrefix) {
  document.querySelectorAll('.yr-site-header__logo-image[data-logo-path]').forEach((img) => {
    const relativePath = img.getAttribute('data-logo-path');
    if (!relativePath) return;
    img.src = `${rootPrefix}/${relativePath}`.replace('/./', '/');
  });
}

/**
 * Loads the shared header/footer fragments and the scripts that operate on them.
 */
async function initGlobalLayout() {
  const rootPrefix = getRootPathPrefix();
  const headerRoot = document.getElementById('header');
  if (!headerRoot) {
    console.error('Missing #header root: shared-site-header requires #header[data-header-context].');
    return;
  }

  const contextAttr = headerRoot && headerRoot.dataset
    ? (headerRoot.dataset.headerContext || '').toLowerCase()
    : '';
  if (!['shop', 'camp'].includes(contextAttr)) {
    console.error('Missing or invalid data-header-context on #header. Expected "shop" or "camp".');
    return;
  }

  // 1. 根據目錄樹，從 pages/* 往上找頂層的 components/
  await Promise.all([
    loadPartial("header", `${rootPrefix}/components/header.partial`, '[data-layout-part="shared-site-header"]'),
    loadPartial("footer", `${rootPrefix}/components/footer.partial`, '[data-layout-part="main-footer"]')
  ]);
  if (!document.getElementById('loginModal')) {
    await appendPartial("header", `${rootPrefix}/components/header.partial`, '[data-layout-part="shared-auth"]');
  }
  if (contextAttr === 'shop' && !document.getElementById('siteCartDrawer')) {
    await appendPartial("header", `${rootPrefix}/components/header.partial`, '[data-layout-part="shared-site-cart-panel"]');
  }
  if (contextAttr === 'camp' && !document.getElementById('cartPanel')) {
    await appendPartial("header", `${rootPrefix}/components/header.partial`, '[data-layout-part="shared-booking-cart-panel"]');
  }
  syncMainHeaderAssetPaths(rootPrefix);

  // 2. 確定 HTML 結構長到網頁上後，才動態載入原本的互動 JS
  try {
    await loadComponentScript(`${rootPrefix}/js/components/auth.js`);
    if (typeof window.initAuth === 'function') {
      window.initAuth();
    }
    // 若頁面尚未以 <script defer> 載入 header.js，才補動態載入，避免同頁重複綁定。
    if (typeof window.initNavbar !== 'function') {
      await loadComponentScript(`${rootPrefix}/js/components/header.js`);
    }
    
  } catch (error) {
    console.error("組件腳本載入失敗:", error);
  }
}

/**
 * Adds global floating actions once per page and wires their scroll behavior.
 */
function initFloatingActions() {
  if (document.querySelector(".floating-actions")) return;

  const floatingActions = document.createElement("div");
  floatingActions.className = "floating-actions";

  // 按鈕順序：回到頂部在上，Line客服在下
  floatingActions.innerHTML = `
    <button
      class="floating-top-btn"
      type="button"
      aria-label="回到頁面頂部"
      title="回到頂部"
    >
      <i class="bi bi-chevron-up"></i>
    </button>

    <a
      class="floating-line-btn"
      href="https://line.me"
      target="_blank"
      rel="noopener noreferrer"
      aria-label=" Line 客服"
      title="Line客服"
    >
      <span class="floating-line-label">Line客服</span>

      <span class="floating-line-icon" aria-hidden="true">
        <i class="bi bi-chat-dots-fill"></i>
      </span>
    </a>
  `;

  document.body.appendChild(floatingActions);

  const topButton = floatingActions.querySelector(".floating-top-btn");

  /**
   * Shows the top button after the user scrolls away from the first viewport area.
   */
  function toggleTopButton() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const documentHeight = document.documentElement.scrollHeight;

    // 核心修改：當向下捲動的距離超過「總頁面高度的 1/5」時，就顯示按鈕
    const isScrolledOneThird = scrollTop >= (window.innerHeight / 5);

    topButton.classList.toggle("is-visible", isScrolledOneThird);
  }

  topButton.addEventListener("click", function () {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });

  window.addEventListener("scroll", toggleTopButton, { passive: true });
  window.addEventListener("resize", toggleTopButton);

  // 初始化時執行一次，確保重整網頁時狀態正確
  toggleTopButton();
}

/**
 * 應用啟動入口
 * 等待 DOM 完全加載後執行
 */
if (document.readyState === 'loading') {
  // DOM 仍在加載中
  document.addEventListener('DOMContentLoaded', window.initApp);
} else {
  // DOM 已加載完成
  window.initApp();
}

console.log('✓ Main.js 已加載');
