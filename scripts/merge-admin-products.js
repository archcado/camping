import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const adminRoot = path.join(repoRoot, 'admin');
const dataRoot = path.join(adminRoot, 'data');
const legacyRoot = path.resolve('C:\\Users\\i125g\\Downloads\\Yuruicamp-main');
const APPLY_MODE = process.argv.includes('--apply');
const IMAGE_PLACEHOLDER = 'https://placehold.co/48x48/cccccc/555555?text=No+Image';
const VALID_PRODUCT_STATUSES = new Set(['active', 'disabled']);
const DEFAULT_STORE_MIN = { main: 1, 'branch-001': 1, 'branch-002': 1, 'branch-003': 1 };
const DEFAULT_RENTAL_MIN = {
  'rental-main': 1,
  'camp-001': 1,
  'camp-002': 1,
  'camp-003': 1,
  'camp-004': 1,
  'camp-005': 1,
};

const PATHS = {
  liveProducts: path.join(dataRoot, 'products.json'),
  liveRentals: path.join(dataRoot, 'reantal.json'),
  liveMinStock: path.join(dataRoot, 'min_stock.json'),
  liveMovement: path.join(dataRoot, 'movement.json'),
  liveReviews: path.join(dataRoot, 'reviews.json'),

  oldProducts: path.join(legacyRoot, 'admin', 'data', 'products.json'),
  oldRentals: path.join(legacyRoot, 'admin', 'data', 'reantal.json'),
  oldMinStock: path.join(legacyRoot, 'admin', 'data', 'min_stock.json'),
  oldMovement: path.join(legacyRoot, 'admin', 'data', 'movement.json'),

  beforeProducts: path.join(dataRoot, 'products.before-merge.json'),
  beforeRentals: path.join(dataRoot, 'reantal.before-merge.json'),
  beforeMinStock: path.join(dataRoot, 'min_stock.before-merge.json'),

  oldProductsCopy: path.join(dataRoot, 'products.old-source.json'),
  oldRentalsCopy: path.join(dataRoot, 'reantal.old-source.json'),
  oldMinStockCopy: path.join(dataRoot, 'min_stock.old-source.json'),

  mergedProducts: path.join(dataRoot, 'products.merged.json'),
  mergedRentals: path.join(dataRoot, 'reantal.merged.json'),
  mergedMinStock: path.join(dataRoot, 'min_stock.merged.json'),

  mergeReport: path.join(dataRoot, 'products.merge-report.json'),
  encodingReport: path.join(dataRoot, 'products.encoding-report.json'),

  preFinalProducts: path.join(dataRoot, 'products.pre-final-replace.json'),
  preFinalRentals: path.join(dataRoot, 'reantal.pre-final-replace.json'),
  preFinalMinStock: path.join(dataRoot, 'min_stock.pre-final-replace.json'),
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function copyFile(source, target) {
  fs.copyFileSync(source, target);
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.round(parsed));
}

function normalizeProductId(product) {
  return normalizeText(product.productId || product.id);
}

function normalizeRentalId(rental) {
  return normalizeText(rental.id || rental.rentalId);
}

function normalizeSku(product) {
  return normalizeText(product.sku);
}

function normalizeProductCode(product) {
  return normalizeText(product.productCode || product.code);
}

function normalizeName(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function normalizeStatus(value) {
  return VALID_PRODUCT_STATUSES.has(normalizeText(value).toLowerCase())
    ? normalizeText(value).toLowerCase()
    : 'active';
}

function sumValues(values) {
  return Object.keys(values || {}).reduce((sum, key) => sum + normalizeInteger(values[key]), 0);
}

function imageExists(imagePath) {
  const raw = normalizeText(imagePath);
  if (!raw) {
    return false;
  }
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) {
    return true;
  }
  return fs.existsSync(path.resolve(adminRoot, raw));
}

function normalizeImage(imagePath, reportEntry) {
  const raw = normalizeText(imagePath);
  if (!raw) {
    if (reportEntry) {
      reportEntry.invalid = true;
    }
    return IMAGE_PLACEHOLDER;
  }
  if (imageExists(raw)) {
    return raw;
  }
  if (reportEntry) {
    reportEntry.invalid = true;
    reportEntry.path = raw;
  }
  return IMAGE_PLACEHOLDER;
}

function stableProductFingerprint(product) {
  return [
    normalizeText(product.categoryId || product.category),
    normalizeName(product.name),
    normalizeText(product.variant || product.spec),
    normalizeSku(product),
    normalizeProductCode(product),
  ].join('|');
}

function suspiciousText(value) {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  return text.includes('\uFFFD') || /\?{3,}/.test(text) || /[擃銝蝧鞎]/.test(text);
}

function parseDateValue(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatDateOnly(value) {
  const iso = parseDateValue(value);
  return iso ? iso.slice(0, 10) : null;
}

function normalizeBranch(branch) {
  const next = {
    main: 0,
    'branch-001': 0,
    'branch-002': 0,
    'branch-003': 0,
  };
  Object.keys(next).forEach((key) => {
    next[key] = normalizeInteger(branch && branch[key]);
  });
  return next;
}

function normalizeCampEntries(camp) {
  return (Array.isArray(camp) ? camp : [])
    .map((entry) => ({
      name: normalizeText(entry && entry.name),
      quantity: normalizeInteger(entry && entry.quantity),
    }))
    .filter((entry) => entry.name);
}

function sortCampEntries(entries) {
  return entries.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

function normalizeProduct(rawProduct, movementDateMap, report) {
  const id = normalizeProductId(rawProduct);
  const imageReport = { id, kind: 'product', field: 'thumbnail', invalid: false, path: '' };
  const branch = normalizeBranch(rawProduct && rawProduct.branch);
  const movementInfo = movementDateMap.storeByName.get(normalizeName(rawProduct && rawProduct.name)) || null;
  const product = {
    id,
    rentalId: normalizeText(rawProduct && rawProduct.rentalId) || null,
    rentalEnabled:
      typeof (rawProduct && rawProduct.rentalEnabled) === 'boolean'
        ? rawProduct.rentalEnabled
        : !!normalizeText(rawProduct && rawProduct.rentalId),
    thumbnail: normalizeImage(rawProduct && rawProduct.thumbnail, imageReport),
    name: normalizeText(rawProduct && rawProduct.name),
    category: normalizeText(rawProduct && rawProduct.category),
    spec: normalizeText(rawProduct && rawProduct.spec),
    price: Number(rawProduct && rawProduct.price) || 0,
    status: normalizeStatus(rawProduct && rawProduct.status),
    branch,
    'total-stock': sumValues(branch),
  };

  if (normalizeSku(rawProduct)) {
    product.sku = normalizeSku(rawProduct);
  }
  if (normalizeProductCode(rawProduct)) {
    product.productCode = normalizeProductCode(rawProduct);
  }
  if (normalizeText(rawProduct && rawProduct.brand)) {
    product.brand = normalizeText(rawProduct.brand);
  }
  if (normalizeText(rawProduct && rawProduct.description)) {
    product.description = normalizeText(rawProduct.description);
  }
  if (Array.isArray(rawProduct && rawProduct.tags)) {
    product.tags = [...new Set(rawProduct.tags.map(normalizeText).filter(Boolean))];
  }
  if (Array.isArray(rawProduct && rawProduct.features)) {
    product.features = [...new Set(rawProduct.features.map(normalizeText).filter(Boolean))];
  }
  if (Array.isArray(rawProduct && rawProduct.images)) {
    product.images = [...new Set(rawProduct.images.map(normalizeText).filter(Boolean))].map((img) =>
      normalizeImage(img)
    );
  }

  if (movementInfo) {
    product.createdAt = movementInfo.first;
    product.updatedAt = movementInfo.last;
  } else {
    const createdAt = formatDateOnly(rawProduct && rawProduct.createdAt);
    const updatedAt = formatDateOnly(rawProduct && rawProduct.updatedAt);
    if (createdAt) {
      product.createdAt = createdAt;
    }
    if (updatedAt) {
      product.updatedAt = updatedAt;
    }
  }

  if (imageReport.invalid) {
    report.invalidImagePaths.push({ id, field: 'thumbnail', path: imageReport.path });
  }

  return product;
}

function normalizeRental(rawRental, movementDateMap, report) {
  const id = normalizeRentalId(rawRental);
  const imageReport = { id, kind: 'rental', field: 'image', invalid: false, path: '' };
  const camps = sortCampEntries(normalizeCampEntries(rawRental && rawRental.camp));
  const movementInfo = movementDateMap.rentalByName.get(normalizeName(rawRental && rawRental.name)) || null;
  const rental = {
    id,
    image: normalizeImage(rawRental && rawRental.image, imageReport),
    name: normalizeText(rawRental && rawRental.name),
    category: normalizeText(rawRental && rawRental.category),
    camp: camps,
  };

  if (movementInfo) {
    rental.createdAt = movementInfo.first;
    rental.updatedAt = movementInfo.last;
  }

  if (imageReport.invalid) {
    report.invalidImagePaths.push({ id, field: 'image', path: imageReport.path });
  }

  return rental;
}

function mergeProductRecords(newProduct, oldProduct, report) {
  const merged = Object.assign({}, oldProduct, newProduct);
  merged.id = newProduct.id || oldProduct.id;
  merged.rentalId = newProduct.rentalId || oldProduct.rentalId || null;
  merged.rentalEnabled =
    typeof newProduct.rentalEnabled === 'boolean'
      ? newProduct.rentalEnabled
      : typeof oldProduct.rentalEnabled === 'boolean'
        ? oldProduct.rentalEnabled
        : !!merged.rentalId;
  merged.branch = Object.assign({}, newProduct.branch || oldProduct.branch || {});
  merged['total-stock'] = sumValues(merged.branch);
  merged.status = normalizeStatus(newProduct.status || oldProduct.status);
  merged.thumbnail = newProduct.thumbnail || oldProduct.thumbnail || IMAGE_PLACEHOLDER;

  if (Number(newProduct.price) !== Number(oldProduct.price)) {
    report.conflicts.push({
      type: 'price-different',
      productId: merged.id,
      newValue: newProduct.price,
      oldValue: oldProduct.price,
    });
  }

  if (JSON.stringify(newProduct.branch) !== JSON.stringify(oldProduct.branch)) {
    report.conflicts.push({
      type: 'stock-snapshot-different',
      productId: merged.id,
      newValue: newProduct.branch,
      oldValue: oldProduct.branch,
    });
  }

  const mergedTags = [...new Set([].concat(newProduct.tags || [], oldProduct.tags || []).filter(Boolean))];
  if (mergedTags.length > 0) {
    merged.tags = mergedTags;
  }
  const mergedFeatures = [
    ...new Set([].concat(newProduct.features || [], oldProduct.features || []).filter(Boolean)),
  ];
  if (mergedFeatures.length > 0) {
    merged.features = mergedFeatures;
  }

  const imageList = [...new Set([].concat(newProduct.images || [], oldProduct.images || []).filter(Boolean))];
  if (imageList.length > 0) {
    merged.images = imageList;
  }

  const createdDates = [newProduct.createdAt, oldProduct.createdAt].filter(Boolean).sort();
  const updatedDates = [newProduct.updatedAt, oldProduct.updatedAt].filter(Boolean).sort();
  if (createdDates.length > 0) {
    merged.createdAt = createdDates[0];
  }
  if (updatedDates.length > 0) {
    merged.updatedAt = updatedDates[updatedDates.length - 1];
  }

  return merged;
}

function mergeRentalRecords(newRental, oldRental, report) {
  const merged = Object.assign({}, oldRental, newRental);
  merged.id = newRental.id || oldRental.id;
  merged.image = newRental.image || oldRental.image || IMAGE_PLACEHOLDER;
  merged.camp = newRental.camp.slice();

  if (JSON.stringify(newRental.camp) !== JSON.stringify(oldRental.camp)) {
    report.conflicts.push({
      type: 'rental-stock-snapshot-different',
      rentalId: merged.id,
      newValue: newRental.camp,
      oldValue: oldRental.camp,
    });
  }

  const createdDates = [newRental.createdAt, oldRental.createdAt].filter(Boolean).sort();
  const updatedDates = [newRental.updatedAt, oldRental.updatedAt].filter(Boolean).sort();
  if (createdDates.length > 0) {
    merged.createdAt = createdDates[0];
  }
  if (updatedDates.length > 0) {
    merged.updatedAt = updatedDates[updatedDates.length - 1];
  }

  return merged;
}

function normalizeMinStockConfig(config) {
  const result = { store: {}, rental: {} };

  Object.entries((config && config.store) || {}).forEach(([productId, entry]) => {
    result.store[normalizeText(productId)] = {
      main: normalizeInteger(entry && entry.main),
      'branch-001': normalizeInteger(entry && entry['branch-001']),
      'branch-002': normalizeInteger(entry && entry['branch-002']),
      'branch-003': normalizeInteger(entry && entry['branch-003']),
    };
  });

  Object.entries((config && config.rental) || {}).forEach(([productId, entry]) => {
    result.rental[normalizeText(productId)] = {
      'rental-main': normalizeInteger(entry && entry['rental-main']),
      'camp-001': normalizeInteger(entry && entry['camp-001']),
      'camp-002': normalizeInteger(entry && entry['camp-002']),
      'camp-003': normalizeInteger(entry && entry['camp-003']),
      'camp-004': normalizeInteger(entry && entry['camp-004']),
      'camp-005': normalizeInteger(entry && entry['camp-005']),
    };
  });

  return result;
}

function createMovementDateMap(newMovement, oldMovement) {
  const storeByName = new Map();
  const rentalByName = new Map();

  function update(map, name, date) {
    if (!name || !date) {
      return;
    }
    const current = map.get(name);
    if (!current) {
      map.set(name, { first: date, last: date });
      return;
    }
    if (date < current.first) {
      current.first = date;
    }
    if (date > current.last) {
      current.last = date;
    }
  }

  [].concat(newMovement || [], oldMovement || []).forEach((record) => {
    const date = formatDateOnly(record && record.date);
    (Array.isArray(record && record.items) ? record.items : []).forEach((item) => {
      const name = normalizeName(item && item.productName);
      if (!name) {
        return;
      }
      update(name.includes('（租借）') ? rentalByName : storeByName, name.replace(/（租借）/g, ''), date);
    });
  });

  return { storeByName, rentalByName };
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
    map.get(key).push(item.id || item.name || item.key || key);
  });

  return [...map.entries()].filter(([, refs]) => refs.length > 1).map(([key, refs]) => ({ key, refs }));
}

function analyzeEncoding(files) {
  return files.map(({ label, path: filePath, records, fields }) => {
    const samples = [];
    (records || []).forEach((record) => {
      fields.forEach((field) => {
        const value = record[field];
        if (Array.isArray(value)) {
          value.forEach((entry) => {
            if (suspiciousText(entry)) {
              samples.push({ id: record.id || record.name || null, field, value: entry });
            }
          });
          return;
        }
        if (suspiciousText(value)) {
          samples.push({ id: record.id || record.name || null, field, value });
        }
      });
    });

    return {
      label,
      file: filePath,
      count: records.length,
      jsonValid: true,
      suspiciousCount: samples.length,
      samples: samples.slice(0, 10),
    };
  });
}

function validateProducts(products, rentals, minStock, report) {
  const duplicateProductIds = findDuplicateEntries(products, (item) => item.id);
  const duplicateSkus = findDuplicateEntries(products, (item) => item.sku);
  const invalidStatuses = products
    .filter((item) => !VALID_PRODUCT_STATUSES.has(item.status))
    .map((item) => ({ id: item.id, status: item.status }));
  const invalidPrices = products
    .filter((item) => !Number.isFinite(Number(item.price)))
    .map((item) => ({ id: item.id, price: item.price }));
  const negativeStockProducts = products
    .filter((item) => item['total-stock'] < 0 || Object.values(item.branch || {}).some((value) => value < 0))
    .map((item) => ({ id: item.id, branch: item.branch, totalStock: item['total-stock'] }));
  const missingRentalIds = products
    .filter(
      (item) => item.rentalEnabled && item.rentalId && !rentals.some((rental) => rental.id === item.rentalId)
    )
    .map((item) => ({ productId: item.id, rentalId: item.rentalId }));
  const orphanRentals = rentals
    .filter((rental) => !products.some((product) => product.rentalId === rental.id))
    .map((rental) => ({ rentalId: rental.id }));

  report.invalidReferences = report.invalidReferences
    .concat(missingRentalIds.map((entry) => ({ type: 'missing-rental', value: entry })))
    .concat(orphanRentals.map((entry) => ({ type: 'orphan-rental', value: entry })));

  return {
    duplicateProductIds,
    duplicateSkus,
    invalidStatuses,
    invalidPrices,
    negativeStockProducts,
    minStockStoreKeys: Object.keys(minStock.store || {}).length,
    minStockRentalKeys: Object.keys(minStock.rental || {}).length,
  };
}

function main() {
  const newProductsRaw = readJson(PATHS.liveProducts);
  const oldProductsRaw = readJson(PATHS.oldProducts);
  const newRentalsRaw = readJson(PATHS.liveRentals);
  const oldRentalsRaw = readJson(PATHS.oldRentals);
  const newMinStockRaw = readJson(PATHS.liveMinStock);
  const oldMinStockRaw = readJson(PATHS.oldMinStock);
  const newMovementRaw = readJson(PATHS.liveMovement);
  const oldMovementRaw = readJson(PATHS.oldMovement);

  copyFile(PATHS.liveProducts, PATHS.beforeProducts);
  copyFile(PATHS.liveRentals, PATHS.beforeRentals);
  copyFile(PATHS.liveMinStock, PATHS.beforeMinStock);
  copyFile(PATHS.oldProducts, PATHS.oldProductsCopy);
  copyFile(PATHS.oldRentals, PATHS.oldRentalsCopy);
  copyFile(PATHS.oldMinStock, PATHS.oldMinStockCopy);

  const movementDateMap = createMovementDateMap(newMovementRaw, oldMovementRaw);
  const report = {
    newCount: newProductsRaw.length,
    oldCount: oldProductsRaw.length,
    mergedCount: 0,
    overlapCount: 0,
    onlyNewCount: 0,
    onlyOldCount: 0,
    duplicateProductIds: [],
    duplicateSkus: [],
    conflictCount: 0,
    conflicts: [],
    invalidImagePaths: [],
    invalidReferences: [],
    validation: {},
    rental: {
      newCount: newRentalsRaw.length,
      oldCount: oldRentalsRaw.length,
      mergedCount: 0,
      overlapCount: 0,
      onlyNewCount: 0,
      onlyOldCount: 0,
    },
    stockSource: 'snapshot-and-history',
  };

  const newProducts = newProductsRaw.map((item) => normalizeProduct(item, movementDateMap, report));
  const oldProducts = oldProductsRaw.map((item) => normalizeProduct(item, movementDateMap, report));
  const newRentals = newRentalsRaw.map((item) => normalizeRental(item, movementDateMap, report));
  const oldRentals = oldRentalsRaw.map((item) => normalizeRental(item, movementDateMap, report));
  const newMinStock = normalizeMinStockConfig(newMinStockRaw);
  const oldMinStock = normalizeMinStockConfig(oldMinStockRaw);

  const mergedProducts = [];
  const seenProductIds = new Set();
  const oldProductsById = new Map(oldProducts.map((item) => [item.id, item]));
  const newProductsById = new Map(newProducts.map((item) => [item.id, item]));

  newProducts.forEach((product) => {
    const oldProduct = oldProductsById.get(product.id);
    if (oldProduct) {
      report.overlapCount += 1;
      mergedProducts.push(mergeProductRecords(product, oldProduct, report));
    } else {
      report.onlyNewCount += 1;
      mergedProducts.push(product);
    }
    seenProductIds.add(product.id);
  });

  oldProducts.forEach((product) => {
    if (!seenProductIds.has(product.id)) {
      report.onlyOldCount += 1;
      mergedProducts.push(product);
    }
  });

  const mergedRentals = [];
  const seenRentalIds = new Set();
  const oldRentalsById = new Map(oldRentals.map((item) => [item.id, item]));
  newRentals.forEach((rental) => {
    const oldRental = oldRentalsById.get(rental.id);
    if (oldRental) {
      report.rental.overlapCount += 1;
      mergedRentals.push(mergeRentalRecords(rental, oldRental, report));
    } else {
      report.rental.onlyNewCount += 1;
      mergedRentals.push(rental);
    }
    seenRentalIds.add(rental.id);
  });

  oldRentals.forEach((rental) => {
    if (!seenRentalIds.has(rental.id)) {
      report.rental.onlyOldCount += 1;
      mergedRentals.push(rental);
    }
  });

  const mergedMinStock = {
    store: Object.assign({}, oldMinStock.store, newMinStock.store),
    rental: Object.assign({}, oldMinStock.rental, newMinStock.rental),
  };

  mergedProducts.forEach((product) => {
    if (!mergedMinStock.store[product.id]) {
      mergedMinStock.store[product.id] = Object.assign({}, DEFAULT_STORE_MIN);
    }
  });
  mergedRentals.forEach((rental) => {
    if (!mergedMinStock.rental[rental.id]) {
      mergedMinStock.rental[rental.id] = Object.assign({}, DEFAULT_RENTAL_MIN);
    }
  });

  report.mergedCount = mergedProducts.length;
  report.rental.mergedCount = mergedRentals.length;
  report.rental.onlyOldCount = oldRentals.filter((item) => !seenRentalIds.has(item.id)).length;

  report.validation = validateProducts(mergedProducts, mergedRentals, mergedMinStock, report);
  report.duplicateProductIds = report.validation.duplicateProductIds;
  report.duplicateSkus = report.validation.duplicateSkus;
  report.conflictCount = report.conflicts.length;

  writeJson(PATHS.mergedProducts, mergedProducts);
  writeJson(PATHS.mergedRentals, mergedRentals);
  writeJson(PATHS.mergedMinStock, mergedMinStock);
  writeJson(PATHS.mergeReport, report);

  const encodingFiles = analyzeEncoding([
    {
      label: 'products-live',
      path: PATHS.liveProducts,
      records: newProducts,
      fields: ['name', 'category', 'spec', 'description', 'brand'],
    },
    {
      label: 'products-old',
      path: PATHS.oldProducts,
      records: oldProducts,
      fields: ['name', 'category', 'spec', 'description', 'brand'],
    },
    {
      label: 'products-merged',
      path: PATHS.mergedProducts,
      records: mergedProducts,
      fields: ['name', 'category', 'spec', 'description', 'brand'],
    },
    { label: 'rentals-live', path: PATHS.liveRentals, records: newRentals, fields: ['name', 'category'] },
    { label: 'rentals-old', path: PATHS.oldRentals, records: oldRentals, fields: ['name', 'category'] },
    {
      label: 'rentals-merged',
      path: PATHS.mergedRentals,
      records: mergedRentals,
      fields: ['name', 'category'],
    },
  ]);

  const safeToApply =
    encodingFiles.every((file) => file.suspiciousCount === 0) &&
    report.validation.duplicateProductIds.length === 0 &&
    report.validation.duplicateSkus.length === 0 &&
    report.validation.invalidStatuses.length === 0 &&
    report.validation.invalidPrices.length === 0 &&
    report.validation.negativeStockProducts.length === 0;

  const encodingReport = {
    files: encodingFiles,
    decision: APPLY_MODE && safeToApply ? 'applied' : safeToApply ? 'safe-to-apply' : 'hold',
    reason: safeToApply
      ? 'products, rentals, and min-stock snapshots passed encoding and structural validation'
      : 'merged product snapshots contain suspicious text or invalid structure',
  };
  writeJson(PATHS.encodingReport, encodingReport);

  if (APPLY_MODE) {
    if (!safeToApply) {
      throw new Error('Merged products dataset failed validation and cannot be applied.');
    }
    copyFile(PATHS.liveProducts, PATHS.preFinalProducts);
    copyFile(PATHS.liveRentals, PATHS.preFinalRentals);
    copyFile(PATHS.liveMinStock, PATHS.preFinalMinStock);
    copyFile(PATHS.mergedProducts, PATHS.liveProducts);
    copyFile(PATHS.mergedRentals, PATHS.liveRentals);
    copyFile(PATHS.mergedMinStock, PATHS.liveMinStock);
  }

  console.log(
    JSON.stringify(
      {
        applyMode: APPLY_MODE,
        applied: APPLY_MODE && safeToApply,
        newCount: report.newCount,
        oldCount: report.oldCount,
        mergedCount: report.mergedCount,
        rentalMergedCount: report.rental.mergedCount,
        overlapCount: report.overlapCount,
        onlyOldCount: report.onlyOldCount,
        conflictCount: report.conflictCount,
        invalidImageCount: report.invalidImagePaths.length,
        encodingDecision: encodingReport.decision,
        stockSource: report.stockSource,
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
