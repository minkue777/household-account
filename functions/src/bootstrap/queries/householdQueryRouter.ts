import type { HouseholdCommandMembershipPort } from "../commands/householdCommandPorts";
import {
  HOUSEHOLD_QUERY_CONTRACT_VERSION,
  HouseholdQueryRejection,
  type HouseholdQueryEnvelope,
  type HouseholdQueryHandler,
  type HouseholdQueryResult,
} from "./householdQuery";
import type { HouseholdAdministratorActor } from "../commands/householdCommand";

const ADMINISTRATOR_OR_MEMBER_QUERIES = new Set([
  "ledger.get-transaction.v1",
  "portfolio.search-instruments.v1",
  "portfolio.get-instrument-quote.v1",
  "portfolio.get-dividend-projection.v1",
  "access.list-asset-owner-profiles.v1",
]);

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const QUERY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9][0-9]*$/u;
const RESERVED_IDENTITY_FIELDS = new Set([
  "principalUid",
  "actingMemberId",
  "actor",
  "role",
  "capabilities",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 160 &&
    STABLE_ID_PATTERN.test(value)
  );
}

function containsReservedIdentityField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsReservedIdentityField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      RESERVED_IDENTITY_FIELDS.has(key) || containsReservedIdentityField(nested),
  );
}

function failure(
  code: string,
  input: { readonly queryId?: string; readonly retryable?: boolean } = {},
): HouseholdQueryResult {
  return {
    kind: "error",
    code,
    retryable: input.retryable ?? false,
    ...(input.queryId === undefined ? {} : { queryId: input.queryId }),
  };
}

function parseEnvelope(raw: unknown): HouseholdQueryEnvelope | HouseholdQueryResult {
  if (!isRecord(raw)) return failure("INVALID_CONTRACT");
  if (raw.contractVersion !== HOUSEHOLD_QUERY_CONTRACT_VERSION) {
    return failure("UNSUPPORTED_CONTRACT_VERSION");
  }
  if (!stableId(raw.queryId)) return failure("QUERY_ID_REQUIRED");
  if (!stableId(raw.householdId)) {
    return failure("HOUSEHOLD_ID_REQUIRED", { queryId: raw.queryId.trim() });
  }
  if (
    typeof raw.query !== "string" ||
    raw.query.length > 120 ||
    !QUERY_PATTERN.test(raw.query)
  ) {
    return failure("QUERY_REQUIRED", { queryId: raw.queryId.trim() });
  }
  if (!isRecord(raw.payload)) {
    return failure("INVALID_CONTRACT", { queryId: raw.queryId.trim() });
  }
  if (containsReservedIdentityField(raw.payload)) {
    return failure("FORBIDDEN_IDENTITY_FIELD", { queryId: raw.queryId.trim() });
  }
  const allowed = new Set([
    "contractVersion",
    "queryId",
    "householdId",
    "query",
    "payload",
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    return failure("INVALID_CONTRACT", { queryId: raw.queryId.trim() });
  }
  return {
    contractVersion: HOUSEHOLD_QUERY_CONTRACT_VERSION,
    queryId: raw.queryId.trim(),
    householdId: raw.householdId.trim(),
    query: raw.query.trim(),
    payload: raw.payload,
  };
}

export function createHouseholdQueryRouter(input: {
  readonly handlers: ReadonlyMap<string, HouseholdQueryHandler>;
  readonly memberships: HouseholdCommandMembershipPort;
}) {
  return {
    async execute(request: {
      readonly principalUid: string | undefined;
      readonly request: unknown;
      readonly administrator?: HouseholdAdministratorActor;
    }): Promise<HouseholdQueryResult> {
      if (
        typeof request.principalUid !== "string" ||
        request.principalUid.trim() === ""
      ) {
        return failure("AUTH_REQUIRED");
      }
      const parsed = parseEnvelope(request.request);
      if ("kind" in parsed) return parsed;
      const handler = input.handlers.get(parsed.query);
      if (handler === undefined) {
        return failure("QUERY_NOT_AVAILABLE", { queryId: parsed.queryId });
      }
      const permitsAdministrator = ADMINISTRATOR_OR_MEMBER_QUERIES.has(
        parsed.query,
      );
      const verifiedAdministrator =
        request.administrator !== undefined &&
        request.administrator.principalRef === request.principalUid.trim()
          ? request.administrator
          : undefined;
      const membership =
        permitsAdministrator && verifiedAdministrator !== undefined
          ? undefined
          : await input.memberships.resolveActor({
              principalUid: request.principalUid.trim(),
              householdId: parsed.householdId,
            });
      if (membership !== undefined && membership.kind !== "active") {
        return failure("FORBIDDEN", { queryId: parsed.queryId });
      }
      try {
        const data = await handler.execute({
          envelope: parsed,
          principalUid: request.principalUid.trim(),
          ...(membership?.kind === "active" ? { actor: membership.actor } : {}),
          ...(verifiedAdministrator !== undefined && permitsAdministrator
            ? { administrator: verifiedAdministrator }
            : {}),
        });
        return { kind: "success", queryId: parsed.queryId, data };
      } catch (caught) {
        if (caught instanceof HouseholdQueryRejection) {
          return failure(caught.code, {
            queryId: parsed.queryId,
            retryable: caught.retryable,
          });
        }
        return failure("QUERY_FAILED", {
          queryId: parsed.queryId,
          retryable: true,
        });
      }
    },
  };
}
