import { describe, expect, it } from "vitest";

import { createProviderHealthAlertingFixture } from "../../../support/provider-health-alerting-fixture";

type ProviderResultKind =
  | "SUCCESS"
  | "NO_DATA"
  | "RETRYABLE_FAILURE"
  | "CONTRACT_FAILURE"
  | "INVALID_DATA";

interface QuoteView {
  instrumentId: string;
  price: number;
  currency: string;
  provider: string;
  observedAt: string;
}

interface ProviderAttemptFixture {
  resultKind: ProviderResultKind;
  errorCode?: string;
  attempt: number;
  latencyMs: number;
}

interface RefreshProviderCommand {
  provider: string;
  operation: string;
  executionKey: string;
  expectedData: boolean;
  observedAt: string;
}

interface ProviderRunFixture {
  attempts: readonly ProviderAttemptFixture[];
  finalResult:
    | { kind: "SUCCESS"; quote: QuoteView }
    | {
        kind: Exclude<ProviderResultKind, "SUCCESS">;
        code: string;
      };
}

interface ProviderHealthState {
  provider: string;
  operation: string;
  status: "healthy" | "degraded" | "outage";
  lastAttemptAt: string;
  lastSuccessAt?: string;
  consecutiveFailedRuns: number;
  failureStartedAt?: string;
  lastResultKind: ProviderResultKind;
  lastErrorCode?: string;
  alertState: "closed" | "open";
  recoveredAt?: string;
  version: number;
}

type RefreshProviderResult =
  | {
      kind: "quote-updated";
      quote: QuoteView;
      health: ProviderHealthState;
    }
  | {
      kind: "last-success-retained";
      quote: QuoteView;
      failure: { kind: Exclude<ProviderResultKind, "SUCCESS">; code: string };
      health: ProviderHealthState;
    }
  | {
      kind: "quote-unavailable";
      failure: { kind: Exclude<ProviderResultKind, "SUCCESS">; code: string };
      health: ProviderHealthState;
    };

interface ProviderObservation {
  kind: "provider-attempt" | "provider-run-outcome";
  provider: string;
  operation: string;
  executionKeyHash: string;
  resultKind: ProviderResultKind;
  errorCode?: string;
  attempt?: number;
  latencyMs?: number;
  observedAt: string;
  targetHash?: string;
}

interface ProviderAlertReceipt {
  alertIdentity: string;
  transition: "opened" | "resolved";
  channelType: "email";
  notificationChannelResource: string;
  deliveryStatus: "delivered" | "pending-retry";
  occurredAt: string;
}

interface ProviderHealthFixture {
  initialQuote?: QuoteView;
  initialHealth?: ProviderHealthState;
  notificationChannelResource: string;
  alertDelivery?: "succeed" | "fail";
  runs: Readonly<Record<string, ProviderRunFixture>>;
}

/** Quote 보존과 운영 Health·Cloud Monitoring 경보를 잇는 공개 workflow 계약입니다. */
export interface ProviderHealthAlertingSubject {
  refresh(command: RefreshProviderCommand): Promise<RefreshProviderResult>;
  getQuote(instrumentId: string): Promise<QuoteView | undefined>;
  getHealth(provider: string, operation: string): Promise<ProviderHealthState | undefined>;
  observations(): readonly ProviderObservation[];
  alertReceipts(): readonly ProviderAlertReceipt[];
}

export function createSubject(
  fixture: ProviderHealthFixture,
): ProviderHealthAlertingSubject {
  return createProviderHealthAlertingFixture(fixture);
}

const notificationChannelResource =
  "projects/household-account/notificationChannels/provider-alert-email";

const quote = (
  overrides: Partial<QuoteView> = {},
): QuoteView => ({
  instrumentId: "gold-krw",
  price: 572_000,
  currency: "KRW",
  provider: "physical-gold",
  observedAt: "2025-07-19T23:55:00+09:00",
  ...overrides,
});

const healthy = (
  overrides: Partial<ProviderHealthState> = {},
): ProviderHealthState => ({
  provider: "physical-gold",
  operation: "quote",
  status: "healthy",
  lastAttemptAt: "2025-07-19T23:55:00+09:00",
  lastSuccessAt: "2025-07-19T23:55:00+09:00",
  consecutiveFailedRuns: 0,
  lastResultKind: "SUCCESS",
  alertState: "closed",
  version: 1,
  ...overrides,
});

const refreshCommand = (
  sequence: number,
  overrides: Partial<RefreshProviderCommand> = {},
): RefreshProviderCommand => ({
  provider: "physical-gold",
  operation: "quote",
  executionKey: `asset-valuation-daily:2026-07-${String(sequence).padStart(2, "0")}`,
  expectedData: true,
  observedAt: `2026-07-${String(sequence).padStart(2, "0")}T23:55:00+09:00`,
  ...overrides,
});

const retryableRun: ProviderRunFixture = {
  attempts: [
    {
      resultKind: "RETRYABLE_FAILURE",
      errorCode: "MARKET_TIMEOUT",
      attempt: 1,
      latencyMs: 10_000,
    },
    {
      resultKind: "RETRYABLE_FAILURE",
      errorCode: "MARKET_TIMEOUT",
      attempt: 2,
      latencyMs: 10_000,
    },
    {
      resultKind: "RETRYABLE_FAILURE",
      errorCode: "MARKET_TIMEOUT",
      attempt: 3,
      latencyMs: 10_000,
    },
  ],
  finalResult: { kind: "RETRYABLE_FAILURE", code: "MARKET_TIMEOUT" },
};

const retryableRuns = (
  sequences: readonly number[],
): Readonly<Record<string, ProviderRunFixture>> =>
  Object.fromEntries(
    sequences.map((sequence) => [refreshCommand(sequence).executionKey, retryableRun]),
  );

describe("마지막 성공 Quote·Provider Health·이메일 경보 공개 계약", () => {
  it("[T-MARKET-001][MARKET-004] 장기간 갱신 실패에도 마지막 성공 가격과 observedAt을 그대로 유지한다", async () => {
    const lastSuccess = quote();
    const subject = createSubject({
      initialQuote: lastSuccess,
      initialHealth: healthy(),
      notificationChannelResource,
      runs: retryableRuns(Array.from({ length: 10 }, (_, index) => index + 1)),
    });

    let latestResult: RefreshProviderResult | undefined;
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      latestResult = await subject.refresh(refreshCommand(sequence));
    }

    expect(latestResult).toMatchObject({
      kind: "last-success-retained",
      quote: lastSuccess,
      failure: { kind: "RETRYABLE_FAILURE", code: "MARKET_TIMEOUT" },
    });
    expect(await subject.getQuote(lastSuccess.instrumentId)).toEqual(lastSuccess);
  });

  it("[T-MARKET-001][MARKET-004] 한 run의 내부 재시도 3회는 연속 실패 run을 한 번만 증가시킨다", async () => {
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy(),
      notificationChannelResource,
      runs: retryableRuns([1]),
    });

    const result = await subject.refresh(refreshCommand(1));

    expect(result.health).toMatchObject({
      status: "degraded",
      consecutiveFailedRuns: 1,
      alertState: "closed",
      lastResultKind: "RETRYABLE_FAILURE",
      lastErrorCode: "MARKET_TIMEOUT",
    });
    expect(
      subject.observations().filter(({ kind }) => kind === "provider-attempt"),
    ).toHaveLength(3);
    expect(
      subject.observations().filter(({ kind }) => kind === "provider-run-outcome"),
    ).toHaveLength(1);
  });

  it("[T-MARKET-001][MARKET-004] 추적 Quote의 예상된 retryable 실패는 세 번째 예약 run에 한 번 경보를 연다", async () => {
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy(),
      notificationChannelResource,
      runs: retryableRuns([1, 2, 3]),
    });

    const first = await subject.refresh(refreshCommand(1));
    const second = await subject.refresh(refreshCommand(2));
    const third = await subject.refresh(refreshCommand(3));

    expect(first.health).toMatchObject({
      status: "degraded",
      consecutiveFailedRuns: 1,
      alertState: "closed",
    });
    expect(second.health).toMatchObject({
      status: "degraded",
      consecutiveFailedRuns: 2,
      alertState: "closed",
    });
    expect(third.health).toMatchObject({
      status: "outage",
      consecutiveFailedRuns: 3,
      alertState: "open",
    });
    expect(subject.alertReceipts()).toEqual([
      expect.objectContaining({
        transition: "opened",
        channelType: "email",
        notificationChannelResource,
        deliveryStatus: "delivered",
      }),
    ]);
  });

  it("[T-MARKET-001][MARKET-004] 추적 Quote의 예상 밖 NoData도 세 번째 예약 run에 outage로 전이한다", async () => {
    const noDataRun: ProviderRunFixture = {
      attempts: [
        {
          resultKind: "NO_DATA",
          errorCode: "QUOTE_NOT_PUBLISHED",
          attempt: 1,
          latencyMs: 100,
        },
      ],
      finalResult: { kind: "NO_DATA", code: "QUOTE_NOT_PUBLISHED" },
    };
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy(),
      notificationChannelResource,
      runs: Object.fromEntries(
        [1, 2, 3].map((sequence) => [
          refreshCommand(sequence).executionKey,
          noDataRun,
        ]),
      ),
    });

    const first = await subject.refresh(refreshCommand(1));
    const second = await subject.refresh(refreshCommand(2));
    const third = await subject.refresh(refreshCommand(3));

    expect(first.health).toMatchObject({ status: "degraded", consecutiveFailedRuns: 1 });
    expect(second.health).toMatchObject({ status: "degraded", consecutiveFailedRuns: 2 });
    expect(third).toMatchObject({
      kind: "last-success-retained",
      quote: quote(),
      health: {
        status: "outage",
        consecutiveFailedRuns: 3,
        alertState: "open",
        lastResultKind: "NO_DATA",
      },
    });
  });

  it("[T-MARKET-001][MARKET-004] 데이터가 없을 수 있는 조회의 명시적 NoData는 정상 상태로 유지한다", async () => {
    const request = refreshCommand(1, { expectedData: false });
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy(),
      notificationChannelResource,
      runs: {
        [request.executionKey]: {
          attempts: [
            {
              resultKind: "NO_DATA",
              errorCode: "QUOTE_NOT_PUBLISHED",
              attempt: 1,
              latencyMs: 50,
            },
          ],
          finalResult: { kind: "NO_DATA", code: "QUOTE_NOT_PUBLISHED" },
        },
      },
    });

    const result = await subject.refresh(request);

    expect(result.health).toMatchObject({
      status: "healthy",
      consecutiveFailedRuns: 0,
      alertState: "closed",
      lastResultKind: "NO_DATA",
    });
    expect(subject.alertReceipts()).toEqual([]);
  });

  it.each([
    ["CONTRACT_FAILURE", "MARKET_SCHEMA_CHANGED"],
    ["INVALID_DATA", "INVALID_PROVIDER_DATA"],
    ["CONTRACT_FAILURE", "PROVIDER_AUTHENTICATION_FAILED"],
    ["CONTRACT_FAILURE", "PROVIDER_CONFIGURATION_INVALID"],
  ] as const)(
    "[T-MARKET-001][MARKET-004] %s는 첫 예약 run에 즉시 outage 경보를 연다",
    async (kind, code) => {
      const request = refreshCommand(1);
      const subject = createSubject({
        initialQuote: quote(),
        initialHealth: healthy(),
        notificationChannelResource,
        runs: {
          [request.executionKey]: {
            attempts: [
              { resultKind: kind, errorCode: code, attempt: 1, latencyMs: 80 },
            ],
            finalResult: { kind, code },
          },
        },
      });

      const result = await subject.refresh(request);

      expect(result.health).toMatchObject({
        status: "outage",
        consecutiveFailedRuns: 1,
        alertState: "open",
        lastResultKind: kind,
        lastErrorCode: code,
      });
      expect(subject.alertReceipts()).toEqual([
        expect.objectContaining({
          transition: "opened",
          channelType: "email",
          notificationChannelResource,
        }),
      ]);
    },
  );

  it("[T-MARKET-001][MARKET-004] 같은 executionKey replay는 Health count와 열린 경보를 중복 변경하지 않는다", async () => {
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy({
        status: "degraded",
        consecutiveFailedRuns: 2,
        failureStartedAt: "2026-07-01T23:55:00+09:00",
        lastResultKind: "RETRYABLE_FAILURE",
        lastErrorCode: "MARKET_TIMEOUT",
        version: 3,
      }),
      notificationChannelResource,
      runs: retryableRuns([3]),
    });
    const failure = refreshCommand(3);

    const first = await subject.refresh(failure);
    const replay = await subject.refresh(failure);

    expect(replay.health).toEqual(first.health);
    expect(replay.health.consecutiveFailedRuns).toBe(3);
    expect(subject.alertReceipts()).toHaveLength(1);
  });

  it("[T-MARKET-001][MARKET-004] 다음 성공은 실패 수를 초기화하고 동일 alert identity를 복구한다", async () => {
    const recoveredQuote = quote({
      price: 580_000,
      observedAt: "2026-07-04T23:55:00+09:00",
    });
    const recoveryCommand = refreshCommand(4, {
      observedAt: recoveredQuote.observedAt,
    });
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy(),
      notificationChannelResource,
      runs: {
        ...retryableRuns([1, 2, 3]),
        [recoveryCommand.executionKey]: {
          attempts: [{ resultKind: "SUCCESS", attempt: 1, latencyMs: 120 }],
          finalResult: { kind: "SUCCESS", quote: recoveredQuote },
        },
      },
    });
    await subject.refresh(refreshCommand(1));
    await subject.refresh(refreshCommand(2));
    await subject.refresh(refreshCommand(3));

    const recovery = await subject.refresh(recoveryCommand);

    expect(recovery).toMatchObject({
      kind: "quote-updated",
      quote: recoveredQuote,
      health: {
        status: "healthy",
        consecutiveFailedRuns: 0,
        alertState: "closed",
        lastResultKind: "SUCCESS",
        lastSuccessAt: recoveredQuote.observedAt,
        recoveredAt: recoveredQuote.observedAt,
      },
    });
    const alerts = subject.alertReceipts();
    expect(alerts.map(({ transition }) => transition)).toEqual(["opened", "resolved"]);
    expect(alerts[1]?.alertIdentity).toBe(alerts[0]?.alertIdentity);
  });

  it("[T-MARKET-001][MARKET-004] 경보 전송 실패는 Health outage를 rollback하지 않고 전달 재시도 상태로 남긴다", async () => {
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy({
        status: "degraded",
        consecutiveFailedRuns: 2,
        failureStartedAt: "2026-07-01T23:55:00+09:00",
        lastResultKind: "RETRYABLE_FAILURE",
        lastErrorCode: "MARKET_TIMEOUT",
      }),
      notificationChannelResource,
      alertDelivery: "fail",
      runs: retryableRuns([3]),
    });

    const result = await subject.refresh(refreshCommand(3));

    expect(result.health).toMatchObject({
      status: "outage",
      consecutiveFailedRuns: 3,
      alertState: "open",
    });
    expect(await subject.getHealth("physical-gold", "quote")).toEqual(result.health);
    expect(subject.alertReceipts()).toEqual([
      expect.objectContaining({
        transition: "opened",
        deliveryStatus: "pending-retry",
      }),
    ]);
  });

  it("[T-MARKET-001][MARKET-004] 성공 이력이 없을 때 실패를 고정·추정 Quote로 만들지 않는다", async () => {
    const subject = createSubject({
      notificationChannelResource,
      runs: retryableRuns([1]),
    });

    const result = await subject.refresh(refreshCommand(1));

    expect(result).toMatchObject({
      kind: "quote-unavailable",
      failure: { kind: "RETRYABLE_FAILURE", code: "MARKET_TIMEOUT" },
    });
    expect(await subject.getQuote("gold-krw")).toBeUndefined();
  });

  it("[EXT-001][MARKET-004] 공개 Health·관측·경보에는 이메일 주소와 금융 원문을 남기지 않는다", async () => {
    const request = refreshCommand(3, {
      executionKey: "household-secret:asset-secret:2026-07-03",
    });
    const subject = createSubject({
      initialQuote: quote(),
      initialHealth: healthy({
        status: "degraded",
        consecutiveFailedRuns: 2,
        lastResultKind: "RETRYABLE_FAILURE",
      }),
      notificationChannelResource,
      runs: { [request.executionKey]: retryableRun },
    });
    await subject.refresh(request);

    const publicOperationsState = JSON.stringify({
      health: await subject.getHealth("physical-gold", "quote"),
      observations: subject.observations(),
      alerts: subject.alertReceipts(),
    });

    expect(publicOperationsState).not.toContain("@");
    expect(publicOperationsState).not.toContain("household-secret");
    expect(publicOperationsState).not.toContain("asset-secret");
    expect(publicOperationsState).not.toContain(String(quote().price));
    expect(publicOperationsState).toContain(notificationChannelResource);
  });
});
