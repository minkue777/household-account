import { createTenantAuthorizationApplication } from "../../src/contexts/access/tenant-authorization/application/tenantAuthorizationApplication";
import type { TenantAuthorizationMembershipPort } from "../../src/contexts/access/tenant-authorization/application/ports/out/tenantAuthorizationMembershipPort";
import type { AccessMembership } from "../../src/contexts/access/membership/domain/model/accessMembership";
import type {
  AuthenticatedTenantRequester,
  TenantAuthorizationInputPort,
  TenantCollection,
  TenantOperation,
  TenantOperationResult,
} from "../../src/contexts/access/public";

export interface TenantAuthorizationRecord {
  collection: TenantCollection;
  householdId?: string;
  valueDigest: string;
}

export interface TenantAuthorizationFixture {
  memberships?: readonly AccessMembership[];
  records?: Readonly<Record<string, TenantAuthorizationRecord>>;
}

export interface TenantAuthorizationSnapshot {
  records: Readonly<Record<string, TenantAuthorizationRecord>>;
}

export interface TenantAuthorizationFixtureSubject
  extends TenantAuthorizationInputPort {
  execute(
    requester: AuthenticatedTenantRequester | undefined,
    operation: TenantOperation,
  ): Promise<TenantOperationResult>;
  snapshot(): Promise<TenantAuthorizationSnapshot>;
  publishedEvents(): Promise<readonly { eventType: string }[]>;
}

const DEFAULT_MEMBERSHIPS: readonly AccessMembership[] = [
  {
    principalUid: "uid-a",
    householdId: "house-a",
    memberId: "member-a",
    status: "active",
  },
  {
    principalUid: "uid-b",
    householdId: "house-b",
    memberId: "member-b",
    status: "active",
  },
];

const DEFAULT_RECORDS: Readonly<Record<string, TenantAuthorizationRecord>> = {
  "house-a": {
    collection: "households",
    householdId: "house-a",
    valueDigest: "household-a-v1",
  },
  "house-b": {
    collection: "households",
    householdId: "house-b",
    valueDigest: "household-b-v1",
  },
  "transaction-a": {
    collection: "transactions",
    householdId: "house-a",
    valueDigest: "transaction-a-v1",
  },
  "transaction-b": {
    collection: "transactions",
    householdId: "house-b",
    valueDigest: "transaction-b-v1",
  },
  "notificationEndpoints-a": {
    collection: "notificationEndpoints",
    householdId: "house-a",
    valueDigest: "endpoint-a-v1",
  },
  "notificationDebugLogs-a": {
    collection: "notificationDebugLogs",
    householdId: "house-a",
    valueDigest: "debug-a-v1",
  },
  "providerHealth-a": {
    collection: "providerHealth",
    valueDigest: "provider-health-v1",
  },
};

function cloneMembership(
  membership: AccessMembership,
): AccessMembership {
  return { ...membership };
}

function cloneRecords(
  records: Readonly<Record<string, TenantAuthorizationRecord>>,
): Record<string, TenantAuthorizationRecord> {
  const cloned: Record<string, TenantAuthorizationRecord> = {};
  for (const [recordId, record] of Object.entries(records)) {
    cloned[recordId] = { ...record };
  }
  return cloned;
}

class FixtureTenantMemberships implements TenantAuthorizationMembershipPort {
  private readonly memberships: readonly AccessMembership[];

  constructor(memberships: readonly AccessMembership[]) {
    this.memberships = memberships.map(cloneMembership);
  }

  async findByPrincipalUid(
    principalUid: string,
  ): Promise<AccessMembership | undefined> {
    const membership = this.memberships.find(
      (candidate) => candidate.principalUid === principalUid,
    );
    return membership === undefined ? undefined : cloneMembership(membership);
  }
}

class FixtureTenantAuthorizationDriver
  implements TenantAuthorizationFixtureSubject
{
  private readonly records: Record<string, TenantAuthorizationRecord>;

  constructor(
    private readonly application: TenantAuthorizationInputPort,
    records: Readonly<Record<string, TenantAuthorizationRecord>>,
  ) {
    this.records = cloneRecords(records);
  }

  resolveActorContext(
    ...args: Parameters<TenantAuthorizationInputPort["resolveActorContext"]>
  ) {
    return this.application.resolveActorContext(...args);
  }

  authorizeHouseholdAction(
    ...args: Parameters<
      TenantAuthorizationInputPort["authorizeHouseholdAction"]
    >
  ) {
    return this.application.authorizeHouseholdAction(...args);
  }

  async execute(
    requester: AuthenticatedTenantRequester | undefined,
    operation: TenantOperation,
  ): Promise<TenantOperationResult> {
    const resolved = await this.application.resolveActorContext(requester);
    if (resolved.kind !== "resolved") {
      return resolved;
    }

    const storedRecord =
      operation.recordId === undefined
        ? undefined
        : this.records[operation.recordId];
    const authorization = this.application.authorizeHouseholdAction(
      resolved.actorContext,
      operation,
      storedRecord === undefined
        ? undefined
        : { householdId: storedRecord.householdId },
    );
    if (authorization.kind !== "allowed") {
      return authorization;
    }

    if (operation.action === "list") {
      const householdId =
        resolved.actorContext.principalKind === "member"
          ? resolved.actorContext.householdId
          : operation.householdId;
      const visibleRecordIds = Object.entries(this.records)
        .filter(
          ([, record]) =>
            record.collection === operation.collection &&
            (householdId === undefined || record.householdId === householdId),
        )
        .map(([recordId]) => recordId)
        .sort();
      return { kind: "allowed", visibleRecordIds };
    }

    if (operation.action === "read") {
      return { kind: "allowed" };
    }

    if (operation.recordId === undefined) {
      return { kind: "validation-error", code: "HOUSEHOLD_ID_REQUIRED" };
    }
    if (operation.action === "delete") {
      delete this.records[operation.recordId];
    } else {
      this.records[operation.recordId] = {
        collection: operation.collection,
        ...(operation.nextHouseholdId === undefined
          ? {}
          : { householdId: operation.nextHouseholdId }),
        valueDigest: `${operation.action}:${operation.recordId}`,
      };
    }
    return { kind: "allowed", changedRecordId: operation.recordId };
  }

  async snapshot(): Promise<TenantAuthorizationSnapshot> {
    return { records: cloneRecords(this.records) };
  }

  async publishedEvents(): Promise<readonly { eventType: string }[]> {
    return [];
  }
}

export function createTenantAuthorizationFixtureSubject(
  fixture: TenantAuthorizationFixture = {},
): TenantAuthorizationFixtureSubject {
  const application = createTenantAuthorizationApplication({
    memberships: new FixtureTenantMemberships(
      fixture.memberships ?? DEFAULT_MEMBERSHIPS,
    ),
  });
  return new FixtureTenantAuthorizationDriver(
    application,
    fixture.records ?? DEFAULT_RECORDS,
  );
}
