type ModuleLoader = () => Promise<unknown>;

export const loadExpenseDetail = () => import('@/components/expense/ExpenseDetail');
export const loadAddExpenseModal = () => import('@/components/expense/AddExpenseModal');
export const loadIncomeSummaryModal = () => import('@/components/expense/IncomeSummaryModal');
export const loadSearchModal = () => import('@/components/search/SearchModal');
export const loadCategoryDetailModal = () => import('@/components/CategoryDetailModal');
export const loadLocalCurrencyModal = () => import('@/components/LocalCurrencyModal');
export const loadLocalCurrencyBalanceService = () => import('@/lib/balanceService');

export const loadAssetAddModal = () => import('@/components/assets/AssetAddModal');
export const loadAssetEditModal = () => import('@/components/assets/AssetEditModal');
export const loadAssetHistoryModal = () => import('@/components/assets/AssetHistoryModal');
export const loadAssetBalanceChart = () => import('@/components/assets/AssetBalanceChart');
export const loadAssetOwnerProfileModal = () =>
  import('@/components/assets/AssetOwnerProfileModal');

let ledgerPreload: Promise<void> | undefined;
let assetPreload: Promise<void> | undefined;

function preloadModules(loaders: readonly ModuleLoader[]): Promise<void> {
  return Promise.all(loaders.map((load) => load())).then(() => undefined);
}

/**
 * 첫 원장 paint 뒤 즉시 준비하는 사용자 상호작용 코드입니다.
 * 클릭 시점에는 네트워크 chunk나 command facade를 내려받지 않습니다.
 */
export function preloadLedgerInteractions(): Promise<void> {
  ledgerPreload ??= preloadModules([
    loadExpenseDetail,
    loadAddExpenseModal,
    loadIncomeSummaryModal,
    loadSearchModal,
    loadCategoryDetailModal,
    loadLocalCurrencyModal,
    loadLocalCurrencyBalanceService,
    () => import('@/lib/expenseService'),
    () => import('@/lib/merchantRuleService'),
    () => import('@/lib/partnerNotificationService'),
    () => import('@/features/ledger/application/ledgerCommands'),
  ]).catch((error) => {
    ledgerPreload = undefined;
    throw error;
  });
  return ledgerPreload;
}

/**
 * 자산 목록을 보는 동안 계좌/자산 클릭에 필요한 UI를 미리 평가합니다.
 */
export function preloadAssetInteractions(): Promise<void> {
  assetPreload ??= preloadModules([
    loadAssetAddModal,
    loadAssetEditModal,
    loadAssetHistoryModal,
    loadAssetOwnerProfileModal,
  ]).catch((error) => {
    assetPreload = undefined;
    throw error;
  });
  return assetPreload;
}
