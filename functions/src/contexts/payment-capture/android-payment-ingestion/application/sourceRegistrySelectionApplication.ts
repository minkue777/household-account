import type {
  NotificationSourceInput,
  SelectedParserEvidence,
  SelectedSourceEvidence,
  SourceRegistrySelectionInputPort,
  SourceSelectionResult,
} from "./ports/in/sourceRegistrySelectionInputPort";
import type { PaymentParserCatalogPort } from "./ports/out/paymentParserPort";
import type { PaymentSourceRegistryEntry } from "../domain/model/paymentSourceRegistry";
import { selectRegisteredPaymentSource } from "../domain/policies/selectRegisteredPaymentSource";

export interface SourceRegistrySelectionDependencies {
  readonly registry: readonly PaymentSourceRegistryEntry[];
  readonly parsers: PaymentParserCatalogPort;
}

class DefaultSourceRegistrySelectionApplication
  implements SourceRegistrySelectionInputPort
{
  constructor(
    private readonly dependencies: SourceRegistrySelectionDependencies,
  ) {}

  parse(input: NotificationSourceInput): SourceSelectionResult {
    const selection = selectRegisteredPaymentSource({
      packageName: input.packageName,
      registry: this.dependencies.registry,
    });
    if (selection.kind === "denied") {
      return { kind: "ignored", code: selection.code };
    }

    const source: SelectedSourceEvidence = {
      kind: "android-registered-package",
      packageName: input.packageName,
      sourceType: selection.entry.sourceType,
      registryVersion: selection.entry.registryVersion,
    };
    const parserEvidence: SelectedParserEvidence = {
      parserId: selection.entry.parserId,
      parserVersion: selection.entry.parserVersion,
    };
    const parser = this.dependencies.parsers.find(parserEvidence);
    const payment = parser?.parse(input);
    if (payment === undefined) {
      return {
        kind: "ignored",
        code: "PARSE_FAILED",
        source,
        parser: parserEvidence,
      };
    }

    return {
      kind: "parsed",
      source,
      parser: parserEvidence,
      payment,
    };
  }
}

export function createSourceRegistrySelectionApplication(
  dependencies: SourceRegistrySelectionDependencies,
): SourceRegistrySelectionInputPort {
  return new DefaultSourceRegistrySelectionApplication(dependencies);
}
