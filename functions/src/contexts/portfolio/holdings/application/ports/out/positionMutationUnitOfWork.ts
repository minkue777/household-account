import type {
  PositionAccountState,
  PositionMutationEvent,
  PositionMutationReceipt,
  PositionMutationResult,
  PositionMutationState,
  PositionState,
} from "../../../domain/model/positionMutation";

export type PositionMutationDecision =
  | { kind: "return"; result: PositionMutationResult }
  | {
      kind: "commit";
      state: PositionMutationState;
      receipt: PositionMutationReceipt;
      events: readonly PositionMutationEvent[];
      result: PositionMutationResult;
    };

export interface PositionMutationUnitOfWork {
  transact(
    decide: (state: PositionMutationState) => PositionMutationDecision,
  ): Promise<PositionMutationResult>;
  asset(assetId: string): Promise<PositionAccountState>;
  positions(assetId: string): Promise<readonly PositionState[]>;
  receipts(): readonly PositionMutationReceipt[];
  events(): readonly PositionMutationEvent[];
}
