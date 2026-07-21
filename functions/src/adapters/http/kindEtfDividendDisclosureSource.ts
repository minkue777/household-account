import { createHash } from "node:crypto";

import type { KindDividendDisclosurePort } from "../../contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import type {
  SafeExternalTextHttpInputPort,
  SafeExternalTextHttpResult,
} from "../../platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";

const KIND_SEARCH_URL =
  "https://kind.krx.co.kr/disclosure/disclosurebystocktype.do";
const KIND_VIEWER_URL = "https://kind.krx.co.kr/common/disclsviewer.do";
const KIND_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

interface DisclosureRow {
  readonly sourceDisclosureId: string;
  readonly disclosedAt: string;
}

interface DisclosureDetail {
  readonly recordDate: string;
  readonly paymentDate: string;
  readonly perShareAmount: number;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&nbsp;/giu, " ")
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .trim();
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function normalizeName(value: string): string {
  return stripHtml(value)
    .replace(/[\s·ㆍ()]/gu, "")
    .replace(/&/gu, "")
    .toLocaleUpperCase("ko-KR");
}

function normalizeDate(value: string): string | undefined {
  const normalized = value.trim().replace(/[./]/gu, "-");
  return /^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? normalized : undefined;
}

export function parseKindEtfDisclosureRows(
  html: string,
  instrumentName: string,
): readonly DisclosureRow[] {
  const targetName = normalizeName(instrumentName);
  const rows: DisclosureRow[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const row = match[1];
    const sourceDisclosureId =
      /openDisclsViewer\(\s*['"](\d+)['"]/iu.exec(row)?.[1];
    if (sourceDisclosureId === undefined) continue;
    const name =
      /etfisusummary_open\([^)]*\)[^>]*\btitle\s*=\s*['"]([^'"]+)['"]/iu.exec(
        row,
      )?.[1];
    if (name === undefined || normalizeName(name) !== targetName) continue;
    const title =
      /openDisclsViewer\([^)]*\)[^>]*\btitle\s*=\s*['"]([^'"]+)['"]/iu.exec(
        row,
      )?.[1] ?? "";
    const normalizedTitle = stripHtml(title).replace(/\s+/gu, "");
    if (
      !normalizedTitle.includes("ETF이익금분배신고") &&
      !normalizedTitle.includes("분배금안내")
    ) {
      continue;
    }
    const disclosedAt =
      normalizeDate(/\d{4}[./-]\d{2}[./-]\d{2}/u.exec(stripHtml(row))?.[0] ?? "") ??
      "1970-01-01";
    rows.push({ sourceDisclosureId, disclosedAt });
  }
  return [...new Map(rows.map((row) => [row.sourceDisclosureId, row])).values()]
    .sort((left, right) => left.sourceDisclosureId.localeCompare(right.sourceDisclosureId));
}

export function parseKindEtfDisclosureDetail(
  html: string,
  instrumentCode: string,
  instrumentName: string,
): DisclosureDetail | undefined {
  const targetCode = instrumentCode.toLocaleUpperCase("en-US");
  const targetName = normalizeName(instrumentName);
  const candidates = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)]
    .flatMap((rowMatch) => {
      const cells = [
        ...rowMatch[1].matchAll(/<(?:td|span)\b[^>]*>([\s\S]*?)<\/(?:td|span)>/giu),
      ].map((cell) => stripHtml(cell[1]));
      const dates = cells.flatMap((cell) => {
        const date = normalizeDate(cell);
        return date === undefined ? [] : [date];
      });
      if (dates.length < 2) return [];
      const amountCell = [...cells]
        .reverse()
        .find((cell: string) => /-?[\d,]+(?:\.\d+)?/u.test(cell));
      const perShareAmount = Number(amountCell?.replace(/[^\d.-]/gu, ""));
      if (!Number.isFinite(perShareAmount) || perShareAmount < 0) return [];
      return [
        {
          cells,
          recordDate: dates[0],
          paymentDate: dates[1],
          perShareAmount,
        },
      ];
    });
  const selected =
    candidates.find(({ cells }) =>
      cells.some((cell) => cell.toLocaleUpperCase("en-US").includes(targetCode)),
    ) ??
    candidates.find(({ cells }) =>
      cells.some((cell) => normalizeName(cell) === targetName),
    );
  return selected === undefined
    ? undefined
    : {
        recordDate: selected.recordDate,
        paymentDate: selected.paymentDate,
        perShareAmount: selected.perShareAmount,
      };
}

function documentNumber(html: string): string | undefined {
  return /<option\s+value=['"]([^|'"\s]+)\|Y['"]/iu.exec(html)?.[1];
}

function detailUrl(html: string): string | undefined {
  const raw = /setPath\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+\.htm)['"]/iu.exec(
    html,
  )?.[1];
  if (raw === undefined) return undefined;
  return raw.startsWith("https://") ? raw : new URL(raw, "https://kind.krx.co.kr").href;
}

function mapHttpFailure(result: Exclude<SafeExternalTextHttpResult, { kind: "success" }>) {
  if (result.kind === "retryable-failure") {
    return { kind: "retryable-failure" as const, code: result.code, attempts: result.attempts };
  }
  return {
    kind: "contract-failure" as const,
    code: result.code,
    attempts: result.attempts,
  };
}

async function get(
  http: SafeExternalTextHttpInputPort,
  url: string,
): Promise<SafeExternalTextHttpResult> {
  return http.execute({
    provider: "KIND",
    operation: "dividend-disclosure",
    url,
    headers: { "User-Agent": KIND_USER_AGENT },
  });
}

export class KindEtfDividendDisclosureSource
  implements KindDividendDisclosurePort
{
  constructor(private readonly http: SafeExternalTextHttpInputPort) {}

  async discover(input: {
    readonly instrumentCode: string;
    readonly instrumentName: string;
    readonly periodFrom: string;
    readonly periodTo: string;
  }) {
    const parameters = new URLSearchParams({
      method: "searchDisclosureByStockTypeEtfSub",
      forward: "disclosurebystocktype_etf_sub",
      currentPageSize: "3000",
      pageIndex: "1",
      orderMode: "1",
      orderStat: "D",
      etfIsuSrtNm: input.instrumentName,
      fromDate: input.periodFrom,
      toDate: input.periodTo,
    });
    const search = await this.http.execute({
      provider: "KIND",
      operation: "dividend-disclosure",
      url: KIND_SEARCH_URL,
      method: "POST",
      headers: {
        "User-Agent": KIND_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer:
          "https://kind.krx.co.kr/disclosure/disclosurebystocktype.do?method=searchDisclosureByStockTypeEtf",
      },
      body: parameters.toString(),
    });
    if (search.kind !== "success") return mapHttpFailure(search);
    const rows = parseKindEtfDisclosureRows(search.body, input.instrumentName);
    if (rows.length === 0) {
      return { kind: "no-data" as const, code: "NO_DISCLOSURES", attempts: search.attempts };
    }

    const disclosures = [];
    let attempts = search.attempts;
    let lastFailure:
      | ReturnType<typeof mapHttpFailure>
      | undefined;
    for (const row of rows) {
      const viewer = await get(
        this.http,
        `${KIND_VIEWER_URL}?method=search&acptno=${encodeURIComponent(
          row.sourceDisclosureId,
        )}&docno=&viewerhost=&viewerport=`,
      );
      attempts = Math.max(attempts, viewer.attempts);
      if (viewer.kind !== "success") {
        lastFailure = mapHttpFailure(viewer);
        continue;
      }
      const number = documentNumber(viewer.body);
      if (number === undefined) continue;
      const contents = await get(
        this.http,
        `${KIND_VIEWER_URL}?method=searchContents&docNo=${encodeURIComponent(number)}`,
      );
      attempts = Math.max(attempts, contents.attempts);
      if (contents.kind !== "success") {
        lastFailure = mapHttpFailure(contents);
        continue;
      }
      const url = detailUrl(contents.body);
      if (url === undefined || !url.endsWith("/68659.htm")) continue;
      const detailResponse = await get(this.http, url);
      attempts = Math.max(attempts, detailResponse.attempts);
      if (detailResponse.kind !== "success") {
        lastFailure = mapHttpFailure(detailResponse);
        continue;
      }
      const detail = parseKindEtfDisclosureDetail(
        detailResponse.body,
        input.instrumentCode,
        input.instrumentName,
      );
      if (detail === undefined) continue;
      // KIND 검색 접수번호가 여러 개여도 동일 공시 문서로 연결될 수 있습니다.
      // viewer가 반환한 document number를 canonical provider identity로 사용하면
      // 정정/일괄공시 alias가 같은 DividendEvent로 수렴합니다.
      const sourceDisclosureId = number;
      const sourceReferenceHash = createHash("sha256")
        .update(
          `${sourceDisclosureId}\u0000${detail.recordDate}\u0000${detail.paymentDate}\u0000${detail.perShareAmount}`,
          "utf8",
        )
        .digest("hex");
      disclosures.push({
        source: "KIND" as const,
        sourceDisclosureId,
        disclosureState: "active" as const,
        instrumentCode: input.instrumentCode.toLocaleUpperCase("en-US"),
        instrumentName: input.instrumentName,
        recordDate: detail.recordDate,
        paymentDate: detail.paymentDate,
        perShareAmount: detail.perShareAmount,
        disclosedAt: row.disclosedAt,
        sourceReferenceHash,
      });
    }
    if (disclosures.length === 0) {
      return (
        lastFailure ?? {
          kind: "no-data" as const,
          code: "DISCLOSURE_DETAIL_NOT_FOUND",
          attempts,
        }
      );
    }
    return {
      kind: "success" as const,
      disclosures: [
        ...new Map(
          disclosures.map((disclosure) => [
            disclosure.sourceDisclosureId,
            disclosure,
          ]),
        ).values(),
      ],
      attempts,
    };
  }
}
