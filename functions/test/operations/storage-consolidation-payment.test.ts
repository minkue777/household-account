import { describe, expect, it } from 'vitest';
// @ts-expect-error 운영용 ESM 순수 검증 스크립트는 별도 declaration을 배포하지 않습니다.
import { paymentConfigurationPatch, validateCanonicalPaymentDocument } from '../../scripts/storage-consolidation-payment.mjs';

const context = { householdId: 'house', memberIds: new Set(['member']), memberIdByAlias: new Map([['망고', 'member']]) };
const card = () => ({ householdId: 'house', cardId: 'card', ownerMemberId: 'member', cardCompanyCode: '세종지역화폐', lastFour: '1234', order: 2, lifecycle: 'active', aggregateVersion: 4 });
const legacyCard = () => ({ householdId: 'house', owner: '망고', cardLabel: '여민전', cardLastFour: '12-34', orderIndex: 2, aggregateVersion: 4 });
const rule = () => ({ householdId: 'house', ruleId: 'rule', keyword: ' CAFE , 커피 ', normalizedKeywords: ['cafe', '커피'], matchType: 'exact', mapping: { categoryId: 'food', memo: '원두' }, active: false, aggregateVersion: 3 });
const legacyRule = () => ({ householdId: 'house', merchantKeyword: 'cafe,커피', exactMatch: true, category: 'food', mapping: { memo: '원두' }, active: false, priority: 99, aggregateVersion: 3 });

describe('카드·규칙 저장소 통합 운영 사전 검증', () => {
  it('검증된 member 별칭과 카드사·끝 번호 정규화가 같은 경우 원본 변경을 계획하지 않는다', () => {
    const source = legacyCard();
    const current = card();
    const before = structuredClone([source, current]);
    expect(paymentConfigurationPatch('card', 'card', source, current, context)).toEqual({});
    expect([source, current]).toEqual(before);
  });

  it.each(['ownerMemberId', 'lastFour', 'order', 'aggregateVersion', 'lifecycle'])('카드 업무값 %s 불일치에는 덮어쓰지 않는다', field => {
    const values: Record<string, unknown> = { ownerMemberId: 'other-member', lastFour: '5678', order: 3, aggregateVersion: 5, lifecycle: 'retired' };
    expect(() => paymentConfigurationPatch('card', 'card', legacyCard(), { ...card(), [field]: values[field] },
      { ...context, memberIds: new Set(['member', 'other-member']) })).toThrow(`CARD_MISMATCH:${field}`);
  });

  it('표시 이름이 중복되거나 확인되지 않은 소유자는 임의 매핑하지 않는다', () => {
    expect(() => paymentConfigurationPatch('card', 'card', legacyCard(), card(), { ...context, memberIdByAlias: new Map() }))
      .toThrow('CARD_UNRESOLVED:ownerMemberId');
  });

  it('[T-MER-002][MER-006] exactMatch/category와 비활성 상태를 실제 이관 사전검증으로 대조한다', () => {
    expect(paymentConfigurationPatch('rule', 'rule', legacyRule(), rule(), context)).toEqual({});
    expect(() => paymentConfigurationPatch('rule', 'rule', legacyRule(), { ...rule(), active: true }, context)).toThrow('RULE_MISMATCH:active');
    expect(() => paymentConfigurationPatch('rule', 'rule', legacyRule(), { ...rule(), mapping: { categoryId: 'etc', memo: '원두' } }, context)).toThrow('RULE_MISMATCH:mapping');
  });

  it('non-exact priority는 보존하고 exact의 사용하지 않는 옛 priority만 무시한다', () => {
    const source = { ...legacyRule(), matchType: 'contains', priority: 10 };
    const current = { ...rule(), matchType: 'contains', priority: 10 };
    expect(paymentConfigurationPatch('rule', 'rule', source, current, context)).toEqual({});
    expect(() => paymentConfigurationPatch('rule', 'rule', source, { ...current, priority: 20 }, context)).toThrow('RULE_MISMATCH:priority');
  });

  it.each([undefined, 0])('이전 manifest 이관이 보충한 priority는 원본 %s와 재비교해 지우지 않는다', priority => {
    const source = { ...legacyRule(), matchType: 'contains', exactMatch: true, priority };
    const current = { ...rule(), matchType: 'contains', priority: 8 };
    expect(paymentConfigurationPatch('rule', 'rule', source, current, context)).toEqual({});
    expect(() => paymentConfigurationPatch('rule', 'rule', source, { ...current, priority: 0 }, context))
      .toThrow('RULE_INVALID:priority');
    expect(() => paymentConfigurationPatch('rule', 'rule', source, { ...current, matchType: 'exact' }, context))
      .toThrow('RULE_INVALID:priority');
  });

  it.each([
    { patch: { merchantKeyword: ' ' }, code: 'RULE_INVALID:keyword' },
    { patch: { merchantKeyword: 'shop,' }, code: 'RULE_EMPTY_OR_TOKEN:keyword' },
    { patch: { category: 42 }, code: 'RULE_INVALID:mapping.categoryId' },
    { patch: { matchType: 'contains', priority: 1.5 }, code: 'RULE_INVALID:priority' },
    { patch: { matchType: 'contains', priority: -1 }, code: 'RULE_INVALID:priority' },
    { patch: { matchType: 'regex' }, code: 'RULE_INVALID:matchType' },
  ])('[T-MER-002][MER-006] $code 구형 문서는 이관 중 임의 보정하지 않는다', ({ patch, code }) => {
    expect(() => paymentConfigurationPatch('rule', 'rule', { ...legacyRule(), ...patch }, rule(), context)).toThrow(code);
  });

  it('대응 legacy가 없는 canonical-only 문서도 필드와 소유 범위를 검증한다', () => {
    expect(validateCanonicalPaymentDocument('card', 'card', card(), context)).toMatchObject({ ownerMemberId: 'member' });
    expect(validateCanonicalPaymentDocument('rule', 'rule', rule(), context)).toMatchObject({ active: false });
    expect(() => validateCanonicalPaymentDocument('card', 'card', { ...card(), householdId: 'other-house' }, context)).toThrow('CARD_MISMATCH:householdId');
    expect(() => validateCanonicalPaymentDocument('rule', 'rule', { ...rule(), normalizedKeywords: ['wrong'] }, context)).toThrow('RULE_INVALID:normalizedKeywords');
    expect(() => validateCanonicalPaymentDocument('rule', 'rule', { ...rule(), mapping: { category: 'food' } }, context)).toThrow('RULE_NOT_CANONICAL:mapping.category');
  });
});
