import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const legacyRoot = 'C:\\Users\\i125g\\Downloads\\Yuruicamp-main';
const applyMode = process.argv.includes('--apply');

const currentPath = path.join(repoRoot, 'admin', 'data', 'orders.json');
const backupPath = path.join(repoRoot, 'admin', 'data', 'orders.before-merge.json');
const oldSourcePath = path.join(repoRoot, 'admin', 'data', 'orders.old-source.json');
const mergedPath = path.join(repoRoot, 'admin', 'data', 'orders.merged.json');
const reportPath = path.join(repoRoot, 'admin', 'data', 'orders.merge-report.json');
const encodingPath = path.join(repoRoot, 'admin', 'data', 'orders.encoding-report.json');
const preFinalPath = path.join(repoRoot, 'admin', 'data', 'orders.pre-final-replace.json');
const legacyPath = path.join(legacyRoot, 'admin', 'data', 'orders.json');

const customers = readJson(path.join(repoRoot, 'admin', 'data', 'customers.json'));
const products = readJson(path.join(repoRoot, 'admin', 'data', 'products.json'));
const currentOrders = normalizeOrders(readJson(currentPath));
const oldOrders = normalizeOrders(readJson(legacyPath));

writeJson(backupPath, currentOrders);
writeJson(oldSourcePath, oldOrders);

const customerIndex = buildCustomerIndex(customers);
const productIndex = buildProductIndex(products);
const currentById = new Map(currentOrders.map((order) => [order.id, order]));
const oldById = new Map(oldOrders.map((order) => [order.id, order]));
const mergedMap = new Map();
const onlyNewIds = [];
const onlyOldIds = [];
const overlapIds = [];
const sameIdDifferentContent = [];
const preservedLegacyConflictIds = [];
const aliasMappings = [];

for (const order of currentOrders) {
  mergedMap.set(order.id, order);
}

for (const oldOrder of oldOrders) {
  const currentOrder = currentById.get(oldOrder.id);
  if (!currentOrder) {
    mergedMap.set(oldOrder.id, oldOrder);
    onlyOldIds.push(oldOrder.id);
    continue;
  }

  overlapIds.push(oldOrder.id);
  if (stableStringify(currentOrder) !== stableStringify(oldOrder)) {
    sameIdDifferentContent.push(oldOrder.id);
    const preserved = createLegacyConflictOrder(oldOrder, mergedMap);
    mergedMap.set(preserved.id, preserved);
    preservedLegacyConflictIds.push(preserved.id);
  }
}

for (const currentOrder of currentOrders) {
  if (!oldById.has(currentOrder.id)) {
    onlyNewIds.push(currentOrder.id);
  }
}

const mergedOrders = Array.from(mergedMap.values())
  .map((order) => enrichOrder(order, customerIndex, productIndex, aliasMappings))
  .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));

const report = {
  newCount: currentOrders.length,
  oldCount: oldOrders.length,
  mergedCount: mergedOrders.length,
  overlapCount: overlapIds.length,
  onlyNewCount: onlyNewIds.length,
  onlyOldCount: onlyOldIds.length,
  sameIdDifferentContentCount: sameIdDifferentContent.length,
  onlyNewIds,
  onlyOldIds,
  overlapIds,
  sameIdDifferentContent,
  preservedLegacyConflictIds,
  duplicateOrderIds: findDuplicateValues(mergedOrders.map((order) => order.id)),
  duplicateOrderNumbers: findDuplicateValues(mergedOrders.map((order) => order.orderNumber)),
  amountConflicts: [],
  invalidCustomerReferences: [],
  invalidProductReferences: [],
  unknownStatusValues: [],
  unresolvedHistoricalCustomer: [],
  unresolvedHistoricalProduct: [],
  warnings: [],
  fatalErrors: [],
  aliasMappings,
  suspectedDuplicateOrders: [],
  resolutionDetails: {
    customers: [],
    products: [],
  },
  validation: {},
};

const legalPaymentStatuses = new Set(['paid', 'unpaid', 'cod']);
const legalOrderStatuses = new Set(['unshipped', 'shipped', 'returned', 'completed']);
const fingerprintMap = new Map();

for (const order of mergedOrders) {
  validateOrderStructure(order, report);

  const fingerprint = buildOrderFingerprint(order);
  const knownFingerprint = fingerprintMap.get(fingerprint);
  if (knownFingerprint && knownFingerprint !== order.id) {
    report.suspectedDuplicateOrders.push({ orderId: order.id, matchedOrderId: knownFingerprint, fingerprint });
  } else {
    fingerprintMap.set(fingerprint, order.id);
  }

  const customerResolution = resolveCustomerReference(order, customerIndex);
  if (customerResolution.matchedCustomerId) {
    order.customerId = customerResolution.matchedCustomerId;
  } else {
    order.customerId = '';
    report.unresolvedHistoricalCustomer.push({
      orderId: order.id,
      buyerName: order.buyerName,
      customerId: order.customerId || '',
      reason: customerResolution.reason,
      candidates: customerResolution.candidates,
    });
    report.warnings.push({
      type: 'unresolvedHistoricalCustomer',
      orderId: order.id,
      reason: customerResolution.reason,
    });
  }
  report.resolutionDetails.customers.push({
    orderId: order.id,
    buyerName: order.buyerName,
    matchedCustomerId: customerResolution.matchedCustomerId || '',
    method: customerResolution.method,
    evidence: customerResolution.evidence,
  });

  for (const item of order.items) {
    const productResolution = resolveProductReference(order, item, productIndex);
    if (productResolution.matchedProductId) {
      item.productId = productResolution.matchedProductId;
      if (productResolution.legacyProductName) {
        item.legacyProductName = productResolution.legacyProductName;
      }
      if (productResolution.aliasMapping) {
        aliasMappings.push(productResolution.aliasMapping);
      }
    } else {
      item.productId = '';
      report.unresolvedHistoricalProduct.push({
        orderId: order.id,
        productName: item.name,
        productId: item.productId || '',
        reason: productResolution.reason,
        candidates: productResolution.candidates,
      });
      report.warnings.push({
        type: 'unresolvedHistoricalProduct',
        orderId: order.id,
        productName: item.name,
        reason: productResolution.reason,
      });
    }
    report.resolutionDetails.products.push({
      orderId: order.id,
      productName: item.name,
      matchedProductId: productResolution.matchedProductId || '',
      method: productResolution.method,
      evidence: productResolution.evidence,
    });
  }

  if (!legalPaymentStatuses.has(order.paymentStatus)) {
    report.unknownStatusValues.push({ type: 'paymentStatus', orderId: order.id, value: order.paymentStatus });
    report.fatalErrors.push({ type: 'unknownPaymentStatus', orderId: order.id, value: order.paymentStatus });
  }
  if (!legalOrderStatuses.has(order.orderStatus)) {
    report.unknownStatusValues.push({ type: 'orderStatus', orderId: order.id, value: order.orderStatus });
    report.fatalErrors.push({ type: 'unknownOrderStatus', orderId: order.id, value: order.orderStatus });
  }

  const calculatedSubtotal = order.items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
  const shippingFee = Number(order.shippingFee || 0);
  const tax = Number(order.tax || 0);
  const discount = Number(order.discount || 0);
  const calculatedTotal = calculatedSubtotal + shippingFee + tax - discount;
  if (!Number.isFinite(calculatedTotal) || !Number.isFinite(Number(order.total || 0))) {
    report.fatalErrors.push({ type: 'invalidAmountNumber', orderId: order.id });
  } else if (Number(order.total || 0) !== calculatedTotal) {
    report.amountConflicts.push({
      recordId: order.id,
      storedAmount: Number(order.total || 0),
      calculatedAmount: calculatedTotal,
      difference: Number(order.total || 0) - calculatedTotal,
      formulaSource: 'subtotal + shippingFee + tax - discount',
    });
  }

  if (!order.customerId) {
    report.warnings.push({
      type: 'buyerSnapshotOnly',
      orderId: order.id,
      buyerName: order.buyerName,
    });
  }
  if (order.items.some((item) => !item.productId)) {
    report.warnings.push({
      type: 'productSnapshotOnly',
      orderId: order.id,
    });
  }
}

if (report.duplicateOrderIds.length > 0) {
  report.fatalErrors.push({ type: 'duplicateOrderIds', values: report.duplicateOrderIds });
}
if (report.duplicateOrderNumbers.length > 0) {
  report.fatalErrors.push({ type: 'duplicateOrderNumbers', values: report.duplicateOrderNumbers });
}
if (report.amountConflicts.length > 0) {
  report.fatalErrors.push({ type: 'amountConflicts', count: report.amountConflicts.length });
}

const encodingReport = scanEncodingIssues(mergedOrders, ['buyerName', 'address', 'customerNote', 'paymentNote', 'name']);
encodingReport.suspiciousCount = encodingReport.suspiciousEntries.length;
if (encodingReport.suspiciousEntries.length > 0) {
  report.fatalErrors.push({
    type: 'encodingCorruption',
    suspiciousCount: encodingReport.suspiciousEntries.length,
  });
}

report.invalidCustomerReferences = report.unresolvedHistoricalCustomer.map((entry) => ({
  orderId: entry.orderId,
  customerId: entry.customerId,
  buyerName: entry.buyerName,
}));
report.invalidProductReferences = report.unresolvedHistoricalProduct.map((entry) => ({
  orderId: entry.orderId,
  productId: entry.productId,
  productName: entry.productName,
}));

report.validation = {
  parseSuccess: true,
  duplicateOrderIdCount: report.duplicateOrderIds.length,
  duplicateOrderNumberCount: report.duplicateOrderNumbers.length,
  amountConflictCount: report.amountConflicts.length,
  warningCount: report.warnings.length,
  fatalErrorCount: report.fatalErrors.length,
  encodingSuspiciousCount: encodingReport.suspiciousEntries.length,
};

writeJson(mergedPath, mergedOrders);
writeJson(reportPath, report);
writeJson(encodingPath, encodingReport);

const canApply = report.fatalErrors.length === 0;
if (applyMode) {
  if (!canApply) {
    console.error('Orders merge validation failed. Live data not replaced.');
    process.exitCode = 1;
  } else {
    fs.copyFileSync(currentPath, preFinalPath);
    fs.copyFileSync(mergedPath, currentPath);
    readJson(currentPath);
    console.log('Applied merged admin orders data.');
  }
} else {
  console.log('Generated admin orders merge artifacts.');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function normalizeOrders(input) {
  if (!Array.isArray(input)) {
    throw new Error('orders.json must be an array');
  }
  return input.map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    return {
      ...order,
      id: String(order.orderId || order.id || '').trim(),
      orderId: String(order.orderId || order.id || '').trim(),
      orderNumber: String(order.orderNumber || order.id || order.orderId || '').trim(),
      buyerName: String(order.buyerName || '').trim(),
      buyerEmail: String(order.buyerEmail || '').trim(),
      buyerPhone: String(order.buyerPhone || '').trim(),
      customerId: String(order.customerId || '').trim(),
      createdAt: String(order.createdAt || '').trim(),
      updatedAt: String(order.updatedAt || '').trim(),
      paymentStatus: String(order.paymentStatus || '').trim(),
      orderStatus: String(order.orderStatus || '').trim(),
      address: String(order.address || '').trim(),
      customerNote: String(order.customerNote || '').trim(),
      items: items.map((item) => ({
        ...item,
        name: String(item.name || '').trim(),
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        productId: String(item.productId || '').trim(),
        sku: String(item.sku || '').trim(),
        productCode: String(item.productCode || '').trim(),
      })),
      total: Number(order.total || 0),
      shippingFee: Number(order.shippingFee || 0),
      tax: Number(order.tax || 0),
      discount: Number(order.discount || 0),
      history: Array.isArray(order.history)
        ? order.history.map((entry) => ({
            time: String(entry.time || '').trim(),
            action: String(entry.action || '').trim(),
          }))
        : [],
      orderType: 'product',
    };
  }).filter((order) => order.id);
}

function enrichOrder(order, customerIndex, productIndex, aliasMappings) {
  const enriched = { ...order };
  if (!enriched.orderNumber) {
    enriched.orderNumber = enriched.id;
  }
  if (!enriched.customerId && enriched.buyerName) {
    const nameCandidates = customerIndex.byNormalizedName.get(normalizeText(enriched.buyerName)) || [];
    if (nameCandidates.length === 1) {
      enriched.customerId = nameCandidates[0].id;
    }
  }
  enriched.items = enriched.items.map((item) => {
    const clone = { ...item };
    if (!clone.productId) {
      const exactNameCandidates = productIndex.byNormalizedName.get(normalizeText(clone.name)) || [];
      if (exactNameCandidates.length === 1) {
        clone.productId = exactNameCandidates[0].id;
      } else {
        const alias = tryAliasProduct(clone, productIndex);
        if (alias) {
          clone.productId = alias.id;
          clone.legacyProductName = clone.name;
          clone.name = alias.name;
          aliasMappings.push({
            orderId: order.id,
            from: clone.legacyProductName,
            to: alias.name,
            productId: alias.id,
            evidence: alias.evidence,
          });
        }
      }
    }
    return clone;
  });
  return enriched;
}

function buildCustomerIndex(customersList) {
  const index = {
    byId: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
    byNormalizedName: new Map(),
    byOrderOwnership: new Map(),
    all: customersList.map((customer) => ({
      id: String(customer.id || ''),
      name: String(customer.name || ''),
      email: String(customer.email || ''),
      phone: String(customer.phone || ''),
      orders: Array.isArray(customer.orders) ? customer.orders.map(String) : [],
    })),
  };

  for (const customer of index.all) {
    index.byId.set(customer.id, customer);
    addToMultiMap(index.byEmail, normalizeEmail(customer.email), customer);
    addToMultiMap(index.byPhone, normalizePhone(customer.phone), customer);
    addToMultiMap(index.byNormalizedName, normalizeText(customer.name), customer);
    customer.orders.forEach((orderId) => addToMultiMap(index.byOrderOwnership, orderId, customer));
  }
  return index;
}

function buildProductIndex(productsList) {
  const index = {
    byId: new Map(),
    bySku: new Map(),
    byProductCode: new Map(),
    byNormalizedName: new Map(),
    all: productsList.map((product) => ({
      id: String(product.id || ''),
      name: String(product.name || ''),
      spec: String(product.spec || ''),
      price: Number(product.price || 0),
      sku: String(product.sku || ''),
      productCode: String(product.productCode || ''),
    })),
  };
  for (const product of index.all) {
    index.byId.set(product.id, product);
    addToMultiMap(index.bySku, normalizeText(product.sku), product);
    addToMultiMap(index.byProductCode, normalizeText(product.productCode), product);
    addToMultiMap(index.byNormalizedName, normalizeText(product.name), product);
  }
  return index;
}

function resolveCustomerReference(order, customerIndex) {
  if (order.customerId && customerIndex.byId.has(order.customerId)) {
    return {
      matchedCustomerId: order.customerId,
      method: 'customerId',
      reason: '',
      candidates: [],
      evidence: 'existing-customerId',
    };
  }

  const emailCandidates = getUniqueCandidates(customerIndex.byEmail.get(normalizeEmail(order.buyerEmail)));
  if (emailCandidates.length === 1) {
    return {
      matchedCustomerId: emailCandidates[0].id,
      method: 'email',
      reason: '',
      candidates: [],
      evidence: `buyerEmail=${order.buyerEmail}`,
    };
  }

  const phoneCandidates = getUniqueCandidates(customerIndex.byPhone.get(normalizePhone(order.buyerPhone)));
  if (phoneCandidates.length === 1) {
    return {
      matchedCustomerId: phoneCandidates[0].id,
      method: 'phone',
      reason: '',
      candidates: [],
      evidence: `buyerPhone=${order.buyerPhone}`,
    };
  }

  const normalizedName = normalizeText(order.buyerName);
  const nameCandidates = getUniqueCandidates(customerIndex.byNormalizedName.get(normalizedName));
  if (normalizedName && nameCandidates.length === 1) {
    return {
      matchedCustomerId: nameCandidates[0].id,
      method: 'normalizedName',
      reason: '',
      candidates: [],
      evidence: `buyerName=${order.buyerName}`,
    };
  }

  const ownershipCandidates = getUniqueCandidates(customerIndex.byOrderOwnership.get(order.id));
  if (ownershipCandidates.length === 1 && normalizeText(ownershipCandidates[0].name) === normalizedName) {
    return {
      matchedCustomerId: ownershipCandidates[0].id,
      method: 'customerOrdersOwnership',
      reason: '',
      candidates: [],
      evidence: `customers.orders contains ${order.id}`,
    };
  }

  const candidates = buildCustomerCandidates(order, customerIndex, ownershipCandidates, nameCandidates);
  return {
    matchedCustomerId: '',
    method: 'unresolved',
    reason: 'no-unique-customer-match',
    candidates,
    evidence: '',
  };
}

function resolveProductReference(order, item, productIndex) {
  if (item.productId && productIndex.byId.has(item.productId)) {
    return {
      matchedProductId: item.productId,
      method: 'productId',
      reason: '',
      candidates: [],
      evidence: 'existing-productId',
      legacyProductName: '',
      aliasMapping: null,
    };
  }

  const skuCandidates = getUniqueCandidates(productIndex.bySku.get(normalizeText(item.sku)));
  if (skuCandidates.length === 1) {
    return {
      matchedProductId: skuCandidates[0].id,
      method: 'sku',
      reason: '',
      candidates: [],
      evidence: `sku=${item.sku}`,
      legacyProductName: '',
      aliasMapping: null,
    };
  }

  const codeCandidates = getUniqueCandidates(productIndex.byProductCode.get(normalizeText(item.productCode)));
  if (codeCandidates.length === 1) {
    return {
      matchedProductId: codeCandidates[0].id,
      method: 'productCode',
      reason: '',
      candidates: [],
      evidence: `productCode=${item.productCode}`,
      legacyProductName: '',
      aliasMapping: null,
    };
  }

  const exactNameCandidates = getUniqueCandidates(productIndex.byNormalizedName.get(normalizeText(item.name)));
  if (exactNameCandidates.length === 1) {
    return {
      matchedProductId: exactNameCandidates[0].id,
      method: 'normalizedName',
      reason: '',
      candidates: [],
      evidence: `itemName=${item.name}`,
      legacyProductName: '',
      aliasMapping: null,
    };
  }

  const aliasMatch = tryAliasProduct(item, productIndex);
  if (aliasMatch) {
    return {
      matchedProductId: aliasMatch.id,
      method: 'aliasWithPriceAndSpecEvidence',
      reason: '',
      candidates: [],
      evidence: aliasMatch.evidence,
      legacyProductName: item.name,
      aliasMapping: {
        orderId: order.id,
        from: item.name,
        to: aliasMatch.name,
        productId: aliasMatch.id,
        evidence: aliasMatch.evidence,
      },
    };
  }

  return {
    matchedProductId: '',
    method: 'unresolved',
    reason: 'no-strong-product-evidence',
    candidates: buildProductCandidates(item, productIndex),
    evidence: '',
    legacyProductName: '',
    aliasMapping: null,
  };
}

function tryAliasProduct(item, productIndex) {
  const normalized = normalizeText(item.name);
  if (!normalized) return null;
  const canonical = normalized.replace(/式/g, '');
  const candidates = productIndex.all.filter((product) => {
    const productCanonical = normalizeText(product.name).replace(/式/g, '');
    return productCanonical === canonical;
  });
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];

  if (Number.isFinite(candidate.price) && Number(item.price) === candidate.price) {
    return {
      ...candidate,
      evidence: `canonical-name + price(${item.price})`,
    };
  }
  return null;
}

function buildCustomerCandidates(order, customerIndex, ownershipCandidates, nameCandidates) {
  const candidates = [];
  const seed = new Map();
  [...ownershipCandidates, ...nameCandidates].forEach((customer) => {
    seed.set(customer.id, customer);
  });
  const targetName = normalizeText(order.buyerName);
  if (targetName.includes('雅婷')) {
    customerIndex.all
      .filter((customer) => normalizeText(customer.name).includes('雅婷'))
      .forEach((customer) => seed.set(customer.id, customer));
  }
  for (const customer of seed.values()) {
    candidates.push({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      hasOrderOwnership: customer.orders.includes(order.id),
    });
  }
  return candidates;
}

function buildProductCandidates(item, productIndex) {
  const normalized = normalizeText(item.name);
  const canonical = normalized.replace(/式/g, '');
  const candidates = productIndex.all.filter((product) => {
    const productNormalized = normalizeText(product.name);
    const productCanonical = productNormalized.replace(/式/g, '');
    return productNormalized.includes(normalized) ||
      normalized.includes(productNormalized) ||
      productCanonical === canonical ||
      productCanonical.includes(canonical) ||
      canonical.includes(productCanonical);
  });

  return candidates.slice(0, 5).map((product) => ({
    id: product.id,
    name: product.name,
    spec: product.spec,
    price: product.price,
  }));
}

function validateOrderStructure(order, report) {
  if (!order.id || !order.orderNumber) {
    report.fatalErrors.push({ type: 'brokenOrderIdentity', orderId: order.id || '' });
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    report.fatalErrors.push({ type: 'brokenOrderItems', orderId: order.id });
    return;
  }
  if (!Number.isFinite(Number(order.total))) {
    report.fatalErrors.push({ type: 'invalidAmountNumber', orderId: order.id, field: 'total' });
  }
  if (!Number.isFinite(Number(order.shippingFee)) || !Number.isFinite(Number(order.tax)) || !Number.isFinite(Number(order.discount))) {
    report.fatalErrors.push({ type: 'invalidAmountNumber', orderId: order.id, field: 'shippingFee/tax/discount' });
  }
  order.items.forEach((item, index) => {
    if (!item.name) {
      report.fatalErrors.push({ type: 'brokenOrderItems', orderId: order.id, itemIndex: index, reason: 'missingName' });
    }
    if (!Number.isFinite(Number(item.qty)) || !Number.isFinite(Number(item.price))) {
      report.fatalErrors.push({ type: 'invalidAmountNumber', orderId: order.id, itemIndex: index, field: 'qty/price' });
    }
  });
}

function createLegacyConflictOrder(order, existingMap) {
  let nextId = `${order.id}-legacy`;
  let counter = 2;
  while (existingMap.has(nextId)) {
    nextId = `${order.id}-legacy-${counter}`;
    counter += 1;
  }
  return {
    ...order,
    id: nextId,
    orderId: nextId,
    orderNumber: nextId,
    history: dedupeHistory([
      ...(order.history || []),
      { time: latestValue(order.updatedAt, order.createdAt), action: 'legacy-conflict-preserved' },
    ]),
    orderType: 'product',
  };
}

function dedupeHistory(history) {
  const seen = new Set();
  return history
    .filter((entry) => {
      const key = [entry.time, entry.action].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function buildOrderFingerprint(order) {
  const items = (order.items || [])
    .map((item) => `${item.name}:${item.qty}:${item.price}`)
    .sort()
    .join(',');
  return [order.buyerName, order.createdAt, order.total, items].join('|');
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

function addToMultiMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function getUniqueCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const unique = new Map();
  candidates.forEach((candidate) => unique.set(candidate.id, candidate));
  return Array.from(unique.values());
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/().]/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function latestValue(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return String(a) >= String(b) ? a : b;
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
  walk(records, ['orders']);
  return {
    checkedAt: new Date().toISOString(),
    suspiciousEntries,
  };
}
