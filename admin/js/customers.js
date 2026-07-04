/**
 * admin/js/customers.js
 * 客戶管理模組
 * 使用 jQuery Event Namespace (.customers) 防止重複導覽時事件堆疊
 *
 * window.tagColorMap 的鍵值必須與 customers.json 的 tags 陣列完全一致（含中文）
 * inline editing 支援：
 *   - phone / email / birthday / tier / points / tags：可連續編輯多欄，面板底部「確認變更」一次提交（Bootstrap Modal 預覽，不用 alert）
 *   - 手機 / Email / 生日：必填；手機須 09 開頭 10 碼；Email 格式由 validators.js 驗證
 *   - 標籤庫：新增 / 刪除標籤（刪除仍用 confirm）
 * 主列為唯讀摘要（桌面 table / 手機卡片）；展開後才可編輯，儲存後同步更新主列
 * 篩選：會員等級/標籤（欄內 OR，兩欄 AND 疊加）；排序：註冊日期/消費總額（三段式）
 */

// ─────────────────────────────────────────────
// 篩選 / 排序狀態（每次進入會員列表重置）
// ─────────────────────────────────────────────

/** @type {Array<{key: string, dir: 'asc'|'desc'}>} */
var customerSortStack = [];

/** @type {{ tier: string[], tags: string[] }} */
var customerFilterState = {
  tier: [],
  tags: [],
};

var CUSTOMER_DATA_URL = 'data/customers.json';
var CUSTOMER_REQUIRED_SELECTORS = [
  '#customersTable',
  '#customersTableBody',
  '#customersCardList',
  '#customerClearHeader',
  '#btnClearCustomerConditions',
  '#btnClearCustomerConditionsMobile',
  '#customerTagsFilterDropdown',
  '#mobileTagsFilters',
  '#mobileCustomerSort',
];

function getCustomersModuleRoot() {
  return $('.yr-admin-customers-module').first();
}

function renderCustomersRuntimeAlert(message) {
  var $root = getCustomersModuleRoot();
  if (!$root.length) {
    return;
  }

  $root.find('.customers-runtime-alert').remove();
  var html =
    '<div class="alert yr-admin-alert yr-admin-alert--danger customers-runtime-alert mt-3 mb-0" role="alert">' +
    '<i class="fas fa-exclamation-triangle yr-admin-alert__icon me-1" aria-hidden="true"></i>' +
    '<span class="yr-admin-alert__content"><span class="yr-admin-alert__message">' + message + '</span></span>' +
    '</div>';
  var $titleRow = $root.children().first();
  if ($titleRow.length) {
    $titleRow.after(html);
  } else {
    $root.prepend(html);
  }
}

function clearCustomersRuntimeAlert() {
  getCustomersModuleRoot().find('.customers-runtime-alert').remove();
}

function renderCustomersLoadError(message) {
  var errorHtml = message;
  clearCustomersRuntimeAlert();
  renderCustomersRuntimeAlert(errorHtml);
  $('#customersTableBody').html(
    '<tr><td colspan="8" class="text-center py-4 text-danger"><i class="fas fa-exclamation-triangle me-2"></i>' + errorHtml + '</td></tr>'
  );
  $('#customersCardList').html(
    '<div class="alert yr-admin-alert yr-admin-alert--danger m-3 mb-0" role="alert">' +
      '<i class="fas fa-exclamation-triangle yr-admin-alert__icon me-1" aria-hidden="true"></i>' +
      '<span class="yr-admin-alert__content"><span class="yr-admin-alert__message">' + errorHtml + '</span></span>' +
    '</div>'
  );
}

function validateCustomersDom() {
  var missingSelectors = CUSTOMER_REQUIRED_SELECTORS.filter(function (selector) {
    return $(selector).length === 0;
  });
  if (missingSelectors.length === 0) {
    clearCustomersRuntimeAlert();
    return true;
  }

  renderCustomersRuntimeAlert(
    '會員列表介面結構不完整，缺少：' +
      missingSelectors.join(', ')
  );
  return false;
}

function normalizeCustomerRecord(customer) {
  var normalized = $.extend({}, customer);
  normalized.id = normalized.id || '';
  normalized.avatar = normalized.avatar || '';
  normalized.name = normalized.name || '未命名會員';
  normalized.phone = normalized.phone || '';
  normalized.email = normalized.email || '';
  normalized.birthday = normalized.birthday || '';
  normalized.registeredAt = normalized.registeredAt || '';
  normalized.totalSpent = Number(normalized.totalSpent) || 0;
  normalized.tier = normalized.tier || '一般';
  normalized.points = Number(normalized.points) || 0;
  normalized.coupons = Number(normalized.coupons) || 0;
  normalized.tags = Array.isArray(normalized.tags) ? normalized.tags.slice() : [];
  normalized.orders = Array.isArray(normalized.orders) ? normalized.orders.slice() : [];
  return normalized;
}

// ==========================================================================
// Step 1 — 全域標籤顏色對應表
//   改掛在 window 上，讓新增 / 刪除標籤時全頁共用同一份資料
//   || 語法：若已存在（例如切換頁面回來）就保留舊值，不重置
// ==========================================================================
window.tagColorMap = window.tagColorMap || {
  高消費: 'bg-success',
  新會員: 'bg-info text-dark',
  高退貨率: 'bg-danger',
};

/**
 * 產生單一標籤的 Bootstrap badge HTML
 * @param {string} tag - 標籤名稱
 * @returns {string} badge HTML 字串
 */
function getTagBadge(tag) {
  // Step 1 — 改為讀取 window.tagColorMap（可動態增刪）
  var cls = window.tagColorMap[tag] || 'bg-secondary';
  return '<span class="badge ' + cls + ' me-1">' + tag + '</span>';
}

/**
 * 手機顯示格式：去掉 dash 和空格
 * Display phone without dashes or spaces — e.g. "0912-345-678" → "0912345678"
 * @param {string} phone
 * @returns {string}
 */
function formatPhoneDisplay(phone) {
  if (!phone) {
    return '—';
  }
  return String(phone).replace(/[\s-]/g, '');
}

/**
 * 將 ISO 日期轉成 YYYY-MM-DD 顯示（生日、註冊日期等通用）
 * Format ISO date for display — e.g. "2023-08-15"
 * @param {string} isoDate
 * @returns {string}
 */
function formatDateDisplay(isoDate) {
  if (!isoDate) {
    return '—';
  }
  return String(isoDate).slice(0, 10);
}

/**
 * 從展開區的編輯控制項向上找到客戶 ID
 * @param {jQuery} $el
 * @returns {string|undefined}
 */
function getCustomerIdFromDetail($el) {
  return $el.closest('.customer-detail-panel').data('customer-id');
}

/**
 * 編輯儲存後，同步更新主列（桌面 table 列 + 手機卡片）的唯讀顯示
 * @param {string} customerId
 * @param {Object} fields - { phone, email, birthday, tier, tagsHtml }
 */
function syncCustomerMainRow(customerId, fields) {
  var $summary = $('.customer-summary-row[data-customer-id="' + customerId + '"]');
  var $card = $('.customer-mobile-card[data-customer-id="' + customerId + '"]');
  var $details = $('.customer-detail-panel[data-customer-id="' + customerId + '"]');

  if (fields.phone !== undefined) {
    var displayPhone = formatPhoneDisplay(fields.phone);
    $summary.find('.cell-phone').text(displayPhone);
    $card.find('.card-field-phone .card-value').text(displayPhone);
    $details.find('.phone-display').text(displayPhone);
  }
  if (fields.email !== undefined) {
    var emailText = fields.email || '—';
    $summary.find('.cell-email').text(emailText);
    $card.find('.card-field-email .card-value').text(emailText);
    $details.find('.email-display').text(emailText);
  }
  if (fields.birthday !== undefined) {
    var birthdayText = formatDateDisplay(fields.birthday);
    $details.find('.birthday-display').text(birthdayText);
  }
  if (fields.tier !== undefined) {
    var tierText = fields.tier || '一般';
    $summary.find('.cell-tier').text(tierText);
    $card.find('.card-field-tier .card-value').text(tierText);
    $details.find('.tier-display').text(tierText);
  }
  if (fields.tagsHtml !== undefined) {
    $summary.find('.cell-tags').html(fields.tagsHtml);
    $card.find('.card-field-tags .card-value').html(fields.tagsHtml);
    $details.find('.tags-display').html(fields.tagsHtml);
  }
  if (fields.points !== undefined) {
    $details.find('.points-display').text(fields.points);
  }
}

// ─────────────────────────────────────────────
// 批次編輯：快照 / 草稿 / 比對 / 還原
// Batch edit: snapshot, draft, diff, revert
// ─────────────────────────────────────────────

/** 欄位中文名稱（確認 Modal 摘要用） */
var CUSTOMER_FIELD_LABELS = {
  phone: '手機號碼',
  email: '電子信箱',
  birthday: '生日',
  tier: '會員等級',
  points: '點數',
  tags: '標籤',
};

/** 將畫面上的「—」視為空字串 / Treat em dash display as empty */
function normalizeEmptyDisplay(text) {
  var t = String(text || '').trim();
  return t === '—' ? '' : t;
}

/** 手機比對用：只保留數字 / Digits-only phone for diff */
function normalizePhoneValue(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** 生日比對用：統一成 YYYY-MM-DD / Normalize birthday for diff */
function normalizeBirthdayValue(val) {
  var s = normalizeEmptyDisplay(String(val || '').trim());
  if (!s) {
    return '';
  }
  return s.replace(/\//g, '-').slice(0, 10);
}

/** 後台會員手機：09 開頭 10 碼 / Taiwan mobile 09xxxxxxxx */
function isValidAdminCustomerPhone(phone) {
  return /^09\d{8}$/.test(normalizePhoneValue(phone));
}

/**
 * 驗證會員草稿（手機 / Email / 生日必填 + 格式）
 * @param {Object} draft - readCustomerDraftFromPanel 的結果
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateCustomerDraft(draft) {
  var errors = [];

  if (!draft.phone) {
    errors.push('手機號碼不可為空');
  } else if (!isValidAdminCustomerPhone(draft.phone)) {
    errors.push('手機號碼須為 09 開頭的 10 碼數字（例：0912345678）');
  }

  if (!draft.email) {
    errors.push('電子信箱不可為空');
  } else if (typeof window.isValidEmail === 'function' && !window.isValidEmail(draft.email)) {
    errors.push('電子信箱格式不正確');
  }

  if (!draft.birthday) {
    errors.push('生日不可為空');
  }

  return { ok: errors.length === 0, errors: errors };
}

/** 標籤比對用：排序後比較，忽略順序 / Compare tags ignoring order */
function tagsEqual(tagsA, tagsB) {
  var a = (tagsA || []).slice().sort();
  var b = (tagsB || []).slice().sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 從 cache 建立此會員的基準快照 / Baseline snapshot from cache */
function captureCustomerSnapshot(customerId) {
  var customer = (window.customersCache || []).find(function (c) {
    return c.id === customerId;
  });
  if (!customer) {
    return null;
  }
  return {
    phone: normalizePhoneValue(customer.phone),
    email: customer.email || '',
    birthday: normalizeBirthdayValue(customer.birthday),
    tier: customer.tier || '一般',
    points: customer.points || 0,
    tags: (customer.tags || []).slice(),
  };
}

/** 同一會員可能同時存在桌面 + 手機兩份展開 panel */
function getCustomerPanels(customerId) {
  return $('.customer-detail-panel[data-customer-id="' + customerId + '"]');
}

/** 標籤陣列 → badge HTML */
function tagsToHtml(tags) {
  return tags && tags.length > 0
    ? tags.map(getTagBadge).join('')
    : '<span class="text-muted small">無標籤</span>';
}

/** 讀取 panel 上標籤草稿（編輯中讀 checkbox，否則讀 draftTags 或快照） */
function readTagsFromPanel($panel) {
  if ($panel.find('.tags-editor:not(.d-none)').length) {
    var tags = [];
    $panel.find('.tag-checkbox:checked').each(function () {
      tags.push($(this).val());
    });
    return tags;
  }
  var draftTags = $panel.data('draftTags');
  if (draftTags) {
    return draftTags.slice();
  }
  var snapshot = $panel.data('originalSnapshot');
  return snapshot ? snapshot.tags.slice() : [];
}

/** 從 panel DOM 讀取目前草稿值 / Read current draft values from panel DOM */
function readCustomerDraftFromPanel($panel) {
  return {
    phone: $panel.find('.phone-input').length
      ? normalizePhoneValue($panel.find('.phone-input').val())
      : normalizePhoneValue(normalizeEmptyDisplay($panel.find('.phone-display').text())),
    email: $panel.find('.email-input').length
      ? $panel.find('.email-input').val().trim()
      : normalizeEmptyDisplay($panel.find('.email-display').text()),
    birthday: $panel.find('.birthday-input').length
      ? normalizeBirthdayValue($panel.find('.birthday-input').val())
      : normalizeBirthdayValue($panel.find('.birthday-display').text()),
    tier: $panel.find('.tier-select').length
      ? $panel.find('.tier-select').val()
      : $panel.find('.tier-display').text().trim() || '一般',
    points: $panel.find('.points-input').length
      ? parseInt($panel.find('.points-input').val(), 10) || 0
      : parseInt($panel.find('.points-display').text().trim(), 10) || 0,
    tags: readTagsFromPanel($panel),
  };
}

/** 比對快照與草稿，回傳有變更的欄位 / Diff snapshot vs draft */
function diffCustomerDraft(original, draft) {
  var changes = {};
  if (!original || !draft) {
    return changes;
  }
  if (draft.phone !== original.phone) {
    changes.phone = draft.phone;
  }
  if (draft.email !== original.email) {
    changes.email = draft.email;
  }
  var draftBirthday = normalizeBirthdayValue(draft.birthday);
  var originalBirthday = normalizeBirthdayValue(original.birthday);
  if (draftBirthday !== originalBirthday) {
    changes.birthday = draftBirthday;
  }
  if (draft.tier !== original.tier) {
    changes.tier = draft.tier;
  }
  if (draft.points !== original.points) {
    changes.points = draft.points;
  }
  if (!tagsEqual(draft.tags, original.tags)) {
    changes.tags = draft.tags.slice();
  }
  return changes;
}

/** 確認 Modal 摘要：格式化各欄位顯示 */
function formatFieldForSummary(key, value) {
  if (key === 'phone') {
    return formatPhoneDisplay(value);
  }
  if (key === 'email') {
    return value || '—';
  }
  if (key === 'birthday') {
    return formatDateDisplay(value);
  }
  if (key === 'tier') {
    return value || '一般';
  }
  if (key === 'points') {
    return String(value);
  }
  if (key === 'tags') {
    return tagsToHtml(value || []);
  }
  return String(value || '—');
}

/** 產生變更摘要表格 HTML（僅含 changes 內有變更的欄位） */
function buildCustomerChangeSummaryHtml(original, draft, changes) {
  var changeKeys = Object.keys(changes);
  if (changeKeys.length === 0) {
    return '<p class="text-muted small mb-0">沒有變更項目</p>';
  }
  var rows = changeKeys
    .map(function (key) {
      return (
        '<tr>' +
        '<th class="text-muted">' +
        CUSTOMER_FIELD_LABELS[key] +
        '</th>' +
        '<td>' +
        formatFieldForSummary(key, original[key]) +
        '</td>' +
        '<td class="text-success">' +
        formatFieldForSummary(key, draft[key]) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<table class="table table-sm mb-0 customer-change-summary">' +
    '<thead><tr><th>欄位</th><th>原值</th><th>新值</th></tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody>' +
    '</table>'
  );
}

/** 關閉標籤編輯器並更新預覽（不寫入 cache）
 * @param {jQuery} $panel
 * @param {string[]} tags
 * @param {boolean} [persistDraftTags=true] - false 時清除 draftTags（取消還原用）
 */
function closeTagsEditor($panel, tags, persistDraftTags) {
  if (persistDraftTags === undefined) {
    persistDraftTags = true;
  }

  $panel.find('.tags-display').html(tagsToHtml(tags)).show();
  $panel.find('.tags-dropdown-menu').hide();
  $panel.find('.tags-editor').addClass('d-none');
  $panel.find('.tags-done-btn, .tags-cancel-btn').addClass('d-none');
  $panel.find('.tags-edit-btn').show();

  if (persistDraftTags) {
    $panel.data('draftTags', tags.slice());
  } else {
    $panel.removeData('draftTags');
  }
}

/**
 * 還原單一 inline 欄位為唯讀 display（有 input 則移除，無則直接更新 span）
 * Restore one inline field to read-only display
 */
function restoreInlineFieldDisplay(
  $panel,
  wrapSelector,
  inputSelector,
  displayClass,
  displayHtml,
  editBtnSelector
) {
  var $wrap = $panel.find(wrapSelector);
  $wrap.find(inputSelector).remove();
  var $display = $wrap.find('.' + displayClass);
  if ($display.length) {
    $display.replaceWith(displayHtml);
  } else {
    $wrap.find(editBtnSelector).first().before(displayHtml);
  }
  $wrap.find(editBtnSelector).show();
}

/** 依草稿值還原 panel 各欄為唯讀顯示模式
 * @param {Object} [options] - { persistDraftTags: true }
 */
function applyPanelFieldDisplays($panel, draft, options) {
  options = options || {};
  var persistDraftTags = options.persistDraftTags !== false;

  restoreInlineFieldDisplay(
    $panel,
    '.phone-wrap',
    '.phone-input',
    'phone-display',
    '<span class="phone-display">' + formatPhoneDisplay(draft.phone) + '</span>',
    '.phone-edit-btn'
  );
  restoreInlineFieldDisplay(
    $panel,
    '.email-wrap',
    '.email-input',
    'email-display',
    '<span class="email-display">' + (draft.email || '—') + '</span>',
    '.email-edit-btn'
  );
  restoreInlineFieldDisplay(
    $panel,
    '.birthday-wrap',
    '.birthday-input',
    'birthday-display',
    '<span class="birthday-display">' + formatDateDisplay(draft.birthday) + '</span>',
    '.birthday-edit-btn'
  );
  restoreInlineFieldDisplay(
    $panel,
    '.tier-wrap',
    '.tier-select',
    'tier-display',
    '<span class="tier-display">' + (draft.tier || '一般') + '</span>',
    '.tier-edit-btn'
  );
  restoreInlineFieldDisplay(
    $panel,
    '.points-wrap',
    '.points-input',
    'points-display',
    '<span class="points-display">' + draft.points + '</span>',
    '.points-edit-btn'
  );

  closeTagsEditor($panel, draft.tags, persistDraftTags);
}

/** 任一 panel 相對快照是否有未確認變更 / Any panel has pending edits */
function customerPanelHasPendingChanges(customerId) {
  var $panels = getCustomerPanels(customerId);
  if (!$panels.length) {
    return false;
  }

  var hasPending = false;
  $panels.each(function () {
    var original = $(this).data('originalSnapshot');
    if (!original) {
      return;
    }
    var draft = readCustomerDraftFromPanel($(this));
    if (Object.keys(diffCustomerDraft(original, draft)).length > 0) {
      hasPending = true;
      return false;
    }
  });
  return hasPending;
}

/** 顯示 / 隱藏面板底部「確認變更」列（檢查該會員所有 panel） */
function updateCustomerEditActions(customerIdOrPanel) {
  var customerId =
    typeof customerIdOrPanel === 'string' ? customerIdOrPanel : customerIdOrPanel.data('customer-id');
  if (!customerId) {
    return;
  }

  var hasChanges = customerPanelHasPendingChanges(customerId);
  getCustomerPanels(customerId).find('.customer-edit-actions').toggleClass('d-none', !hasChanges);
}

/** 列表渲染後，為每個展開 panel 建立快照 */
function initCustomerPanelSnapshots() {
  $('.customer-detail-panel').each(function () {
    var customerId = $(this).data('customer-id');
    $(this).data('originalSnapshot', captureCustomerSnapshot(customerId));
    $(this).removeData('draftTags');
    $(this).find('.customer-edit-actions').addClass('d-none');
  });
}

/** 還原 panel 至上次確認的快照 */
function revertCustomerPanels(customerId) {
  var $panels = getCustomerPanels(customerId);
  var snapshot = $panels.first().data('originalSnapshot');
  if (!snapshot) {
    return;
  }

  $panels.each(function () {
    applyPanelFieldDisplays($(this), snapshot, { persistDraftTags: false });
  });
  updateCustomerEditActions(customerId);
}

/** 一次提交草稿至 cache 並同步 UI */
function commitCustomerDraft(customerId, draft, changes) {
  var customer = (window.customersCache || []).find(function (c) {
    return c.id === customerId;
  });
  if (!customer) {
    return;
  }

  Object.keys(changes).forEach(function (key) {
    customer[key] = draft[key];
  });

  var syncFields = {};
  if (changes.phone) {
    syncFields.phone = draft.phone;
  }
  if (changes.email) {
    syncFields.email = draft.email;
  }
  if (changes.birthday) {
    syncFields.birthday = draft.birthday;
  }
  if (changes.tier) {
    syncFields.tier = draft.tier;
  }
  if (changes.points) {
    syncFields.points = draft.points;
  }
  if (changes.tags) {
    syncFields.tagsHtml = tagsToHtml(draft.tags);
  }

  syncCustomerMainRow(customerId, syncFields);

  var newSnapshot = captureCustomerSnapshot(customerId);
  getCustomerPanels(customerId).each(function () {
    $(this).data('originalSnapshot', newSnapshot);
    applyPanelFieldDisplays($(this), draft, { persistDraftTags: false });
  });

  updateCustomerEditActions(customerId);
  window.showAdminToast('客戶 ' + customerId + ' 資料已更新');

  if (changes.tier || changes.tags) {
    applyCustomerFiltersAndSort();
  }
  // TODO: PATCH /api/customers/:id  { ...changes }
}

// ==========================================================================
// Step 3 — buildTagsDropdown：依 window.tagColorMap 產生 checkbox 清單
// ==========================================================================
/**
 * 依據 window.tagColorMap 動態產生標籤 checkbox 清單的 HTML
 * @param {string[]} currentTags - 此客戶目前已有的標籤（會預先勾選）
 * @returns {string} 填入 .tags-checkbox-list 的 HTML 字串
 */
function buildTagsDropdown(currentTags) {
  var keys = Object.keys(window.tagColorMap);
  if (keys.length === 0) {
    return '<div class="text-muted small py-1 px-1">尚無可用標籤，請在下方新增</div>';
  }
  return keys
    .map(function (tag) {
      var cls = window.tagColorMap[tag];
      var checked = currentTags.indexOf(tag) !== -1 ? ' checked' : '';
      // 對標籤名稱做基本跳脫，防止特殊字元破壞 HTML 結構
      var safeTag = tag
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return (
        '<div class="d-flex align-items-center gap-2 py-1 px-1">' +
        '<input type="checkbox" class="form-check-input tag-checkbox flex-shrink-0" ' +
        'value="' +
        safeTag +
        '"' +
        checked +
        '>' +
        '<span class="flex-grow-1">' +
        '<span class="badge ' +
        cls +
        '">' +
        safeTag +
        '</span>' +
        '</span>' +
        '<button type="button" class="btn btn-link btn-sm p-0 tag-delete-btn" ' +
        'data-tag="' +
        safeTag +
        '" title="從標籤庫刪除此標籤">' +
        '<i class="fas fa-times text-danger" style="font-size:0.75rem"></i>' +
        '</button>' +
        '</div>'
      );
    })
    .join('');
}

// ==========================================================================
// Step 8 — refreshAllCustomerTagsDisplay：全域同步所有客戶的標籤顯示
// ==========================================================================
/**
 * 遍歷所有客戶 DOM，依據 window.customersCache 同步更新標籤顯示
 * 呼叫時機：刪除標籤後，讓所有已渲染客戶即時反映最新狀態
 */
function refreshAllCustomerTagsDisplay() {
  applyCustomerFiltersAndSort();
}

// ==========================================================================
// 篩選 / 排序管線
// ==========================================================================

/**
 * 依 tagColorMap 重建桌面/手機的標籤篩選選項
 */
function buildCustomerTagsFilterOptions() {
  var tags = Object.keys(window.tagColorMap);
  var desktopHtml = tags
    .map(function (tag) {
      var safe = tag.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return '<label><input type="checkbox" value="' + safe + '"> ' + tag + '</label>';
    })
    .join('');
  if (!desktopHtml) {
    desktopHtml = '<div class="text-muted small px-2 py-1">尚無可用標籤</div>';
  }
  $('#customerTagsFilterDropdown').html(desktopHtml);

  var mobileHtml = tags
    .map(function (tag) {
      var safe = tag.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return (
        '<label class="small"><input type="checkbox" class="mobile-tags-cb" value="' +
        safe +
        '"> ' +
        tag +
        '</label>'
      );
    })
    .join('');
  if (!mobileHtml) {
    mobileHtml = '<span class="text-muted small">尚無可用標籤</span>';
  }
  $('#mobileTagsFilters').html(mobileHtml);

  syncCustomerFilterCheckboxes();
}

/**
 * 同步 filterState 到桌面/手機 checkbox 勾選狀態
 */
function syncCustomerFilterCheckboxes() {
  $('#customersTable .filter-th[data-filter-key="tier"] input').each(function () {
    $(this).prop('checked', customerFilterState.tier.indexOf($(this).val()) !== -1);
  });
  $('#customerTagsFilterDropdown input, #mobileTagsFilters input').each(function () {
    $(this).prop('checked', customerFilterState.tags.indexOf($(this).val()) !== -1);
  });
  $('.mobile-tier-cb').each(function () {
    $(this).prop('checked', customerFilterState.tier.indexOf($(this).val()) !== -1);
  });

  var sortEntry = customerSortStack.find(function (s) {
    return s.key === 'totalSpent';
  });
  var sortVal = sortEntry ? sortEntry.dir : '';
  $('#mobileCustomerSort').val(sortVal);
}

/**
 * 更新排序 icon 顯示
 */
function updateCustomerSortUI() {
  $('#customersTable .sort-icon').removeClass('fa-sort-up fa-sort-down sort-active').addClass('fa-sort');

  customerSortStack.forEach(function (s) {
    $('#customersTable .sortable-th[data-sort-key="' + s.key + '"] .sort-icon')
      .removeClass('fa-sort')
      .addClass(s.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down')
      .addClass('sort-active');
  });
}

/**
 * 更新漏斗 icon、紅點
 */
function updateCustomerFilterUI() {
  ['tier', 'tags'].forEach(function (key) {
    var $th = $('#customersTable .filter-th[data-filter-key="' + key + '"]');
    if (!$th.length) {
      return;
    }
    if (customerFilterState[key].length > 0) {
      $th.find('.filter-icon').addClass('active');
      $th.find('.filter-dot').removeClass('d-none');
      $th.find('input[type="checkbox"]').each(function () {
        $(this).prop('checked', customerFilterState[key].indexOf($(this).val()) !== -1);
      });
    } else {
      $th.find('.filter-icon').removeClass('active');
      $th.find('.filter-dot').addClass('d-none');
      $th.find('input[type="checkbox"]').prop('checked', false);
    }
  });

  syncCustomerFilterCheckboxes();
}

/**
 * 有篩選或排序時顯示「清除條件」按鈕
 */
function updateCustomerClearButtonUI() {
  var hasFilter = customerFilterState.tier.length > 0 || customerFilterState.tags.length > 0;
  var hasSort = customerSortStack.length > 0;
  var showBtn = hasFilter || hasSort;

  $('#btnClearCustomerConditions, #btnClearCustomerConditionsMobile').toggleClass('d-none', !showBtn);
  // 桌面 card-header 僅在有條件時顯示，避免空白工具列
  $('#customerClearHeader').toggleClass('d-md-flex', showBtn);
}

/**
 * 依欄位型別比較兩筆客戶資料（供排序用）
 * Compare customer field values for sorting
 * @param {string} key - 欄位名稱
 * @param {*} valA
 * @param {*} valB
 * @returns {number} -1 | 0 | 1
 */
function compareCustomerValues(key, valA, valB) {
  if (key === 'totalSpent') {
    var numA = Number(valA) || 0;
    var numB = Number(valB) || 0;
    if (numA < numB) {
      return -1;
    }
    if (numA > numB) {
      return 1;
    }
    return 0;
  }
  // 日期 / 字串欄：registeredAt（ISO YYYY-MM-DD 可直接字串比較）
  var strA = String(valA || '');
  var strB = String(valB || '');
  if (strA < strB) {
    return -1;
  }
  if (strA > strB) {
    return 1;
  }
  return 0;
}

/**
 * 先篩選再排序，然後重新渲染列表
 */
function applyCustomerFiltersAndSort() {
  var data = (window.customersCache || []).slice();

  // 會員等級 OR
  if (customerFilterState.tier.length > 0) {
    data = data.filter(function (c) {
      var tier = c.tier || '一般';
      return customerFilterState.tier.indexOf(tier) !== -1;
    });
  }

  // 標籤 OR（至少含一個已勾選標籤）
  if (customerFilterState.tags.length > 0) {
    data = data.filter(function (c) {
      var customerTags = c.tags || [];
      return customerFilterState.tags.some(function (selected) {
        return customerTags.indexOf(selected) !== -1;
      });
    });
  }

  // 註冊日期 / 消費總額排序
  if (customerSortStack.length > 0) {
    data.sort(function (a, b) {
      for (var i = 0; i < customerSortStack.length; i++) {
        var key = customerSortStack[i].key;
        var dir = customerSortStack[i].dir === 'asc' ? 1 : -1;
        var cmp = compareCustomerValues(key, a[key], b[key]);
        if (cmp !== 0) {
          return cmp * dir;
        }
      }
      return 0;
    });
  }

  renderCustomersList(data);
  updateCustomerSortUI();
  updateCustomerFilterUI();
  updateCustomerClearButtonUI();
}

/**
 * 從桌面或手機 checkbox 收集某一欄的篩選值
 * 只讀觸發來源那一側，避免桌面/手機重複 UI 導致無法取消勾選
 * @param {string} key - 'tier' | 'tags'
 * @param {'desktop'|'mobile'} source - 觸發 change 的來源
 */
function collectCustomerFilterFromUI(key, source) {
  var selected = [];
  var $inputs;

  if (key === 'tier') {
    $inputs =
      source === 'mobile'
        ? $('.mobile-tier-cb:checked')
        : $('#customersTable .filter-th[data-filter-key="tier"] .filter-dropdown input:checked');
  } else if (key === 'tags') {
    $inputs =
      source === 'mobile'
        ? $('#mobileTagsFilters .mobile-tags-cb:checked')
        : $('#customerTagsFilterDropdown input:checked');
  }

  if ($inputs) {
    $inputs.each(function () {
      var v = $(this).val();
      if (selected.indexOf(v) === -1) {
        selected.push(v);
      }
    });
  }
  customerFilterState[key] = selected;
  syncCustomerFilterCheckboxes();
}

// ==========================================================================
// initCustomers — 頁面初始化進入點
// ==========================================================================
window.initCustomers = function () {
  // 清除舊的事件綁定，防止重複導覽時事件堆疊
  // 同時清除其他模組：orders/bookings 使用全域 .sortable-th 選擇器，殘留會干擾本頁
  $(document).off('.customers');
  $(document).off('.orders');
  $(document).off('.bookings');
  $(document).off('.movement');

  // 每次進入重置篩選與排序
  customerSortStack = [];
  customerFilterState = { tier: [], tags: [] };

  if (!validateCustomersDom()) {
    window.customersCache = [];
    return;
  }

  buildCustomerTagsFilterOptions();

  // 載入客戶資料並渲染列表
  $.getJSON(CUSTOMER_DATA_URL, function (customers) {
    if (!Array.isArray(customers)) {
      window.customersCache = [];
      renderCustomersLoadError('會員資料格式錯誤，無法顯示列表');
      return;
    }
    clearCustomersRuntimeAlert();
    window.customersCache = customers.map(normalizeCustomerRecord);
    applyCustomerFiltersAndSort();
  }).fail(function (jqXHR, textStatus, errorThrown) {
    var detailParts = [CUSTOMER_DATA_URL];
    if (jqXHR && jqXHR.status) {
      detailParts.push('HTTP ' + jqXHR.status);
    }
    if (errorThrown) {
      detailParts.push(errorThrown);
    } else if (textStatus) {
      detailParts.push(textStatus);
    }
    renderCustomersLoadError('載入會員資料失敗（' + detailParts.join(' / ') + '）');
  });

  // ── 排序：點擊消費總額表頭（三段式 asc → desc → 取消）──
  $(document).on('click.customers', '#customersTable .sortable-th', function () {
    var key = $(this).data('sort-key');
    var idx = customerSortStack.findIndex(function (s) {
      return s.key === key;
    });
    if (idx === -1) {
      customerSortStack.push({ key: key, dir: 'asc' });
    } else if (customerSortStack[idx].dir === 'asc') {
      customerSortStack[idx].dir = 'desc';
    } else {
      customerSortStack.splice(idx, 1);
    }
    applyCustomerFiltersAndSort();
  });

  // ── 篩選：桌面漏斗 dropdown ──
  $(document).on('click.customers', '#customersTable .filter-icon', function (e) {
    e.stopPropagation();
    var $dropdown = $(this).closest('.filter-th').find('.filter-dropdown');
    $('#customersTable .filter-dropdown').not($dropdown).addClass('d-none');
    $dropdown.toggleClass('d-none');
  });

  $(document).on('click.customers', '#customersTable .filter-dropdown', function (e) {
    e.stopPropagation();
  });

  $(document).on('change.customers', '#customersTable .filter-dropdown input[type="checkbox"]', function () {
    var key = $(this).closest('.filter-th').data('filter-key');
    collectCustomerFilterFromUI(key, 'desktop');
    applyCustomerFiltersAndSort();
  });

  // ── 篩選 / 排序：手機版 ──
  $(document).on('change.customers', '.mobile-tier-cb', function () {
    collectCustomerFilterFromUI('tier', 'mobile');
    applyCustomerFiltersAndSort();
  });

  $(document).on('change.customers', '.mobile-tags-cb', function () {
    collectCustomerFilterFromUI('tags', 'mobile');
    applyCustomerFiltersAndSort();
  });

  $(document).on('change.customers', '#mobileCustomerSort', function () {
    var val = $(this).val();
    customerSortStack = customerSortStack.filter(function (s) {
      return s.key !== 'totalSpent';
    });
    if (val === 'asc' || val === 'desc') {
      customerSortStack.push({ key: 'totalSpent', dir: val });
    }
    applyCustomerFiltersAndSort();
  });

  // ── 清除條件：同時重置篩選 + 排序 ──
  $(document).on(
    'click.customers',
    '#btnClearCustomerConditions, #btnClearCustomerConditionsMobile',
    function () {
      customerFilterState = { tier: [], tags: [] };
      customerSortStack = [];
      applyCustomerFiltersAndSort();
    }
  );

  // 點擊頁面其他地方 → 關閉桌面篩選 dropdown + 標籤編輯 dropdown
  $(document).on('click.customers', function () {
    $('#customersTable .filter-dropdown').addClass('d-none');
    $('.tags-dropdown-menu').hide();
  });

  // 展開區點擊不冒泡（避免誤觸收合）
  $(document).on('click.customers', '.customer-detail-panel', function (e) {
    e.stopPropagation();
  });

  // === Enter 鍵 → 開啟確認變更（批次提交）===
  $(document).on(
    'keydown.customers',
    '.phone-input, .email-input, .birthday-input, .tier-select, .points-input',
    function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        $(this).closest('.customer-detail-panel').find('.customer-edit-confirm-btn').trigger('click');
      }
    }
  );

  // 欄位值變更 → 更新「確認變更」按鈕顯示
  $(document).on(
    'input change.customers',
    '.customer-detail-panel .phone-input, .customer-detail-panel .email-input, ' +
      '.customer-detail-panel .birthday-input, .customer-detail-panel .tier-select, ' +
      '.customer-detail-panel .points-input, .customer-detail-panel .tag-checkbox',
    function () {
      updateCustomerEditActions($(this).closest('.customer-detail-panel'));
    }
  );

  // === 手機 inline 編輯（僅進入編輯，不立即儲存）===
  $(document).on('click.customers', '.phone-edit-btn', function () {
    var $wrap = $(this).closest('.phone-wrap');
    var $panel = $(this).closest('.customer-detail-panel');
    var current = normalizePhoneValue($wrap.find('.phone-display').text());

    $wrap
      .find('.phone-display')
      .replaceWith(
        '<input type="tel" class="form-control form-control-sm phone-input d-inline-block" ' +
          'value="' +
          current +
          '" maxlength="10" inputmode="numeric" pattern="09[0-9]{8}" ' +
          'placeholder="0912345678" required style="width:112px">'
      );
    $(this).hide();
    $wrap.find('.phone-input').focus();
    updateCustomerEditActions($panel);
  });

  // === Email inline 編輯 ===
  $(document).on('click.customers', '.email-edit-btn', function () {
    var $wrap = $(this).closest('.email-wrap');
    var $panel = $(this).closest('.customer-detail-panel');
    var current = $wrap.find('.email-display').text().trim();
    if (current === '—') {
      current = '';
    }

    $wrap
      .find('.email-display')
      .replaceWith(
        '<input type="email" class="form-control form-control-sm email-input d-inline-block" ' +
          'value="' +
          current +
          '" placeholder="name@example.com" required style="width:160px">'
      );
    $(this).hide();
    $wrap.find('.email-input').focus();
    updateCustomerEditActions($panel);
  });

  // === 生日 inline 編輯 ===
  $(document).on('click.customers', '.birthday-edit-btn', function () {
    var $wrap = $(this).closest('.birthday-wrap');
    var $panel = $(this).closest('.customer-detail-panel');
    var current = normalizeBirthdayValue($wrap.find('.birthday-display').text());

    $wrap
      .find('.birthday-display')
      .replaceWith(
        '<input type="date" class="form-control form-control-sm birthday-input d-inline-block" ' +
          'value="' +
          current +
          '" required style="width:112px">'
      );
    $(this).hide();
    $wrap.find('.birthday-input').focus();
    updateCustomerEditActions($panel);
  });

  // === 會員等級 inline 編輯 ===
  $(document).on('click.customers', '.tier-edit-btn', function () {
    var $wrap = $(this).closest('.tier-wrap');
    var $panel = $(this).closest('.customer-detail-panel');
    var $span = $(this).siblings('.tier-display');
    var currentTier = $span.text().trim();
    $span.replaceWith(
      '<select class="form-select form-select-sm tier-select d-inline-block" style="width:auto">' +
        '<option value="一般"' +
        (currentTier === '一般' ? ' selected' : '') +
        '>一般</option>' +
        '<option value="VIP"' +
        (currentTier === 'VIP' ? ' selected' : '') +
        '>VIP</option>' +
        '<option value="SVIP"' +
        (currentTier === 'SVIP' ? ' selected' : '') +
        '>SVIP</option>' +
        '</select>'
    );
    $(this).hide();
    updateCustomerEditActions($panel);
  });

  // === 點數 inline 編輯 ===
  $(document).on('click.customers', '.points-edit-btn', function () {
    var $span = $(this).siblings('.points-display');
    var $panel = $(this).closest('.customer-detail-panel');
    var current = parseInt($span.text().trim(), 10) || 0;
    $span.replaceWith(
      '<input type="number" class="form-control form-control-sm points-input d-inline-block" ' +
        'value="' +
        current +
        '" min="0" style="width:64px">'
    );
    $(this).hide();
    var $wrap = $(this).closest('.points-wrap');
    $wrap.find('.points-input').focus();
    updateCustomerEditActions($panel);
  });

  // === 面板：取消全部編輯 ===
  $(document).on('click.customers', '.customer-edit-cancel-all-btn', function () {
    var customerId = $(this).closest('.customer-detail-panel').data('customer-id');
    revertCustomerPanels(customerId);
  });

  // === 面板：確認變更 → 開 Modal 預覽 ===
  $(document).on('click.customers', '.customer-edit-confirm-btn', function () {
    var $panel = $(this).closest('.customer-detail-panel');
    var customerId = $panel.data('customer-id');
    var original = $panel.data('originalSnapshot');
    var draft = readCustomerDraftFromPanel($panel);
    var changes = diffCustomerDraft(original, draft);

    if (Object.keys(changes).length === 0) {
      window.showAdminToast('沒有需要儲存的變更', 'info');
      return;
    }

    var validation = validateCustomerDraft(draft);
    if (!validation.ok) {
      window.showAdminToast(validation.errors[0], 'error');
      return;
    }

    window.pendingCustomerEdit = { customerId: customerId, draft: draft, changes: changes };
    $('#customerEditChangeSummary').html(buildCustomerChangeSummaryHtml(original, draft, changes));

    var modalEl = document.getElementById('customerEditConfirmModal');
    if (modalEl) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  });

  // === Modal：確認儲存（一次提交）===
  $(document).on('click.customers', '#customerEditConfirmBtn', function () {
    var pending = window.pendingCustomerEdit;
    if (!pending) {
      return;
    }

    var validation = validateCustomerDraft(pending.draft);
    if (!validation.ok) {
      window.showAdminToast(validation.errors[0], 'error');
      return;
    }

    commitCustomerDraft(pending.customerId, pending.draft, pending.changes);

    var modalEl = document.getElementById('customerEditConfirmModal');
    if (modalEl) {
      var modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) {
        modal.hide();
      }
    }
    window.pendingCustomerEdit = null;
  });

  // ==========================================================================
  // 標籤 inline 編輯：進入 / 完成選擇 / 取消
  // ==========================================================================

  $(document).on('click.customers', '.tags-edit-btn', function () {
    var $wrap = $(this).closest('.tags-wrap');
    var $panel = $(this).closest('.customer-detail-panel');
    var currentTags = readTagsFromPanel($panel);

    $wrap.find('.tags-checkbox-list').html(buildTagsDropdown(currentTags));
    $wrap.find('.tags-display').hide();
    $(this).hide();
    $wrap.find('.tags-editor').removeClass('d-none');
    $wrap.find('.tags-done-btn, .tags-cancel-btn').removeClass('d-none');
  });

  // 點下拉觸發按鈕 → 切換（toggle）下拉選單
  $(document).on('click.customers', '.tags-dropdown-toggle', function (e) {
    e.stopPropagation();
    var $menu = $(this).closest('.tags-editor').find('.tags-dropdown-menu');
    $menu.toggle();
  });

  $(document).on('click.customers', '.tags-dropdown-menu', function (e) {
    e.stopPropagation();
  });

  $(document).on('click.customers', '.tags-editor', function (e) {
    e.stopPropagation();
  });

  // 完成選擇：更新預覽，不寫 cache
  $(document).on('click.customers', '.tags-done-btn', function () {
    var $panel = $(this).closest('.customer-detail-panel');
    var customerId = $panel.data('customer-id');
    var newTags = [];
    $panel.find('.tag-checkbox:checked').each(function () {
      newTags.push($(this).val());
    });

    getCustomerPanels(customerId).each(function () {
      closeTagsEditor($(this), newTags);
    });
    updateCustomerEditActions($panel);
  });

  // 取消標籤編輯：還原至快照
  $(document).on('click.customers', '.tags-cancel-btn', function () {
    var $panel = $(this).closest('.customer-detail-panel');
    var customerId = $panel.data('customer-id');
    var snapshot = $panel.data('originalSnapshot');
    var tags = snapshot ? snapshot.tags.slice() : [];

    getCustomerPanels(customerId).each(function () {
      closeTagsEditor($(this), tags, false);
    });
    updateCustomerEditActions(customerId);
  });

  // ==========================================================================
  // Step 6 — 新增標籤到標籤庫
  // ==========================================================================
  $(document).on('click.customers', '.tag-add-btn', function (e) {
    e.stopPropagation(); // 阻止冒泡，避免觸發外部點擊關閉
    var $wrap = $(this).closest('.tags-wrap');
    var rawName = $wrap.find('.new-tag-input').val().trim();
    var newColor = $wrap.find('.new-tag-color').val();

    // 過濾可能造成 XSS 的特殊字元
    var newName = rawName.replace(/[<>"&]/g, '');

    if (!newName) {
      window.showAdminToast('標籤名稱不能為空');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(window.tagColorMap, newName)) {
      window.showAdminToast('標籤「' + newName + '」已存在');
      return;
    }

    // 新增到全域標籤池
    window.tagColorMap[newName] = newColor;

    // 保留目前已勾選的狀態，重建 checkbox 清單
    var checkedTags = [];
    $wrap.find('.tag-checkbox:checked').each(function () {
      checkedTags.push($(this).val());
    });
    $wrap.find('.tags-checkbox-list').html(buildTagsDropdown(checkedTags));

    // 清空輸入欄位
    $wrap.find('.new-tag-input').val('');

    buildCustomerTagsFilterOptions();

    // TODO: PUT /api/tag-pool  { tagColorMap: window.tagColorMap }
    window.showAdminToast('標籤「' + newName + '」已新增');
  });

  // ==========================================================================
  // Step 7 — 從標籤庫刪除標籤（同步移除所有客戶身上的此標籤）
  // ==========================================================================
  $(document).on('click.customers', '.tag-delete-btn', function (e) {
    e.stopPropagation(); // 阻止冒泡，避免觸發外部點擊關閉
    var tagName = $(this).data('tag');

    if (!window.confirm('確定要刪除標籤「' + tagName + '」嗎？\n這將移除所有客戶身上的此標籤。')) {
      return;
    }

    // 從全域標籤池刪除
    delete window.tagColorMap[tagName];

    // 從所有客戶的 tags 陣列移除
    if (window.customersCache) {
      window.customersCache.forEach(function (c) {
        if (c.tags) {
          c.tags = c.tags.filter(function (t) {
            return t !== tagName;
          });
        }
      });
    }

    // 從篩選條件移除已刪除的標籤
    customerFilterState.tags = customerFilterState.tags.filter(function (t) {
      return t !== tagName;
    });

    buildCustomerTagsFilterOptions();

    // 保留其他已勾選狀態（排除剛刪掉的），重建 checkbox 清單
    var $wrap = $(this).closest('.tags-wrap');
    var checkedTags = [];
    $wrap.find('.tag-checkbox:checked').each(function () {
      var v = $(this).val();
      if (v !== tagName) {
        checkedTags.push(v);
      }
    });
    $wrap.find('.tags-checkbox-list').html(buildTagsDropdown(checkedTags));

    applyCustomerFiltersAndSort();

    // TODO: PUT /api/tag-pool  { tagColorMap: window.tagColorMap }
    window.showAdminToast('標籤「' + tagName + '」已刪除');
  });

  // === 購買記錄：點擊訂單 ID 開啟訂單明細 Modal ===
  // 若 ordersCache 已存在（曾進過訂單管理頁）就直接用；否則先 fetch orders.json
  $(document).on('click.customers', '.customer-order-link', function () {
    var orderId = $(this).data('order-id');

    function openModal(orders) {
      var order = orders.find(function (o) {
        return o.id === orderId;
      });
      if (!order) {
        window.showAdminToast('找不到訂單 ' + orderId + ' 的資料');
        return;
      }
      window.showOrderModal(order);
    }

    if (window.ordersCache && window.ordersCache.length > 0) {
      openModal(window.ordersCache);
    } else {
      $.getJSON('data/orders.json', function (orders) {
        window.ordersCache = orders; // 存入全域快取，後續不需重複 fetch
        openModal(orders);
      }).fail(function () {
        window.showAdminToast('載入訂單資料失敗，請稍後再試');
      });
    }
  });
};

// ==========================================================================
// 展開區 HTML 建構 helper
// ==========================================================================

var EDIT_BTN_ICON = '<i class="fas fa-pencil-alt text-secondary"></i>';

/**
 * 產生標籤列 HTML（展開區可 inline 編輯）
 */
function buildTagsRowHtml(customerId, tagsHtml) {
  return (
    '<tr>' +
    '<th class="text-muted">標籤</th>' +
    '<td>' +
    '<div class="tags-wrap d-flex align-items-center gap-2 flex-wrap" ' +
    'data-customer-id="' +
    customerId +
    '">' +
    '<span class="tags-display">' +
    tagsHtml +
    '</span>' +
    '<button type="button" class="btn btn-link btn-sm p-0 ms-1 tags-edit-btn" title="編輯標籤">' +
    EDIT_BTN_ICON +
    '</button>' +
    '<div class="tags-editor d-none">' +
    '<div class="position-relative d-inline-block">' +
    '<button type="button" class="btn btn-outline-secondary btn-sm tags-dropdown-toggle">' +
    '選擇標籤 <i class="fas fa-chevron-down ms-1"></i>' +
    '</button>' +
    '<div class="tags-dropdown-menu position-absolute bg-white border rounded shadow-sm p-2" ' +
    'style="min-width:176px; z-index:1050; top:calc(100% + 4px); left:0; display:none;">' +
    '<div class="tags-checkbox-list"></div>' +
    '<hr class="my-2">' +
    '<div class="d-flex gap-1 align-items-center">' +
    '<input type="text" class="form-control form-control-sm new-tag-input" ' +
    'placeholder="新標籤名稱" style="flex:1; min-width:60px">' +
    '<select class="form-select form-select-sm new-tag-color" style="width:60px">' +
    '<option value="bg-warning text-dark">🟡 黃</option>' +
    '<option value="bg-success">🟢 綠</option>' +
    '<option value="bg-danger">🔴 紅</option>' +
    '<option value="bg-info text-dark">🔵 藍</option>' +
    '<option value="bg-primary">🟣 靛</option>' +
    '<option value="bg-secondary" selected>⚫ 灰</option>' +
    '<option value="bg-dark">⬛ 深</option>' +
    '</select>' +
    '<button type="button" class="btn btn-sm btn-success tag-add-btn" title="新增標籤">' +
    '<i class="fas fa-plus"></i>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<button type="button" class="btn btn-sm btn-outline-success tags-done-btn d-none py-0 px-2" title="完成選擇">' +
    '完成' +
    '</button>' +
    '<button type="button" class="btn btn-sm btn-secondary tags-cancel-btn d-none py-0 px-1" title="取消編輯">' +
    '<i class="fas fa-times"></i>' +
    '</button>' +
    '</div>' +
    '</td>' +
    '</tr>'
  );
}

/**
 * 產生展開區完整 HTML（手機/Email/生日/註冊日期/等級/點數/標籤/購買紀錄）
 */
function buildDetailPanelHtml(
  c,
  phoneDisplay,
  emailDisplay,
  birthdayDisplay,
  registeredDisplay,
  tierDisplay,
  tagsHtml,
  ordersHtml
) {
  return (
    '<div class="customer-detail-panel" data-customer-id="' +
    c.id +
    '">' +
    '<table class="table table-sm mb-0 customer-detail-table"><tbody>' +
    '<tr>' +
    '<th class="text-muted" style="width:72px">手機號碼</th>' +
    '<td>' +
    '<div class="phone-wrap d-flex align-items-center gap-1">' +
    '<span class="phone-display">' +
    phoneDisplay +
    '</span>' +
    '<button class="btn btn-link btn-sm p-0 phone-edit-btn" title="編輯手機">' +
    EDIT_BTN_ICON +
    '</button>' +
    '</div>' +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="text-muted">電子信箱</th>' +
    '<td>' +
    '<div class="email-wrap d-flex align-items-center gap-1">' +
    '<span class="email-display">' +
    emailDisplay +
    '</span>' +
    '<button class="btn btn-link btn-sm p-0 email-edit-btn" title="編輯 Email">' +
    EDIT_BTN_ICON +
    '</button>' +
    '</div>' +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="text-muted">生日</th>' +
    '<td>' +
    '<div class="birthday-wrap d-flex align-items-center gap-1">' +
    '<span class="birthday-display">' +
    birthdayDisplay +
    '</span>' +
    '<button class="btn btn-link btn-sm p-0 birthday-edit-btn" title="編輯生日">' +
    EDIT_BTN_ICON +
    '</button>' +
    '</div>' +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="text-muted">註冊日期</th>' +
    '<td><span class="registered-display">' +
    registeredDisplay +
    '</span></td>' +
    '</tr>' +
    '<tr>' +
    '<th class="text-muted">會員等級</th>' +
    '<td>' +
    '<div class="tier-wrap d-flex align-items-center gap-1">' +
    '<span class="tier-display">' +
    tierDisplay +
    '</span>' +
    '<button class="btn btn-link btn-sm p-0 tier-edit-btn">' +
    EDIT_BTN_ICON +
    '</button>' +
    '</div>' +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<th class="text-muted">點數</th>' +
    '<td>' +
    '<div class="points-wrap d-flex align-items-center gap-1">' +
    '<span class="points-display">' +
    (c.points || 0) +
    '</span>' +
    '<button class="btn btn-link btn-sm p-0 points-edit-btn">' +
    EDIT_BTN_ICON +
    '</button>' +
    '</div>' +
    '</td>' +
    '</tr>' +
    buildTagsRowHtml(c.id, tagsHtml) +
    '</tbody></table>' +
    '<div class="customer-edit-actions d-none d-flex gap-2 justify-content-end border-top pt-3">' +
    '<button type="button" class="btn btn-sm btn-outline-secondary customer-edit-cancel-all-btn">' +
    '取消編輯' +
    '</button>' +
    '<button type="button" class="btn btn-sm btn-success customer-edit-confirm-btn">' +
    '<i class="fas fa-check me-1"></i>確認變更' +
    '</button>' +
    '</div>' +
    '<p class="mb-1 mt-3 fw-semibold small text-muted">購買記錄</p>' +
    '<ul class="list-group list-group-flush mb-0">' +
    ordersHtml +
    '</ul>' +
    '</div>'
  );
}

/**
 * 綁定表格 collapse 展開/收合樣式
 */
function bindCustomerCollapseEvents() {
  $('#customersTableBody').off('show.bs.collapse hide.bs.collapse');

  $('#customersTableBody').on('show.bs.collapse', '.collapse', function () {
    var $target = $(this);
    // 收合其他已展開列
    $('#customersTableBody .collapse.show')
      .not($target)
      .each(function () {
        bootstrap.Collapse.getOrCreateInstance(this, { toggle: false }).hide();
      });
    var customerId = this.id.replace('collapse-', '');
    $('.customer-summary-row').removeClass('is-expanded');
    $('.customer-summary-row[data-customer-id="' + customerId + '"]').addClass('is-expanded');
  });

  $('#customersTableBody').on('hide.bs.collapse', '.collapse', function (e) {
    var customerId = this.id.replace('collapse-', '');
    if (customerPanelHasPendingChanges(customerId)) {
      e.preventDefault();
      window.showAdminToast('尚有未確認的變更，請先「確認變更」或「取消編輯」', 'warning');
      return;
    }
    $('.customer-summary-row[data-customer-id="' + customerId + '"]').removeClass('is-expanded');
  });

  $('#customersCardList').off('show.bs.collapse hide.bs.collapse');

  $('#customersCardList').on('show.bs.collapse', '.collapse', function () {
    var $target = $(this);
    $('#customersCardList .collapse.show')
      .not($target)
      .each(function () {
        bootstrap.Collapse.getOrCreateInstance(this, { toggle: false }).hide();
      });
    var customerId = this.id.replace('collapse-mobile-', '');
    $('.customer-mobile-card').removeClass('is-expanded');
    $('.customer-mobile-card[data-customer-id="' + customerId + '"]').addClass('is-expanded');
  });

  $('#customersCardList').on('hide.bs.collapse', '.collapse', function (e) {
    var customerId = this.id.replace('collapse-mobile-', '');
    if (customerPanelHasPendingChanges(customerId)) {
      e.preventDefault();
      window.showAdminToast('尚有未確認的變更，請先「確認變更」或「取消編輯」', 'warning');
      return;
    }
    $('.customer-mobile-card[data-customer-id="' + customerId + '"]').removeClass('is-expanded');
  });
}

/**
 * 從預約管理跳轉時自動展開目標客戶
 */
function handlePendingCustomerId() {
  if (!window.pendingCustomerId) {
    return;
  }
  var targetId = window.pendingCustomerId;
  window.pendingCustomerId = null;

  var $desktopCollapse = $('#collapse-' + targetId);
  if ($desktopCollapse.length) {
    bootstrap.Collapse.getOrCreateInstance($desktopCollapse[0], { toggle: false }).show();
    setTimeout(function () {
      var $row = $('.customer-summary-row[data-customer-id="' + targetId + '"]');
      if ($row.length) {
        $row[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
    return;
  }

  var $mobileCollapse = $('#collapse-mobile-' + targetId);
  if ($mobileCollapse.length) {
    bootstrap.Collapse.getOrCreateInstance($mobileCollapse[0], { toggle: false }).show();
    setTimeout(function () {
      var $card = $('.customer-mobile-card[data-customer-id="' + targetId + '"]');
      if ($card.length) {
        $card[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
  }
}

// ==========================================================================
// renderCustomersList — 渲染客戶列表（桌面 table + 手機卡片）
// ==========================================================================
/**
 * 渲染客戶管理頁面
 * @param {Array} customers - customers.json 的資料陣列
 */
function renderCustomersList(customers) {
  if (!customers || customers.length === 0) {
    var hasCache = window.customersCache && window.customersCache.length > 0;
    var emptyMsg = hasCache ? '<i class="fas fa-inbox me-2"></i>沒有符合條件的會員' : '目前沒有客戶資料';
    $('#customersTableBody').html(
      '<tr><td colspan="8" class="text-center text-muted py-4">' + emptyMsg + '</td></tr>'
    );
    $('#customersCardList').html('<div class="text-center text-muted py-4">' + emptyMsg + '</div>');
    return;
  }

  var tableHtml = '';
  var cardHtml = '';

  customers.forEach(function (c) {
    var collapseId = 'collapse-' + c.id;
    var mobileCollapseId = 'collapse-mobile-' + c.id;
    var phoneDisplay = formatPhoneDisplay(c.phone);
    var tierDisplay = c.tier || '一般';
    var spentDisplay = 'NT$ ' + c.totalSpent.toLocaleString();
    var emailDisplay = c.email || '—';
    var birthdayDisplay = formatDateDisplay(c.birthday);
    var registeredDisplay = formatDateDisplay(c.registeredAt);
    var tagsHtml =
      c.tags && c.tags.length > 0
        ? c.tags.map(getTagBadge).join('')
        : '<span class="text-muted small">無標籤</span>';

    var ordersHtml =
      c.orders && c.orders.length > 0
        ? c.orders
            .map(function (orderId) {
              return (
                '<li class="list-group-item list-group-item-action py-1 small">' +
                '<i class="fas fa-receipt me-2 text-muted"></i>' +
                '<span class="admin-cell-link customer-order-link" ' +
                'data-order-id="' +
                orderId +
                '" ' +
                'title="點擊查看訂單明細">' +
                orderId +
                '</span></li>'
              );
            })
            .join('')
        : '<li class="list-group-item text-muted small">無購買記錄</li>';

    var detailHtml = buildDetailPanelHtml(
      c,
      phoneDisplay,
      emailDisplay,
      birthdayDisplay,
      registeredDisplay,
      tierDisplay,
      tagsHtml,
      ordersHtml
    );

    // 桌面：摘要列 + 展開列
    tableHtml +=
      '<tr class="customer-summary-row" data-customer-id="' +
      c.id +
      '"' +
      ' data-bs-toggle="collapse" data-bs-target="#' +
      collapseId +
      '"' +
      ' aria-expanded="false" role="button">' +
      '<td class="cell-name">' +
      c.name +
      '</td>' +
      '<td class="cell-phone">' +
      phoneDisplay +
      '</td>' +
      '<td class="cell-email">' +
      emailDisplay +
      '</td>' +
      '<td class="cell-registered">' +
      registeredDisplay +
      '</td>' +
      '<td class="cell-tier">' +
      tierDisplay +
      '</td>' +
      '<td class="cell-spent admin-cell-amount">' +
      spentDisplay +
      '</td>' +
      '<td class="cell-tags">' +
      tagsHtml +
      '</td>' +
      '<td class="cell-expand text-center text-muted">' +
      '<i class="fas fa-chevron-down customer-row-chevron" aria-hidden="true"></i>' +
      '</td>' +
      '</tr>' +
      '<tr class="customer-detail-row">' +
      '<td colspan="8" class="p-0">' +
      '<div id="' +
      collapseId +
      '" class="collapse">' +
      detailHtml +
      '</div>' +
      '</td>' +
      '</tr>';

    // 手機：卡片 + 展開詳情
    cardHtml +=
      '<div class="customer-mobile-card" data-customer-id="' +
      c.id +
      '"' +
      ' data-bs-toggle="collapse" data-bs-target="#' +
      mobileCollapseId +
      '"' +
      ' aria-expanded="false" role="button">' +
      '<div class="d-flex align-items-start gap-2">' +
      '<div class="mobile-card-grid flex-grow-1">' +
      '<div class="card-field card-field-name">' +
      '<div class="card-label">客戶姓名</div>' +
      '<div class="card-value fw-semibold">' +
      c.name +
      '</div>' +
      '</div>' +
      '<div class="card-field card-field-phone">' +
      '<div class="card-label">手機號碼</div>' +
      '<div class="card-value">' +
      phoneDisplay +
      '</div>' +
      '</div>' +
      '<div class="card-field card-field-email">' +
      '<div class="card-label">電子信箱</div>' +
      '<div class="card-value text-muted">' +
      emailDisplay +
      '</div>' +
      '</div>' +
      '<div class="card-field card-field-registered">' +
      '<div class="card-label">註冊日期</div>' +
      '<div class="card-value">' +
      registeredDisplay +
      '</div>' +
      '</div>' +
      '<div class="card-field card-field-tier">' +
      '<div class="card-label">會員等級</div>' +
      '<div class="card-value">' +
      tierDisplay +
      '</div>' +
      '</div>' +
      '<div class="card-field card-field-spent">' +
      '<div class="card-label">消費總額</div>' +
      '<div class="card-value admin-cell-amount">' +
      spentDisplay +
      '</div>' +
      '</div>' +
      '<div class="card-field card-field-tags">' +
      '<div class="card-label">標籤</div>' +
      '<div class="card-value">' +
      tagsHtml +
      '</div>' +
      '</div>' +
      '</div>' +
      '<i class="fas fa-chevron-down customer-row-chevron mt-1 flex-shrink-0" aria-hidden="true"></i>' +
      '</div>' +
      '</div>' +
      '<div id="' +
      mobileCollapseId +
      '" class="collapse customer-mobile-detail">' +
      detailHtml +
      '</div>';
  });

  $('#customersTableBody').html(tableHtml);
  $('#customersCardList').html(cardHtml);

  bindCustomerCollapseEvents();
  initCustomerPanelSnapshots();
  handlePendingCustomerId();

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('customers', $('#contentArea'));
  }
}

/** @deprecated 保留舊函式名稱相容 */
function renderCustomersAccordion(customers) {
  renderCustomersList(customers);
}
