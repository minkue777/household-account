import type * as firestore from "firebase-admin/firestore";

interface ProjectedDividendEvent {
  readonly eventId: string;
  readonly instrumentCode: string;
  readonly instrumentName: string;
  readonly paymentDate: string;
  readonly perShareAmount: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function eventFrom(
  key: string,
  value: unknown,
): ProjectedDividendEvent | undefined {
  const data = record(value);
  if (data === undefined) return undefined;
  const instrumentCode = text(data.instrumentCode ?? data.stockCode);
  const paymentDate = text(data.paymentDate);
  const perShareAmount = nonnegativeNumber(
    data.perShareAmount ?? data.dividend,
  );
  if (
    instrumentCode === undefined ||
    paymentDate === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(paymentDate) ||
    perShareAmount === undefined
  ) {
    return undefined;
  }
  return {
    eventId: text(data.eventId) ?? key,
    instrumentCode: instrumentCode.toLocaleUpperCase("en-US"),
    instrumentName:
      text(data.instrumentName ?? data.stockName) ?? instrumentCode,
    paymentDate,
    perShareAmount,
  };
}

function oneYearBefore(asOfDate: string): string {
  const date = new Date(`${asOfDate}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export class FirebasePortfolioDividendProjectionReader {
  constructor(private readonly database: firestore.Firestore) {}

  async read(input: {
    readonly householdId: string;
    readonly instrumentCode: string;
    readonly asOfDate: string;
  }) {
    const snapshots = await this.database
      .collection("dividend_snapshots")
      .where("householdId", "==", input.householdId)
      .get();
    const code = input.instrumentCode.trim().toLocaleUpperCase("en-US");
    const unique = new Map<string, ProjectedDividendEvent>();
    for (const snapshot of snapshots.docs) {
      const events = record(snapshot.data().events);
      if (events === undefined) continue;
      for (const [key, value] of Object.entries(events)) {
        const event = eventFrom(key, value);
        if (event !== undefined && event.instrumentCode === code) {
          unique.set(event.eventId, event);
        }
      }
    }
    const events = [...unique.values()].sort(
      (left, right) =>
        right.paymentDate.localeCompare(left.paymentDate) ||
        left.eventId.localeCompare(right.eventId),
    );
    const latest = events[0];
    const cutoff = oneYearBefore(input.asOfDate);
    const trailing = events.filter(
      ({ paymentDate }) =>
        paymentDate >= cutoff && paymentDate <= input.asOfDate,
    );
    return {
      code,
      name: latest?.instrumentName ?? code,
      recentDividend: latest?.perShareAmount ?? null,
      paymentDate: latest?.paymentDate ?? null,
      frequency: trailing.length === 0 ? null : trailing.length,
      dividendYield: null,
      annualDividendPerShare:
        trailing.length === 0
          ? null
          : trailing.reduce((total, event) => total + event.perShareAmount, 0),
      isEstimated: false as const,
      paymentEvents: trailing
        .slice()
        .sort((left, right) => left.paymentDate.localeCompare(right.paymentDate))
        .map(({ paymentDate, perShareAmount }) => ({
          paymentDate,
          dividend: perShareAmount,
        })),
    };
  }
}
