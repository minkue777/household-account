import type {
  NotificationSourceInput,
  ParsedPaymentEvidence,
} from "../in/sourceRegistrySelectionInputPort";

export interface PaymentParserPort {
  parse(input: NotificationSourceInput): ParsedPaymentEvidence | undefined;
}

export interface PaymentParserCatalogPort {
  find(input: {
    readonly parserId: string;
    readonly parserVersion: string;
  }): PaymentParserPort | undefined;
}
