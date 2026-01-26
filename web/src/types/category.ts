export interface CategoryDocument {
  id: string;
  key: string;           // 'living', 'custom_001' 등
  label: string;         // '생활비', '취미' 등
  color: string;         // '#4ADE80'
  budget: number | null; // 월 예산 (null이면 무제한)
  order: number;         // 정렬 순서
  isDefault: boolean;    // 기본 카테고리 여부 (참고용)
  isActive: boolean;     // 활성화 여부
  householdId: string;   // 가구 ID
}
