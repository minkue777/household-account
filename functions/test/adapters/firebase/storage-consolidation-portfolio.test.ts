import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

const modulePath = '../../../scripts/storage-consolidation-portfolio.mjs';
const { validatePortfolioDocument: validate } = await import(modulePath);
const at = '2026-09-18T00:00:00.000Z';
const options = { householdId: 'home', ownerProfiles: [{ profileId: 'child', displayName: '아이' }] };
const positionOptions = { ...options, assetId: 'account', positionKind: 'stock' };
const canonicalAsset = (): Record<string, unknown> => ({
  assetId: 'account', householdId: 'home', name: '적금', type: 'savings', subType: 'installment',
  ownerRef: { kind: 'profile', profileId: 'child' }, currentBalance: 100, costBasis: 80,
  currency: 'KRW', memo: '메모', order: 1, automation: { recurringContributionAmount: 10, recurringContributionDay: 3 },
  lifecycleState: 'active', aggregateVersion: 2, schemaVersion: 1, createdAt: at, updatedAt: at,
});
const legacyAsset = (): Record<string, unknown> => ({
  householdId: 'home', name: '적금', type: 'savings', subType: '적금', owner: '아이',
  currentBalance: 100, costBasis: 80, currency: 'KRW', memo: '메모', order: 1,
  recurringContributionAmount: 10, recurringContributionDay: 3, isActive: true,
  aggregateVersion: 2, schemaVersion: 1, createdAt: at, updatedAt: at,
});
const canonicalPosition = (): Record<string, unknown> => ({
  positionId: 'holding', householdId: 'home', assetId: 'account', positionKind: 'stock',
  instrumentCode: 'TEST', instrumentName: '종목', instrumentType: 'etf', market: 'KRX', exchange: 'KOSPI',
  currency: 'KRW', holdingType: 'stock', quantity: 3, averagePriceInWon: 50, priceScale: 1,
  instrument: { code: 'TEST', name: '종목', instrumentType: 'ETF', market: 'KRX', exchange: 'KOSPI', currency: 'KRW', priceScale: 1 },
  lastQuote: { priceInWon: 70, observedAt: at, provider: 'market', quoteProvider: 'krx' }, quoteAsOf: at,
  lifecycleState: 'active', aggregateVersion: 2, schemaVersion: 1, createdAt: at, updatedAt: at,
});
const legacyPosition = (): Record<string, unknown> => ({
  householdId: 'home', assetId: 'account', stockCode: 'TEST', stockName: '종목', instrumentType: 'etf',
  market: 'KRX', exchange: 'KOSPI', currency: 'KRW', holdingType: 'stock', quantity: 3, avgPrice: 50,
  currentPrice: 70, priceScale: 1, quoteAsOf: at, aggregateVersion: 2, schemaVersion: 1,
  createdAt: at, updatedAt: at,
});

describe('Portfolio 저장 통합 운영 검증', () => {
  it('명의자와 한글 subtype을 보존하고 이미 일치하는 canonical은 쓰지 않습니다', () => {
    expect(validate('asset', 'account', legacyAsset(), canonicalAsset(), options)).toEqual({});
    expect(validate('position', 'holding', legacyPosition(), canonicalPosition(), positionOptions)).toEqual({});
  });

  it('누락된 선택 정보와 automation map 키만 채우며 추가 키와 Timestamp 정밀도를 보존합니다', () => {
    const stamp = new Timestamp(12345, 678901234);
    const source = { ...legacyAsset(), color: '#abc', initialInvestment: 50, lastAutoContributionMonth: '2026-08', createdAt: stamp };
    const current = canonicalAsset();
    delete current.createdAt;
    current.automation = { recurringContributionAmount: 10, extra: 'keep' };
    const patch = validate('asset', 'account', source, current, options);
    expect(patch).toEqual({ createdAt: stamp, color: '#abc', initialInvestment: 50,
      automation: { recurringContributionAmount: 10, recurringContributionDay: 3, lastAutoContributionMonth: '2026-08', extra: 'keep' } });
    expect(patch.createdAt).toBe(stamp);
    expect(current).not.toHaveProperty('color');
    expect(validate('asset', 'account', source, { ...current, ...patch }, options)).toEqual({});
  });

  it.each(['currentBalance', 'costBasis', 'memo', 'order', 'aggregateVersion', 'currency', 'color', 'initialInvestment'])('%s 충돌을 덮어쓰지 않습니다', field => {
    const source = { ...legacyAsset(), color: '#abc', initialInvestment: 50 };
    const current = { ...canonicalAsset(), color: '#abc', initialInvestment: 50 };
    (current as Record<string, unknown>)[field] = typeof current[field as keyof typeof current] === 'string' ? 'different' : 999;
    expect(() => validate('asset', 'account', source, current, options)).toThrow(`ASSET_MISMATCH:${field}`);
  });

  it('ownerRef/subtype/자동화 충돌과 동명이인 추측을 거부합니다', () => {
    expect(() => validate('asset', 'account', legacyAsset(), { ...canonicalAsset(), ownerRef: { kind: 'household' } }, options)).toThrow('ASSET_MISMATCH:ownerRef');
    expect(() => validate('asset', 'account', legacyAsset(), { ...canonicalAsset(), subType: 'deposit' }, options)).toThrow('ASSET_MISMATCH:subType');
    expect(() => validate('asset', 'account', legacyAsset(), { ...canonicalAsset(), automation: { recurringContributionAmount: 20 } }, options)).toThrow('ASSET_MISMATCH:automation.recurringContributionAmount');
    expect(() => validate('asset', 'account', legacyAsset(), canonicalAsset(), { ...options, ownerProfiles: [...options.ownerProfiles, { profileId: 'other', displayName: '아이' }] })).toThrow('ASSET_INVALID:legacy.owner');
  });

  it('명시 ownerRef가 있으면 이름 변경에도 같은 프로필을 보존합니다', () => {
    const source = { ...legacyAsset(), ownerRef: { kind: 'profile', profileId: 'child' } };
    expect(validate('asset', 'account', source, canonicalAsset(), { ...options, ownerProfiles: [{ profileId: 'child', displayName: '변경한 이름' }] })).toEqual({});
  });

  it.each(['positionKind', 'instrumentCode', 'instrumentName', 'instrumentType', 'market', 'exchange', 'currency', 'holdingType', 'quantity', 'averagePriceInWon', 'priceScale', 'quoteAsOf', 'aggregateVersion'])('position %s 충돌을 거부합니다', field => {
    const current = canonicalPosition();
    current[field] = typeof current[field] === 'number' ? 999 : 'different';
    expect(() => validate('position', 'holding', legacyPosition(), current, positionOptions)).toThrow(`POSITION_MISMATCH:${field}`);
  });

  it('현재가 0도 quote로 복원하고 기존 공급자 provenance는 덮어쓰지 않습니다', () => {
    const source = { ...legacyPosition(), currentPrice: 0 };
    const current = canonicalPosition();
    delete current.lastQuote;
    const patch = validate('position', 'holding', source, current, positionOptions);
    expect(patch).toEqual({ lastQuote: { priceInWon: 0, observedAt: at, provider: 'legacy-observed' } });
    expect(validate('position', 'holding', source, { ...current, ...patch }, positionOptions)).toEqual({});
    expect(() => validate('position', 'holding', source, canonicalPosition(), positionOptions)).toThrow('POSITION_MISMATCH:lastQuote.priceInWon');
  });

  it('현금의 이관된 synthetic code를 검증합니다', () => {
    const source = { ...legacyPosition(), stockCode: '', holdingType: 'cash', instrumentType: 'cash' };
    const current = { ...canonicalPosition(), instrumentCode: 'LEGACY:CASH:holding', holdingType: 'cash', instrumentType: 'cash',
      instrument: { code: 'LEGACY:CASH:holding', name: '종목', instrumentType: 'CASH', market: 'KRX', exchange: 'KOSPI', currency: 'KRW', priceScale: 1 } };
    expect(validate('position', 'holding', source, current, positionOptions)).toEqual({});
  });

  it('canonical-only도 필수 query 필드와 UI 필드 및 가구/부모 범위를 검사합니다', () => {
    expect(validate('asset', 'account', undefined, canonicalAsset(), options)).toEqual({});
    expect(validate('position', 'holding', undefined, canonicalPosition(), positionOptions)).toEqual({});
    const current = canonicalPosition();
    delete current.positionKind;
    expect(() => validate('position', 'holding', undefined, current, { ...positionOptions, positionKind: undefined })).toThrow('POSITION_INVALID:positionKind');
    expect(() => validate('position', 'holding', undefined, { ...current, positionKind: 'stock', averagePriceInWon: undefined }, positionOptions)).toThrow('POSITION_INVALID:averagePriceInWon');
    expect(() => validate('position', 'holding', undefined, canonicalPosition(), { ...positionOptions, householdId: 'foreign' })).toThrow('POSITION_MISMATCH:householdId');
    expect(() => validate('position', 'holding', undefined, canonicalPosition(), { ...positionOptions, assetId: 'foreign' })).toThrow('POSITION_MISMATCH:assetId');
  });

  it('중첩 instrument를 누락분만 보강하며 식별자 불일치와 잘못된 quote를 거부합니다', () => {
    const current = canonicalPosition();
    current.instrument = { market: 'KRX', extra: 'keep' };
    expect(validate('position', 'holding', undefined, current, positionOptions)).toEqual({ instrument: { ...(canonicalPosition().instrument as object), extra: 'keep' } });
    expect(() => validate('position', 'holding', undefined, { ...current, instrument: { code: 'OTHER' } }, positionOptions)).toThrow('POSITION_MISMATCH:instrument.code');
    expect(() => validate('position', 'holding', undefined, { ...current, lastQuote: { priceInWon: 0 } }, positionOptions)).toThrow('POSITION_INVALID:lastQuote.observedAt');
  });

  it('삭제된 canonical-only position을 유지하고 active와 deletedAt 불일치는 차단합니다', () => {
    expect(validate('position', 'holding', undefined, { ...canonicalPosition(), lifecycleState: 'deleted' }, positionOptions)).toEqual({});
    expect(() => validate('asset', 'account', undefined, { ...canonicalAsset(), deletedAt: at }, options)).toThrow('ASSET_INVALID:deletedAt.lifecycleState');
    expect(validate('asset', 'account', { ...legacyAsset(), isActive: false }, { ...canonicalAsset(), lifecycleState: 'purging', deletedAt: at }, options)).toEqual({});
  });
});
