import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 운영 ESM 순수 검증 도구입니다.
import { ledgerPatch, validateCanonicalLedgerDocument } from '../../scripts/storage-consolidation-ledger.mjs';
// @ts-expect-error 운영 ESM의 비공개 계획 파일 인코딩을 검증합니다.
import { encode, decode } from '../../scripts/consolidate-storage.mjs';

const context = { householdId: 'h', memberIds: new Set(['member']) };
const canonical = () => ({ householdId: 'h', accountingDate: '2026-09-18', localTime: '10:00', merchant: '가맹점',
  amountInWon: 1000, categoryId: 'food', memo: '', source: 'manual', transactionType: 'expense',
  creatorMemberId: 'member', aggregateVersion: 2, lifecycleState: 'active', cardDisplay: '수동', cardLastFour: '1234' });
describe('원장 단일 저장소 전환 사전검증', () => {
  it('JSON 계획 직렬화 후에도 Timestamp 나노초와 0원 값을 보존합니다', () => {
    const date = new Timestamp(1000, 123456789);
    const actual = decode(JSON.parse(JSON.stringify(encode({ date, amountInWon: 0 }))));
    expect(actual.date.isEqual(date)).toBe(true);
    expect(actual.amountInWon).toBe(0);
  });
  it('표시가 같은 카드 라벨과 끝번호의 과거 표현 차이는 덮어쓰지 않습니다', () => {
    const current = canonical();
    expect(ledgerPatch('a', { ...current, cardLastFour: '수동' }, current, context)).toEqual({});
    expect(() => ledgerPatch('a', { ...current, cardDisplay: '다른 카드' }, current, context)).toThrow('LEDGER_MISMATCH:cardDisplay');
  });
  it('분할 이력 누락만 보강하고 기존의 다른 구조를 덮지 않습니다', () => {
    const current = canonical();
    const source = { ...current, splitGroupId: 'g', splitIndex: 1, splitTotal: 3, splitOriginalId: 'original' };
    expect(ledgerPatch('a', source, current, context)).toMatchObject({ splitGroupId: 'g', splitTotal: 3, splitGroup: { originalId: 'original' } });
    expect(() => ledgerPatch('a', source, { ...current, splitGroup: { groupId: 'g', index: 1, total: 2, originalId: 'original' } }, context)).toThrow('LEDGER_MISMATCH:splitGroup');
  });
  it('과거 구성원과 날짜 없는 superseded 감사 문서를 보존하되 활성 거래의 날짜 누락은 거절합니다', () => {
    expect(() => validateCanonicalLedgerDocument('a', { ...canonical(), creatorMemberId: 'former-member' }, context)).not.toThrow();
    expect(() => validateCanonicalLedgerDocument('a', { ...canonical(), accountingDate: '', lifecycleState: 'superseded' }, context)).not.toThrow();
    expect(() => validateCanonicalLedgerDocument('a', { ...canonical(), accountingDate: '' }, context)).toThrow('LEDGER_INVALID:accountingDate');
  });
  it.each(['amountInWon', 'categoryId', 'memo', 'aggregateVersion', 'creatorMemberId'])('%s 불일치는 쓰기 계획 전에 거절합니다', field => {
    const old = { ...canonical(), [field]: field === 'amountInWon' || field === 'aggregateVersion' ? 3 : 'other' };
    expect(() => ledgerPatch('a', old, canonical(), context)).toThrow(`LEDGER_MISMATCH:${field}`);
  });
});
