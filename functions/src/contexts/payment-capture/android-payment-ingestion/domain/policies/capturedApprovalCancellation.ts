import { normalizeCancellationMerchant } from "../value-objects/cancellationEvidence";

const DAY = 24 * 60 * 60 * 1_000;
const SEARCH_DAYS = 30;

interface CancellationEvidence {
  readonly cancellationDate: string;
  readonly amountInWon: number;
  readonly originalMerchant?: string;
  readonly merchant: string;
  readonly canonicalCardId?: string;
  readonly cardEvidence?: { readonly companyLabel: string; readonly maskedToken?: string };
}

interface CapturedApprovalEvidence {
  readonly approvalDate: string;
  readonly approvalAmountInWon: number;
  readonly merchant: string;
  readonly canonicalCardId?: string;
  readonly companyLabel: string;
  readonly lastFour: string;
}

/** Firestore 후보 조회와 실제 후보 판정이 같은 서울 날짜 범위를 사용합니다. */
export function captureCancellationSearchWindow(cancellationDate: string) {
  const end = Date.parse(`${cancellationDate}T00:00:00+09:00`);
  return {
    startDate: Number.isFinite(end)
      ? new Date(end - SEARCH_DAYS * DAY + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10)
      : cancellationDate,
    endDate: cancellationDate,
  };
}

export function matchesCapturedApprovalCancellation(
  cancellation: CancellationEvidence,
  approval: CapturedApprovalEvidence,
): boolean {
  const window = captureCancellationSearchWindow(cancellation.cancellationDate);
  const start = Date.parse(`${window.startDate}T00:00:00+09:00`);
  const end = Date.parse(`${window.endDate}T00:00:00+09:00`);
  const approvedAt = Date.parse(`${approval.approvalDate}T00:00:00+09:00`);
  if (
    !Number.isFinite(end) || !Number.isFinite(approvedAt) ||
    approvedAt > end || approvedAt < start ||
    approval.approvalAmountInWon !== cancellation.amountInWon ||
    normalizeCancellationMerchant(approval.merchant) !==
      normalizeCancellationMerchant(cancellation.originalMerchant ?? cancellation.merchant)
  ) return false;

  if (cancellation.canonicalCardId !== undefined && approval.canonicalCardId !== undefined) {
    return cancellation.canonicalCardId === approval.canonicalCardId;
  }
  const evidence = cancellation.cardEvidence;
  if (evidence === undefined) return approval.companyLabel === "";
  const normalizeCompany = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (normalizeCompany(evidence.companyLabel) !== normalizeCompany(approval.companyLabel)) return false;
  const evidenceDigits = (evidence.maskedToken ?? "").replace(/\D/gu, "").slice(-4);
  return evidenceDigits === "" || evidenceDigits === approval.lastFour;
}
