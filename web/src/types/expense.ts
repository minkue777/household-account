// 카테고리 타입 - 이제 동적으로 관리됨
export type Category = string;

export interface Expense {
  id: string;
  date: string;           // YYYY-MM-DD
  merchant: string;       // 가맹점명
  amount: number;         // 금액
  category: Category;     // 카테고리 (동적)
  cardType: 'main' | 'family';  // 본인 카드 / 가족 카드
  memo?: string;          // 메모 (선택)
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

// 하위 호환성을 위해 유지 (deprecated - CategoryContext 사용 권장)
// @deprecated CategoryContext의 categoryLabels 사용
export const CATEGORY_LABELS: Record<string, string> = {
  living: '생활비',
  childcare: '육아비',
  fixed: '고정비',
  food: '식비',
  etc: '기타',
};

// @deprecated CategoryContext의 categoryColors 사용
export const CATEGORY_COLORS: Record<string, string> = {
  living: '#4ADE80',
  childcare: '#F472B6',
  fixed: '#60A5FA',
  food: '#FBBF24',
  etc: '#9CA3AF',
};
