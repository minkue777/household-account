import { applicationDefault } from "firebase-admin/app";

import type {
  BillingCostSourceReaderPort,
  BillingCostSourceSnapshot,
} from "../../../platform/admin-operations/application/billingCostSummary";
import { BillingCostSourceNotReadyError } from "../../../platform/admin-operations/application/billingCostSummary";

interface AccessTokenProvider {
  getAccessToken(): Promise<{ readonly access_token: string }>;
}

interface BigQueryFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

type BigQueryFetch = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal: AbortSignal;
  },
) => Promise<BigQueryFetchResponse>;

interface BigQueryQueryResponse {
  readonly jobComplete?: unknown;
  readonly jobReference?: unknown;
  readonly rows?: unknown;
  readonly errors?: unknown;
}

const MAXIMUM_BYTES_BILLED = "268435456";
const TABLE_ID_PATTERN =
  /^[a-z][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z_][A-Za-z0-9_]{0,1023}\.[A-Za-z0-9_]+$/u;
const LOCATION_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,31}$/u;
const SEOUL_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

const BILLING_COST_QUERY = (tableId: string) => `
WITH base AS (
  SELECT
    DATE(usage_start_time, 'Asia/Seoul') AS usage_date,
    service.id AS service_id,
    service.description AS service_name,
    currency,
    CAST(cost AS NUMERIC)
      + IFNULL((
          SELECT SUM(CAST(credit.amount AS NUMERIC))
          FROM UNNEST(credits) AS credit
        ), 0) AS net_cost,
    export_time
  FROM \`${tableId}\`
  WHERE project.id = @projectId
    AND export_time >= TIMESTAMP_SUB(
      TIMESTAMP(@fromDate, 'Asia/Seoul'),
      INTERVAL 7 DAY
    )
    AND DATE(usage_start_time, 'Asia/Seoul') BETWEEN @fromDate AND @today
),
daily AS (
  SELECT usage_date, SUM(net_cost) AS amount
  FROM base
  GROUP BY usage_date
),
services AS (
  SELECT
    service_id,
    service_name,
    SUM(net_cost) AS amount
  FROM base
  WHERE usage_date BETWEEN @monthStart AND @today
  GROUP BY service_id, service_name
),
metadata AS (
  SELECT ANY_VALUE(currency) AS currency, MAX(export_time) AS data_updated_at
  FROM base
)
SELECT TO_JSON_STRING(STRUCT(
  (SELECT currency FROM metadata) AS currency,
  (SELECT data_updated_at FROM metadata) AS dataUpdatedAt,
  ARRAY(
    SELECT AS STRUCT FORMAT_DATE('%F', usage_date) AS date, CAST(amount AS FLOAT64) AS amount
    FROM daily
    ORDER BY usage_date
  ) AS dailyAmounts,
  ARRAY(
    SELECT AS STRUCT
      service_id AS serviceId,
      service_name AS serviceName,
      CAST(amount AS FLOAT64) AS amount
    FROM services
    ORDER BY amount DESC, service_name
  ) AS serviceAmounts
)) AS payload
`;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateInSeoul(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("BILLING_INSTANT_INVALID");
  return new Date(parsed + SEOUL_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error("BILLING_DATE_INVALID");
  return new Date(parsed + days * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function queryParameter(name: string, type: "STRING" | "DATE", value: string) {
  return {
    name,
    parameterType: { type },
    parameterValue: { value },
  };
}

function responseError(body: BigQueryQueryResponse): boolean {
  return Array.isArray(body.errors) && body.errors.length > 0;
}

function payloadFromRows(rows: unknown): unknown {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row = record(rows[0]);
  const fields = row?.f;
  if (!Array.isArray(fields) || fields.length === 0) return undefined;
  return record(fields[0])?.v;
}

function parsePayload(value: unknown): BillingCostSourceSnapshot {
  if (value === undefined) throw new BillingCostSourceNotReadyError();
  if (typeof value !== "string") throw new Error("BILLING_QUERY_RESULT_INVALID");
  const payload = record(JSON.parse(value));
  const currency = nonEmptyString(payload?.currency);
  const dataUpdatedAt = nonEmptyString(payload?.dataUpdatedAt);
  if (
    currency === undefined &&
    dataUpdatedAt === undefined &&
    Array.isArray(payload?.dailyAmounts) &&
    payload.dailyAmounts.length === 0 &&
    Array.isArray(payload.serviceAmounts) &&
    payload.serviceAmounts.length === 0
  ) {
    throw new BillingCostSourceNotReadyError();
  }
  if (
    currency === undefined ||
    dataUpdatedAt === undefined ||
    !Number.isFinite(Date.parse(dataUpdatedAt)) ||
    !Array.isArray(payload?.dailyAmounts) ||
    !Array.isArray(payload.serviceAmounts)
  ) {
    throw new Error("BILLING_QUERY_RESULT_INVALID");
  }

  const dailyAmounts = payload.dailyAmounts.map((value) => {
    const daily = record(value);
    const date = nonEmptyString(daily?.date);
    const amount = finiteNumber(daily?.amount);
    if (date === undefined || amount === undefined) {
      throw new Error("BILLING_QUERY_RESULT_INVALID");
    }
    return { date, amount };
  });
  const serviceAmounts = payload.serviceAmounts.map((value) => {
    const service = record(value);
    const serviceId = nonEmptyString(service?.serviceId);
    const serviceName = nonEmptyString(service?.serviceName);
    const amount = finiteNumber(service?.amount);
    if (
      serviceId === undefined ||
      serviceName === undefined ||
      amount === undefined
    ) {
      throw new Error("BILLING_QUERY_RESULT_INVALID");
    }
    return { serviceId, serviceName, amount };
  });

  return {
    currency,
    dataUpdatedAt: new Date(dataUpdatedAt).toISOString(),
    dailyAmounts,
    serviceAmounts,
  };
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
    return nonEmptyString(config.projectId);
  } catch {
    return undefined;
  }
}

export class GoogleCloudBillingCostReader
implements BillingCostSourceReaderPort {
  constructor(
    private readonly queryProjectId: string,
    private readonly tableId: string,
    private readonly location: string,
    private readonly tokenProvider: AccessTokenProvider,
    private readonly fetcher: BigQueryFetch = globalThis.fetch as BigQueryFetch,
    private readonly timeoutMs = 20_000,
  ) {
    if (!TABLE_ID_PATTERN.test(tableId)) {
      throw new Error("BILLING_EXPORT_TABLE_INVALID");
    }
    if (!LOCATION_PATTERN.test(location)) {
      throw new Error("BILLING_EXPORT_LOCATION_INVALID");
    }
  }

  async read(input: {
    readonly projectId: string;
    readonly calculatedAt: string;
  }): Promise<BillingCostSourceSnapshot> {
    const today = dateInSeoul(input.calculatedAt);
    const monthStart = `${today.slice(0, 7)}-01`;
    const recentStart = shiftDate(today, -7);
    const fromDate = recentStart < monthStart ? recentStart : monthStart;
    const token = await this.tokenProvider.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.queryProjectId)}/queries`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: BILLING_COST_QUERY(this.tableId),
            useLegacySql: false,
            parameterMode: "NAMED",
            queryParameters: [
              queryParameter("projectId", "STRING", input.projectId),
              queryParameter("fromDate", "DATE", fromDate),
              queryParameter("monthStart", "DATE", monthStart),
              queryParameter("today", "DATE", today),
            ],
            location: this.location,
            maximumBytesBilled: MAXIMUM_BYTES_BILLED,
            timeoutMs: Math.max(1_000, this.timeoutMs - 1_000),
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        if (response.status === 404) throw new BillingCostSourceNotReadyError();
        throw new Error(`BILLING_QUERY_HTTP_${response.status}`);
      }
      let body = await response.json() as BigQueryQueryResponse;
      if (responseError(body)) throw new Error("BILLING_QUERY_FAILED");

      if (body.jobComplete !== true) {
        const jobReference = record(body.jobReference);
        const jobId = nonEmptyString(jobReference?.jobId);
        if (jobId === undefined) throw new Error("BILLING_QUERY_INCOMPLETE");
        const pollResponse = await this.fetcher(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.queryProjectId)}/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(this.location)}&timeoutMs=${Math.max(1_000, this.timeoutMs - 1_000)}`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${token.access_token}` },
            signal: controller.signal,
          },
        );
        if (!pollResponse.ok) {
          throw new Error(`BILLING_QUERY_POLL_HTTP_${pollResponse.status}`);
        }
        body = await pollResponse.json() as BigQueryQueryResponse;
        if (responseError(body)) throw new Error("BILLING_QUERY_FAILED");
      }
      if (body.jobComplete !== true) throw new Error("BILLING_QUERY_INCOMPLETE");
      return parsePayload(payloadFromRows(body.rows));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface GoogleCloudBillingCostConfiguration {
  readonly projectId: string;
  readonly reader: BillingCostSourceReaderPort;
}

export function createGoogleCloudBillingCostReader():
GoogleCloudBillingCostConfiguration | undefined {
  const projectId = projectIdFromEnvironment();
  const tableId = process.env.CLOUD_BILLING_EXPORT_TABLE?.trim();
  const location = process.env.CLOUD_BILLING_EXPORT_LOCATION?.trim() || "US";
  return projectId === undefined || tableId === undefined || tableId === ""
    ? undefined
    : {
        projectId,
        reader: new GoogleCloudBillingCostReader(
          projectId,
          tableId,
          location,
          applicationDefault(),
        ),
      };
}
