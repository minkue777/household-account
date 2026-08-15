import { createHash } from "node:crypto";

import type { KindDividendDisclosurePort } from "../../contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import type {
  SafeExternalTextHttpInputPort,
  SafeExternalTextHttpRequest,
  SafeExternalTextHttpResult,
} from "../../platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";

const KIND_SEARCH_URL =
  "https://kind.krx.co.kr/disclosure/disclosurebystocktype.do";
const KIND_VIEWER_URL = "https://kind.krx.co.kr/common/disclsviewer.do";
const KIND_DIVIDEND_REPORT_CODE = "68659";
const KIND_DIVIDEND_REPORT_NAME =
  "ETF\uC774\uC775\uAE08\uBD84\uBC30\uC2E0\uACE0(\uBD84\uBC30\uAE08\uC548\uB0B4)(\uC77C\uAD04\uACF5\uC2DC)";
const KIND_SEARCH_PAGE_SIZE = 10_000;
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

function searchResultCount(html: string): number | undefined {
  const raw = /<em\b[^>]*>\s*([\d,]+)\s*<\/em>/iu.exec(html)?.[1];
  if (raw === undefined) return undefined;
  const count = Number(raw.replace(/,/gu, ""));
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function searchRowCount(html: string): number {
  return [...html.matchAll(/openDisclsViewer\(\s*['"]\d+['"]/giu)].length;
}

function mapHttpFailure(result: Exclude<SafeExternalTextHttpResult, { kind: "success" }>) {
  if (result.kind === "retryable-failure") {
    return {
      kind: "retryable-failure" as const,
      code: result.code,
      attempts: result.attempts,
      ...(result.httpStatus === undefined
        ? {}
        : { httpStatus: result.httpStatus }),
      ...(result.stage === undefined ? {} : { stage: result.stage }),
    };
  }
  return {
    kind: "contract-failure" as const,
    code: result.code,
    attempts: result.attempts,
    ...(result.httpStatus === undefined
      ? {}
      : { httpStatus: result.httpStatus }),
    ...(result.stage === undefined ? {} : { stage: result.stage }),
  };
}

export class KindEtfDividendDisclosureSource
  implements KindDividendDisclosurePort
{
  private readonly cookies = new Map<string, string>();
  private requestQueue: Promise<void> = Promise.resolve();
  private readonly searchByPeriod = new Map<
    string,
    Promise<SafeExternalTextHttpResult>
  >();
  private readonly viewerByAcceptNumber = new Map<
    string,
    Promise<SafeExternalTextHttpResult>
  >();
  private readonly contentsByDocumentNumber = new Map<
    string,
    Promise<SafeExternalTextHttpResult>
  >();
  private readonly detailByUrl = new Map<
    string,
    Promise<SafeExternalTextHttpResult>
  >();

  constructor(private readonly http: SafeExternalTextHttpInputPort) {}

  private absorbCookies(headers: readonly string[] | undefined): void {
    for (const header of headers ?? []) {
      const semicolon = header.indexOf(";");
      const pair = header.slice(0, semicolon < 0 ? header.length : semicolon);
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) continue;
      if (value.length === 0) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private execute(
    request: SafeExternalTextHttpRequest,
  ): Promise<SafeExternalTextHttpResult> {
    const pending = this.requestQueue.then(async () => {
      const cookie = this.cookieHeader();
      const result = await this.http.execute({
        ...request,
        headers: {
          ...(request.headers ?? {}),
          ...(cookie === undefined ? {} : { Cookie: cookie }),
        },
        captureSetCookies: true,
      });
      if (result.kind === "success") {
        this.absorbCookies(result.setCookieHeaders);
      }
      return result;
    });
    this.requestQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private get(
    url: string,
    stage: "viewer" | "contents" | "detail",
  ): Promise<SafeExternalTextHttpResult> {
    return this.execute({
      provider: "KIND",
      operation: "dividend-disclosure",
      stage,
      url,
      headers: {
        "User-Agent": KIND_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        Referer: KIND_SEARCH_URL,
      },
    });
  }

  private search(input: {
    readonly periodFrom: string;
    readonly periodTo: string;
  }): Promise<SafeExternalTextHttpResult> {
    const key = `${input.periodFrom}\u0000${input.periodTo}`;
    const cached = this.searchByPeriod.get(key);
    if (cached !== undefined) return cached;
    const pending = (async (): Promise<SafeExternalTextHttpResult> => {
      const parameters = new URLSearchParams({
        method: "searchDisclosureByStockTypeEtfSub",
        forward: "disclosurebystocktype_etf_sub",
        currentPageSize: String(KIND_SEARCH_PAGE_SIZE),
        pageIndex: "1",
        orderMode: "1",
        orderStat: "D",
        etfIsuSrtCd: "",
        etfIsuSrtNm: "",
        reportCd: KIND_DIVIDEND_REPORT_CODE,
        reportTmp: KIND_DIVIDEND_REPORT_NAME,
        reportNm: KIND_DIVIDEND_REPORT_NAME,
        fromDate: input.periodFrom,
        toDate: input.periodTo,
      });
      const result = await this.execute({
        provider: "KIND",
        operation: "dividend-disclosure",
        stage: "search",
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
      if (result.kind !== "success") return result;
      const declaredCount = searchResultCount(result.body);
      const receivedCount = searchRowCount(result.body);
      if (declaredCount === undefined || declaredCount !== receivedCount) {
        return {
          kind: "contract-failure",
          code: "RESPONSE_BODY_INVALID",
          attempts: result.attempts,
          stage: "search",
        };
      }
      return result;
    })();
    this.searchByPeriod.set(key, pending);
    return pending;
  }

  private viewer(acceptNumber: string): Promise<SafeExternalTextHttpResult> {
    const cached = this.viewerByAcceptNumber.get(acceptNumber);
    if (cached !== undefined) return cached;
    const pending = this.get(
      `${KIND_VIEWER_URL}?method=search&acptno=${encodeURIComponent(
        acceptNumber,
      )}&docno=&viewerhost=&viewerport=`,
      "viewer",
    );
    this.viewerByAcceptNumber.set(acceptNumber, pending);
    return pending;
  }

  private contents(documentNumberValue: string): Promise<SafeExternalTextHttpResult> {
    const cached = this.contentsByDocumentNumber.get(documentNumberValue);
    if (cached !== undefined) return cached;
    const pending = this.get(
      `${KIND_VIEWER_URL}?method=searchContents&docNo=${encodeURIComponent(
        documentNumberValue,
      )}`,
      "contents",
    );
    this.contentsByDocumentNumber.set(documentNumberValue, pending);
    return pending;
  }

  private detail(url: string): Promise<SafeExternalTextHttpResult> {
    const cached = this.detailByUrl.get(url);
    if (cached !== undefined) return cached;
    const pending = this.get(url, "detail");
    this.detailByUrl.set(url, pending);
    return pending;
  }

  async discover(input: {
    readonly instrumentCode: string;
    readonly instrumentName: string;
    readonly periodFrom: string;
    readonly periodTo: string;
  }) {
    const search = await this.search({
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
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
      const viewer = await this.viewer(row.sourceDisclosureId);
      attempts = Math.max(attempts, viewer.attempts);
      if (viewer.kind !== "success") {
        lastFailure = mapHttpFailure(viewer);
        continue;
      }
      const number = documentNumber(viewer.body);
      if (number === undefined) continue;
      const contents = await this.contents(number);
      attempts = Math.max(attempts, contents.attempts);
      if (contents.kind !== "success") {
        lastFailure = mapHttpFailure(contents);
        continue;
      }
      const url = detailUrl(contents.body);
      if (url === undefined || !url.endsWith("/68659.htm")) continue;
      const detailResponse = await this.detail(url);
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
          `${sourceDisclosureId}\u0000${input.instrumentCode.toLocaleUpperCase("en-US")}\u0000${detail.recordDate}\u0000${detail.paymentDate}\u0000${detail.perShareAmount}`,
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
