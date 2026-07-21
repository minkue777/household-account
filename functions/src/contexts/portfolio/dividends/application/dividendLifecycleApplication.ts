import { createDividendEventId } from "../domain/entities/dividendEvent";
import type {
  DividendCommandResult,
  DividendEventView,
  DividendIntegrationEvent,
  StoredDividendEvent,
} from "../domain/model/dividendLifecycle";
import { selectDividendEligibility } from "../domain/policies/dividendEligibilityPolicy";
import { calculateAnnualDividendAmounts } from "../domain/policies/dividendReadPolicies";
import type { DividendLifecycle } from "./ports/in/dividendLifecycle";
import type {
  DividendLifecycleRepository,
  DividendPositionSnapshotReader,
} from "./ports/out/dividendLifecyclePorts";

function view(event: StoredDividendEvent): DividendEventView {
  const {
    householdId: _householdId,
    aggregateVersion: _aggregateVersion,
    disclosureAliases: _disclosureAliases,
    ...result
  } = event;
  return {
    ...result,
    ...(result.eligibilityContributions === undefined
      ? {}
      : {
          eligibilityContributions: result.eligibilityContributions.map(
            (contribution) => ({ ...contribution }),
          ),
        }),
  };
}

function changed(event: StoredDividendEvent): DividendIntegrationEvent {
  return {
    eventType: "DividendEventChanged.v1",
    aggregateId: event.eventId,
    aggregateVersion: event.aggregateVersion,
  };
}

export function createDividendLifecycleApplication(dependencies: {
  repository: DividendLifecycleRepository;
  snapshotReader: DividendPositionSnapshotReader;
}): DividendLifecycle {
  return {
    async upsertAnnouncement(command) {
      const state = dependencies.repository.state();
      const replay = state.receipts[command.idempotencyKey];
      if (replay !== undefined) return replay;
      const targetSourceId =
        command.disclosure.correctsSourceDisclosureId ??
        command.disclosure.sourceDisclosureId;
      const current = state.events.find(
        (event) =>
          event.householdId === command.householdId &&
          event.disclosureAliases.includes(targetSourceId),
      );
      if (current?.status === "paid") {
        const result: DividendCommandResult = {
          kind: "already-processed",
          code: "PAID_DIVIDEND_IMMUTABLE",
          eventId: current.eventId,
        };
        dependencies.repository.commit({
          state: {
            ...state,
            receipts: { ...state.receipts, [command.idempotencyKey]: result },
          },
          integrationEvents: [],
        });
        return result;
      }

      if (command.disclosure.disclosureState === "cancelled") {
        if (current === undefined) {
          return { kind: "no-change", code: "DIVIDEND_EVENT_NOT_FOUND" };
        }
        const result: DividendCommandResult = {
          kind: "success",
          removedEventId: current.eventId,
        };
        const removed: DividendIntegrationEvent = {
          eventType: "DividendEventRemoved.v1",
          aggregateId: current.eventId,
          reason: "DISCLOSURE_CANCELLED",
        };
        dependencies.repository.commit({
          state: {
            events: state.events.filter(
              ({ eventId }) => eventId !== current.eventId,
            ),
            receipts: { ...state.receipts, [command.idempotencyKey]: result },
          },
          integrationEvents: [removed],
        });
        return result;
      }

      const next: StoredDividendEvent =
        current === undefined
          ? {
              eventId: createDividendEventId(
                command.disclosure.sourceDisclosureId,
              ),
              householdId: command.householdId,
              sourceDisclosureId: command.disclosure.sourceDisclosureId,
              disclosureAliases: [command.disclosure.sourceDisclosureId],
              instrumentCode: command.disclosure.instrumentCode,
              recordDate: command.disclosure.recordDate,
              paymentDate: command.disclosure.paymentDate,
              perShareAmount: command.disclosure.perShareAmount,
              status: "announced",
              aggregateVersion: 1,
            }
          : {
              ...current,
              disclosureAliases: [
                ...new Set([
                  ...current.disclosureAliases,
                  command.disclosure.sourceDisclosureId,
                ]),
              ],
              instrumentCode: command.disclosure.instrumentCode,
              recordDate: command.disclosure.recordDate,
              paymentDate: command.disclosure.paymentDate,
              perShareAmount: command.disclosure.perShareAmount,
              totalAmount:
                current.eligibleQuantity === undefined
                  ? undefined
                  : Math.round(
                      current.eligibleQuantity *
                        command.disclosure.perShareAmount,
                    ),
              aggregateVersion: current.aggregateVersion + 1,
            };
      const result: DividendCommandResult = {
        kind: "success",
        event: view(next),
      };
      dependencies.repository.commit({
        state: {
          events:
            current === undefined
              ? [...state.events, next]
              : state.events.map((event) =>
                  event.eventId === current.eventId ? next : event,
                ),
          receipts: { ...state.receipts, [command.idempotencyKey]: result },
        },
        integrationEvents: [changed(next)],
      });
      return result;
    },

    async advanceStatus(command) {
      const state = dependencies.repository.state();
      const replay = state.receipts[command.idempotencyKey];
      if (replay !== undefined) return replay;
      const current = state.events.find(
        (event) =>
          event.householdId === command.householdId &&
          event.eventId === command.eventId,
      );
      if (current === undefined) {
        return { kind: "no-data", code: "DIVIDEND_EVENT_NOT_FOUND" };
      }
      if (current.status === "paid") {
        return {
          kind: "already-processed",
          code: "PAID_DIVIDEND_IMMUTABLE",
          eventId: current.eventId,
        };
      }
      if (current.status === "announced" && command.asOfDate < current.recordDate) {
        return { kind: "no-change", code: "RECORD_DATE_NOT_REACHED" };
      }

      let next = current;
      const integrationEvents: DividendIntegrationEvent[] = [];
      if (current.status === "announced") {
        const contributions = selectDividendEligibility({
          instrumentCode: current.instrumentCode,
          recordDate: current.recordDate,
          snapshots: dependencies.snapshotReader.snapshots(),
        });
        if (contributions.length === 0) {
          return { kind: "no-data", code: "POSITION_SNAPSHOT_NOT_FOUND" };
        }
        const eligibleQuantity = contributions.reduce(
          (total, contribution) => total + contribution.quantity,
          0,
        );
        next = {
          ...current,
          status: "fixed",
          eligibleQuantity,
          totalAmount: Math.round(current.perShareAmount * eligibleQuantity),
          eligibilityContributions: contributions,
          aggregateVersion: current.aggregateVersion + 1,
        };
        integrationEvents.push(changed(next));
      }
      if (command.asOfDate >= next.paymentDate) {
        next = {
          ...next,
          status: "paid",
          paidAt: `${command.asOfDate}T00:00:00+09:00`,
          aggregateVersion: next.aggregateVersion + 1,
        };
        integrationEvents.push(changed(next));
      }
      const result: DividendCommandResult = {
        kind: "success",
        event: view(next),
      };
      dependencies.repository.commit({
        state: {
          events: state.events.map((event) =>
            event.eventId === next.eventId ? next : event,
          ),
          receipts: { ...state.receipts, [command.idempotencyKey]: result },
        },
        integrationEvents,
      });
      return result;
    },

    async observeDisclosureNoData(_sourceDisclosureId) {
      return { kind: "no-change", code: "NO_DISCLOSURES" };
    },

    async queryEvents(householdId, year) {
      return dependencies.repository
        .state()
        .events.filter(
          (event) =>
            event.householdId === householdId &&
            Number(event.paymentDate.slice(0, 4)) === year,
        )
        .sort(
          (left, right) =>
            left.paymentDate.localeCompare(right.paymentDate) ||
            left.eventId.localeCompare(right.eventId),
        )
        .map(view);
    },

    async rebuildAnnual(householdId, year) {
      const events = dependencies.repository
        .state()
        .events.filter(
          (event) =>
            event.householdId === householdId &&
            Number(event.paymentDate.slice(0, 4)) === year &&
            (event.status === "fixed" || event.status === "paid"),
        );
      const views = events.map(view);
      return {
        monthlyAmounts: calculateAnnualDividendAmounts(views),
        events: Object.fromEntries(views.map((event) => [event.eventId, event])),
      };
    },
    recordedIntegrationEvents: () =>
      dependencies.repository.integrationEvents(),
  };
}
