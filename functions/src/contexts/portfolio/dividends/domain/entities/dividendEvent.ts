export type DividendStatus = "announced" | "fixed" | "paid";

export interface DividendEvent {
  eventId: string;
  sourceDisclosureId: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  status: DividendStatus;
  eligibleQuantity?: number;
  totalAmount?: number;
  aggregateVersion: number;
}

export interface DividendDisclosureInput {
  sourceDisclosureId: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
}

export interface DividendChangedEvent {
  eventType: "DividendEventChanged.v1";
  aggregateId: string;
  aggregateVersion: number;
  status: DividendStatus;
}

export type DividendTransitionResult =
  | { kind: "success"; event: DividendEvent }
  | { kind: "no-change"; event: DividendEvent }
  | { kind: "conflict"; code: "INVALID_DIVIDEND_STATE_TRANSITION" };

export interface DividendMutationOutcome {
  result: DividendTransitionResult;
  changedEvents: readonly DividendChangedEvent[];
}

export interface DividendUpsertOutcome {
  event: DividendEvent;
  changedEvents: readonly DividendChangedEvent[];
}

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function normalizeSourceDisclosureId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("sourceDisclosureId는 비어 있을 수 없습니다.");
  }
  return normalized;
}

export function createDividendEventId(sourceDisclosureId: string): string {
  return `dividend-event:v1:KIND:${encodeURIComponent(
    normalizeSourceDisclosureId(sourceDisclosureId),
  )}`;
}

function changedEvent(event: DividendEvent): DividendChangedEvent {
  return {
    eventType: "DividendEventChanged.v1",
    aggregateId: event.eventId,
    aggregateVersion: event.aggregateVersion,
    status: event.status,
  };
}

function validateDisclosure(input: DividendDisclosureInput): void {
  if (!isValidLocalDate(input.recordDate) || !isValidLocalDate(input.paymentDate)) {
    throw new Error("배당 공시 날짜가 올바르지 않습니다.");
  }
  if (!Number.isFinite(input.perShareAmount) || input.perShareAmount < 0) {
    throw new Error("주당 배당액은 유한한 0 이상의 값이어야 합니다.");
  }
}

function disclosureEquals(
  event: DividendEvent,
  input: DividendDisclosureInput,
): boolean {
  return (
    event.sourceDisclosureId === input.sourceDisclosureId &&
    event.recordDate === input.recordDate &&
    event.paymentDate === input.paymentDate &&
    event.perShareAmount === input.perShareAmount
  );
}

export function upsertDividendAnnouncement(
  current: DividendEvent | undefined,
  input: DividendDisclosureInput,
): DividendUpsertOutcome {
  validateDisclosure(input);
  const sourceDisclosureId = normalizeSourceDisclosureId(input.sourceDisclosureId);
  const normalizedInput = { ...input, sourceDisclosureId };

  if (current) {
    if (current.eventId !== createDividendEventId(sourceDisclosureId)) {
      throw new Error("공시 ID와 배당 Event identity가 일치하지 않습니다.");
    }
    if (current.status === "paid" || disclosureEquals(current, normalizedInput)) {
      return { event: current, changedEvents: [] };
    }

    if (current.status === "fixed") {
      const event: DividendEvent = {
        ...current,
        ...normalizedInput,
        totalAmount:
          current.eligibleQuantity === undefined
            ? undefined
            : Math.round(input.perShareAmount * current.eligibleQuantity),
        aggregateVersion: current.aggregateVersion + 1,
      };
      return { event, changedEvents: [changedEvent(event)] };
    }

    const event: DividendEvent = {
      ...current,
      ...normalizedInput,
      aggregateVersion: current.aggregateVersion + 1,
    };
    return { event, changedEvents: [changedEvent(event)] };
  }

  const event: DividendEvent = {
    eventId: createDividendEventId(sourceDisclosureId),
    ...normalizedInput,
    status: "announced",
    aggregateVersion: 1,
  };
  return { event, changedEvents: [changedEvent(event)] };
}

const statusRank: Readonly<Record<DividendStatus, number>> = {
  announced: 0,
  fixed: 1,
  paid: 2,
};

export function validateDividendStateTransition(
  current: DividendStatus,
  target: DividendStatus,
): "allowed" | "no-change" | "conflict" {
  if (current === target) return "no-change";
  if (statusRank[target] !== statusRank[current] + 1) return "conflict";
  return "allowed";
}

function transitionToFixed(
  event: DividendEvent,
  eligibleQuantity: number | undefined,
): DividendMutationOutcome {
  if (
    eligibleQuantity === undefined ||
    !Number.isFinite(eligibleQuantity) ||
    eligibleQuantity < 0
  ) {
    return {
      result: { kind: "no-change", event },
      changedEvents: [],
    };
  }

  const fixed: DividendEvent = {
    ...event,
    status: "fixed",
    eligibleQuantity,
    totalAmount: Math.round(event.perShareAmount * eligibleQuantity),
    aggregateVersion: event.aggregateVersion + 1,
  };
  return {
    result: { kind: "success", event: fixed },
    changedEvents: [changedEvent(fixed)],
  };
}

function transitionToPaid(event: DividendEvent): DividendMutationOutcome {
  const paid: DividendEvent = {
    ...event,
    status: "paid",
    aggregateVersion: event.aggregateVersion + 1,
  };
  return {
    result: { kind: "success", event: paid },
    changedEvents: [changedEvent(paid)],
  };
}

export function advanceDividendEvent(
  event: DividendEvent,
  input: { asOfDate: string; eligibleQuantity?: number },
): DividendMutationOutcome {
  if (!isValidLocalDate(input.asOfDate)) {
    throw new Error("배당 상태 전이 기준일이 올바르지 않습니다.");
  }
  if (event.status === "paid") {
    return { result: { kind: "no-change", event }, changedEvents: [] };
  }
  if (event.status === "fixed") {
    return input.asOfDate >= event.paymentDate
      ? transitionToPaid(event)
      : { result: { kind: "no-change", event }, changedEvents: [] };
  }
  if (input.asOfDate < event.recordDate) {
    return { result: { kind: "no-change", event }, changedEvents: [] };
  }

  const fixed = transitionToFixed(event, input.eligibleQuantity);
  if (fixed.result.kind !== "success") return fixed;
  if (input.asOfDate < fixed.result.event.paymentDate) return fixed;

  const paid = transitionToPaid(fixed.result.event);
  return {
    result: paid.result,
    changedEvents: [...fixed.changedEvents, ...paid.changedEvents],
  };
}
