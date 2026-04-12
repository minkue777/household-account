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
const ASSET_TYPE_ORDER = ['savings', 'stock', 'crypto', 'property', 'gold', 'loan'];
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
function getSignedBalance(assetData) {
    const rawBalance = assetData.currentBalance || 0;
    return assetData.type === 'loan' ? -Math.abs(rawBalance) : rawBalance;
}
function getSnapshotDocId(householdId, suffix, date) {
    return `${householdId}_${suffix}_${date}`;
}
async function getPreviousBalance(householdId, assetId, today) {
    const snapshot = await config_1.db.collection('asset_history')
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
exports.dailyAssetSnapshot = functions
    .region(config_1.REGION)
    .pubsub.schedule('55 23 * * *')
    .timeZone('Asia/Seoul')
    .onRun(async () => {
    console.log('일일 자산 스냅샷 저장 시작');
    try {
        const assetsSnapshot = await config_1.db.collection('assets').get();
        const householdIds = new Set();
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
                const holdingsSnapshot = await config_1.db.collection('stock_holdings')
                    .where('householdId', '==', householdId)
                    .get();
                const holdingsByCode = {};
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
                    });
                });
                const updatedAssetIds = new Set();
                for (const [code, holdings] of Object.entries(holdingsByCode)) {
                    const price = await fetchStockPrice(code);
                    if (price === null) {
                        continue;
                    }
                    for (const holding of holdings) {
                        await config_1.db.collection('stock_holdings').doc(holding.id).update({
                            currentPrice: price,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        });
                        updatedAssetIds.add(holding.assetId);
                    }
                }
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
                const allAssetsSnapshot = await config_1.db.collection('assets')
                    .where('householdId', '==', householdId)
                    .where('isActive', '==', true)
                    .get();
                let totalBalance = 0;
                let financialBalance = 0;
                const ownerTotals = {};
                const typeTotals = ASSET_TYPE_ORDER.reduce((acc, type) => {
                    acc[type] = 0;
                    return acc;
                }, {});
                allAssetsSnapshot.docs.forEach((doc) => {
                    const data = doc.data();
                    const balance = getSignedBalance(data);
                    const type = data.type;
                    const owner = data.owner;
                    totalBalance += balance;
                    if (type !== 'property') {
                        financialBalance += balance;
                    }
                    if (ASSET_TYPE_ORDER.includes(type)) {
                        typeTotals[type] += balance;
                    }
                    if (owner) {
                        ownerTotals[owner] = (ownerTotals[owner] || 0) + balance;
                    }
                });
                const snapshotTargets = [
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
                const previousBalances = await Promise.all(snapshotTargets.map(async ({ assetId }) => [assetId, await getPreviousBalance(householdId, assetId, today)]));
                const previousBalanceMap = new Map(previousBalances);
                const docRefs = snapshotTargets.map(({ suffix }) => config_1.db.collection('asset_history').doc(getSnapshotDocId(householdId, suffix, today)));
                const existingDocs = await Promise.all(docRefs.map((docRef) => docRef.get()));
                const batch = config_1.db.batch();
                snapshotTargets.forEach((target, index) => {
                    var _a;
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
                            ? ((_a = existingDoc.data()) === null || _a === void 0 ? void 0 : _a.createdAt) || admin.firestore.FieldValue.serverTimestamp()
                            : admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                });
                await batch.commit();
                console.log(`가구 ${householdId} 저장 완료: TOTAL=${totalBalance}, FINANCIAL=${financialBalance}, OWNER=${Object.keys(ownerTotals).length}, TYPE=${ASSET_TYPE_ORDER.length}`);
            }
            catch (error) {
                console.error(`가구 ${householdId} 처리 오류:`, error);
            }
        }
        console.log('일일 자산 스냅샷 저장 완료');
        return null;
    }
    catch (error) {
        console.error('일일 자산 스냅샷 전체 오류:', error);
        return null;
    }
});
//# sourceMappingURL=assets.js.map