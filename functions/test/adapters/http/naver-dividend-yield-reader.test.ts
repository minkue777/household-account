import { afterEach, describe, expect, it, vi } from "vitest";
import { NaverDividendYieldReader } from "../../../src/adapters/http/naverDividendYieldReader";

afterEach(() => { vi.unstubAllGlobals(); });

function respond(data: unknown, status = 200) {
  const fetch = vi.fn(async (_input: string | URL | Request) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("[MARKET-001] Naver dividend yield", () => {
  it.each([0, 0.64, "12.34%"])("reads published ETF trailing yield %j without estimating from household events", async value => {
    const fetch = respond({ itemCode: "368590", stockEndType: "etf", etfKeyIndicator: { dividendYieldTtm: value } });
    await expect(new NaverDividendYieldReader().read("368590")).resolves.toBe(Number(String(value).replace('%', '')));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe("https://m.stock.naver.com/api/stock/368590/integration");
  });
  it("reads stock yield from the named provider field, independently of annual amount", async () => {
    respond({ itemCode: "005930", stockEndType: "stock", totalInfos: [{ code: "dividend", value: "1,668원" }, { code: "dividendYieldRatio", value: "0.69%" }] });
    await expect(new NaverDividendYieldReader().read("005930")).resolves.toBe(0.69);
  });
  it.each([null, "", "N/A", "-", "Infinity", -1, "2x"])("keeps unavailable or invalid yield %j distinct from zero", async value => {
    respond({ itemCode: "368590", stockEndType: "etf", etfKeyIndicator: { dividendYieldTtm: value } });
    await expect(new NaverDividendYieldReader().read("368590")).resolves.toBeNull();
  });
  it("does not request unsupported identifiers", async () => {
    const fetch = respond({});
    for (const code of ["AAPL", "FUND:123456", "../foo", ""]) {
      await expect(new NaverDividendYieldReader().read(code)).resolves.toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a different instrument response and HTTP failure", async () => {
    respond({ itemCode: "000000", stockEndType: "etf", etfKeyIndicator: { dividendYieldTtm: 5 } });
    await expect(new NaverDividendYieldReader().read("368590")).rejects.toThrow("INSTRUMENT_MISMATCH");
    const fetch = respond({}, 503);
    await expect(new NaverDividendYieldReader().read("368590")).rejects.toThrow("DIVIDEND_YIELD_");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
