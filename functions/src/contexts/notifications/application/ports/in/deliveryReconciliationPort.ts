export type ReconcileDeliveryResult =
  | {
      kind: "UnknownProviderOutcome";
      code: "WORKER_INTERRUPTED_AFTER_PROVIDER_CALL";
    }
  | {
      kind: "AlreadyTerminal";
      status: "unknown-provider-outcome";
    };

/** 운영 worker가 provider 호출 후 중단된 delivery를 재전송 없이 종결합니다. */
export interface DeliveryReconciliationInputPort {
  reconcileStuckDelivery(
    deliveryId: string,
    now: string,
  ): Promise<ReconcileDeliveryResult>;
}
