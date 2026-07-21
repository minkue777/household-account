import type {
  AndroidLogRecordResult,
  AndroidLogRedactionInputPort,
  AndroidLogRedactionState,
  AndroidLogSink,
  RedactedAndroidLogEntry,
  SensitiveAndroidFlowInput,
} from "./ports/in/androidLogRedactionInputPort";
import type { AndroidCorrelationHashPort } from "./ports/out/androidLogRedactionPorts";

const LOG_SINKS = [
  "logcat",
  "crash-breadcrumb",
  "analytics",
] as const satisfies readonly AndroidLogSink[];

const STABLE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function safeErrorCode(value: string): string {
  return STABLE_ERROR_CODE.test(value) ? value : "UNSAFE_ERROR_CODE";
}

function copyEntry(entry: RedactedAndroidLogEntry): RedactedAndroidLogEntry {
  return { ...entry };
}

class DefaultAndroidLogRedactionApplication
  implements AndroidLogRedactionInputPort
{
  private entries: RedactedAndroidLogEntry[] = [];

  constructor(private readonly hash: AndroidCorrelationHashPort) {}

  recordAcrossSinks(input: SensitiveAndroidFlowInput): AndroidLogRecordResult {
    const errorCode = safeErrorCode(input.errorCode);
    const correlationHash =
      input.householdId.length === 0
        ? undefined
        : this.hash.hashForPurpose(
            "android-log-correlation",
            input.householdId,
          );
    const recorded = LOG_SINKS.map((sink): RedactedAndroidLogEntry => {
      const safePayload = {
        operation: input.operation,
        outcome: input.outcome,
        errorCode,
        ...(correlationHash === undefined ? {} : { correlationHash }),
      };
      return {
        sink,
        ...safePayload,
        renderedMessage: JSON.stringify(safePayload),
      };
    });
    this.entries = [...this.entries, ...recorded.map(copyEntry)];
    return { kind: "Recorded", entries: recorded.map(copyEntry) };
  }

  state(): AndroidLogRedactionState {
    return { entries: this.entries.map(copyEntry) };
  }
}

export function createAndroidLogRedactionApplication(dependencies: {
  readonly hash: AndroidCorrelationHashPort;
}): AndroidLogRedactionInputPort {
  return new DefaultAndroidLogRedactionApplication(dependencies.hash);
}
