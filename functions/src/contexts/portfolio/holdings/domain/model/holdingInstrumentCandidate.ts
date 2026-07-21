export interface HoldingInstrumentCandidate {
  assetId: string;
  market: "KRX" | "US" | "UPBIT_KRW";
  instrumentType?: "ETF" | "STOCK" | "CRYPTO";
  code: string;
  name: string;
  lifecycle: "active" | "deleted";
}
