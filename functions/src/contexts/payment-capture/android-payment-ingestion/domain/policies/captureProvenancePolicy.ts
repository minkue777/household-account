import type {
  ApprovalCaptureInput,
  ApprovalCaptureResult,
  CancellationEvidence,
  CaptureProvenance,
  CaptureProvenanceAggregateState,
  CapturedTransaction,
  ProvenanceCancellationResult,
} from "../model/captureProvenance";
import { normalizeCancellationMerchant } from "../value-objects/cancellationEvidence";

export interface CaptureApprovalDecision {
  readonly result: ApprovalCaptureResult;
  readonly nextState?: CaptureProvenanceAggregateState;
}

export interface ProvenanceCancellationDecision {
  readonly result: ProvenanceCancellationResult;
  readonly nextState?: CaptureProvenanceAggregateState;
}

function cloneProvenance(value: CaptureProvenance): CaptureProvenance {
  return {
    ...value,
    source: { ...value.source },
    parser: { ...value.parser },
    originalCardEvidence: { ...value.originalCardEvidence },
  };
}

function cloneTransaction(value: CapturedTransaction): CapturedTransaction {
  return {
    ...value,
    captureLineageIds: [...value.captureLineageIds],
    displayed: { ...value.displayed },
    provenanceByLineage: Object.fromEntries(
      Object.entries(value.provenanceByLineage).map(([lineageId, provenance]) => [
        lineageId,
        cloneProvenance(provenance),
      ]),
    ),
  };
}

export function cloneCaptureProvenanceAggregateState(
  state: CaptureProvenanceAggregateState,
): CaptureProvenanceAggregateState {
  return {
    transactions: state.transactions.map(cloneTransaction),
    dedupClaims: state.dedupClaims.map((claim) => ({ ...claim })),
    cancellationReceipts: state.cancellationReceipts.map((receipt) => ({
      ...receipt,
      deletedTransactionIds: [...receipt.deletedTransactionIds],
      restoredTransactionIds: [...receipt.restoredTransactionIds],
    })),
    legacyIncompleteLineageIds: [...state.legacyIncompleteLineageIds],
  };
}

export function captureFingerprint(input: {
  readonly householdId: string;
  readonly provenance: CaptureProvenance;
}): string {
  const { provenance } = input;
  return `capture-fingerprint.v1:${JSON.stringify([
    input.householdId,
    provenance.originalOccurredLocalDate,
    provenance.originalOccurredLocalTime,
    provenance.originalAmountInWon,
    normalizeCancellationMerchant(provenance.originalMerchantEvidence),
  ])}`;
}

export function decideCaptureApproval(
  state: CaptureProvenanceAggregateState,
  input: ApprovalCaptureInput,
): CaptureApprovalDecision {
  const creatorMemberId = input.actor.memberId;
  if (creatorMemberId === undefined || creatorMemberId.trim() === "") {
    return { result: { kind: "Rejected", code: "CREATOR_REQUIRED" } };
  }

  const fingerprint = captureFingerprint({
    householdId: input.actor.householdId,
    provenance: input.provenance,
  });
  const existingClaim = state.dedupClaims.find(
    (claim) => claim.fingerprint === fingerprint,
  );
  if (existingClaim !== undefined) {
    return {
      result: {
        kind: "Duplicate",
        existingTransactionId: existingClaim.transactionId,
      },
    };
  }

  const provenance = cloneProvenance(input.provenance);
  const transaction: CapturedTransaction = {
    transactionId: input.transactionId,
    householdId: input.actor.householdId,
    creatorMemberId,
    captureLineageIds: [provenance.captureLineageId],
    lifecycle: "active",
    displayed: {
      amountInWon: provenance.originalAmountInWon,
      merchant: provenance.originalMerchantEvidence,
      occurredLocalDate: provenance.originalOccurredLocalDate,
      occurredLocalTime: provenance.originalOccurredLocalTime,
    },
    provenanceByLineage: {
      [provenance.captureLineageId]: provenance,
    },
  };

  return {
    result: {
      kind: "Created",
      transactionId: transaction.transactionId,
      captureLineageId: provenance.captureLineageId,
      creatorMemberId,
    },
    nextState: {
      transactions: [...state.transactions.map(cloneTransaction), transaction],
      dedupClaims: [
        ...state.dedupClaims.map((claim) => ({ ...claim })),
        {
          fingerprint,
          transactionId: transaction.transactionId,
          captureLineageId: provenance.captureLineageId,
          state: "active",
        },
      ],
      cancellationReceipts: state.cancellationReceipts.map((receipt) => ({
        ...receipt,
        deletedTransactionIds: [...receipt.deletedTransactionIds],
        restoredTransactionIds: [...receipt.restoredTransactionIds],
      })),
      legacyIncompleteLineageIds: [...state.legacyIncompleteLineageIds],
    },
  };
}

function normalizeCardCompany(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeMaskedToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const digits = value.replace(/\D/gu, "");
  return digits === "" ? value.trim() : digits.slice(-4);
}

function evidenceMatches(
  evidence: CancellationEvidence,
  provenance: CaptureProvenance,
): boolean {
  const evidenceMerchant = normalizeCancellationMerchant(
    evidence.merchantEvidence,
  );
  const evidenceCompany = normalizeCardCompany(
    evidence.cardEvidence.companyLabel,
  );
  return (
    evidenceMerchant !== "" &&
    evidenceMerchant ===
      normalizeCancellationMerchant(provenance.originalMerchantEvidence) &&
    evidence.amountInWon === provenance.originalAmountInWon &&
    evidenceCompany !== "" &&
    evidenceCompany ===
      normalizeCardCompany(provenance.originalCardEvidence.companyLabel) &&
    normalizeMaskedToken(evidence.cardEvidence.maskedToken) ===
      normalizeMaskedToken(provenance.originalCardEvidence.maskedToken) &&
    evidence.occurredLocalDate === provenance.originalOccurredLocalDate &&
    evidence.occurredLocalTime === provenance.originalOccurredLocalTime
  );
}

function uniqueMatchingLineages(input: {
  readonly state: CaptureProvenanceAggregateState;
  readonly householdId: string;
  readonly evidence: CancellationEvidence;
}): readonly string[] {
  const matching = new Set<string>();
  for (const transaction of input.state.transactions) {
    if (transaction.householdId !== input.householdId) continue;
    for (const lineageId of transaction.captureLineageIds) {
      const provenance = transaction.provenanceByLineage[lineageId];
      if (
        provenance !== undefined &&
        evidenceMatches(input.evidence, provenance)
      ) {
        matching.add(lineageId);
      }
    }
  }
  return [...matching].sort((left, right) => left.localeCompare(right, "en"));
}

export function decideProvenanceCancellation(input: {
  readonly state: CaptureProvenanceAggregateState;
  readonly householdId: string;
  readonly evidence: CancellationEvidence;
  readonly nextRestoredTransactionId: () => string;
}): ProvenanceCancellationDecision {
  const matchingLineageIds = uniqueMatchingLineages(input);
  if (matchingLineageIds.length === 0) {
    return { result: { kind: "NotFound" } };
  }
  if (matchingLineageIds.length > 1) {
    return {
      result: {
        kind: "NeedsConfirmation",
        captureLineageIds: matchingLineageIds,
      },
    };
  }

  const captureLineageId = matchingLineageIds[0];
  if (input.state.legacyIncompleteLineageIds.includes(captureLineageId)) {
    return {
      result: {
        kind: "ContractFailure",
        code: "INCOMPLETE_LEGACY_LINEAGE",
      },
    };
  }

  const deletedTransactions = input.state.transactions.filter(
    (transaction) =>
      transaction.householdId === input.householdId &&
      transaction.captureLineageIds.includes(captureLineageId),
  );
  const deletedTransactionIds = deletedTransactions.map(
    (transaction) => transaction.transactionId,
  );
  const retainedTransactions = input.state.transactions.filter(
    (transaction) => !deletedTransactionIds.includes(transaction.transactionId),
  );

  const restorations = new Map<
    string,
    { transaction: CapturedTransaction; provenance: CaptureProvenance }
  >();
  for (const transaction of deletedTransactions) {
    for (const lineageId of transaction.captureLineageIds) {
      if (lineageId === captureLineageId || restorations.has(lineageId)) continue;
      if (
        retainedTransactions.some((candidate) =>
          candidate.captureLineageIds.includes(lineageId),
        )
      ) {
        continue;
      }
      const provenance = transaction.provenanceByLineage[lineageId];
      if (provenance !== undefined) {
        restorations.set(lineageId, { transaction, provenance });
      }
    }
  }

  const restoredTransactions = [...restorations.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([lineageId, restoration]) => {
      const provenance = cloneProvenance(restoration.provenance);
      return {
        transactionId: input.nextRestoredTransactionId(),
        householdId: restoration.transaction.householdId,
        creatorMemberId: restoration.transaction.creatorMemberId,
        captureLineageIds: [lineageId],
        lifecycle: "active" as const,
        displayed: {
          amountInWon: provenance.originalAmountInWon,
          merchant: provenance.originalMerchantEvidence,
          occurredLocalDate: provenance.originalOccurredLocalDate,
          occurredLocalTime: provenance.originalOccurredLocalTime,
        },
        provenanceByLineage: { [lineageId]: provenance },
      };
    });
  const restoredTransactionIds = restoredTransactions.map(
    (transaction) => transaction.transactionId,
  );

  const result: Extract<
    ProvenanceCancellationResult,
    { kind: "Cancelled" }
  > = {
    kind: "Cancelled",
    captureLineageId,
    deletedTransactionIds,
    restoredTransactionIds,
  };
  return {
    result,
    nextState: {
      transactions: [
        ...retainedTransactions.map(cloneTransaction),
        ...restoredTransactions,
      ],
      dedupClaims: input.state.dedupClaims.map((claim) => ({
        ...claim,
        state:
          claim.captureLineageId === captureLineageId
            ? ("cancelled" as const)
            : claim.state,
      })),
      cancellationReceipts: [
        ...input.state.cancellationReceipts.map((receipt) => ({
          ...receipt,
          deletedTransactionIds: [...receipt.deletedTransactionIds],
          restoredTransactionIds: [...receipt.restoredTransactionIds],
        })),
        {
          captureLineageId,
          deletedTransactionIds: [...deletedTransactionIds],
          restoredTransactionIds: [...restoredTransactionIds],
        },
      ],
      legacyIncompleteLineageIds:
        input.state.legacyIncompleteLineageIds.filter(
          (lineageId) => lineageId !== captureLineageId,
        ),
    },
  };
}
