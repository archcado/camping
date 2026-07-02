/**
 * admin/js/permissions.js
 * 權限管理模組 — 員工資料層 + 權限管理頁 UI
 *
 * 資料來源：localStorage.adminEmployees（未來可替換為 REST API）
 * Permission module — employee store + permissions admin UI (localStorage mock)
 */

// ==========================================================
// === 9 個後台頁面定義（Sidebar 順序）===
// ==========================================================
/** @type {Array<{key: string, label: string}>} */
window.ADMIN_SECTIONS = [
  { key: 'analytics',   label: '分析報表' },
  { key: 'orders',      label: '訂單管理' },
  { key: 'movement',    label: '庫存異動紀錄' },
  { key: 'products',    label: '商品與庫存' },
  { key: 'customers',   label: '客戶管理' },
  { key: 'discounts',   label: '折扣管理' },
  { key: 'reviews',     label: '評論管理' },
  { key: 'bookings',    label: '預約/租借管理' },
  { key: 'permissions', label: '權限管理' },
];

var EMPLOYEE_STORAGE_KEY = 'adminEmployees';

// --- API 預留（未來串接後端時替換 localStorage 邏輯）---
// GET    /api/admin/employees
// POST   /api/admin/employees
// PUT    /api/admin/employees/:id
// PATCH  /api/admin/employees/:id/status
// POST   /api/admin/login

/**
 * 建立預設權限物件（9 頁 view/edit）
 * Build default permissions object for all 9 sections
 * @param {boolean} allTrue - true = 全部開放；false = 全部關閉
 */
function getDefaultPermissions(allTrue) {
  var perms = {};
  window.ADMIN_SECTIONS.forEach(function (sec) {
    perms[sec.key] = { view: !!allTrue, edit: !!allTrue };
  });
  return perms;
}

/**
 * 第一次使用時寫入種子資料（01 超級管理員、02 示範員工）
 * Seed employees 01 (super admin) and 02 (demo staff) on first run
 */
function initEmployeeStore() {
  if (localStorage.getItem(EMPLOYEE_STORAGE_KEY)) {
    return;
  }

  var seedDate = '2026-06-14';
  var employees = [
    {
      id: '01',
      displayName: '王老闆',
      isSuperAdmin: true,
      isActive: true,
      createdAt: seedDate,
      permissions: getDefaultPermissions(true),
    },
    {
      id: '02',
      displayName: '測試員工',
      isSuperAdmin: false,
      isActive: true,
      createdAt: seedDate,
      permissions: {
        analytics:   { view: false, edit: false },
        orders:      { view: true,  edit: true  },
        movement:    { view: false, edit: false },
        products:    { view: false, edit: false },
        customers:   { view: true,  edit: false },
        discounts:   { view: false, edit: false },
        reviews:     { view: false, edit: false },
        permissions: { view: false, edit: false },
        bookings:    { view: false, edit: false },
      },
    },
  ];

  saveEmployees(employees);
}

/** 從 localStorage 讀取員工列表 / Fetch employees from localStorage */
function fetchEmployees() {
  initEmployeeStore();
  try {
    return JSON.parse(localStorage.getItem(EMPLOYEE_STORAGE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

/** 寫入 localStorage / Save employees to localStorage */
function saveEmployees(list) {
  localStorage.setItem(EMPLOYEE_STORAGE_KEY, JSON.stringify(list));
}

/**
 * 自動產生下一個員工編號（01~09 補零，超過 99 不補零）
 * Next employee id: zero-pad to 2 digits until 99, then "100", "101"...
 */
function getNextEmployeeId(employees) {
  var maxNum = 0;
  (employees || []).forEach(function (emp) {
    var num = parseInt(emp.id, 10);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  });
  var next = maxNum + 1;
  return next <= 99 ? String(next).padStart(2, '0') : String(next);
}

/** 依 ID 查找員工 / Find employee by id */
function findEmployeeById(id) {
  return fetchEmployees().find(function (emp) {
    return emp.id === id;
  }) || null;
}

/** 計算啟用中的超級管理員人數 / Count active super admins */
function countActiveSuperAdmins(employees, excludeId) {
  return (employees || []).filter(function (emp) {
    if (excludeId && emp.id === excludeId) return false;
    return emp.isSuperAdmin && emp.isActive;
  }).length;
}

/**
 * 是否允許停用某員工（含超級管理員保護規則）
 * Can deactivate employee? (protect last active super admin)
 */
function canDeactivateEmployee(target, currentAdminId) {
  if (target.id === currentAdminId) {
    return { ok: false, message: '無法停用自己的帳號' };
  }
  if (target.isSuperAdmin && target.isActive) {
    var employees = fetchEmployees();
    var others = countActiveSuperAdmins(employees, target.id);
    if (others < 1) {
      return { ok: false, message: '系統至少需保留 1 位啟用中的超級管理員' };
    }
  }
  return { ok: true };
}

/**
 * 是否允許取消超級管理員身份
 * Can remove super admin flag from employee?
 */
function canRemoveSuperAdminStatus(employee, employees) {
  if (!employee.isSuperAdmin) {
    return { ok: true };
  }
  if (!employee.isActive) {
    return { ok: true };
  }
  var others = countActiveSuperAdmins(employees, employee.id);
  if (others < 1) {
    return { ok: false, message: '系統至少需保留 1 位啟用中的超級管理員' };
  }
  return { ok: true };
}

// 模組載入時初始化種子資料 / Initialize seed data on script load
initEmployeeStore();

// 匯出給 login.html 使用 / Expose helpers for login page
window.fetchEmployees = fetchEmployees;
window.saveEmployees = saveEmployees;
window.findEmployeeById = findEmployeeById;
window.getNextEmployeeId = getNextEmployeeId;
window.getDefaultPermissions = getDefaultPermissions;

// ==========================================================
// === 權限管理頁 UI ===
// ==========================================================

/** 權限管理頁初始化（由 core.js loadSection 呼叫） */
window.initPermissions = function () {
  $(document).off('.permissions');

  renderEmployeeTable();

  // 新增員工按鈕
  $(document).on('click.permissions', '#addEmployeeBtn', function () {
    openEmployeeModal(null);
  });

  // 編輯員工
  $(document).on('click.permissions', '.btn-edit-employee', function () {
    var empId = $(this).data('employee-id');
    openEmployeeModal(empId);
  });

  // 停用 / 啟用
  $(document).on('click.permissions', '.btn-toggle-employee', function () {
    var empId = $(this).data('employee-id');
    toggleEmployeeStatus(empId);
  });

  // 超級管理員 checkbox：鎖定權限矩陣
  $(document).on('change.permissions', '#empIsSuperAdmin', function () {
    syncPermissionMatrixLock($(this).is(':checked'));
  });

  // 權限矩陣：查看 / 編輯連動
  $(document).on('change.permissions', '.perm-view-cb', function () {
    var section = $(this).data('section');
    var $editCb = $('.perm-edit-cb[data-section="' + section + '"]');
    if (!$(this).is(':checked')) {
      $editCb.prop('checked', false);
    }
  });

  $(document).on('change.permissions', '.perm-edit-cb', function () {
    var section = $(this).data('section');
    var $viewCb = $('.perm-view-cb[data-section="' + section + '"]');
    if ($(this).is(':checked')) {
      $viewCb.prop('checked', true);
    }
  });

  // 儲存員工
  $(document).on('click.permissions', '#saveEmployeeBtn', function () {
    saveEmployeeFromModal();
  });

  // Modal 關閉時重置
  $(document).on('hidden.bs.modal.permissions', '#employeeModal', function () {
    resetEmployeeModal();
  });

  // 套用本頁編輯權限（無 edit 時按鈕 disabled）
  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('permissions', $('#contentArea'));
  }
};

/** 渲染員工列表 / Render employee table */
function renderEmployeeTable() {
  var employees = fetchEmployees();
  var currentId = sessionStorage.getItem('adminId') || '';
  updateEmployeeResultCount(employees.length);

  if (!employees.length) {
    $('#employeeTableBody').html(
      '<tr><td colspan="5" class="yr-admin-permissions-empty text-center py-4">' +
      '<i class="fas fa-user-slash me-2" aria-hidden="true"></i>尚無員工資料</td></tr>'
    );
    return;
  }

  var html = employees.map(function (emp) {
    var roleLabel = renderEmployeeRole(emp);
    var statusBadge = renderEmployeeStatus(emp);

    var toggleBtn = '';
    // 自己那一列不顯示停用按鈕 / Hide toggle on current user's row
    if (emp.id !== currentId) {
      var toggleLabel = emp.isActive ? '停用' : '啟用';
      var toggleClass = emp.isActive ? 'btn-outline-warning' : 'btn-outline-success';
      toggleBtn =
        '<button type="button" class="btn btn-sm ' + toggleClass + ' btn-toggle-employee ms-1" ' +
        'data-employee-id="' + emp.id + '">' +
        '<i class="fas ' + (emp.isActive ? 'fa-user-slash' : 'fa-user-check') + ' me-1" aria-hidden="true"></i>' +
        toggleLabel + '</button>';
    }

    return '<tr data-employee-id="' + emp.id + '">' +
      '<td class="yr-admin-permission-id">' + emp.id + '</td>' +
      '<td>' + escapeHtml(emp.displayName) + '</td>' +
      '<td class="yr-admin-permission-role">' + roleLabel + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td class="yr-admin-permission-actions">' +
        '<button type="button" class="btn btn-sm btn-outline-primary btn-edit-employee" ' +
        'data-employee-id="' + emp.id + '">' +
        '<i class="fas fa-pen me-1" aria-hidden="true"></i>編輯</button>' +
        toggleBtn +
      '</td>' +
      '</tr>';
  }).join('');

  $('#employeeTableBody').html(html);

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('permissions', $('#contentArea'));
  }
}

function updateEmployeeResultCount(count) {
  $('#permissionResultCount').text('目前 ' + count + ' 位員工');
}

function renderEmployeeStatus(emp) {
  if (emp && emp.isActive === true) {
    return '<span class="yr-admin-employee-status yr-admin-employee-status--active">' +
      '<i class="fas fa-circle-check me-1" aria-hidden="true"></i>啟用</span>';
  }
  if (emp && emp.isActive === false) {
    return '<span class="yr-admin-employee-status yr-admin-employee-status--disabled">' +
      '<i class="fas fa-circle-pause me-1" aria-hidden="true"></i>停用</span>';
  }
  return '<span class="yr-admin-employee-status yr-admin-employee-status--unknown">' +
    '<i class="fas fa-circle-question me-1" aria-hidden="true"></i>未知</span>';
}

function renderEmployeeRole(emp) {
  if (emp && emp.isSuperAdmin === true) {
    return '<span class="yr-admin-role yr-admin-role--super-admin">超級管理員</span>';
  }
  if (emp && emp.isSuperAdmin === false) {
    return '<span class="yr-admin-role yr-admin-role--staff">一般員工</span>';
  }
  return '<span class="yr-admin-role yr-admin-role--unknown">角色未知</span>';
}

/** 開啟新增/編輯 Modal / Open add or edit employee modal */
function openEmployeeModal(employeeId) {
  var isEdit = !!employeeId;
  var emp = isEdit ? findEmployeeById(employeeId) : null;

  $('#employeeModalLabel').text(isEdit ? '編輯員工' : '新增員工');
  $('#empIdDisplay').val(isEdit ? emp.id : getNextEmployeeId(fetchEmployees()));
  $('#empDisplayName').val(isEdit ? emp.displayName : '');
  $('#empIsSuperAdmin').prop('checked', isEdit ? emp.isSuperAdmin : false);
  $('#employeeModal').data('edit-id', isEdit ? emp.id : '');

  renderPermissionMatrix(isEdit ? emp.permissions : getDefaultPermissions(false), isEdit ? emp.isSuperAdmin : false);

  new bootstrap.Modal('#employeeModal').show();
}

/** 渲染 9 頁權限矩陣 / Render 9-row permission matrix */
function renderPermissionMatrix(permissions, lockAll) {
  var rows = window.ADMIN_SECTIONS.map(function (sec) {
    var perm = permissions[sec.key] || { view: false, edit: false };
    var disabledAttr = lockAll ? ' disabled' : '';
    var checkedView = lockAll || perm.view ? ' checked' : '';
    var checkedEdit = lockAll || perm.edit ? ' checked' : '';

    return '<tr>' +
      '<td>' + sec.label + '</td>' +
      '<td class="text-center">' +
        '<input type="checkbox" class="form-check-input perm-view-cb" ' +
        'data-section="' + sec.key + '"' + checkedView + disabledAttr + '>' +
      '</td>' +
      '<td class="text-center">' +
        '<input type="checkbox" class="form-check-input perm-edit-cb" ' +
        'data-section="' + sec.key + '"' + checkedEdit + disabledAttr + '>' +
      '</td>' +
      '</tr>';
  }).join('');

  $('#permissionMatrixBody').html(rows);
}

/** 超級管理員勾選時鎖定矩陣 / Lock matrix when super admin checked */
function syncPermissionMatrixLock(isSuperAdmin) {
  if (isSuperAdmin) {
    $('.perm-view-cb, .perm-edit-cb').prop('checked', true).prop('disabled', true);
  } else {
    $('.perm-view-cb, .perm-edit-cb').prop('disabled', false);
  }
}

/** 從 Modal 讀取權限 / Read permissions from modal checkboxes */
function readPermissionsFromModal(isSuperAdmin) {
  if (isSuperAdmin) {
    return getDefaultPermissions(true);
  }
  var perms = {};
  window.ADMIN_SECTIONS.forEach(function (sec) {
    perms[sec.key] = {
      view: $('.perm-view-cb[data-section="' + sec.key + '"]').is(':checked'),
      edit: $('.perm-edit-cb[data-section="' + sec.key + '"]').is(':checked'),
    };
  });
  return perms;
}

/** 儲存員工（新增或更新）/ Save employee from modal */
function saveEmployeeFromModal() {
  var displayName = $('#empDisplayName').val().trim();
  if (!displayName) {
    window.showAdminToast('請輸入顯示名稱', 'error');
    $('#empDisplayName').addClass('is-invalid');
    return;
  }
  $('#empDisplayName').removeClass('is-invalid');

  var editId = $('#employeeModal').data('edit-id');
  var isEdit = !!editId;
  var isSuperAdmin = $('#empIsSuperAdmin').is(':checked');
  var permissions = readPermissionsFromModal(isSuperAdmin);
  var employees = fetchEmployees();
  var currentAdminId = sessionStorage.getItem('adminId') || '';

  if (isEdit) {
    var idx = employees.findIndex(function (e) { return e.id === editId; });
    if (idx === -1) {
      window.showAdminToast('找不到員工資料', 'error');
      return;
    }

    var updated = Object.assign({}, employees[idx], {
      displayName: displayName,
      isSuperAdmin: isSuperAdmin,
      permissions: permissions,
    });

    if (employees[idx].isSuperAdmin && !isSuperAdmin) {
      var check = canRemoveSuperAdminStatus(employees[idx], employees);
      if (!check.ok) {
        window.showAdminToast(check.message, 'error');
        return;
      }
    }

    employees[idx] = updated;
    saveEmployees(employees);
    renderEmployeeTable();

    // 若編輯的是自己，同步更新 sessionStorage
    if (editId === currentAdminId) {
      sessionStorage.setItem('adminName', displayName);
      sessionStorage.setItem('isSuperAdmin', String(isSuperAdmin));
      sessionStorage.setItem('adminPermissions', JSON.stringify(permissions));
      $('#sidebarAdminName').text(displayName);
      $('#topbarAdminName').html('<i class="fas fa-user me-2"></i>' + displayName);
      if (typeof window.applySidebarPermissions === 'function') {
        window.applySidebarPermissions();
      }
    }

    bootstrap.Modal.getInstance(document.getElementById('employeeModal')).hide();
    window.showAdminToast('員工資料已更新');
    return;
  }

  // 新增員工
  var newEmp = {
    id: getNextEmployeeId(employees),
    displayName: displayName,
    isSuperAdmin: isSuperAdmin,
    isActive: true,
    createdAt: new Date().toISOString().slice(0, 10),
    permissions: permissions,
  };
  employees.push(newEmp);
  saveEmployees(employees);
  renderEmployeeTable();
  bootstrap.Modal.getInstance(document.getElementById('employeeModal')).hide();
  window.showAdminToast('員工已新增');
}

/** 停用或啟用員工 / Toggle employee active status */
function toggleEmployeeStatus(employeeId) {
  var employees = fetchEmployees();
  var idx = employees.findIndex(function (e) { return e.id === employeeId; });
  if (idx === -1) return;

  var target = employees[idx];
  var currentAdminId = sessionStorage.getItem('adminId') || '';

  if (target.isActive) {
    var deactivateCheck = canDeactivateEmployee(target, currentAdminId);
    if (!deactivateCheck.ok) {
      window.showAdminToast(deactivateCheck.message, 'error');
      return;
    }
    employees[idx].isActive = false;
    window.showAdminToast('員工 ' + target.displayName + ' 已停用');
  } else {
    employees[idx].isActive = true;
    window.showAdminToast('員工 ' + target.displayName + ' 已啟用');
  }

  saveEmployees(employees);
  renderEmployeeTable();

  if (typeof window.applyEditPermission === 'function') {
    window.applyEditPermission('permissions', $('#contentArea'));
  }
}

function resetEmployeeModal() {
  $('#empDisplayName').removeClass('is-invalid');
  $('#employeeModal').removeData('edit-id');
}

/** 簡單 HTML 跳脫 / Escape HTML for display */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
