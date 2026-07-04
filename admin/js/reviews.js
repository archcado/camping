/**
 * admin/js/reviews.js
 * 評論管理模組
 * Review management — filter, search, sort, reply modal, localStorage persistence
 *
 * 使用 jQuery Event Namespace (.reviews) 防止重複導覽時事件堆疊
 * Data: admin/data/reviews.json（種子）+ localStorage.adminReviews（使用者變更）
 */

var REVIEWS_STORAGE_KEY = 'adminReviews';
var REVIEWS_DATA_URL = 'data/reviews.json';
var REVIEW_REQUIRED_SELECTORS = [
  '#reviewsContainer',
  '#tabCountAll',
  '#tabCountUnreplied',
  '#tabCountReplied',
  '#reviewsResultCount',
  '#reviewSearchInput',
  '#reviewRatingFilter',
  '#reviewSortSelect',
  '#btnClearReviewFilters',
  '#reviewReplyModal',
  '#reviewReplyModalId',
  '#reviewReplyTextarea',
  '#btnSubmitReviewReply',
  '#btnDeleteReviewReply',
];

/** @type {{ allReviews: Array, statusFilter: string, searchQuery: string, ratingFilter: string, sortBy: string }} */
var reviewsState = {
  allReviews: [],
  statusFilter: 'all',
  searchQuery: '',
  ratingFilter: '',
  sortBy: 'unreplied-first',
};

window.initReviews = function () {
  $(document).off('.reviews');
  reviewsState.statusFilter = 'all';
  reviewsState.searchQuery = '';
  reviewsState.ratingFilter = '';
  reviewsState.sortBy = 'unreplied-first';

  if (!validateReviewsDom()) {
    reviewsState.allReviews = [];
    return;
  }

  bindReviewEvents();
  resetReviewFiltersUi();

  loadReviews(function (reviews) {
    reviewsState.allReviews = reviews;
    applyFiltersAndRender();
    updateReviewTabCounts();
  });
};

// ==========================================================
// === 資料載入 / 儲存（localStorage mock，未來可換 REST API）===
// ==========================================================

/**
 * 從 localStorage 或 JSON 種子載入評論
 * Load reviews from localStorage override or JSON seed
 */
function loadReviews(callback) {
  var cached = null;
  var cachedRaw = localStorage.getItem(REVIEWS_STORAGE_KEY);
  if (cachedRaw) {
    try {
      cached = JSON.parse(cachedRaw);
    } catch (e) {
      localStorage.removeItem(REVIEWS_STORAGE_KEY);
    }
  }

  $.getJSON(REVIEWS_DATA_URL, function (reviews) {
    var seedReviews = normalizeReviewsArray(reviews);
    if (cached && Array.isArray(cached)) {
      callback(mergeSeedWithCachedReviews(seedReviews, normalizeReviewsArray(cached)));
      return;
    }
    callback(seedReviews);
  }).fail(function (jqXHR, textStatus, errorThrown) {
    if (cached && Array.isArray(cached)) {
      callback(normalizeReviewsArray(cached));
      renderReviewsMessage(
        'warning',
        '評論種子資料載入失敗，已改用暫存資料（' +
          [REVIEWS_DATA_URL, jqXHR && jqXHR.status ? 'HTTP ' + jqXHR.status : textStatus || errorThrown]
            .filter(Boolean)
            .join(' / ') +
          '）'
      );
      return;
    }

    renderReviewsMessage(
      'error',
      '載入評論資料失敗（' +
        [REVIEWS_DATA_URL, jqXHR && jqXHR.status ? 'HTTP ' + jqXHR.status : textStatus || errorThrown]
          .filter(Boolean)
          .join(' / ') +
        '）'
    );
  });
}

/**
 * 寫入 localStorage（模擬後端持久化）
 * Persist reviews to localStorage
 */
function saveReviews(reviews) {
  var normalizedReviews = normalizeReviewsArray(reviews);
  localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(normalizedReviews));
  reviewsState.allReviews = normalizedReviews;
}

/** 取得目前登入的管理員資訊 / Current admin from sessionStorage */
function getCurrentAdmin() {
  return {
    id: sessionStorage.getItem('adminId') || '—',
    name: sessionStorage.getItem('adminName') || '管理員',
  };
}

/** 產生 YYYY-MM-DD HH:mm 格式時間字串 / Format current datetime */
function formatNow() {
  var d = new Date();
  var pad = function (n) {
    return String(n).padStart(2, '0');
  };
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

/** HTML 跳脫，防止 XSS / Escape HTML for safe rendering */
function escapeHtml(str) {
  return $('<div>')
    .text(str || '')
    .html();
}

// ==========================================================
// === 事件綁定 ===
// ==========================================================

function bindReviewEvents() {
  // 狀態 Tab：全部 / 未回覆 / 已回覆
  $(document).on('click.reviews', '.filter-btn', function () {
    reviewsState.statusFilter = $(this).data('filter');
    $('.filter-btn').removeClass('active');
    $(this).addClass('active');
    applyFiltersAndRender();
  });

  // 搜尋（即時）
  $(document).on('input.reviews', '#reviewSearchInput', function () {
    reviewsState.searchQuery = $(this).val().trim().toLowerCase();
    applyFiltersAndRender();
  });

  // 評分篩選
  $(document).on('change.reviews', '#reviewRatingFilter', function () {
    reviewsState.ratingFilter = $(this).val();
    applyFiltersAndRender();
  });

  // 排序
  $(document).on('change.reviews', '#reviewSortSelect', function () {
    reviewsState.sortBy = $(this).val();
    applyFiltersAndRender();
  });

  // 清除條件
  $(document).on('click.reviews', '#btnClearReviewFilters', function () {
    reviewsState.statusFilter = 'all';
    reviewsState.searchQuery = '';
    reviewsState.ratingFilter = '';
    reviewsState.sortBy = 'unreplied-first';

    resetReviewFiltersUi();
    applyFiltersAndRender();
  });

  // 開啟回覆 Modal（新增或編輯）
  $(document).on('click.reviews', '.btn-open-reply-modal', function () {
    var reviewId = $(this).data('review-id');
    var mode = $(this).data('mode') || 'create';
    openReviewReplyModal(reviewId, mode);
  });

  // Modal 送出回覆 / 儲存編輯
  $(document).on('click.reviews', '#btnSubmitReviewReply', function () {
    submitReviewReply();
  });

  // Modal 刪除回覆
  $(document).on('click.reviews', '#btnDeleteReviewReply', function () {
    deleteReviewReply();
  });
}

// ==========================================================
// === 篩選 / 排序 / 渲染 ===
// ==========================================================

function applyFiltersAndRender() {
  var filtered = filterReviews(reviewsState.allReviews);
  filtered = sortReviews(filtered);
  renderReviewCards(filtered);
  updateClearButtonVisibility();
  updateReviewsResultCount(filtered.length);
}

/** 依狀態、搜尋、評分篩選 / Apply status, search, rating filters */
function filterReviews(reviews) {
  return reviews.filter(function (r) {
    if (reviewsState.statusFilter === 'unreplied' && r.replied === true) return false;
    if (reviewsState.statusFilter === 'replied' && r.replied !== true) return false;

    if (reviewsState.ratingFilter) {
      var rating = Number(r.rating) || 0;
      if (reviewsState.ratingFilter === '1-2' && (rating < 1 || rating > 2)) return false;
      if (reviewsState.ratingFilter === '3' && rating !== 3) return false;
      if (reviewsState.ratingFilter === '4-5' && (rating < 4 || rating > 5)) return false;
    }

    if (reviewsState.searchQuery) {
      var q = reviewsState.searchQuery;
      var haystack = [r.id, r.buyerName, r.productName, r.comment, r.replyText].join(' ').toLowerCase();
      if (haystack.indexOf(q) === -1) return false;
    }

    return true;
  });
}

/** 排序評論列表 / Sort review list */
function sortReviews(reviews) {
  var list = reviews.slice();

  list.sort(function (a, b) {
    if (reviewsState.sortBy === 'unreplied-first') {
      if (a.replied !== b.replied) return a.replied ? 1 : -1;
      if (!a.replied && !b.replied) {
        var ra = Number(a.rating) || 0;
        var rb = Number(b.rating) || 0;
        if (ra !== rb) return ra - rb;
      }
      return String(b.createdAt).localeCompare(String(a.createdAt));
    }
    if (reviewsState.sortBy === 'date-desc') {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    }
    if (reviewsState.sortBy === 'rating-asc') {
      return (Number(a.rating) || 0) - (Number(b.rating) || 0);
    }
    if (reviewsState.sortBy === 'rating-desc') {
      return (Number(b.rating) || 0) - (Number(a.rating) || 0);
    }
    return 0;
  });

  return list;
}

/** 更新 Tab 計數 Badge / Update tab count badges */
function updateReviewTabCounts() {
  var total = reviewsState.allReviews.length;
  var replied = reviewsState.allReviews.filter(function (r) {
    return r.replied === true;
  }).length;
  $('#tabCountAll').text(total);
  $('#tabCountReplied').text(replied);
  $('#tabCountUnreplied').text(total - replied);
}

/** 有非預設篩選時顯示「清除條件」/ Show clear button when filters active */
function updateClearButtonVisibility() {
  var hasExtra =
    reviewsState.statusFilter !== 'all' ||
    reviewsState.searchQuery !== '' ||
    reviewsState.ratingFilter !== '' ||
    reviewsState.sortBy !== 'unreplied-first';

  $('#btnClearReviewFilters').toggleClass('d-none', !hasExtra);
}

function updateReviewsResultCount(count) {
  $('#reviewsResultCount').text('顯示 ' + count + ' 筆評論');
}

/** 依目前 Tab 回傳空狀態文案 / Empty state message per filter */
function getReviewEmptyMessage() {
  if (reviewsState.searchQuery || reviewsState.ratingFilter) {
    return '找不到符合條件的評論';
  }
  if (reviewsState.statusFilter === 'unreplied') {
    return '太棒了！目前沒有待回覆的評論';
  }
  if (reviewsState.statusFilter === 'replied') {
    return '尚無已回覆的評論';
  }
  return '目前沒有評論';
}

/**
 * 渲染星星評分（1–5 顆）
 * @param {number} rating
 */
function renderStars(rating) {
  var html = '';
  var r = Number(rating) || 0;
  for (var i = 1; i <= 5; i++) {
    html += i <= r
      ? '<i class="fas fa-star yr-admin-review-star yr-admin-review-star--filled"></i>'
      : '<i class="far fa-star yr-admin-review-star yr-admin-review-star--empty"></i>';
  }
  return html;
}

/** 未回覆卡片的左邊框樣式（低分優先標示）/ Border class for unreplied cards */
function getReviewCardBorderClass(review) {
  if (review.replied === true) return '';
  var rating = Number(review.rating) || 0;
  if (rating <= 2) return ' yr-admin-review-card--urgent review-card-urgent';
  return ' yr-admin-review-card--pending review-card-pending';
}

/** 渲染買家附圖縮圖 / Render buyer photo thumbnails */
function renderReviewPhotos(photos) {
  if (!photos || !photos.length) return '';

  var thumbs = photos
    .map(function (url) {
      return (
        '<a href="' +
        escapeHtml(url) +
        '" target="_blank" rel="noopener" class="review-photo-thumb yr-admin-review-photo-thumb">' +
        '<img src="' +
        escapeHtml(url) +
        '" alt="評論附圖"' +
        ' onerror="this.parentElement.classList.add(\'d-none\')">' +
        '</a>'
      );
    })
    .join('');

  return '<div class="review-photos d-flex flex-wrap gap-2 mt-2">' + thumbs + '</div>';
}

/** 渲染賣家回覆區塊 / Render seller reply block */
function renderReplyBlock(review) {
  if (review.replied !== true || !review.replyText) return '';

  var metaParts = [];
  if (review.replyAt) metaParts.push('回覆於 ' + escapeHtml(review.replyAt));
  // 不顯示回覆人員姓名 / Do not show responder name on UI
  if (review.replyUpdatedAt) metaParts.push('（已編輯 ' + escapeHtml(review.replyUpdatedAt) + '）');

  return (
    '<div class="yr-admin-review-reply reply-display">' +
    '<div class="yr-admin-review-reply__header"><i class="fas fa-store me-1"></i>賣家回覆</div>' +
    '<p class="mb-1 yr-admin-review-reply__content review-reply-text">' +
    escapeHtml(review.replyText) +
    '</p>' +
    (metaParts.length ? '<div class="small text-muted">' + metaParts.join(' · ') + '</div>' : '') +
    '</div>'
  );
}

/**
 * 將 reviews 陣列渲染成單欄卡片清單
 * @param {Array} reviews
 */
function renderReviewCards(reviews) {
  if (!reviews || reviews.length === 0) {
    $('#reviewsContainer').html(
      '<div class="yr-admin-reviews-empty text-center">' +
        '<i class="far fa-comment-dots fa-2x mb-2 d-block opacity-50"></i>' +
        escapeHtml(getReviewEmptyMessage()) +
        '</div>'
    );
    return;
  }

  var html =
    '<div class="row g-3">' +
    reviews
      .map(function (r) {
        var isReplied = r.replied === true;
        var rating = Number(r.rating) || 0;
        var urgentBadge =
          !isReplied && rating <= 2
            ? '<span class="yr-admin-review-status yr-admin-review-status--pending ms-1">需優先</span>'
            : '';

        var repliedBadge = isReplied
          ? '<span class="yr-admin-review-status yr-admin-review-status--answered">已回覆</span>'
          : '<span class="yr-admin-review-status yr-admin-review-status--pending">待回覆</span>';

        var avatarSrc = r.buyerAvatar || 'https://placehold.co/44x44/cccccc/555555?text=U';

        var actionBtn = isReplied
          ? '<button type="button" class="btn btn-sm yr-admin-review-action-btn btn-open-reply-modal"' +
            ' data-review-id="' +
            escapeHtml(r.id) +
            '" data-mode="edit">' +
            '<i class="fas fa-pen me-1"></i>編輯回覆</button>'
          : '<button type="button" class="btn btn-sm yr-admin-review-action-btn btn-open-reply-modal"' +
            ' data-review-id="' +
            escapeHtml(r.id) +
            '" data-mode="create">' +
            '<i class="fas fa-reply me-1"></i>回覆評論</button>';

        return (
          '<div class="col-12">' +
          '<div class="card shadow-sm review-card yr-admin-review-card' +
          getReviewCardBorderClass(r) +
          '"' +
          ' data-review-id="' +
          escapeHtml(r.id) +
          '"' +
          ' data-replied="' +
          isReplied +
          '"' +
          ' data-rating="' +
          rating +
          '">' +
          '<div class="card-body">' +
          '<div class="yr-admin-review-card__header">' +
          '<img src="' +
          escapeHtml(avatarSrc) +
          '" width="44" height="44"' +
          ' class="yr-admin-review-avatar rounded-circle border object-fit-cover flex-shrink-0"' +
          ' alt="' +
          escapeHtml(r.buyerName) +
          ' 頭像"' +
          ' onerror="this.src=\'https://placehold.co/44x44/cccccc/555555?text=U\'">' +
          '<div class="flex-grow-1 min-w-0">' +
          '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-1">' +
          '<div class="d-flex flex-wrap align-items-center gap-2">' +
          '<span class="fw-semibold">' +
          escapeHtml(r.buyerName) +
          '</span>' +
          '<span class="badge bg-secondary">' +
          escapeHtml(r.id) +
          '</span>' +
          repliedBadge +
          urgentBadge +
          '</div>' +
          '<div class="yr-admin-review-rating review-card-stars">' +
          renderStars(rating) +
          '<span class="yr-admin-review-rating-text">' +
          rating +
          '/5</span>' +
          '</div>' +
          '</div>' +
          '<div class="yr-admin-review-card__meta mb-2">' +
          escapeHtml(r.createdAt) +
          ' · ' +
          escapeHtml(r.productName) +
          '</div>' +
          '<div class="yr-admin-review-card__content review-buyer-comment">' +
          '<div class="small text-muted mb-1">買家評論</div>' +
          '<p class="mb-0">' +
          escapeHtml(r.comment) +
          '</p>' +
          renderReviewPhotos(r.photos) +
          '</div>' +
          renderReplyBlock(r) +
          '<div class="yr-admin-review-card__actions d-flex justify-content-end mt-3">' +
          actionBtn +
          '</div>' +
          '</div></div>' +
          '</div></div></div>'
        );
      })
      .join('') +
    '</div>';

  $('#reviewsContainer').html(html);

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('reviews', $('#contentArea'));
  }
}

// ==========================================================
// === Modal：回覆 / 編輯 / 刪除 ===
// ==========================================================

/**
 * 開啟回覆 Modal
 * @param {string} reviewId
 * @param {'create'|'edit'} mode
 */
function openReviewReplyModal(reviewId, mode) {
  var review = reviewsState.allReviews.find(function (r) {
    return r.id === reviewId;
  });
  if (!review) return;

  var isEdit = mode === 'edit';
  var avatarSrc = review.buyerAvatar || 'https://placehold.co/44x44/cccccc/555555?text=U';

  $('#reviewReplyModalId').val(review.id);
  $('#reviewReplyModalTitle').text(isEdit ? '編輯回覆' : '回覆評論');
  $('#reviewModalAvatar').attr('src', avatarSrc);
  $('#reviewModalBuyerName').text(review.buyerName);
  $('#reviewModalReviewId').text(review.id);
  $('#reviewModalStars').html(renderStars(review.rating));
  $('#reviewModalMeta').text(review.createdAt + ' · ' + review.productName);
  $('#reviewModalComment').text(review.comment);
  $('#reviewReplyTextarea').val(isEdit ? review.replyText || '' : '');

  $('#btnDeleteReviewReply').toggleClass('d-none', !isEdit);
  $('#btnSubmitReviewReply').html(
    isEdit ? '<i class="fas fa-save me-1"></i>儲存修改' : '<i class="fas fa-paper-plane me-1"></i>送出回覆'
  );

  var modalEl = getReviewReplyModalElement();
  if (!modalEl) {
    return;
  }
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  modalEl.addEventListener('shown.bs.modal', function onShown() {
    $('#reviewReplyTextarea').trigger('focus');
    modalEl.removeEventListener('shown.bs.modal', onShown);
  });
}

/** 送出或更新回覆 / Submit or update reply */
function submitReviewReply() {
  var reviewId = $('#reviewReplyModalId').val();
  var replyText = $('#reviewReplyTextarea').val().trim();

  if (!replyText) {
    window.showAdminToast('回覆內容不能為空', 'danger');
    return;
  }

  var admin = getCurrentAdmin();
  var now = formatNow();
  var wasReplied = false;

  var updated = reviewsState.allReviews.map(function (r) {
    if (r.id !== reviewId) return r;

    wasReplied = r.replied === true;
    var next = Object.assign({}, r, {
      replied: true,
      replyText: replyText,
    });

    if (!wasReplied) {
      next.replyAt = now;
      next.repliedBy = admin.id;
      next.repliedByName = admin.name;
      next.replyUpdatedAt = null;
    } else {
      next.replyUpdatedAt = now;
    }

    return next;
  });

  saveReviews(updated);
  updateReviewTabCounts();
  applyFiltersAndRender();

  hideReviewReplyModal();

  window.showAdminToast(wasReplied ? '評論 ' + reviewId + ' 回覆已更新' : '評論 ' + reviewId + ' 已送出回覆');
}

/** 刪除回覆，狀態回到待回覆 / Delete reply and reset to unreplied */
function deleteReviewReply() {
  var reviewId = $('#reviewReplyModalId').val();
  if (!window.confirm('確定要刪除此回覆嗎？評論將回到「待回覆」狀態。')) return;

  var updated = reviewsState.allReviews.map(function (r) {
    if (r.id !== reviewId) return r;
    return Object.assign({}, r, {
      replied: false,
      replyText: '',
      replyAt: null,
      repliedBy: null,
      repliedByName: null,
      replyUpdatedAt: null,
    });
  });

  saveReviews(updated);
  updateReviewTabCounts();
  applyFiltersAndRender();

  hideReviewReplyModal();

  window.showAdminToast('評論 ' + reviewId + ' 回覆已刪除', 'warning');
}

function resetReviewFiltersUi() {
  $('#reviewSearchInput').val('');
  $('#reviewRatingFilter').val('');
  $('#reviewSortSelect').val('unreplied-first');
  $('.filter-btn').removeClass('active');
  $('.filter-btn[data-filter="all"]').addClass('active');
}

function validateReviewsDom() {
  var missingSelectors = REVIEW_REQUIRED_SELECTORS.filter(function (selector) {
    return $(selector).length === 0;
  });

  if (missingSelectors.length === 0) {
    return true;
  }

  renderReviewsMessage('error', '評論頁面缺少必要結構：' + missingSelectors.join(', '));
  return false;
}

function renderReviewsMessage(type, message) {
  var className = type === 'error' ? 'yr-admin-reviews-error' : 'yr-admin-reviews-empty';
  $('#reviewsContainer').html(
    '<div class="' +
      className +
      ' text-center">' +
      '<i class="fas fa-' +
      (type === 'error' ? 'exclamation-triangle' : 'circle-info') +
      ' me-2"></i>' +
      escapeHtml(message) +
      '</div>'
  );
}

function normalizeReviewDate(value) {
  var text = String(value || '').trim();
  if (!text) {
    return '';
  }

  var normalized = text.replace('T', ' ').replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized + ' 00:00';
  }

  var parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  var pad = function (n) {
    return String(n).padStart(2, '0');
  };
  return (
    parsed.getFullYear() +
    '-' +
    pad(parsed.getMonth() + 1) +
    '-' +
    pad(parsed.getDate()) +
    ' ' +
    pad(parsed.getHours()) +
    ':' +
    pad(parsed.getMinutes())
  );
}

function normalizeReviewAvatar(value) {
  var avatar = String(value || '').trim();
  if (!avatar) {
    return 'https://placehold.co/44x44/cccccc/555555?text=U';
  }
  if (/^https?:\/\//i.test(avatar) || avatar.indexOf('data:') === 0) {
    return avatar;
  }
  return 'https://placehold.co/44x44/cccccc/555555?text=U';
}

function normalizeReviewRecord(review) {
  var normalized = Object.assign({}, review);
  normalized.id = String(normalized.id || normalized.reviewId || '').trim();
  normalized.buyerName = String(normalized.buyerName || '').trim();
  normalized.buyerAvatar = normalizeReviewAvatar(normalized.buyerAvatar);
  normalized.productName = String(normalized.productName || '').trim();
  normalized.comment = String(normalized.comment || normalized.content || '').trim();
  normalized.rating = Math.min(5, Math.max(1, Number(normalized.rating) || 0)) || 1;
  normalized.photos = Array.isArray(normalized.photos) ? normalized.photos.filter(Boolean) : [];
  normalized.createdAt = normalizeReviewDate(normalized.createdAt);
  normalized.replyText = String(normalized.replyText || '').trim();
  normalized.replyAt = normalized.replyAt ? normalizeReviewDate(normalized.replyAt) : null;
  normalized.replyUpdatedAt = normalized.replyUpdatedAt
    ? normalizeReviewDate(normalized.replyUpdatedAt)
    : null;
  normalized.repliedBy = normalized.repliedBy ? String(normalized.repliedBy).trim() : null;
  normalized.repliedByName = normalized.repliedByName ? String(normalized.repliedByName).trim() : null;
  normalized.replied = normalized.replied === true || normalized.replyText !== '';
  return normalized;
}

function normalizeReviewsArray(reviews) {
  if (!Array.isArray(reviews)) {
    return [];
  }
  return reviews
    .map(normalizeReviewRecord)
    .filter(function (review) {
      return review.id;
    });
}

function mergeSeedWithCachedReviews(seedReviews, cachedReviews) {
  var cachedById = new Map(
    cachedReviews.map(function (review) {
      return [review.id, review];
    })
  );
  var merged = seedReviews.map(function (review) {
    return cachedById.has(review.id) ? Object.assign({}, review, cachedById.get(review.id)) : review;
  });

  cachedReviews.forEach(function (review) {
    var exists = merged.some(function (seedReview) {
      return seedReview.id === review.id;
    });
    if (!exists) {
      merged.push(review);
    }
  });

  return normalizeReviewsArray(merged);
}

function getReviewReplyModalElement() {
  var modalEl = document.getElementById('reviewReplyModal');
  if (!modalEl) {
    renderReviewsMessage('error', '回覆對話框載入失敗，請重新整理頁面。');
    if (typeof window.showAdminToast === 'function') {
      window.showAdminToast('評論回覆介面未正確載入', 'error');
    }
    return null;
  }
  return modalEl;
}

function hideReviewReplyModal() {
  var modalEl = getReviewReplyModalElement();
  if (!modalEl) {
    return;
  }
  var modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) {
    modal.hide();
  }
}
