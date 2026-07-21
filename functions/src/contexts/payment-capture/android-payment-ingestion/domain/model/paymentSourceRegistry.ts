export type SourceLifecycleState = "active" | "inactive";

export interface PaymentSourceRegistryEntry {
  readonly packageName: string;
  readonly sourceType: string;
  readonly registryVersion: string;
  readonly sourceState: SourceLifecycleState;
  readonly parserId: string;
  readonly parserVersion: string;
  readonly parserState: SourceLifecycleState;
}
