import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseLocalCurrencyBalanceStore } from "../../../src/adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore";
import { createLocalCurrencyBalanceApplication } from "../../../src/contexts/household-finance/local-currency/application/localCurrencyBalanceApplication";
import type { BalanceObservation } from "../../../src/contexts/household-finance/local-currency/public";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

type MemoryTransaction = Parameters<Parameters<InMemoryFirestore["runTransaction"]>[0]>[0];

class ObservedFirestore extends InMemoryFirestore {
  failReadPath?: string;
  failBalanceEvent = false;
  writes = 0;
  readonly readBatches: string[][] = [];

  override async runTransaction<T>(operation: (transaction: MemoryTransaction) => Promise<T>): Promise<T> {
    return super.runTransaction(async (transaction) => {
      let hasWritten = false;
      const getAll = transaction.getAll.bind(transaction);
      transaction.getAll = (...targets) => {
        this.readBatches.push(targets.map(target => target.path));
        return getAll(...targets);
      };
      const get = transaction.get.bind(transaction);
      transaction.get = async (target) => {
        if (hasWritten) throw new Error("READ_AFTER_WRITE");
        const path = target.kind === "document" ? target.path : target.collectionPath;
        if (path === this.failReadPath) throw new Error("HOME_READ_UNAVAILABLE");
        return get(target);
      };
      const set = transaction.set.bind(transaction);
      transaction.set = (...args) => {
        hasWritten = true;
        this.writes += 1;
        return set(...args);
      };
      const create = transaction.create.bind(transaction);
      transaction.create = (...args) => {
        hasWritten = true;
        this.writes += 1;
        if (this.failBalanceEvent && args[1].eventType === "LocalCurrencyBalanceChanged") {
          throw new Error("BALANCE_EVENT_UNAVAILABLE");
        }
        return create(...args);
      };
      return operation(transaction);
    });
  }
}

const householdId = "balance-read-efficiency";
const householdPath = `households/${householdId}`;
const preferencePath = `${householdPath}/homePreferences/home`;
const now = "2026-09-07T12:00:00.000Z";

function observation(overrides: Partial<BalanceObservation> = {}): BalanceObservation {
  return {
    householdId, observationId: "first", localCurrencyType: "gyeonggi",
    balanceInWon: 0, observedAt: now, ...overrides,
  };
}

function fixture() {
  const database = new ObservedFirestore();
  database.seed(householdPath, { lifecycleState: "active", homeSummaryConfigVersion: 2 });
  const application = createLocalCurrencyBalanceApplication(
    new FirebaseLocalCurrencyBalanceStore(database as unknown as Firestore),
    { now: () => now },
  );
  return { database, application };
}

function documents(database: InMemoryFirestore) {
  return Object.fromEntries(database.paths().map(path => [path, database.document(path)]));
}

function resetReads(database: ObservedFirestore) {
  database.clearTransactionReads();
  database.readBatches.length = 0;
  database.writes = 0;
}

function readApiCount(database: ObservedFirestore) {
  return database.transactionReads().length - database.readBatches.reduce((saved, batch) => saved + batch.length - 1, 0);
}

describe("Local Currency adapter reads before Home selection", () => {
  it.each([false, true])("[BAL-005] receipt replay/mismatch uses only its receipt (changed payload: %s)", async changed => {
    const { database, application } = fixture();
    const first = await application.record(observation());
    const before = documents(database);
    resetReads(database);
    database.failReadPath = preferencePath;

    const result = await application.record(observation(changed ? { balanceInWon: 1 } : {}));

    expect(result).toEqual(changed ? { kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" } : first);
    expect(database.transactionReads()).toEqual([
      { kind: "document", path: expect.stringContaining(`${householdPath}/balanceObservationReceipts/`) },
    ]);
    expect(database.writes).toBe(0);
    expect(documents(database)).toEqual(before);
  });

  it("[BAL-002][BAL-005] stale observation reads receipt and balance only and preserves Home selection", async () => {
    const { database, application } = fixture();
    await application.record(observation({ balanceInWon: 100 }));
    const before = documents(database);
    resetReads(database);
    database.failReadPath = preferencePath;

    const result = await application.record(observation({
      observationId: "older", balanceInWon: 200, observedAt: "2026-09-07T11:00:00.000Z",
    }));

    expect(result).toMatchObject({ kind: "success", status: "staleIgnored", value: { balanceInWon: 100, balanceVersion: 1 } });
    expect(database.transactionReads()).toEqual([
      { kind: "document", path: expect.stringContaining(`${householdPath}/balanceObservationReceipts/`) },
      { kind: "document", path: `${householdPath}/localCurrencyBalances/gyeonggi` },
    ]);
    expect(database.writes).toBe(1);
    expect(database.paths(`${householdPath}/balanceObservationReceipts/`)).toHaveLength(2);
    for (const [path, value] of Object.entries(before)) expect(database.document(path)).toEqual(value);
  });

  it("[HOME-002][BAL-002] first zero balance selects once before writes and other types or later updates preserve it", async () => {
    const { database, application } = fixture();
    const requests = [
      observation(),
      observation({ observationId: "other", localCurrencyType: "daejeon", balanceInWon: 20 }),
      observation({ observationId: "newer", balanceInWon: 30, observedAt: "2026-09-07T13:00:00.000Z" }),
    ];
    for (const [index, request] of requests.entries()) {
      resetReads(database);
      expect(await application.record(request)).toMatchObject({ kind: "success" });
      expect(database.transactionReads()).toHaveLength(index === 0 ? 6 : 4);
      expect(readApiCount(database)).toBe(index === 0 ? 5 : 3);
      expect(database.readBatches).toEqual([[householdPath, preferencePath]]);
      expect(database.transactionReads().filter(read => read.kind === "query")).toEqual(index === 0 ? [
        { kind: "query", path: `${householdPath}/localCurrencyBalances` },
        { kind: "query", path: "balances" },
      ] : []);
      expect(database.document(preferencePath)).toMatchObject({ selectedLocalCurrencyType: "gyeonggi", aggregateVersion: 3 });
    }
    expect(database.document(`${householdPath}/localCurrencyBalances/gyeonggi`)).toMatchObject({ balanceInWon: 30, balanceVersion: 2 });
    expect(database.document(`${householdPath}/localCurrencyBalances/daejeon`)).toMatchObject({ balanceInWon: 20, balanceVersion: 1 });
    expect(database.paths("balances/")).toHaveLength(2);
    expect(database.paths("outboxEvents/")).toHaveLength(4);
  });

  it.each([
    { label: "canonical", preference: "daejeon", legacyField: "selectedLocalCurrencyType", legacy: "gyeonggi" },
    { label: "legacy", preference: undefined, legacyField: "selectedLocalCurrencyType", legacy: "daejeon" },
    { label: "older legacy", preference: undefined, legacyField: "selectedLocalCurrencyTypeId", legacy: "daejeon" },
  ])("[HOME-002] $label selection avoids inventory reads and remains unchanged even without that type's balance", async selection => {
    const { database, application } = fixture();
    database.seed(householdPath, {
      lifecycleState: "active", homeSummaryConfigVersion: 2, [selection.legacyField]: selection.legacy,
    });
    if (selection.preference !== undefined) {
      database.seed(preferencePath, { selectedLocalCurrencyType: selection.preference, aggregateVersion: 3 });
    }
    const previousHousehold = database.document(householdPath);
    const previousPreference = database.document(preferencePath);
    database.failReadPath = `${householdPath}/localCurrencyBalances`;

    expect(await application.record(observation())).toMatchObject({ kind: "success", status: "created" });

    expect(readApiCount(database)).toBe(3);
    expect(database.transactionReads().filter(read => read.kind === "query")).toEqual([]);
    expect(database.document(householdPath)).toEqual(previousHousehold);
    expect(database.document(preferencePath)).toEqual(previousPreference);
    expect(database.document(`${householdPath}/localCurrencyBalances/gyeonggi`)).toMatchObject({ balanceInWon: 0, balanceVersion: 1 });
    expect(database.paths("outboxEvents/")).toHaveLength(1);
  });

  it.each(["home-read", "balance-event"])("[HOME-002][BAL-005] %s failure commits neither first selection nor balance/receipt/events", async failure => {
    const { database, application } = fixture();
    const before = documents(database);
    if (failure === "home-read") database.failReadPath = preferencePath;
    else database.failBalanceEvent = true;

    await expect(application.record(observation())).rejects.toThrow(
      failure === "home-read" ? "HOME_READ_UNAVAILABLE" : "BALANCE_EVENT_UNAVAILABLE",
    );
    expect(documents(database)).toEqual(before);

    database.failReadPath = undefined;
    database.failBalanceEvent = false;
    resetReads(database);
    expect(await application.record(observation())).toMatchObject({ kind: "success", status: "created" });
    expect(database.transactionReads()).toHaveLength(6);
    expect(database.document(preferencePath)).toMatchObject({ selectedLocalCurrencyType: "gyeonggi", aggregateVersion: 3 });
    expect(database.paths(`${householdPath}/balanceObservationReceipts/`)).toHaveLength(1);
    expect(database.paths("outboxEvents/")).toHaveLength(2);
  });
});
