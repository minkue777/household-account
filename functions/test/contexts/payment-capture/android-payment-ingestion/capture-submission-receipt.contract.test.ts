import { describe, expect, it, vi } from "vitest";
import { createCaptureSubmissionApplication } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication";
import { createCaptureBranchSubmissionApplication } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import type { CaptureTransactionGatewayPort } from "../../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureTransactionGatewayPort";
import type { BalanceObservationIntakeInputPort } from "../../../../src/contexts/household-finance/local-currency/public";
import { Sha256CapturePayloadFingerprint } from "../../../../src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore";
import { InMemoryCaptureSubmissionReceiptStore } from "../../../support/capture-branch-receipt-fixture";
import { paymentCommand } from "../../../support/capture-submission-command";
import { balanceOnlyEnvelope, combinedEnvelope } from "../../../support/capture-branch-envelopes";

function setup() {
  const receipts = new InMemoryCaptureSubmissionReceiptStore();
  // These are downstream responses, not a second ledger or balance implementation.
  const transaction = vi.fn<CaptureTransactionGatewayPort['record']>().mockResolvedValue({ kind: 'recorded', transactionId: 'transaction', captureLineageId: 'lineage', editable: true, aggregateVersion: 1 });
  const balance = vi.fn<BalanceObservationIntakeInputPort['recordBalanceObservation']>().mockResolvedValue({ kind: 'success', status: 'created', balanceId: 'gyeonggi', balanceVersion: 1 });
  const branches = createCaptureBranchSubmissionApplication({ receipts, payloads: new Sha256CapturePayloadFingerprint(), transactions: { record: transaction }, balances: { recordBalanceObservation: balance } });
  return { receipts, transaction, balance, branches, application: createCaptureSubmissionApplication({ branches }) };
}

describe('실제 Capture 조율과 downstream 호출 계약', () => {
  it('[T-ING-AUTH-001][ING-SAVE-001] 권한 없는 제출은 receipt나 downstream을 호출하지 않는다', async () => {
    const subject = setup();
    const command = paymentCommand({ rootIdempotencyKey: 'forbidden', originChannel: 'android-notification' });
    expect(await subject.application.submit({ ...command, actor: { ...command.actor, capabilities: [] } })).toEqual({ kind: 'Forbidden', code: 'CAPABILITY_REQUIRED' });
    expect(subject.receipts.list()).toEqual([]);
    expect(subject.transaction).not.toHaveBeenCalled();
    expect(subject.balance).not.toHaveBeenCalled();
  });

  it('Android payment-only는 Ledger의 원자 receipt에 위임하고 외부 receipt를 중복 저장하지 않는다', async () => {
    const subject = setup();
    const command = paymentCommand({ rootIdempotencyKey: 'single', originChannel: 'android-notification' });
    expect(await subject.application.submit(command)).toMatchObject({ kind: 'success', value: { transactionResult: { kind: 'created', transactionId: 'transaction' } } });
    expect(subject.transaction).toHaveBeenCalledTimes(1);
    expect(subject.transaction.mock.calls[0][0]).toMatchObject({ householdId: 'household-1', branch: { amountInWon: 12000, merchant: '가맹점 A' } });
    expect(subject.receipts.list()).toEqual([]);
    expect(subject.receipts.saveCount()).toBe(0);
  });

  it('[T-BAL-008][T-ING-BAL-001][BAL-005] 잔액만 있는 입력은 Ledger를 부르지 않고 원 관찰값과 actor를 전달한다', async () => {
    const subject = setup();
    const first = await subject.branches.submit(balanceOnlyEnvelope);
    expect(await subject.branches.submit(balanceOnlyEnvelope)).toEqual(first);
    expect(subject.transaction).not.toHaveBeenCalled();
    expect(subject.balance).toHaveBeenCalledExactlyOnceWith({ householdId: 'house-1', kind: 'system', capabilities: ['local-currency.record'] }, balanceOnlyEnvelope.balanceBranch.observation);
    expect(subject.receipts.list()[0]).toMatchObject({ state: 'completed', transaction: { stage: 'absent' }, balance: { stage: 'terminal' } });
  });

  it('[T-BAL-008][T-ING-BAL-001][BAL-005] 거래가 거부돼도 잔액은 독립 성공하고 terminal 재전송은 어느 쪽도 다시 호출하지 않는다', async () => {
    const subject = setup();
    subject.transaction.mockResolvedValue({ kind: 'rejected', code: 'CARD_NOT_REGISTERED_FOR_ACTOR' });
    const first = await subject.branches.submit(combinedEnvelope);
    expect(subject.receipts.list()[0]).toMatchObject({ state: 'completed', transaction: { stage: 'terminal', result: { kind: 'rejected' } }, balance: { stage: 'terminal', result: { kind: 'recorded' } } });
    expect(await subject.branches.submit(combinedEnvelope)).toEqual(first);
    expect(subject.transaction).toHaveBeenCalledTimes(1);
    expect(subject.balance).toHaveBeenCalledTimes(1);
  });

  it.each(['transaction', 'balance'] as const)('[T-IOS-001][T-BAL-008][T-ING-BAL-001][ING-009] %s만 실패하면 같은 payload 재시도에서 그 branch만 다시 호출한다', async branch => {
    const subject = setup();
    if (branch === 'transaction') subject.transaction.mockResolvedValueOnce({ kind: 'retryable-failure', code: 'LEDGER_UNAVAILABLE' });
    else subject.balance.mockRejectedValueOnce(new Error('balance unavailable'));
    await subject.branches.submit(combinedEnvelope);
    const before = subject.receipts.list()[0];
    expect(before.state).toBe('partial-retryable');
    expect(before[branch].stage).toBe('retryable');
    const completeBranch = branch === 'transaction' ? 'balance' : 'transaction';
    expect(before[completeBranch].stage).toBe('terminal');
    // A conflicting retry must not invoke either downstream or change the receipt.
    expect(await subject.branches.submit({ ...combinedEnvelope, transactionBranch: { ...combinedEnvelope.transactionBranch, amountInWon: 99999 } })).toEqual({ kind: 'conflict', code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect(subject.receipts.list()).toEqual([before]);
    expect(subject.transaction).toHaveBeenCalledTimes(1);
    expect(subject.balance).toHaveBeenCalledTimes(1);
    const completed = await subject.branches.submit(combinedEnvelope);
    expect(subject.receipts.list()[0]).toMatchObject({ state: 'completed', [completeBranch]: before[completeBranch] });
    expect(subject[branch]).toHaveBeenCalledTimes(2);
    expect(subject[completeBranch]).toHaveBeenCalledTimes(1);
    expect(subject[branch].mock.calls[1]).toEqual(subject[branch].mock.calls[0]);
    expect(await subject.branches.submit(combinedEnvelope)).toEqual(completed);
    expect(subject[branch]).toHaveBeenCalledTimes(2);
    expect(subject[completeBranch]).toHaveBeenCalledTimes(1);
  });
});
