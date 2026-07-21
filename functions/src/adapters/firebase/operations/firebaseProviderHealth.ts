import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { logger } from "firebase-functions";

import type {
  ProviderHealth,
  ProviderQuote,
  RefreshProviderResult,
} from "../../../platform/external-operations/public";
import type {
  OperationsHashPort,
  ProviderAlertPort,
  ProviderHealthRepositoryPort,
  ProviderObservationPort,
} from "../../../platform/external-operations/application/ports/out/providerHealthPorts";

const RUNTIME_DOCUMENT = "runtime";
const DEFAULT_MONITORING_NOTIFICATION_CHANNEL =
  "configured-by-cloud-monitoring-policy";

/**
 * Cloud Monitoring 알림 채널은 모든 외부 공급자에서 같은 설정 키를 사용합니다.
 * 실제 메일 발송은 Cloud Monitoring 정책이 담당하며, 이 값은 전이 로그의 추적 정보입니다.
 */
export function configuredMonitoringNotificationChannel(): string {
  return (
    process.env.CLOUD_MONITORING_NOTIFICATION_CHANNEL?.trim() ||
    DEFAULT_MONITORING_NOTIFICATION_CHANNEL
  );
}

function stableDocumentId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function runtimeCollection(
  database: firestore.Firestore,
  name: string,
): firestore.CollectionReference {
  return database.collection("operations").doc(RUNTIME_DOCUMENT).collection(name);
}

interface StoredHealth extends ProviderHealth {
  readonly lastQuoteInstrumentId?: string;
  readonly schemaVersion: 1;
  readonly updatedAt: string;
}

interface StoredReceipt {
  readonly schemaVersion: 1;
  readonly executionKeyHash: string;
  readonly result: RefreshProviderResult;
  readonly committedAt: string;
}

/**
 * Provider Health와 마지막 성공 시세를 서버 전용 Operations 경계에 저장합니다.
 * execution key 원문은 저장하지 않고 해시 receipt로 멱등성을 보장합니다.
 */
export class FirebaseProviderHealthRepository
  implements ProviderHealthRepositoryPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async getQuote(instrumentId: string): Promise<ProviderQuote | undefined> {
    const snapshot = await runtimeCollection(this.database, "providerQuotes")
      .doc(stableDocumentId(instrumentId))
      .get();
    if (!snapshot.exists) return undefined;
    const quote = snapshot.data()?.quote as ProviderQuote | undefined;
    return quote === undefined ? undefined : clone(quote);
  }

  async findQuote(
    provider: string,
    operation: string,
  ): Promise<ProviderQuote | undefined> {
    const health = await runtimeCollection(this.database, "providerHealth")
      .doc(stableDocumentId(`${provider}\u0000${operation}`))
      .get();
    const instrumentId = health.data()?.lastQuoteInstrumentId;
    return typeof instrumentId === "string"
      ? this.getQuote(instrumentId)
      : undefined;
  }

  async getHealth(
    provider: string,
    operation: string,
  ): Promise<ProviderHealth | undefined> {
    const snapshot = await runtimeCollection(this.database, "providerHealth")
      .doc(stableDocumentId(`${provider}\u0000${operation}`))
      .get();
    if (!snapshot.exists) return undefined;
    const data = snapshot.data() as StoredHealth;
    const {
      lastQuoteInstrumentId: _lastQuoteInstrumentId,
      schemaVersion: _schemaVersion,
      updatedAt: _updatedAt,
      ...health
    } = data;
    return clone(health);
  }

  async getReceipt(
    executionKey: string,
  ): Promise<RefreshProviderResult | undefined> {
    const snapshot = await runtimeCollection(
      this.database,
      "providerHealthReceipts",
    )
      .doc(stableDocumentId(executionKey))
      .get();
    const result = snapshot.data()?.result as RefreshProviderResult | undefined;
    return result === undefined ? undefined : clone(result);
  }

  async commit(input: {
    readonly executionKey: string;
    readonly quote?: ProviderQuote;
    readonly health: ProviderHealth;
    readonly result: RefreshProviderResult;
  }): Promise<void> {
    const executionKeyHash = stableDocumentId(input.executionKey);
    const healthReference = runtimeCollection(this.database, "providerHealth").doc(
      stableDocumentId(`${input.health.provider}\u0000${input.health.operation}`),
    );
    const receiptReference = runtimeCollection(
      this.database,
      "providerHealthReceipts",
    ).doc(executionKeyHash);

    await this.database.runTransaction(async (transaction) => {
      const [receiptSnapshot, currentHealth] = await Promise.all([
        transaction.get(receiptReference),
        transaction.get(healthReference),
      ]);
      if (receiptSnapshot.exists) return;

      const currentVersion = currentHealth.exists
        ? Number(currentHealth.data()?.version ?? 0)
        : 0;
      if (currentVersion !== input.health.version - 1) {
        throw new Error("PROVIDER_HEALTH_CONCURRENT_UPDATE");
      }

      const previousInstrumentId = currentHealth.data()?.lastQuoteInstrumentId;
      const storedHealth: StoredHealth = {
        ...input.health,
        ...(input.quote === undefined
          ? typeof previousInstrumentId === "string"
            ? { lastQuoteInstrumentId: previousInstrumentId }
            : {}
          : { lastQuoteInstrumentId: input.quote.instrumentId }),
        schemaVersion: 1,
        updatedAt: input.health.lastAttemptAt,
      };
      transaction.set(healthReference, storedHealth);

      if (input.quote !== undefined) {
        transaction.set(
          runtimeCollection(this.database, "providerQuotes").doc(
            stableDocumentId(input.quote.instrumentId),
          ),
          {
            schemaVersion: 1,
            quote: input.quote,
            updatedAt: input.health.lastAttemptAt,
          },
        );
      }
      const receipt: StoredReceipt = {
        schemaVersion: 1,
        executionKeyHash,
        result: input.result,
        committedAt: input.health.lastAttemptAt,
      };
      transaction.create(receiptReference, receipt);
    });
  }
}

export class Sha256OperationsHash implements OperationsHashPort {
  hash(value: string): string {
    return stableDocumentId(value);
  }
}

/** Cloud Logging 필드에는 식별자 해시와 안정 오류 코드만 기록합니다. */
export class FirebaseProviderObservationLogger implements ProviderObservationPort {
  record(input: Parameters<ProviderObservationPort["record"]>[0]): void {
    logger.info("provider-operation", {
      eventType: input.kind,
      provider: input.provider,
      operation: input.operation,
      executionKeyHash: input.executionKeyHash,
      resultKind: input.resultKind,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
      observedAt: input.observedAt,
    });
  }
}

/**
 * 실제 메일 발송은 Cloud Monitoring notification channel이 담당합니다.
 * 이 포트는 경보 정책이 구독할 구조화 로그의 open/resolve 전이만 발행합니다.
 */
export class CloudMonitoringProviderAlertLogger implements ProviderAlertPort {
  async transition(
    input: Parameters<ProviderAlertPort["transition"]>[0],
  ): Promise<void> {
    const payload = {
      eventType: "provider-health-alert-transition",
      alertIdentity: input.alertIdentity,
      transition: input.transition,
      notificationChannelResource: input.notificationChannelResource,
      occurredAt: input.occurredAt,
    };
    if (input.transition === "opened") {
      logger.error("provider-health-alert", payload);
    } else {
      logger.info("provider-health-alert-resolved", payload);
    }
  }
}
