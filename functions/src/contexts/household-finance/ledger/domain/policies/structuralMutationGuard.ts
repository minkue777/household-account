import type {
  StructuralLedgerState,
  StructuralMutationResult,
  StructuralOperation,
} from "../model/structuralMutation";

export type StructuralMutationGuardResult =
  | { kind: "allowed" }
  | Extract<
      StructuralMutationResult,
      { kind: "Forbidden" | "NotFound" | "Conflict" }
    >;

export function guardStructuralMutation(input: {
  operation: StructuralOperation;
  actor: { householdId: string; canWriteLedger: boolean };
  targetIds: readonly string[];
  expectedVersions: Readonly<Record<string, number>>;
  state: StructuralLedgerState;
}): StructuralMutationGuardResult {
  if (!input.actor.canWriteLedger) {
    return { kind: "Forbidden", code: "LEDGER_WRITE_FORBIDDEN" };
  }

  if (input.operation === "cancel-captured-lineage") {
    const claims = input.targetIds.map((claimId) =>
      input.state.claims.find(
        (claim) =>
          claim.claimId === claimId &&
          claim.householdId === input.actor.householdId,
      ),
    );
    if (claims.some((claim) => claim === undefined)) return { kind: "NotFound" };
    if (
      claims.some(
        (claim) =>
          claim !== undefined &&
          input.expectedVersions[claim.claimId] !== claim.version,
      )
    ) {
      return { kind: "Conflict", code: "LINEAGE_VERSION_MISMATCH" };
    }
    return { kind: "allowed" };
  }

  const transactions = input.targetIds.map((transactionId) =>
    input.state.transactions.find(
      (transaction) =>
        transaction.transactionId === transactionId &&
        transaction.householdId === input.actor.householdId,
    ),
  );
  if (transactions.some((transaction) => transaction === undefined)) {
    return { kind: "NotFound" };
  }
  if (
    transactions.some(
      (transaction) =>
        transaction !== undefined &&
        input.expectedVersions[transaction.transactionId] !==
          transaction.aggregateVersion,
    )
  ) {
    return { kind: "Conflict", code: "VERSION_MISMATCH" };
  }
  return { kind: "allowed" };
}
