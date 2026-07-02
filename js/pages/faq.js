// ========================================
// FAQ 頁面邏輯 FAQ Page Logic
// ========================================
// 此文件負責：
// 1. 手風琴（Accordion）展開/收合功能
// 2. 即時搜尋（Search）功能，含 debounce
// 3. NPS 評分按鈕生成與互動
// 4. 送出意見功能

// ========================================
// 工具函數 Utility Functions
// ========================================

/**
 * Debounce 函數：延遲執行，避免連續觸發導致效能問題
 * Debounce: delay execution to avoid performance issues on rapid events
 *
 * 例如搜尋框每打一個字都會觸發 input 事件，
 * debounce 讓他在「停止輸入後 delay ms」才真的執行搜尋。
 *
 * @param {Function} fn - 要延遲執行的函數
 * @param {number} delay - 延遲毫秒數（ms）
 * @returns {Function} 包裝後的 debounced 函數
 */
function _debounce(fn, delay) {
  let timer = null; // 計時器 ID
  return function (...args) {
    // 每次呼叫時先清除上一個計時器
    // Clear previous timer each time the function is called
    clearTimeout(timer);
    // 重新設定計時器，delay ms 後才真正執行
    // Set a new timer that executes fn after delay ms
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ========================================
// 搜尋功能 Search Functionality
// ========================================

/**
 * 執行 FAQ 搜尋
 * Execute FAQ search based on keyword
 * @param {string} keyword - 使用者輸入的搜尋關鍵字
 */
function _searchFaq(keyword) {
  const query = keyword.trim().toLowerCase();

  // 取得所有手風琴項目和分類區塊
  // Get all accordion items and category blocks
  const allItems = document.querySelectorAll('.faq-accordion-item');
  const allCategories = document.querySelectorAll('.faq-category-block');

  if (query === '') {
    // 搜尋為空：顯示全部
    // Empty search: show all
    allItems.forEach(item => item.style.display = '');
    allCategories.forEach(cat => cat.style.display = '');
    return;
  }

  // 逐一檢查每個問答項目
  // Check each FAQ item
  allItems.forEach(item => {
    // 取得問題文字（按鈕 span 內）和答案文字（body 內）
    // Get question text (inside button span) and answer text (inside body)
    const questionEl = item.querySelector('.faq-accordion-btn span:first-child');
    const answerEl = item.querySelector('.faq-accordion-body');

    const questionText = (questionEl ? questionEl.textContent : '').toLowerCase();
    const answerText = (answerEl ? answerEl.textContent : '').toLowerCase();

    // 若問題或答案包含搜尋詞 → 顯示；否則隱藏
    // Show if question or answer contains keyword; hide otherwise
    const matches = questionText.includes(query) || answerText.includes(query);
    item.style.display = matches ? '' : 'none';
  });

  // 若某分類下所有問題都隱藏 → 隱藏該分類標題
  // Hide category title if all its items are hidden
  allCategories.forEach(catBlock => {
    const visibleItems = catBlock.querySelectorAll('.faq-accordion-item:not([style*="display: none"])');
    catBlock.style.display = visibleItems.length > 0 ? '' : 'none';
  });
}

// ========================================
// 手風琴功能 Accordion Functionality
// ========================================

/**
 * 初始化手風琴邏輯
 * Initialize accordion click behavior
 * 點擊問題按鈕 → 切換展開/收合狀態
 */
function _initAccordion() {
  const allBtns = document.querySelectorAll('.faq-accordion-btn');

  allBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      // 找到對應的 body 元素
      // Find the corresponding body element (next sibling)
      const body = this.nextElementSibling;
      const isOpen = this.classList.contains('open');

      // 切換按鈕和 body 的 .open class
      // Toggle .open class on button and body
      this.classList.toggle('open', !isOpen);
      body.classList.toggle('open', !isOpen);

      // 更新無障礙屬性 aria-expanded
      // Update accessibility attribute aria-expanded
      this.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
    });
  });
}

// ========================================
// NPS 評分功能 NPS Rating Functionality
// ========================================

/** 目前選中的 NPS 分數（null 表示未選）
 *  Currently selected NPS score (null = not selected) */
let _selectedNps = null;

/**
 * 建立並渲染 NPS 評分按鈕（0 到 10 共 11 個）
 * Generate and render NPS rating buttons (0 to 10)
 */
function _initNpsButtons() {
  const npsGroup = document.getElementById('npsGroup');
  if (!npsGroup) return;

  // 產生 0 ~ 10 的按鈕 HTML
  // Generate HTML for 0-10 buttons
  let html = '';
  for (let i = 0; i <= 10; i++) {
    html += `<button class="nps-btn" data-score="${i}" aria-label="評分 ${i}">${i}</button>`;
  }
  npsGroup.innerHTML = html;

  // 綁定點擊事件 Bind click event
  npsGroup.addEventListener('click', function (e) {
    const btn = e.target.closest('.nps-btn');
    if (!btn) return;

    const score = parseInt(btn.dataset.score, 10);
    _selectedNps = score;

    // 更新所有按鈕：先移除 active 和顏色 class
    // Reset all buttons first
    const allNpsBtns = npsGroup.querySelectorAll('.nps-btn');
    allNpsBtns.forEach(b => b.classList.remove('active', 'score-low', 'score-mid', 'score-high'));

    // 設定被選中按鈕的 active class 和顏色 class
    // Set active class and color class on selected button
    btn.classList.add('active');

    if (score <= 6) {
      // 0-6 分：低分，紅色系 Low score, red
      btn.classList.add('score-low');
    } else if (score <= 8) {
      // 7-8 分：中等，黃色系 Mid score, yellow
      btn.classList.add('score-mid');
    } else {
      // 9-10 分：高分，綠色系 High score, green
      btn.classList.add('score-high');
    }

    console.log(`✓ NPS 評分已選：${score} NPS score selected: ${score}`);
  });
}

// ========================================
// 送出意見功能 Submit Feedback
// ========================================

/**
 * 初始化「送出意見」按鈕
 * Initialize submit feedback button
 */
function _initSubmitFeedback() {
  const submitBtn = document.getElementById('submitFeedbackBtn');
  if (!submitBtn) return;

  submitBtn.addEventListener('click', function () {
    // 驗證：必須先給 NPS 評分
    // Validation: NPS score must be selected first
    if (_selectedNps === null) {
      if (typeof window.showToast === 'function') {
        window.showToast('請先給個評分再送出！', 'warning');
      }
      return;
    }

    // 成功送出 Successfully submitted
    if (typeof window.showToast === 'function') {
      window.showToast('感謝您的回饋！我們會持續改善服務', 'success');
    }

    // 重置表單 Reset form
    const textarea = document.getElementById('feedbackTextarea');
    if (textarea) textarea.value = '';

    // 清除 NPS 選擇 Clear NPS selection
    const allNpsBtns = document.querySelectorAll('#npsGroup .nps-btn');
    allNpsBtns.forEach(b => b.classList.remove('active', 'score-low', 'score-mid', 'score-high'));
    _selectedNps = null;

    console.log('✓ 意見已送出 Feedback submitted');
  });
}

// ========================================
// 頁面初始化函數 Page Initialization
// ========================================

/**
 * FAQ 頁面主初始化函數
 * Main FAQ page initialization function
 */
window.initFaqPage = function () {
  console.log('❓ FAQ 頁初始化開始 FAQ page init start');

  // ----------------------------------------
  // 初始化搜尋功能（帶 300ms debounce）
  // Init search with 300ms debounce
  // ----------------------------------------
  const searchInput = document.getElementById('faqSearchInput');
  if (searchInput) {
    // 建立 debounced 版本的搜尋函數
    // Create debounced search function
    const debouncedSearch = _debounce(_searchFaq, 300);

    // 監聽 input 事件（每次輸入都觸發，但有 debounce 緩衝）
    // Listen for input event (fires on every keystroke, but debounced)
    searchInput.addEventListener('input', function () {
      debouncedSearch(this.value);
    });
  }

  // ----------------------------------------
  // 初始化手風琴 Init accordion
  // ----------------------------------------
  _initAccordion();

  // ----------------------------------------
  // 初始化 NPS 評分按鈕 Init NPS buttons
  // ----------------------------------------
  _initNpsButtons();

  // ----------------------------------------
  // 初始化送出意見按鈕 Init submit button
  // ----------------------------------------
  _initSubmitFeedback();

  console.log('✓ FAQ 頁初始化完成 FAQ page init done');
};

// ========================================
// 自動初始化 Auto Initialization
// ========================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initFaqPage);
} else {
  window.initFaqPage();
}

console.log('✓ faq.js 已載入 faq.js loaded');
