import type {
  ScopedProviderResult,
  ScopedValuationRunResult,
  ScopedValuationTarget,
  ValuationChildReceipt,
  ValuationHousehold,
} from "../../../domain/model/assetValuationTriggerScope";

export interface ScopedValuationSource {
  households(): readonly ValuationHousehold[];
  targets(): readonly ScopedValuationTarget[];
  value(target: ScopedValuationTarget): Promise<ScopedProviderResult>;
}

export interface ScopedValuationRunStore {
  run(runId: string): ScopedValuationRunResult | undefined;
  saveRun(run: ScopedValuationRunResult): void;
  child(childKey: string): ValuationChildReceipt | undefined;
  commitChild(receipt: ValuationChildReceipt): void;
  values(): Readonly<Record<string, number>>;
  children(): readonly ValuationChildReceipt[];
  runs(): readonly ScopedValuationRunResult[];
}

export interface ValuationRunInterrupter {
  shouldInterrupt(input: {
    runId: string;
    pageNumber: number;
    resumed: boolean;
  }): boolean;
}
