export interface ExternalTextHttpTransportRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export type ExternalTextHttpTransportResult =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly body: string;
      readonly bodyBytes: number;
      readonly location?: string;
    }
  | { readonly kind: "timeout" }
  | { readonly kind: "network-failure"; readonly code: string }
  | { readonly kind: "response-too-large"; readonly bodyBytes: number };

export interface ExternalTextHttpTransportPort {
  execute(
    request: ExternalTextHttpTransportRequest,
  ): Promise<ExternalTextHttpTransportResult>;
}
