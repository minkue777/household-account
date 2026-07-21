export type ShortcutCardMessageParseResult =
  | {
      readonly kind: "Parsed";
      readonly amountInWon: number;
      readonly occurredLocalDate: string;
      readonly occurredLocalTime: string;
      readonly merchant: string;
      readonly cardEvidence: {
        readonly companyLabel: string;
        readonly maskedToken?: string;
      };
    }
  | {
      readonly kind: "Rejected";
      readonly code:
        | "CARD_COMPANY_REQUIRED"
        | "UNSUPPORTED_CARD_COMPANY"
        | "AMOUNT_NOT_POSITIVE"
        | "AMOUNT_NOT_FINITE"
        | "AMOUNT_OUT_OF_RANGE"
        | "INVALID_DATE"
        | "INVALID_TIME"
        | "UNSUPPORTED_MESSAGE";
    };

export interface ParseShortcutCardMessageInput {
  readonly message: string;
  readonly receivedAt: string;
  readonly zoneId: "Asia/Seoul";
}
