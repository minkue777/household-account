import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { db, REGION } from './config';

type AssetType = 'savings' | 'stock' | 'crypto' | 'property' | 'gold' | 'loan';

const ASSET_TYPE_ORDER: AssetType[] = ['savings', 'stock', 'crypto', 'property', 'gold', 'loan'];
const NATIONAL_GROWTH_FUND_CODE = 'FUND:K55301EW0012';
const NATIONAL_GROWTH_FUND_PRICE_URL =
  'https://investments.miraeasset.com/magi/fund/basePrices.do?fundGb=2&fundCd=539502&period=1M';

function getSeoulDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseLatestFundNav(html: string): number | null {
  const asOfDate = getSeoulDate();
  const quotes: Array<{ date: string; nav: number }> = [];
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
    const dateMatch = cells[0]?.match(/^(\d{4})[.-](\d{2})[.-](\d{2})$/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
    const nav = cells[1] ? Number(cells[1].replace(/,/g, '')) : NaN;

    if (date && date <= asOfDate && Number.isFinite(nav) && nav > 0) {
      quotes.push({ date, nav });
    }
  }

  quotes.sort((a, b) => b.date.localeCompare(a.date));
  return quotes[0]?.nav ?? null;
}

async function fetchNationalGrowthFundNav(): Promise<number | null> {
  try {
    const response = await fetch(NATIONAL_GROWTH_FUND_PRICE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HouseholdAccount/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return null;
    }

    return parseLatestFundNav(await response.text());
  } catch (error) {
    console.error('국민성장펀드 기준가 조회 오류:', error);
    return null;
  }
}

async function fetchStockPrice(code: string): Promise<number | null> {
  if (code === NATIONAL_GROWTH_FUND_CODE) {
    return fetchNationalGrowthFundNav();
  }

  try {
    const response = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { closePrice: string };
    return parseInt(data.closePrice.replace(/,/g, ''), 10);
  } catch (error) {
    console.error(`주가 조회 오류 (${code}):`, error);
    return null;
  }
}

function getSignedBalance(assetData: FirebaseFirestore.DocumentData): number {
  const rawBalance = assetData.currentBalance || 0;
  return assetData.type === 'loan' ? -Math.abs(rawBalance) : rawBalance;
}

function getSnapshotDocId(householdId: string, suffix: string, date: string): string {
  return `${householdId}_${suffix}_${date}`;
}

async function getPreviousBalance(
  householdId: string,
  assetId: string,
  today: string
): Promise<number> {
  const snapshot = await db.collection('asset_history')
    .where('householdId', '==', householdId)
    .where('assetId', '==', assetId)
    .where('date', '<', today)
    .orderBy('date', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    return 0;
  }

  return snapshot.docs[0].data().balance || 0;
}

export const dailyAssetSnapshot = functions
  .region(REGION)
  .pubsub.schedule('55 23 * * *')
  .timeZone('Asia/Seoul')
  .onRun(async () => {
    console.log('일일 자산 스냅샷 저장 시작');

    try {
      const assetsSnapshot = await db.collection('assets').get();
      const householdIds = new Set<string>();

      assetsSnapshot.docs.forEach((doc) => {
        const householdId = doc.data().householdId;
        if (householdId) {
          householdIds.add(householdId);
        }
      });

      const today = new Date().toISOString().split('T')[0];
      console.log(`처리할 가구 수: ${householdIds.size}`);

      for (const householdId of householdIds) {
        try {
          console.log(`가구 처리 시작: ${householdId}`);

          const holdingsSnapshot = await db.collection('stock_holdings')
            .where('householdId', '==', householdId)
            .get();

          const holdingsByCode: Record<string, Array<{
            id: string;
            assetId: string;
              quantity: number;
              avgPrice: number;
              priceScale: number;
          }>> = {};

          holdingsSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            const code = data.stockCode;

            if (!code) {
              return;
            }

            if (!holdingsByCode[code]) {
              holdingsByCode[code] = [];
            }

            holdingsByCode[code].push({
              id: doc.id,
              assetId: data.assetId,
              quantity: data.quantity || 0,
              avgPrice: data.avgPrice || 0,
              priceScale: data.priceScale || 1,
            });
          });

          const updatedAssetIds = new Set<string>();

          for (const [code, holdings] of Object.entries(holdingsByCode)) {
            const price = await fetchStockPrice(code);

            if (price === null) {
              continue;
            }

            for (const holding of holdings) {
              await db.collection('stock_holdings').doc(holding.id).update({
                currentPrice: price,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              updatedAssetIds.add(holding.assetId);
            }
          }

          for (const assetId of updatedAssetIds) {
            const assetHoldings = await db.collection('stock_holdings')
              .where('householdId', '==', householdId)
              .where('assetId', '==', assetId)
              .get();

            let totalValue = 0;
            let totalCostBasis = 0;

            assetHoldings.docs.forEach((doc) => {
              const data = doc.data();
              const quantity = data.quantity || 0;
              const avgPrice = data.avgPrice || 0;
              const currentPrice = data.currentPrice || avgPrice;
              const priceScale = data.priceScale || 1;

              totalValue += (currentPrice * quantity) / priceScale;
              totalCostBasis += (avgPrice * quantity) / priceScale;
            });

            await db.collection('assets').doc(assetId).update({
              currentBalance: totalValue,
              costBasis: totalCostBasis,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          const allAssetsSnapshot = await db.collection('assets')
            .where('householdId', '==', householdId)
            .where('isActive', '==', true)
            .get();

          let totalBalance = 0;
          let financialBalance = 0;
          const ownerTotals: Record<string, number> = {};
          const typeTotals = ASSET_TYPE_ORDER.reduce<Record<AssetType, number>>((acc, type) => {
            acc[type] = 0;
            return acc;
          }, {} as Record<AssetType, number>);

          allAssetsSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            const balance = getSignedBalance(data);
            const type = data.type as AssetType;
            const owner = data.owner as string | undefined;

            totalBalance += balance;

            if (type !== 'property' && type !== 'loan') {
              financialBalance += balance;
            }

            if (ASSET_TYPE_ORDER.includes(type)) {
              typeTotals[type] += balance;
            }

            if (owner) {
              ownerTotals[owner] = (ownerTotals[owner] || 0) + balance;
            }
          });

          const snapshotTargets: Array<{
            assetId: string;
            suffix: string;
            balance: number;
          }> = [
            { assetId: 'TOTAL', suffix: 'total', balance: totalBalance },
            { assetId: 'FINANCIAL', suffix: 'financial', balance: financialBalance },
            ...Object.entries(ownerTotals).map(([owner, balance]) => ({
              assetId: `OWNER_${owner}`,
              suffix: `owner_${encodeURIComponent(owner)}`,
              balance,
            })),
            ...ASSET_TYPE_ORDER.map((type) => ({
              assetId: `TYPE_${type}`,
              suffix: `type_${type}`,
              balance: typeTotals[type],
            })),
          ];

          const previousBalances = await Promise.all(
            snapshotTargets.map(async ({ assetId }) => [assetId, await getPreviousBalance(householdId, assetId, today)] as const)
          );
          const previousBalanceMap = new Map(previousBalances);

          const docRefs = snapshotTargets.map(({ suffix }) =>
            db.collection('asset_history').doc(getSnapshotDocId(householdId, suffix, today))
          );
          const existingDocs = await Promise.all(docRefs.map((docRef) => docRef.get()));

          const batch = db.batch();

          snapshotTargets.forEach((target, index) => {
            const docRef = docRefs[index];
            const existingDoc = existingDocs[index];
            const previousBalance = previousBalanceMap.get(target.assetId) || 0;

            batch.set(docRef, {
              householdId,
              assetId: target.assetId,
              balance: target.balance,
              date: today,
              changeAmount: target.balance - previousBalance,
              memo: '자동 기록',
              createdAt: existingDoc.exists
                ? existingDoc.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
                : admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          });

          await batch.commit();

          console.log(
            `가구 ${householdId} 저장 완료: TOTAL=${totalBalance}, FINANCIAL=${financialBalance}, OWNER=${Object.keys(ownerTotals).length}, TYPE=${ASSET_TYPE_ORDER.length}`
          );
        } catch (error) {
          console.error(`가구 ${householdId} 처리 오류:`, error);
        }
      }

      console.log('일일 자산 스냅샷 저장 완료');
      return null;
    } catch (error) {
      console.error('일일 자산 스냅샷 전체 오류:', error);
      return null;
    }
  });
