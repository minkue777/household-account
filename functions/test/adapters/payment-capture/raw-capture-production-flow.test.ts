import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { createAndroidProviderParser, createAndroidRawNotificationSubmissionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/public";
import { createCaptureSubmissionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication";
import { createCaptureBranchSubmissionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import { createCaptureTransactionGatewayApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureTransactionGatewayApplication";
import { FirebaseCaptureLedgerPersistence } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence";
import { FirebaseCaptureConfigurationQuery } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import type { CaptureConfigurationQueryResult } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";
import { FirebaseCaptureSubmissionReceiptStore, Sha256CapturePayloadFingerprint } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore";
import { InMemoryFirestore } from "../../support/in-memory-firestore";
import { readContractJson } from "../../support/contract-json";
import type { AndroidRawNotificationInput } from "../../../src/contexts/payment-capture/android-payment-ingestion/public";
import { Sha256AndroidRawNotificationHasher } from "../../../src/adapters/crypto/payment-capture/sha256AndroidRawNotificationHasher";

const actor = { principalId: "uid", householdId: "house", actingMemberId: "member", capabilities: ["paymentCapture:submit" as const] };
function setup() {
  const memory = new InMemoryFirestore();
  const database = memory as unknown as firestore.Firestore;
  const balance = vi.fn(async (_actor: unknown, _observation: unknown) => ({ kind: "success" as const, status: "created" as const, balanceId: "balance", balanceVersion: 1 }));
  const configuration = { load: vi.fn(async (_input: { householdId: string; actingMemberId: string }): Promise<CaptureConfigurationQueryResult> => ({ kind: "available" as const, value: {
      cards: [
        { cardId: "t", ownerMemberId: "member", companyLabel: "토스", lifecycleState: "active" as const },
        { cardId: "g", ownerMemberId: "member", companyLabel: "경기지역화폐", lifecycleState: "active" as const },
        { cardId: "d", ownerMemberId: "member", companyLabel: "대전사랑카드", lastFour: "1357", lifecycleState: "active" as const },
      ], merchantRules: [{ ruleId: "bill", keyword: "도시가스", matchType: "contains" as const, priority: 1, active: true, mapping: { memo: "", categoryId: "fixed" } }], activeCategoryIds: new Set(["etc", "fixed"]), defaultCategoryId: "etc",
    } })) };
  const gateway = createCaptureTransactionGatewayApplication({
    configuration,
    ledger: new FirebaseCaptureLedgerPersistence(database),
  });
  const submissions = createCaptureSubmissionApplication({
    tenantAuthorization: {
      resolveActorContext: () => { throw new Error("Capture submission receives an already resolved actor"); },
      authorizeHouseholdAction: () => ({ kind: "allowed" }),
    },
    branches: createCaptureBranchSubmissionApplication({ receipts: new FirebaseCaptureSubmissionReceiptStore(database), payloads: new Sha256CapturePayloadFingerprint(), transactions: gateway, balances: { recordBalanceObservation: balance } }),
  });
  const raw = createAndroidRawNotificationSubmissionApplication({ parser: createAndroidProviderParser(), submissions, payloads: new Sha256AndroidRawNotificationHasher(), clock: { now: () => "2026-09-06T00:00:00.000Z" } });
  return { memory, balance, configuration, submit: (notification: AndroidRawNotificationInput["notification"], packageName = "com.samsung.android.messaging", observationId = "observation.flow") => raw.submit({ actor, input: { contractVersion: "android-raw-notification.v1", observationId, packageName, notification } }) };
}

describe("raw parser부터 실제 Capture receipt와 Firebase Ledger까지", () => {
  const toss = (amount: number, cancel = false, cashback = 500): AndroidRawNotificationInput["notification"] => ({
    postedAt: cancel ? "2026-09-06T13:10:00+09:00" : "2026-09-05T13:10:00+09:00",
    title: "토스",
    textLines: ["토스뱅크 체크카드 | 테스트 가맹점", `${amount.toLocaleString("en-US")}원 결제${cancel ? " 취소" : ""}`, `${cashback}원 캐시백`],
  });

  it("[PARSE-TOSS-001][CAN-003][T-CAN-002] 캐시백 순지출을 저장하고 원승인 총액 취소만 연결하며 재전송은 반복 삭제하지 않는다", async () => {
    const subject = setup();
    const approved = await subject.submit(toss(10_000), "viva.republica.toss", "observation.toss.approval");
    expect(approved).toMatchObject({ kind: "success", value: { transactionResult: { kind: "created", quickEditSnapshot: { amountInWon: 9_500 } } } });
    const records = subject.memory.documentsInCollection("households/house/captureRecords");
    expect(records).toHaveLength(1);
    expect(records[0].value).toMatchObject({ amountInWon: 9_500, approvalAmountInWon: 10_000 });
    const ledgerBefore = subject.memory.documentsInCollection("households/house/ledgerTransactions");
    expect(ledgerBefore[0].value).toMatchObject({ amountInWon: 9_500, amount: 9_500 });
    expect(subject.memory.documentsInCollection("expenses")[0].value.amount).toBe(9_500);
    expect(await subject.submit(toss(10_000), "viva.republica.toss", "observation.toss.approval")).toEqual(approved);

    expect(await subject.submit(toss(9_500, true), "viva.republica.toss", "observation.toss.wrong-cancel")).toMatchObject({ kind: "success", value: { transactionResult: { kind: "notFound" } } });
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")).toEqual(ledgerBefore);
    const cancelled = await subject.submit(toss(10_000, true), "viva.republica.toss", "observation.toss.cancel");
    expect(cancelled).toMatchObject({ kind: "success", value: { transactionResult: { kind: "cancelled", transactionIds: [records[0].value.transactionId] } } });
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")).toHaveLength(0);
    expect(subject.memory.documentsInCollection("expenses")).toHaveLength(0);
    expect(subject.memory.documentsInCollection("households/house/captureRecords")[0].value).not.toHaveProperty("approvalAmountInWon");
    const outboxBefore = subject.memory.documentsInCollection("outboxEvents");
    expect(await subject.submit(toss(10_000, true), "viva.republica.toss", "observation.toss.cancel")).toEqual(cancelled);
    expect(subject.memory.documentsInCollection("outboxEvents")).toEqual(outboxBefore);
  });

  it("[PARSE-TOSS-001][ING-008] 같은 관찰 ID의 다른 원문은 거부하고 캐시백으로 0원이 된 거래는 생성하지 않는다", async () => {
    const subject = setup();
    const original = await subject.submit(toss(10_000), "viva.republica.toss");
    // 순액은 같지만 승인 총액과 캐시백이 다른 알림입니다.
    expect(await subject.submit(toss(11_000, false, 1_500), "viva.republica.toss")).toMatchObject({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(await subject.submit(toss(10_000), "viva.republica.toss")).toEqual(original);
    expect(await subject.submit(toss(1_000, false, 1_500), "viva.republica.toss", "observation.toss.zero")).toEqual({ kind: "success", value: { observationId: "observation.toss.zero", completion: "terminal" } });
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")).toHaveLength(1);
  });

  const fixture = readContractJson<{ cases: { caseId: string; raw: AndroidRawNotificationInput["notification"] }[] }>("fixtures/payment-capture/android-provider-parser-golden.v1.json");
  it("[ING-008] Ledger commit 응답 유실 뒤 카드 퇴역과 규칙 변경에도 최초 결과와 QuickEdit snapshot을 재생한다", async () => {
    const subject = setup();
    const cardPath = "households/house/registeredCards/g";
    const rulePath = "households/house/merchantRules/g";
    subject.memory.seed(cardPath, { ownerMemberId: "member", companyLabel: "경기지역화폐", lifecycleState: "active" });
    subject.memory.seed(rulePath, { keyword: "카페", matchType: "contains", priority: 1, active: true, mapping: { merchant: "최초 표시명", categoryId: "etc" } });
    subject.memory.seed("households/house/categories/etc", { lifecycleState: "active" });
    const query = new FirebaseCaptureConfigurationQuery(subject.memory as unknown as firestore.Firestore);
    subject.configuration.load.mockImplementation(input => query.load(input));
    const notification = fixture.cases.find((item) => item.caseId === "gyeonggi-payment-and-balance")!.raw;
    const first = await subject.submit(notification);
    expect(first).toMatchObject({ kind: "success", value: { completion: "terminal", transactionResult: { kind: "created", quickEditSnapshot: expect.any(Object) } } });
    const callsBeforeLoss = subject.configuration.load.mock.calls.length;
    subject.memory.seed(cardPath, { ownerMemberId: "member", companyLabel: "경기지역화폐", lifecycleState: "retired" });
    subject.memory.seed(rulePath, { keyword: "카페", matchType: "contains", priority: 1, active: true, mapping: { merchant: "변경된 표시명", categoryId: "etc" } });
    const documentsBefore = subject.memory.documentsInCollection("households/house/ledgerTransactions");
    // The Android caller did not receive first; it resends the same journal input.
    expect(await subject.submit(notification)).toEqual(first);
    expect(subject.configuration.load).toHaveBeenCalledTimes(callsBeforeLoss);
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")).toEqual(documentsBefore);
    expect(subject.balance).toHaveBeenCalledTimes(1);
    expect(subject.memory.documentsInCollection("outboxEvents")).toHaveLength(1);
  });
  it.each(["gyeonggi-payment-and-balance", "daejeon-detail-payment-and-balance"])("[ING-006][ING-009][T-ING-BAL-001] SMS %s는 거래와 잔액을 각각 저장하며 재전달이 side effect를 반복하지 않는다", async (caseId) => {
    const subject = setup();
    const notification = fixture.cases.find((item) => item.caseId === caseId)!.raw;
    const first = await subject.submit(notification);
    expect(first).toMatchObject({ kind: "success", value: { completion: "terminal", transactionResult: { kind: "created" }, balanceResult: { kind: "recorded" } } });
    expect(await subject.submit(notification)).toEqual(first);
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")).toHaveLength(1);
    expect(subject.balance).toHaveBeenCalledTimes(1);
    expect(subject.balance.mock.calls[0][1]).toMatchObject({ balanceInWon: caseId.startsWith("gyeonggi") ? 83000 : 44000 });
  });
  it.each([true, false])("[PARSE-CITYGAS-001][MER-003][T-CITYGAS-001] 청구 제목 %s는 빈 mapping을 지나 최종 memo로 보존된다", async (hasTitle) => {
    const subject = setup();
    const result = await subject.submit({ postedAt: "2026-04-02T08:30:00+09:00", title: hasTitle ? "[2026년 3월 도시가스요금 청구서]" : "도시가스", bigText: "도시가스요금 청구서\n납부하실 총 금액은 48,210원\n납부마감일은 2026년 4월 15일" }, "com.kakao.talk");
    const memo = hasTitle ? "2026년 3월 도시가스요금 청구서" : "";
    expect(result).toMatchObject({ kind: "success", value: { transactionResult: { kind: "created", quickEditSnapshot: { memo, categoryId: "fixed" } } } });
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")[0].value).toMatchObject({ memo, accountingDate: "2026-04-15" });
  });
});
