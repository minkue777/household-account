export interface PwaClientNavigationPort {
  /** Adapter는 origin과 destination이 모두 일치하는 client만 반환합니다. */
  findMatchingClient(input: {
    readonly origin: string;
    readonly destination: string;
  }): { readonly clientId: string } | undefined;
  focus(input: {
    readonly clientId: string;
    readonly origin: string;
    readonly destination: string;
  }): void;
  open(input: { readonly origin: string; readonly destination: string }): void;
}
