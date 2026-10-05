import type { CaptureBranchEnvelope } from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export const balanceOnlyEnvelope = {
  rootIdempotencyKey: "android:installation-1:observation-1",
  householdId: "house-1",
  balanceBranch: {
    branchKey: "android:installation-1:observation-1:balance",
    observation: {
      contractVersion: "balance-observation.v1",
      observationId: "observation-1:balance",
      localCurrencyType: "gyeonggi",
      balanceInWon: 123_456,
      observedAt: "2026-07-20T09:00:00+09:00",
      sourceType: "gyeonggi-local-currency",
      parser: {
        parserId: "gyeonggi-local-currency-parser",
        parserVersion: "1.0.0",
      },
    },
  },
} satisfies CaptureBranchEnvelope;

export const combinedEnvelope = {
  ...balanceOnlyEnvelope,
  rootIdempotencyKey: "android:installation-1:observation-2",
  transactionBranch: {
    branchKey: "android:installation-1:observation-2:transaction",
    merchant: "가맹점",
    amountInWon: 10_000,
    occurredAt: "2026-07-20T09:00:00+09:00",
    accountingDate: "2026-07-20",
    sourceType: "gyeonggi-local-currency",
    parser: {
      parserId: "gyeonggi-local-currency-parser",
      parserVersion: "1.0.0",
    },
    rawPayloadHash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  balanceBranch: {
    ...balanceOnlyEnvelope.balanceBranch,
    branchKey: "android:installation-1:observation-2:balance",
    observation: {
      ...balanceOnlyEnvelope.balanceBranch.observation,
      observationId: "observation-2:balance",
    },
  },
} satisfies CaptureBranchEnvelope;

