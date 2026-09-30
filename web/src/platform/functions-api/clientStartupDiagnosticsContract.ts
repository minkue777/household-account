export type ClientStartupTiming =
  | 'navigationResponseStart' | 'navigationResponseEnd' | 'domInteractive'
  | 'bootstrapStarted' | 'authStarted' | 'authReady'
  | 'authTokenObserved' | 'authTokenRequestStarted' | 'authTokenResponseEnd'
  | 'membershipStarted' | 'membershipReady' | 'householdStarted' | 'householdReady'
  | 'householdReadStarted' | 'householdSnapshotReceived'
  | 'ledgerListenStarted' | 'ledgerServerSnapshotReceived'
  | 'categoriesListenStarted' | 'categoriesServerSnapshotReceived'
  | 'currencyPreferencesListenStarted' | 'currencyPreferencesServerSnapshotReceived'
  | 'currencyBalancesListenStarted' | 'currencyBalancesServerSnapshotReceived'
  | 'yearSummaryListenStarted' | 'yearSummaryFirstSnapshotReceived' | 'yearSummaryServerSnapshotReceived'
  | 'ledgerReady' | 'categoriesReady' | 'localCurrencyReady' | 'yearSummaryReady'
  | 'homeReady' | 'firstLedgerPaint' | 'firstHomeCompletePaint';

/** 모든 시간은 현재 문서의 navigation 시작을 기준으로 한 ms offset입니다. */
export interface ClientStartupDiagnostics {
  readonly version: 1;
  readonly webBuild?: string;
  readonly navigationType?: 'navigate' | 'reload' | 'back_forward' | 'prerender';
  readonly initialVisibility: 'visible' | 'hidden' | 'unknown';
  readonly visibilityTrackingStartedAtMs: number;
  readonly hiddenMs: number;
  readonly hiddenCount: number;
  readonly serviceWorkerControlled?: boolean;
  readonly yearSummaryRequired?: boolean;
  readonly cache?: {
    readonly bootstrap?: 'hit' | 'miss';
    readonly membership?: 'hit' | 'prefetched';
    readonly household?: 'hit' | 'miss';
  };
  readonly timingsMs: Partial<Record<ClientStartupTiming, number>>;
}
