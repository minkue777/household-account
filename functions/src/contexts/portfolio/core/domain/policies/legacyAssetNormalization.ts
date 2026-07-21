import type { AssetType } from "../model/assetCreation";

export interface NormalizedAssetSubType {
  readonly canonical?: string;
  readonly legacy?: string;
}

const SUB_TYPE_ALIASES: Readonly<Record<string, string>> = {
  deposit: "deposit",
  installment: "installment",
  insurance: "insurance",
  physical: "physical",
  stock: "stock",
  credit: "credit",
  mortgage: "mortgage",
  jeonse: "jeonse",
  예금: "deposit",
  적금: "installment",
  보험: "insurance",
  실물: "physical",
  실물금: "physical",
  주식: "stock",
  금etf: "stock",
  신용대출: "credit",
  주택담보대출: "mortgage",
  전세대출: "jeonse",
};

const ALLOWED_SUB_TYPES: Readonly<Record<AssetType, ReadonlySet<string>>> = {
  savings: new Set(["deposit", "installment", "insurance"]),
  stock: new Set(),
  crypto: new Set(),
  property: new Set(),
  gold: new Set(["physical", "stock"]),
  loan: new Set(["credit", "mortgage", "jeonse"]),
};

export function normalizeCanonicalAssetSubType(
  type: AssetType,
  value: unknown,
): NormalizedAssetSubType | undefined {
  if (value === undefined || value === "") return {};
  if (typeof value !== "string") return undefined;
  const legacy = value.trim();
  const token = legacy.toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
  const canonical = SUB_TYPE_ALIASES[token];
  return canonical !== undefined && ALLOWED_SUB_TYPES[type].has(canonical)
    ? { canonical, legacy }
    : undefined;
}

export function normalizeLoanRepaymentMethod(
  value: string,
): "equal-principal-and-interest" | "equal-principal" | "bullet" | undefined {
  const token = value.toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
  const mapping = Object.freeze({
    "equal-principal-and-interest": "equal-principal-and-interest",
    "equal-principal": "equal-principal",
    bullet: "bullet",
    원리금균등상환: "equal-principal-and-interest",
    원금균등상환: "equal-principal",
    만기일시상환: "bullet",
  } as const);
  return mapping[token as keyof typeof mapping];
}
