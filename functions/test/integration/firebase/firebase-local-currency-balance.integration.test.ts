import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, setLogFunction, type Firestore, type QuerySnapshot } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FirebaseLocalCurrencyBalanceStore } from "../../../src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore";
import { createLocalCurrencyBalanceApplication } from "../../../src/contexts/household-finance/local-currency/application/localCurrencyBalanceApplication";
import type { BalanceObservation } from "../../../src/contexts/household-finance/local-currency/public";

const PROJECT_ID = "demo-household-local-currency-balance";
const HOUSEHOLD_ID = "local-currency-balance-test";
const NOW = "2026-09-07T12:00:00.000Z";
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

let app: App;
let database: Firestore;

async function clearEmulator() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host === undefined) return;
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Firestore emulator clear failed: ${response.status}`);
}

function observation(overrides: Partial<BalanceObservation> = {}): BalanceObservation {
  return {
    householdId: HOUSEHOLD_ID, observationId: "first-gyeonggi", localCurrencyType: "gyeonggi",
    balanceInWon: 0, observedAt: NOW, ...overrides,
  };
}

function rows(snapshot: QuerySnapshot): Array<Record<string, unknown> & { id: string }> {
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
}

async function state() {
  const household = database.collection("households").doc(HOUSEHOLD_ID);
  const [householdSnapshot, preference, balances, legacy, receipts, events] = await Promise.all([
    household.get(), household.collection("homePreferences").doc("home").get(),
    household.collection("localCurrencyBalances").get(),
    database.collection("balances").where("householdId", "==", HOUSEHOLD_ID).get(),
    household.collection("balanceObservationReceipts").get(),
    database.collection("outboxEvents").where("householdId", "==", HOUSEHOLD_ID).get(),
  ]);
  return {
    household: householdSnapshot.data(), preference: preference.data(),
    balances: rows(balances), legacy: rows(legacy), receipts: rows(receipts), events: rows(events),
  };
}

describeWithFirestoreEmulator("Firebase Local Currency balance transactions", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `local-currency-balance-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(async () => {
    await clearEmulator();
    await database.collection("households").doc(HOUSEHOLD_ID).set({
      lifecycleState: "active", homeSummaryConfigVersion: 2,
    });
  });

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("[HOME-002][BAL-002][BAL-005] concurrent first types select once and replay/stale preserve the committed selection and balances", async () => {
    const application = createLocalCurrencyBalanceApplication(new FirebaseLocalCurrencyBalanceStore(database), { now: () => NOW });
    const requests = [
      observation(),
      observation({ observationId: "first-daejeon", localCurrencyType: "daejeon", balanceInWon: 20 }),
    ];

    const runTransaction = database.runTransaction.bind(database);
    const attempts: number[] = [];
    const firstResults: unknown[] = [];
    const sdkLog: string[] = [];
    let release!: () => void;
    const bothPrepared = new Promise<void>(resolve => { release = resolve; });
    setLogFunction(message => sdkLog.push(message));
    const observed = vi.spyOn(database, "runTransaction").mockImplementation(operation => {
      const index = attempts.push(0) - 1;
      return runTransaction(async transaction => {
        const firstAttempt = ++attempts[index] === 1;
        const result = await operation(transaction);
        if (firstAttempt) {
          // 두 최초 선택을 같은 초기 상태에서 준비하고 실제 SDK의 commit 충돌·재시도를 검증합니다.
          firstResults.push(result);
          if (firstResults.length === requests.length) release();
          await bothPrepared;
        }
        return result;
      });
    });
    let results: Awaited<ReturnType<typeof application.record>>[];
    try {
      const settled = await Promise.allSettled(requests.map(request => application.record(request).finally(release)));
      results = settled.map(result => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      expect(firstResults).toEqual([
        expect.objectContaining({ kind: "success", status: "created" }),
        expect.objectContaining({ kind: "success", status: "created" }),
      ]);
      expect(attempts).toHaveLength(2);
      expect(attempts.some(count => count > 1)).toBe(true);
    } catch (error) {
      console.error({ attempts, firstResults, sdkLog });
      throw error;
    } finally {
      release();
      observed.mockRestore();
      setLogFunction(null);
    }

    expect(results).toEqual([
      expect.objectContaining({ kind: "success", status: "created" }),
      expect.objectContaining({ kind: "success", status: "created" }),
    ]);
    const committed = await state();
    expect(committed.balances).toHaveLength(2);
    expect(committed.balances).toEqual(expect.arrayContaining([
      expect.objectContaining({ localCurrencyType: "gyeonggi", balanceInWon: 0, balanceVersion: 1 }),
      expect.objectContaining({ localCurrencyType: "daejeon", balanceInWon: 20, balanceVersion: 1 }),
    ]));
    expect(committed.legacy).toHaveLength(2);
    expect(committed.receipts).toHaveLength(2);
    expect(["gyeonggi", "daejeon"]).toContain(committed.preference?.selectedLocalCurrencyType);
    expect(committed.preference?.aggregateVersion).toBe(3);
    expect(committed.household).toMatchObject({
      selectedLocalCurrencyType: committed.preference?.selectedLocalCurrencyType,
      homeSummaryConfigVersion: 3,
    });
    expect(committed.events.filter(event => event.eventType === "HomeConfigurationChanged"))
      .toEqual([expect.objectContaining({ eventVersion: 1, aggregateVersion: 3 })]);
    expect(committed.events.filter(event => event.eventType === "LocalCurrencyBalanceChanged"))
      .toEqual([expect.objectContaining({ eventVersion: 1 }), expect.objectContaining({ eventVersion: 1 })]);

    expect(await Promise.all(requests.map(request => application.record(request)))).toEqual(results);
    expect(await state()).toEqual(committed);
    expect(await application.record(observation({
      observationId: "older-gyeonggi", balanceInWon: 999, observedAt: "2026-09-07T11:00:00.000Z",
    }))).toMatchObject({ kind: "success", status: "staleIgnored", value: { balanceInWon: 0, balanceVersion: 1 } });
    const afterStale = await state();
    expect({ ...afterStale, receipts: committed.receipts }).toEqual(committed);
    expect(afterStale.receipts).toHaveLength(3);
  }, 30_000);

  it("[HOME-002][BAL-005] abort after staging all writes leaves no selection or balance and the same observation retries atomically", async () => {
    const store = new FirebaseLocalCurrencyBalanceStore(database);
    const abortingApplication = createLocalCurrencyBalanceApplication({
      readBalance: store.readBalance.bind(store),
      readLegacyBalance: store.readLegacyBalance.bind(store),
      runInHouseholdTransaction: (scope, operation) => store.runInHouseholdTransaction(scope, async transaction => {
        await operation(transaction);
        throw new Error("TEST_ABORT_BEFORE_COMMIT");
      }),
    }, { now: () => NOW });
    const initial = await state();

    await expect(abortingApplication.record(observation())).rejects.toThrow("TEST_ABORT_BEFORE_COMMIT");

    expect(await state()).toEqual(initial);
    const application = createLocalCurrencyBalanceApplication(store, { now: () => NOW });
    expect(await application.record(observation())).toMatchObject({ kind: "success", status: "created" });
    const committed = await state();
    expect(committed.preference).toMatchObject({ selectedLocalCurrencyType: "gyeonggi", aggregateVersion: 3 });
    expect(committed.balances).toEqual([expect.objectContaining({ balanceInWon: 0, balanceVersion: 1 })]);
    expect(committed.legacy).toHaveLength(1);
    expect(committed.receipts).toHaveLength(1);
    expect(committed.events).toHaveLength(2);
  }, 30_000);
});
