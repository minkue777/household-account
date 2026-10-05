import type { PaymentConfigurationAtomicStorePort } from "./ports/out/paymentConfigurationAtomicStorePort";
import { remapMerchantRulePage } from "./merchantRuleCategoryRemapApplication";

export function createMerchantRuleCategoryArchiveApplication(store: PaymentConfigurationAtomicStorePort) {
  return {
    async remap(input: { householdId: string; processId: string; sourceCategoryId: string; destinationCategoryId: string; occurredAt: string }) {
      let cursor: string | null = null;
      do {
        const pageCursor: string | null = cursor;
        const pageId = JSON.stringify([input.processId, pageCursor]);
        const result = await store.transactMerchantRules({
          commandId: pageId, idempotencyKey: pageId, commandName: "paymentConfiguration.remap-category-references.v1",
          payloadFingerprint: JSON.stringify([input.householdId, input.processId, input.sourceCategoryId, input.destinationCategoryId, pageCursor]),
          householdId: input.householdId, actorMemberId: "system:category-archive", occurredAt: input.occurredAt,
        }, (current) => {
          const { result: page, rules, changedTypes } = remapMerchantRulePage(current.rules, { householdId: input.householdId, archivedCategoryId: input.sourceCategoryId, defaultCategoryId: input.destinationCategoryId, processId: input.processId, cursor: pageCursor, limit: 100 });
          const collectionVersions = { ...current.collectionVersions };
          for (const type of changedTypes) if (type !== "exact") {
            const key = `${input.householdId}:${type}`;
            collectionVersions[key] = (collectionVersions[key] ?? 0) + 1;
          }
          return {
            writes: page.changedCount > 0,
            state: { ...current, collectionVersions, rules },
            value: { kind: "CategoryReferencesRemapped" as const, changedCount: page.changedCount, nextCursor: page.nextCursor },
          };
        });
        if (result.kind !== "committed" && result.kind !== "replayed") return { kind: "retryable-failure" as const, code: "MERCHANT_REMAP_COMMIT_FAILED" };
        if (result.value.kind !== "CategoryReferencesRemapped") return { kind: "retryable-failure" as const, code: "MERCHANT_REMAP_RECEIPT_INVALID" };
        cursor = result.value.nextCursor;
      } while (cursor !== null);
      return { kind: "success" as const };
    },
  };
}
