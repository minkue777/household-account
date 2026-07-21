import { createAndroidLogRedactionApplication } from "../reference/android-host/application/androidLogRedactionApplication";
import type {
  AndroidLogRedactionInputPort,
  SensitiveAndroidFlowInput,
} from "../reference/android-host/application/ports/in/androidLogRedactionInputPort";
import type { AndroidCorrelationHashPort } from "../reference/android-host/application/ports/out/androidLogRedactionPorts";

export interface LogRedactionFixtureSubject
  extends AndroidLogRedactionInputPort {}
export type { SensitiveAndroidFlowInput };

class PurposeBoundCorrelationHash implements AndroidCorrelationHashPort {
  hashForPurpose(
    purpose: "android-log-correlation",
    value: string,
  ): string {
    return `${purpose}:digest:${value.length}`;
  }
}

export function createLogRedactionFixtureSubject(): LogRedactionFixtureSubject {
  return createAndroidLogRedactionApplication({
    hash: new PurposeBoundCorrelationHash(),
  });
}
