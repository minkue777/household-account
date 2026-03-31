const KIND_SEARCH_URL = 'https://kind.krx.co.kr/disclosure/disclosurebystocktype.do';
const KIND_VIEWER_URL = 'https://kind.krx.co.kr/common/disclsviewer.do';
const KIND_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

export interface KindEtfDividendInfo {
  recentDividend: number;
  paymentDate: string;
  frequency: number;
  annualDividendPerShare: number;
  paymentEvents: KindEtfDividendPaymentEvent[];
}

export interface KindEtfDividendPaymentEvent {
  paymentDate: string;
  dividend: number;
}

interface KindDisclosureRow {
  disclosedAt: string;
  name: string;
  acceptNumber: string;
  title: string;
}

interface KindDisclosureDetailRow {
  securityCode: string;
  name: string;
  recordDate: string;
  paymentDate: string;
  dividend: number;
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

function normalizeEtfName(value: string) {
  return decodeHtmlText(value)
    .replace(/\s+/g, '')
    .replace(/[·ㆍ]/g, '')
    .replace(/[()]/g, '')
    .replace(/&/g, '')
    .toUpperCase();
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function getMonthDifference(laterDate: string, earlierDate: string) {
  const later = parseDateParts(laterDate);
  const earlier = parseDateParts(earlierDate);
  return (later.year - earlier.year) * 12 + (later.month - earlier.month);
}

async function fetchKindText(url: string, init?: RequestInit) {
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

  return response.text();
}

function parseKindDisclosureRows(html: string, stockName: string) {
  const normalizedTargetName = normalizeEtfName(stockName);

  return html
    .split('<tr')
    .slice(1)
    .map((chunk): KindDisclosureRow | null => {
      if (!chunk.includes('openDisclsViewer(')) {
        return null;
      }

      const disclosedAt = chunk.match(/<td class="txc">([^<]+)<\/td>/)?.[1]?.trim();
      const name = chunk.match(/etfisusummary_open\('[^']+'\); return false;" title='([^']+)'/)?.[1];
      const disclosureMatch =
        chunk.match(/openDisclsViewer\('(\d+)','[^']*'\)" title='([^']+)'/) || null;

      if (!disclosedAt || !name || !disclosureMatch) {
        return null;
      }

      return {
        disclosedAt,
        name: decodeHtmlText(name),
        acceptNumber: disclosureMatch[1],
        title: decodeHtmlText(disclosureMatch[2]),
      };
    })
    .filter((row): row is KindDisclosureRow => row !== null)
    .filter((row) => normalizeEtfName(row.name) === normalizedTargetName);
}

async function fetchKindDisclosureDocumentNumber(acceptNumber: string) {
  const html = await fetchKindText(
    `${KIND_VIEWER_URL}?method=search&acptno=${acceptNumber}&docno=&viewerhost=&viewerport=`
  );

  return html.match(/<option value='([^|']+)\|Y'/)?.[1] || null;
}

async function fetchKindDisclosureDetailUrl(documentNumber: string) {
  const html = await fetchKindText(
    `${KIND_VIEWER_URL}?method=searchContents&docNo=${documentNumber}`
  );
  const relativeOrAbsoluteUrl = html.match(/setPath\('','([^']+\.htm)'/)?.[1];

  if (!relativeOrAbsoluteUrl) {
    return null;
  }

  return relativeOrAbsoluteUrl.startsWith('http')
    ? relativeOrAbsoluteUrl
    : `https://kind.krx.co.kr${relativeOrAbsoluteUrl}`;
}

function parseKindDisclosureDetailRow(html: string, code: string, stockName: string) {
  const normalizedTargetName = normalizeEtfName(stockName);
  const detailRows = html
    .split('<tr>')
    .slice(1)
    .map((chunk): KindDisclosureDetailRow | null => {
      const cells = Array.from(chunk.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g), (match) =>
        decodeHtmlText(match[1].replace(/<[^>]+>/g, ''))
      );

      if (cells.length < 5) {
        return null;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[2]) || !/^\d{4}-\d{2}-\d{2}$/.test(cells[3])) {
        return null;
      }

      const dividend = Number(cells[4].replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(dividend)) {
        return null;
      }

      return {
        securityCode: cells[0],
        name: cells[1],
        recordDate: cells[2],
        paymentDate: cells[3],
        dividend,
      };
    })
    .filter((row): row is KindDisclosureDetailRow => row !== null);

  return (
    detailRows.find((row) => row.securityCode.includes(code)) ||
    detailRows.find((row) => normalizeEtfName(row.name) === normalizedTargetName) ||
    detailRows.find(
      (row) =>
        normalizeEtfName(row.name).includes(normalizedTargetName) ||
        normalizedTargetName.includes(normalizeEtfName(row.name))
    ) ||
    null
  );
}

async function fetchKindDividendDisclosureDetail(
  acceptNumber: string,
  code: string,
  stockName: string
) {
  const documentNumber = await fetchKindDisclosureDocumentNumber(acceptNumber);
  if (!documentNumber) {
    return null;
  }

  const detailUrl = await fetchKindDisclosureDetailUrl(documentNumber);
  if (!detailUrl || !detailUrl.endsWith('/68659.htm')) {
    return null;
  }

  const html = await fetchKindText(detailUrl);
  return parseKindDisclosureDetailRow(html, code, stockName);
}

function inferAnnualFrequency(details: KindDisclosureDetailRow[]) {
  if (details.length <= 1) {
    return 1;
  }

  const gaps: number[] = [];
  for (let index = 0; index < Math.min(details.length - 1, 6); index += 1) {
    const monthGap = getMonthDifference(details[index].paymentDate, details[index + 1].paymentDate);
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

export async function fetchKindEtfDividendInfo(
  code: string,
  stockName: string
): Promise<KindEtfDividendInfo | null> {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);

  const searchParams = new URLSearchParams({
    method: 'searchDisclosureByStockTypeEtfSub',
    forward: 'disclosurebystocktype_etf_sub',
    currentPageSize: '3000',
    pageIndex: '1',
    orderMode: '1',
    orderStat: 'D',
    etfIsuSrtNm: stockName,
    fromDate: formatDate(oneYearAgo),
    toDate: formatDate(today),
  });

  const searchHtml = await fetchKindText(KIND_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer:
        'https://kind.krx.co.kr/disclosure/disclosurebystocktype.do?method=searchDisclosureByStockTypeEtf',
    },
    body: searchParams.toString(),
  });

  const dividendDisclosureRows = parseKindDisclosureRows(searchHtml, stockName).filter(
    (row) =>
      row.title.includes('ETF이익금분배신고') && row.title.includes('분배금안내')
  );

  if (dividendDisclosureRows.length === 0) {
    return null;
  }

  const details = (
    await Promise.all(
      dividendDisclosureRows.map(async (row) => {
        const detail = await fetchKindDividendDisclosureDetail(row.acceptNumber, code, stockName);
        if (!detail) {
          return null;
        }

        return {
          ...detail,
          disclosedAt: row.disclosedAt,
        };
      })
    )
  ).filter(
    (
      detail
    ): detail is KindDisclosureDetailRow & {
      disclosedAt: string;
    } => detail !== null
  );

  if (details.length === 0) {
    return null;
  }

  const dedupedDetails = Array.from(
    new Map(
      details.map((detail) => [
        `${detail.paymentDate}_${detail.dividend}_${detail.recordDate}`,
        detail,
      ])
    ).values()
  );

  dedupedDetails.sort((left, right) => right.paymentDate.localeCompare(left.paymentDate));

  const latest = dedupedDetails[0];
  const frequency = inferAnnualFrequency(dedupedDetails);
  const dividendSamples = dedupedDetails.slice(0, frequency);
  const annualDividendPerShare =
    dividendSamples.length === 0
      ? latest.dividend * frequency
      : Math.round(
          (dividendSamples.reduce((sum, detail) => sum + detail.dividend, 0) /
            dividendSamples.length) *
            frequency
        );

  return {
    recentDividend: latest.dividend,
    paymentDate: latest.paymentDate,
    frequency,
    annualDividendPerShare,
    paymentEvents: dedupedDetails.map((detail) => ({
      paymentDate: detail.paymentDate,
      dividend: detail.dividend,
    })),
  };
}
