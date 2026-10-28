import { createSafeExternalTextHttpApplication } from "../../platform/external-operations/application/safeExternalTextHttpApplication";
import type { SafeExternalTextHttpInputPort } from "../../platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";
import { NodeExternalTextHttpTransport } from "./nodeExternalTextHttpTransport";

function percentage(value: unknown): number | null {
  if (typeof value === "string") {
    if (!/^\d+(?:\.\d+)?\s*%?$/u.test(value.trim())) return null;
    value = Number(value.trim().replace(/%$/u, "").trim());
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** 공개된 종목 배당률을 읽는다. 가구의 일부 배당 이력으로 연 배당률을 추정하지 않는다. */
export class NaverDividendYieldReader {
  constructor(private readonly http: SafeExternalTextHttpInputPort = createSafeExternalTextHttpApplication({
    policy: {
      providers: [{ provider: "naver-domestic", allowedHosts: ["m.stock.naver.com"], allowedPorts: [443], maxRedirectHops: 1 }],
      timeoutMs: 2_500, maxAttempts: 1, maxResponseBytes: 512 * 1024,
    },
    transport: new NodeExternalTextHttpTransport(),
  })) {}

  async read(instrumentCode: string): Promise<number | null> {
    // 이 공급자의 종목 식별자 범위만 요청하고, 응답의 실제 식별자·종류를 다시 확인한다.
    const code = instrumentCode.trim().toUpperCase();
    if (!/^[0-9A-Z]{6}$/u.test(code)) return null;
    const response = await this.http.execute({
      provider: "naver-domestic", operation: "dividend-yield",
      url: `https://m.stock.naver.com/api/stock/${code}/integration`,
      headers: { "User-Agent": "Mozilla/5.0 HouseholdAccount/1.0", Accept: "application/json", Referer: "https://m.stock.naver.com/" },
    });
    if (response.kind !== "success") throw new Error(`DIVIDEND_YIELD_${response.code}`);
    const data = JSON.parse(response.body);
    if (data?.itemCode !== code) throw new Error("DIVIDEND_YIELD_INSTRUMENT_MISMATCH");
    if (data.stockEndType === "etf") return percentage(data.etfKeyIndicator?.dividendYieldTtm);
    if (data.stockEndType === "stock") {
      if (!Array.isArray(data.totalInfos)) throw new Error("DIVIDEND_YIELD_SCHEMA_CHANGED");
      return percentage(data.totalInfos.find((item: { code?: unknown } | null) => item?.code === "dividendYieldRatio")?.value);
    }
    return null;
  }
}
