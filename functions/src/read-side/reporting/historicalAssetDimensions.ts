export type HistoricalOwnerRefKey = "household" | `profile:${string}`;

export interface HistoricalAssetSnapshot {
  snapshotDate: string;
  total: number;
  byType: Readonly<Record<string, number>>;
  byOwnerRefKey: Readonly<
    Partial<Record<HistoricalOwnerRefKey, number>>
  >;
}

export interface HistoricalAssetDimensionsSeed {
  sourcesByPeriodKey: Readonly<
    Record<
      string,
      {
        baseline?: HistoricalAssetSnapshot;
        window: readonly HistoricalAssetSnapshot[];
        sourceCheckpoint: string;
      }
    >
  >;
  currentAssets: readonly {
    type: string;
    ownerRefKey: HistoricalOwnerRefKey;
    lifecycle: "active" | "deleted";
  }[];
  ownerProfiles: readonly {
    ownerRefKey: HistoricalOwnerRefKey;
    displayName: string;
    lifecycle: "active" | "archived";
  }[];
  typeLabels: Readonly<Record<string, string>>;
}

export type HistoricalAssetStatisticsResult =
  | {
      kind: "success";
      value: {
        typeFilters: readonly { key: string; label: string }[];
        ownerFilters: readonly {
          key: HistoricalOwnerRefKey;
          label: string;
          profileState: "active" | "archived" | "not-applicable";
        }[];
        selectedType: "ALL" | string;
        selectedOwner: "ALL" | HistoricalOwnerRefKey;
        points: readonly HistoricalAssetSnapshot[];
        sourceCheckpoint: string;
      };
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

export interface HistoricalAssetDimensionsQuery {
  getStatistics(input: {
    householdId: string;
    periodKey: string;
    selectedType: "ALL" | string;
    selectedOwner: "ALL" | HistoricalOwnerRefKey;
  }): Promise<HistoricalAssetStatisticsResult>;
}

export function createHistoricalAssetDimensionsQuery(
  seed: HistoricalAssetDimensionsSeed,
): HistoricalAssetDimensionsQuery {
  return {
    getStatistics: async (input) => {
      const source = seed.sourcesByPeriodKey[input.periodKey];
      if (source === undefined) return { kind: "no-data" };

      const points = [
        ...(source.baseline === undefined ? [] : [source.baseline]),
        ...source.window,
      ];
      if (points.length === 0) return { kind: "no-data" };

      const typeKeys = [...new Set(points.flatMap((point) => Object.keys(point.byType)))].sort();
      const ownerKeys = [
        ...new Set(
          points.flatMap((point) =>
            Object.keys(point.byOwnerRefKey) as HistoricalOwnerRefKey[],
          ),
        ),
      ].sort((left, right) => {
        if (left === "household") return -1;
        if (right === "household") return 1;
        return left.localeCompare(right);
      });
      const profiles = new Map(
        seed.ownerProfiles.map((profile) => [profile.ownerRefKey, profile]),
      );

      return {
        kind: "success",
        value: {
          typeFilters: typeKeys.map((key) => ({
            key,
            label: seed.typeLabels[key] ?? key,
          })),
          ownerFilters: ownerKeys.map((key) => {
            if (key === "household") {
              return {
                key,
                label: "공동",
                profileState: "not-applicable" as const,
              };
            }
            const profile = profiles.get(key);
            return {
              key,
              label: profile?.displayName ?? key,
              profileState: profile?.lifecycle ?? "archived",
            };
          }),
          selectedType:
            input.selectedType !== "ALL" && typeKeys.includes(input.selectedType)
              ? input.selectedType
              : "ALL",
          selectedOwner:
            input.selectedOwner !== "ALL" && ownerKeys.includes(input.selectedOwner)
              ? input.selectedOwner
              : "ALL",
          points,
          sourceCheckpoint: source.sourceCheckpoint,
        },
      };
    },
  };
}
