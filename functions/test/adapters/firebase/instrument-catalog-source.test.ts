import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteInstrumentCatalogRunSource } from "../../../src/adapters/firebase/portfolio/firebaseInstrumentCatalog";
import { createInstrumentCatalogSourceFixture, newlyListedEtfs } from "../../support/instrument-catalog-source-fixture";

async function loadSource() {
  const fixture = createInstrumentCatalogSourceFixture();
  vi.stubGlobal("fetch", fixture.fetch);
  const bucket = { file: () => ({ exists: async () => [false] }) };
  const source = new RemoteInstrumentCatalogRunSource(
    bucket as unknown as ConstructorParameters<typeof RemoteInstrumentCatalogRunSource>[0],
  );
  const run = await source.load("2026-09-16");
  if (run.domesticSource.kind !== "success") throw new Error(run.domesticSource.code);
  return { items: run.domesticSource.items, us: run.usSource };
}

afterEach(() => vi.unstubAllGlobals());

describe("실제 종목 공급자 정규화 [MARKET-005]", () => {
  it("KOSPI·KOSDAQ의 숫자·영문 코드를 보존하고 KONEX는 모두 제외한다", async () => {
    const { items, us } = await loadSource();
    expect(items.map(({ code }) => code)).toEqual(expect.arrayContaining(["005930", "111111", "0197V0", "0300X0"]));
    expect(items.some(({ code }) => code === "777777" || code === "0203K0")).toBe(false);
    expect(items.filter(({ code }) => code === "0197V0")).toHaveLength(1);
    expect(us).toEqual({ kind: "success", items: [
      { market: "US", instrumentType: "STOCK", code: "AAPL", name: "Apple Inc." },
      { market: "US", instrumentType: "ETF", code: "SPY", name: "SPDR S&P 500 ETF Trust" },
    ] });
  });

  it("ETF 전용 목록의 반영이 늦어도 시장 원천의 ETF 유형으로 신규 종목을 분류한다", async () => {
    const { items } = await loadSource();
    for (const item of newlyListedEtfs) {
      expect(items.find(({ code }) => code === item.code)).toEqual({ ...item, market: "KRX", instrumentType: "ETF" });
    }
    expect(items.find(({ code }) => code === "069500")?.instrumentType).toBe("ETF");
    expect(items.find(({ code }) => code === "530056")?.instrumentType).toBe("ETN");
    expect(items.find(({ code }) => code === "005930")?.instrumentType).toBe("STOCK");
  });
});
