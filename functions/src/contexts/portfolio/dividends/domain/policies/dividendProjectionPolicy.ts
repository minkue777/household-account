import type {
  AnnualProjectionView,
  ProjectionChange,
  ProjectionEventFact,
} from "../model/dividendProjection";
import { calculateAnnualDividendAmounts } from "./dividendReadPolicies";

export type ProjectionChangeDecision =
  | { kind: "apply"; value: AnnualProjectionView }
  | { kind: "already-processed" }
  | { kind: "rebuild-required" };

function rebuildView(
  current: AnnualProjectionView,
  events: Readonly<Record<string, ProjectionEventFact>>,
  checkpoint: string,
): AnnualProjectionView {
  return {
    monthlyAmounts: calculateAnnualDividendAmounts(Object.values(events)),
    events,
    sourceCheckpoint: checkpoint,
    freshness: "fresh",
  };
}

export function applyDividendProjectionChange(
  current: AnnualProjectionView,
  change: ProjectionChange,
): ProjectionChangeDecision {
  if (current.freshness === "rebuilding") return { kind: "rebuild-required" };
  const existing = current.events[change.eventId];
  if (
    existing !== undefined &&
    change.aggregateVersion <= existing.aggregateVersion
  ) {
    return { kind: "already-processed" };
  }
  const expectedVersion =
    existing === undefined
      ? change.eventType === "DividendEventChanged.v1" &&
        change.event.status === "fixed"
        ? 2
        : 1
      : existing.aggregateVersion + 1;
  if (change.aggregateVersion !== expectedVersion) {
    return { kind: "rebuild-required" };
  }

  if (
    change.eventType === "DividendEventChanged.v1" &&
    (change.event.eventId !== change.eventId ||
      change.event.aggregateVersion !== change.aggregateVersion)
  ) {
    return { kind: "rebuild-required" };
  }
  const events = { ...current.events };
  if (change.eventType === "DividendEventRemoved.v1") {
    delete events[change.eventId];
  } else {
    events[change.eventId] = { ...change.event };
  }
  return {
    kind: "apply",
    value: rebuildView(current, events, change.checkpoint),
  };
}

export function rebuildDividendProjection(
  current: AnnualProjectionView,
  canonicalEvents: readonly ProjectionEventFact[],
): AnnualProjectionView {
  const events = Object.fromEntries(
    canonicalEvents
      .filter(({ status }) => status === "fixed" || status === "paid")
      .sort((left, right) => left.eventId.localeCompare(right.eventId))
      .map((event) => [event.eventId, { ...event }]),
  );
  return rebuildView(current, events, current.sourceCheckpoint);
}
