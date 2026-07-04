import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const legacyRoot = 'C:\\Users\\i125g\\Downloads\\Yuruicamp-main';

const currentBookingsPath = path.join(repoRoot, 'admin', 'data', 'bookings.json');
const legacyBookingsPath = path.join(legacyRoot, 'admin', 'data', 'bookings.json');
const beforeMergePath = path.join(repoRoot, 'admin', 'data', 'rental-bookings.before-merge.json');
const oldSourcePath = path.join(repoRoot, 'admin', 'data', 'rental-bookings.old-source.json');
const mergedPath = path.join(repoRoot, 'admin', 'data', 'rental-bookings.merged.json');
const reportPath = path.join(repoRoot, 'admin', 'data', 'rental-bookings.merge-report.json');
const encodingPath = path.join(repoRoot, 'admin', 'data', 'rental-bookings.encoding-report.json');

const customers = readJson(path.join(repoRoot, 'admin', 'data', 'customers.json'));
const rentals = readJson(path.join(repoRoot, 'booking', 'data', 'rentals.json'));
const currentBookings = readJson(currentBookingsPath);
const oldBookings = readJson(legacyBookingsPath);
const currentBookingMap = new Map(currentBookings.map((booking) => [String(booking.id || ''), booking]));
const legacyConflictBookingIds = new Set(
  oldBookings
    .filter((booking) => {
      const currentBooking = currentBookingMap.get(String(booking.id || ''));
      return currentBooking && stableStringify(currentBooking) !== stableStringify(booking);
    })
    .map((booking) => String(booking.id || ''))
);

const currentRecords = deriveRentalRecords(currentBookings, customers, new Set(), false);
const oldRecords = deriveRentalRecords(oldBookings, customers, legacyConflictBookingIds, true);

writeJson(beforeMergePath, currentRecords);
writeJson(oldSourcePath, oldRecords);

const currentById = new Map(currentRecords.map((record) => [record.rentalKey, record]));
const oldById = new Map(oldRecords.map((record) => [record.rentalKey, record]));
const mergedMap = new Map();
const overlapKeys = [];
const onlyNewKeys = [];
const onlyOldKeys = [];
const sameIdDifferentContent = [];
const preservedLegacyConflictKeys = [];

for (const record of currentRecords) {
  mergedMap.set(record.rentalKey, record);
}
for (const record of oldRecords) {
  const currentRecord = currentById.get(record.rentalKey);
  if (!currentRecord) {
    mergedMap.set(record.rentalKey, record);
    onlyOldKeys.push(record.rentalKey);
    continue;
  }
  overlapKeys.push(record.rentalKey);
  if (stableStringify(currentRecord) !== stableStringify(record)) {
    sameIdDifferentContent.push(record.rentalKey);
    const preservedRecord = createLegacyConflictRental(record, mergedMap);
    mergedMap.set(preservedRecord.rentalKey, preservedRecord);
    preservedLegacyConflictKeys.push(preservedRecord.rentalKey);
    continue;
  }
}
for (const record of currentRecords) {
  if (!oldById.has(record.rentalKey)) {
    onlyNewKeys.push(record.rentalKey);
  }
}

const mergedRecords = Array.from(mergedMap.values()).sort(
  (a, b) => a.rentalStartDate.localeCompare(b.rentalStartDate) || a.rentalKey.localeCompare(b.rentalKey)
);
const rentalIndex = new Map(rentals.map((item) => [String(item.equipment_id), item]));
const customerIds = new Set(customers.map((customer) => String(customer.id)));

const report = {
  newCount: currentRecords.length,
  oldCount: oldRecords.length,
  mergedCount: mergedRecords.length,
  overlapCount: overlapKeys.length,
  onlyNewCount: onlyNewKeys.length,
  onlyOldCount: onlyOldKeys.length,
  sameIdDifferentContentCount: sameIdDifferentContent.length,
  preservedLegacyConflictKeys,
  duplicateRentalIds: findDuplicateValues(mergedRecords.map((record) => record.rentalKey)),
  duplicateRentalNumbers: findDuplicateValues(mergedRecords.map((record) => record.rentalNumber)),
  invalidCustomerReferences: [],
  invalidRentalProductReferences: [],
  invalidDateRanges: [],
  availabilityConflicts: [],
  amountConflicts: [],
  overdueStatusConflicts: [],
  validation: {},
};

for (const record of mergedRecords) {
  if (!customerIds.has(record.customerId)) {
    report.invalidCustomerReferences.push({ rentalKey: record.rentalKey, customerId: record.customerId });
  }
  const rentalProduct = rentalIndex.get(record.rentalProductId);
  if (!rentalProduct) {
    report.invalidRentalProductReferences.push({
      rentalKey: record.rentalKey,
      rentalProductId: record.rentalProductId,
    });
  }

  const calculatedDays = dayDiff(record.rentalStartDate, record.rentalEndDate);
  if (calculatedDays <= 0 || calculatedDays !== Number(record.rentalDays || 0)) {
    report.invalidDateRanges.push({
      rentalKey: record.rentalKey,
      rentalStartDate: record.rentalStartDate,
      rentalEndDate: record.rentalEndDate,
      storedRentalDays: record.rentalDays,
      calculatedRentalDays: calculatedDays,
    });
  }

  if (Number(record.totalAmount || 0) !== Number(record.rentalAmount || 0)) {
    report.amountConflicts.push({
      recordId: record.rentalKey,
      storedAmount: Number(record.totalAmount || 0),
      calculatedAmount: Number(record.rentalAmount || 0),
      difference: Number(record.totalAmount || 0) - Number(record.rentalAmount || 0),
      formulaSource: 'selected_rental.subtotal',
    });
  }

  const today = isoDate(new Date());
  if (record.status === 'completed' && !record.equipmentReturned) {
    report.overdueStatusConflicts.push({
      rentalKey: record.rentalKey,
      status: record.status,
      equipmentReturned: record.equipmentReturned,
    });
  }
  if (record.status !== 'cancelled' && !record.equipmentReturned && record.rentalEndDate < today) {
    report.overdueStatusConflicts.push({
      rentalKey: record.rentalKey,
      status: record.status,
      equipmentReturned: record.equipmentReturned,
      overdue: true,
    });
  }
}

const availabilityBuckets = new Map();
for (const record of mergedRecords) {
  if (record.status === 'cancelled' || record.status === 'completed') continue;
  if (!availabilityBuckets.has(record.rentalProductId)) {
    availabilityBuckets.set(record.rentalProductId, []);
  }
  availabilityBuckets.get(record.rentalProductId).push(record);
}
for (const [productId, records] of availabilityBuckets.entries()) {
  const rentalProduct = rentalIndex.get(productId);
  const capacity = Number(rentalProduct && rentalProduct.stock ? rentalProduct.stock : 0);
  if (!capacity) continue;
  const checkpoints = new Set();
  records.forEach((record) => {
    checkpoints.add(record.rentalStartDate);
    checkpoints.add(record.rentalEndDate);
  });
  for (const checkpoint of checkpoints) {
    let quantity = 0;
    const holders = [];
    records.forEach((record) => {
      if (record.rentalStartDate <= checkpoint && checkpoint < record.rentalEndDate) {
        quantity += Number(record.quantity || 0);
        holders.push(record.rentalKey);
      }
    });
    if (quantity > capacity) {
      report.availabilityConflicts.push({
        rentalProductId: productId,
        date: checkpoint,
        capacity,
        occupied: quantity,
        rentalKeys: holders,
      });
    }
  }
}

report.validation = {
  parseSuccess: true,
  invalidCustomerReferenceCount: report.invalidCustomerReferences.length,
  invalidRentalProductReferenceCount: report.invalidRentalProductReferences.length,
  invalidDateRangeCount: report.invalidDateRanges.length,
  availabilityConflictCount: report.availabilityConflicts.length,
  amountConflictCount: report.amountConflicts.length,
  overdueStatusConflictCount: report.overdueStatusConflicts.length,
};

const encodingReport = scanEncodingIssues(mergedRecords, ['customerName', 'productName']);

writeJson(mergedPath, mergedRecords);
writeJson(reportPath, report);
writeJson(encodingPath, encodingReport);

console.log('Generated derived rental-bookings merge artifacts.');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function deriveRentalRecords(bookings, customersList, conflictBookingIds, suffixLegacyIds) {
  const customerMap = new Map(
    customersList.map((customer) => [String(customer.id), String(customer.name || customer.id)])
  );
  const records = [];
  bookings.forEach((booking) => {
    const normalizedBooking = {
      id: String(booking.id || ''),
      customer_id: String(booking.customer_id || ''),
      payment_status: String(booking.payment_status || ''),
      status: String(booking.status || ''),
      equipment_returned: Boolean(booking.equipment_returned),
      booking_info: booking.booking_info || {},
      selected_rentals: Array.isArray(booking.selected_rentals) ? booking.selected_rentals : [],
    };
    const bookingDisplayId = suffixLegacyIds && conflictBookingIds.has(normalizedBooking.id)
      ? `${normalizedBooking.id}-legacy`
      : normalizedBooking.id;
    normalizedBooking.selected_rentals.forEach((rental, index) => {
      const startDate = String(normalizedBooking.booking_info.check_in || '');
      const endDate = String(normalizedBooking.booking_info.check_out || '');
      records.push({
        rentalKey: `${bookingDisplayId}::${String(rental.equipment_id || '')}::${index + 1}`,
        rentalNumber: `${bookingDisplayId}-R${String(index + 1).padStart(2, '0')}`,
        bookingId: bookingDisplayId,
        customerId: normalizedBooking.customer_id,
        customerName: customerMap.get(normalizedBooking.customer_id) || normalizedBooking.customer_id,
        rentalProductId: String(rental.equipment_id || ''),
        productName: String(rental.name || ''),
        quantity: Number(rental.quantity || 0),
        rentalStartDate: startDate,
        rentalEndDate: endDate,
        rentalDays: dayDiff(startDate, endDate),
        rentalAmount: Number(rental.subtotal || 0),
        deposit: 0,
        extras: 0,
        discount: 0,
        totalAmount: Number(rental.subtotal || 0),
        paymentStatus: normalizedBooking.payment_status,
        status: normalizedBooking.status,
        equipmentReturned: Boolean(normalizedBooking.equipment_returned),
      });
    });
  });
  return records;
}

function findDuplicateValues(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function dayDiff(start, end) {
  if (!start || !end) return -1;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return -1;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function earliestValue(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return String(a) <= String(b) ? a : b;
}

function createLegacyConflictRental(record, existingMap) {
  let nextKey = `${record.rentalKey}-legacy`;
  let counter = 2;
  while (existingMap.has(nextKey)) {
    nextKey = `${record.rentalKey}-legacy-${counter}`;
    counter += 1;
  }
  return {
    ...record,
    rentalKey: nextKey,
    rentalNumber: `${record.rentalNumber}-legacy`,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function scanEncodingIssues(records, keys) {
  const suspiciousEntries = [];
  const mojibakePattern = /Ã|Â|�|鈭|銝|亂碼/;
  function walk(value, pathParts) {
    if (typeof value === 'string') {
      const fieldName = pathParts[pathParts.length - 1] || '';
      if (!keys.some((key) => fieldName.indexOf(key) !== -1)) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (trimmed.includes('\uFFFD') || mojibakePattern.test(trimmed) || /\?{4,}/.test(trimmed)) {
        suspiciousEntries.push({ path: pathParts.join('.'), value: trimmed });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...pathParts, String(index)]));
      return;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach((key) => walk(value[key], [...pathParts, key]));
    }
  }
  walk(records, ['rentalBookings']);
  return {
    checkedAt: new Date().toISOString(),
    suspiciousEntries,
  };
}
