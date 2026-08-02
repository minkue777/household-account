import { applicationDefault } from "firebase-admin/app";

import type {
  AdminDashboardFunctionLatency,
  AdminDashboardFunctionLatencyWindow,
  AdminFunctionLatencyReaderPort,
} from "../../../platform/admin-operations/application/adminOperationsDashboard";

interface AccessTokenProvider {
  getAccessToken(): Promise<{ readonly access_token: string }>;
}

interface LoggingFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

type LoggingFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<LoggingFetchResponse>;

interface LoggingEntry {
  readonly timestamp?: unknown;
  readonly jsonPayload?: unknown;
}

interface LoggingEntriesResponse {
  readonly entries?: unknown;
  readonly nextPageToken?: unknown;
}

export interface InteractiveLatencyObservation {
  /**
   * 같은 사용자 요청이나 Outbox event의 재시도를 식별하는 값입니다.
   * 구형·외부 표본에는 없을 수 있으므로 optional로 읽되, 값이 있으면
   * 최신 1건만 운영 집계에 포함합니다.
   */
  readonly correlationId?: string;
  readonly endpoint: AdminDashboardFunctionLatency["endpoint"];
  readonly operation: string;
  readonly elapsedMs: number;
  readonly status: "succeeded" | "rejected" | "failed";
  readonly timestamp: string;
}

const ENDPOINTS = new Set<AdminDashboardFunctionLatency["endpoint"]>([
  "executeHouseholdCommand",
  "executeHouseholdQuery",
  "submitAndroidRawNotification",
  "addExpenseFromMessage",
  "consumeNotificationOutbox",
  "clientStartup",
]);
const STATUSES = new Set<InteractiveLatencyObservation["status"]>([
  "succeeded",
  "rejected",
  "failed",
]);
const MAX_INTERACTIVE_ELAPSED_MS = 10 * 60 * 1_000;
const MAX_NOTIFICATION_DELIVERY_ELAPSED_MS = 31 * 24 * 60 * 60 * 1_000;
const MAX_PAGES = 4;
const PAGE_SIZE = 250;
const EXCLUDED_OPERATIONS = new Set([
  // 실제 FCM 접수 시간은 consumeNotificationOutbox에서 별도로 집계합니다.
  // 이 command는 알림 요청 문서를 저장하는 시간일 뿐 사용자 체감 지표가 아닙니다.
  "ledger.request-notification.v1",
  // 관리자 가구 상세 화면 자체에서만 사용하는 보조 조회입니다.
  // 일반 사용자 기능의 체감 성능을 나타내지 않으므로 운영 성능 표에서 제외합니다.
  "access.list-asset-owner-profiles.v1",
]);
const LATENCY_RESET_AT_BY_OPERATION = new Map<string, number>([
  // 2026-07-28에 전체 원장 조회·재기록을 제거한 버전이 배포되었습니다.
  // 개선 전 측정치는 현재 구현의 지연 통계를 오염시키므로 집계에서 제외합니다.
  ["ledger.split-transaction.v1", Date.parse("2026-07-28T14:28:00.794Z")],
  [
    "ledger.split-existing-transaction-monthly.v1",
    Date.parse("2026-07-28T15:10:24.296Z"),
  ],
  [
    "ledger.cancel-monthly-split.v1",
    Date.parse("2026-07-28T15:10:24.296Z"),
  ],
  // 실행 중인 동일 범위의 시세 갱신 요청을 오류가 아닌 정상 생략으로
  // 분류하기 전 표본에는 중복 요청 거부가 실패로 섞여 있습니다.
  [
    "portfolio.refresh-market-values.v1",
    Date.parse("2026-07-29T10:45:28.395Z"),
  ],
  // NoTarget을 예외로 던지던 구 consumer가 같은 네 Outbox event를 반복해
  // 실패 238건과 수 시간짜리 지연으로 오염시킨 표본을 제외합니다.
  [
    "notifications.deliver-ios-shortcut.v1",
    Date.parse("2026-08-02T13:30:00.000Z"),
  ],
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function instant(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function correlationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized !== "" &&
    normalized.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)
    ? normalized
    : undefined;
}

function observation(entry: LoggingEntry): InteractiveLatencyObservation | undefined {
  const payload = record(entry.jsonPayload);
  const endpoint = payload?.endpoint;
  const operation = payload?.operation;
  const parsedCorrelationId = correlationId(payload?.correlationId);
  const elapsedMs = payload?.elapsedMs;
  const status = payload?.status;
  const timestamp = instant(entry.timestamp);
  if (
    typeof endpoint !== "string" ||
    !ENDPOINTS.has(endpoint as AdminDashboardFunctionLatency["endpoint"]) ||
    typeof operation !== "string" ||
    operation.trim() === "" ||
    operation.length > 120 ||
    typeof elapsedMs !== "number" ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    typeof status !== "string" ||
    !STATUSES.has(status as InteractiveLatencyObservation["status"]) ||
    timestamp === undefined
  ) {
    return undefined;
  }
  const maxElapsedMs =
    endpoint === "consumeNotificationOutbox"
      ? MAX_NOTIFICATION_DELIVERY_ELAPSED_MS
      : MAX_INTERACTIVE_ELAPSED_MS;
  if (elapsedMs > maxElapsedMs) return undefined;
  return {
    ...(parsedCorrelationId === undefined
      ? {}
      : { correlationId: parsedCorrelationId }),
    endpoint: endpoint as AdminDashboardFunctionLatency["endpoint"],
    operation,
    elapsedMs,
    status: status as InteractiveLatencyObservation["status"],
    timestamp,
  };
}

function statusTieBreak(
  left: InteractiveLatencyObservation,
  right: InteractiveLatencyObservation,
): InteractiveLatencyObservation {
  // 동일 millisecond로 정규화된 재시도 로그가 겹치면 성공·명시 거부처럼
  // 재시도가 끝난 결과를 단순 실행 실패보다 우선합니다.
  const terminalRank = { failed: 0, rejected: 1, succeeded: 2 } as const;
  return terminalRank[right.status] > terminalRank[left.status] ? right : left;
}

function latestCorrelatedObservations(
  observations: readonly InteractiveLatencyObservation[],
): readonly InteractiveLatencyObservation[] {
  const latest = new Map<string, InteractiveLatencyObservation>();
  const uncorrelated: InteractiveLatencyObservation[] = [];

  for (const item of observations) {
    if (item.correlationId === undefined) {
      uncorrelated.push(item);
      continue;
    }
    // 하나의 correlation이 여러 endpoint/operation을 통과할 수 있으므로
    // 서로 다른 업무 표본까지 합치지 않고 같은 지표 안의 재시도만 축약합니다.
    const correlationKey = [
      item.endpoint,
      item.operation,
      item.correlationId,
    ].join("\u0000");
    const current = latest.get(correlationKey);
    if (current === undefined) {
      latest.set(correlationKey, item);
      continue;
    }
    const itemTime = Date.parse(item.timestamp);
    const currentTime = Date.parse(current.timestamp);
    if (itemTime > currentTime) {
      latest.set(correlationKey, item);
    } else if (itemTime === currentTime) {
      latest.set(correlationKey, statusTieBreak(current, item));
    }
  }

  return [...uncorrelated, ...latest.values()];
}

function notificationDeliveryOperation(operation: string): boolean {
  return operation.startsWith("notifications.deliver-");
}

function roundedTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

export function summarizeInteractiveLatency(
  observations: readonly InteractiveLatencyObservation[],
): readonly AdminDashboardFunctionLatency[] {
  const groups = new Map<string, InteractiveLatencyObservation[]>();
  const eligible = observations.filter((item) => {
    if (EXCLUDED_OPERATIONS.has(item.operation)) return false;
    const resetAt = LATENCY_RESET_AT_BY_OPERATION.get(item.operation);
    if (resetAt !== undefined && Date.parse(item.timestamp) < resetAt) {
      return false;
    }
    return true;
  });
  for (const item of latestCorrelatedObservations(eligible)) {
    // NoTarget 같은 rejected 결과에는 FCM provider 호출이 없습니다. 알림 행의
    // 호출·성공 수는 provider에 실제 접수한 결과만 나타냅니다.
    if (
      notificationDeliveryOperation(item.operation) &&
      item.status === "rejected"
    ) {
      continue;
    }
    const key = `${item.endpoint}\u0000${item.operation}`;
    const values = groups.get(key) ?? [];
    values.push(item);
    groups.set(key, values);
  }

  return [...groups.values()]
    .map((items) => {
      const first = items[0];
      const durationItems = notificationDeliveryOperation(first.operation)
        ? items.filter(({ status }) => status === "succeeded")
        : items;
      const durations = durationItems.map(({ elapsedMs }) => elapsedMs);
      const total = durations.reduce((sum, value) => sum + value, 0);
      return {
        endpoint: first.endpoint,
        operation: first.operation,
        sampleCount: items.length,
        succeededCount: items.filter(({ status }) => status === "succeeded").length,
        failedCount: items.filter(({ status }) => status !== "succeeded").length,
        averageMs:
          durations.length === 0 ? 0 : roundedTenth(total / durations.length),
        p95Ms: roundedTenth(percentile(durations, 0.95)),
        maxMs:
          durations.length === 0 ? 0 : roundedTenth(Math.max(...durations)),
        latestAt: items.reduce(
          (latest, item) =>
            Date.parse(item.timestamp) > Date.parse(latest)
              ? item.timestamp
              : latest,
          first.timestamp,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.sampleCount - left.sampleCount ||
        right.p95Ms - left.p95Ms ||
        left.operation.localeCompare(right.operation),
    );
}

function projectIdFromEnvironment(): string | undefined {
  const direct =
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (direct) return direct;
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG ?? "{}") as {
      readonly projectId?: unknown;
    };
    return typeof config.projectId === "string" && config.projectId.trim() !== ""
      ? config.projectId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export class GoogleCloudInteractiveLatencyReader
implements AdminFunctionLatencyReaderPort {
  constructor(
    private readonly projectId: string,
    private readonly tokenProvider: AccessTokenProvider,
    private readonly fetcher: LoggingFetch = globalThis.fetch as LoggingFetch,
    private readonly timeoutMs = 4_000,
  ) {}

  async read(input: {
    readonly generatedAt: string;
    readonly windowHours: number;
  }): Promise<AdminDashboardFunctionLatencyWindow> {
    const until = new Date(input.generatedAt);
    const since = new Date(
      until.getTime() - input.windowHours * 60 * 60 * 1_000,
    ).toISOString();
    const token = await this.tokenProvider.getAccessToken();
    const observations: InteractiveLatencyObservation[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: LoggingFetchResponse;
      try {
        response = await this.fetcher(
          "https://logging.googleapis.com/v2/entries:list",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token.access_token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              resourceNames: [`projects/${this.projectId}`],
              filter: [
                `timestamp>=\"${since}\"`,
                `timestamp<=\"${until.toISOString()}\"`,
                'jsonPayload.message="interactive-latency"',
                'jsonPayload.schemaVersion="interactive-latency.v1"',
                'jsonPayload.stage="total"',
              ].join(" AND "),
              orderBy: "timestamp desc",
              pageSize: PAGE_SIZE,
              ...(pageToken === undefined ? {} : { pageToken }),
            }),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new Error(`Cloud Logging entries:list failed: HTTP ${response.status}`);
      }
      const body = record(await response.json()) as LoggingEntriesResponse | undefined;
      const entries = Array.isArray(body?.entries)
        ? body.entries as LoggingEntry[]
        : [];
      observations.push(
        ...entries.flatMap((entry) => {
          const parsed = observation(entry);
          return parsed === undefined ? [] : [parsed];
        }),
      );
      pageToken =
        typeof body?.nextPageToken === "string" && body.nextPageToken !== ""
          ? body.nextPageToken
          : undefined;
      if (pageToken === undefined) break;
    }

    return {
      status: "available",
      windowHours: input.windowHours,
      operations: summarizeInteractiveLatency(observations),
    };
  }
}

export function createGoogleCloudInteractiveLatencyReader():
AdminFunctionLatencyReaderPort | undefined {
  const projectId = projectIdFromEnvironment();
  return projectId === undefined
    ? undefined
    : new GoogleCloudInteractiveLatencyReader(
      projectId,
      applicationDefault(),
    );
}
