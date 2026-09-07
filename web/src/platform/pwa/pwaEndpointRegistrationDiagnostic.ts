export type PwaEndpointRegistrationPhase =
  | 'worker'
  | 'installation'
  | 'subscription'
  | 'prime-registration'
  | 'unregister'
  | 'push-registration'
  | 'server-registration'
  | 'verification'
  | 'legacy-cleanup';

const LOCAL_ERROR_CODES = new Set([
  'PWA_DISABLED_IN_DEVELOPMENT',
  'PWA_UNSUPPORTED',
  'PWA_PUSH_WORKER_NOT_READY',
  'PWA_PUSH_SUBSCRIPTION_INVALID',
  'PWA_SESSION_CLEANUP_REQUIRED',
  'PWA_ENDPOINT_SCOPE_CHANGED',
  'PWA_FID_CHANGED_DURING_REGISTRATION',
  'PWA_FID_CALLBACK_MISSING',
  'PWA_ENDPOINT_BINDING_CHANGED',
  'PWA_PUSH_SUBSCRIPTION_CHANGED',
  'LEGACY_WORKER_CLEANUP_FAILED',
]);

const DOM_ERROR_NAMES = new Set([
  'AbortError', 'ConstraintError', 'DataError', 'InvalidAccessError',
  'InvalidModificationError', 'InvalidStateError', 'NetworkError',
  'NotAllowedError', 'NotFoundError', 'NotReadableError', 'NotSupportedError',
  'OperationError', 'QuotaExceededError', 'ReadOnlyError', 'SecurityError',
  'TimeoutError', 'TransactionInactiveError', 'UnknownError', 'VersionError',
]);

/** SDK messages/customData may contain installation IDs or URLs; expose codes only. */
export function formatPwaEndpointRegistrationErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const value = error as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof value.code === 'string') {
    if (/^(?:messaging|installations|functions)\/[a-z][a-z0-9-]{0,79}$/.test(value.code)) return value.code;
    if (LOCAL_ERROR_CODES.has(value.code)) return value.code;
  }
  if (typeof value.name === 'string' && DOM_ERROR_NAMES.has(value.name)) return value.name;
  // Locally created Error objects use an exact, fixed code as their message.
  if (typeof value.message === 'string' && LOCAL_ERROR_CODES.has(value.message)) return value.message;
  return 'unknown';
}
