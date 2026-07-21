import {
  AdminConsoleResult,
  AdminHouseholdPage,
  AdminHouseholdView,
  VerifiedAdminActor,
} from "./ports/in/adminHouseholdConsoleInputPort";
import {
  AdminHouseholdClockPort,
  AdminHouseholdIdentityPort,
  AdminHouseholdStorePort,
} from "./ports/out/adminHouseholdStorePort";
import { AdminHousehold } from "../domain/model/adminHousehold";
import {
  deleteHouseholdLogically,
  sortHouseholdsForAdmin,
  validateHouseholdName,
} from "../domain/policies/adminHouseholdPolicy";

export interface AdminHouseholdConsoleApplicationDependencies {
  store: AdminHouseholdStorePort;
  identities: AdminHouseholdIdentityPort;
  clock: AdminHouseholdClockPort;
}

export interface AdminHouseholdConsoleUseCases {
  open(
    actor: VerifiedAdminActor,
  ): Promise<AdminConsoleResult<"opened">>;
  listHouseholds(
    actor: VerifiedAdminActor | undefined,
    input: { cursor?: string; limit: number },
  ): Promise<AdminConsoleResult<AdminHouseholdPage>>;
  createHousehold(
    actor: VerifiedAdminActor | undefined,
    input: { name: string; idempotencyKey: string },
  ): Promise<AdminConsoleResult<AdminHouseholdView>>;
  readLegacyShareKey(
    actor: VerifiedAdminActor | undefined,
    householdId: string,
  ): Promise<AdminConsoleResult<string>>;
  deleteHousehold(
    actor: VerifiedAdminActor | undefined,
    input: {
      householdId: string;
      confirmed: boolean;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ): Promise<AdminConsoleResult<AdminHouseholdView>>;
}

function hasCapability(
  actor: VerifiedAdminActor | undefined,
  capability:
    | "admin.households.read"
    | "admin.households.write"
    | "household.delete",
): actor is VerifiedAdminActor {
  return actor !== undefined && actor.capabilities.includes(capability);
}

function forbidden<T>(): AdminConsoleResult<T> {
  return { kind: "forbidden", code: "ADMIN_CAPABILITY_REQUIRED" };
}

function toView(household: AdminHousehold): AdminHouseholdView {
  return {
    householdId: household.householdId,
    name: household.name,
    createdAt: household.createdAt,
    lifecycleState: household.lifecycleState,
    aggregateVersion: household.aggregateVersion,
    ...(household.legacyShareKey === undefined
      ? {}
      : { legacyShareKey: household.legacyShareKey }),
  };
}

function cursorOffset(cursor: string | undefined): number | undefined {
  if (cursor === undefined) {
    return 0;
  }
  const match = /^admin-household-offset:(\d+)$/.exec(cursor);
  return match === null ? undefined : Number(match[1]);
}

class DefaultAdminHouseholdConsoleApplication
  implements AdminHouseholdConsoleUseCases
{
  constructor(
    private readonly dependencies: AdminHouseholdConsoleApplicationDependencies,
  ) {}

  async open(
    actor: VerifiedAdminActor,
  ): Promise<AdminConsoleResult<"opened">> {
    return hasCapability(actor, "admin.households.read")
      ? { kind: "success", value: "opened" }
      : forbidden();
  }

  async listHouseholds(
    actor: VerifiedAdminActor | undefined,
    input: { cursor?: string; limit: number },
  ): Promise<AdminConsoleResult<AdminHouseholdPage>> {
    if (!hasCapability(actor, "admin.households.read")) {
      return forbidden();
    }
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
      return { kind: "validation-error", code: "INVALID_PAGE_LIMIT" };
    }
    const offset = cursorOffset(input.cursor);
    if (offset === undefined) {
      return { kind: "validation-error", code: "INVALID_PAGE_CURSOR" };
    }

    const state = await this.dependencies.store.read();
    const ordered = sortHouseholdsForAdmin(state.households);
    const items = ordered.slice(offset, offset + input.limit).map(toView);
    const nextOffset = offset + items.length;
    return {
      kind: "success",
      value: {
        items,
        ...(nextOffset < ordered.length
          ? { nextCursor: `admin-household-offset:${nextOffset}` }
          : {}),
      },
    };
  }

  async createHousehold(
    actor: VerifiedAdminActor | undefined,
    input: { name: string; idempotencyKey: string },
  ): Promise<AdminConsoleResult<AdminHouseholdView>> {
    if (!hasCapability(actor, "admin.households.write")) {
      return forbidden();
    }
    const name = validateHouseholdName(input.name);
    if (name.kind === "invalid") {
      return { kind: "validation-error", code: name.code };
    }

    return this.dependencies.store.transact<
      AdminConsoleResult<AdminHouseholdView>
    >((current) => {
      const household: AdminHousehold = {
        householdId: this.dependencies.identities.nextHouseholdId(
          input.idempotencyKey,
        ),
        name: name.name,
        createdAt: this.dependencies.clock.now(),
        lifecycleState: "active",
        aggregateVersion: 1,
        legacyShareKey: this.dependencies.identities.nextLegacyShareKey(
          input.idempotencyKey,
        ),
      };
      return {
        state: {
          households: [...current.households, household],
          events: [
            ...current.events,
            { eventType: "HouseholdCreated.v1", householdId: household.householdId },
          ],
        },
        value: { kind: "success", value: toView(household) },
      };
    });
  }

  async readLegacyShareKey(
    actor: VerifiedAdminActor | undefined,
    householdId: string,
  ): Promise<AdminConsoleResult<string>> {
    if (!hasCapability(actor, "admin.households.read")) {
      return forbidden();
    }
    const state = await this.dependencies.store.read();
    const household = state.households.find(
      (candidate) => candidate.householdId === householdId,
    );
    if (household?.legacyShareKey === undefined) {
      return { kind: "validation-error", code: "LEGACY_SHARE_KEY_NOT_FOUND" };
    }
    return { kind: "success", value: household.legacyShareKey };
  }

  async deleteHousehold(
    actor: VerifiedAdminActor | undefined,
    input: {
      householdId: string;
      confirmed: boolean;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ): Promise<AdminConsoleResult<AdminHouseholdView>> {
    if (
      !hasCapability(actor, "admin.households.write") ||
      !hasCapability(actor, "household.delete")
    ) {
      return forbidden();
    }

    return this.dependencies.store.transact<
      AdminConsoleResult<AdminHouseholdView>
    >((current) => {
      const existing = current.households.find(
        (household) => household.householdId === input.householdId,
      );
      const decision = deleteHouseholdLogically({
        household: existing,
        confirmed: input.confirmed,
        expectedVersion: input.expectedVersion,
      });
      if (decision.kind !== "success") {
        return { state: current, value: decision };
      }

      const changed = decision.household !== existing;
      return {
        state: changed
          ? {
              households: current.households.map((household) =>
                household.householdId === decision.household.householdId
                  ? decision.household
                  : household,
              ),
              events: [
                ...current.events,
                {
                  eventType: "HouseholdDeleted.v1" as const,
                  householdId: decision.household.householdId,
                },
              ],
            }
          : current,
        value: { kind: "success", value: toView(decision.household) },
      };
    });
  }
}

export function createAdminHouseholdConsoleApplication(
  dependencies: AdminHouseholdConsoleApplicationDependencies,
): AdminHouseholdConsoleUseCases {
  return new DefaultAdminHouseholdConsoleApplication(dependencies);
}
