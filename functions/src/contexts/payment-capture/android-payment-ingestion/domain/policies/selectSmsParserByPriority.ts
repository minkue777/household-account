import type {
  SelectSmsParserInput,
  SmsParserId,
  SmsParserOrderResult,
} from "../model/smsParserOrder";

const SMS_INTERNAL_PARSER_PRIORITY = [
  "KB",
  "NH",
  "NaverPay",
  "Toss",
  "KakaoPay",
  "DigitalOnnuri",
  "Paybooc",
  "Samsung",
  "Lotte",
  "Gyeonggi",
  "Daejeon",
  "SmsCardBill",
] as const satisfies readonly SmsParserId[];

export function selectSmsParserByPriority(
  input: SelectSmsParserInput,
): SmsParserOrderResult {
  const successfulParsers = new Set(input.successfulParserIds);
  const parserId = SMS_INTERNAL_PARSER_PRIORITY.find((candidate) =>
    successfulParsers.has(candidate),
  );

  return parserId === undefined
    ? { kind: "Unmatched" }
    : {
        kind: "Selected",
        parserId,
        candidateId: input.candidateId,
      };
}
