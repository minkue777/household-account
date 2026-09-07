import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { FirebaseProviderHealthRepository } from "../../../src/adapters/firebase/operations/firebaseProviderHealth";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function input(version: number): Parameters<FirebaseProviderHealthRepository["commit"]>[0] {
  const quote = { instrumentId: "public-instrument", price: 70000 + version, currency: "KRW", provider: "naver-domestic", observedAt: `2026-09-07T00:00:0${version}Z` };
  const health = { provider: "naver-domestic", operation: "market-quote", status: "healthy", lastAttemptAt: quote.observedAt, lastSuccessAt: quote.observedAt, consecutiveFailedRuns: 0, lastResultKind: "SUCCESS", alertState: "closed", version } as const;
  return { executionKey: `run-${version}`, quote, health, result: { kind: "quote-updated", quote, health } };
}

describe("provider health atomic batch reads", () => {
  it("reads receipt and health in one batch while retaining replay priority and optimistic version checks", async () => {
    const memory = new InMemoryFirestore();
    const runTransaction = memory.runTransaction.bind(memory);
    const batches: string[][] = [];
    memory.runTransaction = async operation => runTransaction(async transaction => {
      const getAll = transaction.getAll.bind(transaction);
      transaction.getAll = async (...references) => {
        batches.push(references.map(reference => reference.path));
        return getAll(...references);
      };
      return operation(transaction);
    });
    const repository = new FirebaseProviderHealthRepository(memory as unknown as Firestore);
    await repository.commit(input(1));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([expect.stringContaining("/providerHealthReceipts/"), expect.stringContaining("/providerHealth/")]);
    expect(memory.transactionReads()).toHaveLength(2);
    await repository.commit(input(2));
    await expect(repository.commit(input(1))).resolves.toBeUndefined();
    await expect(repository.commit({ ...input(2), executionKey: "competing-run" })).rejects.toThrow("PROVIDER_HEALTH_CONCURRENT_UPDATE");
    expect(batches).toHaveLength(4);
    expect(memory.paths("operations/runtime/providerHealthReceipts/")).toHaveLength(2);
    expect(memory.paths("operations/runtime/providerQuotes/")).toHaveLength(1);
    await expect(repository.getHealth("naver-domestic", "market-quote")).resolves.toMatchObject({ version: 2 });
    await expect(repository.getQuote("public-instrument")).resolves.toMatchObject({ price: 70002 });
  });

  it("propagates an unavailable batch read without writing health, quote or receipt", async () => {
    const memory = new InMemoryFirestore();
    const runTransaction = memory.runTransaction.bind(memory);
    memory.runTransaction = async operation => runTransaction(async transaction => {
      transaction.getAll = async () => { throw new Error("batch unavailable"); };
      return operation(transaction);
    });
    const repository = new FirebaseProviderHealthRepository(memory as unknown as Firestore);
    await expect(repository.commit(input(1))).rejects.toThrow("batch unavailable");
    expect(memory.paths("operations/runtime/")).toEqual([]);
  });
});
