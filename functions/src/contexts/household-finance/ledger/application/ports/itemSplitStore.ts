import type {
  ItemSplitResult,
  ItemSplitSnapshot,
} from "../../domain/model/itemSplitRestoration";

export interface ItemSplitStore {
  findReceipt(operationKey: string): Promise<ItemSplitResult | undefined>;
  load(): Promise<ItemSplitSnapshot>;
  replaceAtomically(input: {
    operationKey: string;
    snapshot: ItemSplitSnapshot;
    result: Extract<ItemSplitResult, { kind: "Split" | "Restored" }>;
  }): Promise<
    | { kind: "success" }
    | { kind: "RetryableFailure"; code: string }
  >;
}
