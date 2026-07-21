import { isVisibleLedgerReadDocument } from '@/features/ledger/application/ledgerReadVisibility';

describe('Ledger Web read visibility 계약', () => {
  test.each([
    [{}, true],
    [{ lifecycleState: 'active' }, true],
    [{ lifecycleState: 'deleted' }, false],
    [{ deletedAt: '2026-07-22T00:00:00+09:00' }, false],
  ] as const)('레거시·활성 문서만 화면에 노출한다: %p', (document, expected) => {
    expect(isVisibleLedgerReadDocument(document)).toBe(expected);
  });
});
