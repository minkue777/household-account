import {
  createAndroidProviderParser,
  createAndroidRawNotificationSubmissionApplication,
  type AndroidRawNotificationInput,
  type CaptureApprovalActor,
  type CaptureSubmissionCommand,
  type CaptureSubmissionOutcome,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  AndroidRawNotificationInput,
  CaptureSubmissionCommand,
  CaptureSubmissionOutcome,
};

export interface AndroidRawNotificationSubmissionState {
  readonly captured: readonly CaptureSubmissionCommand[];
}

export interface AndroidRawNotificationSubmissionDriver {
  submit(input: {
    readonly actor: CaptureApprovalActor;
    readonly input: AndroidRawNotificationInput;
  }): Promise<CaptureSubmissionOutcome>;
  state(): AndroidRawNotificationSubmissionState;
}

export function createAndroidRawNotificationSubmissionDriver(): AndroidRawNotificationSubmissionDriver {
  const captured: CaptureSubmissionCommand[] = [];
  const application = createAndroidRawNotificationSubmissionApplication({
    parser: createAndroidProviderParser(),
    submissions: {
      submit: async (command) => {
        captured.push(command);
        return {
          kind: "success",
          value: {
            observationId: command.envelope.observationId,
            transactionResult: {
              kind: "created",
              transactionId: "transaction-1",
              editable: true,
              captureLineageId: "lineage-1",
              aggregateVersion: 1,
              quickEditSnapshot: {
                transactionId: "transaction-1",
                merchant: "가맹점",
                amountInWon: 20_300,
                accountingDate: "2026-07-31",
                localTime: "17:40",
                categoryId: "etc",
                memo: "",
                aggregateVersion: 1,
              },
            },
            completion: "terminal",
          },
        };
      },
    },
    payloads: { hash: () => `sha256:${"a".repeat(64)}` },
    clock: { now: () => "2026-07-31T17:42:00+09:00" },
  });
  return {
    submit: (input) => application.submit(input),
    state: () => ({ captured: [...captured] }),
  };
}
