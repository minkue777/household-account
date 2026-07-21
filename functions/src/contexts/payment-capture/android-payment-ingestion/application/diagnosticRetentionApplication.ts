import type {
  DiagnosticActor,
  DiagnosticCollectionResult,
  DiagnosticReadResult,
  DiagnosticRetentionInputPort,
} from "./ports/in/diagnosticRetentionInputPort";
import type { DiagnosticDocumentStore } from "./ports/out/diagnosticDocumentStore";

function actorIsAuthenticated(actor: DiagnosticActor | undefined): actor is DiagnosticActor {
  return (
    actor !== undefined &&
    actor.householdId.trim() !== "" &&
    actor.memberId.trim() !== ""
  );
}

class DefaultDiagnosticRetentionApplication
  implements DiagnosticRetentionInputPort
{
  constructor(private readonly store: DiagnosticDocumentStore) {}

  async collect(
    input: Parameters<DiagnosticRetentionInputPort["collect"]>[0],
  ): Promise<DiagnosticCollectionResult> {
    if (!actorIsAuthenticated(input.actor)) {
      return {
        kind: "Skipped",
        reason: "ACTOR_REQUIRED",
        businessOutcome: input.businessOutcome,
      };
    }
    if (!input.sourceRegistered) {
      return {
        kind: "Skipped",
        reason: "SOURCE_NOT_REGISTERED",
        businessOutcome: input.businessOutcome,
      };
    }

    let write: Awaited<ReturnType<DiagnosticDocumentStore["write"]>>;
    try {
      write = await this.store.write({
        actor: {
          householdId: input.actor.householdId,
          memberId: input.actor.memberId,
        },
        notification: {
          packageName: input.notification.packageName,
          sourceType: input.notification.sourceType,
          title: input.notification.title,
          text: input.notification.text,
          bigText: input.notification.bigText,
          textLines: [...input.notification.textLines],
          fullText: input.notification.fullText,
          postedAtMillis: input.notification.postedAtMillis,
          collectedAt: input.notification.collectedAt,
        },
      });
    } catch {
      write = { kind: "Failed" };
    }
    return write.kind === "Written"
      ? {
          kind: "Collected",
          diagnosticId: write.diagnosticId,
          businessOutcome: input.businessOutcome,
        }
      : {
          kind: "BestEffortFailure",
          code: "DIAGNOSTIC_WRITE_FAILED",
          businessOutcome: input.businessOutcome,
        };
  }

  async readAll(actor: DiagnosticActor): Promise<DiagnosticReadResult> {
    if (actor.role !== "administrator" && actor.role !== "diagnostic-reader") {
      return { kind: "Forbidden" };
    }
    return {
      kind: "Allowed",
      documents: await this.store.readAll(),
    };
  }
}

export function createDiagnosticRetentionApplication(
  store: DiagnosticDocumentStore,
): DiagnosticRetentionInputPort {
  return new DefaultDiagnosticRetentionApplication(store);
}
