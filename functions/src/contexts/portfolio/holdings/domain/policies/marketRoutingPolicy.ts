const KRX_GOLD_SPOT_CODES = new Set(["KRXGOLD1KG", "KRXGOLD100G"]);

export function isKrxGoldSpotCode(code: string): boolean {
  return KRX_GOLD_SPOT_CODES.has(code.trim().toLocaleUpperCase("en-US"));
}
