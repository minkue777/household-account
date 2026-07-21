import type { LedgerSearchFact } from "../model/ledgerSearch";

export function normalizedSearchText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function normalizedCompany(value: string): string {
  return normalizedSearchText(value).replace(/카드$/, "");
}

function maskedNumberMatches(pattern: string, lastFour: string): boolean {
  if (pattern.length !== 4 || lastFour.length !== 4) return false;
  return [...pattern].every(
    (character, index) => character === "*" || character === lastFour[index],
  );
}

export function matchesLedgerSearchQuery(
  fact: LedgerSearchFact,
  rawQuery: string,
): boolean {
  const query = normalizedSearchText(rawQuery);
  const structuredCard = /^(.*)\(([0-9*]{4})\)$/.exec(query);
  if (structuredCard !== null) {
    const evidence = fact.cardEvidence;
    if (evidence === undefined || evidence.lastFour === undefined) return false;
    const requestedCompany = normalizedCompany(structuredCard[1]);
    const companyMatches = [evidence.companyCode, evidence.companyLabel].some(
      (company) => normalizedCompany(company) === requestedCompany,
    );
    return (
      companyMatches &&
      maskedNumberMatches(structuredCard[2], evidence.lastFour)
    );
  }

  if (query.length === 0) return true;
  const evidence = fact.cardEvidence;
  const fields = [fact.merchant, fact.memo];
  if (evidence !== undefined) {
    fields.push(
      evidence.companyCode,
      evidence.companyLabel,
      `${evidence.companyLabel}카드`,
      evidence.lastFour ?? "",
      `${evidence.companyLabel}카드(${evidence.lastFour ?? ""})`,
    );
  }
  return fields.some((field) => normalizedSearchText(field).includes(query));
}
