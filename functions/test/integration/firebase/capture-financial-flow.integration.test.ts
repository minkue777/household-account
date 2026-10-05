import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptureSubmissionApplication } from '../../../src/contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication';
import { createCaptureBranchSubmissionApplication } from '../../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication';
import { createCaptureTransactionGatewayApplication } from '../../../src/contexts/payment-capture/android-payment-ingestion/application/captureTransactionGatewayApplication';
import { FirebaseCaptureLedgerPersistence } from '../../../src/adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence';
import { FirebaseCaptureSubmissionReceiptStore, Sha256CapturePayloadFingerprint } from '../../../src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore';
import { FirebaseLocalCurrencyBalanceStore } from '../../../src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore';
import { createLocalCurrencyBalanceApplication } from '../../../src/contexts/household-finance/local-currency/application/localCurrencyBalanceApplication';
import { createBalanceObservationIntakeApplication } from '../../../src/contexts/household-finance/local-currency/application/balanceObservationIntakeApplication';
import { approvalCommand, cancellationCommand } from '../../support/capture-submission-command';

const projectId = 'demo-household-capture-financial-flow';
const emulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
emulator('실제 SDK Capture와 원장·잔액·Outbox', () => {
  let app: App;
  let db: Firestore;
  beforeAll(() => { app = initializeApp({ projectId }, `capture-flow-${Date.now()}`); db = getFirestore(app); });
  beforeEach(async () => {
    const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!cleared.ok) throw new Error('EMULATOR_RESET_FAILED');
    await db.doc('households/household-1').set({ lifecycleState: 'active', homeSummaryConfigVersion: 2 });
  });
  afterAll(async () => { await db.terminate(); await deleteApp(app); });
  const rows = async (collection: string) => (await db.collection(collection).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  function setup() {
    const gateway = createCaptureTransactionGatewayApplication({
      ledger: new FirebaseCaptureLedgerPersistence(db),
      configuration: { load: async () => ({ kind: 'available', value: {
        cards: [{ cardId: 'kb', ownerMemberId: 'member-1', companyLabel: '국민', lastFour: '1234', lifecycleState: 'active' }, { cardId: 'nh', ownerMemberId: 'member-1', companyLabel: '농협', lastFour: '9999', lifecycleState: 'active' }],
        merchantRules: [], activeCategoryIds: new Set(['etc']), defaultCategoryId: 'etc',
      } }) },
    });
    const balanceApplication = createBalanceObservationIntakeApplication({ balances: createLocalCurrencyBalanceApplication(new FirebaseLocalCurrencyBalanceStore(db), { now: () => '2026-07-19T01:05:01.000Z' }) });
    const balance = vi.fn(balanceApplication.recordBalanceObservation);
    const transaction = vi.fn(gateway.record);
    const application = createCaptureSubmissionApplication({ branches: createCaptureBranchSubmissionApplication({ receipts: new FirebaseCaptureSubmissionReceiptStore(db), payloads: new Sha256CapturePayloadFingerprint(), transactions: { record: transaction }, balances: { recordBalanceObservation: balance } }) });
    return { application, balance, transaction };
  }

  it('[T-IOS-001][IOS-011] 같은 root 동시 제출은 원장·Outbox 한 건이며 다른 payload는 receipt 충돌이다', async () => {
    const { application } = setup();
    const command = approvalCommand({ rootIdempotencyKey: 'same', originChannel: 'ios-shortcut' });
    const results = await Promise.all([application.submit(command), application.submit(command)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ kind: 'success', value: { transactionResult: { kind: 'created' } } });
    expect(await rows('households/household-1/ledgerTransactions')).toHaveLength(1);
    expect(await rows('outboxEvents')).toHaveLength(1);
    expect(await application.submit(approvalCommand({ rootIdempotencyKey: 'same', originChannel: 'ios-shortcut', amountInWon: 13000 }))).toEqual({ kind: 'conflict', code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect(await rows('households/household-1/ledgerTransactions')).toHaveLength(1);
    expect(await rows('outboxEvents')).toHaveLength(1);
  }, 30_000);

  it('[T-IOS-001][IOS-011] 같은 root의 서로 다른 payload가 경합하면 한 원장·이벤트만 확정한다', async () => {
    const { application } = setup();
    const results = await Promise.all([12000, 13000].map(amountInWon => application.submit(approvalCommand({ rootIdempotencyKey: 'conflict', originChannel: 'ios-shortcut', amountInWon }))));
    expect(results.map(result => result.kind).sort()).toEqual(['conflict', 'success']);
    expect(results).toContainEqual({ kind: 'conflict', code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect(await rows('households/household-1/ledgerTransactions')).toHaveLength(1);
    expect(await rows('outboxEvents')).toHaveLength(1);
  }, 30_000);

  it('[T-DUP-001][ING-SAVE-005][IOS-006] 서로 다른 채널·키·카드의 동시 결제는 실제 공통 fingerprint에서 한 거래로 수렴한다', async () => {
    const { application } = setup();
    const commands = [approvalCommand({ rootIdempotencyKey: 'android', originChannel: 'android-notification' }), approvalCommand({ rootIdempotencyKey: 'ios', originChannel: 'ios-shortcut', merchant: '  가맹점   A ', card: { companyLabel: '농협', maskedToken: '9999' } })];
    const results = await Promise.all(commands.map(command => application.submit(command)));
    const kinds = results.map(result => result.kind === 'success' ? result.value.transactionResult?.kind : result.kind);
    expect(kinds.sort()).toEqual(['created', 'duplicate']);
    expect(await rows('households/household-1/ledgerTransactions')).toHaveLength(1);
    const duplicateIsShortcut = results[1].kind === 'success' && results[1].value.transactionResult?.kind === 'duplicate';
    const events = await rows('outboxEvents');
    expect(events).toHaveLength(duplicateIsShortcut ? 2 : 1);
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'TransactionRecorded' }));
    if (duplicateIsShortcut) expect(events).toContainEqual(expect.objectContaining({ eventType: 'CaptureDuplicateObserved' }));
  }, 30_000);

  it('[T-CAPTURE-LINEAGE-001][T-CAN-002][CAN-003][CAN-007] 원거래 없는 취소는 이후 승인을 막지 않고 승인 후 취소는 원장 제거·tombstone과 receipt를 재생한다', async () => {
    const { application } = setup();
    const firstCancel = cancellationCommand('missing');
    const missing = await application.submit(firstCancel);
    expect(missing).toMatchObject({ kind: 'success', value: { transactionResult: { kind: 'notFound' } } });
    expect(await application.submit(firstCancel)).toEqual(missing);
    expect(await rows('households/household-1/ledgerDedupKeys')).toEqual([]);
    const approval = await application.submit(approvalCommand({ rootIdempotencyKey: 'later', originChannel: 'android-notification' }));
    expect(approval).toMatchObject({ kind: 'success', value: { transactionResult: { kind: 'created' } } });
    const cancel = cancellationCommand('found');
    const cancelled = await application.submit(cancel);
    expect(cancelled).toMatchObject({ kind: 'success', value: { transactionResult: { kind: 'cancelled' } } });
    const after = await rows('households/household-1/ledgerTransactions');
    expect(after).toEqual([]);
    expect(await rows('households/household-1/ledgerDedupKeys')).toEqual([expect.objectContaining({ state: 'cancelled' })]);
    expect(await rows('households/household-1/captureRecords')).toEqual(expect.arrayContaining([expect.objectContaining({ lifecycleState: 'deleted' })]));
    const events = await rows('outboxEvents');
    expect(await application.submit(cancel)).toEqual(cancelled);
    expect(await rows('households/household-1/ledgerTransactions')).toEqual(after);
    expect(await rows('outboxEvents')).toEqual(events);
  }, 30_000);

  it('[T-BAL-008][T-ING-BAL-001][BAL-005][ING-009] 잔액 실패 뒤 실제 원장을 다시 호출하지 않고 잔액만 저장하며 재전송은 version·이벤트를 보존한다', async () => {
    const { application, balance, transaction } = setup();
    balance.mockRejectedValueOnce(new Error('TEST_BALANCE_UNAVAILABLE'));
    const command = approvalCommand({ rootIdempotencyKey: 'partial', originChannel: 'android-notification', balance: { branchId: 'partial-balance', currencyType: 'gyeonggi', balanceInWon: 55000, observedAt: '2026-07-19T10:05:01+09:00' } });
    expect(await application.submit(command)).toMatchObject({ kind: 'success', value: { completion: 'partial-retryable', transactionResult: { kind: 'created' }, balanceResult: { kind: 'retryableFailure' } } });
    const firstLedger = await rows('households/household-1/ledgerTransactions');
    expect(firstLedger).toHaveLength(1);
    const completed = await application.submit(command);
    expect(completed).toMatchObject({ kind: 'success', value: { completion: 'terminal', balanceResult: { kind: 'recorded', balanceVersion: 1 } } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(balance).toHaveBeenCalledTimes(2);
    const storedBalance = await rows('households/household-1/localCurrencyBalances');
    expect(storedBalance).toEqual([expect.objectContaining({ balanceInWon: 55000, balanceVersion: 1 })]);
    const events = await rows('outboxEvents');
    expect(events).toHaveLength(3);
    expect(events).toEqual(expect.arrayContaining(['TransactionRecorded', 'LocalCurrencyBalanceChanged', 'HomeConfigurationChanged'].map(eventType => expect.objectContaining({ eventType }))));
    expect(await application.submit(command)).toEqual(completed);
    expect(await rows('households/household-1/ledgerTransactions')).toEqual(firstLedger);
    expect(await rows('households/household-1/localCurrencyBalances')).toEqual(storedBalance);
    expect(await rows('outboxEvents')).toEqual(events);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(balance).toHaveBeenCalledTimes(2);
  }, 30_000);
});
