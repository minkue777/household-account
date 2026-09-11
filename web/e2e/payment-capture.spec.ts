import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createHouseholdThroughUi, resetTestAccount, createEmulatorAccount, executeHouseholdCommand } from './emulator';
import { records, paymentCommand, rawNotification, registerCard, submitRaw } from './payment-helpers';

test.beforeEach(resetTestAccount);

test('[PARSE-CITYGAS-001][ING-SAVE-003] 실제 KakaoTalk 도시가스 청구는 카드 없이 고정비로 저장하고 납기일과 청구 월을 보존한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const notification = { contractVersion: 'android-raw-notification.v1', observationId: `citygas-${randomUUID()}`,
    packageName: 'com.kakao.talk', notification: { postedAt: '2026-04-02T08:30:00+09:00',
      title: '[2026년 3월 도시가스요금 청구서]',
      text: '도시가스요금 청구서\n납부하실 총 금액은 48,210원\n납부마감일은 2026년 4월 15일' } };
  const result = await submitRaw(request, actor, notification);
  expect(result.transactionResult.kind).toBe('created');
  expect((await records(request, 'expenses'))[0]).toMatchObject({
    amount: 48210, category: 'fixed', merchant: '3월 도시가스요금', date: '2026-04-15', createdBy: actor.memberId,
  });
  expect(await records(request, 'registered_cards')).toHaveLength(0);
  const fallback = await submitRaw(request, actor, { ...notification, observationId: `citygas-${randomUUID()}`,
    notification: { postedAt: '2026-05-02T08:30:00+09:00', text: '도시가스요금 청구서\n납부하실 총 금액은 53,210원' } });
  expect(fallback.transactionResult.kind).toBe('created');
  expect((await records(request, 'expenses')).find(row => row.amount === 53210)).toMatchObject({
    category: 'fixed', merchant: '5월 도시가스요금', date: '2026-05-02',
  });
});

test('[SYS-004] 실제 Command 금액 검증은 0·음수·소수·unsafe integer를 저장 전 거부하고 정상 원 정수를 보존한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  for (const amountInWon of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(paymentCommand(request, actor, 'ledger.record-manual-transaction.v1', {
      transactionType: 'expense', merchant: '금액 검증', amountInWon, categoryId: 'etc', accountingDate: '2026-09-11', memo: '',
    })).rejects.toThrow('AMOUNT_MUST_BE_POSITIVE_INTEGER');
  }
  expect(await records(request, 'expenses')).toHaveLength(0);
  const created = await paymentCommand(request, actor, 'ledger.record-manual-transaction.v1', {
    transactionType: 'expense', merchant: '금액 검증', amountInWon: 1234, categoryId: 'etc', accountingDate: '2026-09-11', memo: '',
  });
  expect((await records(request, 'expenses')).find(row => row.id === created.transactionId)).toMatchObject({ amount: 1234 });
});

test('[T-ING-PROV-001][ING-001][ING-003][ING-006][ING-007][PARSE-KB-001][PARSE-NH-001][PARSE-NAVER-001][PARSE-TOSS-001][PARSE-KAKAO-001][PARSE-ONNURI-001][PARSE-PAYBOOC-001][PARSE-SAMSUNG-001][PARSE-LOTTE-001][PARSE-GYEONGGI-001][PARSE-DAEJEON-001][PARSE-SEJONG-001][PARSE-SMSBILL-001][PARSE-COMMON-001][ING-SAVE-002][ING-SAVE-006] 지원 공급자 원문은 실제 callable과 parser를 지나 금액·카드·서울 회계일·생성자를 보존한다', async ({ page, request }) => {
  test.setTimeout(240_000);
  const actor = await createHouseholdThroughUi(page);
  const golden = JSON.parse(readFileSync(resolve(process.cwd(), '../contracts/fixtures/payment-capture/android-provider-parser-golden.v1.json'), 'utf8'));
  const chosen = ['kb-approval', 'nh-approval', 'naver-approval-posted-time', 'toss-check-card-cashback', 'kakao-approval-posted-time',
    'onnuri-current-app-title-body-approval', 'paybooc-inline-approval', 'samsung-approval', 'lotte-installment-approval',
    'gyeonggi-payment-and-balance', 'daejeon-detail-payment-and-balance', 'sejong-payment-and-balance', 'sms-bill-approved', 'kakao-talk-current-text-priority'];
  const examples = chosen.map(id => golden.cases.find((entry: any) => entry.caseId === id));
  for (const label of Array.from(new Set<string>(examples.map(example => example.expected.payment.cardCompany)))) await registerCard(request, actor, label);
  for (const example of examples) await test.step(example.caseId, async () => {
    const observationId = `golden-${randomUUID()}`;
    const received = await submitRaw(request, actor, { contractVersion: 'android-raw-notification.v1', observationId,
      packageName: example.source.packageName, notification: example.raw });
    expect(received.transactionResult.kind).toBe('created');
    const saved = (await records(request, `households/${actor.householdId}/ledgerTransactions`)).find(row => row.id === received.transactionResult.transactionId)!;
    const expected = example.expected.payment;
    expect(saved).toMatchObject({ householdId: actor.householdId, creatorMemberId: actor.memberId, originChannel: 'android-notification', cardType: 'captured', suppressAutomaticNotification: true, notificationPolicy: 'android-quick-edit-only',
      amountInWon: expected.amountInWon, merchant: expected.merchant, accountingDate: expected.occurredLocalDate });
    const provenance = (await records(request, `households/${actor.householdId}/captureRecords`)).find(row => row.transactionId === saved.id)!;
    expect(provenance).toMatchObject({ transactionId: saved.id, captureLineageId: saved.captureLineageId,
      observationId, originalMerchant: expected.merchant, amountInWon: expected.amountInWon,
      creatorMemberId: actor.memberId, approvalDate: expected.occurredLocalDate, originChannel: 'android-notification',
      parser: { parserId: example.source.parserId, parserVersion: expect.any(String) },
      cardEvidence: { companyLabel: expected.cardCompany }, rawPayloadHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    const claim = (await records(request, `households/${actor.householdId}/ledgerDedupKeys`)).find(row => row.transactionId === saved.id)!;
    expect(claim).toMatchObject({ captureLineageId: saved.captureLineageId, fingerprintHash: provenance.fingerprintHash, state: 'active' });
    expect(received.transactionResult.quickEditSnapshot).toMatchObject({ transactionId: saved.id, merchant: expected.merchant, amountInWon: expected.amountInWon });
    expect(JSON.stringify(saved)).not.toContain(JSON.stringify(example.raw));
  });
  expect((await records(request, 'expenses')).filter(row => row.lifecycleState === 'active')).toHaveLength(examples.length);
  expect(await records(request, 'e2eFcmTransport')).toHaveLength(0); // Android capture never sends an automatic push.
});

test('[ING-002][ING-005][ING-SAVE-001][CARD-004][SYS-003][SYS-007] 출처·인증·본인 카드 gate는 실제 HTTP와 서버 저장 전 경계에서 거부한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const raw = rawNotification();
  await expect(submitRaw(request, undefined, raw)).rejects.toThrow(/401|403|UNAUTHENTICATED/);
  const ignoredSource = await submitRaw(request, actor, { ...raw, packageName: 'com.unregistered.app' });
  expect(ignoredSource).toEqual({ observationId: raw.observationId, completion: 'terminal' });
  await expect(submitRaw(request, actor, { ...raw, parserId: 'kb-card-parser' })).rejects.toThrow('UNKNOWN_FIELD');
  const rejected = await submitRaw(request, actor, raw);
  expect(rejected.transactionResult.kind).toBe('rejected');
  expect(await records(request, 'expenses')).toHaveLength(0);
  await registerCard(request, actor);
  const other = await createEmulatorAccount(request, 'capture-other@household.test');
  const otherHouse = await executeHouseholdCommand<{ householdId: string; memberId: string }>(request, { idToken: other.idToken,
    command: 'access.create-household-with-self.v1', payload: { householdName: '다른 가구', memberName: '다른 사람' } });
  const otherResult = await submitRaw(request, { ...other, ...otherHouse }, rawNotification({ merchant: '본인 카드 없음' }));
  expect(otherResult.transactionResult.kind).toBe('rejected');
  expect(await records(request, 'expenses')).toHaveLength(0);
});

test('[ING-008][ING-009][BAL-001][BAL-002][BAL-003][BAL-005] 카드가 없어 거래가 거절돼도 세 지역 잔액은 독립 저장되고 같은 입력 재생은 version을 증가시키지 않는다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const golden = JSON.parse(readFileSync(resolve(process.cwd(), '../contracts/fixtures/payment-capture/android-provider-parser-golden.v1.json'), 'utf8'));
  for (const id of ['gyeonggi-payment-and-balance', 'daejeon-detail-payment-and-balance', 'sejong-balance-only']) {
    const example = golden.cases.find((entry: any) => entry.caseId === id);
    const raw = { contractVersion: 'android-raw-notification.v1', observationId: `balance-${randomUUID()}`, packageName: example.source.packageName, notification: example.raw };
    const first = await submitRaw(request, actor, raw);
    expect(first.balanceResult.kind).toBe('recorded');
    if (example.expected.payment) expect(first.transactionResult.kind).toBe('rejected');
    else expect(first.transactionResult).toBeUndefined();
    const repeat = await submitRaw(request, actor, raw);
    expect(repeat).toEqual(first);
  }
  const balances = await records(request, `households/${actor.householdId}/localCurrencyBalances`);
  expect(balances).toHaveLength(3);
  expect(balances.map(row => row.balanceInWon).sort((a, b) => a - b)).toEqual([32000, 44000, 83000]);
  expect(await records(request, 'expenses')).toHaveLength(0);
});

test('[T-CAN-004][ING-SAVE-004][ING-SAVE-005][ING-SAVE-007][CAN-001][CAN-003][CAN-005][CAN-007] 동시 승인은 한 건이고 메모·가맹점·규칙 변경 뒤 원승인 취소는 같은 lineage만 제거한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  const raw = rawNotification({ merchant: '원본 카페' });
  const [left, right] = await Promise.all([submitRaw(request, actor, raw), submitRaw(request, actor, raw)]);
  expect(left.transactionResult.transactionId).toBe(right.transactionResult.transactionId);
  const id = left.transactionResult.transactionId;
  expect(await records(request, 'expenses')).toHaveLength(1);
  const provenance = await records(request, `households/${actor.householdId}/captureRecords`);
  await paymentCommand(request, actor, 'ledger.update-transaction.v1', { transactionId: id, expectedVersion: 1, patch: { merchant: '사용자 수정 카페', memo: '승인 증거 보존' } });
  await paymentCommand(request, actor, 'payment-configuration.create-merchant-rule.v1', { rule: {
    merchantKeyword: '원본 카페', matchType: 'exact', mapping: { merchant: '규칙 변경 카페', category: 'food' },
  } });
  expect(await records(request, `households/${actor.householdId}/captureRecords`)).toEqual(provenance);
  const cancel = await submitRaw(request, actor, rawNotification({ merchant: '원본 카페', cancellation: true }));
  expect(cancel.transactionResult).toMatchObject({ kind: 'cancelled', transactionIds: [id] });
  expect((await records(request, 'expenses')).filter(row => row.lifecycleState === 'active')).toHaveLength(0);
  const originalReplay = await submitRaw(request, actor, raw);
  expect(originalReplay.transactionResult.transactionId).toBe(id);
  expect((await records(request, 'expenses')).filter(row => row.lifecycleState === 'active')).toHaveLength(0);
  const noTarget = await submitRaw(request, actor, rawNotification({ merchant: '취소 대상 없음', amount: 9900, cancellation: true }));
  expect(noTarget.transactionResult.kind).toBe('notFound');
  const laterApproval = await submitRaw(request, actor, rawNotification({ merchant: '취소 대상 없음', amount: 9900 }));
  expect(laterApproval.transactionResult.kind).toBe('created');
});

test('[T-CAN-001][CAN-002][CAN-004][CAN-006][ING-SAVE-007][SPL-003] 지난달 원승인의 내림 월 분할을 취소하면 미래 월을 포함한 파생 전체만 원자 삭제한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  const seoulNow = new Date(Date.now() + 9 * 3600_000);
  const past = new Date(Date.UTC(seoulNow.getUTCFullYear(), seoulNow.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const captured = await submitRaw(request, actor, rawNotification({ merchant: '분할 원승인', amount: 10001, date: past }));
  const id = captured.transactionResult.transactionId;
  const split = await paymentCommand(request, actor, 'ledger.split-existing-transaction-monthly.v1', { transactionId: id, expectedVersion: 1, months: 3 });
  expect(split.transactionIds).toHaveLength(3);
  const children = (await records(request, 'expenses')).filter(row => row.lifecycleState === 'active');
  expect(children.map(row => row.amount)).toEqual([3333, 3333, 3333]);
  expect(children.some(row => row.date.slice(0, 7) > seoulNow.toISOString().slice(0, 7))).toBe(true);
  const unrelated = await submitRaw(request, actor, rawNotification({ merchant: '보존할 별도 카페', amount: 7777 }));
  expect(unrelated.transactionResult.kind).toBe('created');
  const cancelled = await submitRaw(request, actor, rawNotification({ merchant: '분할 원승인', amount: 10001, cancellation: true }));
  expect(cancelled.transactionResult.kind).toBe('cancelled');
  expect(new Set(cancelled.transactionResult.transactionIds)).toEqual(new Set([id, ...split.transactionIds]));
  expect((await records(request, 'expenses')).filter(row => row.lifecycleState === 'active')).toEqual([
    expect.objectContaining({ id: unrelated.transactionResult.transactionId, amount: 7777, merchant: '보존할 별도 카페' }),
  ]);
});
