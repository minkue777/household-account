import { createPaymentCardResolutionApplication } from "../../src/contexts/payment-capture/configuration/application/paymentCardResolutionApplication";
import type {
  PaymentCardLookupPort,
  PaymentCardLookupResult,
  PaymentCardRecord,
} from "../../src/contexts/payment-capture/configuration/application/ports/out/paymentCardLookupPort";
import type { PaymentCardResolutionInputPort } from "../../src/contexts/payment-capture/configuration/public";

export type {
  PaymentCardResolutionInputPort,
  PaymentCardResolutionResult,
  ResolvePaymentCardInput,
} from "../../src/contexts/payment-capture/configuration/public";

export type CardResolutionRecord = PaymentCardRecord;
export type CardResolutionLookup = PaymentCardLookupResult;

export interface CardResolutionBoundaryState {
  readonly lookupAttempts: number;
}

export interface CardResolutionBoundaryDriver
  extends PaymentCardResolutionInputPort {
  state(): CardResolutionBoundaryState;
}

class FixturePaymentCardLookup implements PaymentCardLookupPort {
  private attempts = 0;

  constructor(private readonly result: PaymentCardLookupResult) {}

  async findForMember(
    _actingMemberId: string,
  ): Promise<PaymentCardLookupResult> {
    this.attempts += 1;
    return this.result.kind === "Unavailable"
      ? { ...this.result }
      : {
          kind: "Available",
          cards: this.result.cards.map((card) => ({ ...card })),
        };
  }

  attemptCount(): number {
    return this.attempts;
  }
}

export function createCardResolutionBoundaryDriver(
  lookup: PaymentCardLookupResult,
): CardResolutionBoundaryDriver {
  const cards = new FixturePaymentCardLookup(lookup);
  const application = createPaymentCardResolutionApplication({ cards });
  return {
    resolve: (input) => application.resolve(input),
    state: () => ({ lookupAttempts: cards.attemptCount() }),
  };
}
