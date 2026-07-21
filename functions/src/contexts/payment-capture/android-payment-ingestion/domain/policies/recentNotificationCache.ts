import type {
  NotificationIngressState,
  RecentNotificationClaimInput,
  RecentNotificationDecision,
  RecentNotificationEntry,
} from "../model/notificationIngress";

const DUPLICATE_WINDOW_MILLISECONDS = 30_000;
const CACHE_KEY_VERSION = "recent-notification.v1";

function cacheKey(input: {
  readonly packageName: string;
  readonly parseText: string;
}): string {
  return `${CACHE_KEY_VERSION}:${JSON.stringify([
    input.packageName,
    input.parseText,
  ])}`;
}

export interface RecentNotificationCache {
  claim(input: RecentNotificationClaimInput): RecentNotificationDecision;
  restartProcess(): void;
  state(): NotificationIngressState;
}

export function createRecentNotificationCache(): RecentNotificationCache {
  const entries = new Map<string, RecentNotificationEntry>();

  return {
    claim: (input) => {
      for (const [key, entry] of entries) {
        if (
          input.receivedAtMilliseconds - entry.acceptedAtMilliseconds >
          DUPLICATE_WINDOW_MILLISECONDS
        ) {
          entries.delete(key);
        }
      }

      const key = cacheKey(input);
      const existing = entries.get(key);
      if (existing !== undefined) {
        return {
          kind: "Duplicate",
          ageInMilliseconds:
            input.receivedAtMilliseconds - existing.acceptedAtMilliseconds,
        };
      }

      entries.set(key, {
        packageName: input.packageName,
        parseText: input.parseText,
        acceptedAtMilliseconds: input.receivedAtMilliseconds,
      });
      return { kind: "Accepted" };
    },
    restartProcess: () => entries.clear(),
    state: () => ({
      recentEntries: [...entries.values()].map((entry) => ({ ...entry })),
    }),
  };
}
