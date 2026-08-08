import { parseLocalDate } from "../value-objects/localDate";

export const KAKAO_TALK_FINANCIAL_SOURCE = Object.freeze({
  packageName: "com.kakao.talk",
  sourceType: "kakao-talk-financial-message",
  parserId: "kakao-talk-financial-message-parser",
  parserVersion: "1.0.0",
});

export const PAYMENT_KIND_EVIDENCE_MISMATCH =
  "PAYMENT_KIND_EVIDENCE_MISMATCH" as const;

interface CardEvidence {
  readonly companyLabel: string;
  readonly maskedToken?: string;
}

export interface CityGasBillShapeCandidate {
  readonly observationType?: "approval" | "cancellation";
  readonly amountInWon?: number;
  readonly occurredLocalDate?: string;
  readonly merchant?: string;
  readonly cardEvidence?: CardEvidence;
  readonly localCurrencyType?: string;
  readonly dueDate?: string;
  readonly hasBalance?: boolean;
}

const CITY_GAS_MERCHANT = /^(?:[1-9]|1[0-2])월 도시가스요금$/u;

export function isCityGasBillShape(
  input: CityGasBillShapeCandidate,
): boolean {
  return (
    input.observationType === "approval" &&
    input.amountInWon !== undefined &&
    Number.isSafeInteger(input.amountInWon) &&
    input.amountInWon > 0 &&
    input.cardEvidence === undefined &&
    input.localCurrencyType === undefined &&
    input.hasBalance !== true &&
    input.dueDate !== undefined &&
    parseLocalDate(input.dueDate) !== undefined &&
    input.occurredLocalDate === input.dueDate &&
    input.merchant !== undefined &&
    CITY_GAS_MERCHANT.test(input.merchant)
  );
}

export interface ExplicitPaymentKindCandidate
  extends CityGasBillShapeCandidate {
  readonly paymentKind?: "card" | "bill";
  readonly packageName?: string;
  readonly sourceType: string;
  readonly parserId: string;
  readonly parserVersion: string;
}

export type ExplicitPaymentKindValidation =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "rejected";
      readonly code: typeof PAYMENT_KIND_EVIDENCE_MISMATCH;
    };

function isKakaoCompositeSource(input: ExplicitPaymentKindCandidate): boolean {
  return (
    (input.packageName === undefined ||
      input.packageName === KAKAO_TALK_FINANCIAL_SOURCE.packageName) &&
    input.sourceType === KAKAO_TALK_FINANCIAL_SOURCE.sourceType &&
    input.parserId === KAKAO_TALK_FINANCIAL_SOURCE.parserId &&
    input.parserVersion === KAKAO_TALK_FINANCIAL_SOURCE.parserVersion
  );
}

export function validateExplicitPaymentKind(
  input: ExplicitPaymentKindCandidate,
): ExplicitPaymentKindValidation {
  if (input.paymentKind === undefined) return { kind: "allowed" };
  if (!isKakaoCompositeSource(input)) {
    return { kind: "rejected", code: PAYMENT_KIND_EVIDENCE_MISMATCH };
  }
  if (input.paymentKind === "card") {
    return input.cardEvidence === undefined
      ? { kind: "rejected", code: PAYMENT_KIND_EVIDENCE_MISMATCH }
      : { kind: "allowed" };
  }
  return isCityGasBillShape(input)
    ? { kind: "allowed" }
    : { kind: "rejected", code: PAYMENT_KIND_EVIDENCE_MISMATCH };
}
