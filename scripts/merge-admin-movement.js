import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const legacyRoot = path.resolve('C:\\Users\\i125g\\Downloads\\Yuruicamp-main');
const dataRoot = path.join(repoRoot, 'admin', 'data');
const APPLY_MODE = process.argv.includes('--apply');

const PATHS = {
  live: path.join(dataRoot, 'movement.json'),
  old: path.join(legacyRoot, 'admin', 'data', 'movement.json'),
  liveProducts: path.join(dataRoot, 'products.json'),
  liveOrders: path.join(dataRoot, 'orders.json'),

  before: path.join(dataRoot, 'movement.before-merge.json'),
  oldCopy: path.join(dataRoot, 'movement.old-source.json'),
  merged: path.join(dataRoot, 'movement.merged.json'),
  report: path.join(dataRoot, 'movement.merge-report.json'),
  encoding: path.join(dataRoot, 'movement.encoding-report.json'),
  preFinal: path.join(dataRoot, 'movement.pre-final-replace.json'),
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  return parsed.toISOString().slice(0, 10);
}

function inferType(item) {
  const explicit = normalizeText(item && item.type);
  if (explicit) {
    return explicit;
  }
  const fromStore = normalizeText(item && item.fromStore);
  const toStore = normalizeText(item && item.toStore);
  if (toStore.includes('損耗')) {
    return '損耗';
  }
  if (fromStore.includes('調至租借') || toStore.includes('來自商店')) {
    return '調撥';
  }
  if (fromStore.includes('增加') || toStore.includes('減少')) {
    return '營地互轉';
  }
  if (fromStore && toStore) {
    return '移轉';
  }
  return '—';
}

function normalizeItem(item) {
  return {
    productId: normalizeText(item && item.productId),
    productName: normalizeText(item && item.productName) || '未命名商品',
    quantity: normalizeQuantity(item && item.quantity),
    fromStore: normalizeText(item && item.fromStore) || '—',
    toStore: normalizeText(item && item.toStore) || '—',
    type: inferType(item),
    orderId: normalizeText(item && item.orderId),
  };
}

function normalizeRecord(record) {
  const items = Array.isArray(record && record.items)
    ? record.items.map(normalizeItem)
    : [normalizeItem(record)];
  return {
    id: normalizeText(record && (record.movementId || record.id)) || 'MV-NEW-' + Date.now(),
    date: normalizeDate(record && (record.date || record.createdAt)),
    employeeId: normalizeText(record && (record.employeeId || record.adminId || record.staffId)) || '—',
    items,
  };
}

function sameItemSignature(item) {
  return [
    normalizeText(item.productId),
    normalizeText(item.productName),
    String(normalizeQuantity(item.quantity)),
    normalizeText(item.fromStore),
    normalizeText(item.toStore),
    normalizeText(item.orderId),
  ].join('|');
}

function sameRecordFingerprint(record) {
  return [
    normalizeText(record.date),
    normalizeText(record.employeeId),
    record.items.map(sameItemSignature).sort().join('||'),
  ].join('|');
}

function suspiciousText(value) {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  return text.includes('\uFFFD') || /\?{3,}/.test(text) || /[擃銝蝧鞎]/.test(text);
}

function mergeSameIdRecord(newRecord, oldRecord, report) {
  const merged = {
    id: newRecord.id,
    date: newRecord.date || oldRecord.date,
    employeeId: newRecord.employeeId !== '—' ? newRecord.employeeId : oldRecord.employeeId,
    items: [],
  };

  const oldItemsBySignature = new Map(oldRecord.items.map((item) => [sameItemSignature(item), item]));
  const seenSignatures = new Set();

  newRecord.items.forEach((item) => {
    const signature = sameItemSignature(item);
    const oldItem = oldItemsBySignature.get(signature);
    seenSignatures.add(signature);
    merged.items.push({
      productId: item.productId || (oldItem && oldItem.productId) || '',
      productName: item.productName || (oldItem && oldItem.productName) || '未命名商品',
      quantity: item.quantity,
      fromStore: item.fromStore || (oldItem && oldItem.fromStore) || '—',
      toStore: item.toStore || (oldItem && oldItem.toStore) || '—',
      orderId: item.orderId || (oldItem && oldItem.orderId) || '',
      type: item.type && item.type !== '—' ? item.type : oldItem && oldItem.type ? oldItem.type : '—',
    });
  });

  oldRecord.items.forEach((item) => {
    const signature = sameItemSignature(item);
    if (!seenSignatures.has(signature)) {
      report.conflicts.push({
        type: 'same-id-different-items',
        movementId: newRecord.id,
        droppedLegacyItem: item,
      });
    }
  });

  if (newRecord.date !== oldRecord.date || newRecord.employeeId !== oldRecord.employeeId) {
    report.conflicts.push({
      type: 'same-id-metadata-different',
      movementId: newRecord.id,
      newDate: newRecord.date,
      oldDate: oldRecord.date,
      newEmployeeId: newRecord.employeeId,
      oldEmployeeId: oldRecord.employeeId,
    });
  }

  return merged;
}

function findDuplicateEntries(items, keySelector) {
  const map = new Map();
  items.forEach((item) => {
    const key = keySelector(item);
    if (!key) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item.id);
  });
  return [...map.entries()].filter(([, refs]) => refs.length > 1).map(([key, refs]) => ({ key, refs }));
}

function analyzeEncoding(records) {
  const samples = [];
  records.forEach((record) => {
    record.items.forEach((item) => {
      ['productName', 'fromStore', 'toStore', 'type'].forEach((field) => {
        if (suspiciousText(item[field])) {
          samples.push({ movementId: record.id, field, value: item[field] });
        }
      });
    });
  });
  return samples;
}

function main() {
  const newRaw = readJson(PATHS.live);
  const oldRaw = readJson(PATHS.old);
  const products = readJson(PATHS.liveProducts);
  const orders = readJson(PATHS.liveOrders);

  fs.copyFileSync(PATHS.live, PATHS.before);
  fs.copyFileSync(PATHS.old, PATHS.oldCopy);

  const productIds = new Set(
    products.map((item) => normalizeText(item.id || item.productId)).filter(Boolean)
  );
  const orderIds = new Set(
    orders
      .flatMap((item) => [normalizeText(item.id), normalizeText(item.orderId), normalizeText(item.number)])
      .filter(Boolean)
  );

  const newRecords = newRaw.map(normalizeRecord);
  const oldRecords = oldRaw.map(normalizeRecord);
  const oldById = new Map(oldRecords.map((record) => [record.id, record]));
  const seenIds = new Set();
  const merged = [];

  const report = {
    newCount: newRecords.length,
    oldCount: oldRecords.length,
    mergedCount: 0,
    overlapCount: 0,
    onlyNewCount: 0,
    onlyOldCount: 0,
    duplicateMovementsRemoved: 0,
    conflictCount: 0,
    conflicts: [],
    invalidProductReferences: [],
    invalidOrderReferences: [],
    negativeStockProducts: [],
    validation: {},
  };

  newRecords.forEach((record) => {
    const oldRecord = oldById.get(record.id);
    if (oldRecord) {
      report.overlapCount += 1;
      if (sameRecordFingerprint(record) === sameRecordFingerprint(oldRecord)) {
        report.duplicateMovementsRemoved += 1;
        merged.push(mergeSameIdRecord(record, oldRecord, report));
      } else {
        merged.push(mergeSameIdRecord(record, oldRecord, report));
      }
    } else {
      report.onlyNewCount += 1;
      merged.push(record);
    }
    seenIds.add(record.id);
  });

  oldRecords.forEach((record) => {
    if (!seenIds.has(record.id)) {
      report.onlyOldCount += 1;
      merged.push(record);
    }
  });

  merged.forEach((record) => {
    record.items.forEach((item) => {
      if (item.productId && !productIds.has(item.productId)) {
        report.invalidProductReferences.push({ movementId: record.id, productId: item.productId });
      }
      if (item.orderId && !orderIds.has(item.orderId)) {
        report.invalidOrderReferences.push({ movementId: record.id, orderId: item.orderId });
      }
    });
  });

  const duplicateMovementIds = findDuplicateEntries(merged, (record) => record.id);
  const sameContentDifferentIds = findDuplicateEntries(merged, (record) => sameRecordFingerprint(record));
  const invalidDates = merged
    .filter((record) => !record.date || Number.isNaN(new Date(record.date).getTime()))
    .map((record) => ({ id: record.id, date: record.date }));
  const futureDates = merged
    .filter((record) => new Date(record.date).getTime() > Date.now() + 24 * 60 * 60 * 1000)
    .map((record) => ({ id: record.id, date: record.date }));
  const zeroQuantities = merged.flatMap((record) =>
    record.items
      .filter((item) => item.quantity === 0)
      .map((item) => ({ id: record.id, productName: item.productName }))
  );
  const invalidQuantities = merged.flatMap((record) =>
    record.items
      .filter((item) => !Number.isFinite(Number(item.quantity)))
      .map((item) => ({ id: record.id, productName: item.productName, quantity: item.quantity }))
  );
  const movementTypes = [
    ...new Set(merged.flatMap((record) => record.items.map((item) => item.type)).filter(Boolean)),
  ].sort();

  report.validation = {
    duplicateMovementIds,
    sameContentDifferentIds,
    invalidDates,
    futureDates,
    zeroQuantities,
    invalidQuantities,
    movementTypes,
  };
  report.conflictCount = report.conflicts.length;
  report.mergedCount = merged.length;

  writeJson(PATHS.merged, merged);
  writeJson(PATHS.report, report);

  const encodingSamples = analyzeEncoding(merged);
  const safeToApply =
    encodingSamples.length === 0 &&
    report.validation.duplicateMovementIds.length === 0 &&
    report.validation.invalidDates.length === 0 &&
    report.validation.futureDates.length === 0 &&
    report.validation.invalidQuantities.length === 0;

  writeJson(PATHS.encoding, {
    files: [
      {
        file: PATHS.live,
        count: newRecords.length,
        jsonValid: true,
        suspiciousCount: analyzeEncoding(newRecords).length,
        samples: analyzeEncoding(newRecords).slice(0, 10),
      },
      {
        file: PATHS.old,
        count: oldRecords.length,
        jsonValid: true,
        suspiciousCount: analyzeEncoding(oldRecords).length,
        samples: analyzeEncoding(oldRecords).slice(0, 10),
      },
      {
        file: PATHS.merged,
        count: merged.length,
        jsonValid: true,
        suspiciousCount: encodingSamples.length,
        samples: encodingSamples.slice(0, 10),
      },
    ],
    decision: APPLY_MODE && safeToApply ? 'applied' : safeToApply ? 'safe-to-apply' : 'hold',
    reason: safeToApply
      ? 'movement history passed encoding and structural validation'
      : 'movement history contains suspicious text or invalid structure',
  });

  if (APPLY_MODE) {
    if (!safeToApply) {
      throw new Error('Merged movement dataset failed validation and cannot be applied.');
    }
    fs.copyFileSync(PATHS.live, PATHS.preFinal);
    fs.copyFileSync(PATHS.merged, PATHS.live);
  }

  console.log(
    JSON.stringify(
      {
        applyMode: APPLY_MODE,
        applied: APPLY_MODE && safeToApply,
        newCount: report.newCount,
        oldCount: report.oldCount,
        mergedCount: report.mergedCount,
        overlapCount: report.overlapCount,
        onlyOldCount: report.onlyOldCount,
        conflictCount: report.conflictCount,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
