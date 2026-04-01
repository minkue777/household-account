import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { db, REGION } from './config';

/**
 * 네이버 금융 API로 주식 시세 조회
 */
async function fetchStockPrice(code: string): Promise<number | null> {
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

/**
 * 매일 오후 4시(KST)에 자산 스냅샷 저장
 * - 주식 현재가 갱신
 * - 계좌별 총액 계산
 * - asset_history에 일별 스냅샷 저장
 */
export const dailyAssetSnapshot = functions
  .region(REGION)
  .pubsub.schedule('0 16 * * *')
  .timeZone('Asia/Seoul')
  .onRun(async () => {
    console.log('일별 자산 스냅샷 시작');

    try {
      // 1. 모든 householdId 조회 (assets 컬렉션에서)
      const assetsSnapshot = await db.collection('assets').get();
      const householdIds = new Set<string>();
      assetsSnapshot.docs.forEach((doc) => {
        const householdId = doc.data().householdId;
        if (householdId) {
          householdIds.add(householdId);
        }
      });

      console.log(`처리할 가구 수: ${householdIds.size}`);

      const today = new Date().toISOString().split('T')[0];

      // 2. 각 household별로 처리
      for (const householdId of householdIds) {
        try {
          console.log(`가구 처리 중: ${householdId}`);

          // 2-1. 해당 가구의 보유 종목 조회
          const holdingsSnapshot = await db.collection('stock_holdings')
            .where('householdId', '==', householdId)
            .get();

          // 종목코드별로 그룹화
          const holdingsByCode: Record<string, { id: string; assetId: string; quantity: number; avgPrice: number }[]> = {};
          holdingsSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            const code = data.stockCode;
            if (code) {
              if (!holdingsByCode[code]) {
                holdingsByCode[code] = [];
              }
              holdingsByCode[code].push({
                id: doc.id,
                assetId: data.assetId,
                quantity: data.quantity || 0,
                avgPrice: data.avgPrice || 0,
              });
            }
          });

          // 2-2. 주가 조회 및 보유종목 업데이트
          const updatedAssetIds = new Set<string>();

          for (const [code, holdings] of Object.entries(holdingsByCode)) {
            const price = await fetchStockPrice(code);
            if (price === null) continue;

            for (const holding of holdings) {
              await db.collection('stock_holdings').doc(holding.id).update({
                currentPrice: price,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              updatedAssetIds.add(holding.assetId);
            }
          }

          // 2-3. 업데이트된 자산(계좌)의 총액 재계산
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

              totalValue += currentPrice * quantity;
              totalCostBasis += avgPrice * quantity;
            });

            await db.collection('assets').doc(assetId).update({
              currentBalance: totalValue,
              costBasis: totalCostBasis,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          // 2-4. 전체 자산 합계 계산
          const allAssetsSnapshot = await db.collection('assets')
            .where('householdId', '==', householdId)
            .where('isActive', '==', true)
            .get();

          let totalBalance = 0;
          let financialBalance = 0;
          const ownerTotals: Record<string, number> = {};

          allAssetsSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            const rawBalance = data.currentBalance || 0;
            const balance = data.type === 'loan' ? -Math.abs(rawBalance) : rawBalance;
            totalBalance += balance;

            // 금융자산 (부동산 제외)
            if (data.type !== 'property') {
              financialBalance += balance;
            }

            if (typeof data.owner === 'string' && data.owner) {
              ownerTotals[data.owner] = (ownerTotals[data.owner] || 0) + balance;
            }
          });

          // 2-5. 이전 스냅샷 조회 (previousBalance 계산용)
          const getPreviousBalance = async (assetId: string): Promise<number> => {
            const q = await db.collection('asset_history')
              .where('householdId', '==', householdId)
              .where('assetId', '==', assetId)
              .where('date', '<', today)
              .orderBy('date', 'desc')
              .limit(1)
              .get();

            if (q.empty) return 0;
            return q.docs[0].data().balance || 0;
          };

          const prevTotal = await getPreviousBalance('TOTAL');
          const prevFinancial = await getPreviousBalance('FINANCIAL');
          const prevOwnerTotals = await Promise.all(
            Object.keys(ownerTotals).map(async (owner) => [
              owner,
              await getPreviousBalance(`OWNER_${owner}`),
            ] as const)
          );

          // 2-6. 스냅샷 저장
          const saveSnapshot = async (
            assetId: string,
            suffix: string,
            balance: number,
            prevBalance: number
          ) => {
            const snapshotId = `${householdId}_${suffix}_${today}`;
            const existingSnap = await db.collection('asset_history').doc(snapshotId).get();

            const snapshotData = {
              householdId,
              assetId,
              balance,
              date: today,
              changeAmount: balance - prevBalance,
              memo: '자동 기록',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            if (existingSnap.exists) {
              await db.collection('asset_history').doc(snapshotId).update(snapshotData);
            } else {
              await db.collection('asset_history').doc(snapshotId).set({
                ...snapshotData,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          };

          await saveSnapshot('TOTAL', 'total', totalBalance, prevTotal);
          await saveSnapshot('FINANCIAL', 'financial', financialBalance, prevFinancial);
          await Promise.all(
            prevOwnerTotals.map(([owner, prevBalance]) =>
              saveSnapshot(`OWNER_${owner}`, `owner_${encodeURIComponent(owner)}`, ownerTotals[owner], prevBalance)
            )
          );

          console.log(`가구 ${householdId} 완료: 총자산=${totalBalance}, 금융=${financialBalance}`);
        } catch (error) {
          console.error(`가구 ${householdId} 처리 오류:`, error);
        }
      }

      console.log('일별 자산 스냅샷 완료');
      return null;
    } catch (error) {
      console.error('일별 자산 스냅샷 오류:', error);
      return null;
    }
  });
