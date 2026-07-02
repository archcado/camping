// ============================================================
// 分店頁面邏輯 (Branches Page Logic)
// 負責：載入分店資料、渲染地圖、合作店家網格
// Handles: loading branch data, map update, partner grid
// ============================================================

// ============================================================
// 靜態合作店家資料
// Static partner data (hardcoded mock)
// ============================================================
const PARTNER_DATA = [
  {
    name: '天空之城露營農場',
    image: '../assets/images/branches/sky-castle-camp.webp',
    tags: ['景觀露營', '親子友善', '設備租借'],
    discount: 'YURUI88 享88折',
    desc: '海拔1200公尺的雲霧之間，景色無敵。白天俯瞰翠綠山谷，夜晚仰望璀璨星空，是離天空最近的夢幻露營地。提供完善的設備租借，讓你無需負重即可享受高山露營。'
  },
  {
    name: '森林秘境生態農場',
    image: '../assets/images/branches/forest-eco-camp.webp',
    tags: ['生態體驗', '野外教學', 'DIY'],
    discount: 'FOREST10 享9折',
    desc: '在深山原始林中，體驗真實的自然教育。從辨識野生植物到建造野外遮蔽所，每一項活動都讓大人與孩子重新認識大自然。每週末固定舉辦 DIY 工作坊。'
  },
  {
    name: '海岸星空露營基地',
    image: '../assets/images/branches/coastal-stargazing-camp.webp',
    tags: ['海景', '夜觀星空', '衝浪'],
    discount: 'STAR15 折150元',
    desc: '面對太平洋的絕美海景，夜晚數星星、聆聽浪濤聲入睡。白天可參加衝浪體驗課程，基地提供專業衝浪板租借與教練指導，是海岸冒險愛好者的首選。'
  },
  {
    name: '梅花湖湖景渡假村',
    image: '../assets/images/branches/plum-lake-resort.webp',
    tags: ['湖景', '划船', '釣魚'],
    discount: 'LAKE100 折100元',
    desc: '鄰近梅花湖的精緻露營場，可划船釣魚，水上活動豐富多樣。湖畔搭帳聽水聲入眠，清晨在湖霧中醒來，享受如詩如畫的寧靜時光。'
  },
  {
    name: '古道芬多精山莊',
    image: '../assets/images/branches/forest-trail-lodge.webp',
    tags: ['芬多精', '登山步道', '早餐服務'],
    discount: 'FOREST88 享88折',
    desc: '千年古道旁的靜謐山莊，充滿負離子與芬多精。沿途種植百年老樟樹，空氣清新令人神清氣爽。提供豐盛台式早餐，讓你元氣滿滿出發登山健行。'
  },
  {
    name: '荷花池畔戀人角落',
    image: '../assets/images/branches/lotus-lakeside-camp.webp',
    tags: ['荷花池', '情侶推薦', '燭光晚餐'],
    discount: 'LOVE200 折200元',
    desc: '充滿浪漫氛圍的荷花池畔，適合兩人世界。每晚提供精心設計的燭光晚餐，帳篷內備有紅酒與小點心。夏夜螢火蟲飛舞，是求婚告白的絕佳場所。'
  }
];

// ============================================================
// 分店卡片渲染
// Branch card rendering
// ============================================================

/**
 * 渲染單一分店卡片 HTML
 * Build branch card HTML for one branch object
 * @param {Object} branch   - 分店資料物件
 * @param {boolean} isFirst - 是否為第一張（預設 active）
 * @returns {string} HTML 字串
 */
function buildBranchCard(branch, isFirst) {
  // 特色標籤 HTML
  // Feature tag HTML
  const featureTagsHTML = (branch.features || [])
    .map(f => `<span class="branch-feature-tag">${f}</span>`)
    .join('');

  return `
    <div class="branch-card ${isFirst ? 'active' : ''}"
         data-branch-id="${branch.id}"
         data-map-query="${encodeURIComponent(branch.mapQuery)}"
         data-address="${encodeURIComponent(branch.address)}">

      <!-- 上區塊：店名（淺綠底色）/ Top block: branch name (light green background) -->
      <div class="branch-card-header">${branch.name}</div>

      <!-- 下區塊：聯絡資訊 + 特色標籤 / Bottom block: contact info + feature tags -->
      <div class="branch-card-body">
        <!-- 地址 / Address -->
        <div class="branch-card-info">
          <span><i class="bi bi-geo-alt" aria-hidden="true"></i></span>
          <span>${branch.address}</span>
        </div>
        <!-- 電話 / Phone -->
        <div class="branch-card-info">
          <span><i class="bi bi-telephone" aria-hidden="true"></i></span>
          <span>${branch.phone}</span>
        </div>
        <!-- 營業時間 / Hours -->
        <div class="branch-card-info">
          <span><i class="bi bi-clock" aria-hidden="true"></i></span>
          <span>${branch.hours}</span>
        </div>
        <!-- 特色標籤（橫排）/ Feature tags (horizontal row) -->
        <div class="branch-card-features">
          ${featureTagsHTML}
        </div>
      </div>

    </div>
  `;
}

/**
 * 更新右側地圖 iframe 與規劃路線連結
 * Update the map iframe src and directions link
 * @param {string} mapQuery  - 地圖查詢字串（例如：台北市信義區...）
 * @param {string} address   - 完整地址（用於規劃路線）
 */
function updateMap(mapQuery, address) {
  const iframe = document.getElementById('branchMapIframe');
  const dirBtn = document.getElementById('directionsBtn');

  if (iframe) {
    // 更新 Google Maps iframe src
    // Update Google Maps embed URL
    iframe.src = `https://maps.google.com/maps?q=${mapQuery}&output=embed&hl=zh-TW`;
  }

  if (dirBtn) {
    // 更新「規劃路線」連結
    // Update directions link
    dirBtn.href = `https://www.google.com/maps/search/?api=1&query=${address}`;
  }
}

/**
 * 載入並渲染所有分店
 * Load branches from API or JSON, then render cards
 */
async function loadBranches() {
  const container = document.getElementById('branchList');
  if (!container) return;

  let branches = [];

  try {
    // 嘗試從 API mock 取得分店資料
    // Try fetching via API mock
    if (window.API && window.API.branches && window.API.branches.getAll) {
      branches = await window.API.branches.getAll();
    } else {
      // Fallback：直接 fetch JSON 檔案
      // Fallback: fetch JSON file directly
      const res = await fetch('../data/branches.json');
      branches   = await res.json();
    }
  } catch (err) {
    console.error('載入分店失敗 / Failed to load branches:', err);
    container.innerHTML = `
      <div style="text-align:center;padding:2rem;color:#e74c3c;">
        <div style="font-size:2rem;margin-bottom:0.5rem;"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div>
        載入失敗，請稍後再試
      </div>`;
    return;
  }

  // 渲染分店卡片
  // Render branch cards
  container.innerHTML = branches
    .map((branch, idx) => buildBranchCard(branch, idx === 0))
    .join('');

  // 預設顯示第一間分店的地圖
  // Default to first branch map on load
  if (branches.length > 0) {
    updateMap(
      encodeURIComponent(branches[0].mapQuery),
      encodeURIComponent(branches[0].address)
    );
  }

  // 綁定分店卡片點擊事件
  // Bind click events to each branch card
  container.querySelectorAll('.branch-card').forEach(card => {
    card.addEventListener('click', () => {
      // 移除所有 active class，只給被點擊的加上
      // Remove active from all cards, add to clicked one
      container.querySelectorAll('.branch-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      // 更新地圖（card 上的 data-* 屬性已做 encodeURIComponent）
      // Update map (data attributes are already encoded)
      updateMap(card.dataset.mapQuery, card.dataset.address);

      // 手機版：自動滾動到地圖位置
      // Mobile: scroll map into view
      const mapWrap = document.getElementById('mapWrap');
      if (mapWrap && window.innerWidth < 992) {
        mapWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// ============================================================
// 合作店家網格渲染
// Partner grid rendering
// ============================================================

/**
 * 產生單一合作店家卡片 HTML
 * Build a single partner card HTML
 * @param {Object} partner - 合作店家資料
 * @param {number} idx     - 索引（用於 onclick 綁定）
 * @returns {string} HTML 字串
 */
function buildPartnerCard(partner, idx) {
  // 標籤 HTML
  const tagsHTML = partner.tags
    .map(t => `<span class="partner-tag">${t}</span>`)
    .join('');

  return `
    <div class="partner-card" onclick="openPartnerDetail(${idx})">
      <!-- 圖片 -->
      <div class="partner-card-img">
        <img src="${partner.image}"
             alt="${partner.name}"
             loading="lazy"
             onerror="this.onerror=null; this.src='../assets/images/branches/branch-fallback.webp';">
      </div>
      <!-- 卡片內容 -->
      <div class="partner-card-body">
        <div class="partner-card-name">${partner.name}</div>
        <div class="partner-tags">${tagsHTML}</div>
        <!-- 優惠碼預覽 -->
        <div style="margin-top:0.5rem;font-size:0.72rem;color:#244d4d;font-weight:700;">
          <i class="bi bi-gift" aria-hidden="true"></i> ${partner.discount}
        </div>
      </div>
    </div>
  `;
}

/**
 * 渲染合作店家網格
 * Render all partner cards into #partnersGrid
 */
function renderPartners() {
  const container = document.getElementById('partnersGrid');
  if (!container) return;

  container.innerHTML = PARTNER_DATA
    .map((partner, idx) => buildPartnerCard(partner, idx))
    .join('');
}

// ============================================================
// 合作店家詳情 Modal
// Partner detail modal
// ============================================================

/**
 * 開啟合作店家詳情 Modal
 * Open partner detail modal and populate with partner data
 * @param {number} idx - PARTNER_DATA 中的索引
 */
window.openPartnerDetail = function(idx) {
  const partner = PARTNER_DATA[idx];
  if (!partner) return;

  // 填充 Modal 內容
  // Populate modal elements
  const titleEl    = document.getElementById('partnerModalTitle');
  const imgEl      = document.getElementById('partnerModalImg');
  const tagsEl     = document.getElementById('partnerModalTags');
  const descEl     = document.getElementById('partnerModalDesc');
  const discountEl = document.getElementById('partnerModalDiscount');

  if (titleEl)    titleEl.textContent   = partner.name;
  if (imgEl) {
    imgEl.src = partner.image;
    imgEl.alt = partner.name;
  }
  if (tagsEl) {
    tagsEl.innerHTML = partner.tags
      .map(t => `<span class="partner-tag" style="font-size:0.78rem;">${t}</span>`)
      .join('');
  }
  if (descEl)     descEl.textContent    = partner.desc;
  if (discountEl) discountEl.textContent = partner.discount;

  // 開啟 Modal
  window.openModal && window.openModal('partnerModal');
};

// ============================================================
// 主初始化函數
// Main initialization function
// ============================================================

/**
 * 初始化分店頁面
 * Initialize the branches page
 * Called early so global components are registered before main.js runs
 */
window.initBranchesPage = function() {
  console.log('初始化分店頁面 / Initializing branches page...');

  // 初始化頁面專屬功能
  // Initialize page-specific features
  loadBranches();   // 載入分店資料並渲染地圖
  renderPartners(); // 渲染合作店家網格

  console.log('分店頁面初始化完成 / Branches page initialized');
};

// ============================================================
// 頁面自動啟動
// Auto-start when DOM is ready
// ============================================================
if (document.readyState === 'loading') {
  // DOM 仍在載入中
  document.addEventListener('DOMContentLoaded', window.initBranchesPage);
} else {
  // DOM 已載入完成
  window.initBranchesPage();
}

console.log('✓ branches.js 已載入 / branches.js loaded');
