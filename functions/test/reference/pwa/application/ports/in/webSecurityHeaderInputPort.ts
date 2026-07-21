import type {
  BrowserSecurityDecision,
  SecurityHeaderResult,
  WebResponseKind,
  WebSecurityHeaders,
  WebSecurityHeaderState,
} from "../../../domain/model/webSecurityHeader";

export type {
  BrowserSecurityDecision,
  SecurityHeaderResult,
  WebResponseKind,
  WebSecurityHeaders,
  WebSecurityHeaderState,
};

export interface WebSecurityHeaderInputPort {
  headersFor(kind: WebResponseKind): SecurityHeaderResult;
  evaluateFrame(parentOrigin: string): BrowserSecurityDecision;
  evaluateResource(input: {
    readonly type: "script" | "connect";
    readonly origin: string;
  }): BrowserSecurityDecision;
  state(): WebSecurityHeaderState;
}
