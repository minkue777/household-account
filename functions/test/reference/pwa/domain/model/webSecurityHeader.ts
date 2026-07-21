export type WebResponseKind = "document" | "api";

export interface WebSecurityHeaders {
  readonly "Content-Security-Policy": string;
  readonly "X-Content-Type-Options": "nosniff";
  readonly "Referrer-Policy": string;
  readonly "Permissions-Policy": string;
  readonly "Strict-Transport-Security"?: string;
}

export type SecurityHeaderResult =
  | { readonly kind: "Applied"; readonly headers: WebSecurityHeaders }
  | {
      readonly kind: "BuildFailed";
      readonly code: "SECURITY_POLICY_INCOMPLETE";
    };

export type BrowserSecurityDecision =
  | { readonly kind: "Allowed" }
  | {
      readonly kind: "Blocked";
      readonly directive: "frame-ancestors" | "script-src" | "connect-src";
    };

export interface WebSecurityHeaderState {
  readonly evaluatedResponses: readonly WebResponseKind[];
  readonly blockedDecisions: readonly BrowserSecurityDecision[];
}
