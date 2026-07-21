import type * as firestore from "firebase-admin/firestore";

import { FirebaseDividendEventRuntimeRepository } from "../../adapters/firebase/dividends/firebaseDividendEventRuntimeRepository";
import { FirebaseDividendProviderObservation } from "../../adapters/firebase/dividends/firebaseDividendProviderObservation";
import { FirebaseDividendHoldingQuery } from "../../adapters/firebase/portfolio/firebaseDividendHoldingQuery";
import { KindEtfDividendDisclosureSource } from "../../adapters/http/kindEtfDividendDisclosureSource";
import { NodeExternalTextHttpTransport } from "../../adapters/http/nodeExternalTextHttpTransport";
import { createDividendScheduledRuntimeApplication } from "../../contexts/portfolio/dividends/application/dividendScheduledRuntimeApplication";
import { createSafeExternalTextHttpApplication } from "../../platform/external-operations/application/safeExternalTextHttpApplication";
import type {
  ScheduledFeaturePagePort,
  ScheduledTargetOutcome,
} from "../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";

const DISCOVERY = "dividend:discovery";
const SWEEP = "dividend:sweep";
const COMPLETE = "dividend:complete";

function checkpoint(phase: typeof DISCOVERY | typeof SWEEP, cursor?: string): string {
  return cursor === undefined
    ? phase
    : `${phase}:${Buffer.from(cursor, "utf8").toString("base64url")}`;
}

function parseCheckpoint(value: string | undefined): {
  readonly phase: typeof DISCOVERY | typeof SWEEP;
  readonly cursor?: string;
} {
  if (value === undefined || value === DISCOVERY) return { phase: DISCOVERY };
  if (value === SWEEP) return { phase: SWEEP };
  for (const phase of [DISCOVERY, SWEEP] as const) {
    const prefix = `${phase}:`;
    if (value.startsWith(prefix)) {
      return {
        phase,
        cursor: Buffer.from(value.slice(prefix.length), "base64url").toString("utf8"),
      };
    }
  }
  throw new Error("DIVIDEND_CHECKPOINT_INVALID");
}

function outcome(input: {
  readonly targetId: string;
  readonly kind: "succeeded" | "skipped" | "failed";
  readonly receipt?: string;
  readonly code?: string;
  readonly retryable?: boolean;
}): ScheduledTargetOutcome {
  if (input.kind === "succeeded") {
    return {
      targetId: input.targetId,
      outcome: { kind: "SUCCEEDED", receipt: input.receipt ?? "COMMITTED" },
    };
  }
  if (input.kind === "skipped") {
    return {
      targetId: input.targetId,
      outcome: { kind: "SKIPPED", receipt: input.receipt ?? "NO_CHANGE" },
    };
  }
  return {
    targetId: input.targetId,
    outcome: {
      kind: "FAILED",
      code: input.code ?? "DIVIDEND_TARGET_FAILED",
      retryable: input.retryable ?? true,
    },
  };
}

export function createDividendScheduledPages(input: {
  readonly database: firestore.Firestore;
  readonly executionKey: string;
  readonly asOfDate: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly observedAt: string;
  readonly pageSize: number;
}): ScheduledFeaturePagePort {
  const events = new FirebaseDividendEventRuntimeRepository(input.database);
  const application = createDividendScheduledRuntimeApplication({
    holdings: new FirebaseDividendHoldingQuery(input.database),
    disclosures: new KindEtfDividendDisclosureSource(
      createSafeExternalTextHttpApplication({
        policy: {
          providers: [
            {
              provider: "KIND",
              allowedHosts: ["kind.krx.co.kr"],
              allowedPorts: [443],
              maxRedirectHops: 3,
            },
          ],
          timeoutMs: 10_000,
          maxAttempts: 3,
          maxResponseBytes: 2 * 1024 * 1024,
        },
        transport: new NodeExternalTextHttpTransport(),
      }),
    ),
    events,
    providerObservations: new FirebaseDividendProviderObservation(input.database),
  });

  return {
    async nextPage(rawCheckpoint) {
      if (rawCheckpoint === COMPLETE) return undefined;
      const current = parseCheckpoint(rawCheckpoint);
      if (current.phase === DISCOVERY) {
        const result = await application.runDiscoveryPage({
          ...(current.cursor === undefined ? {} : { cursor: current.cursor }),
          limit: input.pageSize,
          concurrency: 5,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          executionKey: input.executionKey,
          observedAt: input.observedAt,
        });
        return {
          ...(rawCheckpoint === undefined ? {} : { checkpointBefore: rawCheckpoint }),
          checkpointAfter:
            result.nextCursor === undefined
              ? SWEEP
              : checkpoint(DISCOVERY, result.nextCursor),
          targets: result.items.map(outcome),
        };
      }

      const result = await application.runLifecyclePage({
        ...(current.cursor === undefined ? {} : { cursor: current.cursor }),
        limit: input.pageSize,
        executionKey: input.executionKey,
        asOfDate: input.asOfDate,
        observedAt: input.observedAt,
      });
      if (result.nextCursor !== undefined) {
        return {
          checkpointBefore: rawCheckpoint,
          checkpointAfter: checkpoint(SWEEP, result.nextCursor),
          targets: result.items.map(outcome),
        };
      }
      try {
        const projection = await events.rebuildAllAnnualProjections({
          sourceCheckpoint: input.executionKey,
          observedAt: input.observedAt,
        });
        return {
          checkpointBefore: rawCheckpoint,
          checkpointAfter: COMPLETE,
          terminal: true,
          targets: [
            ...result.items.map(outcome),
            {
              targetId: "dividend:annual-projections",
              outcome: {
                kind: "SUCCEEDED" as const,
                receipt: `replaced:${projection.projectionCount}`,
              },
            },
          ],
        };
      } catch {
        return {
          checkpointBefore: rawCheckpoint,
          checkpointAfter: COMPLETE,
          terminal: true,
          targets: [
            ...result.items.map(outcome),
            {
              targetId: "dividend:annual-projections",
              outcome: {
                kind: "FAILED" as const,
                code: "DIVIDEND_PROJECTION_REBUILD_FAILED",
                retryable: true,
              },
            },
          ],
        };
      }
    },
  };
}
