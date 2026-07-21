import type {
  MembershipLookupResult,
  NativeGoogleSessionMirror,
} from "../in/nativeGoogleSessionHandoffInputPort";

export type NativeGoogleAuthAdapterResult =
  | { readonly kind: "Authenticated"; readonly principalRef: string }
  | { readonly kind: "Cancelled" }
  | { readonly kind: "Failed" };

export interface NativeGoogleAuthPort {
  authenticate(): Promise<NativeGoogleAuthAdapterResult>;
}

export interface PrincipalMembershipLookupPort {
  findByPrincipal(principalRef: string): Promise<MembershipLookupResult>;
}

export interface WebViewSessionExchangeIssuerPort {
  issue(input: {
    readonly principalRef: string;
    readonly membershipReceiptId: string;
    readonly ttlMs: number;
  }): Promise<{ readonly handle: string; readonly expiresAt: string }>;
}

export interface NativeSessionMirrorWriterPort {
  replace(snapshot: NativeGoogleSessionMirror): Promise<void>;
}

export interface NativeSessionGenerationPort {
  next(): string;
}
