// 카테고리 타입 - 이제 동적으로 관리됨
export type Category = string;
export type TransactionType = 'expense' | 'income';

// 합쳐진 지출의 원본 정보
export interface MergedExpenseInfo {
  merchant: string;
  amount: number;
  category: string;
  memo?: string;
}

export interface Expense {
  id: string;
  aggregateVersion: number;
  date: string;           // YYYY-MM-DD
  time?: string;          // HH:mm
  merchant: string;       // 가맹점명
  amount: number;         // 금액
  transactionType?: TransactionType;
  category: Category;     // 카테고리 (동적)
  cardType?: string;  // 'manual' | 'captured' | 'local_currency' | legacy type
  cardLastFour?: string;  // 기존 UI 호환용 카드 표시 문자열(예: 수동, 삼성(1840))
  memo?: string;          // 메모 (선택)
  mergedFrom?: MergedExpenseInfo[];  // 합쳐진 원본 지출들 (되돌리기용)
  mergeLeafIds?: string[]; // 서버가 보존한 합치기 원본 aggregate ID
  splitGroupId?: string;  // 월별 분할 그룹 ID (같은 ID면 같은 분할 그룹)
  splitOriginalId?: string; // 월 분할 취소 시 복구되는 원본 거래 ID
  splitIndex?: number;    // 분할 순서 (1, 2, 3...)
  splitTotal?: number;    // 총 분할 개월 수
}

export interface DailyExpenses {
  date: string;
  expenses: Expense[];
  total: number;
}

export interface CategorySummary {
  category: Category;
  total: number;
  count: number;
}

export interface MonthlySummary {
  year: number;
  month: number;
  totalAmount: number;
  categoryBreakdown: CategorySummary[];
  dailyExpenses: Map<string, DailyExpenses>;
}
