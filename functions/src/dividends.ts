import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import fetch, { RequestInit } from 'node-fetch';
import { db, REGION } from './config';

const STOCK_HOLDINGS_COLLECTION = 'stock_holdings';
const DIVIDEND_EVENTS_COLLECTION = 'dividend_events';
const DIVIDEND_SNAPSHOTS_COLLECTION = 'dividend_snapshots';

const KIND_SEARCH_URL = 'https://kind.krx.co.kr/disclosure/disclosurebystocktype.do';
const KIND_VIEWER_URL = 'https://kind.krx.co.kr/common/disclsviewer.do';
const KIND_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

interface HoldingGroup {
  householdId: string;
  stockCode: string;
  stockName: string;
  quantity: number;
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

interface KindDividendEvent {
  stockCode: string;
  stockName: string;
  recordDate: string;
  paymentDate: string;
  dividend: number;
}

interface DividendSnapshotEventRecord {
  stockCode: string;
  stockName: string;
  recordDate?: string;
  paymentDate: string;
  perShareAmount: number;
  quantity: number;
  totalAmount: number;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeStockCode(value?: string) {
  return (value || '').trim().toUpperCase();
}

function isTrackableDomesticHolding(data: {
  holdingType?: string;
  stockCode?: string;
  householdId?: string;
}) {
  const holdingType = data.holdingType || 'stock';
  const stockCode = normalizeStockCode(data.stockCode);

  return holdingType === 'stock' && !!data.householdId && /^[A-Z0-9]+$/.test(stockCode);
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

async function fetchKindText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': KIND_USER_AGENT,
      ...(init?.headers || {}),
    },
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
    .filter((row) => normalizeEtfName(row.name) === normalizedTargetName)
    .filter((row) => {
      const title = row.title.replace(/\s+/g, '');
      return title.includes('ETF이익금분배신고') && title.includes('분배금안내');
    });
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

async function fetchKindEtfDividendEvents(
  code: string,
  stockName: string
): Promise<KindDividendEvent[]> {
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

  const disclosureRows = parseKindDisclosureRows(searchHtml, stockName);
  if (disclosureRows.length === 0) {
    return [];
  }

  const details = (
    await Promise.all(
      disclosureRows.map((row) => fetchKindDividendDisclosureDetail(row.acceptNumber, code, stockName))
    )
  ).filter((detail): detail is KindDisclosureDetailRow => detail !== null);

  const uniqueEvents = Array.from(
    new Map(
      details.map((detail) => [
        `${detail.recordDate}_${detail.paymentDate}_${detail.dividend}`,
        {
          stockCode: code,
          stockName,
          recordDate: detail.recordDate,
          paymentDate: detail.paymentDate,
          dividend: detail.dividend,
        },
      ])
    ).values()
  );

  uniqueEvents.sort((left, right) => left.paymentDate.localeCompare(right.paymentDate));
  return uniqueEvents;
}

function buildDividendEventDocId(
  householdId: string,
  stockCode: string,
  recordDate: string,
  paymentDate: string,
  dividend: number
) {
  return `${householdId}_${stockCode}_${recordDate}_${paymentDate}_${dividend}`;
}

function buildDividendSnapshotDocId(householdId: string, year: number) {
  return `${householdId}_${year}`;
}

function buildDividendSnapshotEventKey(
  stockCode: string,
  paymentDate: string,
  dividend: number
) {
  return `${stockCode}_${paymentDate}_${dividend}`;
}

function createEmptyMonthlyData() {
  return Array.from({ length: 12 }, () => 0);
}

function buildMonthlyDataFromEvents(events: Record<string, DividendSnapshotEventRecord>) {
  const monthlyData = createEmptyMonthlyData();

  Object.values(events).forEach((event) => {
    const month = Number(event.paymentDate.split('-')[1]);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return;
    }

    monthlyData[month - 1] += event.totalAmount;
  });

  return monthlyData.map((amount) => Math.round(amount));
}

async function getHoldingGroups() {
  const snapshot = await db.collection(STOCK_HOLDINGS_COLLECTION).get();
  const grouped = new Map<string, HoldingGroup>();

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    if (!isTrackableDomesticHolding(data)) {
      return;
    }

    const householdId = data.householdId as string;
    const stockCode = normalizeStockCode(data.stockCode);
    const stockName = (data.stockName as string | undefined) || stockCode;
    const quantity = Number(data.quantity || 0);
    const key = `${householdId}:${stockCode}`;

    const current = grouped.get(key) || {
      householdId,
      stockCode,
      stockName,
      quantity: 0,
    };

    current.quantity += Number.isFinite(quantity) ? quantity : 0;
    current.stockName = stockName || current.stockName;
    grouped.set(key, current);
  });

  return Array.from(grouped.values());
}

async function upsertDividendEvent(
  holding: HoldingGroup,
  event: KindDividendEvent,
  today: string
) {
  const docId = buildDividendEventDocId(
    holding.householdId,
    holding.stockCode,
    event.recordDate,
    event.paymentDate,
    event.dividend
  );
  const docRef = db.collection(DIVIDEND_EVENTS_COLLECTION).doc(docId);
  const docSnap = await docRef.get();
  const existing = docSnap.exists ? docSnap.data() : null;

  const updates: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
    householdId: holding.householdId,
    stockCode: holding.stockCode,
    stockName: holding.stockName,
    recordDate: event.recordDate,
    paymentDate: event.paymentDate,
    paymentYear: Number(event.paymentDate.slice(0, 4)),
    perShareAmount: event.dividend,
    source: 'kind',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  let changed = false;
  let eligibleQuantity =
    typeof existing?.eligibleQuantity === 'number' ? existing.eligibleQuantity : null;
  let totalAmount = typeof existing?.totalAmount === 'number' ? existing.totalAmount : null;
  let status = (existing?.status as string | undefined) || 'announced';
  const shouldCaptureEligibleQuantityToday = today === event.recordDate;

  if (eligibleQuantity === null && shouldCaptureEligibleQuantityToday) {
    eligibleQuantity = holding.quantity;
    updates.eligibleQuantity = eligibleQuantity;
    updates.eligibleCapturedAt = today;
    status = 'recorded';
    changed = true;
  }

  if (totalAmount === null && eligibleQuantity !== null && today >= event.recordDate) {
    totalAmount = Math.round(event.dividend * eligibleQuantity);
    updates.totalAmount = totalAmount;
    updates.fixedCapturedAt = today;
    status = 'fixed';
    changed = true;
  }

  if (totalAmount !== null && status !== 'paid' && today >= event.paymentDate) {
    updates.paidCapturedAt = today;
    status = 'paid';
    changed = true;
  }

  if (
    existing &&
    (existing.stockName !== holding.stockName ||
      existing.recordDate !== event.recordDate ||
      existing.paymentDate !== event.paymentDate ||
      existing.perShareAmount !== event.dividend)
  ) {
    changed = true;
  }

  updates.status = status;

  if (!docSnap.exists) {
    await docRef.set({
      ...updates,
      eligibleQuantity,
      totalAmount,
      status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      created: true,
      snapshotYear: totalAmount !== null ? Number(event.paymentDate.slice(0, 4)) : null,
    };
  }

  if (changed) {
    await docRef.update(updates);
    return {
      created: false,
      snapshotYear: totalAmount !== null ? Number(event.paymentDate.slice(0, 4)) : null,
    };
  }

  return {
    created: false,
    snapshotYear: null,
  };
}

async function rebuildDividendSnapshot(householdId: string, year: number) {
  const snapshotDocId = buildDividendSnapshotDocId(householdId, year);
  const snapshotRef = db.collection(DIVIDEND_SNAPSHOTS_COLLECTION).doc(snapshotDocId);
  const [existingSnapshot, dividendEventsSnapshot] = await Promise.all([
    snapshotRef.get(),
    db.collection(DIVIDEND_EVENTS_COLLECTION).where('householdId', '==', householdId).get(),
  ]);

  const existingEvents =
    existingSnapshot.exists && typeof existingSnapshot.data()?.events === 'object'
      ? (existingSnapshot.data()?.events as Record<string, DividendSnapshotEventRecord>)
      : {};

  const paidEvents = dividendEventsSnapshot.docs.reduce<Record<string, DividendSnapshotEventRecord>>(
    (acc, docSnap) => {
      const data = docSnap.data();
      if (
        !['fixed', 'paid'].includes(String(data.status || '')) ||
        typeof data.totalAmount !== 'number'
      ) {
        return acc;
      }

      const paymentDate = data.paymentDate as string | undefined;
      if (!paymentDate || !paymentDate.startsWith(`${year}-`)) {
        return acc;
      }

      const eventKey = buildDividendSnapshotEventKey(
        data.stockCode as string,
        paymentDate,
        Number(data.perShareAmount || 0)
      );

      acc[eventKey] = {
        stockCode: data.stockCode as string,
        stockName: (data.stockName as string | undefined) || (data.stockCode as string),
        recordDate: data.recordDate as string | undefined,
        paymentDate,
        perShareAmount: Number(data.perShareAmount || 0),
        quantity: Number(data.eligibleQuantity || 0),
        totalAmount: Number(data.totalAmount || 0),
      };
      return acc;
    },
    {}
  );

  const mergedEvents = {
    ...existingEvents,
    ...paidEvents,
  };

  if (Object.keys(mergedEvents).length === 0) {
    return;
  }

  await snapshotRef.set(
    {
      householdId,
      year,
      monthlyData: buildMonthlyDataFromEvents(mergedEvents),
      events: mergedEvents,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export const dailyDividendSnapshot = functions
  .region(REGION)
  .pubsub.schedule('0 17 * * *')
  .timeZone('Asia/Seoul')
  .onRun(async () => {
    console.log('일일 배당 스냅샷 작업 시작');

    try {
      const today = formatDate(new Date());
      const holdingGroups = await getHoldingGroups();
      const stockMap = new Map<string, { stockCode: string; stockName: string }>();

      holdingGroups.forEach((holding) => {
        if (!stockMap.has(holding.stockCode)) {
          stockMap.set(holding.stockCode, {
            stockCode: holding.stockCode,
            stockName: holding.stockName,
          });
        }
      });

      const dividendEventsByCode = new Map<string, KindDividendEvent[]>();

      for (const stock of stockMap.values()) {
        try {
          const events = await fetchKindEtfDividendEvents(stock.stockCode, stock.stockName);
          if (events.length > 0) {
            dividendEventsByCode.set(stock.stockCode, events);
          }
        } catch (error) {
          console.error(`배당 공시 조회 오류 (${stock.stockCode}):`, error);
        }
      }

      const affectedYearsByHousehold = new Map<string, Set<number>>();

      for (const holding of holdingGroups) {
        const dividendEvents = dividendEventsByCode.get(holding.stockCode) || [];
        if (dividendEvents.length === 0) {
          continue;
        }

        for (const event of dividendEvents) {
          const result = await upsertDividendEvent(holding, event, today);
          if (!result.snapshotYear) {
            continue;
          }

          const years = affectedYearsByHousehold.get(holding.householdId) || new Set<number>();
          years.add(result.snapshotYear);
          affectedYearsByHousehold.set(holding.householdId, years);
        }
      }

      for (const [householdId, years] of affectedYearsByHousehold.entries()) {
        for (const year of years) {
          await rebuildDividendSnapshot(householdId, year);
        }
      }

      console.log('일일 배당 스냅샷 작업 완료');
      return null;
    } catch (error) {
      console.error('일일 배당 스냅샷 작업 오류:', error);
      return null;
    }
  });
