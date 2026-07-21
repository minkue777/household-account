import { describe, expect, it } from "vitest";

import { mergeCanonicalLedgerTransactions } from "../../../src/adapters/firebase/ledger/migrationAwareLedgerUnion";

describe("migration-aware ledger union", () => {
  it("정본이 일부만 생겨도 legacy-only 거래를 누락하지 않는다", () => {
    const result = mergeCanonicalLedgerTransactions({
      legacy: [
        { transactionId: "shared", source: "legacy", version: 1 },
        { transactionId: "legacy-only", source: "legacy", version: 2 },
      ],
      canonical: [
        { transactionId: "shared", source: "canonical", version: 3 },
        { transactionId: "canonical-only", source: "canonical", version: 1 },
      ],
    });

    expect(result).toEqual([
      { transactionId: "shared", source: "canonical", version: 3 },
      { transactionId: "legacy-only", source: "legacy", version: 2 },
      { transactionId: "canonical-only", source: "canonical", version: 1 },
    ]);
  });
});
