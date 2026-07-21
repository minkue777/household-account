import { describe, expect, it } from "vitest";
import type {
  DeliveryReconciliationInputPort,
  ReconcileDeliveryResult as PublicReconcileDeliveryResult,
} from "../../../src/contexts/notifications/public";
import {
  createDeliveryReconciliationFixtureSubject,
  type DeliveryReconciliationSeed as FixtureDeliveryReconciliationSeed,
  type DeliveryReconciliationSnapshot as FixtureDeliveryReconciliationSnapshot,
} from "../../support/delivery-reconciliation-driver";

export type DeliveryReconciliationSeed = FixtureDeliveryReconciliationSeed;

export type ReconcileDeliveryResult =
  PublicReconcileDeliveryResult;

export type DeliveryReconciliationSnapshot =
  FixtureDeliveryReconciliationSnapshot;

/** provider 호출 시작은 기록됐지만 결과 commit 전 중단된 delivery의 복구 경계입니다. */
export interface DeliveryReconciliationContractSubject
  extends DeliveryReconciliationInputPort {
  providerSendCalls(): readonly {
    deliveryId: string;
    endpointId: string;
  }[];
  snapshot(): Promise<DeliveryReconciliationSnapshot>;
}

export function createSubject(
  _seed: DeliveryReconciliationSeed,
): DeliveryReconciliationContractSubject {
  return createDeliveryReconciliationFixtureSubject(_seed);
}

describe("중단된 Notifications delivery reconciliation 공개 계약", () => {
  it("[T-PUSH-003/T-PUSH-006][PUSH-008/PUSH-010/DEC-025] provider 호출 뒤 결과 commit 전 중단된 delivery는 재전송 없이 unknown으로 종결한다", async () => {
    const subject = createSubject({
      deliveryId: "delivery-interrupted",
      householdId: "house-1",
      endpointId: "endpoint-a",
      status: "sending",
      providerAttemptCount: 1,
      providerAttemptStartedAt: "2026-07-19T08:59:00.000Z",
      providerOutcomeCommitted: false,
    });

    const results = await Promise.all([
      subject.reconcileStuckDelivery(
        "delivery-interrupted",
        "2026-07-19T09:00:00.000Z",
      ),
      subject.reconcileStuckDelivery(
        "delivery-interrupted",
        "2026-07-19T09:00:00.000Z",
      ),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        {
          kind: "UnknownProviderOutcome",
          code: "WORKER_INTERRUPTED_AFTER_PROVIDER_CALL",
        },
        {
          kind: "AlreadyTerminal",
          status: "unknown-provider-outcome",
        },
      ]),
    );
    expect(subject.providerSendCalls()).toEqual([]);
    expect(await subject.snapshot()).toEqual({
      delivery: {
        deliveryId: "delivery-interrupted",
        status: "unknown-provider-outcome",
        providerAttemptCount: 1,
        terminalAt: "2026-07-19T09:00:00.000Z",
        expiresAt: "2026-08-18T09:00:00.000Z",
      },
      terminalEventCount: 1,
    });
  });
});
