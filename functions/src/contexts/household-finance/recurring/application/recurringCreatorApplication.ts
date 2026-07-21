import {
  hasRecurringPlanCreator,
  type CreatorMappedRecurringPlan,
  type RecurringPlan,
} from "../domain/model/recurringPlan";
import type {
  MapLegacyRecurringCreatorResult,
  ProcessRecurringCreatorResult,
  RecurringCreatorInputPort,
  RecurringMigrationActor,
  RecurringProcessSystemActor,
} from "./ports/in/recurringCreatorInputPort";
import type {
  RecurringCreatorClockPort,
  RecurringCreatorLedgerPort,
  RecurringCreatorStorePort,
  RecurringMemberIdentityPort,
} from "./ports/out/recurringCreatorPorts";

export interface RecurringCreatorApplicationDependencies {
  store: RecurringCreatorStorePort;
  members: RecurringMemberIdentityPort;
  ledger: RecurringCreatorLedgerPort;
  clock: RecurringCreatorClockPort;
}

function creatorPlanView(plan: CreatorMappedRecurringPlan) {
  return { ...plan };
}

function findPlan(
  plans: readonly RecurringPlan[],
  planId: string,
): RecurringPlan | undefined {
  return plans.find(
    (plan) => plan.planId === planId && plan.lifecycleState === "active",
  );
}

function receiptMatches(
  receipt: {
    householdId: string;
    planId: string;
    creatorMemberId: string;
    migrationActorId: string;
    previousPlanVersion: number;
  },
  actor: RecurringMigrationActor,
  input: {
    householdId: string;
    planId: string;
    creatorMemberId: string;
    expectedVersion: number;
  },
): boolean {
  return (
    receipt.householdId === input.householdId &&
    receipt.planId === input.planId &&
    receipt.creatorMemberId === input.creatorMemberId &&
    receipt.migrationActorId === actor.actorId &&
    receipt.previousPlanVersion === input.expectedVersion
  );
}

class DefaultRecurringCreatorApplication implements RecurringCreatorInputPort {
  constructor(private readonly dependencies: RecurringCreatorApplicationDependencies) {}

  async mapLegacyCreator(
    actor: RecurringMigrationActor,
    input: {
      commandId: string;
      householdId: string;
      planId: string;
      creatorMemberId: string;
      expectedVersion: number;
    },
  ): Promise<MapLegacyRecurringCreatorResult> {
    if (!actor.capabilities.includes("recurring.migrate")) {
      return { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
    }
    const initial = await this.dependencies.store.read();
    const receipt = initial.receipts.find(
      (candidate) => candidate.commandId === input.commandId,
    );
    if (receipt !== undefined) {
      if (!receiptMatches(receipt, actor, input)) {
        return {
          kind: "conflict",
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        };
      }
      const plan = findPlan(initial.plans, receipt.planId);
      if (plan !== undefined && hasRecurringPlanCreator(plan)) {
        return { kind: "already-processed", plan: creatorPlanView(plan) };
      }
    }

    const initialPlan = findPlan(initial.plans, input.planId);
    if (initialPlan === undefined) {
      return { kind: "not-found", code: "PLAN_NOT_FOUND" };
    }
    if (initialPlan.householdId !== input.householdId) {
      return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
    }
    if (hasRecurringPlanCreator(initialPlan)) {
      return initialPlan.creatorMemberId === input.creatorMemberId
        ? {
            kind: "already-processed",
            plan: creatorPlanView(initialPlan),
          }
        : { kind: "conflict", code: "CREATOR_ALREADY_ASSIGNED" };
    }
    if (initialPlan.version !== input.expectedVersion) {
      return {
        kind: "conflict",
        code: "PLAN_VERSION_MISMATCH",
        currentVersion: initialPlan.version,
      };
    }
    if (
      !(await this.dependencies.members.belongsToHousehold(
        input.householdId,
        input.creatorMemberId,
      ))
    ) {
      return {
        kind: "validation-error",
        code: "CREATOR_MEMBER_NOT_IN_HOUSEHOLD",
      };
    }

    return this.dependencies.store.transact<MapLegacyRecurringCreatorResult>(
      (current) => {
        const concurrentReceipt = current.receipts.find(
          (candidate) => candidate.commandId === input.commandId,
        );
        if (concurrentReceipt !== undefined) {
          if (!receiptMatches(concurrentReceipt, actor, input)) {
            return {
              state: current,
              value: {
                kind: "conflict",
                code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
              },
            };
          }
          const mapped = findPlan(current.plans, concurrentReceipt.planId);
          if (mapped !== undefined && hasRecurringPlanCreator(mapped)) {
            return {
              state: current,
              value: {
                kind: "already-processed",
                plan: creatorPlanView(mapped),
              },
            };
          }
        }
        const latest = findPlan(current.plans, input.planId);
        if (latest === undefined) {
          return {
            state: current,
            value: { kind: "not-found", code: "PLAN_NOT_FOUND" },
          };
        }
        if (latest.householdId !== input.householdId) {
          return {
            state: current,
            value: { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" },
          };
        }
        if (hasRecurringPlanCreator(latest)) {
          return {
            state: current,
            value:
              latest.creatorMemberId === input.creatorMemberId
                ? {
                    kind: "already-processed",
                    plan: creatorPlanView(latest),
                  }
                : { kind: "conflict", code: "CREATOR_ALREADY_ASSIGNED" },
          };
        }
        if (latest.version !== input.expectedVersion) {
          return {
            state: current,
            value: {
              kind: "conflict",
              code: "PLAN_VERSION_MISMATCH",
              currentVersion: latest.version,
            },
          };
        }

        const migratedAt = this.dependencies.clock.now();
        const mapped: CreatorMappedRecurringPlan = {
          ...latest,
          creatorMemberId: input.creatorMemberId,
          updatedAt: migratedAt,
          version: latest.version + 1,
        };
        return {
          state: {
            ...current,
            plans: current.plans.map((plan) =>
              plan.planId === mapped.planId ? mapped : plan,
            ),
            receipts: [
              ...current.receipts,
              {
                commandId: input.commandId,
                householdId: input.householdId,
                planId: input.planId,
                creatorMemberId: input.creatorMemberId,
                migrationActorId: actor.actorId,
                migratedAt,
                previousPlanVersion: latest.version,
              },
            ],
            events: [
              ...current.events,
              {
                eventType: "RecurringPlanChanged.v1",
                householdId: mapped.householdId,
                planId: mapped.planId,
                active: mapped.active,
                dayOfMonth: mapped.dayOfMonth,
                changeKind: "updated",
                planVersion: mapped.version,
              },
            ],
          },
          value: { kind: "success", plan: creatorPlanView(mapped) },
        };
      },
    );
  }

  async processRecurringMonthWithCreator(
    actor: RecurringProcessSystemActor,
    input: {
      householdId: string;
      planId: string;
      targetMonth: string;
    },
  ): Promise<ProcessRecurringCreatorResult> {
    if (!actor.capabilities.includes("recurring.process")) {
      return { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
    }
    const state = await this.dependencies.store.read();
    const plan = findPlan(state.plans, input.planId);
    if (plan === undefined) {
      return { kind: "not-found", code: "PLAN_NOT_FOUND" };
    }
    if (plan.householdId !== input.householdId) {
      return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
    }
    if (!hasRecurringPlanCreator(plan)) {
      return {
        kind: "conflict",
        code: "LEGACY_CREATOR_MAPPING_REQUIRED",
      };
    }
    return this.dependencies.ledger.recordRecurringTransaction({
      householdId: input.householdId,
      plan,
      targetMonth: input.targetMonth,
      idempotencyKey: `${plan.planId}:${input.targetMonth}`,
    });
  }
}

export function createRecurringCreatorApplication(
  dependencies: RecurringCreatorApplicationDependencies,
): RecurringCreatorInputPort {
  return new DefaultRecurringCreatorApplication(dependencies);
}
