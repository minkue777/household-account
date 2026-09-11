import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createHouseholdThroughUi, resetTestAccount, callEmulatorFunction } from './emulator';
import { paymentCommand, records } from './payment-helpers';

test.beforeEach(resetTestAccount);

test('[T-SYS-007][SYS-007] 실제 HTTP 동시 Command는 거래·receipt·Outbox 한 세트만 확정하고 payload 충돌은 원본을 보존한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const commandId = `atomic-e2e-${randomUUID()}`;
  const payload = { transactionType: 'expense', merchant: '멱등 검증 카페', amountInWon: 7200,
    categoryId: 'etc', accountingDate: '2026-09-11', memo: '첫 요청' };
  const beforeEvents = new Set((await records(request, 'outboxEvents')).map(row => row.id));
  const [first, concurrent] = await Promise.all([
    paymentCommand(request, actor, 'ledger.record-manual-transaction.v1', payload, commandId),
    paymentCommand(request, actor, 'ledger.record-manual-transaction.v1', payload, commandId),
  ]);
  expect(concurrent).toEqual(first);
  const canonicalPath = `households/${actor.householdId}/ledgerTransactions`;
  const receiptPath = 'commandReceipts/household-finance-ledger/receipts';
  const canonical = await records(request, canonicalPath);
  expect(canonical).toHaveLength(1);
  expect(canonical[0]).toMatchObject({ amountInWon: 7200, memo: '첫 요청' });
  expect(await records(request, 'expenses')).toHaveLength(1);
  const receipts = await records(request, receiptPath);
  expect(receipts).toHaveLength(1);
  const eventIds = (await records(request, 'outboxEvents')).map(row => row.id).filter(id => !beforeEvents.has(id));
  expect(eventIds).toHaveLength(1);
  await expect(paymentCommand(request, actor, 'ledger.record-manual-transaction.v1', payload, commandId)).resolves.toEqual(first);
  await expect(paymentCommand(request, actor, 'ledger.record-manual-transaction.v1', { ...payload, amountInWon: 9900 }, commandId)).rejects.toThrow(/IDEMPOTENCY.*MISMATCH/);
  expect(await records(request, canonicalPath)).toEqual(canonical);
  expect(await records(request, receiptPath)).toEqual(receipts);
  expect((await records(request, 'outboxEvents')).map(row => row.id).filter(id => !beforeEvents.has(id))).toEqual(eventIds);
});

test('[T-SEC-002][T-HH-SEC-001][SYS-001][SYS-007] 무인증 공개 callable은 이름 수정·endpoint 등록·관리자 조회 전에 거절하고 기존 가구를 보존한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const before = await records(request, `households/${actor.householdId}/members`);
  for (const [command, payload] of [
    ['access.rename-self.v1', { displayName: '위조 이름', expectedVersion: 1 }],
    ['notifications.register-endpoint.v1', { fid: 'unauthorized-fid', platform: 'android', deviceInfo: { model: 'E2E' } }],
  ] as const) {
    const commandId = `unauthenticated-e2e-${randomUUID()}`;
    const response = await callEmulatorFunction<any>(request, 'executeHouseholdCommand', {
      contractVersion: 'household-command.v1', householdId: actor.householdId,
      commandId, idempotencyKey: commandId, command, payload,
    });
    expect(response.result).toMatchObject({ kind: 'rejected', error: { code: 'AUTH_REQUIRED', retryable: false } });
  }
  const adminResponse = await callEmulatorFunction<any>(request, 'executeAdminAccess', {
    contractVersion: 'admin-access.v1', requestId: 'unauthorized-admin-e2e', idempotencyKey: 'unauthorized-admin-e2e',
    operation: 'list-deleted-assets', payload: { householdId: actor.householdId },
  });
  expect(adminResponse.result).toMatchObject({ kind: 'rejected', error: { code: 'AUTH_REQUIRED', retryable: false } });
  expect(await records(request, `households/${actor.householdId}/members`)).toEqual(before);
  expect(await records(request, 'expenses')).toHaveLength(0);
});
