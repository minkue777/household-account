import { createAndroidSmsCandidateApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/androidSmsCandidateApplication";
import type {
  SmsCandidateParserCatalog,
  SmsCandidateParserSuccess,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/smsCandidateParserCatalog";
import {
  createNotificationIngress,
  createSmsParserOrderPolicy,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";
import { createParsedObservationClassificationDriver } from "./parsed-observation-classification-driver";

export type {
  AndroidSmsCandidateInputPort,
  SmsCandidateSnapshot,
  SmsCaptureResult,
  SmsNotificationEnvelope,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

function occurredDate(postedAt: string, monthDay: string): string {
  const [month, day] = monthDay.split("/");
  return `${postedAt.slice(0, 4)}-${month}-${day}`;
}

function parseKbFixture(
  body: string,
  postedAt: string,
): SmsCandidateParserSuccess | undefined {
  const lines = body.split("\n");
  if (lines[0] !== "KB국민카드") return undefined;

  const approval = /^(승인|취소)\s+([\d,]+)원$/.exec(lines[1] ?? "");
  const occurred = /^(\d{2}\/\d{2})\s+(\d{2}:\d{2})$/.exec(
    lines[2] ?? "",
  );
  if (
    approval === null ||
    occurred === null ||
    !/^국민\(\d{4}\)$/.test(lines[3] ?? "") ||
    (lines[4] ?? "").trim() === ""
  ) {
    return undefined;
  }

  return {
    orderParserId: "KB",
    parserId: "kb-card-parser",
    transaction: {
      observationType: approval[1] === "승인" ? "approval" : "cancellation",
      amountInWon: Number(approval[2].replace(/,/g, "")),
      occurredLocalDate: occurredDate(postedAt, occurred[1]),
      occurredLocalTime: occurred[2],
      merchant: lines[4],
      card: { companyLabel: "국민", maskedToken: "1234" },
    },
  };
}

function parseSmsBillFixture(
  body: string,
  postedAt: string,
): SmsCandidateParserSuccess | undefined {
  const match = /\[NH카드]\s+7월\s+관리비\s+([\d,]+)원\s+정상\s+납부\s+완료/.exec(
    body,
  );
  if (match === null) return undefined;

  return {
    orderParserId: "SmsCardBill",
    parserId: "sms-card-bill-parser",
    transaction: {
      observationType: "approval",
      amountInWon: Number(match[1].replace(/,/g, "")),
      occurredLocalDate: postedAt.slice(0, 10),
      occurredLocalTime: postedAt.slice(11, 16),
      merchant: "7월 관리비",
    },
  };
}

class SmsCandidateFixtureParserCatalog implements SmsCandidateParserCatalog {
  successfulParsers(input: {
    readonly body: string;
    readonly postedAt: string;
  }): readonly SmsCandidateParserSuccess[] {
    return [
      parseSmsBillFixture(input.body, input.postedAt),
      parseKbFixture(input.body, input.postedAt),
    ].filter((result): result is SmsCandidateParserSuccess => result !== undefined);
  }
}

export function createAndroidSmsCandidateDriver() {
  return createAndroidSmsCandidateApplication({
    envelopes: createNotificationIngress(),
    parserOrder: createSmsParserOrderPolicy(),
    classification: createParsedObservationClassificationDriver(),
    parsers: new SmsCandidateFixtureParserCatalog(),
  });
}
