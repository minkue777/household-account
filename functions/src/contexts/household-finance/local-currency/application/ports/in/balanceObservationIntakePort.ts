import type { SupportedLocalCurrencyType } from "../../../domain/model/localCurrencyBalance";

export interface BalanceRecorderActor {
  kind: "system";
  householdId?: string;
  capabilities: readonly "local-currency.record"[];
}

export interface BalanceObservationV1 {
  contractVersion: "balance-observation.v1";
  observationId: string;
  localCurrencyType: SupportedLocalCurrencyType;
  balanceInWon: number;
  observedAt: string;
  sourceType: string;
  parser: {
    parserId: string;
    parserVersion: string;
  };
  rawPayloadHash?: string;
}

export type BalanceObservationIntakeResult =
  | {
      kind: "success";
      status: "created" | "updated" | "staleIgnored";
      balanceId: string;
      balanceVersion: number;
    }
  | { kind: "forbidden"; code: string }
  | { kind: "validation-error"; code: string }
  | { kind: "contract-failure"; code: string };

export interface BalanceObservationIntakeInputPort {
  recordBalanceObservation(
    actor: BalanceRecorderActor,
    input: BalanceObservationV1,
  ): Promise<BalanceObservationIntakeResult>;
}
