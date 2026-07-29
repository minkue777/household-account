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

function observation(entry: LoggingEntry): InteractiveLatencyObservation | undefined {
  const payload = record(entry.jsonPayload);
  const endpoint = payload?.endpoint;
  const operation = payload?.operation;
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
    endpoint: endpoint as AdminDashboardFunctionLatency["endpoint"],
    operation,
    elapsedMs,
    status: status as InteractiveLatencyObservation["status"],
    timestamp,
  };
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
  for (const item of observations) {
    if (EXCLUDED_OPERATIONS.has(item.operation)) continue;
    const resetAt = LATENCY_RESET_AT_BY_OPERATION.get(item.operation);
    if (resetAt !== undefined && Date.parse(item.timestamp) < resetAt) {
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
      const durations = items.map(({ elapsedMs }) => elapsedMs);
      const total = durations.reduce((sum, value) => sum + value, 0);
      return {
        endpoint: first.endpoint,
        operation: first.operation,
        sampleCount: items.length,
        succeededCount: items.filter(({ status }) => status === "succeeded").length,
        failedCount: items.filter(({ status }) => status !== "succeeded").length,
        averageMs: roundedTenth(total / items.length),
        p95Ms: roundedTenth(percentile(durations, 0.95)),
        maxMs: roundedTenth(Math.max(...durations)),
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
