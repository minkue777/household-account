export interface AndroidRawNotification {
  readonly postedAt?: string;
  readonly title?: string;
  readonly text?: string;
  readonly bigText?: string;
  readonly textLines?: readonly string[];
}

export interface AndroidProviderSource {
  readonly packageName: string;
  readonly parserId: string;
}

export interface ParsedPaymentGolden {
  readonly type: "approval" | "cancellation";
  readonly amountInWon: number;
  /** 캐시백 차감 전 원승인 총액. 원장 금액과 별도로 취소 대조에 사용합니다. */
  readonly approvalAmountInWon?: number;
  readonly occurredLocalDate: string;
  readonly occurredLocalTime: string;
  readonly merchant: string;
  readonly cardCompany: string;
  readonly maskedCardToken?: string;
  readonly installmentMonths?: number;
  readonly localCurrencyType?: string;
  readonly timeSource?: "postedAt" | "clock";
}

export type AndroidProviderParseResult =
  | {
      readonly kind: "Parsed";
      readonly payment?: ParsedPaymentGolden;
      readonly balance?: {
        readonly amountInWon: number;
        readonly localCurrencyType: string;
      };
    }
  | {
      readonly kind: "Ignored" | "Rejected";
      readonly code: string;
    };

export interface ParseAndroidProviderNotificationInput {
  readonly source: AndroidProviderSource;
  readonly notification: AndroidRawNotification;
  readonly clockNow: string;
}
