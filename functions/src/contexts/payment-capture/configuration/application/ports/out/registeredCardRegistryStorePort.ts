import type { RegisteredCardRegistry } from "../../../domain/model/registeredCardRegistry";

export interface RegisteredCardRegistryMutation<T> {
  readonly registry: RegisteredCardRegistry;
  readonly value: T;
}

export interface RegisteredCardRegistryStorePort {
  read(): RegisteredCardRegistry;
  transact<T>(
    operation: (
      current: RegisteredCardRegistry,
    ) => RegisteredCardRegistryMutation<T>,
  ): Promise<T>;
}

export interface RegisteredCardIdPort {
  nextCardId(commandId: string): string;
}
