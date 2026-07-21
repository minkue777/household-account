import type {
  DeletePositionCommand,
  PositionAccountState,
  PositionMutationEvent,
  PositionMutationReceipt,
  PositionMutationResult,
  PositionState,
  UpdatePositionCommand,
} from "../../../domain/model/positionMutation";

export interface PositionMutationLifecycle {
  update(command: UpdatePositionCommand): Promise<PositionMutationResult>;
  delete(command: DeletePositionCommand): Promise<PositionMutationResult>;
  queryAsset(assetId: string): Promise<PositionAccountState>;
  listPositions(assetId: string): Promise<readonly PositionState[]>;
  receipts(): readonly PositionMutationReceipt[];
  recordedEvents(): readonly PositionMutationEvent[];
}
