import type {
  SmsCaptureResult,
  SmsNotificationEnvelope,
} from "../../../domain/model/androidSmsCapture";

export interface AndroidSmsCandidateInputPort {
  capture(input: SmsNotificationEnvelope): SmsCaptureResult;
}
