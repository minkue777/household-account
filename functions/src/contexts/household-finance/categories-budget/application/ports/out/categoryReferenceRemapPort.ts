export interface CategoryReferenceRemapRequest {
  processId: string;
  sourceCategoryId: string;
  destinationCategoryId: string;
}

export type CategoryReferenceRemapResult =
  | { kind: "success" }
  | { kind: "retryable-failure"; code: string };

export interface CategoryReferenceRemapPort {
  remapRecurringReferences(
    request: CategoryReferenceRemapRequest,
  ): Promise<CategoryReferenceRemapResult>;
  remapMerchantRuleReferences(
    request: CategoryReferenceRemapRequest,
  ): Promise<CategoryReferenceRemapResult>;
}
