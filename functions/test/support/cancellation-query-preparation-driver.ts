import { createCancellationMatchApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/cancellationMatchApplication";
import { createCancellationQueryPreparationApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/cancellationQueryPreparationApplication";
import type { CancellationQueryIdPort } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/cancellationQueryIdPort";
import type {
  CancellationPreparationResult,
  CancellationQueryPreparationInputPort,
  PreparedCancellationCandidateQuery,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  CancellationPreparationActor,
  CancellationPreparationObservation,
  CancellationPreparationResult,
  CancellationQueryPreparationInputPort,
  PreparedCancellationCandidateQuery,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface CancellationPreparationState {
  readonly candidateQueries: readonly PreparedCancellationCandidateQuery[];
  readonly ledgerWrites: readonly string[];
}

export interface CancellationQueryPreparationDriver
  extends CancellationQueryPreparationInputPort {
  state(): CancellationPreparationState;
}

class SequentialCancellationQueryIds implements CancellationQueryIdPort {
  private sequence = 0;

  nextId(): string {
    this.sequence += 1;
    return `cancellation-query-${this.sequence}`;
  }
}

function cloneQuery(
  query: PreparedCancellationCandidateQuery,
): PreparedCancellationCandidateQuery {
  return {
    ...query,
    observation: {
      ...query.observation,
      card: { ...query.observation.card },
    },
    searchWindow: { ...query.searchWindow },
  };
}

class DefaultCancellationQueryPreparationDriver
  implements CancellationQueryPreparationDriver
{
  private readonly candidateQueries: PreparedCancellationCandidateQuery[] = [];

  constructor(private readonly application: CancellationQueryPreparationInputPort) {}

  prepare(
    input: Parameters<CancellationQueryPreparationInputPort["prepare"]>[0],
  ): CancellationPreparationResult {
    const result = this.application.prepare(input);
    if (result.kind === "Prepared") {
      this.candidateQueries.push(cloneQuery(result.query));
    }
    return result;
  }

  state(): CancellationPreparationState {
    return {
      candidateQueries: this.candidateQueries.map(cloneQuery),
      ledgerWrites: [],
    };
  }
}

export function createCancellationQueryPreparationDriver(): CancellationQueryPreparationDriver {
  const application = createCancellationQueryPreparationApplication({
    cancellationMatch: createCancellationMatchApplication(),
    ids: new SequentialCancellationQueryIds(),
  });
  return new DefaultCancellationQueryPreparationDriver(application);
}
