/**
 * admin/js/reviews.js
 * 評論管理模組
 * 使用 jQuery Event Namespace (.reviews) 防止重複導覽時事件堆疊
 *
 * 容器 ID：#reviewsContainer
 * 篩選按鈕：.filter-btn（帶 data-filter="all|unreplied|replied"）
 * Tab Badge：#tabCountAll, #tabCountUnreplied, #tabCountReplied
 */

window.initReviews = function () {
  $(document).off('.reviews');

  $.getJSON('data/reviews.json', function (reviews) {
    if (!Array.isArray(reviews)) {
      renderReviewsMessage('error', '評論資料格式錯誤');
      return;
    }

    renderReviewCards(reviews);
    updateReviewCounters();
    applyReviewFilter('all');
  }).fail(function () {
    renderReviewsMessage('error', '載入評論數據失敗');
  });

  // 篩選切換（.filter-btn 帶 data-filter 屬性）
  $(document).on('click.reviews', '.filter-btn', function () {
    var filter = $(this).data('filter');

    // 更新按鈕 active 樣式
    $('.filter-btn').removeClass('active');
    $(this).addClass('active');
    applyReviewFilter(filter);
  });

  // 展開回覆輸入框
  $(document).on('click.reviews', '.btn-reply-toggle', function () {
    var $form = $(this).closest('.review-card').find('.reply-form');
    $form.toggleClass('d-none');
    if (!$form.hasClass('d-none')) {
      $form.find('textarea').trigger('focus');
    }
  });

  // 提交回覆
  $(document).on('click.reviews', '.btn-submit-reply', function () {
    var $card     = $(this).closest('.review-card');
    var reviewId  = $card.data('review-id');
    var $textarea = $card.find('.reply-form textarea');
    var replyText = $textarea.val().trim();

    if (!replyText) {
      window.showAdminToast('回覆內容不能為空', 'danger');
      return;
    }

    $card.find('.reply-form').addClass('d-none');
    $card.attr('data-replied', 'true');
    $card.removeClass('yr-admin-review-card--pending').addClass('yr-admin-review-card--answered');
    $card.find('.replied-badge').replaceWith(renderReviewStatus(true));
    $card.find('.btn-reply-toggle').hide();
    $card.find('.reply-display').remove();
    $card.find('.card-body').append(renderReplyDisplay(replyText));

    updateReviewCounters();
    applyReviewFilter($('.filter-btn.active').data('filter') || 'all');

    window.showAdminToast('評論 ' + reviewId + ' 已送出回覆');
  });
};

/**
 * 取得評論狀態 class
 * @param {boolean|undefined} replied
 * @returns {string}
 */
function getReviewStatusClass(replied) {
  if (replied === true) return 'yr-admin-review-status--answered';
  if (replied === false) return 'yr-admin-review-status--pending';
  return 'yr-admin-review-status--unknown';
}

/**
 * 渲染評論狀態
 * @param {boolean|undefined} replied
 * @returns {string}
 */
function renderReviewStatus(replied) {
  var statusClass = getReviewStatusClass(replied);
  var label = replied === true ? '已回覆' : (replied === false ? '待回覆' : '狀態未知');
  var icon = replied === true ? 'fa-circle-check' : (replied === false ? 'fa-clock' : 'fa-circle-question');
  return '<span class="yr-admin-review-status ' + statusClass + ' replied-badge">' +
    '<i class="fas ' + icon + ' me-1" aria-hidden="true"></i>' + label +
    '</span>';
}

/**
 * 渲染星等（1-5）
 * @param {number} rating
 * @returns {string}
 */
function renderReviewRating(rating) {
  var safeRating = Number(rating);
  if (!Number.isFinite(safeRating)) {
    safeRating = 0;
  }
  safeRating = Math.max(0, Math.min(5, Math.round(safeRating)));

  var stars = '';
  for (var i = 1; i <= 5; i++) {
    stars += i <= safeRating
      ? '<i class="fas fa-star yr-admin-review-star yr-admin-review-star--filled" aria-hidden="true"></i>'
      : '<i class="far fa-star yr-admin-review-star yr-admin-review-star--empty" aria-hidden="true"></i>';
  }

  return '<div class="yr-admin-review-rating" role="img" aria-label="評分 ' + safeRating + ' / 5">' +
    stars +
    '<span class="yr-admin-review-rating-text">' + safeRating + ' / 5</span>' +
    '</div>';
}

/**
 * 將 reviews 陣列渲染成卡片清單，填入 #reviewsContainer
 * @param {Array} reviews - reviews.json 的資料陣列
 */
function renderReviewCards(reviews) {
  if (!reviews || reviews.length === 0) {
    renderReviewsMessage('empty', '目前沒有評論');
    return;
  }

  var html = '<div class="row g-3">' +
    reviews.map(function (r) {
      var isReplied = r.replied === true;
      var statusHtml = renderReviewStatus(r.replied);
      var replyDisplayHtml = (isReplied && r.replyText) ? renderReplyDisplay(r.replyText) : '';
      var cardStateClass = isReplied ? 'yr-admin-review-card--answered' : 'yr-admin-review-card--pending';

      var replyToggleBtn = isReplied ? '' :
        '<button class="btn btn-sm btn-outline-secondary btn-reply-toggle mt-2">' +
        '<i class="fas fa-reply me-1"></i>回覆</button>';

      var avatarSrc = r.buyerAvatar || 'https://placehold.co/40x40/cccccc/555555?text=U';

      return '<div class="col-12 col-lg-6">' +
        '<div class="card review-card yr-admin-review-card ' + cardStateClass + '"' +
        ' data-review-id="' + r.id + '"' +
        ' data-replied="' + isReplied + '">' +
        '<div class="card-body">' +
        '<div class="yr-admin-review-card__header">' +
        '<img src="' + avatarSrc + '" width="40" height="40"' +
        ' class="yr-admin-review-avatar"' +
        ' onerror="this.src=\'https://placehold.co/40x40/cccccc/555555?text=U\'">' +
        '<div class="flex-grow-1">' +
        '<div class="d-flex justify-content-between align-items-center">' +
        '<span class="fw-semibold">' + escapeHtml(r.buyerName || '匿名使用者') + '</span>' +
        statusHtml +
        '</div>' +
        '<div class="yr-admin-review-card__meta">' +
        '<span>' + escapeHtml(r.createdAt || '日期未知') + '</span>' +
        '<span aria-hidden="true">·</span>' +
        '<span>' + escapeHtml(r.productName || '商品資訊缺漏') + '</span>' +
        '</div>' +
        '<div class="mt-1">' + renderReviewRating(r.rating) + '</div>' +
        '</div></div>' +
        '<p class="mb-1 small yr-admin-review-card__content">' + escapeHtml(r.comment || '') + '</p>' +
        replyDisplayHtml +
        '<div class="yr-admin-review-card__actions">' + replyToggleBtn + '</div>' +
        '<div class="reply-form d-none mt-2">' +
        '<textarea class="form-control form-control-sm mb-1" rows="3" placeholder="輸入回覆內容..." aria-label="回覆評論"></textarea>' +
        '<button class="btn btn-sm btn-primary btn-submit-reply">' +
        '<i class="fas fa-paper-plane me-1"></i>送出回覆</button>' +
        '</div>' +
        '</div></div></div>';
    }).join('') +
    '</div>';

  $('#reviewsContainer').html(html);

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('reviews', $('#contentArea'));
  }
}

function renderReplyDisplay(replyText) {
  return '<div class="reply-display yr-admin-review-reply">' +
    '<div class="yr-admin-review-reply__header"><i class="fas fa-store me-1" aria-hidden="true"></i>賣家回覆</div>' +
    '<p class="yr-admin-review-reply__content">' + escapeHtml(replyText) + '</p>' +
    '</div>';
}

function updateReviewCounters() {
  var totalCards = $('.review-card').length;
  var repliedCards = $('.review-card[data-replied="true"]').length;
  var unrepCards = totalCards - repliedCards;

  $('#tabCountAll').text(totalCards);
  $('#tabCountUnreplied').text(unrepCards);
  $('#tabCountReplied').text(repliedCards);
}

function applyReviewFilter(filter) {
  var selectedFilter = filter || 'all';
  var $cards = $('.review-card');
  var $filterEmpty = $('#reviewsContainer').find('.yr-admin-reviews-empty--filter');

  $cards.show();
  if (selectedFilter === 'unreplied') {
    $cards.hide();
    $('.review-card[data-replied="false"]').show();
  } else if (selectedFilter === 'replied') {
    $cards.hide();
    $('.review-card[data-replied="true"]').show();
  }

  var visibleCount = $('.review-card:visible').length;
  var label = selectedFilter === 'unreplied'
    ? '待回覆'
    : (selectedFilter === 'replied' ? '已回覆' : '全部');
  $('#reviewsResultCount').text('顯示 ' + visibleCount + ' 筆評論（' + label + '）');

  if (!$cards.length) {
    return;
  }

  if (visibleCount === 0) {
    if (!$filterEmpty.length) {
      $('#reviewsContainer').append(
        '<div class="yr-admin-reviews-empty yr-admin-reviews-empty--filter text-center py-4 mt-3">' +
        '<i class="fas fa-inbox me-2" aria-hidden="true"></i>此分類目前沒有評論' +
        '</div>'
      );
    }
  } else {
    $filterEmpty.remove();
  }
}

function renderReviewsMessage(type, message) {
  var cssClass = type === 'error' ? 'yr-admin-reviews-error' : (type === 'loading' ? 'yr-admin-reviews-loading' : 'yr-admin-reviews-empty');
  var icon = type === 'error' ? 'fa-exclamation-triangle' : (type === 'loading' ? 'fa-spinner fa-spin' : 'fa-comment-slash');
  $('#reviewsContainer').html(
    '<div class="' + cssClass + ' text-center">' +
    '<i class="fas ' + icon + ' me-2" aria-hidden="true"></i>' + escapeHtml(message) +
    '</div>'
  );
  $('#reviewsResultCount').text('顯示 0 筆評論');
  $('#tabCountAll, #tabCountUnreplied, #tabCountReplied').text('0');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
