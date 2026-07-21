import type { CategoryRemapResult } from "../../../domain/model/recurringCategoryRemap";

export interface CategoryRemapActor {
  readonly kind: "system";
  readonly capabilities: readonly "category-reference-remap"[];
}

export interface RecurringCategoryRemapInputPort {
  remap(input: {
    actor: CategoryRemapActor;
    processId: string;
    fromCategoryId: string;
    toDefaultCategoryId: string;
    cursor?: string;
    limit: number;
  }): Promise<CategoryRemapResult>;
}

export type { CategoryRemapResult };
