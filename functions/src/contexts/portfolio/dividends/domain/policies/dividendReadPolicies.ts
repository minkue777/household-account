import type {
  AnnualDividendView,
  DividendEventFact,
  UpcomingDividendResult,
} from "../model/dividendRead";

const MONTH_COUNT = 12;

function normalizedMonthlyAmounts(
  monthlyAmounts: readonly unknown[],
): number[] {
  return Array.from({ length: MONTH_COUNT }, (_, index) => {
    const value = monthlyAmounts[index];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  });
}

export function calculateAnnualDividendAmounts(
  events: readonly Pick<
    DividendEventFact,
    "status" | "paymentDate" | "totalAmount"
  >[],
): number[] {
  const totals = Array<number>(MONTH_COUNT).fill(0);
  for (const event of events) {
    if (
      (event.status !== "fixed" && event.status !== "paid") ||
      event.totalAmount === undefined
    ) {
      continue;
    }
    const month = Number(event.paymentDate.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > MONTH_COUNT) continue;
    totals[month - 1] += event.totalAmount;
  }
  return totals;
}

function monthlyAmountsMatchEvents(
  monthlyAmounts: readonly number[],
  events: Readonly<Record<string, DividendEventFact>>,
): boolean {
  const totals = calculateAnnualDividendAmounts(Object.values(events));
  return totals.every((total, index) => total === monthlyAmounts[index]);
}

export function normalizeAnnualDividends(input: {
  monthlyAmounts: readonly unknown[];
  events: Readonly<Record<string, DividendEventFact>>;
}): AnnualDividendView {
  const monthlyAmounts = normalizedMonthlyAmounts(input.monthlyAmounts);
  const valuesWereCanonical =
    input.monthlyAmounts.length === MONTH_COUNT &&
    input.monthlyAmounts.every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
  const keysWereCanonical = Object.entries(input.events).every(
    ([key, event]) => key === event.eventId,
  );
  return {
    monthlyAmounts,
    events: Object.fromEntries(
      Object.entries(input.events).map(([key, event]) => [key, { ...event }]),
    ),
    freshness:
      valuesWereCanonical &&
      keysWereCanonical &&
      monthlyAmountsMatchEvents(monthlyAmounts, input.events)
        ? "fresh"
        : "stale",
  };
}

export function estimateUpcomingDividends(input: {
  asOfDate: string;
  announced: readonly DividendEventFact[];
  confirmed: readonly DividendEventFact[];
  holdings:
    | { kind: "success"; quantities: Readonly<Record<string, number>> }
    | { kind: "retryable-failure"; code: string };
}): UpcomingDividendResult {
  if (input.holdings.kind === "retryable-failure") return input.holdings;
  const quantities = input.holdings.quantities;

  const confirmedIds = new Set(
    input.confirmed
      .filter(({ status }) => status === "fixed" || status === "paid")
      .map(({ eventId }) => eventId),
  );
  const items = input.announced
    .filter(
      (event) =>
        event.status === "announced" &&
        event.recordDate >= input.asOfDate &&
        !confirmedIds.has(event.eventId),
    )
    .sort(
      (left, right) =>
        left.paymentDate.localeCompare(right.paymentDate) ||
        left.eventId.localeCompare(right.eventId),
    )
    .map((event) => {
      const estimatedQuantity = quantities[event.instrumentCode] ?? 0;
      return {
        eventId: event.eventId,
        estimatedQuantity,
        estimatedAmount: Math.round(
          event.perShareAmount * estimatedQuantity,
        ),
      };
    });
  return { kind: "success", items };
}
