import type {
  AndroidCaptureFollowUpResult,
  FinalizeAndroidCaptureInput,
} from "../../../domain/model/androidCaptureFollowUp";

export interface AndroidCaptureFollowUpInputPort {
  finalize(input: FinalizeAndroidCaptureInput): AndroidCaptureFollowUpResult;
}
