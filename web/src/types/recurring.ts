// 정기 지출 (매월 자동 등록)
export interface RecurringExpense {
  id: string;
  householdId: string;
  merchant: string;           // 가맹점명
  amount: number;             // 금액
  category: string;           // 카테고리 key
  dayOfMonth: number;         // 매월 며칠 (1-31)
  memo?: string;              // 메모 (선택)
  isActive: boolean;          // 활성화 여부
  lastRegisteredMonth?: string; // 마지막 등록된 월 (예: "2024-01") - 중복 방지
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateRecurringExpenseInput {
  merchant: string;
  amount: number;
  category: string;
  dayOfMonth: number;
  memo?: string;
}
