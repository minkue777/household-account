import type * as firestore from "firebase-admin/firestore";
import { logger } from "firebase-functions";

import type {
  PortfolioProviderHealthPort,
  PortfolioProviderRunObservation,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { createProviderHealthApplication } from "../../../platform/external-operations/application/providerHealthApplication";
import type { ProviderRefreshRunnerPort } from "../../../platform/external-operations/application/ports/out/providerHealthPorts";
import {
  CloudMonitoringProviderAlertLogger,
  FirebaseProviderHealthRepository,
  FirebaseProviderObservationLogger,
  Sha256OperationsHash,
  configuredMonitoringNotificationChannel,
} from "../operations/firebaseProviderHealth";

/**
 * Portfolio의 한 refresh command가 만든 provider별 최종 결과를 Operations에 기록합니다.
 * execution key와 instrument 식별자는 저장·로그 전에 SHA-256으로 축약합니다.
 */
export class FirebasePortfolioProviderHealthStore
  implements PortfolioProviderHealthPort
{
  private readonly hash = new Sha256OperationsHash();

  constructor(
    private readonly database: firestore.Firestore,
    private readonly notificationChannelResource =
      configuredMonitoringNotificationChannel(),
  ) {}

  async recordRun(observation: PortfolioProviderRunObservation): Promise<void> {
    const runner: ProviderRefreshRunnerPort = {
      run: async () => ({
        attempts: observation.attempts.map((attempt) => ({ ...attempt })),
        finalResult:
          observation.finalResult.kind === "SUCCESS"
            ? {
                kind: "SUCCESS" as const,
                quote: {
                  instrumentId: this.hash.hash(
                    `portfolio-market:${observation.provider}:${observation.operation}`,
                  ),
                  price: observation.finalResult.quote.priceInWon,
                  currency: "KRW",
                  provider: observation.provider,
                  observedAt: observation.finalResult.quote.observedAt,
                },
              }
            : { ...observation.finalResult },
      }),
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const application = createProviderHealthApplication({
        runner,
        repository: new FirebaseProviderHealthRepository(this.database),
        observations: new FirebaseProviderObservationLogger(),
        alerts: new CloudMonitoringProviderAlertLogger(),
        hash: this.hash,
        notificationChannelResource: this.notificationChannelResource,
      });
      try {
        await application.refresh({
          provider: observation.provider,
          operation: observation.operation,
          executionKey: observation.executionKey,
          expectedData: observation.expectedData,
          observedAt: observation.observedAt,
        });
        return;
      } catch (caught) {
        const concurrent =
          caught instanceof Error &&
          caught.message === "PROVIDER_HEALTH_CONCURRENT_UPDATE";
        if (concurrent && attempt < 3) continue;
        logger.error("provider-health-record-failed", {
          eventType: "provider-health-record-failed",
          provider: observation.provider,
          operation: observation.operation,
          executionKeyHash: this.hash.hash(observation.executionKey),
          errorCode: concurrent
            ? "PROVIDER_HEALTH_CONCURRENT_UPDATE"
            : "PROVIDER_HEALTH_WRITE_FAILED",
          observedAt: observation.observedAt,
        });
        return;
      }
    }
  }
}
