import type {
  ParseShortcutCardMessageInput,
  ShortcutCardMessageParseResult,
} from "../model/shortcutCardMessage";

interface OccurrenceYearInput {
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly receivedAt: string;
  readonly zoneId: "Asia/Seoul";
}

type OccurrenceYearResult =
  | { readonly kind: "success"; readonly occurredLocalDateTime: string }
  | {
      readonly kind: "parseFailure";
      readonly code: "INVALID_DATE" | "INVALID_TIME";
    };

export type ShortcutOccurrenceYearResolver = (
  input: OccurrenceYearInput,
) => OccurrenceYearResult;

const SUPPORTED_COMPANIES = new Map<string, string>([
  ["삼성", "삼성"],
  ["신한", "신한"],
  ["국민", "국민"],
  ["현대", "현대"],
  ["롯데", "롯데"],
  ["하나", "하나"],
  ["우리", "우리"],
  ["BC", "비씨"],
  ["NH", "농협"],
]);

function normalizedMaskedToken(value: string): string | undefined {
  const normalized = value
    .replace(/[＊*]/gu, "x")
    .replace(/[^0-9x]/giu, "")
    .toLowerCase()
    .slice(-4);
  return normalized === "" ? undefined : normalized;
}

function parseHeader(
  header: string,
):
  | {
      readonly kind: "success";
      readonly companyLabel: string;
      readonly maskedToken?: string;
    }
  | Extract<ShortcutCardMessageParseResult, { kind: "Rejected" }> {
  const supported = header.match(
    /^(삼성|신한|국민|현대|롯데|하나|우리|BC|NH)([0-9＊*xX-]*)승인(?:\s|$)/u,
  );
  if (supported !== null) {
    const companyLabel = SUPPORTED_COMPANIES.get(supported[1]);
    if (companyLabel === undefined) {
      return { kind: "Rejected", code: "UNSUPPORTED_CARD_COMPANY" };
    }
    const maskedToken = normalizedMaskedToken(supported[2]);
    return {
      kind: "success",
      companyLabel,
      ...(maskedToken === undefined ? {} : { maskedToken }),
    };
  }

  const approvalIndex = header.indexOf("승인");
  if (approvalIndex < 0) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }
  const prefix = header.slice(0, approvalIndex);
  const companyCandidate = prefix
    .replace(/[0-9＊*xX-]/gu, "")
    .trim();
  return companyCandidate === ""
    ? { kind: "Rejected", code: "CARD_COMPANY_REQUIRED" }
    : { kind: "Rejected", code: "UNSUPPORTED_CARD_COMPANY" };
}

function parseAmount(
  amountLine: string,
):
  | { readonly kind: "success"; readonly amountInWon: number }
  | Extract<ShortcutCardMessageParseResult, { kind: "Rejected" }> {
  const match = amountLine.match(
    /^([^\s]+)원(?:\s+(?:일시불|체크|(?:\d+개월\s*)?할부))?$/u,
  );
  if (match === null) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }
  const normalized = match[1].replace(/,/gu, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    return { kind: "Rejected", code: "AMOUNT_NOT_FINITE" };
  }
  if (!/^-?\d+$/u.test(normalized)) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }
  if (amount <= 0) {
    return { kind: "Rejected", code: "AMOUNT_NOT_POSITIVE" };
  }
  if (!Number.isSafeInteger(amount)) {
    return { kind: "Rejected", code: "AMOUNT_OUT_OF_RANGE" };
  }
  return { kind: "success", amountInWon: amount };
}

export function parseShortcutCardMessage(input: {
  readonly command: ParseShortcutCardMessageInput;
  readonly resolveOccurrenceYear: ShortcutOccurrenceYearResolver;
}): ShortcutCardMessageParseResult {
  const normalizedLines = input.command.message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const lines =
    normalizedLines[0] === "[Web발신]"
      ? normalizedLines.slice(1)
      : normalizedLines;
  if (lines.length < 3) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }

  const header = parseHeader(lines[0]);
  if (header.kind === "Rejected") return header;
  const amount = parseAmount(lines[1]);
  if (amount.kind === "Rejected") return amount;

  const occurrence = lines[2].match(
    /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+(.+)$/u,
  );
  if (occurrence === null || occurrence[5].trim() === "") {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }
  const resolved = input.resolveOccurrenceYear({
    month: Number(occurrence[1]),
    day: Number(occurrence[2]),
    hour: Number(occurrence[3]),
    minute: Number(occurrence[4]),
    receivedAt: input.command.receivedAt,
    zoneId: input.command.zoneId,
  });
  if (resolved.kind === "parseFailure") {
    return { kind: "Rejected", code: resolved.code };
  }
  const [occurredLocalDate, occurredLocalTime] =
    resolved.occurredLocalDateTime.split("T");
  return {
    kind: "Parsed",
    amountInWon: amount.amountInWon,
    occurredLocalDate,
    occurredLocalTime,
    merchant: occurrence[5].trim(),
    cardEvidence: {
      companyLabel: header.companyLabel,
      ...(header.maskedToken === undefined
        ? {}
        : { maskedToken: header.maskedToken }),
    },
  };
}
