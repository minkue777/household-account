import { parseCityGasBill } from "../domain/policies/parseCityGasBill";
import { buildNotificationEnvelope } from "../domain/policies/buildNotificationEnvelope";
import {
  ANDROID_PAYMENT_SOURCE_REGISTRY,
  type AndroidPaymentSourceRegistryEntry,
} from "../domain/model/defaultPaymentSourceRegistry";
import type { AndroidProviderParserInputPort } from "./ports/in/androidProviderParserInputPort";
import type {
  AndroidRawNotificationInput,
  AndroidRawNotificationSubmissionInputPort,
  SubmitAndroidRawNotificationCommand,
} from "./ports/in/androidRawNotificationSubmissionInputPort";
import type {
  CaptureEnvelopeInput,
  CapturePaymentObservation,
  CaptureSubmissionInputPort,
  CaptureSubmissionOutcome,
} from "./ports/in/captureSubmissionInputPort";
import type { AndroidRawNotificationHashPort } from "./ports/out/androidRawNotificationHashPort";
import type { CaptureConfigurationPrefetchPort } from "./ports/out/captureConfigurationQueryPort";

export interface AndroidRawNotificationSubmissionDependencies {
  readonly parser: AndroidProviderParserInputPort;
  readonly submissions: CaptureSubmissionInputPort;
  readonly payloads: AndroidRawNotificationHashPort;
  readonly clock: { readonly now: () => string };
  readonly registry?: readonly AndroidPaymentSourceRegistryEntry[];
  readonly configurationPrefetch?: CaptureConfigurationPrefetchPort;
}

function terminalIgnored(observationId: string): CaptureSubmissionOutcome {
  return {
    kind: "success",
    value: { observationId, completion: "terminal" },
  };
}

function sourceFor(
  packageName: string,
  registry: readonly AndroidPaymentSourceRegistryEntry[],
): AndroidPaymentSourceRegistryEntry | undefined {
  const matches = registry.filter(
    (candidate) =>
      candidate.packageName === packageName &&
      candidate.sourceState === "active" &&
      candidate.parserState === "active",
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function seoulParts(instant: string): {
  readonly localDate: string;
  readonly localTime: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    localDate: `${value("year")}-${value("month")}-${value("day")}`,
    localTime: `${value("hour")}:${value("minute")}`,
  };
}

function branchId(observationId: string, branch: "payment" | "balance"): string {
  return `branch.${observationId.replace(/^observation\./u, "")}.${branch}`;
}

function currencyType(
  value: string | undefined,
): "gyeonggi" | "daejeon" | "sejong" | undefined {
  return value === "gyeonggi" || value === "daejeon" || value === "sejong"
    ? value
    : undefined;
}

function cityGasPayment(
  input: AndroidRawNotificationInput,
): CapturePaymentObservation | undefined {
  const envelope = buildNotificationEnvelope({
    packageName: input.packageName,
    postedAt: input.notification.postedAt,
    title: input.notification.title,
    text: input.notification.text,
    bigText: input.notification.bigText,
    textLines: input.notification.textLines,
  });
  if (envelope.kind === "Ignored") return undefined;
  const result = parseCityGasBill({
    observedAtSeoul: input.notification.postedAt,
    title: input.notification.title,
    body: envelope.envelope.selectedBody,
  });
  if (result.kind !== "Parsed" || result.amountInWon <= 0) return undefined;
  const received = seoulParts(input.notification.postedAt);
  return {
    branchId: branchId(input.observationId, "payment"),
    observationType: "approval",
    amountInWon: result.amountInWon,
    occurredLocalDate: result.accountingDate,
    occurredLocalTime: received.localTime,
    zoneId: "Asia/Seoul",
    merchantEvidence: {
      rawCandidate: `${Number(result.billingMonth.slice(5))}월 도시가스요금`,
    },
    dueDate: result.accountingDate,
  };
}

function parsedEnvelope(
  input: AndroidRawNotificationInput,
  source: AndroidPaymentSourceRegistryEntry,
  parser: AndroidProviderParserInputPort,
  payloads: AndroidRawNotificationHashPort,
  clockNow: string,
): CaptureEnvelopeInput | undefined {
  if (source.cityGas) {
    const paymentObservation = cityGasPayment(input);
    if (paymentObservation === undefined) return undefined;
    return {
      contractVersion: "capture-envelope.v1",
      observationId: input.observationId,
      originChannel: "android-notification",
      sourceEvidence: {
        kind: "android-registered-package",
        sourceType: source.sourceType,
        packageName: source.packageName,
        registryVersion: source.registryVersion,
      },
      observedAt: input.notification.postedAt,
      parser: {
        parserId: source.parserId,
        parserVersion: source.parserVersion,
      },
      rawPayloadHash: payloads.hash(input),
      paymentObservation,
    };
  }

  const result = parser.parse({
    source: { packageName: source.packageName, parserId: source.parserId },
    notification: input.notification,
    clockNow,
  });
  if (result.kind !== "Parsed") return undefined;

  const parsedCurrency = currencyType(result.payment?.localCurrencyType);
  const balanceCurrency = currencyType(result.balance?.localCurrencyType);
  if (
    (result.payment?.localCurrencyType !== undefined &&
      parsedCurrency !== source.localCurrencyType) ||
    (result.balance?.localCurrencyType !== undefined &&
      balanceCurrency !== source.localCurrencyType)
  ) {
    return undefined;
  }

  const payment = result.payment;
  const paymentObservation =
    payment === undefined ||
    payment.amountInWon <= 0 ||
    payment.merchant.trim() === "" ||
    payment.cardCompany.trim() === ""
      ? undefined
      : {
          branchId: branchId(input.observationId, "payment"),
          observationType: payment.type,
          amountInWon: payment.amountInWon,
          occurredLocalDate: payment.occurredLocalDate,
          occurredLocalTime: payment.occurredLocalTime,
          zoneId: "Asia/Seoul" as const,
          merchantEvidence: { rawCandidate: payment.merchant.trim() },
          cardEvidence: {
            companyLabel: payment.cardCompany.trim(),
            ...(payment.maskedCardToken === undefined ||
            payment.maskedCardToken.trim() === ""
              ? {}
              : { maskedToken: payment.maskedCardToken.trim() }),
          },
          ...(parsedCurrency === undefined
            ? {}
            : { localCurrencyType: parsedCurrency }),
        };
  const balanceObservation =
    result.balance === undefined || balanceCurrency === undefined
      ? undefined
      : {
          branchId: branchId(input.observationId, "balance"),
          currencyType: balanceCurrency,
          balanceInWon: result.balance.amountInWon,
          observedAt: input.notification.postedAt,
        };
  if (paymentObservation === undefined && balanceObservation === undefined) {
    return undefined;
  }

  return {
    contractVersion: "capture-envelope.v1",
    observationId: input.observationId,
    originChannel: "android-notification",
    sourceEvidence: {
      kind: "android-registered-package",
      sourceType: source.sourceType,
      packageName: source.packageName,
      registryVersion: source.registryVersion,
    },
    observedAt: input.notification.postedAt,
    parser: {
      parserId: source.parserId,
      parserVersion: source.parserVersion,
    },
    rawPayloadHash: payloads.hash(input),
    ...(paymentObservation === undefined ? {} : { paymentObservation }),
    ...(balanceObservation === undefined ? {} : { balanceObservation }),
  };
}

class DefaultAndroidRawNotificationSubmissionApplication
  implements AndroidRawNotificationSubmissionInputPort
{
  private readonly registry: readonly AndroidPaymentSourceRegistryEntry[];

  constructor(
    private readonly dependencies: AndroidRawNotificationSubmissionDependencies,
  ) {
    this.registry =
      dependencies.registry ?? ANDROID_PAYMENT_SOURCE_REGISTRY;
  }

  async submit(
    command: SubmitAndroidRawNotificationCommand,
  ): Promise<CaptureSubmissionOutcome> {
    const source = sourceFor(command.input.packageName, this.registry);
    if (source === undefined) {
      return terminalIgnored(command.input.observationId);
    }
    const envelope = parsedEnvelope(
      command.input,
      source,
      this.dependencies.parser,
      this.dependencies.payloads,
      this.dependencies.clock.now(),
    );
    if (envelope === undefined) {
      return terminalIgnored(command.input.observationId);
    }
    if (
      envelope.paymentObservation !== undefined &&
      command.actor.householdId !== undefined &&
      command.actor.actingMemberId !== undefined
    ) {
      this.dependencies.configurationPrefetch?.prefetch({
        householdId: command.actor.householdId,
        actingMemberId: command.actor.actingMemberId,
      });
    }
    return this.dependencies.submissions.submit({
      actor: command.actor,
      rootIdempotencyKey: command.input.observationId,
      envelope,
    });
  }
}

export function createAndroidRawNotificationSubmissionApplication(
  dependencies: AndroidRawNotificationSubmissionDependencies,
): AndroidRawNotificationSubmissionInputPort {
  return new DefaultAndroidRawNotificationSubmissionApplication(dependencies);
}
