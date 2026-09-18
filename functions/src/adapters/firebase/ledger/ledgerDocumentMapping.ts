import { FieldValue } from "firebase-admin/firestore";
import type { LedgerTransactionView } from "../../../contexts/household-finance/ledger/domain/model/ledgerTransaction";
import type { RecurringLedgerPosting } from "../../../contexts/household-finance/ledger/public";

/** Canonical 원장의 단일 mapper입니다. 과거 문서의 호환 필드도 같은 문서 안에서 유지합니다. */
export function ledgerTransactionDocument(
  transaction: Omit<LedgerTransactionView, "cardType"> & { readonly cardType: LedgerTransactionView["cardType"] | "recurring" },
  includeCreatedAt: boolean,
) {
  return {
    householdId: transaction.householdId,
    transactionType: transaction.transactionType,
    merchant: transaction.merchant,
    memo: transaction.memo,
    tags: transaction.tags ?? [],
    amountInWon: transaction.amountInWon,
    amount: transaction.amountInWon,
    categoryId: transaction.categoryId,
    category: transaction.categoryId,
    accountingDate: transaction.accountingDate,
    date: transaction.accountingDate,
    localTime: transaction.localTime,
    time: transaction.localTime,
    cardDisplay: transaction.cardDisplay,
    cardType: transaction.cardType,
    ...(transaction.localCurrencyType === undefined ? {} : { localCurrencyType: transaction.localCurrencyType }),
    creatorMemberId: transaction.creatorMemberId,
    lifecycleState: transaction.lifecycleState,
    ...(transaction.deletedAt === undefined ? {} : { deletedAt: transaction.deletedAt }),
    aggregateVersion: transaction.aggregateVersion,
    source: transaction.source ?? (transaction.cardType === "manual" ? "manual" : "captured"),
    schemaVersion: 2,
    updatedAt: FieldValue.serverTimestamp(),
    ...(includeCreatedAt ? { createdAt: FieldValue.serverTimestamp() } : {}),
    ...(transaction.notificationRequest === undefined ? {} : { notificationRequest: transaction.notificationRequest }),
  };
}

export function recurringLedgerDocument(householdId: string, posting: RecurringLedgerPosting) {
  return {
    ...ledgerTransactionDocument({
      ...posting,
      householdId,
      localTime: "00:00",
      cardDisplay: "정기지출",
      cardType: "recurring",
      lifecycleState: "active",
      aggregateVersion: 1,
    }, true),
    originChannel: posting.originChannel,
    cardLastFour: "정기지출",
    recurringPlanId: posting.recurringPlanId,
    recurringTargetMonth: posting.recurringTargetMonth,
  };
}
