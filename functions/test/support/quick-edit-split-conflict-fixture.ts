import { createQuickEditSplitConflictApplication } from "../reference/android-host/application/quickEditSplitConflictApplication";
import type { QuickEditLedgerTransactionSnapshot } from "../reference/android-host/application/ports/in/quickEditSplitConflictInputPort";

const defaultTransaction = (): QuickEditLedgerTransactionSnapshot => ({
  transactionId: "transaction-1",
  lifecycle: "active",
  version: 7,
  merchant: "저장된 가맹점",
  amountInWon: 100_000,
  categoryId: "category-old",
  memo: "저장된 메모",
  evidence: {
    cardId: "card-1",
    originChannel: "android-notification",
    creatorMemberId: "member-creator",
    captureLineageId: "capture-lineage-1",
  },
});

export function createQuickEditSplitConflictFixture(fixture?: {
  readonly transaction?: QuickEditLedgerTransactionSnapshot;
}) {
  return createQuickEditSplitConflictApplication(
    fixture?.transaction ?? defaultTransaction(),
  );
}
