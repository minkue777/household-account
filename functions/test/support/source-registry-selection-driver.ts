import { createSourceRegistrySelectionApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/sourceRegistrySelectionApplication";
import type {
  PaymentParserCatalogPort,
  PaymentParserPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/paymentParserPort";
import type { PaymentSourceRegistryEntry } from "../../src/contexts/payment-capture/android-payment-ingestion/domain/model/paymentSourceRegistry";
import type {
  NotificationSourceInput,
  ParsedPaymentEvidence,
  SourceRegistrySelectionInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  NotificationSourceInput,
  SourceRegistrySelectionInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type SourceRegistryFixtureEntry = PaymentSourceRegistryEntry;

function amountInWon(value: string): number | undefined {
  const amount = Number(value.replace(/,/g, ""));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

class KbCardFixtureParser implements PaymentParserPort {
  parse(input: NotificationSourceInput): ParsedPaymentEvidence | undefined {
    const lines = input.body.split("\n").map((line) => line.trim());
    const approval = /^(승인|취소)\s+([\d,]+)원$/.exec(lines[0] ?? "");
    if (
      approval === null ||
      !/^\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(lines[1] ?? "") ||
      !/^국민\(.+\)$/.test(lines[2] ?? "") ||
      (lines[3] ?? "") === ""
    ) {
      return undefined;
    }

    const amount = amountInWon(approval[2]);
    if (amount === undefined) return undefined;
    return {
      observationType: approval[1] === "승인" ? "approval" : "cancellation",
      amountInWon: amount,
      merchant: lines[3],
    };
  }
}

class TossFixtureParser implements PaymentParserPort {
  parse(input: NotificationSourceInput): ParsedPaymentEvidence | undefined {
    const lines = input.body.split("\n").map((line) => line.trim());
    const approval = /^([\d,]+)원\s+(결제|결제취소)$/.exec(lines[0] ?? "");
    if (
      approval === null ||
      !/^\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(lines[1] ?? "") ||
      (lines[2] ?? "") === ""
    ) {
      return undefined;
    }

    const amount = amountInWon(approval[1]);
    if (amount === undefined) return undefined;
    return {
      observationType:
        approval[2] === "결제" ? "approval" : "cancellation",
      amountInWon: amount,
      merchant: lines[2],
    };
  }
}

class FixturePaymentParserCatalog implements PaymentParserCatalogPort {
  private readonly parsers = new Map<string, PaymentParserPort>([
    ["kb-card-parser:2", new KbCardFixtureParser()],
    ["toss-parser:3", new TossFixtureParser()],
  ]);

  find(input: {
    readonly parserId: string;
    readonly parserVersion: string;
  }): PaymentParserPort | undefined {
    return this.parsers.get(`${input.parserId}:${input.parserVersion}`);
  }
}

export function createSourceRegistrySelectionDriver(
  registry: readonly SourceRegistryFixtureEntry[],
): SourceRegistrySelectionInputPort {
  return createSourceRegistrySelectionApplication({
    registry,
    parsers: new FixturePaymentParserCatalog(),
  });
}
