import type {
  CaptureEnvelopeView,
  ParsedObservationBranchIds,
  ParsedObservationClassificationResult,
  ParsedObservationInput,
  ParsedTransactionEvidence,
} from "../model/parsedObservationClassification";
import { parseLocalDate } from "../value-objects/localDate";

type TransactionFailureCode =
  | "PARSE_FAILED"
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "INVALID_TIME";

type ClassifiedTransaction =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly code: TransactionFailureCode }
  | {
      readonly kind: "valid";
      readonly observation: NonNullable<CaptureEnvelopeView["paymentObservation"]>;
    };

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function classifyTransaction(
  transaction: ParsedTransactionEvidence | undefined,
  branchId: string | undefined,
): ClassifiedTransaction {
  if (transaction === undefined) return { kind: "absent" };

  if (
    !Number.isSafeInteger(transaction.amountInWon) ||
    transaction.amountInWon <= 0
  ) {
    return { kind: "invalid", code: "INVALID_AMOUNT" };
  }
  if (parseLocalDate(transaction.occurredLocalDate) === undefined) {
    return { kind: "invalid", code: "INVALID_DATE" };
  }
  if (!LOCAL_TIME_PATTERN.test(transaction.occurredLocalTime)) {
    return { kind: "invalid", code: "INVALID_TIME" };
  }
  if (transaction.merchant.trim() === "") {
    return { kind: "invalid", code: "PARSE_FAILED" };
  }
  if (branchId === undefined || branchId === "") {
    return { kind: "invalid", code: "PARSE_FAILED" };
  }

  return {
    kind: "valid",
    observation: {
      branchId,
      observationType: transaction.observationType,
      amountInWon: transaction.amountInWon,
      occurredLocalDate: transaction.occurredLocalDate,
      occurredLocalTime: transaction.occurredLocalTime,
      zoneId: "Asia/Seoul",
      merchantEvidence: { rawCandidate: transaction.merchant },
      ...(transaction.card === undefined
        ? {}
        : { cardEvidence: { ...transaction.card } }),
    },
  };
}

export function classifyParsedObservation(
  input: ParsedObservationInput,
  branchIds: ParsedObservationBranchIds,
): ParsedObservationClassificationResult {
  const transaction = classifyTransaction(
    input.transactionCandidate,
    branchIds.paymentBranchId,
  );
  const balanceObservation =
    input.balanceCandidate === undefined ||
    branchIds.balanceBranchId === undefined ||
    branchIds.balanceBranchId === ""
      ? undefined
      : {
          ...input.balanceCandidate,
          branchId: branchIds.balanceBranchId,
        };

  if (transaction.kind !== "valid" && balanceObservation === undefined) {
    return {
      kind: "ignored",
      code: transaction.kind === "invalid" ? transaction.code : "PARSE_FAILED",
    };
  }

  return {
    kind: "accepted",
    envelope: {
      contractVersion: "capture-envelope.v1",
      originChannel: "android-notification",
      ...(transaction.kind === "valid"
        ? { paymentObservation: transaction.observation }
        : {}),
      ...(balanceObservation === undefined ? {} : { balanceObservation }),
    },
  };
}
