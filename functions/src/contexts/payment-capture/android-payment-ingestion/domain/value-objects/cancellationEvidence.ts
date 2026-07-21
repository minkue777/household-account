import type { CancellationCardEvidence } from "../model/cancellationMatch";

export function normalizeCancellationMerchant(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeCardCompany(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeLastFour(value: string): string | undefined {
  const digits = value.replace(/\D/g, "").slice(-4);
  return digits.length === 4 ? digits : undefined;
}

export function normalizeCancellationCard(
  value: CancellationCardEvidence,
): CancellationCardEvidence {
  return {
    companyLabel: normalizeCardCompany(value.companyLabel),
    lastFour: normalizeLastFour(value.lastFour) ?? "",
  };
}

export function cancellationCardsEqual(
  left: CancellationCardEvidence,
  right: CancellationCardEvidence,
): boolean {
  const normalizedLeft = normalizeCancellationCard(left);
  const normalizedRight = normalizeCancellationCard(right);
  return (
    normalizedLeft.companyLabel !== "" &&
    normalizedLeft.companyLabel === normalizedRight.companyLabel &&
    normalizedLeft.lastFour !== "" &&
    normalizedLeft.lastFour === normalizedRight.lastFour
  );
}
