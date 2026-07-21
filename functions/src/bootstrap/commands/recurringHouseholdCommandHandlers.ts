import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import { FirebaseRecurringPlanManagementStore } from "../../adapters/firebase/recurring/firebaseRecurringPlanManagementStore";
import { createRecurringPlanManagementApplication } from "../../contexts/household-finance/recurring/application/recurringPlanManagementApplication";
import type {
  ManageRecurringPlanResult,
  RecurringActor,
} from "../../contexts/household-finance/recurring/application/ports/in/recurringPlanManagementInputPort";
import {
  HouseholdCommandRejection,
  type HouseholdCommandExecutionContext,
  type HouseholdCommandHandler,
} from "./householdCommand";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function stringValue(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string") {
    throw new HouseholdCommandRejection(`${field.toUpperCase()}_REQUIRED`);
  }
  return value;
}

function numberValue(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (typeof value !== "number") {
    throw new HouseholdCommandRejection(`${field.toUpperCase()}_REQUIRED`);
  }
  return value;
}

function optionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HouseholdCommandRejection(`${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function verifiedActor(context: HouseholdCommandExecutionContext): RecurringActor {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  const canWrite = context.actor.capabilities.includes("household.write");
  return {
    householdId: context.actor.householdId,
    actingMemberId: context.actor.actingMemberId,
    capabilities: canWrite
      ? ["recurring.manage", "recurring.read"]
      : context.actor.capabilities.filter(
          (capability): capability is "recurring.manage" | "recurring.read" =>
            capability === "recurring.manage" || capability === "recurring.read",
        ),
  };
}

function localDate(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function planId(commandId: string): string {
  return `recurring-${createHash("sha256")
    .update(commandId, "utf8")
    .digest("base64url")
    .slice(0, 22)}`;
}

function resultPlan(result: ManageRecurringPlanResult) {
  if (result.kind === "success" || result.kind === "already-processed") {
    return result.plan;
  }
  if (result.kind === "deleted") return undefined;
  throw new HouseholdCommandRejection(
    result.code,
    result.kind === "retryable-failure",
  );
}

function applicationFor(
  database: firestore.Firestore,
  context: HouseholdCommandExecutionContext,
) {
  const actor = verifiedActor(context);
  const store = new FirebaseRecurringPlanManagementStore(database, {
    householdId: actor.householdId,
    requestedAt: context.requestedAt,
  });
  const application = createRecurringPlanManagementApplication({
    store,
    clock: {
      now: () => context.requestedAt,
      localDate: () => localDate(context.requestedAt),
    },
    identities: { planId },
    categories: {
      async resolveUsableCategory(householdId, categoryId) {
        try {
          const [canonical, legacy] = await Promise.all([
            database
              .collection("households")
              .doc(householdId)
              .collection("categories")
              .doc(categoryId)
              .get(),
            database
              .collection("categories")
              .where("householdId", "==", householdId)
              .get(),
          ]);
          const canonicalData = canonical.data();
          const legacyMatch = legacy.docs.find((snapshot) => {
            const data = snapshot.data();
            return snapshot.id === categoryId || data.key === categoryId;
          });
          const legacyData = legacyMatch?.data();
          const usable = canonical.exists
            ? canonicalData?.state === "active" ||
              (canonicalData?.state === undefined && canonicalData?.isActive !== false)
            : legacyMatch !== undefined &&
              legacyData?.householdId === householdId &&
              legacyData?.isActive !== false &&
              legacyData?.state !== "archived" &&
              legacyData?.state !== "archive-pending";
          return usable
            ? ({ kind: "usable" } as const)
            : ({ kind: "not-usable" } as const);
        } catch {
          return {
            kind: "retryable-failure" as const,
            code: "CATEGORY_REPOSITORY_UNAVAILABLE",
          };
        }
      },
    },
  });
  return { actor, store, application };
}

async function existingPlanVersion(
  store: FirebaseRecurringPlanManagementStore,
  planIdValue: string,
): Promise<number> {
  const state = await store.read();
  const plan = state.plans.find(
    (candidate) =>
      candidate.planId === planIdValue && candidate.lifecycleState === "active",
  );
  if (plan === undefined) throw new HouseholdCommandRejection("PLAN_NOT_FOUND");
  return plan.version;
}

export function createRecurringHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map<string, HouseholdCommandHandler>([
    [
      "recurring.create-plan.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const plan = record(payload.plan);
          const { actor, application } = applicationFor(database, context);
          const memo = optionalString(plan, "memo");
          const result = resultPlan(
            await application.manage({
              commandId: context.envelope.commandId,
              actor,
              operation: {
                kind: "create",
                merchant: stringValue(plan, "merchant"),
                amountInWon: numberValue(plan, "amount"),
                categoryId: stringValue(plan, "category"),
                dayOfMonth: numberValue(plan, "dayOfMonth"),
                ...(memo === undefined ? {} : { memo }),
                active: true,
              },
            }),
          );
          return { planId: result?.planId };
        },
      },
    ],
    [
      "recurring.update-plan.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const changes = record(payload.changes);
          const planIdValue = stringValue(payload, "planId");
          const { actor, store, application } = applicationFor(database, context);
          const patch: Record<string, unknown> = {};
          if (changes.merchant !== undefined) {
            patch.merchant = stringValue(changes, "merchant");
          }
          if (changes.amount !== undefined) {
            patch.amountInWon = numberValue(changes, "amount");
          }
          if (changes.category !== undefined) {
            patch.categoryId = stringValue(changes, "category");
          }
          if (changes.dayOfMonth !== undefined) {
            patch.dayOfMonth = numberValue(changes, "dayOfMonth");
          }
          if (changes.memo !== undefined) {
            patch.memo = stringValue(changes, "memo");
          }
          if (changes.isActive !== undefined) {
            if (typeof changes.isActive !== "boolean") {
              throw new HouseholdCommandRejection("ISACTIVE_INVALID");
            }
            patch.active = changes.isActive;
          }
          resultPlan(
            await application.manage({
              commandId: context.envelope.commandId,
              actor,
              operation: {
                kind: "update",
                planId: planIdValue,
                expectedVersion: await existingPlanVersion(store, planIdValue),
                patch,
              },
            }),
          );
          return {};
        },
      },
    ],
    [
      "recurring.delete-plan.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const planIdValue = stringValue(payload, "planId");
          const { actor, store, application } = applicationFor(database, context);
          resultPlan(
            await application.manage({
              commandId: context.envelope.commandId,
              actor,
              operation: {
                kind: "delete",
                planId: planIdValue,
                expectedVersion: await existingPlanVersion(store, planIdValue),
              },
            }),
          );
          return {};
        },
      },
    ],
  ]);
}
