import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const legacyRoot = 'C:\\Users\\i125g\\Downloads\\Yuruicamp-main';
const applyMode = process.argv.includes('--apply');

const currentPath = path.join(repoRoot, 'admin', 'data', 'bookings.json');
const backupPath = path.join(repoRoot, 'admin', 'data', 'bookings.before-merge.json');
const oldSourcePath = path.join(repoRoot, 'admin', 'data', 'bookings.old-source.json');
const mergedPath = path.join(repoRoot, 'admin', 'data', 'bookings.merged.json');
const reportPath = path.join(repoRoot, 'admin', 'data', 'bookings.merge-report.json');
const encodingPath = path.join(repoRoot, 'admin', 'data', 'bookings.encoding-report.json');
const preFinalPath = path.join(repoRoot, 'admin', 'data', 'bookings.pre-final-replace.json');
const legacyPath = path.join(legacyRoot, 'admin', 'data', 'bookings.json');

const customers = readJson(path.join(repoRoot, 'admin', 'data', 'customers.json'));
const campgrounds = readJson(path.join(repoRoot, 'booking', 'data', 'campgrounds.json'));

const currentBookings = normalizeBookings(readJson(currentPath));
const oldBookings = normalizeBookings(readJson(legacyPath));

writeJson(backupPath, currentBookings);
writeJson(oldSourcePath, oldBookings);

const currentById = new Map(currentBookings.map((booking) => [booking.id, booking]));
const oldById = new Map(oldBookings.map((booking) => [booking.id, booking]));
const mergedMap = new Map();
const overlapIds = [];
const onlyNewIds = [];
const onlyOldIds = [];
const sameIdDifferentContent = [];
const preservedLegacyConflictIds = [];

for (const booking of currentBookings) {
  mergedMap.set(booking.id, booking);
}
for (const booking of oldBookings) {
  const currentBooking = currentById.get(booking.id);
  if (!currentBooking) {
    mergedMap.set(booking.id, booking);
    onlyOldIds.push(booking.id);
    continue;
  }
  overlapIds.push(booking.id);
  if (stableStringify(currentBooking) !== stableStringify(booking)) {
    sameIdDifferentContent.push(booking.id);
    const preservedBooking = createLegacyConflictBooking(booking, mergedMap);
    mergedMap.set(preservedBooking.id, preservedBooking);
    preservedLegacyConflictIds.push(preservedBooking.id);
    continue;
  }
}
for (const booking of currentBookings) {
  if (!oldById.has(booking.id)) {
    onlyNewIds.push(booking.id);
  }
}

const mergedBookings = Array.from(mergedMap.values())
  .sort((a, b) => String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')) || a.id.localeCompare(b.id));

const campIndex = new Map(campgrounds.map((campground) => [String(campground.campground_id), campground]));
const customerIds = new Set(customers.map((customer) => String(customer.id)));
const validStatuses = new Set(['pending', 'confirmed', 'completed', 'cancelled']);
const validPaymentStatuses = new Set(['paid', 'unpaid', 'refunded']);

const report = {
  newCount: currentBookings.length,
  oldCount: oldBookings.length,
  mergedCount: mergedBookings.length,
  overlapCount: overlapIds.length,
  onlyNewCount: onlyNewIds.length,
  onlyOldCount: onlyOldIds.length,
  sameIdDifferentContentCount: sameIdDifferentContent.length,
  onlyNewIds,
  onlyOldIds,
  overlapIds,
  sameIdDifferentContent,
  preservedLegacyConflictIds,
  duplicateBookingIds: findDuplicateValues(mergedBookings.map((booking) => booking.id)),
  duplicateBookingNumbers: findDuplicateValues(mergedBookings.map((booking) => booking.bookingNumber)),
  invalidCustomerReferences: [],
  invalidCampReferences: [],
  invalidSiteReferences: [],
  invalidDateRanges: [],
  availabilityConflicts: [],
  amountConflicts: [],
  unknownStatusValues: [],
  validation: {},
};

for (const booking of mergedBookings) {
  if (!customerIds.has(booking.customer_id)) {
    report.invalidCustomerReferences.push({ bookingId: booking.id, customerId: booking.customer_id });
  }

  const campground = campIndex.get(booking.booking_info.campground_id);
  if (!campground) {
    report.invalidCampReferences.push({ bookingId: booking.id, campId: booking.booking_info.campground_id });
  } else {
    const zoneIds = new Set((campground.zones || []).map((zone) => String(zone.zone_id)));
    for (const zone of booking.selected_zones) {
      if (!zoneIds.has(zone.zone_id)) {
        report.invalidSiteReferences.push({ bookingId: booking.id, siteId: zone.zone_id, campId: booking.booking_info.campground_id });
      }
    }
  }

  if (!validStatuses.has(booking.status)) {
    report.unknownStatusValues.push({ type: 'bookingStatus', bookingId: booking.id, value: booking.status });
  }
  if (!validPaymentStatuses.has(booking.payment_status)) {
    report.unknownStatusValues.push({ type: 'paymentStatus', bookingId: booking.id, value: booking.payment_status });
  }

  const checkIn = booking.booking_info.check_in;
  const checkOut = booking.booking_info.check_out;
  const diffDays = dayDiff(checkIn, checkOut);
  if (!checkIn || !checkOut || diffDays <= 0 || diffDays !== Number(booking.booking_info.total_days || 0)) {
    report.invalidDateRanges.push({
      bookingId: booking.id,
      checkIn,
      checkOut,
      storedNights: Number(booking.booking_info.total_days || 0),
      calculatedNights: diffDays,
    });
  }

  const calculatedTotal = Number(booking.summary.zone_total || 0) + Number(booking.summary.rental_total || 0) - Number(booking.summary.applied_discount || 0);
  if (calculatedTotal !== Number(booking.summary.final_amount || 0)) {
    report.amountConflicts.push({
      recordId: booking.id,
      storedAmount: Number(booking.summary.final_amount || 0),
      calculatedAmount: calculatedTotal,
      difference: Number(booking.summary.final_amount || 0) - calculatedTotal,
      formulaSource: 'zone_total + rental_total - applied_discount',
    });
  }
}

const zoneUsage = new Map();
for (const booking of mergedBookings) {
  if (booking.status === 'cancelled') continue;
  for (const zone of booking.selected_zones) {
    const key = zone.zone_id;
    if (!zoneUsage.has(key)) {
      zoneUsage.set(key, []);
    }
    zoneUsage.get(key).push({
      bookingId: booking.id,
      checkIn: booking.booking_info.check_in,
      checkOut: booking.booking_info.check_out,
      quantity: Number(zone.quantity || 0),
      campId: booking.booking_info.campground_id,
    });
  }
}

for (const [zoneId, usageList] of zoneUsage.entries()) {
  const camp = campgrounds.find((campground) => (campground.zones || []).some((zone) => String(zone.zone_id) === zoneId));
  const zone = camp ? (camp.zones || []).find((item) => String(item.zone_id) === zoneId) : null;
  const capacity = Number(zone && zone.total_sites ? zone.total_sites : 0);
  if (!capacity) continue;
  const checkpoints = new Set();
  usageList.forEach((usage) => {
    checkpoints.add(usage.checkIn);
    checkpoints.add(usage.checkOut);
  });
  for (const checkpoint of checkpoints) {
    let occupied = 0;
    const holders = [];
    usageList.forEach((usage) => {
      if (usage.checkIn < usage.checkOut && usage.checkIn <= checkpoint && checkpoint < usage.checkOut) {
        occupied += usage.quantity;
        holders.push(usage.bookingId);
      }
    });
    if (occupied > capacity) {
      report.availabilityConflicts.push({
        type: 'zoneOverbooked',
        zoneId,
        campId: zone ? camp.campground_id : '',
        date: checkpoint,
        capacity,
        occupied,
        bookingIds: holders,
      });
    }
  }
}

report.validation = {
  parseSuccess: true,
  invalidCustomerReferenceCount: report.invalidCustomerReferences.length,
  invalidCampReferenceCount: report.invalidCampReferences.length,
  invalidSiteReferenceCount: report.invalidSiteReferences.length,
  invalidDateRangeCount: report.invalidDateRanges.length,
  availabilityConflictCount: report.availabilityConflicts.length,
  amountConflictCount: report.amountConflicts.length,
  duplicateBookingIdCount: report.duplicateBookingIds.length,
  duplicateBookingNumberCount: report.duplicateBookingNumbers.length,
};

const encodingReport = scanEncodingIssues(mergedBookings, ['campground_name', 'region', 'zone_type', 'name', 'action']);

writeJson(mergedPath, mergedBookings);
writeJson(reportPath, report);
writeJson(encodingPath, encodingReport);

const canApply = report.duplicateBookingIds.length === 0 &&
  report.duplicateBookingNumbers.length === 0 &&
  report.invalidCustomerReferences.length === 0 &&
  report.invalidCampReferences.length === 0 &&
  report.invalidSiteReferences.length === 0 &&
  report.invalidDateRanges.length === 0 &&
  report.amountConflicts.length === 0 &&
  report.unknownStatusValues.length === 0 &&
  encodingReport.suspiciousEntries.length === 0;

if (applyMode) {
  if (!canApply) {
    console.error('Bookings merge validation failed. Live data not replaced.');
    process.exitCode = 1;
  } else {
    fs.copyFileSync(currentPath, preFinalPath);
    fs.copyFileSync(mergedPath, currentPath);
    readJson(currentPath);
    console.log('Applied merged admin bookings data.');
  }
} else {
  console.log('Generated admin bookings merge artifacts.');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function normalizeBookings(input) {
  if (!Array.isArray(input)) {
    throw new Error('bookings.json must be an array');
  }
  return input.map((booking) => ({
    ...booking,
    id: String(booking.bookingId || booking.reservationId || booking.id || '').trim(),
    bookingId: String(booking.bookingId || booking.reservationId || booking.id || '').trim(),
    bookingNumber: String(booking.bookingNumber || booking.bookingId || booking.reservationId || booking.id || '').trim(),
    customer_id: String(booking.customer_id || '').trim(),
    submitted_at: String(booking.submitted_at || '').trim(),
    payment_status: String(booking.payment_status || '').trim(),
    status: String(booking.status || '').trim(),
    equipment_returned: Boolean(booking.equipment_returned),
    booking_info: {
      campground_id: String(booking.booking_info && booking.booking_info.campground_id || '').trim(),
      campground_name: String(booking.booking_info && booking.booking_info.campground_name || '').trim(),
      region: String(booking.booking_info && booking.booking_info.region || '').trim(),
      check_in: String(booking.booking_info && booking.booking_info.check_in || '').trim(),
      check_out: String(booking.booking_info && booking.booking_info.check_out || '').trim(),
      total_days: Number(booking.booking_info && booking.booking_info.total_days || 0),
      weekday_count: Number(booking.booking_info && booking.booking_info.weekday_count || 0),
      holiday_count: Number(booking.booking_info && booking.booking_info.holiday_count || 0),
      guest_count: Number(booking.booking_info && booking.booking_info.guest_count || 0),
    },
    selected_zones: Array.isArray(booking.selected_zones) ? booking.selected_zones.map((zone) => ({
      zone_id: String(zone.zone_id || '').trim(),
      zone_type: String(zone.zone_type || '').trim(),
      quantity: Number(zone.quantity || 0),
      subtotal: Number(zone.subtotal || 0),
    })) : [],
    selected_rentals: Array.isArray(booking.selected_rentals) ? booking.selected_rentals.map((item) => ({
      equipment_id: String(item.equipment_id || '').trim(),
      name: String(item.name || '').trim(),
      quantity: Number(item.quantity || 0),
      subtotal: Number(item.subtotal || 0),
    })) : [],
    summary: {
      zone_total: Number(booking.summary && booking.summary.zone_total || 0),
      rental_total: Number(booking.summary && booking.summary.rental_total || 0),
      applied_discount: Number(booking.summary && booking.summary.applied_discount || 0),
      final_amount: Number(booking.summary && booking.summary.final_amount || 0),
    },
    history: Array.isArray(booking.history) ? booking.history.map((entry) => ({
      time: String(entry.time || '').trim(),
      action: String(entry.action || '').trim(),
    })) : [],
  })).filter((booking) => booking.id);
}

function dedupeHistory(history) {
  const seen = new Set();
  return history.filter((entry) => {
    const id = [entry.time, entry.action].join('|');
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function dayDiff(start, end) {
  if (!start || !end) return -1;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return -1;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

function findDuplicateValues(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function earliestValue(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return String(a) <= String(b) ? a : b;
}

function pickPreferred(primary, fallback) {
  return primary !== undefined && primary !== null && String(primary).trim() !== '' ? primary : (fallback || '');
}

function createLegacyConflictBooking(booking, existingMap) {
  let nextId = `${booking.id}-legacy`;
  let counter = 2;
  while (existingMap.has(nextId)) {
    nextId = `${booking.id}-legacy-${counter}`;
    counter += 1;
  }
  return {
    ...booking,
    id: nextId,
    bookingId: nextId,
    bookingNumber: nextId,
    history: dedupeHistory([...(booking.history || []), { time: booking.submitted_at, action: 'legacy-conflict-preserved' }]),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',') + '}';
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
  walk(records, ['bookings']);
  return {
    checkedAt: new Date().toISOString(),
    suspiciousEntries,
  };
}
