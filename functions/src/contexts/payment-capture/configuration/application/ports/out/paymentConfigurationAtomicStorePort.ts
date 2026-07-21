import type {
  MerchantRuleCommandResult,
  MerchantRuleCommandState,
} from "../in/merchantRuleCommandInputPort";
import type {
  RegisteredCardCommandResult,
  RegisteredCardCommandState,
} from "../in/registeredCardCommandBoundaryInputPort";

export interface AtomicPaymentConfigurationMutation<State, Result> {
  readonly state: State;
  readonly value: Result;
  readonly writes: boolean;
}

export type PaymentConfigurationAtomicResult<Result> =
  | { readonly kind: "committed" | "replayed"; readonly value: Result }
  | { readonly kind: "payload-mismatch" }
  | { readonly kind: "commit-failed" };

export interface PaymentConfigurationCommandMetadata {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly commandName: string;
  readonly payloadFingerprint: string;
  readonly householdId: string;
  readonly actorMemberId: string;
  readonly occurredAt: string;
}

/**
 * Firestore transaction을 Application 안으로 누출하지 않는 비동기 Unit of Work입니다.
 * Adapter는 canonical/legacy snapshot을 하나의 상태로 읽고 callback의 순수 결정을
 * claim·본문·collection version·receipt와 함께 원자 반영합니다.
 */
export interface PaymentConfigurationAtomicStorePort {
  transactMerchantRules(
    metadata: PaymentConfigurationCommandMetadata,
    decide: (
      current: MerchantRuleCommandState,
    ) => AtomicPaymentConfigurationMutation<
      MerchantRuleCommandState,
      MerchantRuleCommandResult
    >,
  ): Promise<PaymentConfigurationAtomicResult<MerchantRuleCommandResult>>;

  transactRegisteredCards(
    metadata: PaymentConfigurationCommandMetadata,
    decide: (
      current: RegisteredCardCommandState,
    ) => AtomicPaymentConfigurationMutation<
      RegisteredCardCommandState,
      RegisteredCardCommandResult
    >,
  ): Promise<PaymentConfigurationAtomicResult<RegisteredCardCommandResult>>;
}
