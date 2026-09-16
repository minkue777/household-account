export const newlyListedEtfs = [
  { code: "0227L0", name: "HANARO 미국에이전틱AI TOP2+" },
  { code: "0238F0", name: "KODEX 미국AI메모리TOP2플러스" },
  { code: "0239Y0", name: "PLUS 코리아HBM반도체" },
  { code: "0239Z0", name: "PLUS AI반도체소부장액티브" },
];

/** External HTTP fixtures only; catalog normalization runs in the real adapter. */
export function createInstrumentCatalogSourceFixture() {
  const etfs = Array.from({ length: 500 }, (_, index) => ({
    itemCode: String(900000 + index),
    stockName: `E2E 지수 ETF ${index}`,
    stockEndType: "etf",
  }));
  const markets = {
    KOSPI: [
      { itemCode: "005930", stockName: "삼성전자", stockEndType: "stock" },
      { itemCode: "069500", stockName: "KODEX 200", stockEndType: "stock" },
      { itemCode: "530056", stockName: "E2E ETN", stockEndType: "etn" },
      ...newlyListedEtfs.map(({ code, name }) => ({
        itemCode: code, stockName: name, stockEndType: "etf",
      })),
      ...etfs,
    ],
    KOSDAQ: [
      { itemCode: "0197V0", stockName: "엔에이치스팩34호", stockEndType: "stock" },
    ],
  };
  const requests: string[] = [];
  // KIND serves EUC-KR. These are the actual market labels, not a mocked decoder.
  const kindRows = [
    ["KIND only Kospi company", "c0afb0a1", "111111"],
    ["Kosdaq company", "c4dabdbab4da", "0197V0"],
    ["KIND only Kosdaq company", "c4dabdbab4da", "0300X0"],
    ["KONEX numeric", "c4dab3d8bdba", "777777"],
    ["KONEX alpha", "c4dab3d8bdba", "0203K0"],
  ];
  const kindBody = Buffer.concat([
    Buffer.from("<table><tr><th>Name</th><th>Market</th><th>Code</th></tr>"),
    ...kindRows.flatMap(([name, market, code]) => [
      Buffer.from(`<tr><td>${name}</td><td>`),
      Buffer.from(market, "hex"),
      Buffer.from(`</td><td>${code}</td></tr>`),
    ]),
    Buffer.from("</table>"),
  ]);

  const fetchFixture: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url.href);
    if (url.hostname === "m.stock.naver.com") {
      const market = url.pathname.split("/").at(-1) as keyof typeof markets;
      const rows = markets[market];
      if (!rows) throw new Error("Unexpected market fixture");
      const page = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("pageSize"));
      return Response.json({ totalCount: rows.length, stocks: rows.slice((page - 1) * size, page * size) });
    }
    if (url.hostname === "finance.naver.com") {
      // The ETF-specific feed has not yet added the four new ETFs.
      return Response.json({ result: { etfItemList: [
        ...etfs.map(({ itemCode }) => ({ itemcode: itemCode })),
        { itemcode: "069500" },
      ] } });
    }
    if (url.hostname === "kind.krx.co.kr") return new Response(kindBody);
    if (url.pathname.endsWith("nasdaqlisted.txt")) {
      return new Response("Symbol|Security Name|Test Issue|ETF\nAAPL|Apple Inc.|N|N\nTEST|Test symbol|Y|N\nFile Creation Time: 0916202606:00||||");
    }
    if (url.pathname.endsWith("otherlisted.txt")) {
      return new Response("ACT Symbol|Security Name|Test Issue|ETF\nSPY|SPDR S&P 500 ETF Trust|N|Y\nFile Creation Time: 0916202606:00||||");
    }
    throw new Error(`Unexpected catalog provider: ${url.hostname}`);
  };
  return { fetch: fetchFixture, requests };
}
