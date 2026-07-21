export { createAndroidHostAccessApplication } from "./application/androidHostAccessApplication";
export {
  type AndroidComponentName,
  type AndroidHostAccessDecision,
  type AndroidHostAccessInputPort,
  type AndroidPermissionState,
} from "./application/ports/in/androidHostAccessInputPort";
export { createAndroidBackupPolicyApplication } from "./application/androidBackupPolicyApplication";
export {
  type AndroidBackupArtifactResult,
  type AndroidBackupPolicyInputPort,
  type AndroidBackupPolicyState,
  type AndroidFreshInstallationRestoreResult,
  type AndroidLocalDataKey,
  type AndroidLocalDataSnapshot,
  type AndroidRestoreMode,
} from "./application/ports/in/androidBackupPolicyInputPort";
export type {
  AndroidCapabilityState,
  AndroidNotificationPermissionInputPort,
  NotificationPermissionResult,
} from "./application/ports/in/androidNotificationPermissionInputPort";
export type {
  QuickEditOverlayDecision,
  QuickEditOverlayPolicyInputPort,
} from "./application/ports/in/quickEditOverlayPolicyInputPort";
export type {
  QuickEditOpenInput,
  QuickEditOpenPolicyInputPort,
  QuickEditOpenResult,
  QuickEditOpenSnapshot,
} from "./application/ports/in/quickEditOpenPolicyInputPort";
export { createAndroidLogRedactionApplication } from "./application/androidLogRedactionApplication";
export type {
  AndroidLogRecordResult,
  AndroidLogRedactionInputPort,
  AndroidLogRedactionState,
  AndroidLogSink,
  RedactedAndroidLogEntry,
  SensitiveAndroidFlowInput,
} from "./application/ports/in/androidLogRedactionInputPort";
export type {
  QuickEditIntentExtras,
  QuickEditIntentMapperInputPort,
  QuickEditIntentMappingResult,
} from "./application/ports/in/quickEditIntentMapperInputPort";
export type {
  QuickEditSplitDraftInputPort,
  QuickEditSplitDraftState,
  QuickEditSplitItem,
  SplitDraftMutationResult,
  SplitDraftValidationResult,
} from "./application/ports/in/quickEditSplitDraftInputPort";
export type {
  AuthenticatedQuickEditActor,
  QuickEditAuthSession,
  QuickEditCommandOutcomeInputPort,
  QuickEditCommandResult,
  QuickEditCommandState,
  QuickEditOperation,
  QuickEditTransactionView,
} from "./application/ports/in/quickEditCommandOutcomeInputPort";
export { NATIVE_WEBVIEW_SESSION_MAX_TTL_MS } from "./application/ports/in/nativeGoogleSessionHandoffInputPort";
export type {
  MembershipHandoffResult,
  MembershipLookupResult,
  NativeGoogleAuthenticationResult,
  NativeGoogleSessionHandoffInputPort,
  NativeGoogleSessionMirror,
  NativeGoogleSessionState,
  PrincipalBoundMembershipReceipt,
} from "./application/ports/in/nativeGoogleSessionHandoffInputPort";

export type {
  CaptureRetryDecision,
  CaptureRetryQueueEntry,
  CaptureRetryQueueInputPort,
  CaptureRetryQueueState,
} from "./application/ports/in/captureRetryQueueInputPort";
export type {
  PersistedQuickEditQueueEntry,
  QuickEditFifoInputPort,
  QuickEditPresentationCheck,
  QuickEditQueueFinishOutcome,
  QuickEditQueueOpenOutcome,
  QuickEditQueueSecurityEvidence,
  QuickEditQueueSnapshot,
  QuickEditSessionScope,
  StoredQuickEditTransactionSignal,
} from "./application/ports/in/quickEditFifoInputPort";
export type {
  QuickEditConflictFormSnapshot,
  QuickEditConflictSplitItem,
  QuickEditConflictSplitOutcome,
  QuickEditLedgerTransactionSnapshot,
  QuickEditServerManagedEvidence,
  QuickEditSplitConflictInputPort,
  QuickEditSplitConflictState,
  QuickEditSplitReconfirmationOutcome,
} from "./application/ports/in/quickEditSplitConflictInputPort";
export type {
  ActorBoundStateSnapshot,
  InterruptedSessionTransitionRecoveryOutcome,
  LegacyQuickEditPreferenceMigrationOutcome,
  SessionMirrorStorageEvidence,
  SessionScopeSnapshot,
  SessionScopeTransitionInputPort,
  SessionTransitionOutcome,
} from "./application/ports/in/sessionScopeTransitionInputPort";
export type {
  SecureBridgeOperation,
  SecureBridgeResult,
  SecureWebViewBridgeInputPort,
  SecureWebViewBridgeState,
  WebViewSessionExchangeResult,
} from "./application/ports/in/secureWebViewBridgeInputPort";
export type {
  AndroidVersionPresentation,
  WebShellBackResult,
  WebShellEnvironment,
  WebShellInitializationResult,
  WebShellInputPort,
} from "./application/ports/in/webShellInputPort";
export type {
  WireDtoConformanceInputPort,
  WireDtoRoundTripResult,
} from "./application/ports/in/wireDtoConformanceInputPort";

export { createQuickEditFifoApplication } from "./application/quickEditFifoApplication";
export { createQuickEditSplitConflictApplication } from "./application/quickEditSplitConflictApplication";
export { createSessionScopeTransitionApplication } from "./application/sessionScopeTransitionApplication";
export { createSecureWebViewBridgeApplication } from "./application/secureWebViewBridgeApplication";
export { createWebShellApplication } from "./application/webShellApplication";
export { createWireDtoConformanceApplication } from "./application/wireDtoConformanceApplication";
