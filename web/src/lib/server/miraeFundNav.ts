export const NATIONAL_GROWTH_FUND = {
  code: 'FUND:K55301EW0012',
  name: '미래에셋국민참여형국민성장혼합자산투자신탁(사모투자재간접형) 종류 C-e',
  instrumentType: 'fund' as const,
  market: 'KR' as const,
  priceScale: 1_000,
  parentFundCode: '539500',
  childFundCode: '539502',
  kofIaCode: 'EW001',
  aliases: [
    '국민성장펀드',
    '국민참여형국민성장',
    '미래에셋국민성장',
    'EW001',
    '539500',
    '539502',
    'K55301EW0012',
  ],
} as const;

export interface FundNavQuote {
  date: string;
  nav: number;
  taxableNav?: number;
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: string) {
  const match = value.trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function getSeoulDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function parseMiraeFundNavHtml(html: string, asOfDate = getSeoulDate()) {
  const rows: FundNavQuote[] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cells: string[] = [];
    cellPattern.lastIndex = 0;

    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim());
    }

    if (cells.length < 2) {
      continue;
    }

    const date = normalizeDate(cells[0]);
    const nav = parseNumber(cells[1]);
    const taxableNav = cells[2] ? parseNumber(cells[2]) : null;

    if (!date || date > asOfDate || nav === null || nav <= 0) {
      continue;
    }

    rows.push({
      date,
      nav,
      ...(taxableNav !== null && taxableNav > 0 ? { taxableNav } : {}),
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

export async function fetchNationalGrowthFundNav(asOfDate = getSeoulDate()) {
  const url = new URL('https://investments.miraeasset.com/magi/fund/basePrices.do');
  url.searchParams.set('fundGb', '2');
  url.searchParams.set('fundCd', NATIONAL_GROWTH_FUND.childFundCode);
  url.searchParams.set('period', '1M');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; HouseholdAccount/1.0)',
      Accept: 'text/html,application/xhtml+xml',
      Referer:
        'https://investments.miraeasset.com/magi/fund/view.do?fundGb=2&fundCd=539500&childFundGb=2&childFundCd=539502',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Mirae Asset fund NAV request failed: ${response.status}`);
  }

  const quotes = parseMiraeFundNavHtml(await response.text(), asOfDate);
  if (quotes.length === 0) {
    throw new Error('Mirae Asset fund NAV response did not contain a valid quote');
  }

  return quotes;
}
