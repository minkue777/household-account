export interface AndroidCorrelationHashPort {
  hashForPurpose(purpose: "android-log-correlation", value: string): string;
}
