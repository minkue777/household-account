import type { CaptureApprovalActor } from "./captureAuthorizationInputPort";
import type {
  CaptureSubmissionOutcome,
} from "./captureSubmissionInputPort";

export interface AndroidRawNotificationInput {
  readonly contractVersion: "android-raw-notification.v1";
  readonly observationId: string;
  readonly packageName: string;
  readonly notification: {
    readonly postedAt: string;
    readonly title?: string;
    readonly text?: string;
    readonly bigText?: string;
    readonly textLines?: readonly string[];
  };
}

export interface SubmitAndroidRawNotificationCommand {
  readonly actor: CaptureApprovalActor;
  readonly input: AndroidRawNotificationInput;
}

export interface AndroidRawNotificationSubmissionInputPort {
  submit(
    command: SubmitAndroidRawNotificationCommand,
  ): Promise<CaptureSubmissionOutcome>;
}
