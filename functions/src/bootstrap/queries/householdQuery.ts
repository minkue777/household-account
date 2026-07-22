import type {
  HouseholdAdministratorActor,
  HouseholdCommandActor,
} from "../commands/householdCommand";

export const HOUSEHOLD_QUERY_CONTRACT_VERSION = "household-query.v1" as const;

export interface HouseholdQueryEnvelope {
  readonly contractVersion: typeof HOUSEHOLD_QUERY_CONTRACT_VERSION;
  readonly queryId: string;
  readonly householdId: string;
  readonly query: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type HouseholdQueryResult =
  | { readonly kind: "success"; readonly queryId: string; readonly data: unknown }
  | {
      readonly kind: "error";
      readonly queryId?: string;
      readonly code: string;
      readonly retryable: boolean;
    };

export interface HouseholdQueryExecutionContext {
  readonly envelope: HouseholdQueryEnvelope;
  readonly principalUid: string;
  readonly actor?: HouseholdCommandActor;
  readonly administrator?: HouseholdAdministratorActor;
}

export interface HouseholdQueryHandler {
  execute(context: HouseholdQueryExecutionContext): Promise<unknown>;
}

export class HouseholdQueryRejection extends Error {
  readonly name = "HouseholdQueryRejection";

  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}

export function requireHouseholdQueryActor(
  context: HouseholdQueryExecutionContext,
): HouseholdCommandActor {
  if (context.actor === undefined) {
    throw new HouseholdQueryRejection("FORBIDDEN");
  }
  return context.actor;
}

export function requireHouseholdReadScope(
  context: HouseholdQueryExecutionContext,
): { readonly householdId: string; readonly actingMemberId?: string } {
  if (context.actor !== undefined) {
    return {
      householdId: context.actor.householdId,
      actingMemberId: context.actor.actingMemberId,
    };
  }
  if (
    context.administrator?.capabilities.includes("admin.household-data.read") ===
    true
  ) {
    return { householdId: context.envelope.householdId };
  }
  throw new HouseholdQueryRejection("FORBIDDEN");
}
