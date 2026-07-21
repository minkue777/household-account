import type {
  BrowserSecurityDecision,
  WebResponseKind,
} from "../domain/model/webSecurityHeader";
import {
  buildWebSecurityHeaders,
  normalizeWebSecurityHeaderConfiguration,
  normalizedWebResourceOrigin,
  validateWebSecurityHeaders,
  type WebSecurityHeaderConfiguration,
} from "../domain/policies/webSecurityHeaderPolicy";
import type { WebSecurityHeaderInputPort } from "./ports/in/webSecurityHeaderInputPort";

export function createWebSecurityHeaderApplication(
  configuration: WebSecurityHeaderConfiguration,
): WebSecurityHeaderInputPort {
  const normalizedConfiguration = normalizeWebSecurityHeaderConfiguration(
    configuration,
  );
  const evaluatedResponses: WebResponseKind[] = [];
  const blockedDecisions: BrowserSecurityDecision[] = [];

  return {
    headersFor(kind) {
      evaluatedResponses.push(kind);
      if (normalizedConfiguration === undefined) {
        return { kind: "BuildFailed", code: "SECURITY_POLICY_INCOMPLETE" };
      }
      const headers = buildWebSecurityHeaders(
        normalizedConfiguration,
        configuration.headerOverrides,
      );
      if (!validateWebSecurityHeaders(headers, normalizedConfiguration)) {
        return { kind: "BuildFailed", code: "SECURITY_POLICY_INCOMPLETE" };
      }
      return { kind: "Applied", headers: { ...headers } };
    },

    evaluateFrame() {
      const decision = {
        kind: "Blocked" as const,
        directive: "frame-ancestors" as const,
      };
      blockedDecisions.push(decision);
      return decision;
    },

    evaluateResource(input) {
      const origin = normalizedWebResourceOrigin(input.origin);
      const allowed =
        normalizedConfiguration !== undefined &&
        origin !== undefined &&
        (origin === normalizedConfiguration.productionOrigin ||
          (input.type === "connect" &&
            normalizedConfiguration.allowedFirebaseOrigins.includes(origin)));
      if (allowed) return { kind: "Allowed" };

      const decision = {
        kind: "Blocked" as const,
        directive: (input.type === "script"
          ? "script-src"
          : "connect-src") as "script-src" | "connect-src",
      };
      blockedDecisions.push(decision);
      return decision;
    },

    state() {
      return {
        evaluatedResponses: [...evaluatedResponses],
        blockedDecisions: blockedDecisions.map((decision) => ({ ...decision })),
      };
    },
  };
}
