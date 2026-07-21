import { describe, expect, it } from "vitest";

import {
  KindEtfDividendDisclosureSource,
  parseKindEtfDisclosureDetail,
  parseKindEtfDisclosureRows,
} from "../../../src/adapters/http/kindEtfDividendDisclosureSource";
import type { SafeExternalTextHttpInputPort } from "../../../src/platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";

describe("KIND ETF 배당 공시 adapter 계약", () => {
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
          ? `<table>${row("20260428000772")}${row("20260428001484")}</table>`
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
});
