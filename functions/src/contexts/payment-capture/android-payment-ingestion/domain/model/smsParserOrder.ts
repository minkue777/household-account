export type SmsParserId =
  | "KB"
  | "NH"
  | "NaverPay"
  | "Toss"
  | "KakaoPay"
  | "DigitalOnnuri"
  | "Paybooc"
  | "Samsung"
  | "Lotte"
  | "Gyeonggi"
  | "Daejeon"
  | "Sejong"
  | "SmsCardBill";

export interface SelectSmsParserInput {
  readonly candidateId: string;
  readonly successfulParserIds: readonly SmsParserId[];
}

export type SmsParserOrderResult =
  | {
      readonly kind: "Selected";
      readonly parserId: SmsParserId;
      readonly candidateId: string;
    }
  | { readonly kind: "Unmatched" };
