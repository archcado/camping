import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PATHS = {
  currentSource: path.join(repoRoot, 'admin', 'data', 'customers.before-merge.json'),
  legacySource: path.join(repoRoot, 'admin', 'data', 'customers.old-source.json'),
  mergedOutput: path.join(repoRoot, 'admin', 'data', 'customers.merged.json'),
  reportOutput: path.join(repoRoot, 'admin', 'data', 'customers.merge-report.json'),
};

const KNOWN_FIELDS = new Set([
  'id',
  'customerId',
  'memberId',
  'avatar',
  'name',
  'phone',
  'email',
  'birthday',
  'registeredAt',
  'createdAt',
  'registerDate',
  'updatedAt',
  'tier',
  'status',
  'points',
  'coupons',
  'totalSpent',
  'tags',
  'orders',
  'purchaseHistory',
  'bookings',
  'bookingHistory',
]);

function fail(message) {
  console.error(`[merge-admin-customers] ${message}`);
  process.exit(1);
}

function readJsonArray(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`無法讀取 ${label}：${filePath} (${error.message})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`${label} JSON 解析失敗：${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    fail(`${label} 最外層必須是陣列`);
  }

  return parsed;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
  const email = normalizeText(value);
  return email ? email.toLowerCase() : '';
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatPhone(value) {
  const digits = normalizePhoneDigits(value);
  if (digits.length === 10) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return normalizeText(value) || digits;
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  const candidate = text.replace(/\//g, '-').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return candidate;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString().slice(0, 10);
}

function isPresent(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function pickNewPriority(newValue, oldValue) {
  return isPresent(newValue) ? deepClone(newValue) : deepClone(oldValue);
}

function pickEarlierDate(newValue, oldValue) {
  const newDate = normalizeDate(newValue);
  const oldDate = normalizeDate(oldValue);
  if (!newDate) {
    return oldDate;
  }
  if (!oldDate) {
    return newDate;
  }
  return newDate <= oldDate ? newDate : oldDate;
}

function pickLaterDate(newValue, oldValue) {
  const newDate = normalizeDate(newValue);
  const oldDate = normalizeDate(oldValue);
  if (!newDate) {
    return oldDate;
  }
  if (!oldDate) {
    return newDate;
  }
  return newDate >= oldDate ? newDate : oldDate;
}

function uniqueStrings(values, tracker) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = normalizeText(value);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      if (tracker) {
        tracker.count += 1;
      }
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return result;
}

function buildObjectIdentity(item, preferredKeys, fallbackFields) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  for (const key of preferredKeys) {
    const value = normalizeText(item[key]);
    if (value) {
      return `${key}:${value.toLowerCase()}`;
    }
  }

  const parts = fallbackFields
    .map((field) => {
      const value = item[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `${field}:${value}`;
      }
      const text = normalizeText(value);
      return text ? `${field}:${text.toLowerCase()}` : '';
    })
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join('|');
  }

  return JSON.stringify(item);
}

function mergeObjectArray(newItems, oldItems, options, tracker) {
  const result = [];
  const seen = new Set();

  for (const item of [...(newItems || []), ...(oldItems || [])]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const identity = buildObjectIdentity(item, options.preferredKeys, options.fallbackFields);
    if (seen.has(identity)) {
      tracker.count += 1;
      continue;
    }
    seen.add(identity);
    result.push(deepClone(item));
  }

  return result;
}

function hasPurchaseAmounts(items) {
  return (items || []).some((item) => toNumberOrNull(item.amount ?? item.total ?? item.totalSpent) !== null);
}

function recalculatePurchaseTotal(items) {
  let total = 0;
  let hasAmount = false;
  for (const item of items || []) {
    const amount = toNumberOrNull(item.amount ?? item.total ?? item.totalSpent);
    if (amount === null) {
      continue;
    }
    total += amount;
    hasAmount = true;
  }
  return hasAmount ? total : null;
}

function recordConflict(report, customerId, field, newValue, oldValue, chosenValue, resolution) {
  report.conflicts.push({
    customerId,
    field,
    newValue: deepClone(newValue),
    oldValue: deepClone(oldValue),
    chosenValue: deepClone(chosenValue),
    resolution,
  });
}

function normalizeCustomer(rawCustomer) {
  const customer = deepClone(rawCustomer) || {};
  const id = normalizeText(customer.id || customer.customerId || customer.memberId);
  if (!id) {
    fail('發現缺少 id/customerId/memberId 的會員資料，無法整併');
  }

  customer.id = id;
  customer.avatar = normalizeText(customer.avatar);
  customer.name = normalizeText(customer.name);
  customer.phone = formatPhone(customer.phone);
  customer.email = normalizeEmail(customer.email);
  customer.birthday = normalizeDate(customer.birthday);
  customer.registeredAt = normalizeDate(customer.registeredAt);
  customer.tier = normalizeText(customer.tier);
  customer.points = toNumberOrNull(customer.points) ?? 0;
  customer.coupons = toNumberOrNull(customer.coupons) ?? 0;
  customer.totalSpent = toNumberOrNull(customer.totalSpent) ?? 0;
  customer.tags = uniqueStrings(customer.tags || []);
  customer.orders = uniqueStrings(customer.orders || []);

  if (Object.prototype.hasOwnProperty.call(rawCustomer, 'createdAt')) {
    customer.createdAt = normalizeDate(customer.createdAt);
  } else {
    delete customer.createdAt;
  }

  if (Object.prototype.hasOwnProperty.call(rawCustomer, 'registerDate')) {
    customer.registerDate = normalizeDate(customer.registerDate);
  } else {
    delete customer.registerDate;
  }

  if (Object.prototype.hasOwnProperty.call(rawCustomer, 'updatedAt')) {
    customer.updatedAt = normalizeDate(customer.updatedAt);
  } else {
    delete customer.updatedAt;
  }

  if (Object.prototype.hasOwnProperty.call(rawCustomer, 'status')) {
    customer.status = normalizeText(customer.status);
  } else {
    delete customer.status;
  }

  if (Object.prototype.hasOwnProperty.call(rawCustomer, 'purchaseHistory')) {
    customer.purchaseHistory = Array.isArray(customer.purchaseHistory)
      ? deepClone(customer.purchaseHistory)
      : [];
  } else {
    delete customer.purchaseHistory;
  }

  if (Object.prototype.hasOwnProperty.call(rawCustomer, 'bookings')) {
    customer.bookings = Array.isArray(customer.bookings) ? deepClone(customer.bookings) : [];
  } else {
    delete customer.bookings;
  }

  if (Object.prototype.hasOwnProperty.call(rawCustomer, 'bookingHistory')) {
    customer.bookingHistory = Array.isArray(customer.bookingHistory) ? deepClone(customer.bookingHistory) : [];
  } else {
    delete customer.bookingHistory;
  }

  return customer;
}

function buildIdentityKeys(customer) {
  const keys = [];
  const id = normalizeText(customer.id || customer.customerId || customer.memberId);
  const email = normalizeEmail(customer.email);
  const phone = normalizePhoneDigits(customer.phone);
  const name = normalizeText(customer.name);

  if (id) {
    keys.push(['id', id.toLowerCase()]);
  }
  if (email) {
    keys.push(['email', email]);
  }
  if (phone) {
    keys.push(['phone', phone]);
  }
  if (name && phone) {
    keys.push(['namePhone', `${name.toLowerCase()}|${phone}`]);
  }

  return keys;
}

function createIdentityMaps() {
  return {
    id: new Map(),
    email: new Map(),
    phone: new Map(),
    namePhone: new Map(),
  };
}

function updateIdentityMaps(identityMaps, customer, index) {
  for (const [type, key] of buildIdentityKeys(customer)) {
    identityMaps[type].set(key, index);
  }
}

function findExistingIndex(identityMaps, customer) {
  for (const [type, key] of buildIdentityKeys(customer)) {
    if (identityMaps[type].has(key)) {
      return {
        index: identityMaps[type].get(key),
        matchType: type,
        matchKey: key,
      };
    }
  }
  return null;
}

function mergeCustomerRecords(newCustomer, oldCustomer, report) {
  const merged = {};
  const customerId = pickNewPriority(newCustomer.id, oldCustomer.id);

  merged.id = customerId;
  merged.avatar = pickNewPriority(newCustomer.avatar, oldCustomer.avatar);
  merged.name = pickNewPriority(newCustomer.name, oldCustomer.name);
  merged.phone = formatPhone(pickNewPriority(newCustomer.phone, oldCustomer.phone));
  merged.email = normalizeEmail(pickNewPriority(newCustomer.email, oldCustomer.email));
  merged.birthday = pickNewPriority(newCustomer.birthday, oldCustomer.birthday);
  merged.registeredAt = pickEarlierDate(newCustomer.registeredAt, oldCustomer.registeredAt);

  if (newCustomer.createdAt || oldCustomer.createdAt) {
    merged.createdAt = pickEarlierDate(newCustomer.createdAt, oldCustomer.createdAt);
  }
  if (newCustomer.registerDate || oldCustomer.registerDate) {
    merged.registerDate = pickEarlierDate(newCustomer.registerDate, oldCustomer.registerDate);
  }
  if (newCustomer.updatedAt || oldCustomer.updatedAt) {
    merged.updatedAt = pickLaterDate(newCustomer.updatedAt, oldCustomer.updatedAt);
  }

  merged.tier = pickNewPriority(newCustomer.tier, oldCustomer.tier);
  if (Object.prototype.hasOwnProperty.call(newCustomer, 'status') || Object.prototype.hasOwnProperty.call(oldCustomer, 'status')) {
    merged.status = pickNewPriority(newCustomer.status, oldCustomer.status);
  }

  const orderTracker = { count: 0 };
  const bookingTracker = { count: 0 };
  merged.orders = uniqueStrings([...(newCustomer.orders || []), ...(oldCustomer.orders || [])], orderTracker);
  merged.tags = uniqueStrings([...(newCustomer.tags || []), ...(oldCustomer.tags || [])]);
  if (
    Object.prototype.hasOwnProperty.call(newCustomer, 'purchaseHistory') ||
    Object.prototype.hasOwnProperty.call(oldCustomer, 'purchaseHistory')
  ) {
    merged.purchaseHistory = mergeObjectArray(
      newCustomer.purchaseHistory,
      oldCustomer.purchaseHistory,
      {
        preferredKeys: ['orderId', 'id'],
        fallbackFields: ['date', 'productId', 'amount', 'total'],
      },
      orderTracker
    );
  }
  if (Object.prototype.hasOwnProperty.call(newCustomer, 'bookings') || Object.prototype.hasOwnProperty.call(oldCustomer, 'bookings')) {
    merged.bookings = mergeObjectArray(
      newCustomer.bookings,
      oldCustomer.bookings,
      {
        preferredKeys: ['bookingId', 'id'],
        fallbackFields: ['date', 'campId', 'siteId', 'amount'],
      },
      bookingTracker
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(newCustomer, 'bookingHistory') ||
    Object.prototype.hasOwnProperty.call(oldCustomer, 'bookingHistory')
  ) {
    merged.bookingHistory = mergeObjectArray(
      newCustomer.bookingHistory,
      oldCustomer.bookingHistory,
      {
        preferredKeys: ['bookingId', 'id'],
        fallbackFields: ['date', 'campId', 'siteId', 'amount'],
      },
      bookingTracker
    );
  }

  report.duplicateOrdersRemoved += orderTracker.count;
  report.duplicateBookingsRemoved += bookingTracker.count;

  const recomputedTotal = recalculatePurchaseTotal(merged.purchaseHistory || []);
  const newTotal = toNumberOrNull(newCustomer.totalSpent);
  const oldTotal = toNumberOrNull(oldCustomer.totalSpent);
  if (recomputedTotal !== null) {
    merged.totalSpent = recomputedTotal;
    if (
      (newTotal !== null && recomputedTotal !== newTotal) ||
      (oldTotal !== null && recomputedTotal !== oldTotal)
    ) {
      recordConflict(
        report,
        customerId,
        'totalSpent',
        newCustomer.totalSpent,
        oldCustomer.totalSpent,
        recomputedTotal,
        'recomputed_from_purchase_history'
      );
    }
  } else {
    merged.totalSpent = Math.max(newTotal ?? 0, oldTotal ?? 0);
    if (newTotal !== oldTotal) {
      recordConflict(
        report,
        customerId,
        'totalSpent',
        newCustomer.totalSpent,
        oldCustomer.totalSpent,
        merged.totalSpent,
        'kept_higher_value_due_to_non_recomputable_totals'
      );
    }
  }

  const newPoints = toNumberOrNull(newCustomer.points);
  const oldPoints = toNumberOrNull(oldCustomer.points);
  merged.points = Math.max(newPoints ?? 0, oldPoints ?? 0);
  if (newPoints !== oldPoints) {
    recordConflict(
      report,
      customerId,
      'points',
      newCustomer.points,
      oldCustomer.points,
      merged.points,
      'kept_higher_value_to_match_more_complete_customer_snapshot'
    );
  }

  merged.coupons = pickNewPriority(newCustomer.coupons, oldCustomer.coupons);
  if (newCustomer.coupons !== oldCustomer.coupons) {
    recordConflict(
      report,
      customerId,
      'coupons',
      newCustomer.coupons,
      oldCustomer.coupons,
      merged.coupons,
      'new_priority_for_current_coupon_state'
    );
  }

  if (newCustomer.tier !== oldCustomer.tier && isPresent(oldCustomer.tier)) {
    recordConflict(
      report,
      customerId,
      'tier',
      newCustomer.tier,
      oldCustomer.tier,
      merged.tier,
      'new_priority_for_membership_tier'
    );
  }

  if (
    newCustomer.status !== oldCustomer.status &&
    (isPresent(newCustomer.status) || isPresent(oldCustomer.status))
  ) {
    recordConflict(
      report,
      customerId,
      'status',
      newCustomer.status,
      oldCustomer.status,
      merged.status,
      'new_priority_for_customer_status'
    );
  }

  const allKeys = new Set([...Object.keys(oldCustomer), ...Object.keys(newCustomer)]);
  for (const key of allKeys) {
    if (KNOWN_FIELDS.has(key) || key === 'customerId' || key === 'memberId') {
      continue;
    }

    const newValue = newCustomer[key];
    const oldValue = oldCustomer[key];

    if (Array.isArray(newValue) || Array.isArray(oldValue)) {
      merged[key] = deepClone(isPresent(newValue) ? newValue : oldValue) || [];
      continue;
    }

    if (
      newValue &&
      oldValue &&
      typeof newValue === 'object' &&
      typeof oldValue === 'object' &&
      !Array.isArray(newValue) &&
      !Array.isArray(oldValue)
    ) {
      merged[key] = {
        ...deepClone(oldValue),
        ...deepClone(newValue),
      };
      continue;
    }

    merged[key] = pickNewPriority(newValue, oldValue);
  }

  return merged;
}

function collectFieldSummary(records) {
  const fields = new Set();
  records.forEach((record) => {
    Object.keys(record).forEach((key) => fields.add(key));
  });
  return [...fields].sort();
}

function findDuplicateValues(records, selector) {
  const buckets = new Map();
  for (const record of records) {
    const value = selector(record);
    if (!value) {
      continue;
    }
    const bucket = buckets.get(value) || [];
    bucket.push(record.id);
    buckets.set(value, bucket);
  }

  return [...buckets.entries()].filter(([, ids]) => ids.length > 1).map(([value, ids]) => ({ value, ids }));
}

function ensureUniqueIds(records) {
  const duplicates = findDuplicateValues(records, (record) => normalizeText(record.id).toLowerCase());
  if (duplicates.length > 0) {
    fail(`整併結果出現重複會員 ID：${JSON.stringify(duplicates)}`);
  }
}

function findDuplicateOrderAssignments(records) {
  const owners = new Map();
  const duplicates = [];
  for (const record of records) {
    for (const orderId of record.orders || []) {
      if (owners.has(orderId) && owners.get(orderId) !== record.id) {
        duplicates.push({ orderId, first: owners.get(orderId), second: record.id });
      } else if (!owners.has(orderId)) {
        owners.set(orderId, record.id);
      }
    }
  }
  return duplicates;
}

function buildPreferredOrderOwnerMap(currentCustomers) {
  const ownerMap = new Map();
  for (const customer of currentCustomers) {
    for (const orderId of customer.orders || []) {
      if (!ownerMap.has(orderId)) {
        ownerMap.set(orderId, customer.id);
      }
    }
    for (const item of customer.purchaseHistory || []) {
      const orderId = normalizeText(item && (item.orderId || item.id));
      if (orderId && !ownerMap.has(orderId)) {
        ownerMap.set(orderId, customer.id);
      }
    }
  }
  return ownerMap;
}

function reconcileGlobalOrderOwnership(mergedCustomers, currentCustomers, report) {
  const preferredOwners = buildPreferredOrderOwnerMap(currentCustomers);
  const assignedOwners = new Map();

  for (const customer of mergedCustomers) {
    if (!Array.isArray(customer.orders) || customer.orders.length === 0) {
      continue;
    }

    const retainedOrders = [];
    for (const orderId of customer.orders) {
      const preferredOwner = preferredOwners.get(orderId) || '';
      const existingOwner = assignedOwners.get(orderId) || '';

      if (!existingOwner) {
        if (!preferredOwner || preferredOwner === customer.id) {
          assignedOwners.set(orderId, customer.id);
          retainedOrders.push(orderId);
          continue;
        }
      }

      if (preferredOwner && preferredOwner !== customer.id) {
        report.duplicateOrdersRemoved += 1;
        recordConflict(
          report,
          customer.id,
          'orders',
          orderId,
          orderId,
          null,
          `removed_order_owned_by_${preferredOwner}`
        );
        continue;
      }

      if (!preferredOwner && existingOwner && existingOwner !== customer.id) {
        report.duplicateOrdersRemoved += 1;
        recordConflict(
          report,
          customer.id,
          'orders',
          orderId,
          orderId,
          null,
          `removed_duplicate_order_already_assigned_to_${existingOwner}`
        );
        continue;
      }

      if (!existingOwner) {
        assignedOwners.set(orderId, customer.id);
      }
      retainedOrders.push(orderId);
    }

    customer.orders = retainedOrders;
  }
}

function mergeCustomers(currentCustomers, legacyCustomers, fieldSummary) {
  const report = {
    oldCount: legacyCustomers.length,
    newCount: currentCustomers.length,
    mergedCount: 0,
    addedFromOld: 0,
    keptFromNew: 0,
    mergedDuplicates: 0,
    duplicateOrdersRemoved: 0,
    duplicateBookingsRemoved: 0,
    identityKeysUsed: ['id/customerId/memberId', 'email', 'phone', 'name+phone'],
    fieldSummary,
    conflicts: [],
    validation: {},
  };

  const mergedCustomers = [];
  const identityMaps = createIdentityMaps();

  currentCustomers.forEach((customer) => {
    mergedCustomers.push(deepClone(customer));
    updateIdentityMaps(identityMaps, customer, mergedCustomers.length - 1);
    report.keptFromNew += 1;
  });

  legacyCustomers.forEach((legacyCustomer) => {
    const match = findExistingIndex(identityMaps, legacyCustomer);
    if (!match) {
      mergedCustomers.push(deepClone(legacyCustomer));
      updateIdentityMaps(identityMaps, legacyCustomer, mergedCustomers.length - 1);
      report.addedFromOld += 1;
      return;
    }

    const merged = mergeCustomerRecords(mergedCustomers[match.index], legacyCustomer, report);
    mergedCustomers[match.index] = merged;
    updateIdentityMaps(identityMaps, merged, match.index);
    report.mergedDuplicates += 1;
  });

  reconcileGlobalOrderOwnership(mergedCustomers, currentCustomers, report);
  ensureUniqueIds(mergedCustomers);

  report.mergedCount = mergedCustomers.length;
  report.validation = {
    duplicateIds: findDuplicateValues(mergedCustomers, (record) => normalizeText(record.id).toLowerCase()),
    duplicateEmails: findDuplicateValues(mergedCustomers, (record) => normalizeEmail(record.email)),
    duplicatePhones: findDuplicateValues(mergedCustomers, (record) => normalizePhoneDigits(record.phone)),
    duplicateOrderAssignments: findDuplicateOrderAssignments(mergedCustomers),
    overlapIds: currentCustomers
      .map((record) => record.id)
      .filter((id) => legacyCustomers.some((legacyRecord) => legacyRecord.id === id)),
    onlyInNew: currentCustomers
      .map((record) => record.id)
      .filter((id) => !legacyCustomers.some((legacyRecord) => legacyRecord.id === id)),
    onlyInOld: legacyCustomers
      .map((record) => record.id)
      .filter((id) => !currentCustomers.some((currentRecord) => currentRecord.id === id)),
  };

  return { mergedCustomers, report };
}

function main() {
  const currentCustomers = readJsonArray(PATHS.currentSource, '新版會員備份');
  const legacyCustomers = readJsonArray(PATHS.legacySource, '舊版會員備份');
  const newFields = collectFieldSummary(currentCustomers);
  const oldFields = collectFieldSummary(legacyCustomers);
  const fieldSummary = {
    newFields,
    oldFields,
    newOnlyFields: newFields.filter((field) => !oldFields.includes(field)),
    oldOnlyFields: oldFields.filter((field) => !newFields.includes(field)),
  };

  const normalizedCurrent = currentCustomers.map(normalizeCustomer);
  const normalizedLegacy = legacyCustomers.map(normalizeCustomer);

  const { mergedCustomers, report } = mergeCustomers(normalizedCurrent, normalizedLegacy, fieldSummary);

  writeJson(PATHS.mergedOutput, mergedCustomers);
  writeJson(PATHS.reportOutput, report);

  console.log(
    JSON.stringify(
      {
        mergedOutput: PATHS.mergedOutput,
        reportOutput: PATHS.reportOutput,
        oldCount: report.oldCount,
        newCount: report.newCount,
        mergedCount: report.mergedCount,
        addedFromOld: report.addedFromOld,
        keptFromNew: report.keptFromNew,
        mergedDuplicates: report.mergedDuplicates,
        conflicts: report.conflicts.length,
        duplicateOrdersRemoved: report.duplicateOrdersRemoved,
        duplicateBookingsRemoved: report.duplicateBookingsRemoved,
      },
      null,
      2
    )
  );
}

main();
