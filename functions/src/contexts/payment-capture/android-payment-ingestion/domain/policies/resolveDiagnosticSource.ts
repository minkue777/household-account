import { ANDROID_PAYMENT_SOURCE_REGISTRY } from "../model/defaultPaymentSourceRegistry";

export interface DiagnosticSourceCandidate {
  readonly packageName: string;
  readonly title: string;
  readonly fullText: string;
}

export interface RegisteredDiagnosticSource {
  readonly packageName: string;
  readonly sourceType: string;
}

const DIAGNOSTIC_ONLY_SOURCE_BY_PACKAGE: Readonly<Record<string, string>> =
  Object.freeze({
    "com.shcard.smartpay": "SHINHAN_CARD",
    "kr.co.samsungcard.mpocket": "SAMSUNG_CARD",
    "com.hyundaicard.appcard": "HYUNDAI_CARD",
    "com.lcacApp": "LOTTE_CARD",
    "com.hanaskcard.paycla": "HANA_CARD",
    "com.wooricard.smartapp": "WOORI_CARD",
    "com.ibk.cdp": "IBK_CARD",
    "kr.co.citibank.citimobile": "CITI_CARD",
    "com.epost.psf.sdsi": "EPOST_BANKING",
    "com.epost.psf.ss": "EPOST_PAY",
    "com.kakaobank.channel": "KAKAO_BANK",
    "com.kbankwith.smartbank": "K_BANK",
    "com.scbank.ma30": "SC_BANK",
    "co.kr.kdb.android.smartkdb": "KDB_BANK",
    "kr.co.dgb.dgbm": "IM_BANK",
    "kr.co.busanbank.mbp": "BUSAN_BANK",
    "com.knb.psb": "KYONGNAM_BANK",
    "com.kjbank.asb.pbanking": "GWANGJU_BANK",
    "kr.co.jbbank.privatebank": "JEONBUK_BANK",
    "com.jejubank.smartnew": "JEJU_BANK",
    "com.suhyup.pesmb": "SUHYUP_BANK",
    "com.suhyup.psmb": "SUHYUP_PARTNER_BANK",
    "kr.co.cu.onbank": "CU_BANK",
    "com.smg.spbs": "MG_BANK",
  });

function isCityGasNotification(input: DiagnosticSourceCandidate): boolean {
  const normalized = `${input.title}\n${input.fullText}`.replace(/\s+/g, " ");
  return normalized.includes("도시가스") && /(청구|요금|납부)/.test(normalized);
}

function isTossWalkingNotification(input: DiagnosticSourceCandidate): boolean {
  return (
    input.packageName === "viva.republica.toss" &&
    /^\d[\d,]*\s*걸음$/.test(input.title.trim())
  );
}

/**
 * 진단 원문도 서버가 소유한 source registry로만 허용합니다. 클라이언트가
 * 보낸 source 이름은 신뢰하지 않으며, 카카오톡은 도시가스 청구 후보만 좁혀
 * 일반 대화가 진단 컬렉션으로 유입되지 않게 합니다.
 */
export function resolveRegisteredDiagnosticSource(
  input: DiagnosticSourceCandidate,
): RegisteredDiagnosticSource | undefined {
  if (isTossWalkingNotification(input)) return undefined;

  const paymentSource = ANDROID_PAYMENT_SOURCE_REGISTRY.find(
    (candidate) =>
      candidate.packageName === input.packageName &&
      candidate.sourceState === "active" &&
      candidate.parserState === "active",
  );
  if (paymentSource !== undefined) {
    if (paymentSource.cityGas && !isCityGasNotification(input)) return undefined;
    return {
      packageName: paymentSource.packageName,
      sourceType: paymentSource.sourceType,
    };
  }

  const diagnosticSource = DIAGNOSTIC_ONLY_SOURCE_BY_PACKAGE[input.packageName];
  return diagnosticSource === undefined
    ? undefined
    : { packageName: input.packageName, sourceType: diagnosticSource };
}
