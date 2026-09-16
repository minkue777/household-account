export interface BillingCostDailyAmount {
  readonly date: string;
  readonly amount: number;
}

export interface BillingCostServiceAmount {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly amount: number;
}

export interface BillingCostSourceSnapshot {
  readonly currency: string;
  readonly dataUpdatedAt: string;
  readonly dailyAmounts: readonly BillingCostDailyAmount[];
  readonly serviceAmounts: readonly BillingCostServiceAmount[];
}

export interface BillingCostSummary {
  readonly billingMonth: string;
  readonly currency: string;
  readonly monthToDateAmount: number;
  readonly estimatedMonthEndAmount: number;
  readonly calculatedAt: string;
  readonly dataUpdatedAt: string;
  readonly serviceAmounts: readonly BillingCostServiceAmount[];
}

export interface BillingCostSourceReaderPort {
  read(input: {
    readonly projectId: string;
    readonly calculatedAt: string;
  }): Promise<BillingCostSourceSnapshot>;
}

export interface BillingCostSummaryStorePort {
  save(summary: BillingCostSummary): Promise<void>;
}

export class BillingCostSourceNotReadyError extends Error {
  constructor() {
    super("BILLING_COST_SOURCE_NOT_READY");
    this.name = "BillingCostSourceNotReadyError";
  }
}

const SEOUL_TIME_ZONE = "Asia/Seoul";
const RECENT_COMPLETE_DAYS = 7;

function dateInSeoul(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("BILLING_INSTANT_INVALID");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function shiftDate(value: string, days: number): string {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error("BILLING_DATE_INVALID");
  return new Date(parsed + days * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function daysInMonth(month: string): number {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (match === null) throw new Error("BILLING_MONTH_INVALID");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
}

function finiteAmount(value: number): number {
  if (!Number.isFinite(value)) throw new Error("BILLING_AMOUNT_INVALID");
  return value;
}

function roundedAmount(value: number, currency: string): number {
  const fractionDigits = currency === "KRW" ? 0 : 2;
  const multiplier = 10 ** fractionDigits;
  return Math.round(value * multiplier) / multiplier;
}

export function summarizeBillingCost(input: {
  readonly source: BillingCostSourceSnapshot;
  readonly calculatedAt: string;
}): BillingCostSummary {
  const today = dateInSeoul(input.calculatedAt);
  const billingMonth = today.slice(0, 7);
  const monthStart = `${billingMonth}-01`;
  const monthEndDay = daysInMonth(billingMonth);
  const currentDay = Number(today.slice(8, 10));
  const dailyByDate = new Map<string, number>();

  for (const daily of input.source.dailyAmounts) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(daily.date)) {
      throw new Error("BILLING_DATE_INVALID");
    }
    dailyByDate.set(
      daily.date,
      (dailyByDate.get(daily.date) ?? 0) + finiteAmount(daily.amount),
    );
  }

  const monthToDateAmount = [...dailyByDate.entries()]
    .filter(([date]) => date >= monthStart && date <= today)
    .reduce((sum, [, amount]) => sum + amount, 0);
  const recentCompletedAmount = Array.from(
    { length: RECENT_COMPLETE_DAYS },
    (_, index) => shiftDate(today, -(RECENT_COMPLETE_DAYS - index)),
  ).reduce((sum, date) => sum + (dailyByDate.get(date) ?? 0), 0);
  const recentDailyAverage = recentCompletedAmount / RECENT_COMPLETE_DAYS;
  const remainingFullDays = Math.max(0, monthEndDay - currentDay);
  const estimatedMonthEndAmount =
    monthToDateAmount + recentDailyAverage * remainingFullDays;

  const serviceAmounts = input.source.serviceAmounts
    .map((service) => ({
      ...service,
      amount: roundedAmount(finiteAmount(service.amount), input.source.currency),
    }))
    .filter(({ amount }) => amount !== 0)
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        left.serviceName.localeCompare(right.serviceName, "ko"),
    );

  return {
    billingMonth,
    currency: input.source.currency,
    monthToDateAmount: roundedAmount(
      monthToDateAmount,
      input.source.currency,
    ),
    estimatedMonthEndAmount: roundedAmount(
      Math.max(monthToDateAmount, estimatedMonthEndAmount),
      input.source.currency,
    ),
    calculatedAt: new Date(input.calculatedAt).toISOString(),
    dataUpdatedAt: new Date(input.source.dataUpdatedAt).toISOString(),
    serviceAmounts,
  };
}

export async function refreshBillingCost(input: {
  readonly projectId: string;
  readonly calculatedAt: string;
  readonly source: BillingCostSourceReaderPort;
  readonly store: BillingCostSummaryStorePort;
}): Promise<BillingCostSummary> {
  const source = await input.source.read({
    projectId: input.projectId,
    calculatedAt: input.calculatedAt,
  });
  const summary = summarizeBillingCost({
    source,
    calculatedAt: input.calculatedAt,
  });
  await input.store.save(summary);
  return summary;
}
