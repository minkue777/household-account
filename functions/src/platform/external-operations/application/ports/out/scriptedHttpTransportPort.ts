export type SafeHttpTransportStep =
  | { readonly kind: "response"; readonly status: number; readonly bodyBytes: number }
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "timeout" }
  | {
      readonly kind: "chunked-response";
      readonly status: number;
      readonly chunks: readonly number[];
    };

export interface ScriptedHttpTransportPort {
  execute(url: string): Promise<SafeHttpTransportStep>;
}
