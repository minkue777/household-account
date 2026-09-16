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

export { normalizeLoanRepaymentMethod } from "../../../automation/public";
