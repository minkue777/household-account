import { createRegisteredCardManagementApplication } from "../../src/contexts/payment-capture/configuration/application/registeredCardManagementApplication";
import type {
  RegisteredCardIdPort,
  RegisteredCardRegistryMutation,
  RegisteredCardRegistryStorePort,
} from "../../src/contexts/payment-capture/configuration/application/ports/out/registeredCardRegistryStorePort";
import type {
  RegisteredCard,
  RegisteredCardClaim,
  RegisteredCardRegistry,
} from "../../src/contexts/payment-capture/configuration/domain/model/registeredCardRegistry";
import { registeredCardClaimKey } from "../../src/contexts/payment-capture/configuration/domain/policies/registeredCardIdentity";
import type {
  RegisterCardCommand,
  RegisterCardResult,
  RegisteredCardActor,
  RegisteredCardManagementInputPort,
  RegisteredCardView,
  ResolveRegisteredCardResult,
  RetireCardResult,
  RetireRegisteredCardCommand,
  UpdateCardResult,
  UpdateRegisteredCardCommand,
} from "../../src/contexts/payment-capture/configuration/public";

export interface RegisteredCardClaimView {
  readonly ownerMemberId: string;
  readonly cardCompany: string;
  readonly lastFour: string;
  readonly cardId: string;
}

export interface HistoricalCardEvidence {
  readonly transactionId: string;
  readonly cardId: string;
  readonly cardCompany: string;
  readonly lastFour: string;
}

export interface RegisteredCardRegistryState {
  readonly cardRecords: readonly RegisteredCardView[];
  readonly activeClaims: readonly RegisteredCardClaimView[];
  readonly historicalCaptureEvidence: readonly HistoricalCardEvidence[];
}

export interface RegisteredCardManagementFixture {
  readonly cards?: readonly RegisteredCardView[];
  readonly historicalCaptureEvidence?: readonly HistoricalCardEvidence[];
}

export interface RegisteredCardManagementDriver
  extends RegisteredCardManagementInputPort {
  registerConcurrently(
    inputs: readonly RegisterCardCommand[],
  ): Promise<readonly RegisterCardResult[]>;
  state(): RegisteredCardRegistryState;
}

function cloneCard(card: RegisteredCard): RegisteredCard {
  return { ...card };
}

function cloneClaim(claim: RegisteredCardClaim): RegisteredCardClaim {
  return { ...claim };
}

function cloneRegistry(registry: RegisteredCardRegistry): RegisteredCardRegistry {
  return {
    cards: registry.cards.map(cloneCard),
    activeClaims: registry.activeClaims.map(cloneClaim),
  };
}

class InMemoryRegisteredCardRegistryStore
  implements RegisteredCardRegistryStorePort
{
  private registry: RegisteredCardRegistry;
  private serial: Promise<void> = Promise.resolve();

  constructor(cards: readonly RegisteredCardView[]) {
    const records = cards.map((card) => ({ ...card }));
    this.registry = {
      cards: records,
      activeClaims: records
        .filter((card) => card.lifecycleState === "active")
        .map((card) => ({
          claimKey: registeredCardClaimKey(card),
          householdId: card.householdId,
          ownerMemberId: card.ownerMemberId,
          cardCompany: card.cardCompany,
          lastFour: card.lastFour,
          cardId: card.cardId,
        })),
    };
  }

  read(): RegisteredCardRegistry {
    return cloneRegistry(this.registry);
  }

  async transact<T>(
    operation: (
      current: RegisteredCardRegistry,
    ) => RegisteredCardRegistryMutation<T>,
  ): Promise<T> {
    const transaction = this.serial.then(() => {
      const mutation = operation(cloneRegistry(this.registry));
      this.registry = cloneRegistry(mutation.registry);
      return mutation.value;
    });
    this.serial = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }
}

class FixtureRegisteredCardIds implements RegisteredCardIdPort {
  nextCardId(commandId: string): string {
    return `card-${commandId}`;
  }
}

class DefaultRegisteredCardManagementDriver
  implements RegisteredCardManagementDriver
{
  constructor(
    private readonly application: RegisteredCardManagementInputPort,
    private readonly store: InMemoryRegisteredCardRegistryStore,
    private readonly historicalCaptureEvidence: readonly HistoricalCardEvidence[],
  ) {}

  register(input: RegisterCardCommand): Promise<RegisterCardResult> {
    return this.application.register(input);
  }

  registerConcurrently(
    inputs: readonly RegisterCardCommand[],
  ): Promise<readonly RegisterCardResult[]> {
    return Promise.all(inputs.map((input) => this.application.register(input)));
  }

  update(input: UpdateRegisteredCardCommand): Promise<UpdateCardResult> {
    return this.application.update(input);
  }

  retire(input: RetireRegisteredCardCommand): Promise<RetireCardResult> {
    return this.application.retire(input);
  }

  listActive(actor: RegisteredCardActor): readonly RegisteredCardView[] {
    return this.application.listActive(actor);
  }

  resolve(input: {
    readonly actor: RegisteredCardActor;
    readonly cardCompany: string;
    readonly cardToken?: string;
  }): ResolveRegisteredCardResult {
    return this.application.resolve(input);
  }

  state(): RegisteredCardRegistryState {
    const registry = this.store.read();
    return {
      cardRecords: registry.cards.map((card) => ({ ...card })),
      activeClaims: registry.activeClaims.map((claim) => ({
        ownerMemberId: claim.ownerMemberId,
        cardCompany: claim.cardCompany,
        lastFour: claim.lastFour,
        cardId: claim.cardId,
      })),
      historicalCaptureEvidence: this.historicalCaptureEvidence.map(
        (evidence) => ({ ...evidence }),
      ),
    };
  }
}

export function createRegisteredCardManagementDriver(
  fixture: RegisteredCardManagementFixture = {},
): RegisteredCardManagementDriver {
  const store = new InMemoryRegisteredCardRegistryStore(fixture.cards ?? []);
  const application = createRegisteredCardManagementApplication({
    store,
    ids: new FixtureRegisteredCardIds(),
  });
  return new DefaultRegisteredCardManagementDriver(
    application,
    store,
    fixture.historicalCaptureEvidence ?? [],
  );
}
