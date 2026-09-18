// One-off storage consolidation validation. No database access or runtime fallback.
const assetTypes = new Set(['savings', 'stock', 'crypto', 'property', 'gold', 'loan']);
const subTypes = {
  savings: ['deposit', 'installment', 'insurance'], stock: [], crypto: [], property: [],
  gold: ['physical', 'stock'], loan: ['credit', 'mortgage', 'jeonse'],
};
const subTypeAliases = { 예금: 'deposit', 적금: 'installment', 보험: 'insurance', 실물: 'physical', 실물금: 'physical',
  주식: 'stock', 금etf: 'stock', 신용대출: 'credit', 주택담보대출: 'mortgage', 전세대출: 'jeonse' };
const automationFields = ['recurringContributionAmount', 'recurringContributionDay', 'lastAutoContributionMonth',
  'loanInterestRate', 'loanRepaymentMethod', 'loanMonthlyPaymentAmount', 'loanPaymentDay', 'lastAutoRepaymentMonth'];
const instrumentTypes = new Set(['stock', 'etf', 'etn', 'fund', 'bond', 'cash', 'manual', 'crypto']);
const markets = new Set(['KRX', 'US', 'KOFIA_FUND', 'UPBIT_KRW', 'UNRESOLVED']);
const exchanges = new Set(['KOSPI', 'KOSDAQ', 'KONEX', 'NASDAQ', 'NYSE', 'AMEX']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positiveInteger = value => Number.isSafeInteger(value) && value >= 1;
const sameCode = (left, right) => nonempty(left) && nonempty(right)
  && left.toLocaleUpperCase('en-US') === right.toLocaleUpperCase('en-US');
const stable = value => isRecord(value) ? `{${Object.keys(value).sort().map(key => `${key}:${stable(value[key])}`).join(',')}}`
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]` : JSON.stringify(value);
const validDate = value => Number.isFinite(typeof value === 'string' ? Date.parse(value)
  : value instanceof Date ? value.getTime() : typeof value?.toMillis === 'function' ? value.toMillis() : NaN);
const dateString = value => typeof value === 'string' ? value : value instanceof Date ? value.toISOString()
  : typeof value?.toDate === 'function' ? value.toDate().toISOString() : undefined;
const lifecycle = value => value.lifecycleState === 'purging' || value.lifecycleState === 'deleted'
  || value.isActive === false || value.deletedAt !== undefined ? 'deleted' : 'active';

/**
 * Returns a missing-only patch after validating the effective canonical document.
 * ownerProfiles: [{ profileId, displayName }], including archived profiles.
 * Position calls must supply the parent assetId and source collection's positionKind.
 * Pass legacy=undefined to check canonical-only documents without inventing values.
 */
export function validatePortfolioDocument(kind, id, legacy, canonical, options) {
  const fail = (code, field) => { throw new Error(`${kind.toUpperCase()}_${code}${field ? `:${field}` : ''}`); };
  const requireValue = (condition, field) => { if (!condition) fail('INVALID', field); };
  requireValue(kind === 'asset' || kind === 'position', 'kind');
  if (!isRecord(canonical)) fail('CANONICAL_MISSING');
  requireValue(nonempty(id) && nonempty(options.householdId), 'scope');
  if (legacy !== undefined) requireValue(isRecord(legacy), 'legacy');
  const patch = {};
  const effective = { ...canonical };
  const retain = (key, value, equal = (left, right) => stable(left) === stable(right)) => {
    if (value === undefined) return;
    if (effective[key] === undefined) { patch[key] = value; effective[key] = value; }
    else if (!equal(effective[key], value)) fail('MISMATCH', key);
  };
  const retainMap = (key, values) => {
    if (effective[key] !== undefined) requireValue(isRecord(effective[key]), key);
    const merged = { ...effective[key] };
    for (const [field, value] of Object.entries(values)) {
      if (value === undefined) continue;
      if (merged[field] === undefined) merged[field] = value;
      else if (stable(merged[field]) !== stable(value)) fail('MISMATCH', `${key}.${field}`);
    }
    if (stable(merged) !== stable(effective[key] ?? {})) { patch[key] = merged; effective[key] = merged; }
  };
  // Scope identities come from the verified document path, not a guessed legacy field.
  retain(kind === 'asset' ? 'assetId' : 'positionId', id);
  retain('householdId', options.householdId);
  if (legacy) {
    if (legacy.householdId !== undefined) requireValue(legacy.householdId === options.householdId, 'legacy.householdId');
    for (const field of ['aggregateVersion', 'schemaVersion']) retain(field, legacy[field]);
    retain('lifecycleState', lifecycle(legacy), (left, right) => lifecycle({ lifecycleState: left }) === right);
    // Preserve original Timestamp precision; never replace an existing date representation.
    for (const field of ['createdAt', 'updatedAt', 'deletedAt']) {
      if (canonical[field] === undefined && legacy[field] !== undefined) retain(field, legacy[field]);
    }
  }
  requireValue(effective.householdId === options.householdId, 'householdId');
  requireValue(positiveInteger(effective.aggregateVersion), 'aggregateVersion');
  requireValue(effective.schemaVersion === 1, 'schemaVersion');
  requireValue((kind === 'asset' ? ['active', 'deleted', 'purging'] : ['active', 'deleted']).includes(effective.lifecycleState), 'lifecycleState');
  for (const field of ['createdAt', 'updatedAt']) requireValue(validDate(effective[field]), field);
  if (effective.deletedAt !== undefined) {
    requireValue(validDate(effective.deletedAt), 'deletedAt');
    requireValue(effective.lifecycleState !== 'active', 'deletedAt.lifecycleState');
  }

  if (kind === 'asset') {
    if (legacy) {
      for (const field of ['name', 'type', 'currentBalance', 'costBasis', 'initialInvestment', 'quantity', 'stockCode', 'icon', 'color']) retain(field, legacy[field]);
      retain('currency', legacy.currency ?? 'KRW');
      retain('memo', legacy.memo ?? '');
      retain('order', legacy.order ?? 0);
      if (legacy.subType !== undefined && legacy.subType !== '') {
        requireValue(typeof legacy.subType === 'string', 'legacy.subType');
        const token = legacy.subType.trim().toLocaleLowerCase('ko-KR').replace(/\s+/gu, '');
        const normalized = subTypeAliases[token] ?? token;
        requireValue(subTypes[effective.type]?.includes(normalized), 'legacy.subType');
        retain('subType', normalized);
      }
      let owner = legacy.ownerRef;
      if (owner === undefined) {
        if (legacy.owner === undefined || legacy.owner === '' || legacy.owner === '가구') owner = { kind: 'household' };
        else {
          const matches = (options.ownerProfiles ?? []).filter(profile => profile.displayName === legacy.owner);
          requireValue(matches.length === 1, 'legacy.owner');
          owner = { kind: 'profile', profileId: matches[0].profileId };
        }
      }
      retain('ownerRef', owner);
      retainMap('automation', Object.fromEntries(automationFields.map(field => [field, legacy[field]])));
    }
    requireValue(nonempty(effective.name), 'name');
    requireValue(assetTypes.has(effective.type), 'type');
    requireValue(effective.currency === 'KRW' || effective.currency === 'USD', 'currency');
    requireValue(nonnegative(effective.currentBalance), 'currentBalance');
    requireValue(typeof effective.memo === 'string', 'memo');
    requireValue(Number.isSafeInteger(effective.order) && effective.order >= 0, 'order');
    if (effective.subType !== undefined) requireValue(subTypes[effective.type].includes(effective.subType), 'subType');
    const owner = effective.ownerRef;
    requireValue(isRecord(owner) && (owner.kind === 'household' || owner.kind === 'profile'), 'ownerRef');
    if (owner.kind === 'profile') requireValue(nonempty(owner.profileId)
      && options.ownerProfiles?.some(profile => profile.profileId === owner.profileId), 'ownerRef.profileId');
    for (const field of ['costBasis', 'initialInvestment', 'quantity']) {
      if (effective[field] !== undefined) requireValue(nonnegative(effective[field]), field);
    }
    for (const field of ['stockCode', 'icon', 'color']) {
      if (effective[field] !== undefined) requireValue(nonempty(effective[field]), field);
    }
    requireValue(isRecord(effective.automation), 'automation');
    for (const field of automationFields) {
      const value = effective.automation[field];
      if (value === undefined) continue;
      if (field.startsWith('lastAuto')) requireValue(value === '' || /^\d{4}-(0[1-9]|1[0-2])$/u.test(value), `automation.${field}`);
      else if (field === 'loanRepaymentMethod') requireValue(typeof value === 'string', `automation.${field}`);
      else if (field.endsWith('Day')) requireValue(Number.isSafeInteger(value) && value >= 0 && value <= 31, `automation.${field}`);
      else requireValue(nonnegative(value), `automation.${field}`);
    }
  } else {
    requireValue(nonempty(options.assetId), 'scope.assetId');
    retain('assetId', options.assetId);
    if (options.positionKind !== undefined) retain('positionKind', options.positionKind);
    if (legacy) {
      retain('assetId', legacy.assetId);
      const sourceKind = options.positionKind ?? legacy.positionKind ?? (nonempty(legacy.marketCode) ? 'crypto' : 'stock');
      retain('positionKind', sourceKind);
      const code = legacy.instrumentCode ?? (sourceKind === 'stock' ? legacy.stockCode : legacy.marketCode);
      if (nonempty(code)) retain('instrumentCode', code.toLocaleUpperCase('en-US'), sameCode);
      else if (sourceKind === 'stock' && ['cash', 'bond', 'manual'].includes(legacy.holdingType)) {
        retain('instrumentCode', `LEGACY:${legacy.holdingType.toUpperCase()}:${id}`, sameCode);
      } else fail('INVALID', 'legacy.instrumentCode');
      retain('instrumentName', legacy.instrumentName ?? (sourceKind === 'stock' ? legacy.stockName : legacy.coinName));
      for (const field of ['quantity', 'instrumentType', 'market', 'exchange', 'currency', 'holdingType', 'priceScale', 'quoteAsOf']) retain(field, legacy[field]);
      retain('averagePriceInWon', legacy.averagePriceInWon ?? legacy.avgPrice ?? 0);
      if (legacy.currentPrice !== undefined) {
        requireValue(nonnegative(legacy.currentPrice), 'legacy.currentPrice');
        // A measured zero is retained as a quote, never treated as an absent/failing quote.
        const quote = effective.lastQuote;
        retainMap('lastQuote', {
          priceInWon: legacy.currentPrice,
          ...(quote?.observedAt === undefined ? { observedAt: legacy.quoteAsOf ?? dateString(legacy.updatedAt) } : {}),
          ...(quote?.provider === undefined ? { provider: legacy.quoteProvider ?? 'legacy-observed' } : {}),
        });
      }
      if (legacy.quoteProvider !== undefined) retainMap('lastQuote', { provider: legacy.quoteProvider });
    }
    requireValue(['stock', 'crypto'].includes(effective.positionKind), 'positionKind');
    requireValue(nonempty(effective.instrumentCode), 'instrumentCode');
    requireValue(nonempty(effective.instrumentName), 'instrumentName');
    requireValue(instrumentTypes.has(effective.instrumentType), 'instrumentType');
    requireValue(markets.has(effective.market), 'market');
    if (effective.exchange !== undefined) requireValue(exchanges.has(effective.exchange), 'exchange');
    requireValue(effective.currency === 'USD' || effective.currency === 'KRW', 'currency');
    requireValue(nonnegative(effective.quantity), 'quantity');
    requireValue(nonnegative(effective.averagePriceInWon), 'averagePriceInWon');
    requireValue(typeof effective.priceScale === 'number' && Number.isFinite(effective.priceScale) && effective.priceScale >= 1, 'priceScale');
    if (effective.holdingType !== undefined) requireValue(['stock', 'bond', 'cash', 'manual'].includes(effective.holdingType), 'holdingType');
    if (effective.positionKind === 'crypto') requireValue(effective.instrumentType === 'crypto' && effective.market === 'UPBIT_KRW', 'crypto.instrument');
    else requireValue(effective.instrumentType !== 'crypto' && effective.market !== 'UPBIT_KRW', 'stock.instrument');
    retainMap('instrument', { market: effective.market, exchange: effective.exchange,
      instrumentType: effective.instrumentType.toLocaleUpperCase('en-US'), code: effective.instrumentCode,
      name: effective.instrumentName, currency: effective.currency, priceScale: effective.priceScale });
    if (effective.quoteAsOf !== undefined) requireValue(validDate(effective.quoteAsOf), 'quoteAsOf');
    if (effective.lastQuote !== undefined) {
      const quote = effective.lastQuote;
      requireValue(isRecord(quote) && nonnegative(quote.priceInWon), 'lastQuote.priceInWon');
      requireValue(typeof quote.observedAt === 'string' && validDate(quote.observedAt), 'lastQuote.observedAt');
      requireValue(nonempty(quote.provider), 'lastQuote.provider');
      if (quote.sourcePrice !== undefined) requireValue(nonnegative(quote.sourcePrice), 'lastQuote.sourcePrice');
      if (quote.sourceCurrency !== undefined) requireValue(quote.sourceCurrency === 'USD', 'lastQuote.sourceCurrency');
      for (const field of ['quoteObservedAt', 'exchangeRateObservedAt', 'exchangeRateDate']) {
        if (quote[field] !== undefined) requireValue(validDate(quote[field]), `lastQuote.${field}`);
      }
    }
  }
  return patch;
}
