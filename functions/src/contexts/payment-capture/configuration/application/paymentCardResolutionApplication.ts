import type {
  PaymentCardResolutionInputPort,
  PaymentCardResolutionResult,
  ResolvePaymentCardInput,
} from "./ports/in/paymentCardResolutionInputPort";
import type { PaymentCardLookupPort } from "./ports/out/paymentCardLookupPort";
import { resolveOwnCard } from "../domain/policies/ownCardResolution";

export interface PaymentCardResolutionDependencies {
  readonly cards: PaymentCardLookupPort;
}

class DefaultPaymentCardResolutionApplication
  implements PaymentCardResolutionInputPort
{
  constructor(private readonly dependencies: PaymentCardResolutionDependencies) {}

  async resolve(
    input: ResolvePaymentCardInput,
  ): Promise<PaymentCardResolutionResult> {
    if (input.sourceKind === "city-gas") {
      return { kind: "Bypassed", reason: "CITY_GAS" };
    }

    const lookup = await this.dependencies.cards.findForMember(
      input.actingMemberId,
    );
    if (lookup.kind === "Unavailable") {
      return { kind: "RetryableFailure", code: lookup.code };
    }

    const resolution = resolveOwnCard({
      actingMemberId: input.actingMemberId,
      evidence: input.parsedEvidence,
      cards: lookup.cards.map((card) => ({
        cardId: card.cardId,
        ownerMemberId: card.ownerMemberId,
        cardCompany: card.companyLabel,
        lastFour: card.lastFour ?? "",
        lifecycleState: card.lifecycle,
      })),
    });
    if (resolution.kind === "unmatched") {
      return {
        kind: "Unmatched",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      };
    }
    return {
      kind: "Eligible",
      ...(resolution.canonicalEvidence === undefined
        ? {}
        : { canonicalCardId: resolution.canonicalEvidence.cardId }),
    };
  }
}

export function createPaymentCardResolutionApplication(
  dependencies: PaymentCardResolutionDependencies,
): PaymentCardResolutionInputPort {
  return new DefaultPaymentCardResolutionApplication(dependencies);
}
