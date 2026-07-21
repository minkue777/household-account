import { createWebSecurityHeaderApplication } from "../reference/pwa/application/webSecurityHeaderApplication";
import type { WebSecurityHeaderInputPort } from "../reference/pwa/public";

export type {
  BrowserSecurityDecision,
  SecurityHeaderResult,
  WebResponseKind,
  WebSecurityHeaders,
  WebSecurityHeaderState,
} from "../reference/pwa/public";

export interface WebSecurityHeaderFixture {
  readonly productionOrigin: string;
  readonly https: boolean;
  readonly allowedFirebaseOrigins: readonly string[];
  readonly headerOverrides?: Readonly<Record<string, string | undefined>>;
}

export interface WebSecurityHeaderDriver extends WebSecurityHeaderInputPort {}

export function createWebSecurityHeaderDriver(
  fixture: WebSecurityHeaderFixture,
): WebSecurityHeaderDriver {
  return createWebSecurityHeaderApplication(fixture);
}
