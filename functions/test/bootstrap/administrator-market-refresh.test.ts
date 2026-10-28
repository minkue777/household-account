import type * as firestore from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { FirebaseHouseholdCommandMembershipAdapter, FirebaseHouseholdCommandReceiptAdapter, Sha256HouseholdCommandHashAdapter } from '../../src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure';
import { createHouseholdCommandRouter } from '../../src/bootstrap/commands/householdCommandRouter';
import { createPortfolioHouseholdCommandHandlers } from '../../src/bootstrap/commands/portfolioHouseholdCommandHandlers';
import { verifiedSystemAdministrator } from '../../src/bootstrap/verifiedSystemAdministrator';
import { InMemoryFirestore } from '../support/in-memory-firestore';

function setup(lifecycleState = 'active') {
  const memory = new InMemoryFirestore();
  const database = memory as unknown as firestore.Firestore;
  memory.seed('households/target', { lifecycleState });
  memory.seed('households/target/assets/stock', {
    householdId: 'target', name: '주식계좌', type: 'stock', ownerRef: { kind: 'household' },
    currency: 'KRW', currentBalance: 1000, memo: '보존', lifecycleState: 'active', order: 0, aggregateVersion: 1,
  });
  memory.seed('households/target/assets/stock/positions/holding', {
    householdId: 'target', assetId: 'stock', positionKind: 'stock', holdingType: 'stock',
    instrumentCode: '005930', instrumentName: '삼성전자', instrumentType: 'stock', market: 'KRX',
    lifecycleState: 'active', quantity: 2, purchasePrice: 400,
    lastQuote: { priceInWon: 500, observedAt: '2026-10-27T00:00:00Z', provider: 'naver' }, aggregateVersion: 1,
  });
  const getQuote = vi.fn(async () => ({ kind: 'success' as const, quote: { priceInWon: 700, observedAt: '2026-10-28T00:00:00Z', provider: 'naver' } }));
  const handlers = createPortfolioHouseholdCommandHandlers(database, { getQuote });
  const router = createHouseholdCommandRouter({ handlers,
    memberships: new FirebaseHouseholdCommandMembershipAdapter(database),
    receipts: new FirebaseHouseholdCommandReceiptAdapter(database), hashes: new Sha256HouseholdCommandHashAdapter(),
  });
  const input = { principalUid: 'admin', administrator: verifiedSystemAdministrator('admin', { systemAdmin: true }),
    requestedAt: '2026-10-28T00:00:00Z', request: {
      contractVersion: 'household-command.v1', commandId: 'refresh', idempotencyKey: 'refresh',
      householdId: 'target', command: 'portfolio.refresh-market-values.v1', payload: { assetClass: 'all' },
    },
  };
  return { memory, handlers, router, input, getQuote };
}

describe('[ADM-004][T-ADM-003][JOB-AST-001] 관리자 시세 갱신', () => {
  it('일반 회원은 관리자 claim 없이 기존 Membership으로 시세를 갱신한다', async () => {
    const f = setup();
    f.memory.seed('households/target/memberships/member', {
      householdId: 'target', memberId: 'member', lifecycleState: 'active', capabilities: ['portfolio.asset.write'],
    });
    await expect(f.router.execute({ ...f.input, principalUid: 'member', administrator: undefined }))
      .resolves.toMatchObject({ kind: 'success', data: { refreshedCount: 1 } });
    expect(f.memory.document('households/target/assets/stock')?.currentBalance).toBe(1400);
  });

  it('Membership 없는 관리자의 실제 시세·평가액 저장은 수량·메모를 보존하고 같은 요청은 재실행하지 않는다', async () => {
    const f = setup();
    await expect(f.router.execute(f.input)).resolves.toMatchObject({ kind: 'success', data: { refreshedCount: 1, failedCount: 0 } });
    expect(f.memory.document('households/target/assets/stock')).toMatchObject({ currentBalance: 1400, memo: '보존', aggregateVersion: 2 });
    expect(f.memory.document('households/target/assets/stock/positions/holding')).toMatchObject({ quantity: 2, lastQuote: { priceInWon: 700 }, aggregateVersion: 2 });
    expect(f.memory.document('households/target/memberships/admin')).toBeUndefined();
    const receipts = await f.memory.collection('commandReceipts/portfolio/receipts').get();
    expect(receipts.docs.map(doc => doc.data())).toContainEqual(expect.objectContaining({ principalUid: 'admin', actorMemberId: 'administrator:admin' }));
    await expect(f.router.execute(f.input)).resolves.toMatchObject({ kind: 'success', replayed: true });
    expect(f.getQuote).toHaveBeenCalledTimes(1);
    await expect(f.router.execute({ ...f.input, request: { ...f.input.request, commandId: 'again', idempotencyKey: 'again' } }))
      .resolves.toMatchObject({ kind: 'error', details: { domainCode: 'MARKET_REFRESH_RATE_LIMITED' } });
  });

  it.each(['deleted', 'purging'])('비활성 가구 %s에는 시세 요청이나 자산 쓰기를 하지 않는다', async state => {
    const f = setup(state);
    await expect(f.router.execute(f.input)).resolves.toMatchObject({ kind: 'error', details: { domainCode: 'HOUSEHOLD_NOT_ACTIVE' } });
    expect(f.getQuote).not.toHaveBeenCalled();
    expect(f.memory.document('households/target/assets/stock')?.currentBalance).toBe(1000);
  });

  it('일반 비회원·위조 principal·읽기 capability만 있는 관리자는 갱신할 수 없다', async () => {
    const f = setup();
    for (const administrator of [undefined, { principalRef: 'other', capabilities: ['portfolio.market.refresh'] as const }]) {
      await expect(f.router.execute({ ...f.input, administrator })).resolves.toMatchObject({ kind: 'error', code: 'HOUSEHOLD_FORBIDDEN' });
    }
    await expect(f.router.execute({ ...f.input, administrator: { principalRef: 'admin', capabilities: ['admin.household-data.read'] } }))
      .resolves.toMatchObject({ kind: 'error', details: { domainCode: 'HOUSEHOLD_FORBIDDEN' } });
    expect(f.getQuote).not.toHaveBeenCalled();
  });

  it('시세 명령만 관리자 예외이며 자산 삭제·임의 payload는 계속 거부한다', async () => {
    const f = setup();
    expect([...f.handlers.entries()].filter(([, handler]) => handler.permitsAdministrator).map(([name]) => name))
      .toEqual(['portfolio.refresh-market-values.v1']);
    await expect(f.router.execute({ ...f.input, request: { ...f.input.request, command: 'portfolio.delete-asset.v1', payload: { assetId: 'stock', expectedVersion: 1 } } }))
      .resolves.toMatchObject({ kind: 'error', code: 'HOUSEHOLD_FORBIDDEN' });
    await expect(f.router.execute({ ...f.input, request: { ...f.input.request, payload: { assetClass: 'all', currentBalance: 0 } } }))
      .resolves.toMatchObject({ kind: 'error', details: { domainCode: 'INVALID_PAYLOAD' } });
    expect(f.getQuote).not.toHaveBeenCalled();
  });
});
