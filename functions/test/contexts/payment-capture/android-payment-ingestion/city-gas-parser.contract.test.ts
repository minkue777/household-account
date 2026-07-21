import { describe, expect, it } from "vitest";
import { readContractJson } from "../../../support/contract-json";
import {
  createCityGasParserDriver,
  type CityGasNotificationInput,
  type CityGasParseResult,
  type CityGasParserInputPort,
  type CityGasParserState,
} from "../../../support/city-gas-parser-driver";

export interface CityGasParserContractSubject extends CityGasParserInputPort {
  state(): CityGasParserState;
}

export function createSubject(): CityGasParserContractSubject {
  return createCityGasParserDriver();
}

interface CityGasGoldenCase {
  readonly caseId: string;
  readonly requirementIds: readonly string[];
  readonly raw: CityGasNotificationInput;
  readonly expected: CityGasParseResult;
}

interface CityGasGoldenFixtureV1 {
  readonly fixtureVersion: 1;
  readonly zoneId: "Asia/Seoul";
  readonly cases: readonly CityGasGoldenCase[];
}

const fixture = readContractJson<CityGasGoldenFixtureV1>(
  "fixtures/payment-capture/city-gas-parser-golden.v1.json",
);

function caseById(caseId: string): CityGasGoldenCase {
  const golden = fixture.cases.find((candidate) => candidate.caseId === caseId);
  if (golden === undefined) {
    throw new Error(`도시가스 golden fixture가 없습니다: ${caseId}`);
  }
  return golden;
}

function expectGolden(caseId: string): void {
  const golden = caseById(caseId);
  const subject = createSubject();
  const result = subject.parse(golden.raw);

  expect(result).toEqual(golden.expected);
  expect(subject.state()).toEqual({ lastResult: result });
}

describe("도시가스 청구 parser 공개 계약", () => {
  it("[T-CITYGAS-001][PARSE-CITYGAS-001] 제목과 유효한 마감일이 있으면 청구 월·memo 정책과 마감일을 사용한다", () => {
    expectGolden("billing-title-and-valid-due-date");
  });

  it("[T-CITYGAS-001][PARSE-CITYGAS-001] 제목이 없으면 서울 수신 월과 빈 memo 정책을 사용한다", () => {
    expectGolden("missing-billing-title");
  });

  it.each([
    ["마감일 문구 없음", "missing-due-date"],
    ["형식은 맞지만 존재하지 않는 마감일", "invalid-due-date"],
  ] as const)(
    "[T-CITYGAS-001][PARSE-CITYGAS-001] %s이면 parse를 버리지 않고 서울 수신일로 fallback한다",
    (_name, caseId) => {
      expectGolden(caseId);
    },
  );

  it("[T-CITYGAS-001][PARSE-CITYGAS-001] 총액이 없으면 도시가스 거래를 만들지 않는다", () => {
    expectGolden("missing-total-amount");
  });

  it("[T-CITYGAS-001][PARSE-CITYGAS-001] 도시가스 청구가 아닌 알림은 총액이 있어도 무시한다", () => {
    expectGolden("non-city-gas-notification");
  });
});
