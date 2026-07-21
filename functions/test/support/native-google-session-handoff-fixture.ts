import { createNativeGoogleSessionHandoffApplication } from "../reference/android-host/application/nativeGoogleSessionHandoffApplication";
import type {
  MembershipLookupResult,
} from "../reference/android-host/application/ports/in/nativeGoogleSessionHandoffInputPort";
import type { NativeGoogleAuthAdapterResult } from "../reference/android-host/application/ports/out/nativeGoogleSessionHandoffPorts";

type AuthenticationOutcome =
  | { readonly kind: "success"; readonly principalRef: string }
  | { readonly kind: "cancel" }
  | { readonly kind: "failure" };

export function createNativeGoogleSessionHandoffFixture(fixture: {
  readonly membershipLookupByPrincipal: Readonly<
    Record<string, MembershipLookupResult>
  >;
  readonly serverNow: string;
  readonly requestedExchangeHandleTtlMs?: number;
  readonly untrustedClientHints?: {
    readonly householdId?: string;
    readonly memberId?: string;
    readonly status?: "active" | "deleted";
  };
}) {
  let nextAuthentication: NativeGoogleAuthAdapterResult = { kind: "Failed" };
  let handleSequence = 0;
  let generationSequence = 0;

  const application = createNativeGoogleSessionHandoffApplication({
    nativeAuthentication: {
      async authenticate() {
        return nextAuthentication;
      },
    },
    memberships: {
      async findByPrincipal(principalRef) {
        return (
          fixture.membershipLookupByPrincipal[principalRef] ?? { kind: "Missing" }
        );
      },
    },
    exchangeHandles: {
      async issue({ ttlMs }) {
        const issuedAtMs = Date.parse(fixture.serverNow);
        return {
          handle: `web-session-exchange-${++handleSequence}`,
          expiresAt: new Date(issuedAtMs + ttlMs).toISOString(),
        };
      },
    },
    mirrorWriter: {
      async replace() {},
    },
    sessionGenerations: {
      next: () => `session-generation-${++generationSequence}`,
    },
    requestedExchangeHandleTtlMs: fixture.requestedExchangeHandleTtlMs,
  });

  return {
    async authenticate(outcome: AuthenticationOutcome) {
      switch (outcome.kind) {
        case "success":
          nextAuthentication = {
            kind: "Authenticated",
            principalRef: outcome.principalRef,
          };
          break;
        case "cancel":
          nextAuthentication = { kind: "Cancelled" };
          break;
        case "failure":
          nextAuthentication = { kind: "Failed" };
          break;
      }
      return application.authenticate();
    },
    confirmMembership: () => application.confirmMembership(),
    state: () => application.state(),
  };
}
