import type {
  CreatorMappedRecurringPlan,
  RecurringPlan,
  RecurringPlanCommandReceipt,
  RecurringPlanManagementState,
} from "../domain/model/recurringPlan";
import { hasRecurringPlanCreator } from "../domain/model/recurringPlan";
import {
  firstApplicableMonth,
  normalizeCreateFields,
  normalizeUpdatedFields,
  recurringCommandPayloadSignature,
  rejectsCreatorInjection,
} from "../domain/policies/recurringPlanPolicy";
import type {
  ManageRecurringPlanOperation,
  ManageRecurringPlanResult,
  RecurringActor,
  RecurringPlanListResult,
  RecurringPlanManagementInputPort,
  RecurringPlanView,
} from "./ports/in/recurringPlanManagementInputPort";
import type {
  RecurringCategoryReferencePort,
  RecurringPlanClockPort,
  RecurringPlanIdentityPort,
  RecurringPlanManagementStorePort,
} from "./ports/out/recurringPlanManagementPorts";

export interface RecurringPlanManagementDependencies {
  store: RecurringPlanManagementStorePort;
  clock: RecurringPlanClockPort;
  identities: RecurringPlanIdentityPort;
  categories: RecurringCategoryReferencePort;
}

function planView(plan: CreatorMappedRecurringPlan): RecurringPlanView {
  return { ...plan };
}

function receiptReplay(
  receipt: RecurringPlanCommandReceipt,
  payloadSignature: string,
): ManageRecurringPlanResult {
  return receipt.payloadSignature === payloadSignature
    ? { kind: "already-processed", plan: planView(receipt.plan) }
    : { kind: "conflict", code: "IDEMPOTENCY_KEY_REUSED" };
}

function currentPlan(
  state: RecurringPlanManagementState,
  planId: string,
): RecurringPlan | undefined {
  return state.plans.find(
    (candidate) =>
      candidate.planId === planId && candidate.lifecycleState === "active",
  );
}

function replacePlan(
  state: RecurringPlanManagementState,
  plan: RecurringPlan,
): readonly RecurringPlan[] {
  return state.plans.map((candidate) =>
    candidate.planId === plan.planId ? plan : candidate,
  );
}

function appendChange(
  state: RecurringPlanManagementState,
  input: {
    commandId: string;
    payloadSignature: string;
    resultKind: "created" | "updated" | "deleted";
    plan: CreatorMappedRecurringPlan;
  },
): Pick<RecurringPlanManagementState, "receipts" | "events"> {
  return {
    receipts: [
      ...state.receipts,
      {
        commandId: input.commandId,
        payloadSignature: input.payloadSignature,
        resultKind: input.resultKind,
        planId: input.plan.planId,
        plan: { ...input.plan },
      },
    ],
    events: [
      ...state.events,
      {
        eventType: "RecurringPlanChanged.v1",
        householdId: input.plan.householdId,
        planId: input.plan.planId,
        active: input.plan.active,
        dayOfMonth: input.plan.dayOfMonth,
        changeKind: input.resultKind,
        planVersion: input.plan.version,
      },
    ],
  };
}

function hasManageCapability(actor: RecurringActor): boolean {
  return actor.capabilities.includes("recurring.manage");
}

function hasReadCapability(actor: RecurringActor): boolean {
  return actor.capabilities.includes("recurring.read");
}

function planSort(left: RecurringPlan, right: RecurringPlan): number {
  return (
    left.dayOfMonth - right.dayOfMonth ||
    left.merchant.localeCompare(right.merchant, "ko") ||
    left.planId.localeCompare(right.planId)
  );
}

function sourceCheckpoint(plans: readonly RecurringPlan[]): string {
  return `recurring-plans:${plans
    .map((plan) => `${plan.planId}@${plan.version}`)
    .sort()
    .join("|")}`;
}

function cursorOffset(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return 0;
  const match = /^recurring-plan-cursor:(\d+)$/.exec(cursor);
  return match === null ? undefined : Number(match[1]);
}

class DefaultRecurringPlanManagementApplication
  implements RecurringPlanManagementInputPort
{
  constructor(private readonly dependencies: RecurringPlanManagementDependencies) {}

  async manage(input: {
    commandId: string;
    actor: RecurringActor;
    operation: ManageRecurringPlanOperation;
  }): Promise<ManageRecurringPlanResult> {
    if (!hasManageCapability(input.actor)) {
      return { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
    }
    const payloadSignature = recurringCommandPayloadSignature({
      householdId: input.actor.householdId,
      actingMemberId: input.actor.actingMemberId,
      operation: input.operation,
    });
    const priorReceipt = await this.dependencies.store.readReceipt(
      input.commandId,
    );
    if (priorReceipt !== undefined) {
      return receiptReplay(priorReceipt, payloadSignature);
    }
    if (rejectsCreatorInjection(input.operation as object)) {
      return {
        kind: "validation-error",
        code: "CREATOR_FIELD_NOT_ALLOWED",
      };
    }

    if (input.operation.kind === "create") {
      return this.create(
        { ...input, operation: input.operation },
        payloadSignature,
      );
    }
    if (input.operation.kind === "update") {
      return this.update(
        { ...input, operation: input.operation },
        payloadSignature,
      );
    }
    return this.delete(
      { ...input, operation: input.operation },
      payloadSignature,
    );
  }

  private async ensureCategory(
    householdId: string,
    categoryId: string,
  ): Promise<ManageRecurringPlanResult | undefined> {
    const category = await this.dependencies.categories.resolveUsableCategory(
      householdId,
      categoryId,
    );
    if (category.kind === "usable") return undefined;
    return category.kind === "not-usable"
      ? { kind: "validation-error", code: "CATEGORY_NOT_USABLE" }
      : { kind: "retryable-failure", code: category.code };
  }

  private async create(
    input: {
      commandId: string;
      actor: RecurringActor;
      operation: Extract<ManageRecurringPlanOperation, { kind: "create" }>;
    },
    payloadSignature: string,
  ): Promise<ManageRecurringPlanResult> {
    const normalized = normalizeCreateFields(input.operation);
    if (normalized.kind !== "valid") return normalized;
    const categoryFailure = await this.ensureCategory(
      input.actor.householdId,
      normalized.value.categoryId,
    );
    if (categoryFailure !== undefined) return categoryFailure;
    const firstMonth = firstApplicableMonth({
      localCreatedOn: this.dependencies.clock.localDate(),
      dayOfMonth: normalized.value.dayOfMonth,
    });
    if (firstMonth.kind !== "valid") return firstMonth;

    const now = this.dependencies.clock.now();
    const plan: CreatorMappedRecurringPlan = {
      householdId: input.actor.householdId,
      planId: this.dependencies.identities.planId(input.commandId),
      ...normalized.value,
      creatorMemberId: input.actor.actingMemberId,
      firstApplicableMonth: firstMonth.value,
      createdAt: now,
      updatedAt: now,
      lifecycleState: "active",
      version: 1,
    };
    return this.dependencies.store.transact<ManageRecurringPlanResult>(
      (current) => {
        const concurrentReceipt = current.receipts.find(
          (receipt) => receipt.commandId === input.commandId,
        );
        if (concurrentReceipt !== undefined) {
          return {
            state: current,
            value: receiptReplay(concurrentReceipt, payloadSignature),
          };
        }
        const change = appendChange(current, {
          commandId: input.commandId,
          payloadSignature,
          resultKind: "created",
          plan,
        });
        return {
          state: {
            ...current,
            plans: [...current.plans, plan],
            ...change,
          },
          value: { kind: "success", plan: planView(plan) },
        };
      },
    );
  }

  private async update(
    input: {
      commandId: string;
      actor: RecurringActor;
      operation: Extract<ManageRecurringPlanOperation, { kind: "update" }>;
    },
    payloadSignature: string,
  ): Promise<ManageRecurringPlanResult> {
    const state = await this.dependencies.store.read();
    const existing = currentPlan(state, input.operation.planId);
    if (existing === undefined) {
      return { kind: "not-found", code: "PLAN_NOT_FOUND" };
    }
    if (existing.householdId !== input.actor.householdId) {
      return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
    }
    if (!hasRecurringPlanCreator(existing)) {
      return {
        kind: "conflict",
        code: "LEGACY_CREATOR_MAPPING_REQUIRED",
      };
    }
    if (existing.version !== input.operation.expectedVersion) {
      return {
        kind: "conflict",
        code: "PLAN_VERSION_MISMATCH",
        currentVersion: existing.version,
      };
    }
    const normalized = normalizeUpdatedFields(existing, input.operation.patch);
    if (normalized.kind !== "valid") return normalized;
    const categoryFailure = await this.ensureCategory(
      input.actor.householdId,
      normalized.value.categoryId,
    );
    if (categoryFailure !== undefined) return categoryFailure;

    return this.dependencies.store.transact<ManageRecurringPlanResult>(
      (current) => {
        const concurrentReceipt = current.receipts.find(
          (receipt) => receipt.commandId === input.commandId,
        );
        if (concurrentReceipt !== undefined) {
          return {
            state: current,
            value: receiptReplay(concurrentReceipt, payloadSignature),
          };
        }
        const latest = currentPlan(current, input.operation.planId);
        if (latest === undefined) {
          return {
            state: current,
            value: { kind: "not-found", code: "PLAN_NOT_FOUND" },
          };
        }
        if (latest.householdId !== input.actor.householdId) {
          return {
            state: current,
            value: { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" },
          };
        }
        if (!hasRecurringPlanCreator(latest)) {
          return {
            state: current,
            value: {
              kind: "conflict",
              code: "LEGACY_CREATOR_MAPPING_REQUIRED",
            },
          };
        }
        if (latest.version !== input.operation.expectedVersion) {
          return {
            state: current,
            value: {
              kind: "conflict",
              code: "PLAN_VERSION_MISMATCH",
              currentVersion: latest.version,
            },
          };
        }
        const updated: CreatorMappedRecurringPlan = {
          ...latest,
          ...normalized.value,
          updatedAt: this.dependencies.clock.now(),
          version: latest.version + 1,
        };
        const change = appendChange(current, {
          commandId: input.commandId,
          payloadSignature,
          resultKind: "updated",
          plan: updated,
        });
        return {
          state: { ...current, plans: replacePlan(current, updated), ...change },
          value: { kind: "success", plan: planView(updated) },
        };
      },
    );
  }

  private async delete(
    input: {
      commandId: string;
      actor: RecurringActor;
      operation: Extract<ManageRecurringPlanOperation, { kind: "delete" }>;
    },
    payloadSignature: string,
  ): Promise<ManageRecurringPlanResult> {
    return this.dependencies.store.transact<ManageRecurringPlanResult>(
      (current) => {
        const concurrentReceipt = current.receipts.find(
          (receipt) => receipt.commandId === input.commandId,
        );
        if (concurrentReceipt !== undefined) {
          return {
            state: current,
            value: receiptReplay(concurrentReceipt, payloadSignature),
          };
        }
        const existing = currentPlan(current, input.operation.planId);
        if (existing === undefined) {
          return {
            state: current,
            value: { kind: "not-found", code: "PLAN_NOT_FOUND" },
          };
        }
        if (existing.householdId !== input.actor.householdId) {
          return {
            state: current,
            value: { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" },
          };
        }
        if (!hasRecurringPlanCreator(existing)) {
          return {
            state: current,
            value: {
              kind: "conflict",
              code: "LEGACY_CREATOR_MAPPING_REQUIRED",
            },
          };
        }
        if (existing.version !== input.operation.expectedVersion) {
          return {
            state: current,
            value: {
              kind: "conflict",
              code: "PLAN_VERSION_MISMATCH",
              currentVersion: existing.version,
            },
          };
        }
        const deleted: CreatorMappedRecurringPlan = {
          ...existing,
          lifecycleState: "deleted",
          updatedAt: this.dependencies.clock.now(),
          version: existing.version + 1,
        };
        const change = appendChange(current, {
          commandId: input.commandId,
          payloadSignature,
          resultKind: "deleted",
          plan: deleted,
        });
        return {
          state: { ...current, plans: replacePlan(current, deleted), ...change },
          value: {
            kind: "deleted",
            planId: deleted.planId,
            version: deleted.version,
          },
        };
      },
    );
  }

  async list(input: {
    actor: RecurringActor;
    householdId: string;
    active?: boolean;
    cursor?: string;
    limit: number;
  }): Promise<RecurringPlanListResult> {
    if (!hasReadCapability(input.actor)) {
      return { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
    }
    if (input.actor.householdId !== input.householdId) {
      return { kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" };
    }
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      return { kind: "validation-error", code: "INVALID_PAGE_LIMIT" };
    }
    const offset = cursorOffset(input.cursor);
    if (offset === undefined) {
      return { kind: "validation-error", code: "INVALID_CURSOR" };
    }
    const read = await this.dependencies.store.readForList();
    if (read.kind !== "success") return read;

    const allTenantPlans = read.state.plans.filter(
      (plan): plan is CreatorMappedRecurringPlan =>
        plan.householdId === input.householdId &&
        plan.lifecycleState === "active" &&
        hasRecurringPlanCreator(plan),
    );
    const plans = allTenantPlans
      .filter((plan) => input.active === undefined || plan.active === input.active)
      .sort(planSort);
    const items = plans.slice(offset, offset + input.limit);
    if (items.length === 0) return { kind: "no-data" };
    const nextOffset = offset + items.length;
    return {
      kind: "success",
      items: items.map(planView),
      ...(nextOffset < plans.length
        ? { nextCursor: `recurring-plan-cursor:${nextOffset}` }
        : {}),
      sourceCheckpoint: sourceCheckpoint(allTenantPlans),
    };
  }
}

export function createRecurringPlanManagementApplication(
  dependencies: RecurringPlanManagementDependencies,
): RecurringPlanManagementInputPort {
  return new DefaultRecurringPlanManagementApplication(dependencies);
}
