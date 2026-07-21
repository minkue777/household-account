import { createAndroidCaptureFollowUpApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/androidCaptureFollowUpApplication";
import type {
  AndroidCaptureCompletionPort,
  AndroidQuickEditPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/androidCaptureFollowUpEffects";

export type {
  AndroidCaptureFollowUpInputPort,
  AndroidCaptureFollowUpResult,
  AndroidTransactionBranchResult,
  FinalizeAndroidCaptureInput,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface AndroidCaptureFollowUpState {
  readonly quickEditTransactionIds: readonly string[];
  readonly completionBroadcastTransactionIds: readonly string[];
  readonly automaticPushIntents: readonly string[];
}

export interface AndroidCaptureFollowUpDriver
  extends ReturnType<typeof createAndroidCaptureFollowUpApplication> {
  state(): AndroidCaptureFollowUpState;
}

class CaptureFollowUpEffectFixture
  implements AndroidQuickEditPort, AndroidCaptureCompletionPort
{
  private readonly quickEditIds: string[] = [];
  private readonly completionIds: string[] = [];

  open(transactionId: string): void {
    this.quickEditIds.push(transactionId);
  }

  broadcast(transactionId: string): void {
    this.completionIds.push(transactionId);
  }

  state(): AndroidCaptureFollowUpState {
    return {
      quickEditTransactionIds: [...this.quickEditIds],
      completionBroadcastTransactionIds: [...this.completionIds],
      automaticPushIntents: [],
    };
  }
}

export function createAndroidCaptureFollowUpDriver(): AndroidCaptureFollowUpDriver {
  const effects = new CaptureFollowUpEffectFixture();
  const application = createAndroidCaptureFollowUpApplication({
    quickEdit: effects,
    completion: effects,
  });

  return {
    finalize: (input) => application.finalize(input),
    state: () => effects.state(),
  };
}
