/** Pure preflight checks; this module neither reads Firestore nor repairs conflicting values. */
const matchTypes = new Set(['exact', 'startsWith', 'endsWith', 'contains']);
const fail = (kind, field, detail = 'INVALID') => { throw new Error(`${kind.toUpperCase()}_${detail}:${field}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const first = (...values) => values.find(value => value !== undefined && value !== null);
const text = (kind, field, value) => {
  if (typeof value !== 'string' || !value.trim()) fail(kind, field);
  return value.trim();
};
const integer = (kind, field, value, minimum) => {
  if (!Number.isSafeInteger(value) || value < minimum) fail(kind, field);
  return value;
};
const stable = value => Array.isArray(value) ? JSON.stringify(value)
  : object(value) ? JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))) : JSON.stringify(value);
const tokens = keyword => [...new Set(keyword.split(',').map(value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')))].sort();
const company = value => {
  const normalized = value.trim().toLocaleLowerCase('ko-KR');
  return ['여민전', '세종', '세종지역화폐'].includes(normalized) ? '세종지역화폐' : normalized;
};

function scope(kind, id, data, context, canonical) {
  if (!object(data)) fail(kind, 'document');
  if (data.householdId !== context.householdId) fail(kind, 'householdId', 'MISMATCH');
  const field = kind === 'card' ? 'cardId' : 'ruleId';
  if (canonical && data[field] !== undefined && data[field] !== id) fail(kind, field, 'MISMATCH');
}

function card(id, data, context, canonical) {
  scope('card', id, data, context, canonical);
  let ownerMemberId = data.ownerMemberId;
  if (!canonical && ownerMemberId === undefined) {
    const owner = text('card', 'owner', data.owner);
    ownerMemberId = context.memberIds.has(owner) ? owner : context.memberIdByAlias.get(owner);
  }
  if (typeof ownerMemberId !== 'string' || !context.memberIds.has(ownerMemberId)) fail('card', 'ownerMemberId', 'UNRESOLVED');
  const label = text('card', 'cardCompanyCode', canonical ? data.cardCompanyCode : first(data.cardCompanyCode, data.cardCompany, data.cardLabel));
  const rawNumber = first(canonical ? data.lastFour : first(data.lastFour, data.cardLastFour), '');
  if (typeof rawNumber !== 'string') fail('card', 'lastFour');
  const lastFour = canonical ? rawNumber : rawNumber.replace(/\D/g, '').slice(-4);
  if (lastFour !== '' && !/^\d{4}$/.test(lastFour)) fail('card', 'lastFour');
  if (!canonical && rawNumber.trim() !== '' && lastFour === '') fail('card', 'lastFour');
  const lifecycle = canonical ? data.lifecycle
    : data.deletedAt !== undefined || data.lifecycle === 'retired' || data.lifecycleState === 'retired' ? 'retired' : 'active';
  if (!['active', 'retired'].includes(lifecycle)) fail('card', 'lifecycle');
  return {
    ownerMemberId, cardCompanyCode: company(label), lastFour, lifecycle,
    order: integer('card', 'order', canonical ? data.order : first(data.order, data.orderIndex, 0), 0),
    aggregateVersion: integer('card', 'aggregateVersion', canonical ? data.aggregateVersion : first(data.aggregateVersion, data.version, 1), 1),
  };
}

function mapping(data, canonical) {
  if (data.mapping !== undefined && !object(data.mapping)) fail('rule', 'mapping');
  const raw = data.mapping ?? {};
  const values = {
    merchant: raw.merchant,
    categoryId: canonical ? raw.categoryId : first(raw.categoryId, raw.category, data.categoryId, data.category),
    memo: raw.memo,
  };
  const result = {};
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (typeof value !== 'string') fail('rule', `mapping.${field}`);
    if (value.trim()) result[field] = value.trim();
  }
  // Missing canonical categoryId must not be silently masked by a legacy alias.
  if (canonical && raw.category !== undefined) fail('rule', 'mapping.category', 'NOT_CANONICAL');
  return result;
}

function rule(id, data, context, canonical, existingCanonicalPriority) {
  scope('rule', id, data, context, canonical);
  const keyword = text('rule', 'keyword', canonical ? data.keyword : first(data.keyword, data.merchantKeyword));
  const normalizedKeywords = tokens(keyword);
  if (normalizedKeywords.includes('')) fail('rule', 'keyword', 'EMPTY_OR_TOKEN');
  const matchType = canonical ? data.matchType : first(data.matchType, data.exactMatch === true ? 'exact' : 'contains');
  if (!matchTypes.has(matchType)) fail('rule', 'matchType');
  if (canonical && (!Array.isArray(data.normalizedKeywords)
    || data.normalizedKeywords.some(value => typeof value !== 'string')
    || stable([...new Set(data.normalizedKeywords)].sort()) !== stable(normalizedKeywords))) fail('rule', 'normalizedKeywords');
  // Runtime migration assigned manifest priorities to legacy rules with no priority or 0,
  // preserving those source documents. Canonical already wins the live union by ruleId;
  // keep its validated value instead of treating the preserved source as a new override.
  const rawPriority = !canonical && (data.priority === undefined || data.priority === 0)
    ? existingCanonicalPriority : data.priority;
  // Older exact rules carried an unused priority; it is not part of their matching behavior.
  const priority = matchType === 'exact' ? undefined : integer('rule', 'priority', rawPriority, 1);
  const active = canonical ? data.active : data.active !== false && data.isActive !== false;
  if (typeof active !== 'boolean') fail('rule', 'active');
  return {
    normalizedKeywords, matchType, ...(priority === undefined ? {} : { priority }), active,
    mapping: mapping(data, canonical),
    aggregateVersion: integer('rule', 'aggregateVersion', canonical ? data.aggregateVersion : first(data.aggregateVersion, data.version, 1), 1),
  };
}

/** Validate canonical-only documents too, including retired cards and inactive rules. */
export function validateCanonicalPaymentDocument(kind, id, canonical, context) {
  if (!['card', 'rule'].includes(kind)) throw new Error('PAYMENT_DOCUMENT_KIND_INVALID');
  return kind === 'card' ? card(id, canonical, context, true) : rule(id, canonical, context, true);
}

/** Return no mutation on equality; a mismatch requires review, never a guessed overwrite. */
export function paymentConfigurationPatch(kind, id, legacy, canonical, context) {
  if (!canonical) fail(kind, 'document', 'CANONICAL_MISSING');
  const current = validateCanonicalPaymentDocument(kind, id, canonical, context);
  const source = kind === 'card' ? card(id, legacy, context, false) : rule(id, legacy, context, false, current.priority);
  const fields = Object.keys(source).filter(field => stable(source[field]) !== stable(current[field]));
  if (fields.length) fail(kind, fields.join(','), 'MISMATCH');
  return {};
}
