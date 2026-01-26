// 카테고리 타입 - 이제 동적으로 관리됨
export type Category = string;

// 합쳐진 지출의 원본 정보
export interface MergedExpenseInfo {
  merchant: string;
  amount: number;
  category: string;
  memo?: string;
}

export interface Expense {
  id: string;
  date: string;           // YYYY-MM-DD
  time?: string;          // HH:mm
  merchant: string;       // 가맹점명
  amount: number;         // 금액
  category: Category;     // 카테고리 (동적)
  cardType: 'main' | 'family';  // 본인 카드 / 가족 카드
  cardLastFour?: string;  // 카드 마지막 4자리
  memo?: string;          // 메모 (선택)
  mergedFrom?: MergedExpenseInfo[];  // 합쳐진 원본 지출들 (되돌리기용)
  splitGroupId?: string;  // 월별 분할 그룹 ID (같은 ID면 같은 분할 그룹)
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

