import type {
  LedgerSearchableTransaction,
  SearchCardDefinition,
} from "../model/detailedLedgerSearch";
import { normalizedSearchText } from "./ledgerSearchMatching";

function matchesMaskedLastFour(pattern: string, lastFour: string): boolean {
  if (pattern.length !== 4 || lastFour.length !== 4) return false;
  return [...pattern].every(
    (character, index) =>
      character === "*" || character === "x" || character === lastFour[index],
  );
}

function aliasesFor(
  transaction: LedgerSearchableTransaction,
  definitions: readonly SearchCardDefinition[],
): readonly string[] {
  const evidence = transaction.cardEvidence;
  if (evidence === undefined) return [];
  const definition = definitions.find(
    (candidate) => candidate.companyCode === evidence.companyCode,
  );
  return [
    evidence.companyCode,
    evidence.standardLabel,
    ...(definition?.aliases ?? []),
    ...(definition?.cardTypeAliases[evidence.cardType] ?? []),
  ].map(normalizedSearchText);
}

export function matchesDetailedLedgerSearch(input: {
  transaction: LedgerSearchableTransaction;
  query: string;
  definitions: readonly SearchCardDefinition[];
}): boolean {
  const query = normalizedSearchText(input.query);
  const evidence = input.transaction.cardEvidence;
  const structured = /^(.*)\(([0-9*x]{4})\)$/.exec(query);
  if (structured !== null) {
    if (evidence?.lastFour === undefined) return false;
    const requestedCompany = structured[1].replace(/카드$/, "");
    const companyMatches = aliasesFor(
      input.transaction,
      input.definitions,
    ).some((alias) => alias.replace(/카드$/, "") === requestedCompany);
    return (
      companyMatches &&
      matchesMaskedLastFour(structured[2], evidence.lastFour)
    );
  }

  const searchable = [
    normalizedSearchText(input.transaction.merchant),
    normalizedSearchText(input.transaction.memo),
    ...aliasesFor(input.transaction, input.definitions),
    ...(evidence?.lastFour === undefined ? [] : [evidence.lastFour]),
  ];
  return searchable.some((value) => value.includes(query));
}
