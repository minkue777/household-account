import type { PaymentSourceRegistryEntry } from "./paymentSourceRegistry";

export interface AndroidPaymentSourceRegistryEntry
  extends PaymentSourceRegistryEntry {
  readonly localCurrencyType?: "gyeonggi" | "daejeon" | "sejong";
  readonly cityGas: boolean;
}

const ACTIVE = "active" as const;
const VERSION = "source-registry.v1";

function entry(
  packageName: string,
  sourceType: string,
  parserId: string,
  parserVersion: string,
  options: {
    readonly localCurrencyType?: "gyeonggi" | "daejeon" | "sejong";
    readonly cityGas?: boolean;
  } = {},
): AndroidPaymentSourceRegistryEntry {
  return {
    packageName,
    sourceType,
    registryVersion: VERSION,
    sourceState: ACTIVE,
    parserId,
    parserVersion,
    parserState: ACTIVE,
    ...(options.localCurrencyType === undefined
      ? {}
      : { localCurrencyType: options.localCurrencyType }),
    cityGas: options.cityGas === true,
  };
}

export const ANDROID_PAYMENT_SOURCE_REGISTRY: readonly AndroidPaymentSourceRegistryEntry[] =
  Object.freeze([
    entry("com.kbcard.cxh.appcard", "kb-card", "kb-card-parser", "2.0.0"),
    entry("com.kbcard.kbkookmincard", "kb-card", "kb-card-parser", "2.0.0"),
    entry("nh.smart.nhallonepay", "nh-card", "nh-pay-parser", "1.0.0"),
    entry("com.naverfin.payapp", "naver-pay", "naver-pay-parser", "1.0.0"),
    entry("viva.republica.toss", "toss-bank", "toss-bank-parser", "1.0.0"),
    entry("com.kakaopay.app", "kakao-pay", "kakao-pay-parser", "1.0.0"),
    entry("com.komsco.kpay", "digital-onnuri", "digital-onnuri-parser", "1.1.0"),
    entry("kvp.jjy.MispAndroid320", "paybooc-isp", "paybooc-isp-parser", "1.0.0"),
    entry("com.google.android.apps.messaging", "sms-card-message", "sms-card-message-parser", "1.0.0"),
    entry("com.samsung.android.messaging", "sms-card-message", "sms-card-message-parser", "1.0.0"),
    entry("com.android.mms", "sms-card-message", "sms-card-message-parser", "1.0.0"),
    entry("com.samsung.android.spay", "samsung-card", "samsung-card-parser", "1.0.0"),
    entry("kr.co.samsungcard.mpocket", "samsung-card", "samsung-card-parser", "1.0.0"),
    entry("com.lcacApp", "lotte-card", "lotte-card-parser", "1.0.0"),
    entry(
      "com.mobiletoong.gpay",
      "gyeonggi-local-currency",
      "gyeonggi-local-currency-parser",
      "1.0.0",
      { localCurrencyType: "gyeonggi" },
    ),
    entry(
      "com.coocon.chakwallet",
      "gyeonggi-local-currency",
      "gyeonggi-local-currency-parser",
      "1.0.0",
      { localCurrencyType: "gyeonggi" },
    ),
    entry(
      "gov.gyeonggi.ggcard",
      "gyeonggi-local-currency",
      "gyeonggi-local-currency-parser",
      "1.0.0",
      { localCurrencyType: "gyeonggi" },
    ),
    entry(
      "kr.co.nmcs.daejeonpay",
      "daejeon-local-currency",
      "daejeon-local-currency-parser",
      "1.0.0",
      { localCurrencyType: "daejeon" },
    ),
    entry(
      "gov.sejong.yeominpay",
      "sejong-local-currency",
      "sejong-local-currency-parser",
      "1.0.0",
      { localCurrencyType: "sejong" },
    ),
    entry("com.kakao.talk", "city-gas-bill", "city-gas-bill-parser", "1.0.0", {
      cityGas: true,
    }),
  ]);
