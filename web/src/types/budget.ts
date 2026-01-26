export interface BudgetTransfer {
  id: string;
  householdId: string;    // 가구 ID
  yearMonth: string;      // "2026-01"
  fromCategory: string;   // 예산을 빼는 카테고리
  toCategory: string;     // 예산을 받는 카테고리
  amount: number;         // 이동 금액
  memo?: string;          // 메모
  createdAt: Date;
}
