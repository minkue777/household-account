const KIND_DIVIDEND_INFO_URL = 'https://kind.krx.co.kr/disclosureinfo/dividendinfo.do';
const KIND_DISCLOSURE_BY_CORP_URL =
  'https://kind.krx.co.kr/disclosure/searchdisclosurebycorp.do';
const KIND_VIEWER_URL = 'https://kind.krx.co.kr/common/disclsviewer.do';
const KIND_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const DISCLOSURE_PAGE_SIZE = 100;
const MAX_DISCLOSURE_PAGES = 6;
const MIN_DISCLOSURE_DETAIL_COUNT = 8;

export interface KindStockDividendInfo {
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
  annualDividendPerShare: number | null;
  paymentEvents: KindStockDividendPaymentEvent[];
}

export interface KindStockDividendPaymentEvent {
  paymentDate: string;
  dividend: number;
}

interface KindDividendSummaryRow {
  year: number;
  settlementMonth: number | null;
  annualDividendPerShare: number | null;
  dividendYield: number | null;
}

interface KindDisclosureSearchRow {
  acceptNumber: string;
  disclosedAt: string;
  title: string;
}

interface KindStockDividendDisclosureDetail {
  dividendKind: string | null;
  dividend: number;
  recordDate: string;
  paymentDate: string | null;
}

function decodeHtmlText(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripHtml(value: string) {
  return decodeHtmlText(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeKoreanText(value: string) {
  return value.replace(/\s+/g, '').trim();
}

function parseNumberText(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^0-9.-]/g, '');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateText(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthDifference(laterDate: string, earlierDate: string) {
  const [laterYear, laterMonth] = laterDate.split('-').map(Number);
  const [earlierYear, earlierMonth] = earlierDate.split('-').map(Number);
  return (laterYear - earlierYear) * 12 + (laterMonth - earlierMonth);
}

function normalizeCookieHeader(response: Response) {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;

  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie.call(response.headers).map((value) => value.split(';')[0].trim());
    return cookies.join('; ');
  }

  const rawCookie = response.headers.get('set-cookie');
  if (!rawCookie) {
    return '';
  }

  return rawCookie
    .split(/,(?=[^;,]+=)/)
    .map((value) => value.split(';')[0].trim())
    .join('; ');
}

function decodeBuffer(arrayBuffer: ArrayBuffer, contentType: string | null) {
  const charset =
    contentType?.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase() ||
    'utf-8';

  try {
    return new TextDecoder(charset).decode(arrayBuffer);
  } catch {
    return new TextDecoder('utf-8').decode(arrayBuffer);
  }
}

async function fetchKindResponse(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': KIND_USER_AGENT,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`KIND 요청 실패 (${response.status})`);
  }

  return response;
}

async function fetchKindText(url: string, init?: RequestInit) {
  const response = await fetchKindResponse(url, init);
  const arrayBuffer = await response.arrayBuffer();
  return decodeBuffer(arrayBuffer, response.headers.get('content-type'));
}

async function fetchKindSessionCookie(mainUrl: string) {
  const response = await fetchKindResponse(mainUrl);
  return normalizeCookieHeader(response);
}

function parseSummaryRows(html: string) {
  return Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))
    .map((match) => {
      const cells = Array.from(match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (cell) =>
        stripHtml(cell[1])
      );

      if (cells.length !== 11 && cells.length !== 12) {
        return null;
      }

      const yearIndex = cells.length === 12 ? 1 : 0;
      const year = parseNumberText(cells[yearIndex]);
      if (!year) {
        return null;
      }

      return {
        year,
        settlementMonth: parseNumberText(cells[yearIndex + 1]),
        annualDividendPerShare: parseNumberText(cells[yearIndex + 7]),
        dividendYield: parseNumberText(cells[yearIndex + 10]),
      } satisfies KindDividendSummaryRow;
    })
    .filter((row): row is KindDividendSummaryRow => row !== null)
    .sort((left, right) => right.year - left.year);
}

async function fetchDividendSummaryRows(code: string, stockName: string) {
  const cookie = await fetchKindSessionCookie(
    `${KIND_DIVIDEND_INFO_URL}?method=searchDividendInfoMain`
  );

  const today = new Date();
  const targetYear = String(today.getFullYear() - 1);
  const body = new URLSearchParams({
    method: 'searchDividendInfoSub',
    forward: 'dividendinfo_sub',
    currentPageSize: '3000',
    pageIndex: '1',
    orderMode: '1',
    orderStat: 'D',
    searchCodeType: 'number',
    searchCorpName: stockName,
    repIsuSrtCd: `A${code}`,
    chkOrgData: stockName,
    marketType: '',
    settlementMonth: '',
    selYear: targetYear,
    selYearCnt: '3',
  });

  const html = await fetchKindText(KIND_DIVIDEND_INFO_URL, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: `${KIND_DIVIDEND_INFO_URL}?method=searchDividendInfoMain`,
      Origin: 'https://kind.krx.co.kr',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html, */*; q=0.01',
    },
    body,
  });

  return parseSummaryRows(html);
}

function isDividendDisclosureTitle(title: string) {
  const normalized = normalizeKoreanText(title);
  return normalized.includes('현금ㆍ현물배당결정');
}

function parseDisclosureRows(html: string) {
  return Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))
    .map((match) => {
      const rowHtml = match[1];
      if (!rowHtml.includes('openDisclsViewer(')) {
        return null;
      }

      const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (cell) =>
        stripHtml(cell[1])
      );
      const acceptNumber = rowHtml.match(/openDisclsViewer\('([^']+)','[^']*'\)/)?.[1] || null;

      if (cells.length < 4 || !acceptNumber) {
        return null;
      }

      return {
        acceptNumber,
        disclosedAt: cells[1],
        title: cells[3],
      } satisfies KindDisclosureSearchRow;
    })
    .filter((row): row is KindDisclosureSearchRow => row !== null);
}

async function fetchDisclosurePageRows(
  cookie: string,
  code: string,
  stockName: string,
  pageIndex: number,
  fromDate: string,
  toDate: string
) {
  const body = new URLSearchParams({
    method: 'searchDisclosureByCorpSub',
    forward: 'searchdisclosurebycorp_sub',
    pageType: 'main',
    formUpClassCd: '00',
    searchCorpName: stockName,
    searchCodeType: 'number',
    repIsuSrtCd: `A${code}`,
    isurCd: '',
    repIsuCd: '',
    currentPageSize: String(DISCLOSURE_PAGE_SIZE),
    pageIndex: String(pageIndex),
    listStatCd: 'Y',
    secugrpId: 'ST',
    orderMode: '1',
    orderStat: 'D',
    reportNm: '',
    reportNmTemp: '',
    fromDate,
    toDate,
  });

  const html = await fetchKindText(KIND_DISCLOSURE_BY_CORP_URL, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: `${KIND_DISCLOSURE_BY_CORP_URL}?method=searchDisclosureByCorpMain`,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html, */*; q=0.01',
    },
    body,
  });

  return parseDisclosureRows(html);
}

async function fetchDividendDisclosureRows(code: string, stockName: string) {
  const cookie = await fetchKindSessionCookie(
    `${KIND_DISCLOSURE_BY_CORP_URL}?method=searchDisclosureByCorpMain`
  );

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(toDate.getDate() - 1500);

  const collectedRows: KindDisclosureSearchRow[] = [];

  for (let pageIndex = 1; pageIndex <= MAX_DISCLOSURE_PAGES; pageIndex += 1) {
    const pageRows = await fetchDisclosurePageRows(
      cookie,
      code,
      stockName,
      pageIndex,
      formatDate(fromDate),
      formatDate(toDate)
    );

    if (pageRows.length === 0) {
      break;
    }

    collectedRows.push(...pageRows.filter((row) => isDividendDisclosureTitle(row.title)));

    if (
      collectedRows.length >= MIN_DISCLOSURE_DETAIL_COUNT ||
      pageRows.length < DISCLOSURE_PAGE_SIZE
    ) {
      break;
    }
  }

  return Array.from(new Map(collectedRows.map((row) => [row.acceptNumber, row])).values());
}

async function fetchDisclosureDocumentNumber(acceptNumber: string) {
  const html = await fetchKindText(
    `${KIND_VIEWER_URL}?method=search&acptno=${acceptNumber}&docno=&viewerhost=&viewerport=`
  );
  return html.match(/<option value='([^|']+)\|Y'/)?.[1] || null;
}

async function fetchDisclosureDetailUrl(documentNumber: string) {
  const html = await fetchKindText(`${KIND_VIEWER_URL}?method=searchContents&docNo=${documentNumber}`);
  const relativeOrAbsoluteUrl = html.match(/setPath\('','([^']+\.htm)'/)?.[1];

  if (!relativeOrAbsoluteUrl) {
    return null;
  }

  return relativeOrAbsoluteUrl.startsWith('http')
    ? relativeOrAbsoluteUrl
    : `https://kind.krx.co.kr${relativeOrAbsoluteUrl}`;
}

function parseDisclosureDetail(html: string) {
  const rows = Array.from(html.matchAll(/<tr>\s*([\s\S]*?)<\/tr>/g), (match) =>
    Array.from(match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (cell) => stripHtml(cell[1]))
  );

  let dividendKind: string | null = null;
  let dividend: number | null = null;
  let recordDate: string | null = null;
  let paymentDate: string | null = null;

  for (const cells of rows) {
    if (cells.length < 2) {
      continue;
    }

    const [firstCell, secondCell, thirdCell] = cells;
    const normalizedFirstCell = normalizeKoreanText(firstCell);
    const normalizedSecondCell = normalizeKoreanText(secondCell || '');

    if (normalizedFirstCell.includes('배당구분')) {
      dividendKind = cells[cells.length - 1] || null;
      continue;
    }

    if (
      normalizedFirstCell.includes('1주당배당금(원)') &&
      normalizedSecondCell.includes('보통주식')
    ) {
      dividend = parseNumberText(thirdCell);
      continue;
    }

    if (normalizedFirstCell.includes('배당기준일')) {
      recordDate = parseDateText(cells[cells.length - 1]);
      continue;
    }

    if (
      normalizedFirstCell.includes('배당금지급예정일자') ||
      normalizedFirstCell.includes('배당금지급예정일')
    ) {
      paymentDate = parseDateText(cells[cells.length - 1]);
    }
  }

  if (!dividend || !recordDate) {
    return null;
  }

  return {
    dividendKind,
    dividend,
    recordDate,
    paymentDate,
  } satisfies KindStockDividendDisclosureDetail;
}

async function fetchDividendDisclosureDetails(rows: KindDisclosureSearchRow[]) {
  const details = await Promise.all(
    rows.map(async (row) => {
      const documentNumber = await fetchDisclosureDocumentNumber(row.acceptNumber);
      if (!documentNumber) {
        return null;
      }

      const detailUrl = await fetchDisclosureDetailUrl(documentNumber);
      if (!detailUrl || !detailUrl.endsWith('/61500.htm')) {
        return null;
      }

      const html = await fetchKindText(detailUrl);
      const detail = parseDisclosureDetail(html);
      if (!detail) {
        return null;
      }

      return {
        ...detail,
        disclosedAt: row.disclosedAt,
      };
    })
  );

  return details
    .filter(
      (detail): detail is KindStockDividendDisclosureDetail & {
        disclosedAt: string;
      } => detail !== null
    )
    .filter((detail, index, array) => {
      const currentKey = `${detail.recordDate}|${detail.paymentDate || ''}|${detail.dividend}`;
      return (
        index ===
        array.findIndex(
          (candidate) =>
            `${candidate.recordDate}|${candidate.paymentDate || ''}|${candidate.dividend}` ===
            currentKey
        )
      );
    })
    .sort((left, right) => {
      const dateOrder = right.recordDate.localeCompare(left.recordDate);
      return dateOrder !== 0 ? dateOrder : right.disclosedAt.localeCompare(left.disclosedAt);
    });
}

function inferAnnualFrequency(
  details: Array<KindStockDividendDisclosureDetail & { disclosedAt: string }>
) {
  if (details.length <= 1) {
    const latestKind = normalizeKoreanText(details[0]?.dividendKind || '');

    if (latestKind.includes('분기')) {
      return 4;
    }

    if (latestKind.includes('중간') || latestKind.includes('반기')) {
      return 2;
    }

    return details.length === 0 ? null : 1;
  }

  const gaps: number[] = [];
  for (let index = 0; index < Math.min(details.length - 1, 6); index += 1) {
    const monthGap = getMonthDifference(details[index].recordDate, details[index + 1].recordDate);
    if (monthGap > 0) {
      gaps.push(monthGap);
    }
  }

  if (gaps.length === 0) {
    return 1;
  }

  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const inferredCycleMonths =
    averageGap <= 1.5 ? 1 : averageGap <= 3.5 ? 3 : averageGap <= 6.5 ? 6 : 12;

  return Math.max(1, Math.round(12 / inferredCycleMonths));
}

function buildAnnualDividendFromDetails(
  details: Array<KindStockDividendDisclosureDetail & { disclosedAt: string }>,
  frequency: number | null
) {
  if (!frequency || details.length === 0) {
    return null;
  }

  return details.slice(0, frequency).reduce((sum, detail) => sum + detail.dividend, 0);
}

function sanitizeDividendDetails(
  details: Array<KindStockDividendDisclosureDetail & { disclosedAt: string }>,
  annualDividendPerShare: number | null
) {
  if (!annualDividendPerShare || details.length === 0) {
    return details;
  }

  return details.filter((detail) => {
    if (detail.dividend <= 0) {
      return false;
    }

    if (detail.dividend > annualDividendPerShare) {
      return false;
    }

    return true;
  });
}

export async function fetchKindStockDividendInfo(
  code: string,
  stockName: string
): Promise<KindStockDividendInfo | null> {
  const [summaryRows, disclosureRows] = await Promise.all([
    fetchDividendSummaryRows(code, stockName).catch(() => [] as KindDividendSummaryRow[]),
    fetchDividendDisclosureRows(code, stockName).catch(() => [] as KindDisclosureSearchRow[]),
  ]);

  const details = await fetchDividendDisclosureDetails(disclosureRows).catch(
    () => [] as Array<KindStockDividendDisclosureDetail & { disclosedAt: string }>
  );

  if (summaryRows.length === 0 && details.length === 0) {
    return null;
  }

  const latestSummary = summaryRows[0] || null;
  const roughFrequency = inferAnnualFrequency(details);
  const annualDividendPerShare =
    latestSummary?.annualDividendPerShare ??
    buildAnnualDividendFromDetails(details, roughFrequency) ??
    null;
  const sanitizedDetails = sanitizeDividendDetails(details, annualDividendPerShare);
  const latestDetail = sanitizedDetails[0] || null;
  const frequency = inferAnnualFrequency(sanitizedDetails);

  return {
    recentDividend: latestDetail?.dividend ?? null,
    paymentDate: latestDetail?.paymentDate ?? null,
    frequency,
    dividendYield: latestSummary?.dividendYield ?? null,
    annualDividendPerShare,
    paymentEvents: sanitizedDetails
      .filter((detail) => detail.paymentDate)
      .map((detail) => ({
        paymentDate: detail.paymentDate as string,
        dividend: detail.dividend as number,
      })),
  };
}
