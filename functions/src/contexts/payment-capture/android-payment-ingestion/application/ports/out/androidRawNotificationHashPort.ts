import type { AndroidRawNotificationInput } from "../in/androidRawNotificationSubmissionInputPort";

export interface AndroidRawNotificationHashPort {
  hash(input: AndroidRawNotificationInput): string;
}
