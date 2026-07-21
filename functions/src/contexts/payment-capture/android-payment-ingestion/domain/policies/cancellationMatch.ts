import type {
  CancellationCandidateFact,
  CancellationMatchResult,
  CancellationObservation,
} from "../model/cancellationMatch";
import {
  cancellationCardsEqual,
  normalizeCancellationMerchant,
} from "../value-objects/cancellationEvidence";

function amountMatches(
  observationAmount: number,
  candidate: CancellationCandidateFact,
): boolean {
  if (!Number.isSafeInteger(observationAmount) || observationAmount <= 0) {
    return false;
  }

  if (candidate.monthlySplit === undefined) {
    return (
      Number.isSafeInteger(candidate.amountInWon) &&
      candidate.amountInWon === observationAmount
    );
  }

  const { groupTotalInWon, splitCount } = candidate.monthlySplit;
  if (
    !Number.isSafeInteger(groupTotalInWon) ||
    groupTotalInWon <= 0 ||
    !Number.isSafeInteger(splitCount) ||
    splitCount <= 0
  ) {
    return false;
  }

  const downwardDifference = observationAmount - groupTotalInWon;
  return downwardDifference >= 0 && downwardDifference <= splitCount - 1;
}

function isCompleteMatch(
  observation: CancellationObservation,
  candidate: CancellationCandidateFact,
): boolean {
  const observationMerchant = normalizeCancellationMerchant(
    observation.merchant,
  );
  return (
    observationMerchant !== "" &&
    observationMerchant === normalizeCancellationMerchant(candidate.merchant) &&
    amountMatches(observation.amountInWon, candidate) &&
    cancellationCardsEqual(observation.card, candidate.card)
  );
}

export function decideCancellationMatchPolicy(input: {
  readonly observation: CancellationObservation;
  readonly candidates: readonly CancellationCandidateFact[];
}): CancellationMatchResult {
  const matchingLineageIds = [
    ...new Set(
      input.candidates
        .filter((candidate) => isCompleteMatch(input.observation, candidate))
        .map((candidate) => candidate.captureLineageId),
    ),
  ].sort((left, right) => left.localeCompare(right, "en"));

  if (matchingLineageIds.length === 0) {
    return { kind: "notFound", resource: "cancellationTarget" };
  }
  if (matchingLineageIds.length === 1) {
    return { kind: "matched", captureLineageId: matchingLineageIds[0] };
  }
  return { kind: "needsConfirmation", captureLineageIds: matchingLineageIds };
}
