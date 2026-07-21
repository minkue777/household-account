export interface WebShellEnvironment {
  readonly environment: "production" | "development";
  readonly configVersion: string;
  readonly startUrl: string;
  readonly allowedOrigin: string;
}

export type WebShellInitializationResult =
  | { readonly kind: "Loaded"; readonly url: string; readonly loadCount: 1 }
  | {
      readonly kind: "RestoredWithoutReload";
      readonly url: string;
      readonly loadCount: 0;
    }
  | {
      readonly kind: "BuildRejected";
      readonly code:
        | "INSECURE_START_URL"
        | "ORIGIN_MISMATCH"
        | "UNKNOWN_ENVIRONMENT";
    };

export type WebShellBackResult =
  | { readonly kind: "WebHistoryNavigated" }
  | { readonly kind: "ActivityDelegated" };

export type AndroidVersionPresentation =
  | { readonly kind: "Known"; readonly value: string }
  | { readonly kind: "Unknown"; readonly value: string };

export interface WebShellInputPort {
  initialize(input: {
    readonly environment: WebShellEnvironment;
    readonly restoredNavigationUrl?: string;
  }): WebShellInitializationResult;
  onBack(input: {
    readonly screen: "permission-guide" | "web-shell";
    readonly webViewCanGoBack: boolean;
  }): WebShellBackResult;
  presentVersion(input: {
    readonly versionName?: string;
    readonly packageLookupSucceeded: boolean;
  }): AndroidVersionPresentation;
}
