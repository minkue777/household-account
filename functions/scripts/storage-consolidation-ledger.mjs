import { normalizers } from './reconcile-runtime.mjs';

const stable = value => JSON.stringify(value, (_, entry) => entry && !Array.isArray(entry) && typeof entry === 'object'
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const fail = (code, field) => { throw new Error(`LEDGER_${code}:${field}`); };
const preserved = ['recurringExpenseId', 'recurringMonth', 'recurringPlanId', 'recurringTargetMonth',
  'settled', 'settlementRequestedAt', 'settledAt', 'settledBy', 'pendingSettlement', 'localCurrencyType',
  'sourceFingerprint', 'captureLineageId', 'cardEvidence', 'derivedFromTransactionId', 'mergedFrom',
  'mergeLeafIds', 'mergeLeafSnapshots', 'intermediateMergeHistoryIds', 'notificationRequest'];

export function validateCanonicalLedgerDocument(id, data, context) {
  if (!data) fail('CANONICAL_MISSING', 'document');
  if (data.householdId !== context.householdId) fail('MISMATCH', 'householdId');
  if (data.transactionId !== undefined && data.transactionId !== id) fail('MISMATCH', 'transactionId');
  for (const field of ['merchant', 'memo', 'categoryId', 'accountingDate', 'localTime', 'creatorMemberId']) {
    if (typeof data[field] !== 'string') fail('INVALID', field);
  }
  // Superseded audit originals may predate display-date storage; do not resurrect or rewrite them.
  if (data.lifecycleState === 'active' && !/^\d{4}-\d{2}-\d{2}$/.test(data.accountingDate)) fail('INVALID', 'accountingDate');
  if (!Number.isSafeInteger(data.amountInWon) || data.amountInWon < 0) fail('INVALID', 'amountInWon');
  if (!Number.isSafeInteger(data.aggregateVersion) || data.aggregateVersion < 1) fail('INVALID', 'aggregateVersion');
  if (!['active', 'superseded', 'deleted'].includes(data.lifecycleState)) fail('INVALID', 'lifecycleState');
  if (!['income', 'expense'].includes(data.transactionType)) fail('INVALID', 'transactionType');
  // A removed member remains a valid historical creator. This operation must not reassign them.
  if (!data.creatorMemberId.trim()) fail('UNRESOLVED', 'creatorMemberId');
}

/** Keep canonical business authority and backfill only absent historical display/lineage metadata. */
export function ledgerPatch(id, legacy, canonical, context) {
  validateCanonicalLedgerDocument(id, canonical, context);
  if (legacy.householdId !== context.householdId) fail('MISMATCH', 'householdId');
  const left = normalizers.ledger(id, legacy);
  const right = normalizers.ledger(id, canonical);
  for (const field of Object.keys(left)) {
    if (left[field] !== right[field]) fail('MISMATCH', field);
  }
  if ((legacy.transactionType ?? 'expense') !== canonical.transactionType) fail('MISMATCH', 'transactionType');
  if (legacy.aggregateVersion !== undefined && legacy.aggregateVersion !== canonical.aggregateVersion) fail('MISMATCH', 'aggregateVersion');
  const patch = {};
  if (legacy.creatorMemberId !== undefined && legacy.creatorMemberId !== canonical.creatorMemberId) fail('MISMATCH', 'creatorMemberId');
  if (legacy.cardDisplay !== undefined && legacy.cardDisplay !== canonical.cardDisplay) fail('MISMATCH', 'cardDisplay');
  // The legacy field sometimes stored the full display label, while canonical stores last-four digits.
  // Their shared authoritative cardDisplay is checked above; never replace the canonical card token.
  if (legacy.cardLastFour !== undefined && canonical.cardLastFour === undefined) patch.cardLastFour = legacy.cardLastFour;
  for (const key of preserved) {
    if (legacy[key] === undefined) continue;
    if (canonical[key] === undefined) patch[key] = legacy[key];
    else if (stable(legacy[key]) !== stable(canonical[key])) fail('MISMATCH', key);
  }
  const split = legacy.splitGroup ?? (legacy.splitGroupId ? {
    groupId: legacy.splitGroupId, index: legacy.splitIndex, total: legacy.splitTotal, originalId: legacy.splitOriginalId,
  } : undefined);
  if (split) {
    const current = canonical.splitGroup ?? (canonical.splitGroupId ? {
      groupId: canonical.splitGroupId, index: canonical.splitIndex, total: canonical.splitTotal, originalId: canonical.splitOriginalId,
    } : undefined);
    if (!current) patch.splitGroup = split;
    else if (stable(current) !== stable(split)) fail('MISMATCH', 'splitGroup');
    // Existing split/merge command adapters use the top-level immutable lineage fields.
    for (const [field, value] of Object.entries({ splitGroupId: split.groupId, splitIndex: split.index,
      splitTotal: split.total, splitOriginalId: split.originalId })) {
      if (value !== undefined && canonical[field] === undefined) patch[field] = value;
      else if (value !== undefined && canonical[field] !== value) fail('MISMATCH', field);
    }
  }
  return patch;
}
