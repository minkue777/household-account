import type { CreatorMappedRecurringPlan, RecurringPlan, RecurringPlanCommandReceipt } from "../domain/model/recurringPlan";
import { hasRecurringPlanCreator } from "../domain/model/recurringPlan";
import { firstApplicableMonth, normalizeCreateFields, normalizeUpdatedFields, recurringCommandPayloadSignature, rejectsCreatorInjection } from "../domain/policies/recurringPlanPolicy";
import type { ManageRecurringPlanOperation, ManageRecurringPlanResult, RecurringActor, RecurringPlanListResult, RecurringPlanManagementInputPort, RecurringPlanView } from "./ports/in/recurringPlanManagementInputPort";
import type { RecurringPlanClockPort, RecurringPlanIdentityPort, RecurringPlanManagementStorePort } from "./ports/out/recurringPlanManagementPorts";

export interface RecurringPlanManagementDependencies {
  store: RecurringPlanManagementStorePort;
  clock: RecurringPlanClockPort;
  identities: RecurringPlanIdentityPort;
}

function planView(plan: CreatorMappedRecurringPlan): RecurringPlanView { return { ...plan }; }

function receiptReplay(receipt: RecurringPlanCommandReceipt, payloadSignature: string): ManageRecurringPlanResult {
  return receipt.payloadSignature === payloadSignature
    ? { kind: "already-processed", plan: planView(receipt.plan) }
    : { kind: "conflict", code: "IDEMPOTENCY_KEY_REUSED" };
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

class DefaultRecurringPlanManagementApplication implements RecurringPlanManagementInputPort {
  constructor(private readonly dependencies: RecurringPlanManagementDependencies) {}

  async manage(input: { commandId: string; actor: RecurringActor; operation: ManageRecurringPlanOperation }): Promise<ManageRecurringPlanResult> {
    if (!input.actor.capabilities.includes("recurring.manage")) return { kind: "forbidden", code: "CAPABILITY_REQUIRED" };
    const { operation, actor, commandId } = input;
    const payloadSignature = recurringCommandPayloadSignature({ householdId: actor.householdId, actingMemberId: actor.actingMemberId, operation });
    const planId = operation.kind === "create" ? this.dependencies.identities.planId(commandId) : operation.planId;
    return this.dependencies.store.transact<ManageRecurringPlanResult>(planId, commandId, async current => {
      const unchanged = (value: ManageRecurringPlanResult) => ({ value });
      if (current.receipt) return unchanged(receiptReplay(current.receipt, payloadSignature));
      if (rejectsCreatorInjection(operation)) return unchanged({ kind: "validation-error", code: "CREATOR_FIELD_NOT_ALLOWED" });
      const now = this.dependencies.clock.now();
      let plan: CreatorMappedRecurringPlan;
      let resultKind: "created" | "updated" | "deleted";
      if (operation.kind === "create") {
        const fields = normalizeCreateFields(operation);
        if (fields.kind !== "valid") return unchanged(fields);
        const month = firstApplicableMonth({ localCreatedOn: this.dependencies.clock.localDate(), dayOfMonth: fields.value.dayOfMonth });
        if (month.kind !== "valid") return unchanged(month);
        plan = { householdId: actor.householdId, planId, ...fields.value, creatorMemberId: actor.actingMemberId,
          firstApplicableMonth: month.value, createdAt: now, updatedAt: now, lifecycleState: "active", version: 1 };
        resultKind = "created";
      } else {
        const existing = current.plan;
        if (!existing || existing.lifecycleState !== "active") return unchanged({ kind: "not-found", code: "PLAN_NOT_FOUND" });
        if (existing.householdId !== actor.householdId) return unchanged({ kind: "forbidden", code: "HOUSEHOLD_SCOPE_REQUIRED" });
        if (!hasRecurringPlanCreator(existing)) return unchanged({ kind: "conflict", code: "LEGACY_CREATOR_MAPPING_REQUIRED" });
        if (existing.version !== operation.expectedVersion) return unchanged({ kind: "conflict", code: "PLAN_VERSION_MISMATCH", currentVersion: existing.version });
        if (operation.kind === "delete") {
          plan = { ...existing, lifecycleState: "deleted", updatedAt: now, version: existing.version + 1 };
          resultKind = "deleted";
        } else {
          const fields = normalizeUpdatedFields(existing, operation.patch);
          if (fields.kind !== "valid") return unchanged(fields);
          plan = { ...existing, ...fields.value, updatedAt: now, version: existing.version + 1 };
          resultKind = "updated";
        }
      }
      if (resultKind !== "deleted") {
        try {
          if (!await current.categoryIsUsable(plan.categoryId)) return unchanged({ kind: "validation-error", code: "CATEGORY_NOT_USABLE" });
        } catch { return unchanged({ kind: "retryable-failure", code: "CATEGORY_REPOSITORY_UNAVAILABLE" }); }
      }
      const receipt = { commandId, payloadSignature, resultKind, planId, plan };
      return {
        value: resultKind === "deleted" ? { kind: "deleted", planId, version: plan.version } : { kind: "success", plan: planView(plan) },
        change: { plan, receipt, event: { eventType: "RecurringPlanChanged.v1", householdId: actor.householdId, planId,
          active: plan.active, dayOfMonth: plan.dayOfMonth, changeKind: resultKind, planVersion: plan.version } },
      };
    });
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

    const allTenantPlans = read.plans.filter(
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

export function createRecurringPlanManagementApplication(dependencies: RecurringPlanManagementDependencies): RecurringPlanManagementInputPort {
  return new DefaultRecurringPlanManagementApplication(dependencies);
}
