import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PATHS = {
  live: path.join(repoRoot, 'admin', 'data', 'reviews.json'),
  beforeMerge: path.join(repoRoot, 'admin', 'data', 'reviews.before-merge.json'),
  oldSource: path.join(repoRoot, 'admin', 'data', 'reviews.old-source.json'),
  merged: path.join(repoRoot, 'admin', 'data', 'reviews.merged.json'),
  mergeReport: path.join(repoRoot, 'admin', 'data', 'reviews.merge-report.json'),
  encodingReport: path.join(repoRoot, 'admin', 'data', 'reviews.encoding-report.json'),
  preFinalReplace: path.join(repoRoot, 'admin', 'data', 'reviews.pre-final-replace.json'),
  legacyExternal: 'C:\\Users\\i125g\\Downloads\\Yuruicamp-main\\admin\\data\\reviews.json',
  customers: path.join(repoRoot, 'admin', 'data', 'customers.json'),
  orders: path.join(repoRoot, 'admin', 'data', 'orders.json'),
  products: path.join(repoRoot, 'admin', 'data', 'products.json'),
};

const APPLY_MODE = process.argv.includes('--apply');
const SAFE_STATUS_VALUES = new Set(['unreplied', 'replied']);
const MOJIBAKE_PATTERNS = [/\uFFFD/u, /[?？]{2,}/u, /擃/u, /銝/u, /蝧/u, /鞎/u, //u, /�/u];
const CJK_PATTERN = /[\u3400-\u9FFF]/u;

function fail(message) {
  console.error(`[merge-admin-reviews] ${message}`);
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

function readOptionalJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  const normalized = text.replace('T', ' ').replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized} 00:00`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  const pad = (valueToPad) => String(valueToPad).padStart(2, '0');
  return (
    parsed.getFullYear() +
    '-' +
    pad(parsed.getMonth() + 1) +
    '-' +
    pad(parsed.getDate()) +
    ' ' +
    pad(parsed.getHours()) +
    ':' +
    pad(parsed.getMinutes())
  );
}

function normalizeInteger(value, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.trunc(numberValue);
}

function normalizeRating(value) {
  const rating = normalizeInteger(value, 0);
  if (rating < 1) {
    return 1;
  }
  if (rating > 5) {
    return 5;
  }
  return rating;
}

function hashText(value) {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 10);
}

function escapeIfMissing(value) {
  return value === undefined ? null : value;
}

function pickPresent(newValue, oldValue) {
  return normalizeText(newValue) ? deepClone(newValue) : deepClone(oldValue);
}

function analyzeText(value, fieldName) {
  const text = normalizeText(value);
  const reasons = [];
  if (!text) {
    reasons.push('empty');
    return reasons;
  }
  if (MOJIBAKE_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push('mojibake-pattern');
  }
  if (fieldName === 'buyerName' && !CJK_PATTERN.test(text)) {
    reasons.push('buyer-name-without-cjk');
  }
  if (fieldName === 'comment' && text.length < 2) {
    reasons.push('comment-too-short');
  }
  return reasons;
}

function normalizeReplyFields(review) {
  let replyText = normalizeText(review.replyText);
  let replyAt = review.replyAt ? normalizeDate(review.replyAt) : null;
  let replyUpdatedAt = review.replyUpdatedAt ? normalizeDate(review.replyUpdatedAt) : null;
  let repliedBy = review.repliedBy ? normalizeText(review.repliedBy) : null;
  let repliedByName = review.repliedByName ? normalizeText(review.repliedByName) : null;

  if (Array.isArray(review.replies) && review.replies.length > 0) {
    const latestReply = deepClone(review.replies[review.replies.length - 1]) || {};
    replyText = normalizeText(latestReply.replyText || latestReply.text || replyText);
    replyAt = latestReply.replyAt ? normalizeDate(latestReply.replyAt) : replyAt;
    replyUpdatedAt = latestReply.replyUpdatedAt ? normalizeDate(latestReply.replyUpdatedAt) : replyUpdatedAt;
    repliedBy = latestReply.repliedBy ? normalizeText(latestReply.repliedBy) : repliedBy;
    repliedByName = latestReply.repliedByName ? normalizeText(latestReply.repliedByName) : repliedByName;
  } else if (review.reply && typeof review.reply === 'object' && !Array.isArray(review.reply)) {
    replyText = normalizeText(review.reply.replyText || review.reply.text || replyText);
    replyAt = review.reply.replyAt ? normalizeDate(review.reply.replyAt) : replyAt;
    replyUpdatedAt = review.reply.replyUpdatedAt
      ? normalizeDate(review.reply.replyUpdatedAt)
      : replyUpdatedAt;
    repliedBy = review.reply.repliedBy ? normalizeText(review.reply.repliedBy) : repliedBy;
    repliedByName = review.reply.repliedByName ? normalizeText(review.reply.repliedByName) : repliedByName;
  } else if (typeof review.reply === 'string' && !replyText) {
    replyText = normalizeText(review.reply);
  }

  return {
    replyText,
    replyAt,
    replyUpdatedAt,
    repliedBy,
    repliedByName,
    replied: review.replied === true || replyText !== '',
  };
}

function normalizeReview(rawReview) {
  const review = deepClone(rawReview) || {};
  const id = normalizeText(review.reviewId || review.id);
  const reply = normalizeReplyFields(review);
  const normalized = {
    id,
    buyerName: normalizeText(review.buyerName || review.customerName),
    buyerAvatar: normalizeText(review.buyerAvatar),
    rating: normalizeRating(review.rating),
    comment: normalizeText(review.comment || review.content),
    photos: Array.isArray(review.photos)
      ? review.photos.map((photo) => normalizeText(photo)).filter(Boolean)
      : [],
    productName: normalizeText(review.productName),
    createdAt: normalizeDate(review.createdAt),
    replied: reply.replied,
    replyText: reply.replyText,
  };

  if (reply.replyAt) {
    normalized.replyAt = reply.replyAt;
  }
  if (reply.replyUpdatedAt) {
    normalized.replyUpdatedAt = reply.replyUpdatedAt;
  }
  if (reply.repliedBy) {
    normalized.repliedBy = reply.repliedBy;
  }
  if (reply.repliedByName) {
    normalized.repliedByName = reply.repliedByName;
  }

  if (normalizeText(review.customerId)) {
    normalized.customerId = normalizeText(review.customerId);
  }
  if (normalizeText(review.orderId)) {
    normalized.orderId = normalizeText(review.orderId);
  }
  if (normalizeText(review.productId)) {
    normalized.productId = normalizeText(review.productId);
  }
  if (normalizeText(review.updatedAt)) {
    normalized.updatedAt = normalizeDate(review.updatedAt);
  }
  if (review.helpfulCount !== undefined) {
    normalized.helpfulCount = normalizeInteger(review.helpfulCount, 0);
  }
  if (review.likeCount !== undefined) {
    normalized.likeCount = normalizeInteger(review.likeCount, 0);
  }
  if (normalizeText(review.status)) {
    normalized.status = normalizeText(review.status).toLowerCase();
  }
  return normalized;
}

function getDerivedStatus(review) {
  const normalizedStatus = normalizeText(review.status).toLowerCase();
  if (SAFE_STATUS_VALUES.has(normalizedStatus)) {
    return normalizedStatus;
  }
  return review.replied === true || normalizeText(review.replyText) ? 'replied' : 'unreplied';
}

function coreFingerprint(review) {
  return [
    normalizeText(review.buyerName).toLowerCase(),
    normalizeText(review.productName).toLowerCase(),
    normalizeDate(review.createdAt),
    String(normalizeRating(review.rating)),
    normalizeText(review.comment).toLowerCase(),
  ].join('|');
}

function fallbackIdentity(review) {
  if (review.orderId && review.productId && review.customerId) {
    return `order:${review.orderId}|product:${review.productId}|customer:${review.customerId}`.toLowerCase();
  }
  if (review.customerId) {
    return `customer:${review.customerId}|created:${normalizeDate(review.createdAt)}|rating:${normalizeRating(review.rating)}|content:${normalizeText(review.comment).toLowerCase()}`;
  }
  return `hash:${hashText(coreFingerprint(review))}`;
}

function createLegacyCollisionId(review) {
  return `${review.id || 'review'}-legacy-${hashText(coreFingerprint(review))}`;
}

function countById(records) {
  const map = new Map();
  for (const record of records) {
    const id = normalizeText(record.id);
    if (!id) {
      continue;
    }
    map.set(id, (map.get(id) || 0) + 1);
  }
  return map;
}

function findDuplicateRecords(records, selector) {
  const owners = new Map();
  const duplicates = [];
  for (const record of records) {
    const key = selector(record);
    if (!key) {
      continue;
    }
    if (owners.has(key)) {
      duplicates.push({ key, first: owners.get(key), second: record.id });
    } else {
      owners.set(key, record.id);
    }
  }
  return duplicates;
}

function analyzeFileRecords(label, filePath, records) {
  const samples = [];
  records.forEach((record) => {
    [
      ['buyerName', record.buyerName, true],
      ['comment', record.comment, true],
      ['replyText', record.replyText || '', record.replied === true || normalizeText(record.replyText) !== ''],
    ].forEach(([field, value, shouldCheck]) => {
      if (!shouldCheck) {
        return;
      }
      const reasons = analyzeText(value, field);
      if (reasons.length > 0) {
        samples.push({
          reviewId: record.id,
          field,
          value,
          reasons,
        });
      }
    });
  });

  return {
    file: filePath,
    label,
    count: records.length,
    jsonValid: true,
    suspiciousCount: samples.length,
    samples: samples.slice(0, 20),
  };
}

function createMaps(records) {
  const byId = new Map();
  const byFallback = new Map();
  records.forEach((record, index) => {
    if (record.id) {
      byId.set(record.id, index);
    }
    byFallback.set(fallbackIdentity(record), index);
  });
  return { byId, byFallback };
}

function buildInvalidReferenceEntry(reviewId, field, value) {
  return {
    reviewId,
    field,
    value,
    issue: `${field}-not-found`,
  };
}

function chooseReplyVersion(newReview, oldReview, report) {
  const newHasReply = normalizeText(newReview.replyText) !== '';
  const oldHasReply = normalizeText(oldReview.replyText) !== '';

  if (newHasReply && !oldHasReply) {
    return {
      replyText: newReview.replyText,
      replyAt: escapeIfMissing(newReview.replyAt),
      replyUpdatedAt: escapeIfMissing(newReview.replyUpdatedAt),
      repliedBy: escapeIfMissing(newReview.repliedBy),
      repliedByName: escapeIfMissing(newReview.repliedByName),
      replied: true,
    };
  }

  if (!newHasReply && oldHasReply) {
    return {
      replyText: oldReview.replyText,
      replyAt: escapeIfMissing(oldReview.replyAt),
      replyUpdatedAt: escapeIfMissing(oldReview.replyUpdatedAt),
      repliedBy: escapeIfMissing(oldReview.repliedBy),
      repliedByName: escapeIfMissing(oldReview.repliedByName),
      replied: true,
    };
  }

  if (!newHasReply && !oldHasReply) {
    return {
      replyText: '',
      replyAt: null,
      replyUpdatedAt: null,
      repliedBy: null,
      repliedByName: null,
      replied: false,
    };
  }

  if (newReview.replyText === oldReview.replyText) {
    return {
      replyText: newReview.replyText,
      replyAt: newReview.replyAt || oldReview.replyAt || null,
      replyUpdatedAt: newReview.replyUpdatedAt || oldReview.replyUpdatedAt || null,
      repliedBy: newReview.repliedBy || oldReview.repliedBy || null,
      repliedByName: newReview.repliedByName || oldReview.repliedByName || null,
      replied: true,
    };
  }

  const newReplyStamp = normalizeDate(
    newReview.replyUpdatedAt || newReview.replyAt || newReview.updatedAt || newReview.createdAt
  );
  const oldReplyStamp = normalizeDate(
    oldReview.replyUpdatedAt || oldReview.replyAt || oldReview.updatedAt || oldReview.createdAt
  );
  const keepOld = oldReplyStamp && (!newReplyStamp || oldReplyStamp > newReplyStamp);
  const chosen = keepOld ? oldReview : newReview;
  const displaced = keepOld ? newReview : oldReview;

  report.conflicts.push({
    type: 'reply-conflict',
    reviewId: newReview.id || oldReview.id,
    chosenReplyText: chosen.replyText,
    discardedReplyText: displaced.replyText,
    chosenTimestamp: keepOld ? oldReplyStamp : newReplyStamp,
  });

  return {
    replyText: chosen.replyText,
    replyAt: chosen.replyAt || null,
    replyUpdatedAt: chosen.replyUpdatedAt || null,
    repliedBy: chosen.repliedBy || null,
    repliedByName: chosen.repliedByName || null,
    replied: true,
  };
}

function mergeReviewRecords(newReview, oldReview, report) {
  const merged = deepClone(newReview);
  const reply = chooseReplyVersion(newReview, oldReview, report);

  merged.buyerName = pickPresent(newReview.buyerName, oldReview.buyerName);
  merged.buyerAvatar = pickPresent(newReview.buyerAvatar, oldReview.buyerAvatar);
  merged.productName = pickPresent(newReview.productName, oldReview.productName);
  merged.comment = pickPresent(newReview.comment, oldReview.comment);
  merged.photos =
    (newReview.photos && newReview.photos.length > 0 ? newReview.photos : oldReview.photos) || [];
  merged.createdAt = (() => {
    const newDate = normalizeDate(newReview.createdAt);
    const oldDate = normalizeDate(oldReview.createdAt);
    if (!newDate) {
      return oldDate;
    }
    if (!oldDate) {
      return newDate;
    }
    return newDate <= oldDate ? newDate : oldDate;
  })();
  merged.updatedAt = (() => {
    const newDate = normalizeDate(newReview.updatedAt);
    const oldDate = normalizeDate(oldReview.updatedAt);
    if (!newDate) {
      return oldDate || undefined;
    }
    if (!oldDate) {
      return newDate;
    }
    return newDate >= oldDate ? newDate : oldDate;
  })();
  merged.replyText = reply.replyText;
  merged.replyAt = reply.replyAt || undefined;
  merged.replyUpdatedAt = reply.replyUpdatedAt || undefined;
  merged.repliedBy = reply.repliedBy || undefined;
  merged.repliedByName = reply.repliedByName || undefined;
  merged.replied = reply.replied;
  merged.status = getDerivedStatus(merged);

  if (newReview.rating !== oldReview.rating) {
    report.conflicts.push({
      type: 'rating-conflict',
      reviewId: merged.id,
      newValue: newReview.rating,
      oldValue: oldReview.rating,
      chosenValue: newReview.rating,
    });
  }

  if (newReview.comment !== oldReview.comment) {
    report.conflicts.push({
      type: 'comment-conflict',
      reviewId: merged.id,
      newValue: newReview.comment,
      oldValue: oldReview.comment,
      chosenValue: newReview.comment,
    });
  }

  if (newReview.helpfulCount !== undefined || oldReview.helpfulCount !== undefined) {
    merged.helpfulCount =
      newReview.helpfulCount !== undefined ? newReview.helpfulCount : (oldReview.helpfulCount ?? 0);
  }
  if (newReview.likeCount !== undefined || oldReview.likeCount !== undefined) {
    merged.likeCount = newReview.likeCount !== undefined ? newReview.likeCount : (oldReview.likeCount ?? 0);
  }
  if (newReview.customerId || oldReview.customerId) {
    merged.customerId = pickPresent(newReview.customerId, oldReview.customerId);
  }
  if (newReview.orderId || oldReview.orderId) {
    merged.orderId = pickPresent(newReview.orderId, oldReview.orderId);
  }
  if (newReview.productId || oldReview.productId) {
    merged.productId = pickPresent(newReview.productId, oldReview.productId);
  }

  return merged;
}

function validateReferences(records, report) {
  const customerIds = new Set(readOptionalJsonArray(PATHS.customers).map((item) => normalizeText(item.id)));
  const orderIds = new Set(
    readOptionalJsonArray(PATHS.orders)
      .flatMap((item) => {
        return [normalizeText(item.id), normalizeText(item.orderId), normalizeText(item.number)];
      })
      .filter(Boolean)
  );
  const productIds = new Set(
    readOptionalJsonArray(PATHS.products)
      .flatMap((item) => {
        return [normalizeText(item.id), normalizeText(item.productId), normalizeText(item.sku)];
      })
      .filter(Boolean)
  );

  records.forEach((review) => {
    if (review.customerId && customerIds.size > 0 && !customerIds.has(review.customerId)) {
      report.invalidReferences.push(buildInvalidReferenceEntry(review.id, 'customerId', review.customerId));
    }
    if (review.orderId && orderIds.size > 0 && !orderIds.has(review.orderId)) {
      report.invalidReferences.push(buildInvalidReferenceEntry(review.id, 'orderId', review.orderId));
    }
    if (review.productId && productIds.size > 0 && !productIds.has(review.productId)) {
      report.invalidReferences.push(buildInvalidReferenceEntry(review.id, 'productId', review.productId));
    }
  });
}

function buildValidation(records) {
  const duplicateIds = findDuplicateRecords(records, (record) => normalizeText(record.id));
  const duplicateFallbackKeys = findDuplicateRecords(records, (record) => fallbackIdentity(record));
  const invalidRatings = records
    .filter((record) => record.rating < 1 || record.rating > 5)
    .map((record) => ({ reviewId: record.id, rating: record.rating }));
  const invalidDates = records
    .filter((record) => {
      return !normalizeDate(record.createdAt) || (record.replyAt && !normalizeDate(record.replyAt));
    })
    .map((record) => ({
      reviewId: record.id,
      createdAt: record.createdAt,
      replyAt: record.replyAt || null,
    }));
  const invalidStatuses = records
    .map((record) => ({
      reviewId: record.id,
      status: getDerivedStatus(record),
    }))
    .filter((record) => !SAFE_STATUS_VALUES.has(record.status));

  return {
    duplicateIds,
    duplicateFallbackKeys,
    invalidRatings,
    invalidDates,
    invalidStatuses,
    statusValues: [...new Set(records.map((record) => getDerivedStatus(record)))].sort(),
  };
}

function createBackups() {
  fs.copyFileSync(PATHS.live, PATHS.beforeMerge);
  fs.copyFileSync(PATHS.legacyExternal, PATHS.oldSource);
}

function mergeReviews(newRecords, oldRecords) {
  const overlapIds = [...countById(newRecords).keys()].filter((id) => countById(oldRecords).has(id));
  const report = {
    oldCount: oldRecords.length,
    newCount: newRecords.length,
    mergedCount: 0,
    onlyOldCount: 0,
    onlyNewCount: 0,
    mergedDuplicates: 0,
    overlapReviewCount: overlapIds.length,
    duplicateReviewIdsRemoved: 0,
    conflictCount: 0,
    conflicts: [],
    invalidReferences: [],
    validation: {},
  };

  const merged = newRecords.map((review) => {
    const normalized = deepClone(review);
    normalized.status = getDerivedStatus(normalized);
    return normalized;
  });
  const maps = createMaps(merged);
  const onlyNewIds = new Set(newRecords.map((review) => review.id).filter(Boolean));
  const seenMergedLogicalKeys = new Set();

  oldRecords.forEach((oldReview) => {
    const oldId = normalizeText(oldReview.id);
    const oldFallback = fallbackIdentity(oldReview);

    if (oldId && maps.byId.has(oldId)) {
      const existing = merged[maps.byId.get(oldId)];
      if (coreFingerprint(existing) === coreFingerprint(oldReview)) {
        merged[maps.byId.get(oldId)] = mergeReviewRecords(existing, oldReview, report);
        report.mergedDuplicates += 1;
        report.duplicateReviewIdsRemoved += 1;
        seenMergedLogicalKeys.add(oldId);
        return;
      }

      const remapped = deepClone(oldReview);
      remapped.legacyOriginalId = oldId;
      remapped.id = createLegacyCollisionId(oldReview);
      remapped.status = getDerivedStatus(remapped);
      merged.push(remapped);
      maps.byId.set(remapped.id, merged.length - 1);
      maps.byFallback.set(fallbackIdentity(remapped), merged.length - 1);
      report.onlyOldCount += 1;
      report.conflicts.push({
        type: 'id-collision-different-review',
        reviewId: oldId,
        newReviewFingerprint: coreFingerprint(existing),
        oldReviewFingerprint: coreFingerprint(oldReview),
        remappedLegacyId: remapped.id,
      });
      return;
    }

    if (maps.byFallback.has(oldFallback)) {
      const existing = merged[maps.byFallback.get(oldFallback)];
      merged[maps.byFallback.get(oldFallback)] = mergeReviewRecords(existing, oldReview, report);
      report.mergedDuplicates += 1;
      seenMergedLogicalKeys.add(existing.id);
      return;
    }

    const added = deepClone(oldReview);
    added.status = getDerivedStatus(added);
    merged.push(added);
    maps.byId.set(added.id, merged.length - 1);
    maps.byFallback.set(fallbackIdentity(added), merged.length - 1);
    report.onlyOldCount += 1;
  });

  report.onlyNewCount = [...onlyNewIds].filter((id) => !seenMergedLogicalKeys.has(id)).length;
  validateReferences(merged, report);
  report.validation = buildValidation(merged);
  report.conflictCount = report.conflicts.length;
  report.mergedCount = merged.length;

  return { merged, report };
}

function buildEncodingReport(
  liveRecords,
  beforeMergeRecords,
  oldSourceRecords,
  mergedRecords,
  report,
  finalValidation
) {
  const files = [
    analyzeFileRecords('live', PATHS.live, liveRecords),
    analyzeFileRecords('beforeMerge', PATHS.beforeMerge, beforeMergeRecords),
    analyzeFileRecords('oldSource', PATHS.oldSource, oldSourceRecords),
    analyzeFileRecords('legacyExternal', PATHS.legacyExternal, oldSourceRecords),
    analyzeFileRecords('merged', PATHS.merged, mergedRecords),
  ];

  const mergedFile = files.find((entry) => entry.label === 'merged');
  const mergedSafe =
    mergedFile &&
    mergedFile.suspiciousCount === 0 &&
    report.validation.duplicateIds.length === 0 &&
    report.validation.invalidRatings.length === 0 &&
    report.validation.invalidDates.length === 0 &&
    report.validation.invalidStatuses.length === 0;

  return {
    files,
    decision: mergedSafe ? 'safe-to-apply' : 'hold',
    reason: mergedSafe
      ? 'merged reviews passed encoding and structural validation'
      : 'merged reviews contain suspicious text or invalid structure',
    finalValidation,
  };
}

function buildFinalValidation(records) {
  return {
    count: records.length,
    suspiciousCount: analyzeFileRecords('finalLive', PATHS.live, records).suspiciousCount,
    samples: records
      .filter((record) => ['R001', 'R006', 'R020', 'R050'].includes(record.legacyOriginalId || record.id))
      .slice(0, 8)
      .map((record) => ({
        id: record.id,
        legacyOriginalId: record.legacyOriginalId || null,
        buyerName: record.buyerName,
        rating: record.rating,
        productName: record.productName,
        replied: record.replied,
      })),
    validation: buildValidation(records),
  };
}

function ensureSafeToApply(report, encodingReport) {
  return (
    encodingReport.decision === 'safe-to-apply' &&
    report.validation.duplicateIds.length === 0 &&
    report.validation.invalidRatings.length === 0 &&
    report.validation.invalidDates.length === 0 &&
    report.validation.invalidStatuses.length === 0
  );
}

function main() {
  createBackups();

  const liveRecords = readJsonArray(PATHS.live, '正式評論資料').map((review) => normalizeReview(review));
  const beforeMergeRecords = readJsonArray(PATHS.beforeMerge, '評論整併前備份').map((review) =>
    normalizeReview(review)
  );
  const oldSourceRecords = readJsonArray(PATHS.oldSource, '舊版評論資料').map((review) =>
    normalizeReview(review)
  );

  const { merged, report } = mergeReviews(liveRecords, oldSourceRecords);
  writeJson(PATHS.merged, merged);
  writeJson(PATHS.mergeReport, report);

  let finalValidation = null;
  let applied = false;

  if (APPLY_MODE) {
    const encodingPreview = buildEncodingReport(
      liveRecords,
      beforeMergeRecords,
      oldSourceRecords,
      merged,
      report,
      null
    );
    if (ensureSafeToApply(report, encodingPreview)) {
      fs.copyFileSync(PATHS.live, PATHS.preFinalReplace);
      fs.copyFileSync(PATHS.merged, PATHS.live);
      const finalLiveRecords = readJsonArray(PATHS.live, '正式評論資料（已替換）').map((review) =>
        normalizeReview(review)
      );
      finalValidation = buildFinalValidation(finalLiveRecords);
      applied =
        finalValidation.count === merged.length &&
        finalValidation.suspiciousCount === 0 &&
        finalValidation.validation.duplicateIds.length === 0 &&
        finalValidation.validation.invalidRatings.length === 0 &&
        finalValidation.validation.invalidDates.length === 0 &&
        finalValidation.validation.invalidStatuses.length === 0;
      if (!applied) {
        fs.copyFileSync(PATHS.beforeMerge, PATHS.live);
      }
    }
  }

  const encodingReport = buildEncodingReport(
    liveRecords,
    beforeMergeRecords,
    oldSourceRecords,
    merged,
    report,
    finalValidation
  );
  if (APPLY_MODE) {
    encodingReport.decision = applied ? 'applied' : encodingReport.decision;
    encodingReport.reason = applied
      ? 'merged reviews passed validation and replaced live reviews.json'
      : encodingReport.reason;
    encodingReport.applied = applied;
  }
  writeJson(PATHS.encodingReport, encodingReport);

  console.log(
    JSON.stringify(
      {
        applyMode: APPLY_MODE,
        applied,
        oldCount: report.oldCount,
        newCount: report.newCount,
        mergedCount: report.mergedCount,
        overlapReviewCount: report.overlapReviewCount,
        onlyNewCount: report.onlyNewCount,
        onlyOldCount: report.onlyOldCount,
        mergedDuplicates: report.mergedDuplicates,
        duplicateReviewIdsRemoved: report.duplicateReviewIdsRemoved,
        conflictCount: report.conflictCount,
        invalidReferenceCount: report.invalidReferences.length,
        encodingDecision: encodingReport.decision,
      },
      null,
      2
    )
  );
}

main();
