import { describe, expect, it } from "vitest";

import {
  KindEtfDividendDisclosureSource,
  parseKindEtfDisclosureDetail,
  parseKindEtfDisclosureRows,
} from "../../../src/adapters/http/kindEtfDividendDisclosureSource";
import type { SafeExternalTextHttpInputPort } from "../../../src/platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";

describe("KIND ETF 배당 공시 adapter 계약", () => {
  it("검색 단계의 실제 HTTP 상태를 공급자 실패 결과에 보존한다", async () => {
    const requests: Array<{ stage?: string; url: string }> = [];
    const http: SafeExternalTextHttpInputPort = {
      async execute(request) {
        requests.push({ stage: request.stage, url: request.url });
        return {
          kind: "contract-failure",
          code: "HTTP_STATUS_NOT_SUPPORTED",
          attempts: 1,
          httpStatus: 403,
          stage: request.stage,
        };
      },
    };

    await expect(
      new KindEtfDividendDisclosureSource(http).discover({
        instrumentCode: "102110",
        instrumentName: "TIGER 200",
        periodFrom: "2025-08-01",
        periodTo: "2026-08-01",
      }),
    ).resolves.toEqual({
      kind: "contract-failure",
      code: "HTTP_STATUS_NOT_SUPPORTED",
      attempts: 1,
      httpStatus: 403,
      stage: "search",
    });
    expect(requests).toEqual([
      expect.objectContaining({ stage: "search" }),
    ]);
  });

  it("provider 공시번호를 안정 ID로 추출하고 다른 ETF와 다른 보고서는 제외한다", () => {
    const html = `
      <table>
        <tr>
          <td class="txc">2026-07-20</td>
          <td><a onclick="etfisusummary_open('A1'); return false;" title="TIGER 200">TIGER 200</a></td>
          <td><a onclick="openDisclsViewer('20260720000123','');" title="ETF이익금분배신고(분배금안내)">공시</a></td>
        </tr>
        <tr>
          <td class="txc">2026-07-20</td>
          <td><a onclick="etfisusummary_open('A2'); return false;" title="다른 ETF">다른 ETF</a></td>
          <td><a onclick="openDisclsViewer('20260720000456','');" title="ETF이익금분배신고(분배금안내)">공시</a></td>
        </tr>
        <tr>
          <td class="txc">2026-07-20</td>
          <td><a onclick="etfisusummary_open('A3'); return false;" title="TIGER 200">TIGER 200</a></td>
          <td><a onclick="openDisclsViewer('20260720000789','');" title="상장 안내">공시</a></td>
        </tr>
      </table>`;
    expect(parseKindEtfDisclosureRows(html, "TIGER 200")).toEqual([
      {
        sourceDisclosureId: "20260720000123",
        disclosedAt: "2026-07-20",
      },
    ]);
  });

  it("68659 상세 표에서 종목의 기준일·지급일·주당 금액을 읽는다", () => {
    const html = `
      <table><tr>
        <td><span>102110</span></td>
        <td><span>TIGER 200</span></td>
        <td><span>2026-07-10</span></td>
        <td><span>2026-07-20</span></td>
        <td><span>120원</span></td>
      </tr></table>`;
    expect(parseKindEtfDisclosureDetail(html, "102110", "TIGER 200")).toEqual({
      recordDate: "2026-07-10",
      paymentDate: "2026-07-20",
      perShareAmount: 120,
    });
  });

  it("서로 다른 검색 접수번호가 같은 KIND 문서를 가리키면 canonical 공시 한 건으로 수렴한다", async () => {
    const row = (acceptNumber: string) => `
      <tr><td class="txc">2026-04-28</td>
      <td><a onclick="etfisusummary_open('A'); return false;" title="TIGER 200">TIGER 200</a></td>
      <td><a onclick="openDisclsViewer('${acceptNumber}','');" title="ETF이익금분배신고(분배금안내)(일괄공시)">공시</a></td></tr>`;
    const http: SafeExternalTextHttpInputPort = {
      async execute(request) {
        const body = request.url.includes("disclosurebystocktype.do")
          ? `<em>2</em><table>${row("20260428000772")}${row("20260428001484")}</table>`
          : request.url.includes("method=search&")
            ? "<select><option value='20260428003174|Y'>문서</option></select>"
            : request.url.includes("method=searchContents")
              ? "setPath('','https://kind.krx.co.kr/external/68659.htm')"
              : `<table><tr><td><span>102110</span></td><td><span>TIGER 200</span></td><td><span>2026-04-30</span></td><td><span>2026-05-06</span></td><td><span>450원</span></td></tr></table>`;
        return {
          kind: "success",
          body,
          finalUrl: request.url,
          responseBytes: Buffer.byteLength(body),
          attempts: 1,
        };
      },
    };
    const result = await new KindEtfDividendDisclosureSource(http).discover({
      instrumentCode: "102110",
      instrumentName: "TIGER 200",
      periodFrom: "2026-04-01",
      periodTo: "2026-05-01",
    });
    expect(result).toMatchObject({
      kind: "success",
      disclosures: [
        {
          sourceDisclosureId: "20260428003174",
          recordDate: "2026-04-30",
          paymentDate: "2026-05-06",
          perShareAmount: 450,
        },
      ],
    });
  });

  it("한 실행의 배당 검색과 동일 문서 조회를 공유하고 검색 세션 쿠키를 순차 요청에 전달한다", async () => {
    const calls: Array<{
      stage?: string;
      headers?: Readonly<Record<string, string>>;
      body?: string;
    }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const row = (name: string, acceptNumber: string) => `
      <tr><td class="txc">2026-08-01</td>
      <td><a onclick="etfisusummary_open('A'); return false;" title="${name}">${name}</a></td>
      <td><a onclick="openDisclsViewer('${acceptNumber}','');" title="ETF이익금분배신고(분배금안내)(일괄공시)">공시</a></td></tr>`;
    const detail = `
      <table>
        <tr><td><span>102110</span></td><td><span>TIGER 200</span></td><td><span>2026-08-01</span></td><td><span>2026-08-08</span></td><td><span>120원</span></td></tr>
        <tr><td><span>069500</span></td><td><span>KODEX 200</span></td><td><span>2026-08-01</span></td><td><span>2026-08-08</span></td><td><span>130원</span></td></tr>
      </table>`;
    const http: SafeExternalTextHttpInputPort = {
      async execute(request) {
        calls.push({
          stage: request.stage,
          headers: request.headers,
          body: request.body,
        });
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        const body =
          request.stage === "search"
            ? `<em>2</em><table>${row("TIGER 200", "20260801000001")}${row("KODEX 200", "20260801000001")}</table>`
            : request.stage === "viewer"
              ? "<select><option value='DOC1|Y'>문서</option></select>"
              : request.stage === "contents"
                ? "setPath('','https://kind.krx.co.kr/external/68659.htm')"
                : detail;
        return {
          kind: "success",
          body,
          finalUrl: request.url,
          responseBytes: Buffer.byteLength(body),
          attempts: 1,
          ...(request.stage === "search"
            ? {
                setCookieHeaders: [
                  "__smVisitorID=old; Path=/",
                  "__smVisitorID=new; Path=/",
                  "JSESSIONID=value=with=equals; Path=/; HttpOnly",
                ],
              }
            : {}),
        };
      },
    };
    const source = new KindEtfDividendDisclosureSource(http);

    const [tiger, kodex] = await Promise.all([
      source.discover({
        instrumentCode: "102110",
        instrumentName: "TIGER 200",
        periodFrom: "2025-08-01",
        periodTo: "2026-08-01",
      }),
      source.discover({
        instrumentCode: "069500",
        instrumentName: "KODEX 200",
        periodFrom: "2025-08-01",
        periodTo: "2026-08-01",
      }),
    ]);

    expect(tiger).toMatchObject({
      kind: "success",
      disclosures: [{ instrumentCode: "102110", perShareAmount: 120 }],
    });
    expect(kodex).toMatchObject({
      kind: "success",
      disclosures: [{ instrumentCode: "069500", perShareAmount: 130 }],
    });
    expect(calls.filter(({ stage }) => stage === "search")).toHaveLength(1);
    expect(calls.filter(({ stage }) => stage === "viewer")).toHaveLength(1);
    expect(calls.filter(({ stage }) => stage === "contents")).toHaveLength(1);
    expect(calls.filter(({ stage }) => stage === "detail")).toHaveLength(1);
    expect(calls.find(({ stage }) => stage === "search")?.body).toContain(
      "reportCd=68659",
    );
    expect(calls.find(({ stage }) => stage === "viewer")?.headers?.Cookie).toBe(
      "__smVisitorID=new; JSESSIONID=value=with=equals",
    );
    expect(maxInFlight).toBe(1);
  });

  it("KIND가 선언한 전체 건수보다 검색 행이 적으면 조용히 누락하지 않는다", async () => {
    const http: SafeExternalTextHttpInputPort = {
      async execute(request) {
        const body = `<em>2</em><table>
          <tr><td class="txc">2026-08-01</td><td><a onclick="etfisusummary_open('A')" title="TIGER 200">TIGER 200</a></td>
          <td><a onclick="openDisclsViewer('20260801000001','')" title="ETF이익금분배신고">공시</a></td></tr>
        </table>`;
        return {
          kind: "success",
          body,
          finalUrl: request.url,
          responseBytes: Buffer.byteLength(body),
          attempts: 1,
        };
      },
    };

    await expect(
      new KindEtfDividendDisclosureSource(http).discover({
        instrumentCode: "102110",
        instrumentName: "TIGER 200",
        periodFrom: "2025-08-01",
        periodTo: "2026-08-01",
      }),
    ).resolves.toEqual({
      kind: "contract-failure",
      code: "RESPONSE_BODY_INVALID",
      attempts: 1,
      stage: "search",
    });
  });
});
