import type {
  QuickEditConflictFormSnapshot,
  QuickEditConflictSplitItem,
  QuickEditLedgerTransactionSnapshot,
  QuickEditSplitConflictInputPort,
  QuickEditSplitConflictState,
} from "./ports/in/quickEditSplitConflictInputPort";

const cloneTransaction = (
  transaction: QuickEditLedgerTransactionSnapshot,
): QuickEditLedgerTransactionSnapshot => ({
  ...transaction,
  evidence: { ...transaction.evidence },
});

const cloneForm = (
  form: QuickEditConflictFormSnapshot,
): QuickEditConflictFormSnapshot => ({ ...form });

const cloneItems = (
  items: readonly QuickEditConflictSplitItem[],
): QuickEditConflictSplitItem[] => items.map((item) => ({ ...item }));

export function createQuickEditSplitConflictApplication(
  initialTransaction: QuickEditLedgerTransactionSnapshot,
): QuickEditSplitConflictInputPort {
  let ledgerTransactions = [cloneTransaction(initialTransaction)];
  let form: QuickEditConflictFormSnapshot = {
    transactionId: initialTransaction.transactionId,
    merchant: initialTransaction.merchant,
    amountInWon: initialTransaction.amountInWon,
    categoryId: initialTransaction.categoryId,
    memo: initialTransaction.memo,
    expectedVersion: initialTransaction.version,
  };
  let draft:
    | {
        baseForm: QuickEditConflictFormSnapshot;
        items: QuickEditConflictSplitItem[];
      }
    | undefined;

  const target = (): QuickEditLedgerTransactionSnapshot => {
    const found = ledgerTransactions.find(
      ({ transactionId }) => transactionId === form.transactionId,
    );
    if (found === undefined) throw new Error("분할 원본 거래가 없습니다.");
    return found;
  };

  return {
    editForm(patch) {
      form = { ...form, ...patch };
    },

    beginSplit(items) {
      draft = { baseForm: cloneForm(form), items: cloneItems(items) };
    },

    applyConcurrentServerChange(change) {
      ledgerTransactions = ledgerTransactions.map((transaction) =>
        transaction.transactionId === form.transactionId
          ? {
              ...transaction,
              version: change.version,
              lifecycle: change.lifecycle ?? transaction.lifecycle,
              merchant: change.merchant ?? transaction.merchant,
            }
          : transaction,
      );
    },

    async submitSplit() {
      if (draft === undefined) throw new Error("분할 draft가 없습니다.");
      const currentTarget = target();
      if (
        currentTarget.lifecycle !== "active" ||
        currentTarget.version !== draft.baseForm.expectedVersion
      ) {
        return {
          kind: "Conflict",
          code: "VERSION_MISMATCH",
          targetLifecycle: currentTarget.lifecycle,
          mayRecreateDraftAfterConfirmation:
            currentTarget.lifecycle === "active",
        };
      }

      const superseded: QuickEditLedgerTransactionSnapshot = {
        ...currentTarget,
        lifecycle: "superseded",
        version: currentTarget.version + 1,
      };
      const derivedTransactions = draft.items.map((item, index) => ({
        transactionId: `${currentTarget.transactionId}:split:${index + 1}`,
        lifecycle: "active" as const,
        version: 1,
        merchant: item.merchant,
        amountInWon: item.amountInWon,
        categoryId: item.categoryId,
        memo: item.memo,
        evidence: { ...currentTarget.evidence },
      }));

      ledgerTransactions = [
        ...ledgerTransactions.map((transaction) =>
          transaction.transactionId === currentTarget.transactionId
            ? superseded
            : transaction,
        ),
        ...derivedTransactions,
      ];
      return {
        kind: "Success",
        derivedTransactions: derivedTransactions.map(cloneTransaction),
      };
    },

    confirmLatestActiveAndRecreateDraft() {
      const currentTarget = target();
      if (currentTarget.lifecycle !== "active") {
        return { kind: "Rejected", code: "TARGET_NOT_ACTIVE" };
      }
      if (draft === undefined) throw new Error("분할 draft가 없습니다.");

      form = { ...form, expectedVersion: currentTarget.version };
      draft = {
        baseForm: cloneForm(form),
        items: cloneItems(draft.items),
      };
      return {
        kind: "DraftRecreated",
        expectedVersion: currentTarget.version,
      };
    },

    state(): QuickEditSplitConflictState {
      return {
        form: cloneForm(form),
        draft:
          draft === undefined
            ? undefined
            : {
                baseForm: cloneForm(draft.baseForm),
                items: cloneItems(draft.items),
              },
        ledgerTransactions: ledgerTransactions.map(cloneTransaction),
      };
    },
  };
}
