import type { ShortcutCardMessageParseResult } from "../../../domain/model/shortcutCardMessage";
import type {
  ShortcutHttpAuthorizationDecision,
  ShortcutHttpPaymentIntakeResult,
  ShortcutHttpRequestProcessingResult,
} from "../../../domain/model/shortcutHttpInbound";
import type { ShortcutCredentialActor } from "../../../domain/model/shortcutCredentialLifecycle";

export interface ShortcutHttpCredentialAuthorizationPort {
  authorize(input: {
    readonly bearerCredential: string | null;
    readonly requestedAt: string;
  }): Promise<ShortcutHttpAuthorizationDecision>;
}

export interface ShortcutHttpMessageParserPort {
  parse(input: {
    readonly message: string;
    readonly receivedAt: string;
    readonly zoneId: "Asia/Seoul";
  }): ShortcutCardMessageParseResult;
}

/**
 * Shortcut parser 개선을 위해 인증된 거부 요청의 원문을 임시 보존합니다.
 * 업무 성공 여부와 독립된 best-effort 진단 경계입니다.
 */
export interface ShortcutMessageDiagnosticPort {
  retain(input: {
    readonly actor: ShortcutCredentialActor;
    readonly credentialIdHash: string;
    readonly payloadHash: string;
    readonly rawMessage: string;
    readonly normalizedMessage: string;
    readonly parserOutcome:
      | { readonly kind: "accepted" }
      | {
          readonly kind: "rejected";
          readonly code:
            | Extract<
                ShortcutCardMessageParseResult,
                { kind: "Rejected" }
              >["code"]
            | "UNSUPPORTED_MESSAGE";
        };
    readonly requestedAt: string;
  }): Promise<void>;
}

export interface ShortcutHttpPaymentIntakePort {
  submit(input: {
    readonly commandId: string;
    readonly credentialId: string;
    readonly payloadHash: string;
    readonly requestedAt: string;
    readonly actor: ShortcutCredentialActor;
    readonly parsed: Extract<ShortcutCardMessageParseResult, { kind: "Parsed" }>;
  }): Promise<ShortcutHttpPaymentIntakeResult>;
}

export type ShortcutHttpReceiptClaimResult =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "completed";
      readonly result: ShortcutHttpRequestProcessingResult;
    }
  | { readonly kind: "in-progress" }
  | { readonly kind: "payload-mismatch" };

export interface ShortcutHttpReceiptPort {
  claim(input: {
    readonly receiptKey: string;
    readonly payloadHash: string;
  }): Promise<ShortcutHttpReceiptClaimResult>;
  complete(input: {
    readonly receiptKey: string;
    readonly result: ShortcutHttpRequestProcessingResult;
  }): Promise<void>;
  abandon(input: {
    readonly receiptKey: string;
    readonly result?: ShortcutHttpRequestProcessingResult;
  }): Promise<void>;
  waitForCompletion(
    receiptKey: string,
  ): Promise<ShortcutHttpRequestProcessingResult>;
}

export interface ShortcutHttpHashPort {
  hash(value: string): string;
}

export interface ShortcutHttpCredentialGatePort {
  evaluate(credentialId: string): Promise<
    | { readonly kind: "allowed" }
    | { readonly kind: "rate-limited" }
    | { readonly kind: "quota-exceeded" }
  >;
}

export interface ShortcutHttpIngressGatePort {
  evaluateIp(remoteAddress: string): Promise<
    | { readonly kind: "allowed" }
    | { readonly kind: "rate-limited" }
    | { readonly kind: "quota-exceeded" }
  >;
}
