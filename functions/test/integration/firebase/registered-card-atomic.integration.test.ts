import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, setLogFunction } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FirebasePaymentConfigurationAtomicStore } from "../../../src/adapters/firebase/payment-configuration/firebasePaymentConfigurationAtomicStore";
import { createPaymentConfigurationRuntimeApplication } from "../../../src/contexts/payment-capture/configuration/application/paymentConfigurationRuntimeApplication";

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
describeWithEmulator("[CARD-005][T-CARD-005] 실제 등록 카드 저장", () => {
  const app = initializeApp({ projectId: "demo-registered-card-mutation" }, "registered-card-mutation");
  const db = getFirestore(app);
  const application = createPaymentConfigurationRuntimeApplication(new FirebasePaymentConfigurationAtomicStore(db));
  beforeAll(async () => {
    await Promise.all(["households", "commandReceipts"].map(path => db.recursiveDelete(db.collection(path))));
  });
  afterAll(() => deleteApp(app));
  const command = (householdId: string, commandId: string, action: string) => ({
    actor: { householdId, memberId: "member" }, commandId, idempotencyKey: commandId,
    commandName: `payment-configuration.${action}-card.v1`, payloadFingerprint: commandId, occurredAt: "2026-10-05T00:00:00.000Z",
  });
  async function create(householdId: string, id: string, number: string) {
    const result = await application.registerCard({ ...command(householdId, id, "create"), card: { cardLabel: "삼성카드", cardLastFour: number } });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("Card creation failed");
    return result.value.cardId as string;
  }
  it("동일 카드 등록 경합·재전송에서 카드와 claim을 한 개씩만 보존한다", async ({ onTestFailed, onTestFinished }) => {
    const inputs = ["first", "second"].map(id => ({ ...command("race", id, "create"), card: { cardLabel: "삼성카드", cardLastFour: "1234" } }));
    const runTransaction = db.runTransaction.bind(db);
    const attempts: number[] = [];
    const firstResults: unknown[] = [];
    const sdkLog: string[] = [];
    let release!: () => void;
    const bothPrepared = new Promise<void>(resolve => { release = resolve; });
    setLogFunction(message => sdkLog.push(message));
    const observed = vi.spyOn(db, "runTransaction").mockImplementation(operation => {
      const index = attempts.push(0) - 1;
      return runTransaction(async transaction => {
        const firstAttempt = ++attempts[index] === 1;
        const result = await operation(transaction);
        if (firstAttempt) {
          // 동일한 초기 상태의 두 등록을 준비한 뒤 실제 SDK의 commit 충돌·재시도를 검증합니다.
          firstResults.push(result);
          if (firstResults.length === inputs.length) release();
          await bothPrepared;
        }
        return result;
      });
    });
    onTestFailed(() => console.error({ attempts, firstResults, sdkLog }));
    onTestFinished(() => {
      release();
      observed.mockRestore();
      setLogFunction(null);
    });
    const settled = await Promise.allSettled(inputs.map(input => application.registerCard(input).finally(release)));
    const results = settled.map(result => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    expect(firstResults).toEqual(inputs.map(() => expect.objectContaining({
      kind: "committed", value: expect.objectContaining({ kind: "Created" }),
    })));
    expect(attempts).toHaveLength(2);
    expect(attempts.some(count => count > 1)).toBe(true);
    observed.mockRestore();
    expect(results.filter(result => result.kind === "success")).toHaveLength(1);
    expect(results.filter(result => result.kind !== "success")).toEqual([{ kind: "rejected", code: "DUPLICATE_CARD" }]);
    for (let index = 0; index < inputs.length; index++) expect(await application.registerCard(inputs[index])).toEqual(results[index]);
    expect((await db.collection("households/race/registeredCards").get()).size).toBe(1);
    expect((await db.collection("households/race/registeredCardClaims").get()).size).toBe(1);
  });
  it("번호 수정·삭제가 실제 과거 거래의 카드 증거를 보존하고 claim을 해제한다", async () => {
    const cardId = await create("history", "create", "1234");
    const reference = db.doc("households/history/transactions/old");
    const evidence = { cardEvidence: "삼성(1234)", cardLastFour: "삼성(1234)", merchant: "원래 가게", amount: 10000, aggregateVersion: 3 };
    await reference.set(evidence);
    expect(await application.updateCard({ ...command("history", "update", "update"), cardId, changes: { cardLastFour: "5678" }, expectedVersion: 1 }))
      .toEqual({ kind: "success", value: {} });
    const cards = db.collection("households/history/registeredCards");
    expect((await cards.doc(cardId).get()).data()).toMatchObject({ lastFour: "5678", aggregateVersion: 2 });
    expect(await application.deleteCard({ ...command("history", "delete", "delete"), cardId, expectedVersion: 2 })).toEqual({ kind: "success", value: {} });
    expect((await cards.doc(cardId).get()).data()).toMatchObject({ lifecycle: "retired", aggregateVersion: 3 });
    expect((await db.collection("households/history/registeredCardClaims").get()).size).toBe(0);
    expect((await reference.get()).data()).toEqual(evidence);
  });
  it("같은 버전 수정 경합은 한 번만 저장하고 stale 수정이 덮어쓰지 않는다", async () => {
    const cardId = await create("version", "create", "1234");
    const inputs = ["5678", "9876"].map(number => ({ ...command("version", number, "update"), cardId, changes: { cardLastFour: number }, expectedVersion: 1 }));
    const results = await Promise.all(inputs.map(input => application.updateCard(input)));
    expect(results.filter(result => result.kind === "success")).toHaveLength(1);
    expect(results.filter(result => result.kind !== "success")).toEqual([{ kind: "rejected", code: "VERSION_MISMATCH" }]);
    const winner = results.findIndex(result => result.kind === "success");
    expect((await db.doc(`households/version/registeredCards/${cardId}`).get()).data())
      .toMatchObject({ lastFour: inputs[winner].changes.cardLastFour, aggregateVersion: 2 });
  });
});


