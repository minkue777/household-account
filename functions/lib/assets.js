"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyAssetSnapshot = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const config_1 = require("./config");
/**
 * 네이버 금융 API로 주식 시세 조회
 */
async function fetchStockPrice(code) {
    try {
        const response = await (0, node_fetch_1.default)(`https://m.stock.naver.com/api/stock/${code}/basic`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        return parseInt(data.closePrice.replace(/,/g, ''), 10);
    }
    catch (error) {
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
exports.dailyAssetSnapshot = functions
    .region(config_1.REGION)
    .pubsub.schedule('0 16 * * *')
    .timeZone('Asia/Seoul')
    .onRun(async () => {
    console.log('일별 자산 스냅샷 시작');
    try {
        // 1. 모든 householdId 조회 (assets 컬렉션에서)
        const assetsSnapshot = await config_1.db.collection('assets').get();
        const householdIds = new Set();
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
                const holdingsSnapshot = await config_1.db.collection('stock_holdings')
                    .where('householdId', '==', householdId)
                    .get();
                // 종목코드별로 그룹화
                const holdingsByCode = {};
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
                const updatedAssetIds = new Set();
                for (const [code, holdings] of Object.entries(holdingsByCode)) {
                    const price = await fetchStockPrice(code);
                    if (price === null)
                        continue;
                    for (const holding of holdings) {
                        await config_1.db.collection('stock_holdings').doc(holding.id).update({
                            currentPrice: price,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        });
                        updatedAssetIds.add(holding.assetId);
                    }
                }
                // 2-3. 업데이트된 자산(계좌)의 총액 재계산
                for (const assetId of updatedAssetIds) {
                    const assetHoldings = await config_1.db.collection('stock_holdings')
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
                    await config_1.db.collection('assets').doc(assetId).update({
                        currentBalance: totalValue,
                        costBasis: totalCostBasis,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                // 2-4. 전체 자산 합계 계산
                const allAssetsSnapshot = await config_1.db.collection('assets')
                    .where('householdId', '==', householdId)
                    .where('isActive', '==', true)
                    .get();
                let totalBalance = 0;
                let financialBalance = 0;
                allAssetsSnapshot.docs.forEach((doc) => {
                    const data = doc.data();
                    const balance = data.currentBalance || 0;
                    totalBalance += balance;
                    // 금융자산 (부동산 제외)
                    if (data.type !== 'property') {
                        financialBalance += balance;
                    }
                });
                // 2-5. 이전 스냅샷 조회 (previousBalance 계산용)
                const getPreviousBalance = async (assetId) => {
                    const q = await config_1.db.collection('asset_history')
                        .where('householdId', '==', householdId)
                        .where('assetId', '==', assetId)
                        .where('date', '<', today)
                        .orderBy('date', 'desc')
                        .limit(1)
                        .get();
                    if (q.empty)
                        return 0;
                    return q.docs[0].data().balance || 0;
                };
                const prevTotal = await getPreviousBalance('TOTAL');
                const prevFinancial = await getPreviousBalance('FINANCIAL');
                // 2-6. 스냅샷 저장
                const saveSnapshot = async (assetId, suffix, balance, prevBalance) => {
                    const snapshotId = `${householdId}_${suffix}_${today}`;
                    const existingSnap = await config_1.db.collection('asset_history').doc(snapshotId).get();
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
                        await config_1.db.collection('asset_history').doc(snapshotId).update(snapshotData);
                    }
                    else {
                        await config_1.db.collection('asset_history').doc(snapshotId).set(Object.assign(Object.assign({}, snapshotData), { createdAt: admin.firestore.FieldValue.serverTimestamp() }));
                    }
                };
                await saveSnapshot('TOTAL', 'total', totalBalance, prevTotal);
                await saveSnapshot('FINANCIAL', 'financial', financialBalance, prevFinancial);
                console.log(`가구 ${householdId} 완료: 총자산=${totalBalance}, 금융=${financialBalance}`);
            }
            catch (error) {
                console.error(`가구 ${householdId} 처리 오류:`, error);
            }
        }
        console.log('일별 자산 스냅샷 완료');
        return null;
    }
    catch (error) {
        console.error('일별 자산 스냅샷 오류:', error);
        return null;
    }
});
//# sourceMappingURL=assets.js.map