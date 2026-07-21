import type {
  CancellationPreparationResult,
  CancellationQueryPreparationInputPort,
} from "./ports/in/cancellationQueryPreparationInputPort";
import type { CancellationMatchInputPort } from "./ports/in/cancellationMatchInputPort";
import type { CancellationQueryIdPort } from "./ports/out/cancellationQueryIdPort";
import {
  normalizeCancellationCard,
  normalizeCancellationMerchant,
} from "../domain/value-objects/cancellationEvidence";
import { parseLocalDate } from "../domain/value-objects/localDate";

export interface CancellationQueryPreparationDependencies {
  readonly cancellationMatch: Pick<
    CancellationMatchInputPort,
    "buildSearchWindow"
  >;
  readonly ids: CancellationQueryIdPort;
}

class DefaultCancellationQueryPreparationApplication
  implements CancellationQueryPreparationInputPort
{
  constructor(
    private readonly dependencies: CancellationQueryPreparationDependencies,
  ) {}

  prepare(
    input: Parameters<CancellationQueryPreparationInputPort["prepare"]>[0],
  ): CancellationPreparationResult {
    const householdId = input.actor?.householdId.trim();
    if (householdId === undefined || householdId === "") {
      return { kind: "Rejected", code: "HOUSEHOLD_REQUIRED" };
    }

    const observedDate = parseLocalDate(input.observation.observedDate);
    if (observedDate === undefined) {
      return { kind: "Rejected", code: "OBSERVED_DATE_INVALID" };
    }

    const cancellationDate =
      input.observation.cancellationDate === null
        ? null
        : (parseLocalDate(input.observation.cancellationDate)?.value ?? null);
    const normalizedMerchant = normalizeCancellationMerchant(
      input.merchantMapping?.replacementMerchant ?? input.observation.merchant,
    );
    const normalizedCard = normalizeCancellationCard(input.observation.card);
    const observation = {
      cancellationDate,
      observedDate: observedDate.value,
      amountInWon: input.observation.amountInWon,
      merchant: normalizedMerchant,
      card: normalizedCard,
    };

    return {
      kind: "Prepared",
      query: {
        queryId: this.dependencies.ids.nextId(),
        householdId,
        observation,
        searchWindow: this.dependencies.cancellationMatch.buildSearchWindow({
          cancellationDate: observation.cancellationDate,
          observedDate: observation.observedDate,
        }),
      },
    };
  }
}

export function createCancellationQueryPreparationApplication(
  dependencies: CancellationQueryPreparationDependencies,
): CancellationQueryPreparationInputPort {
  return new DefaultCancellationQueryPreparationApplication(dependencies);
}
