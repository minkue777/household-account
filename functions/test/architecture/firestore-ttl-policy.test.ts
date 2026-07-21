import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const REQUIRED_TTL_COLLECTION_GROUPS = [
  "shortcutIngressCounters",
  "shortcutHttpReceipts",
  "receipts",
  "recurringCommandReceipts",
  "captureSubmissionReceipts",
  "instrumentCatalogReceipts",
  "notificationEndpoints",
  "notificationInboxes",
  "notificationIntents",
  "notificationDeliveries",
  "shortcutNotificationInboxes",
  "outboxEvents",
  "scheduledJobRuns",
  "scheduledJobResults",
  "scheduledJobMonitorReceipts",
  "scheduledJobIncidents",
] as const;

describe("Firestore TTL deployment policy", () => {
  it("모든 임시·terminal collection group에 expiresAt TTL override를 선언한다", () => {
    const indexes = JSON.parse(
      readFileSync(new URL("../../../firestore.indexes.json", import.meta.url), "utf8"),
    ) as {
      fieldOverrides?: readonly {
        collectionGroup?: string;
        fieldPath?: string;
        ttl?: boolean;
      }[];
    };
    const configured = new Set(
      (indexes.fieldOverrides ?? [])
        .filter(({ fieldPath, ttl }) => fieldPath === "expiresAt" && ttl === true)
        .map(({ collectionGroup }) => collectionGroup),
    );

    expect([...REQUIRED_TTL_COLLECTION_GROUPS].sort()).toEqual(
      [...configured].sort(),
    );
  });
});
