import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import { FirebaseLedgerCommandRepository } from "../../adapters/firebase/ledger/firebaseLedgerCommandRepository";
import { FirebaseMonthlySplitLifecycleStore } from "../../adapters/firebase/ledger/firebaseMonthlySplitLifecycleStore";
import { FirebaseItemSplitStore } from "../../adapters/firebase/ledger/firebaseItemSplitStore";
import { FirebaseTransformationLineageStore } from "../../adapters/firebase/ledger/firebaseTransformationLineageStore";
import { createBasicLedgerCommands } from "../../contexts/household-finance/ledger/application/commands/basicLedgerService";
import { createMonthlySplitLifecycleCommands } from "../../contexts/household-finance/ledger/application/commands/monthlySplitLifecycleService";
import { createItemSplitRestorationCommands } from "../../contexts/household-finance/ledger/application/commands/itemSplitRestorationService";
import { createLedgerTransformationCommands } from "../../contexts/household-finance/ledger/application/commands/transformationLineageService";
import type { LedgerTransformationResult } from "../../contexts/household-finance/ledger/domain/model/transformationLineage";
import type { LedgerCommandResult } from "../../contexts/household-finance/ledger/domain/model/ledgerTransaction";
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

function itemDrafts(value: unknown) {
  if (!Array.isArray(value)) {
    throw new HouseholdCommandRejection("ITEMS_REQUIRED");
  }
  return value.map((raw) => {
    const item = record(raw);
    return {
      merchant: stringValue(item, "merchant"),
      amountInWon: numberValue(item, "amountInWon"),
      categoryId: stringValue(item, "categoryId"),
      memo: optionalString(item, "memo") ?? "",
    };
  });
}

function versionMap(value: unknown): Readonly<Record<string, number>> {
  const input = record(value);
  const entries = Object.entries(input);
  if (
    entries.length === 0 ||
    entries.some(
      ([transactionId, version]) =>
        transactionId.trim() === "" ||
        typeof version !== "number" ||
        !Number.isSafeInteger(version) ||
        version < 1,
    )
  ) {
    throw new HouseholdCommandRejection("EXPECTED_VERSIONS_INVALID");
  }
  return Object.fromEntries(entries) as Readonly<Record<string, number>>;
}

function actor(context: HouseholdCommandExecutionContext) {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  return {
    householdId: context.actor.householdId,
    actingMemberId: context.actor.actingMemberId,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

function receiptPayloadHash(context: HouseholdCommandExecutionContext): string {
  return createHash("sha256")
    .update(
      stable({
        command: context.envelope.command,
        payload: context.envelope.payload,
      }),
      "utf8",
    )
    .digest("hex");
}

function resultValue(result: LedgerCommandResult): unknown {
  if (result.kind === "success") return result.value;
  if (result.kind === "retryable-failure") {
    throw new HouseholdCommandRejection(result.code, true);
  }
  if (result.kind === "conflict") {
    throw new HouseholdCommandRejection(result.code);
  }
  if (result.kind === "validation-error") {
    throw new HouseholdCommandRejection(result.code);
  }
  throw new HouseholdCommandRejection("TRANSACTION_NOT_FOUND");
}

function transformationResultValue(result: LedgerTransformationResult) {
  if (result.kind === "success") return result.transactionIds;
  throw new HouseholdCommandRejection(
    result.code,
    result.kind === "retryable-failure",
  );
}

async function activeCategories(
  database: firestore.Firestore,
  householdId: string,
): Promise<ReadonlySet<string>> {
  const snapshot = await database
    .collection("categories")
    .where("householdId", "==", householdId)
    .get();
  return new Set(
    snapshot.docs
      .filter((document) => document.data().isActive !== false)
      .flatMap((document) => {
        const data = document.data();
        const key = typeof data.key === "string" ? data.key : document.id;
        return key.trim() === "" ? [] : [key];
      }),
  );
}

function commandsFor(
  database: firestore.Firestore,
  context: HouseholdCommandExecutionContext,
  categories?: ReadonlySet<string>,
) {
  const verifiedActor = actor(context);
  return createBasicLedgerCommands({
    repository: new FirebaseLedgerCommandRepository(
      database,
      verifiedActor.householdId,
      receiptPayloadHash(context),
    ),
    // categoryId가 명령 payload에 없으면 domain policy도 이 포트를 호출하지
    // 않습니다. 메모/금액 수정과 삭제가 카테고리 전체 조회를 선행하지 않도록
    // 카탈로그를 생략하되, 예상 밖 호출은 허용하지 않는 보수적 policy를 둡니다.
    categories: {
      isUsable: (categoryId) => categories?.has(categoryId) ?? false,
    },
    clock: { now: () => context.requestedAt },
    idGenerator: {
      next: (commandId) =>
        `ledger-${Buffer.from(commandId, "utf8").toString("base64url").slice(0, 80)}`,
    },
  });
}

export function createLedgerHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map<string, HouseholdCommandHandler>([
    [
      "ledger.record-manual-transaction.v1",
      {
        idempotencyBoundary: "domain-command-id",
        async execute(context) {
          const payload = record(context.envelope.payload);
          const transactionType = stringValue(payload, "transactionType");
          const categories =
            transactionType === "income"
              ? undefined
              : await activeCategories(database, actor(context).householdId);
          const commands = commandsFor(database, context, categories);
          const amountInWon = numberValue(payload, "amountInWon");
          const accountingDate = stringValue(payload, "accountingDate");
          const memo = optionalString(payload, "memo");
          const result =
            transactionType === "income"
              ? await commands.recordManualIncome({
                  commandId: context.envelope.commandId,
                  actor: actor(context),
                  itemName: stringValue(payload, "itemName"),
                  amountInWon,
                  accountingDate,
                  ...(memo === undefined ? {} : { memo }),
                })
              : await commands.recordManualExpense({
                  commandId: context.envelope.commandId,
                  actor: actor(context),
                  merchant: stringValue(payload, "merchant"),
                  amountInWon,
                  categoryId: stringValue(payload, "categoryId"),
                  accountingDate,
                  ...(memo === undefined ? {} : { memo }),
                });
          return resultValue(result);
        },
      },
    ],
    [
      "ledger.update-transaction.v1",
      {
        idempotencyBoundary: "domain-command-id",
        async execute(context) {
          const payload = record(context.envelope.payload);
          const patch = record(payload.patch);
          const categories =
            patch.categoryId === undefined
              ? undefined
              : await activeCategories(database, actor(context).householdId);
          const commands = commandsFor(database, context, categories);
          return resultValue(
            await commands.update({
              commandId: context.envelope.commandId,
              actor: actor(context),
              transactionId: stringValue(payload, "transactionId"),
              expectedVersion: numberValue(payload, "expectedVersion"),
              patch: patch as Parameters<typeof commands.update>[0]["patch"],
            }),
          );
        },
      },
    ],
    [
      "ledger.change-transaction-category.v1",
      {
        idempotencyBoundary: "domain-command-id",
        async execute(context) {
          const payload = record(context.envelope.payload);
          const commands = commandsFor(
            database,
            context,
            await activeCategories(database, actor(context).householdId),
          );
          return resultValue(
            await commands.update({
              commandId: context.envelope.commandId,
              actor: actor(context),
              transactionId: stringValue(payload, "transactionId"),
              expectedVersion: numberValue(payload, "expectedVersion"),
              patch: { categoryId: stringValue(payload, "categoryId") },
            }),
          );
        },
      },
    ],
    [
      "ledger.delete-transaction.v1",
      {
        idempotencyBoundary: "domain-command-id",
        async execute(context) {
          const payload = record(context.envelope.payload);
          const commands = commandsFor(database, context);
          return resultValue(
            await commands.delete({
              commandId: context.envelope.commandId,
              actor: actor(context),
              transactionId: stringValue(payload, "transactionId"),
              expectedVersion: numberValue(payload, "expectedVersion"),
            }),
          );
        },
      },
    ],
    [
      "ledger.request-notification.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const commands = commandsFor(database, context);
          return resultValue(
            await commands.requestNotification({
              commandId: context.envelope.commandId,
              actor: actor(context),
              transactionId: stringValue(payload, "transactionId"),
              expectedVersion: numberValue(payload, "expectedVersion"),
            }),
          );
        },
      },
    ],
    [
      "ledger.split-transaction.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const verifiedActor = actor(context);
          const operation =
            payload.operation === undefined ? undefined : record(payload.operation);
          if (
            operation !== undefined &&
            stringValue(operation, "kind") !== "items"
          ) {
            throw new HouseholdCommandRejection("SPLIT_OPERATION_INVALID");
          }
          const items = itemDrafts(operation?.items ?? payload.items);
          const baseDraftValue = operation?.baseDraft;
          const baseDraft =
            baseDraftValue === undefined
              ? undefined
              : (() => {
                  const draft = record(baseDraftValue);
                  return {
                    merchant: stringValue(draft, "merchant"),
                    amountInWon: numberValue(draft, "amountInWon"),
                    categoryId: stringValue(draft, "categoryId"),
                    memo: optionalString(draft, "memo") ?? "",
                  };
                })();
          const categories = await activeCategories(
            database,
            verifiedActor.householdId,
          );
          if (
            items.some(({ categoryId }) => !categories.has(categoryId)) ||
            (baseDraft !== undefined && !categories.has(baseDraft.categoryId))
          ) {
            throw new HouseholdCommandRejection("CATEGORY_NOT_USABLE");
          }
          const result = await createItemSplitRestorationCommands({
            store: new FirebaseItemSplitStore(
              database,
              verifiedActor.householdId,
              context.requestedAt,
            ),
          }).split({
            actor: {
              householdId: verifiedActor.householdId,
              memberId: verifiedActor.actingMemberId,
            },
            operationKey: context.envelope.commandId,
            sourceId: stringValue(payload, "transactionId"),
            expectedVersion: numberValue(payload, "expectedVersion"),
            items,
            ...(baseDraft === undefined ? {} : { baseDraft }),
          });
          if (result.kind === "Split") {
            return { transactionIds: result.derivedIds };
          }
          if (result.kind === "Restored") {
            return { transactionIds: [result.transactionId] };
          }
          if (result.kind === "RetryableFailure") {
            throw new HouseholdCommandRejection(result.code, true);
          }
          throw new HouseholdCommandRejection(result.code);
        },
      },
    ],
    [
      "ledger.split-existing-transaction-monthly.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const verifiedActor = actor(context);
          const result = await createMonthlySplitLifecycleCommands({
            store: new FirebaseMonthlySplitLifecycleStore(
              database,
              verifiedActor.householdId,
              context.requestedAt,
            ),
          }).splitExisting({
            operationKey: context.envelope.commandId,
            actor: verifiedActor,
            transactionId: stringValue(payload, "transactionId"),
            expectedVersion: numberValue(payload, "expectedVersion"),
            months: numberValue(payload, "months"),
          });
          if (result.kind !== "success") {
            throw new HouseholdCommandRejection(
              result.code,
              result.kind === "retryable-failure",
            );
          }
          return {
            transactionIds: result.transactionIds,
            splitGroupId: `monthly-group:${context.envelope.commandId}`,
          };
        },
      },
    ],
    [
      "ledger.record-manual-monthly-split.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const verifiedActor = actor(context);
          const transactionType = stringValue(payload, "transactionType");
          if (transactionType !== "expense" && transactionType !== "income") {
            throw new HouseholdCommandRejection("TRANSACTION_TYPE_INVALID");
          }
          const categoryId =
            transactionType === "income"
              ? "etc"
              : stringValue(payload, "categoryId");
          if (transactionType === "expense") {
            const categories = await activeCategories(
              database,
              verifiedActor.householdId,
            );
            if (!categories.has(categoryId)) {
              throw new HouseholdCommandRejection("CATEGORY_NOT_USABLE");
            }
          }
          const memo = optionalString(payload, "memo");
          const merchant =
            transactionType === "income"
              ? "수입"
              : stringValue(payload, "merchant");
          const result = await createMonthlySplitLifecycleCommands({
            store: new FirebaseMonthlySplitLifecycleStore(
              database,
              verifiedActor.householdId,
              context.requestedAt,
            ),
          }).splitNewManual({
            operationKey: context.envelope.commandId,
            actor: verifiedActor,
            draft: {
              transactionType,
              merchant,
              amountInWon: numberValue(payload, "amountInWon"),
              categoryId,
              accountingDate: stringValue(payload, "accountingDate"),
              memo:
                memo ??
                (transactionType === "income"
                  ? stringValue(payload, "itemName")
                  : ""),
            },
            months: numberValue(payload, "months"),
          });
          if (result.kind !== "success") {
            throw new HouseholdCommandRejection(
              result.code,
              result.kind === "retryable-failure",
            );
          }
          return {
            transactionIds: result.transactionIds,
            splitGroupId: `monthly-group:${context.envelope.commandId}`,
          };
        },
      },
    ],
    [
      "ledger.cancel-monthly-split.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const verifiedActor = actor(context);
          const result = await createMonthlySplitLifecycleCommands({
            store: new FirebaseMonthlySplitLifecycleStore(
              database,
              verifiedActor.householdId,
              context.requestedAt,
            ),
          }).collapse({
            operationKey: context.envelope.commandId,
            groupId: stringValue(payload, "splitGroupId"),
            expectedVersions: versionMap(payload.expectedVersions),
          });
          if (result.kind !== "success") {
            throw new HouseholdCommandRejection(
              result.code,
              result.kind === "retryable-failure",
            );
          }
          return {};
        },
      },
    ],
    [
      "ledger.reconfigure-monthly-split.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const verifiedActor = actor(context);
          const splitGroupId = stringValue(payload, "splitGroupId");
          const result = await createMonthlySplitLifecycleCommands({
            store: new FirebaseMonthlySplitLifecycleStore(
              database,
              verifiedActor.householdId,
              context.requestedAt,
            ),
          }).reconfigure({
            operationKey: context.envelope.commandId,
            groupId: splitGroupId,
            months: numberValue(payload, "months"),
            expectedVersions: versionMap(payload.expectedVersions),
          });
          if (result.kind !== "success") {
            throw new HouseholdCommandRejection(
              result.code,
              result.kind === "retryable-failure",
            );
          }
          return { splitGroupId };
        },
      },
    ],
    [
      "ledger.merge-transactions.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const verifiedActor = actor(context);
          const targetTransactionId = stringValue(
            payload,
            "targetTransactionId",
          );
          const sourceTransactionId = stringValue(
            payload,
            "sourceTransactionId",
          );
          if (targetTransactionId === sourceTransactionId) {
            throw new HouseholdCommandRejection("MERGE_LEAF_OVERLAP");
          }
          const commands = createLedgerTransformationCommands({
            store: new FirebaseTransformationLineageStore(
              database,
              verifiedActor.householdId,
              context.requestedAt,
            ),
            clock: { now: () => context.requestedAt },
          });
          transformationResultValue(
            await commands.merge({
              operationKey: context.envelope.commandId,
              targetId: targetTransactionId,
              sourceIds: [sourceTransactionId],
              expectedVersions: versionMap(payload.expectedVersions),
            }),
          );
          return {};
        },
      },
    ],
    [
      "ledger.unmerge-transaction.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const verifiedActor = actor(context);
          const commands = createLedgerTransformationCommands({
            store: new FirebaseTransformationLineageStore(
              database,
              verifiedActor.householdId,
              context.requestedAt,
            ),
            clock: { now: () => context.requestedAt },
          });
          const transactionIds = transformationResultValue(
            await commands.unmerge({
              operationKey: context.envelope.commandId,
              mergedTransactionId: stringValue(payload, "transactionId"),
              expectedVersion: numberValue(payload, "expectedVersion"),
            }),
          );
          return { transactionIds };
        },
      },
    ],
  ]);
}
