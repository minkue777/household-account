import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseLedgerCommandRepository } from "../../../src/adapters/firebase/ledger/firebaseLedgerCommandRepository";
import type { LedgerTransactionView } from "../../../src/contexts/household-finance/ledger/domain/model/ledgerTransaction";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const transaction: LedgerTransactionView = {
  transactionId: "ledger-command-1",
  householdId: "household-1",
  transactionType: "expense",
  merchant: "가맹점",
  memo: "",
  amountInWon: 10_000,
  categoryId: "etc",
  accountingDate: "2026-07-23",
  localTime: "12:00",
  cardDisplay: "수동",
  cardType: "manual",
  creatorMemberId: "member-1",
  lifecycleState: "active",
  aggregateVersion: 1,
};

describe("Firebase ledger domain receipt", () => {
  it("상태 변경과 같은 transaction에 저장한 payload hash로 replay와 mismatch를 판정한다", async () => {
    const memory = new InMemoryFirestore();
    const repository = new FirebaseLedgerCommandRepository(
      memory as unknown as firestore.Firestore,
      "household-1",
      "payload-a",
    );
    const result = { kind: "success" as const, value: transaction };

    await expect(
      repository.commit({
        commandId: "command-1",
        householdId: "household-1",
        occurredAt: "2026-07-23T12:00:00.000Z",
        transaction,
        event: {
          type: "TransactionRecorded.v1",
          transactionId: transaction.transactionId,
        },
        result,
      }),
    ).resolves.toEqual({ kind: "success" });
    await expect(repository.findReceipt("command-1")).resolves.toEqual(result);

    const mismatch = new FirebaseLedgerCommandRepository(
      memory as unknown as firestore.Firestore,
      "household-1",
      "payload-b",
    );
    await expect(mismatch.findReceipt("command-1")).resolves.toEqual({
      kind: "validation-error",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
  });
});
