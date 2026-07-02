/**
 * camp-search.js
 * 功能：搜尋頁邏輯
 * ① 讀取 campgrounds.json（jQuery AJAX）
 * ② 動態渲染營區卡片
 * ③ Checkbox + 下拉選單即時篩選（AND 邏輯）
 *
 * Handles: data loading, card rendering, real-time filtering
 */

// ============================================================
// 全域狀態 / Global State
// ============================================================

/** 原始營區資料快取，保留一份完整陣列供篩選時使用 */
let allCampgrounds = [];

/** 由 initPriceRangeSlider 填入，供重設按鈕呼叫 */
let updatePriceSlider = function () {};

// ============================================================
// 頁面初始化 / Page Initialization
// ============================================================
$(document).ready(function () {

  // 步驟 1：載入營區資料 / Step 1: Load campground data
  loadCampgrounds();

  // 步驟 2：綁定篩選器事件 / Step 2: Bind filter events
  bindFilterEvents();

  // 步驟 3：初始化 Flatpickr 日期區間選擇器 (與 camp-detail.js 同步) / Init date range
  initFlatpickrDateRange();

  // 步驟 4：行動版篩選器展開/收合 / Step 4: Mobile filter toggle
  $('#filterToggle').on('click', function () {
    const $body = $('#filterBody');
    const isOpen = $body.hasClass('is-open');
    $body.toggleClass('is-open', !isOpen);
    $(this).attr('aria-expanded', !isOpen);
  });

  // 步驟 5：卡片標籤 +N 展開互動 / Step 5: card tag popover toggle
  bindCardTagEvents();

});

// ============================================================
// 步驟 1：載入資料
// ============================================================

/**
 * 從 JSON 檔案載入所有營區資料
 * Load all campground data from JSON file
 */
function loadCampgrounds() {

  // TODO: 未來在此替換為 fetch Java 後端 API
  // Future backend endpoint: GET /api/campgrounds
  // Query params: { region, environment_tags[], facility_tags[], check_in, check_out, guests }
  // Response format: { success: true, data: [...campgrounds] }
  $.ajax({
    url: '../data/campgrounds.json',
    method: 'GET',
    dataType: 'json'
  })
  .done(function (data) {
    allCampgrounds = data;           // 快取原始資料 / Cache raw data
    renderCampCards(allCampgrounds); // 渲染全部 / Render all
    updateFilterMeta();
  })
  .fail(function (xhr, textStatus, errorThrown) {
    // 資料載入失敗，顯示錯誤訊息 / Show error message on failure
    console.error('[camp-search] AJAX 失敗 / Failed:', textStatus, errorThrown);
    $('#loadingSkeleton').hide();
    $('#campCardGrid').html(`
      <div class="error-msg">
        <i class="bi bi-exclamation-triangle" style="font-size:2rem;display:block;margin-bottom:.5rem;"></i>
        資料載入失敗，請確認 data/campgrounds.json 存在，或重新整理頁面。
      </div>
    `);
  });
}

// ============================================================
// 步驟 2：渲染卡片
// ============================================================

/**
 * 將營區資料陣列渲染成 HTML 卡片並插入 DOM
 * Render campground data array as HTML cards
 *
 * @param {Array} camps - 要顯示的營區資料陣列
 */
function renderCampCards(camps) {
  const $grid = $('#campCardGrid');

  // 隱藏 loading 骨架屏 / Hide loading skeleton
  $('#loadingSkeleton').hide();
  $grid.empty();

  // 沒有結果時顯示提示 / Show empty state if no results
  if (camps.length === 0) {
    $grid.html(`
      <div class="no-result">
        <i class="bi bi-search" style="font-size:2rem;display:block;margin-bottom:.5rem;"></i>
        沒有符合條件的營區，請嘗試調整篩選條件。
      </div>
    `);
    $('#resultCount').text('共 0 個營區');
    return;
  }

  // 渲染每一個營區卡片 / Render each camp card
  camps.forEach(function (camp) {

    // 計算最低平日價（所有 zone 中取最小值）/ Min weekday price across all zones
    const minWeekdayPrice = Math.min(...camp.zones.map(z => z.price_weekday));
    const detailUrl = `./camp-detail.html?id=${camp.campground_id}`;
    const { featured, remaining } = selectCardTags(camp);
    const featuredTagsHTML = featured.map(renderCampTag).join('');
    const remainingTagsHTML = remaining.map(renderCampTag).join('');
    const hasMoreTags = remaining.length > 0;
    const popoverId = `campTagPopover-${camp.campground_id}`;
    const moreToggleHTML = hasMoreTags
      ? `
          <button
            type="button"
            class="camp-card__more-button"
            aria-expanded="false"
            aria-controls="${popoverId}"
            aria-label="顯示${camp.name}的其他 ${remaining.length} 個特色"
          >+${remaining.length}</button>
          <div
            class="camp-card__tag-popover"
            id="${popoverId}"
            role="group"
            aria-label="${camp.name} 其餘特色標籤"
            hidden
          >${remainingTagsHTML}</div>
        `
      : '';

    const imageSrc =
      camp.image ||
      `../../assets/images/camps/${camp.campground_id}/main.webp`;

    // 建立卡片 HTML / Build card HTML
    const cardHTML = `
      <div class="camp-card"
           data-id="${camp.campground_id}"
           data-region="${camp.region}"
           data-env="${camp.environment_tags.join(',')}"
           data-facility="${camp.facility_tags.join(',')}">

        <a href="${detailUrl}" class="camp-card__media" aria-label="查看 ${camp.name} 營區詳情">
          <div class="camp-card__image">
            <img src="${imageSrc}"
                 alt="${camp.name}"
                 loading="lazy"
                 decoding="async">
            <span class="camp-card__badge">${camp.region}</span>
          </div>
        </a>

        <div class="camp-card__body">
          <h3 class="camp-card__name">
            <a href="${detailUrl}" class="camp-card__name-link">${camp.name}</a>
          </h3>
          <p class="camp-card__price">
            平日 <strong>NT$${minWeekdayPrice.toLocaleString()}</strong> 起
          </p>
          <div class="camp-card__tags">
            ${featuredTagsHTML}
            ${moreToggleHTML}
          </div>
          <a href="${detailUrl}" class="camp-card__detail-link">
            查看營區 <span aria-hidden="true">→</span>
          </a>
        </div>

      </div>
    `;

    $grid.append(cardHTML);
  });

  // 更新結果數量 / Update result count
  $('#resultCount').text(`共 ${camps.length} 個營區`);
}

/**
 * 選出卡片預設顯示的代表性標籤與剩餘標籤
 * 規則：先環境第一個、再設施第一個，再依原始順序補滿最多 2 個
 */
function selectCardTags(camp) {
  const envTags = (camp.environment_tags || []).map(function (text) {
    return { text, type: 'env' };
  });
  const facilityTags = (camp.facility_tags || []).map(function (text) {
    return { text, type: 'facility' };
  });

  const allOrdered = uniqueTagEntries(envTags.concat(facilityTags));
  const featured = [];
  const featuredSet = new Set();

  function pushFeatured(entry) {
    if (!entry || featuredSet.has(entry.text) || featured.length >= 2) return;
    featured.push(entry);
    featuredSet.add(entry.text);
  }

  pushFeatured(envTags[0]);
  pushFeatured(facilityTags[0]);

  allOrdered.forEach(function (entry) {
    pushFeatured(entry);
  });

  const remaining = allOrdered.filter(function (entry) {
    return !featuredSet.has(entry.text);
  });

  return { featured, remaining };
}

/**
 * 依標籤文字去重，保留首次出現順序
 */
function uniqueTagEntries(entries) {
  const seen = new Set();
  return entries.filter(function (entry) {
    if (!entry || !entry.text || seen.has(entry.text)) return false;
    seen.add(entry.text);
    return true;
  });
}

/**
 * 單一標籤 HTML
 */
function renderCampTag(entry) {
  const className = entry.type === 'facility' ? 'tag tag--facility' : 'tag tag--env';
  return `<span class="${className}">${entry.text}</span>`;
}

/**
 * 關閉所有卡片 +N 標籤面板
 */
function closeCardTagPopovers() {
  $('.camp-card.is-tags-open').removeClass('is-tags-open');
  $('.camp-card__more-button[aria-expanded="true"]').attr('aria-expanded', 'false');
  $('.camp-card__tag-popover').attr('hidden', true);
}

/**
 * 桌面版校正標籤浮動面板位置，避免超出右側視窗
 */
function positionCardTagPopover($popover) {
  if (!$popover || !$popover.length) return;
  if (window.matchMedia('(max-width: 767px)').matches) {
    $popover.css({ left: '', right: '' });
    return;
  }

  $popover.css({ left: '0', right: 'auto' });
  const rect = $popover[0].getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) {
    $popover.css({ left: 'auto', right: '0' });
  }
}

/**
 * 綁定卡片 +N 標籤展開事件
 */
function bindCardTagEvents() {
  $(document)
    .off('click.campCardTagToggle')
    .on('click.campCardTagToggle', '.camp-card__more-button', function (event) {
      event.preventDefault();
      event.stopPropagation();

      const $button = $(this);
      const isExpanded = $button.attr('aria-expanded') === 'true';
      const targetId = $button.attr('aria-controls');
      const $popover = $('#' + targetId);
      const $card = $button.closest('.camp-card');

      closeCardTagPopovers();
      if (isExpanded || !$popover.length) return;

      $card.addClass('is-tags-open');
      $button.attr('aria-expanded', 'true');
      $popover.attr('hidden', false);
      positionCardTagPopover($popover);
    });

  $(document)
    .off('click.campCardTagOutside')
    .on('click.campCardTagOutside', function (event) {
      if ($(event.target).closest('.camp-card__more-button, .camp-card__tag-popover').length) return;
      closeCardTagPopovers();
    });

  $(document)
    .off('keydown.campCardTagEsc')
    .on('keydown.campCardTagEsc', function (event) {
      if (event.key === 'Escape') closeCardTagPopovers();
    });

  $(window)
    .off('resize.campCardTagPopover')
    .on('resize.campCardTagPopover', function () {
      const $openPopover = $('.camp-card.is-tags-open .camp-card__tag-popover:not([hidden])').first();
      if ($openPopover.length) {
        positionCardTagPopover($openPopover);
      }
    });
}

/**
 * 更新篩選摘要（已選數量與 chips）
 */
function updateFilterMeta() {
  const envValues = $('input[name="env"]:checked').map(function () {
    return $(this).val();
  }).get();
  const facilityValues = $('input[name="facility"]:checked').map(function () {
    return $(this).val();
  }).get();
  const selectedRegion = $('#regionFilter').val();

  const minBudget = parseInt($('#priceMin').val(), 10);
  const maxBudget = parseInt($('#priceMax').val(), 10);
  const hasPriceFilter = minBudget > 500 || maxBudget < 5000;

  const chips = [];
  envValues.forEach(function (v) { chips.push(v); });
  facilityValues.forEach(function (v) { chips.push(v); });
  if (selectedRegion) chips.push(`地區：${selectedRegion}`);
  if (hasPriceFilter) chips.push(`預算：NT$${minBudget.toLocaleString()} - ${maxBudget >= 5000 ? 'NT$5,000+' : `NT$${maxBudget.toLocaleString()}`}`);

  const summaryCount = chips.length;
  $('#selectedFilterSummary').text(`已選 ${summaryCount} 項條件`);
  $('#envFilterCount').text(envValues.length);
  $('#facilityFilterCount').text(facilityValues.length);

  const $chips = $('#selectedFilterChips');
  if ($chips.length) {
    $chips.empty();
    if (chips.length === 0) {
      $chips.append('<span class="filter-chip">尚未選擇</span>');
    } else {
      chips.forEach(function (chip) {
        $chips.append(`<span class="filter-chip">${chip}</span>`);
      });
    }
  }
}

// ============================================================
// 步驟 3：篩選邏輯
// ============================================================

/**
 * 綁定所有篩選器的 change 事件
 * Bind change events for all filter controls
 */
function bindFilterEvents() {
  // Checkbox 變更時觸發篩選 / Trigger filter on checkbox change
  $(document).on('change', 'input[name="env"], input[name="facility"]', filterCampgrounds);

  // 地區下拉選單變更時觸發 / Trigger on region dropdown change
  $('#regionFilter').on('change', filterCampgrounds);

  // 雙滑塊價格篩選器 / Dual-thumb price slider
  initPriceRangeSlider();

  // 重設按鈕 / Reset button
  $('#resetFilterBtn').on('click', function () {
    $('input[name="env"]').prop('checked', false);
    $('input[name="facility"]').prop('checked', false);
    $('#regionFilter').val('');
    $('#priceMin').val(500);
    $('#priceMax').val(5000);
    
    // 如果有選取日期，也可以一併清空
    const datePicker = document.querySelector("#dateRange")._flatpickr;
    if (datePicker) datePicker.clear();
    
    updatePriceSlider();
    filterCampgrounds();
  });
}

/**
 * 初始化 Flatpickr 日期區間選擇器
 * Initialize Flatpickr range datepicker
 */
function initFlatpickrDateRange() {
  flatpickr("#dateRange", {
    mode: "range",
    minDate: "today",
    locale: "zh_tw",
    dateFormat: "Y-m-d",
    onChange: function(selectedDates, dateStr, instance) {
      // 可以在這裡加入針對日期選擇完成後的額外行為
      // 若後續有綁定日期作為篩選條件，可在此呼叫 filterCampgrounds();
    }
  });
}

/**
 * 核心篩選函式：讀取所有勾選條件，過濾 allCampgrounds
 * Core filter function: read all checked conditions, filter allCampgrounds
 *
 * 篩選規則（AND 邏輯）：
 * - 勾選的「環境標籤」：每一項都必須存在於 camp.environment_tags
 * - 勾選的「設施標籤」：每一項都必須存在於 camp.facility_tags
 * - 選擇的「地區」：必須完全匹配 camp.region
 *
 * Filter rule (AND logic):
 * All selected env tags + facility tags + region must ALL match.
 */
function filterCampgrounds() {

  // 取得所有勾選的環境標籤 / Get all checked environment tags
  const checkedEnv = $('input[name="env"]:checked').map(function () {
    return $(this).val();
  }).get();

  // 取得所有勾選的設施標籤 / Get all checked facility tags
  const checkedFacility = $('input[name="facility"]:checked').map(function () {
    return $(this).val();
  }).get();

  // 取得選擇的地區 / Get selected region
  const selectedRegion = $('#regionFilter').val();

  // 過濾陣列 / Filter array
  const filtered = allCampgrounds.filter(function (camp) {

    // 地區篩選：有選才過濾，未選則略過 / Region: filter only if selected
    if (selectedRegion && camp.region !== selectedRegion) return false;

    // 環境標籤：每個勾選的標籤都必須存在於 camp.environment_tags
    // Every checked env tag must be in camp.environment_tags
    const envMatch = checkedEnv.every(tag => camp.environment_tags.includes(tag));
    if (!envMatch) return false;

    // 設施標籤：每個勾選的標籤都必須存在於 camp.facility_tags
    // Every checked facility tag must be in camp.facility_tags
    const facilityMatch = checkedFacility.every(tag => camp.facility_tags.includes(tag));
    if (!facilityMatch) return false;

    // 價格篩選：各 zone 最低平日價須落在 [minBudget, maxBudget] 區間內
    const minBudget = parseInt($('#priceMin').val());
    const maxBudget = parseInt($('#priceMax').val());
    if (minBudget > 500 || maxBudget < 5000) {
      const minWeekdayPrice = Math.min(...camp.zones.map(z => z.price_weekday));
      if (minWeekdayPrice < minBudget || minWeekdayPrice > maxBudget) return false;
    }

    return true; // 全部條件符合 / All conditions met
  });

  renderCampCards(filtered);
  updateFilterMeta();
}

// ============================================================
// 雙滑塊價格篩選器初始化
// ============================================================

/**
 * 建立 dual-thumb range slider：
 * - #priceMin / #priceMax 兩個 <input type="range"> 疊加
 * - #priceRangeFill 依百分比定位，顯示選取區段
 * - #priceRangeDisplay 即時更新文字
 */
function initPriceRangeSlider() {
  const $minEl    = $('#priceMin');
  const $maxEl    = $('#priceMax');
  const $fill     = $('#priceRangeFill');
  const $label    = $('#priceRangeDisplay');
  const TOTAL_MIN = 500;
  const TOTAL_MAX = 5000;

  function pct(val) {
    return (val - TOTAL_MIN) / (TOTAL_MAX - TOTAL_MIN) * 100;
  }

  function update() {
    const minVal = parseInt($minEl.val());
    const maxVal = parseInt($maxEl.val());

    // 填色軌道：left 從 minVal 開始，width 到 maxVal
    $fill.css({
      left:  pct(minVal) + '%',
      width: (pct(maxVal) - pct(minVal)) + '%'
    });

    // 當 min thumb 到達最右時提高 z-index，確保可向左拖曳
    $minEl.css('z-index', minVal >= TOTAL_MAX - 500 ? 5 : 3);

    // 文字顯示
    const maxLabel = maxVal >= TOTAL_MAX ? 'NT$5,000+' : 'NT$' + maxVal.toLocaleString();
    $label.text('NT$' + minVal.toLocaleString() + ' - ' + maxLabel);
  }

  // 暴露給重設按鈕使用
  updatePriceSlider = update;

  $minEl.on('input', function () {
    if (parseInt($minEl.val()) >= parseInt($maxEl.val())) {
      $minEl.val(parseInt($maxEl.val()) - TOTAL_MIN); // 至少保留一格距離
    }
    update();
    filterCampgrounds();
  });

  $maxEl.on('input', function () {
    if (parseInt($maxEl.val()) <= parseInt($minEl.val())) {
      $maxEl.val(parseInt($minEl.val()) + TOTAL_MIN);
    }
    update();
    filterCampgrounds();
  });

  update(); // 初始渲染
}