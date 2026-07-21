import { createDiagnosticRetentionApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/diagnosticRetentionApplication";
import type {
  DiagnosticActor,
  DiagnosticBusinessOutcome,
  DiagnosticCollectionResult,
  DiagnosticDocument,
  DiagnosticNotification,
  DiagnosticReadResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/diagnosticRetentionInputPort";
import type { DiagnosticDocumentStore } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/diagnosticDocumentStore";

export interface DiagnosticRetentionDriver {
  collect(input: {
    readonly actor?: DiagnosticActor;
    readonly sourceRegistered: boolean;
    readonly notification: DiagnosticNotification;
    readonly businessOutcome: DiagnosticBusinessOutcome;
    readonly storageOutcome?: "success" | "failure";
    readonly unrelatedSecrets?: {
      readonly authToken: string;
      readonly fcmFid: string;
      readonly householdAccessKey: string;
    };
  }): Promise<DiagnosticCollectionResult>;
  readAll(actor: DiagnosticActor): Promise<DiagnosticReadResult>;
  state(at: string): Promise<{ readonly documents: readonly DiagnosticDocument[] }>;
}

function cloneDocument(document: DiagnosticDocument): DiagnosticDocument {
  return {
    ...document,
    textLines: [...document.textLines],
  };
}

class InMemoryDiagnosticDocumentStore implements DiagnosticDocumentStore {
  private readonly documents: DiagnosticDocument[] = [];
  private nextId = 1;
  private failNextWrite = false;

  failOnce(): void {
    this.failNextWrite = true;
  }

  async write(input: {
    readonly actor: { readonly householdId: string; readonly memberId: string };
    readonly notification: DiagnosticNotification;
  }): Promise<
    | { readonly kind: "Written"; readonly diagnosticId: string }
    | { readonly kind: "Failed" }
  > {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("fixture diagnostic store unavailable");
    }
    const diagnosticId = `diagnostic-${this.nextId}`;
    this.nextId += 1;
    this.documents.push({
      diagnosticId,
      householdId: input.actor.householdId,
      memberId: input.actor.memberId,
      packageName: input.notification.packageName,
      sourceType: input.notification.sourceType,
      title: input.notification.title,
      text: input.notification.text,
      bigText: input.notification.bigText,
      textLines: [...input.notification.textLines],
      fullText: input.notification.fullText,
      postedAtMillis: input.notification.postedAtMillis,
      collectedAt: input.notification.collectedAt,
    });
    return { kind: "Written", diagnosticId };
  }

  async readAll(): Promise<readonly DiagnosticDocument[]> {
    return this.documents.map(cloneDocument);
  }
}

export function createDiagnosticRetentionDriver(): DiagnosticRetentionDriver {
  const store = new InMemoryDiagnosticDocumentStore();
  const application = createDiagnosticRetentionApplication(store);
  return {
    collect: ({ storageOutcome, ...input }) => {
      if (storageOutcome === "failure") store.failOnce();
      return application.collect(input);
    },
    readAll: (actor) => application.readAll(actor),
    state: async (at) => {
      void at;
      return { documents: await store.readAll() };
    },
  };
}
