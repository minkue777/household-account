import type {
  GoldPositionView,
  GoldValuationEvent,
} from "../../../domain/model/goldPosition";

export interface GoldPositionStore {
  current(): GoldPositionView;
  commit(input: {
    position: GoldPositionView;
    events: readonly GoldValuationEvent[];
  }): void;
  events(): readonly GoldValuationEvent[];
}
