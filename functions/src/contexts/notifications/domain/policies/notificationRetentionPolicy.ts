const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export function isNotificationEventExpired(
  occurredAt: string,
  now: string,
): boolean {
  return Date.parse(now) - Date.parse(occurredAt) > RETENTION_MILLISECONDS;
}

export function terminalRetention(now: string): {
  terminalAt: string;
  expiresAt: string;
} {
  return {
    terminalAt: now,
    expiresAt: new Date(Date.parse(now) + RETENTION_MILLISECONDS).toISOString(),
  };
}

export function terminalRetentionDisposition(
  expiresAt: string | undefined,
  now: string,
): "retain" | "eligible-for-ttl-deletion" {
  return expiresAt !== undefined && Date.parse(now) >= Date.parse(expiresAt)
    ? "eligible-for-ttl-deletion"
    : "retain";
}
