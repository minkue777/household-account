import { createHash } from "node:crypto";

import type { AndroidRawNotificationInput } from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/in/androidRawNotificationSubmissionInputPort";
import type { AndroidRawNotificationHashPort } from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/out/androidRawNotificationHashPort";

export class Sha256AndroidRawNotificationHasher
  implements AndroidRawNotificationHashPort
{
  hash(input: AndroidRawNotificationInput): string {
    return `sha256:${createHash("sha256")
      .update(JSON.stringify(input), "utf8")
      .digest("hex")}`;
  }
}
