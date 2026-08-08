import {
  kbCardProviderParser,
  lotteCardProviderParser,
  nhPayProviderParser,
  payboocProviderParser,
  samsungCardProviderParser,
} from "./cardProviderParsers";
import {
  daejeonLocalCurrencyProviderParser,
  gyeonggiLocalCurrencyProviderParser,
  sejongLocalCurrencyProviderParser,
} from "./localCurrencyProviderParsers";
import type { ProviderParserDefinition } from "./providerParsingSupport";
import { kakaoTalkFinancialMessageProviderParser } from "./kakaoTalkFinancialMessageProviderParser";
import { smsBillProviderParser } from "./smsBillProviderParser";
import {
  digitalOnnuriProviderParser,
  kakaoPayProviderParser,
  naverPayProviderParser,
  tossBankProviderParser,
} from "./walletProviderParsers";

const PROVIDER_PARSERS: readonly ProviderParserDefinition[] = [
  kbCardProviderParser,
  nhPayProviderParser,
  naverPayProviderParser,
  tossBankProviderParser,
  kakaoPayProviderParser,
  digitalOnnuriProviderParser,
  payboocProviderParser,
  samsungCardProviderParser,
  lotteCardProviderParser,
  gyeonggiLocalCurrencyProviderParser,
  daejeonLocalCurrencyProviderParser,
  sejongLocalCurrencyProviderParser,
  kakaoTalkFinancialMessageProviderParser,
  smsBillProviderParser,
];

export function findAndroidProviderParser(
  parserId: string,
): ProviderParserDefinition | undefined {
  return PROVIDER_PARSERS.find((parser) => parser.parserId === parserId);
}
