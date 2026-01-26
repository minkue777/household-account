// 매칭 타입: 가맹점명을 어떻게 매칭할지 결정
// 키워드에 쉼표가 있으면 OR 조건으로 처리됨
export type MatchType = 'exact' | 'contains' | 'startsWith' | 'endsWith';

// 규칙이 매칭되면 적용할 값들
export interface MerchantRuleMapping {
  merchant?: string;   // 매핑할 가맹점명 (예: "효성에프엠에스" -> "어린이집 식판")
  category?: string;   // 매핑할 카테고리
  memo?: string;       // 매핑할 메모
}

export interface MerchantRule {
  id: string;
  householdId: string;

  // 매칭 조건
  merchantKeyword: string;  // 매칭할 키워드/패턴
  matchType: MatchType;     // 매칭 방식

  // 매핑 결과 (규칙이 매칭되면 이 값들로 대체)
  mapping: MerchantRuleMapping;

  // 메타데이터
  priority?: number;        // 우선순위 (높을수록 먼저 적용, 기본값 0)
  isActive?: boolean;       // 규칙 활성화 여부 (기본값 true)
  createdAt?: Date;
  updatedAt?: Date;

  // 하위 호환성을 위한 deprecated 필드
  /** @deprecated Use mapping.category instead */
  category?: string;
  /** @deprecated Use matchType instead */
  exactMatch?: boolean;
}

// 규칙 생성 시 사용하는 입력 타입
export interface CreateMerchantRuleInput {
  merchantKeyword: string;
  matchType: MatchType;
  mapping: MerchantRuleMapping;
  priority?: number;
}

// 가맹점명에 규칙을 적용한 결과
export interface AppliedRule {
  rule: MerchantRule;
  mappedValues: {
    merchant: string;
    category: string;
    memo: string;
  };
}

// 매칭 타입별 설명 (UI용)
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  exact: '일치',
  contains: '포함',
  startsWith: '시작',
  endsWith: '종료',
};

// 매칭 타입별 설명 상세 (UI용)
export const MATCH_TYPE_DESCRIPTIONS: Record<MatchType, string> = {
  exact: '가맹점명이 정확히 일치할 때',
  contains: '가맹점명에 키워드가 포함될 때',
  startsWith: '가맹점명이 키워드로 시작할 때',
  endsWith: '가맹점명이 키워드로 끝날 때',
};
