import {
  HOUSEHOLD_QUERY_CONTRACT_VERSION,
  type HouseholdQueryEnvelope,
  type HouseholdQueryName,
  type HouseholdQueryOutcome,
  type HouseholdQueryPayloads,
  type HouseholdQueryResults,
} from './householdQueryContract';

export interface HouseholdQueryTransport {
  send<Name extends HouseholdQueryName>(
    envelope: HouseholdQueryEnvelope<Name>
  ): Promise<HouseholdQueryOutcome<HouseholdQueryResults[Name]>>;
}

export class HouseholdQueryError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(`조회가 거부되었습니다: ${code}`);
    this.name = 'HouseholdQueryError';
  }
}

function queryId(): string {
  return `web-query-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export class HouseholdQueryClient {
  constructor(
    private readonly transport: HouseholdQueryTransport,
    private readonly resolveHouseholdId: () => string | undefined
  ) {}

  async execute<Name extends HouseholdQueryName>(
    query: Name,
    payload: HouseholdQueryPayloads[Name],
    options: { householdId?: string } = {}
  ): Promise<HouseholdQueryResults[Name]> {
    const householdId = options.householdId ?? this.resolveHouseholdId();
    if (!householdId) throw new HouseholdQueryError('HOUSEHOLD_ID_REQUIRED', false);
    const id = queryId();
    const outcome = await this.transport.send({
      contractVersion: HOUSEHOLD_QUERY_CONTRACT_VERSION,
      queryId: id,
      householdId,
      query,
      payload,
    });
    if (outcome.kind === 'rejected') {
      throw new HouseholdQueryError(outcome.error.code, outcome.error.retryable);
    }
    return outcome.value;
  }
}
