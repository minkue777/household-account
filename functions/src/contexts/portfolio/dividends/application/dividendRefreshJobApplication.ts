import { createDividendEventId } from "../domain/entities/dividendEvent";
import type {
  DividendRefreshJobEvent,
  DividendRefreshJobResult,
} from "../domain/model/dividendRefreshJob";
import { calculateAnnualDividendAmounts } from "../domain/policies/dividendReadPolicies";
import { DIVIDEND_REFRESH_SCHEDULE } from "../domain/policies/dividendRefreshSchedule";
import type { DividendRefreshJob } from "./ports/in/dividendRefreshJob";
import type {
  DividendRefreshDisclosureSource,
  DividendRefreshJobStore,
} from "./ports/out/dividendRefreshJobPorts";

export function createDividendRefreshJobApplication(dependencies: {
  source: DividendRefreshDisclosureSource;
  store: DividendRefreshJobStore;
}): DividendRefreshJob {
  return {
    registeredSchedule: () => ({
      ...DIVIDEND_REFRESH_SCHEDULE,
      dailyHours: [...DIVIDEND_REFRESH_SCHEDULE.dailyHours],
    }),
    async runOccurrence(input) {
      const replay = dependencies.store.receipt(input.runId);
      if (replay !== undefined) return replay;

      const succeededInstrumentCodes: string[] = [];
      const retryableFailed: { instrumentCode: string; code: string }[] = [];
      const disclosures = [];
      const events: DividendRefreshJobEvent[] = [];
      for (const instrumentCode of dependencies.source.instrumentCodes()) {
        const result = await dependencies.source.collect({
          instrumentCode,
          scheduledFor: input.scheduledFor,
        });
        if (result.kind === "retryable-failure") {
          retryableFailed.push({ instrumentCode, code: result.code });
          continue;
        }
        const fresh = result.disclosures.filter(
          ({ sourceDisclosureId }) =>
            !dependencies.store.hasDisclosure(sourceDisclosureId),
        );
        if (fresh.length === 0) continue;
        succeededInstrumentCodes.push(instrumentCode);
        disclosures.push(...fresh);
        events.push(
          ...fresh.map((disclosure) => ({
            eventType: "DividendEventChanged.v1" as const,
            sourceDisclosureId: disclosure.sourceDisclosureId,
            instrumentCode: disclosure.instrumentCode,
          })),
        );
      }
      const result: DividendRefreshJobResult = {
        kind: retryableFailed.length === 0 ? "complete" : "partial-failure",
        runId: input.runId,
        scheduledFor: input.scheduledFor,
        succeededInstrumentCodes,
        retryableFailed,
        lifecycleSweepCompleted: true,
        projectionStatus: "queued",
      };
      dependencies.store.commitOccurrence({
        runId: input.runId,
        result,
        disclosures,
        events,
      });
      return result;
    },
    listDisclosures: () => dependencies.store.disclosures(),
    recordedEvents: () => dependencies.store.events(),
    annualProjection(year) {
      const disclosures = dependencies.store
        .disclosures()
        .filter(
          ({ paymentDate }) => Number(paymentDate.slice(0, 4)) === year,
        );
      return {
        monthlyAmounts: calculateAnnualDividendAmounts(
          disclosures.map((disclosure) => ({
            status: "paid" as const,
            paymentDate: disclosure.paymentDate,
            totalAmount: disclosure.totalAmount,
          })),
        ),
        eventIds: disclosures.map(({ sourceDisclosureId }) =>
          createDividendEventId(sourceDisclosureId),
        ),
      };
    },
  };
}
