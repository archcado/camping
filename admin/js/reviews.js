/**
 * admin/js/reviews.js
 * 評論管理模組
 * Review management — filter, search, sort, reply modal, localStorage persistence
 *
 * 使用 jQuery Event Namespace (.reviews) 防止重複導覽時事件堆疊
 * Data: admin/data/reviews.json（種子）+ localStorage.adminReviews（使用者變更）
 */

var REVIEWS_STORAGE_KEY = 'adminReviews';

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
  bindReviewEvents();

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
  var cached = localStorage.getItem(REVIEWS_STORAGE_KEY);
  if (cached) {
    try {
      callback(JSON.parse(cached));
      return;
    } catch (e) {
      localStorage.removeItem(REVIEWS_STORAGE_KEY);
    }
  }

  $.getJSON('data/reviews.json', function (reviews) {
    callback(reviews || []);
  }).fail(function () {
    $('#reviewsContainer').html(
      '<div class="alert alert-danger mb-0">' +
        '<i class="fas fa-exclamation-triangle me-2"></i>載入評論數據失敗' +
        '</div>'
    );
  });
}

/**
 * 寫入 localStorage（模擬後端持久化）
 * Persist reviews to localStorage
 */
function saveReviews(reviews) {
  localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(reviews));
  reviewsState.allReviews = reviews;
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
    $('.filter-btn').removeClass('active btn-dark').addClass('btn-outline-secondary');
    $(this).removeClass('btn-outline-secondary').addClass('active btn-dark');
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

    $('#reviewSearchInput').val('');
    $('#reviewRatingFilter').val('');
    $('#reviewSortSelect').val('unreplied-first');
    $('.filter-btn').removeClass('active btn-dark').addClass('btn-outline-secondary');
    $('.filter-btn[data-filter="all"]').removeClass('btn-outline-secondary').addClass('active btn-dark');

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
    html += i <= r ? '<i class="fas fa-star text-warning"></i>' : '<i class="far fa-star text-muted"></i>';
  }
  return html;
}

/** 未回覆卡片的左邊框樣式（低分優先標示）/ Border class for unreplied cards */
function getReviewCardBorderClass(review) {
  if (review.replied === true) return '';
  var rating = Number(review.rating) || 0;
  if (rating <= 2) return ' review-card-urgent';
  return ' review-card-pending';
}

/** 渲染買家附圖縮圖 / Render buyer photo thumbnails */
function renderReviewPhotos(photos) {
  if (!photos || !photos.length) return '';

  var thumbs = photos
    .map(function (url) {
      return (
        '<a href="' +
        escapeHtml(url) +
        '" target="_blank" rel="noopener" class="review-photo-thumb">' +
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
    '<div class="reply-display mt-3 p-3 bg-light border-start border-3 border-success rounded-end">' +
    '<div class="small text-muted mb-1"><i class="fas fa-store me-1"></i>賣家回覆</div>' +
    '<p class="mb-1 review-reply-text">' +
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
      '<div class="text-center text-muted py-5">' +
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
        var urgentBadge = !isReplied && rating <= 2 ? '<span class="badge bg-danger ms-1">需優先</span>' : '';

        var repliedBadge = isReplied
          ? '<span class="badge bg-success">已回覆</span>'
          : '<span class="badge bg-warning text-dark">待回覆</span>';

        var avatarSrc = r.buyerAvatar || 'https://placehold.co/44x44/cccccc/555555?text=U';

        var actionBtn = isReplied
          ? '<button type="button" class="btn btn-sm btn-outline-secondary btn-open-reply-modal"' +
            ' data-review-id="' +
            escapeHtml(r.id) +
            '" data-mode="edit">' +
            '<i class="fas fa-pen me-1"></i>編輯回覆</button>'
          : '<button type="button" class="btn btn-sm btn-outline-success btn-open-reply-modal"' +
            ' data-review-id="' +
            escapeHtml(r.id) +
            '" data-mode="create">' +
            '<i class="fas fa-reply me-1"></i>回覆評論</button>';

        return (
          '<div class="col-12">' +
          '<div class="card shadow-sm review-card' +
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
          '<div class="d-flex align-items-start gap-3">' +
          '<img src="' +
          escapeHtml(avatarSrc) +
          '" width="44" height="44"' +
          ' class="rounded-circle border object-fit-cover flex-shrink-0"' +
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
          '<div class="review-card-stars">' +
          renderStars(rating) +
          '</div>' +
          '</div>' +
          '<div class="small text-muted mb-2">' +
          escapeHtml(r.createdAt) +
          ' · ' +
          escapeHtml(r.productName) +
          '</div>' +
          '<div class="review-buyer-comment">' +
          '<div class="small text-muted mb-1">買家評論</div>' +
          '<p class="mb-0">' +
          escapeHtml(r.comment) +
          '</p>' +
          renderReviewPhotos(r.photos) +
          '</div>' +
          renderReplyBlock(r) +
          '<div class="d-flex justify-content-end mt-3">' +
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

  var modalEl = document.getElementById('reviewReplyModal');
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

  var modalEl = document.getElementById('reviewReplyModal');
  bootstrap.Modal.getInstance(modalEl).hide();

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

  var modalEl = document.getElementById('reviewReplyModal');
  bootstrap.Modal.getInstance(modalEl).hide();

  window.showAdminToast('評論 ' + reviewId + ' 回覆已刪除', 'warning');
}
