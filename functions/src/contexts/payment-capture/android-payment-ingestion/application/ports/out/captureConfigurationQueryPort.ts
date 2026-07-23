import type { MerchantRuleCandidate } from "../../../../configuration/public";

export interface CaptureConfigurationCard {
  readonly cardId: string;
  readonly ownerMemberId: string;
  readonly companyLabel: string;
  readonly lastFour?: string;
  readonly lifecycleState: "active" | "retired";
}

export interface CaptureConfigurationSnapshot {
  readonly cards: readonly CaptureConfigurationCard[];
  readonly merchantRules: readonly MerchantRuleCandidate[];
  readonly activeCategoryIds: ReadonlySet<string>;
  readonly defaultCategoryId?: string;
}

export type CaptureConfigurationQueryResult =
  | { readonly kind: "available"; readonly value: CaptureConfigurationSnapshot }
  | {
      readonly kind: "retryable-failure";
      readonly code: "PAYMENT_CONFIGURATION_UNAVAILABLE";
    };

export interface CaptureConfigurationQueryPort {
  load(input: {
    readonly householdId: string;
    readonly actingMemberId: string;
  }): Promise<CaptureConfigurationQueryResult>;
}

/**
 * 실제 사용 시점보다 조금 먼저 설정 조회를 시작해 서로 독립적인 receipt
 * 확인과 겹쳐 실행합니다. 결과의 권위와 오류 처리는 QueryPort.load가 담당합니다.
 */
export interface CaptureConfigurationPrefetchPort {
  prefetch(input: {
    readonly householdId: string;
    readonly actingMemberId: string;
  }): void;
}
