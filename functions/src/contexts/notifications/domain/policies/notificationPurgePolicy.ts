export interface NotificationPurgeActorFact {
  systemRef: string;
  capabilities: readonly string[];
}

export function canPurgeNotificationHouseholdData(
  actor: NotificationPurgeActorFact,
): boolean {
  return actor.capabilities.includes("householdLifecycle:purge");
}

export type NotificationLifecycleSignalDecision =
  | { kind: "Ignored"; reason: "LOGICAL_DELETE_DOES_NOT_PURGE" }
  | { kind: "AcceptedForPurge"; processId: string };

export function decideNotificationLifecycleSignal(input: {
  eventType: "HouseholdDeleted.v1" | "HouseholdPermanentPurgeRequested.v1";
  processId?: string;
}): NotificationLifecycleSignalDecision {
  if (input.eventType === "HouseholdDeleted.v1") {
    return { kind: "Ignored", reason: "LOGICAL_DELETE_DOES_NOT_PURGE" };
  }
  if (input.processId === undefined || input.processId.length === 0) {
    throw new Error("Permanent purge processId is required");
  }
  return { kind: "AcceptedForPurge", processId: input.processId };
}

export function notificationPurgeRecordKey(record: {
  kind: string;
  recordId: string;
}): string {
  return `${record.kind}\u0000${record.recordId}`;
}

export function nextNotificationPurgeCheckpoint(record: {
  kind: string;
  recordId: string;
}): string {
  return `AFTER:${encodeURIComponent(record.kind)}:${encodeURIComponent(record.recordId)}`;
}

export function notificationPurgeCheckpointKey(
  checkpoint: string,
): string | null {
  if (checkpoint === "START") {
    return null;
  }
  const match = /^AFTER:([^:]+):([^:]+)$/.exec(checkpoint);
  if (match === null) {
    throw new Error("Invalid notification purge checkpoint");
  }
  return `${decodeURIComponent(match[1])}\u0000${decodeURIComponent(match[2])}`;
}
