/**
 * admin/js/movement.js
 * 庫存異動紀錄模組
 * 從 admin/data/movement.json 載入主檔，點擊異動 ID 後顯示明細清單。
 */

window.generatedMovementRecords = window.generatedMovementRecords || [];
window.movementBaseLoaded = false;
var MOVEMENT_REQUIRED_SELECTORS = [
  '#movementTable',
  '#movementTableBody',
  '#movementDetailModal',
  '#modalMovementItems',
  '#movementPeriodBtns',
  '#movementDateRangePicker',
  '#movementPeriodLabel',
  '#btnClearMovementSort',
  '#movementResultCount',
];
var movementSortStack = [{ key: 'date', dir: 'desc' }];
var movementDateState = { days: 30, startDate: null, endDate: null };
var movementFilterState = {
  employeeId: [],
  movementType: [],
  dateStart: null,
  dateEnd: null,
};

window.initMovement = function () {
  $(document).off('.orders');
  $(document).off('.movement');

  movementSortStack = [{ key: 'date', dir: 'desc' }];
  movementFilterState = { employeeId: [], movementType: [], dateStart: null, dateEnd: null };
  movementDateState = { days: 30, startDate: null, endDate: null };

  if (!validateMovementDom()) {
    return;
  }

  setupMovementPeriodFilter();
  initMovementFlatpickr();
  applyMovementDayRange(30);

  if (window.movementBaseLoaded) {
    populateEmployeeFilterOptions(window.movementCache || []);
    applyMovementFiltersAndSort();
  } else {
    $.getJSON('data/movement.json', function (records) {
      window.movementCache = mergeMovementRecords(
        window.generatedMovementRecords,
        (records || []).map(normalizeMovementRecord)
      );
      window.movementBaseLoaded = true;
      populateEmployeeFilterOptions(window.movementCache);
      applyMovementFiltersAndSort();
    }).fail(function () {
      renderMovementMessage('error', '載入庫存異動紀錄失敗');
    });
  }

  $(document).on('click.movement', '#movementTable .sortable-th', function () {
    var key = $(this).data('sort-key');
    var idx = movementSortStack.findIndex(function (item) {
      return item.key === key;
    });

    if (idx === -1) {
      movementSortStack.push({ key: key, dir: 'asc' });
    } else if (movementSortStack[idx].dir === 'asc') {
      movementSortStack[idx].dir = 'desc';
    } else {
      movementSortStack.splice(idx, 1);
    }

    applyMovementFiltersAndSort();
  });

  $(document).on('click.movement', '#movementTable .filter-icon', function (e) {
    e.stopPropagation();
    var $th = $(this).closest('.filter-th');
    var $dropdown = $th.find('.filter-dropdown');
    $('#movementTable .filter-dropdown').not($dropdown).addClass('d-none');
    $dropdown.toggleClass('d-none');
  });

  $(document).on('click.movement', '#movementTable .filter-dropdown', function (e) {
    e.stopPropagation();
  });

  $(document).on('click.movement', function () {
    $('#movementTable .filter-dropdown').addClass('d-none');
  });

  $(document).on('change.movement', '#movementTable .filter-dropdown input[type="checkbox"]', function () {
    var $th = $(this).closest('.filter-th');
    var key = $th.data('filter-key');
    var selected = [];
    $th.find('input[type="checkbox"]:checked').each(function () {
      selected.push($(this).val());
    });
    movementFilterState[key] = selected;
    applyMovementFiltersAndSort();
  });

  $(document).on('click.movement', '#btnClearMovementSort', function () {
    movementSortStack = [{ key: 'date', dir: 'desc' }];
    movementFilterState.employeeId = [];
    movementFilterState.movementType = [];
    applyMovementDayRange(30);
  });

  $(document).on('click.movement', '.movement-detail-link', function () {
    var movementId = $(this).data('movement-id');
    var record = (window.movementCache || []).find(function (item) {
      return item.id === movementId;
    });

    if (record) {
      showMovementDetailModal(record);
    }
  });
};

window.addMovementRecord = function (record) {
  var normalizedRecord = normalizeMovementRecord(record);

  window.generatedMovementRecords = window.generatedMovementRecords || [];
  window.generatedMovementRecords.unshift(normalizedRecord);

  if (Array.isArray(window.movementCache)) {
    window.movementCache.unshift(normalizedRecord);
  }

  if ($('#movementTableBody').length > 0) {
    populateEmployeeFilterOptions(window.movementCache || window.generatedMovementRecords);
    applyMovementFiltersAndSort();
  }
};

function mergeMovementRecords(generatedRecords, baseRecords) {
  var merged = [];
  var idMap = {};

  (generatedRecords || []).concat(baseRecords || []).forEach(function (record) {
    var normalizedRecord = normalizeMovementRecord(record);

    if (!idMap[normalizedRecord.id]) {
      merged.push(normalizedRecord);
      idMap[normalizedRecord.id] = true;
    }
  });

  return merged;
}

function normalizeMovementRecord(record) {
  var items = Array.isArray(record && record.items)
    ? record.items
    : [{
      productName: record && record.productName,
      quantity: record && record.quantity,
      fromStore: record && record.fromStore,
      toStore: record && record.toStore
    }];

  return {
    id: (record && record.id) || 'MV-NEW-' + Date.now(),
    date: (record && record.date) || '',
    employeeId: (record && (record.employeeId || record.adminId || record.staffId)) || '—',
    items: items.map(function (item) {
      var inferredType = inferMovementType(item);
      return {
        productId: (item && item.productId) || '',
        productName: (item && item.productName) || '未命名商品',
        quantity: parseInt(item && item.quantity, 10) || 0,
        fromStore: (item && item.fromStore) || '—',
        toStore:   (item && item.toStore)   || '—',
        orderId: (item && item.orderId) || '',
        type:      (item && item.type)      || inferredType
      };
    })
  };
}

function inferMovementType(item) {
  var explicitType = item && item.type;
  if (explicitType) {
    return explicitType;
  }

  var fromStore = String((item && item.fromStore) || '');
  var toStore = String((item && item.toStore) || '');

  if (toStore.indexOf('損耗') !== -1) {
    return '損耗';
  }
  if (fromStore.indexOf('調至租借') !== -1 || toStore.indexOf('（來自商店）') !== -1) {
    return '調撥';
  }
  if (fromStore.indexOf('（增加）') !== -1 || toStore.indexOf('（減少）') !== -1) {
    return '營地互轉';
  }
  if (fromStore !== '—' && toStore !== '—') {
    return '移轉';
  }
  return '—';
}

function getRecordMovementTypes(record) {
  var types = {};
  (record.items || []).forEach(function (item) {
    types[item.type || '—'] = true;
  });
  return Object.keys(types);
}

function populateEmployeeFilterOptions(records) {
  var ids = {};
  (records || []).forEach(function (record) {
    var id = record.employeeId;
    if (id && id !== '—') {
      ids[id] = true;
    }
  });

  var html = Object.keys(ids)
    .sort()
    .map(function (id) {
      return '<label><input type="checkbox" value="' + escapeMovementHtml(id) + '"> ' + escapeMovementHtml(id) + '</label>';
    })
    .join('');

  var $dropdown = $('#movementTable .filter-th[data-filter-key="employeeId"] .filter-dropdown');
  if ($dropdown.length) {
    $dropdown.html(html || '<span class="text-muted small px-2">尚無員工資料</span>');
  }
}

function fmtMovementDateISO(d) {
  if (!d) {
    return null;
  }
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function applyMovementDayRange(days) {
  if (days === 'all') {
    movementDateState.days = 'all';
    movementDateState.startDate = null;
    movementDateState.endDate = null;
    movementFilterState.dateStart = null;
    movementFilterState.dateEnd = null;
  } else if (days === 'month') {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    movementDateState.days = 'month';
    movementDateState.startDate = start;
    movementDateState.endDate = new Date(now);
    movementFilterState.dateStart = fmtMovementDateISO(start);
    movementFilterState.dateEnd = fmtMovementDateISO(new Date(now));
  } else {
    var end = new Date();
    var startRange = new Date(end);
    startRange.setDate(startRange.getDate() - (days - 1));
    movementDateState.days = days;
    movementDateState.startDate = startRange;
    movementDateState.endDate = new Date(end);
    movementFilterState.dateStart = fmtMovementDateISO(startRange);
    movementFilterState.dateEnd = fmtMovementDateISO(new Date(end));
  }

  if (days !== 'custom') {
    $('#movementDateRangePicker').hide();
  }

  updateMovementPeriodLabel();
  applyMovementFiltersAndSort();
}

function applyMovementCustomRange(dateStart, dateEnd) {
  movementDateState.days = 'custom';
  movementDateState.startDate = dateStart ? new Date(dateStart + 'T00:00:00') : null;
  movementDateState.endDate = dateEnd ? new Date(dateEnd + 'T00:00:00') : null;
  movementFilterState.dateStart = dateStart || null;
  movementFilterState.dateEnd = dateEnd || null;
  updateMovementPeriodLabel();
  applyMovementFiltersAndSort();

  var pickerEl = document.querySelector('#movementDateRangePicker');
  if (pickerEl && pickerEl._flatpickr && movementDateState.startDate && movementDateState.endDate) {
    pickerEl._flatpickr.setDate([movementDateState.startDate, movementDateState.endDate], false);
  }
  $('#movementDateRangePicker').show();
}

function updateMovementPeriodLabel() {
  var days = movementDateState.days;
  $('#movementPeriodBtns button').removeClass('active');
  if (days !== 'all') {
    $('#movementPeriodBtns button[data-days="' + days + '"]').addClass('active');
  }

  var $label = $('#movementPeriodLabel');
  if (days === 'custom') {
    $label.addClass('d-none').text('');
    return;
  }

  $label.removeClass('d-none');
  if (days === 'all') {
    $label.text('全部期間');
  } else if (movementDateState.startDate && movementDateState.endDate) {
    $label.text(fmtMovementDateISO(movementDateState.startDate) + ' 至 ' + fmtMovementDateISO(movementDateState.endDate));
  } else {
    $label.text('');
  }
}

function enterMovementCustomMode() {
  movementDateState.days = 'custom';
  updateMovementPeriodLabel();
  var pickerEl = document.querySelector('#movementDateRangePicker');
  if (pickerEl && pickerEl._flatpickr && movementDateState.startDate && movementDateState.endDate) {
    pickerEl._flatpickr.setDate([movementDateState.startDate, movementDateState.endDate], false);
  }
  $('#movementDateRangePicker').show().trigger('click');
}

function initMovementFlatpickr() {
  if (typeof flatpickr === 'undefined') {
    return;
  }

  var locale = flatpickr.l10ns && flatpickr.l10ns.zh_tw ? flatpickr.l10ns.zh_tw : 'default';
  flatpickr('#movementDateRangePicker', {
    mode: 'range',
    dateFormat: 'Y-m-d',
    locale: locale,
    onClose: function (selectedDates) {
      if (selectedDates.length === 2) {
        applyMovementCustomRange(fmtMovementDateISO(selectedDates[0]), fmtMovementDateISO(selectedDates[1]));
      }
    },
  });
}

function setupMovementPeriodFilter() {
  $(document).on('click.movement', '#movementPeriodBtns button[data-days]', function () {
    var days = $(this).data('days');

    if (days === 'custom') {
      enterMovementCustomMode();
    } else if (days === 'month') {
      if ($(this).hasClass('active')) {
        applyMovementDayRange('all');
      } else {
        applyMovementDayRange('month');
      }
    } else if ($(this).hasClass('active')) {
      applyMovementDayRange('all');
    } else {
      applyMovementDayRange(parseInt(days, 10));
    }
  });
}

function applyMovementFiltersAndSort() {
  var data = (window.movementCache || []).slice();

  if (movementFilterState.employeeId.length > 0) {
    data = data.filter(function (record) {
      return movementFilterState.employeeId.indexOf(record.employeeId) !== -1;
    });
  }

  if (movementFilterState.movementType.length > 0) {
    data = data.filter(function (record) {
      var types = getRecordMovementTypes(record);
      return types.some(function (type) {
        return movementFilterState.movementType.indexOf(type) !== -1;
      });
    });
  }

  if (movementFilterState.dateStart) {
    data = data.filter(function (record) {
      return (record.date || '').slice(0, 10) >= movementFilterState.dateStart;
    });
  }
  if (movementFilterState.dateEnd) {
    data = data.filter(function (record) {
      return (record.date || '').slice(0, 10) <= movementFilterState.dateEnd;
    });
  }

  if (movementSortStack.length > 0) {
    data.sort(function (a, b) {
      for (var i = 0; i < movementSortStack.length; i++) {
        var key = movementSortStack[i].key;
        var dir = movementSortStack[i].dir === 'asc' ? 1 : -1;
        var valA = a[key] || '';
        var valB = b[key] || '';
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
      }
      return 0;
    });
  }

  renderMovementTable(data);
  updateMovementSortUI();
  updateMovementFilterUI();
}

function updateMovementSortUI() {
  $('#movementTable .sort-icon').removeClass('fa-sort-up fa-sort-down sort-active').addClass('fa-sort');

  movementSortStack.forEach(function (item) {
    var $icon = $('#movementTable .sortable-th[data-sort-key="' + item.key + '"] .sort-icon');
    $icon.removeClass('fa-sort').addClass(item.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down').addClass('sort-active');
  });

  var isDefaultSort =
    movementSortStack.length === 1 &&
    movementSortStack[0].key === 'date' &&
    movementSortStack[0].dir === 'desc';
  var hasActiveFilter =
    movementFilterState.employeeId.length > 0 ||
    movementFilterState.movementType.length > 0;
  var isDefaultDate = movementDateState.days === 30;

  $('#btnClearMovementSort').toggleClass('d-none', isDefaultSort && !hasActiveFilter && isDefaultDate);
}

function updateMovementFilterUI() {
  ['employeeId', 'movementType'].forEach(function (key) {
    var $th = $('#movementTable .filter-th[data-filter-key="' + key + '"]');
    var $icon = $th.find('.filter-icon');
    var $dot = $th.find('.filter-dot');

    if (movementFilterState[key].length > 0) {
      $icon.addClass('active');
      $dot.removeClass('d-none');
      $th.find('input[type="checkbox"]').each(function () {
        $(this).prop('checked', movementFilterState[key].indexOf($(this).val()) !== -1);
      });
    } else {
      $icon.removeClass('active');
      $dot.addClass('d-none');
      $th.find('input[type="checkbox"]').prop('checked', false);
    }
  });
}

/**
 * 從 items 陣列摘要顯示「異動性質」（取各 item type 的唯一值集合）。
 * 若有多種 type，用逗號連接。
 * Summarizes unique movement types from the items array.
 */
function summarizeMovementTypes(items) {
  var types = {};
  (items || []).forEach(function (item) {
    var t = item.type || '—';
    types[t] = true;
  });
  var keys = Object.keys(types);
  return keys.length > 0 ? keys.join('、') : '—';
}


function renderMovementTable(records) {
  if (!records || records.length === 0) {
    $('#movementTableBody').html(
      '<tr><td colspan="5" class="text-center text-muted py-4">目前沒有庫存異動紀錄</td></tr>'
    );
    setMovementResultCount(0);
    return;
  }

  var html = records.map(function (record) {
    var itemCount = (record.items || []).length;
    var typesSummary = summarizeMovementTypes(record.items);

    return '<tr data-movement-id="' + escapeMovementHtml(record.id) + '">' +
      '<td>' +
      '<button type="button" class="btn btn-link p-0 fw-semibold movement-detail-link" ' +
      'data-movement-id="' + escapeMovementHtml(record.id) + '">' +
      escapeMovementHtml(record.id) +
      '</button>' +
      '</td>' +
      '<td>' + escapeMovementHtml(record.date) + '</td>' +
      '<td>' + escapeMovementHtml(record.employeeId || '—') + '</td>' +
      '<td>' + itemCount + ' 筆</td>' +
      '<td>' + escapeMovementHtml(typesSummary) + '</td>' +
      '</tr>';
  }).join('');

  $('#movementTableBody').html(html);
  setMovementResultCount(records.length);
}

function showMovementDetailModal(record) {
  $('#modalMovementId').text(record.id);
  $('#modalMovementDate').text(record.date);
  $('#modalMovementEmployeeId').text(record.employeeId || '—');

  var itemsHtml = (record.items || []).map(function (item) {
    var typeBadge = item.type || '—';
    // 損耗類型加上醒目標示 / Highlight '損耗' type items
    var typeCellContent = item.type === '損耗'
      ? '<span class="badge bg-warning text-dark">' + escapeMovementHtml(typeBadge) + '</span>'
      : escapeMovementHtml(typeBadge);

    return '<tr>' +
      '<td>' + escapeMovementHtml(item.productName) + '</td>' +
      '<td class="text-center fw-semibold">' + escapeMovementHtml(item.quantity) + '</td>' +
      '<td>' + escapeMovementHtml(item.fromStore) + '</td>' +
      '<td>' + escapeMovementHtml(item.toStore) + '</td>' +
      '<td>' + typeCellContent + '</td>' +
      '</tr>';
  }).join('');

  $('#modalMovementItems').html(
    itemsHtml || '<tr><td colspan="5" class="text-center text-muted">沒有異動明細</td></tr>'
  );

  var modalEl = document.getElementById('movementDetailModal');
  if (!modalEl) {
    renderMovementMessage('error', '異動明細對話框載入失敗');
    return;
  }
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function setMovementResultCount(count) {
  $('#movementResultCount').text('顯示 ' + count + ' 筆異動');
}

function renderMovementMessage(type, message) {
  var className = type === 'error' ? 'text-danger' : 'text-muted';
  $('#movementTableBody').html(
    '<tr><td colspan="5" class="text-center py-4 ' + className + '">' +
      (type === 'error' ? '<i class="fas fa-exclamation-triangle me-2"></i>' : '') +
      escapeMovementHtml(message) +
      '</td></tr>'
  );
  setMovementResultCount(0);
}

function validateMovementDom() {
  var missing = MOVEMENT_REQUIRED_SELECTORS.filter(function (selector) {
    return document.querySelector(selector) === null;
  });

  if (missing.length === 0) {
    return true;
  }

  $('#contentArea').html(
    '<div class="alert alert-danger d-flex align-items-center gap-2">' +
      '<i class="fas fa-exclamation-triangle"></i>' +
      '<span>庫存異動模組載入失敗，缺少必要介面元素：' + escapeMovementHtml(missing.join(', ')) + '</span>' +
      '</div>'
  );
  return false;
}

function escapeMovementHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char];
  });
}
