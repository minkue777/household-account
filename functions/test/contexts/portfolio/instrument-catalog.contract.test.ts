import { describe, expect, it } from "vitest";
import { createInstrumentCatalogFixture } from "../../support/instrument-catalog-fixture";

interface InstrumentRef {
  market: "KRX" | "US";
  code: string;
  name: string;
  instrumentType: "STOCK" | "ETF" | "ETN";
}

interface CatalogSnapshot {
  schemaVersion: 1;
  asOfDate: string;
  catalogVersion: string;
  objectPath: string;
  objectGeneration: string;
  checksum: string;
  itemCount: number;
  items: readonly InstrumentRef[];
}

interface CatalogManifest {
  schemaVersion: 1;
  catalogVersion: string;
  snapshotObject: string;
  snapshotGeneration: string;
  asOfDate: string;
  publishedAt: string;
  sha256: string;
  itemCount: number;
  sources: readonly { provider: string; asOfDate: string; itemCount: number }[];
  /** latest.json 객체 자체의 Storage metadata입니다. */
  manifestGeneration: string;
}

type CatalogSourceResult =
  | { kind: "success"; items: readonly InstrumentRef[] }
  | {
      kind: "retryable-failure" | "contract-failure" | "invalid-data";
      code: string;
    };

interface PublishCatalogCommand {
  runId: string;
  asOfDate: string;
}

interface CatalogRunFixture {
  domesticSource: CatalogSourceResult;
  usSource: CatalogSourceResult;
  uploadVerification?: "valid" | "checksum-mismatch" | "metadata-mismatch";
  expectedManifestGeneration?: string;
}

type PublishCatalogResult =
  | {
      kind: "published";
      manifest: CatalogManifest;
    }
  | {
      kind: "partial-failure" | "retryable-failure" | "contract-failure";
      code: string;
    };

interface StorageReadScenario {
  manifest: "available" | "unavailable";
  snapshot: "available" | "unavailable" | "checksum-mismatch";
  /** 다른 publisher가 원자 교체한 manifest를 읽는 상황을 재현합니다. */
  visibleManifest?: CatalogManifest;
  visibleSnapshot?: CatalogSnapshot;
}

interface ReadCatalogCommand {
  now: string;
  storage: StorageReadScenario;
}

type ReadCatalogResult =
  | {
      kind: "success";
      snapshot: CatalogSnapshot;
      manifestGeneration: string;
      stale: boolean;
    }
  | { kind: "retryable-failure"; code: "CATALOG_UNAVAILABLE" };

interface CatalogPublicationState {
  latest?: CatalogManifest;
  successfulSnapshots: readonly CatalogSnapshot[];
}

interface InstrumentCatalogFixture {
  storage?: CatalogPublicationState;
  minimumSourceCounts: { domestic: number; us: number };
  runs: Readonly<Record<string, CatalogRunFixture>>;
  /** 금지된 legacy fallback이 존재해도 읽지 않는다는 경계 테스트 전용 입력입니다. */
  legacyStocksJson?: readonly InstrumentRef[];
}

/** Cloud Storage publish와 인스턴스 메모리 read cache의 공개 계약입니다. */
export interface InstrumentCatalogSubject {
  publish(command: PublishCatalogCommand): Promise<PublishCatalogResult>;
  read(command: ReadCatalogCommand): Promise<ReadCatalogResult>;
  publicationState(): Promise<CatalogPublicationState>;
}

export function createSubject(
  fixture: InstrumentCatalogFixture,
): InstrumentCatalogSubject {
  return createInstrumentCatalogFixture(fixture);
}

const domesticItems: readonly InstrumentRef[] = [
  {
    market: "KRX",
    code: "005930",
    name: "삼성전자",
    instrumentType: "STOCK",
  },
  {
    market: "KRX",
    code: "069500",
    name: "KODEX 200",
    instrumentType: "ETF",
  },
  {
    market: "KRX",
    code: "Q530056",
    name: "삼성 인버스 2X 천연가스 선물 ETN C",
    instrumentType: "ETN",
  },
];

const usItems: readonly InstrumentRef[] = [
  {
    market: "US",
    code: "AAPL",
    name: "Apple Inc.",
    instrumentType: "STOCK",
  },
  {
    market: "US",
    code: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    instrumentType: "ETF",
  },
];

const sourceSuccess = (
  items: readonly InstrumentRef[],
): CatalogSourceResult => ({ kind: "success", items });

const publishCommand = (
  asOfDate: string,
): PublishCatalogCommand => ({
  runId: `instrument-catalog:${asOfDate}:v1`,
  asOfDate,
});

const catalogRun = (
  overrides: Partial<CatalogRunFixture> = {},
): CatalogRunFixture => ({
  domesticSource: sourceSuccess(domesticItems),
  usSource: sourceSuccess(usItems),
  uploadVerification: "valid",
  ...overrides,
});

const snapshot = (
  asOfDate: string,
  generation: string,
  items: readonly InstrumentRef[] = [...domesticItems, ...usItems],
): CatalogSnapshot => ({
  schemaVersion: 1,
  asOfDate,
  catalogVersion: "v1",
  objectPath: `market-catalog/v1/snapshots/${asOfDate}/v1.json.gz`,
  objectGeneration: `snapshot-${generation}`,
  checksum: `sha256:${generation}`,
  itemCount: items.length,
  items,
});

const manifest = (
  catalogSnapshot: CatalogSnapshot,
  generation: string,
): CatalogManifest => ({
  schemaVersion: 1,
  catalogVersion: catalogSnapshot.catalogVersion,
  snapshotObject: catalogSnapshot.objectPath,
  snapshotGeneration: catalogSnapshot.objectGeneration,
  asOfDate: catalogSnapshot.asOfDate,
  publishedAt: `${catalogSnapshot.asOfDate}T06:00:00+09:00`,
  sha256: catalogSnapshot.checksum,
  itemCount: catalogSnapshot.itemCount,
  sources: [
    { provider: "domestic-catalog", asOfDate: catalogSnapshot.asOfDate, itemCount: domesticItems.length },
    { provider: "us-catalog", asOfDate: catalogSnapshot.asOfDate, itemCount: usItems.length },
  ],
  manifestGeneration: generation,
});

const storedCatalog = (
  asOfDate = "2026-07-18",
  generation = "generation-18",
): CatalogPublicationState => {
  const catalogSnapshot = snapshot(asOfDate, generation);
  return {
    latest: manifest(catalogSnapshot, generation),
    successfulSnapshots: [catalogSnapshot],
  };
};

describe("종목 카탈로그 snapshot·cache·fallback 금지 공개 계약", () => {
  it("[T-MARKET-002][MARKET-005] 검증 성공 snapshot만 immutable 경로에 발행하고 latest를 그 객체로 교체한다", async () => {
    const subject = createSubject({
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: { "2026-07-19": catalogRun() },
    });

    const result = await subject.publish(publishCommand("2026-07-19"));

    expect(result.kind).toBe("published");
    if (result.kind !== "published") return;
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      asOfDate: "2026-07-19",
      catalogVersion: "v1",
      snapshotObject:
        "market-catalog/v1/snapshots/2026-07-19/v1.json.gz",
      itemCount: domesticItems.length + usItems.length,
    });
    expect(result.manifest.sha256).not.toBe("");
    expect(result.manifest.snapshotGeneration).not.toBe("");
    expect(await subject.publicationState()).toMatchObject({
      latest: result.manifest,
      successfulSnapshots: [
        expect.objectContaining({
          asOfDate: "2026-07-19",
          objectPath: result.manifest.snapshotObject,
          objectGeneration: result.manifest.snapshotGeneration,
          checksum: result.manifest.sha256,
        }),
      ],
    });
  });

  it("[T-MARKET-002][MARKET-005] 같은 asOfDate·schema run 재전달은 최초 manifest를 재생하고 snapshot을 중복 발행하지 않는다", async () => {
    const subject = createSubject({
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: { "2026-07-19": catalogRun() },
    });
    const request = publishCommand("2026-07-19");

    const first = await subject.publish(request);
    const replay = await subject.publish(request);

    expect(replay).toEqual(first);
    expect((await subject.publicationState()).successfulSnapshots).toHaveLength(1);
  });

  it("[T-MARKET-002][MARKET-005] 네 번째 성공 뒤 latest와 무관한 과거본만 정리해 최근 성공 snapshot 세 개를 보존한다", async () => {
    const subject = createSubject({
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: Object.fromEntries(
        ["2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"].map(
          (date) => [date, catalogRun()],
        ),
      ),
    });

    for (const date of ["2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"]) {
      const result = await subject.publish(publishCommand(date));
      expect(result.kind).toBe("published");
    }

    const state = await subject.publicationState();
    expect(
      state.successfulSnapshots.map(({ asOfDate }) => asOfDate).sort(),
    ).toEqual(["2026-07-17", "2026-07-18", "2026-07-19"]);
    expect(state.latest?.asOfDate).toBe("2026-07-19");
    expect(state.successfulSnapshots).toHaveLength(3);
  });

  it.each([
    {
      name: "국내 source 일부 실패",
      overrides: {
        domesticSource: {
          kind: "retryable-failure",
          code: "DOMESTIC_CATALOG_UNAVAILABLE",
        },
      } satisfies Partial<CatalogRunFixture>,
    },
    {
      name: "정상 성공으로 위장한 빈 source",
      overrides: {
        domesticSource: sourceSuccess([]),
      } satisfies Partial<CatalogRunFixture>,
    },
    {
      name: "같은 market·code 중복",
      overrides: {
        domesticSource: sourceSuccess([domesticItems[0]!, domesticItems[0]!]),
      } satisfies Partial<CatalogRunFixture>,
    },
    {
      name: "업로드 재검증 checksum 불일치",
      overrides: {
        uploadVerification: "checksum-mismatch",
      } satisfies Partial<CatalogRunFixture>,
    },
  ])(
    "[T-MARKET-002][MARKET-005] $name이면 기존 latest와 성공 snapshot을 그대로 유지한다",
    async ({ overrides }) => {
      const initial = storedCatalog();
      const subject = createSubject({
        storage: initial,
        minimumSourceCounts: { domestic: 1, us: 1 },
        runs: {
          "2026-07-19": catalogRun({
            expectedManifestGeneration: initial.latest?.manifestGeneration,
            ...overrides,
          }),
        },
      });

      const result = await subject.publish(publishCommand("2026-07-19"));

      expect(result.kind).not.toBe("published");
      expect(await subject.publicationState()).toEqual(initial);
    },
  );

  it("[T-MARKET-002][MARKET-005] manifest generation 경합은 검증한 snapshot을 latest로 강제 덮어쓰지 않는다", async () => {
    const initial = storedCatalog();
    const subject = createSubject({
      storage: initial,
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: {
        "2026-07-19": catalogRun({
          expectedManifestGeneration: "stale-generation",
        }),
      },
    });

    const result = await subject.publish(publishCommand("2026-07-19"));

    expect(result.kind).not.toBe("published");
    expect(await subject.publicationState()).toEqual(initial);
  });

  it("[T-MARKET-002][MARKET-005] TTL 전에는 메모리 snapshot을 그대로 제공한다", async () => {
    const initial = storedCatalog();
    const subject = createSubject({
      storage: initial,
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: {},
    });
    const available: StorageReadScenario = {
      manifest: "available",
      snapshot: "available",
    };
    const first = await subject.read({
      now: "2026-07-19T09:00:00+09:00",
      storage: available,
    });

    const beforeTtl = await subject.read({
      now: "2026-07-19T09:04:59+09:00",
      storage: { manifest: "unavailable", snapshot: "unavailable" },
    });

    expect(first.kind).toBe("success");
    expect(beforeTtl).toEqual(first);
    expect(beforeTtl).toMatchObject({ kind: "success", stale: false });
  });

  it("[T-MARKET-002][MARKET-005] TTL 뒤 manifest generation이 같으면 snapshot 재조회 없이 cache를 정상 갱신한다", async () => {
    const initial = storedCatalog();
    const subject = createSubject({
      storage: initial,
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: {},
    });
    await subject.read({
      now: "2026-07-19T09:00:00+09:00",
      storage: { manifest: "available", snapshot: "available" },
    });

    const result = await subject.read({
      now: "2026-07-19T09:05:01+09:00",
      storage: { manifest: "available", snapshot: "unavailable" },
    });

    expect(result).toMatchObject({
      kind: "success",
      snapshot: initial.successfulSnapshots[0],
      manifestGeneration: initial.latest?.manifestGeneration,
      stale: false,
    });
  });

  it("[T-MARKET-002][MARKET-005] warm cache에서 Storage를 읽지 못하면 원래 asOfDate의 stale snapshot을 제공한다", async () => {
    const initial = storedCatalog();
    const subject = createSubject({
      storage: initial,
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: {},
    });
    await subject.read({
      now: "2026-07-19T09:00:00+09:00",
      storage: { manifest: "available", snapshot: "available" },
    });

    const result = await subject.read({
      now: "2026-07-19T09:05:01+09:00",
      storage: { manifest: "unavailable", snapshot: "unavailable" },
    });

    expect(result).toMatchObject({
      kind: "success",
      snapshot: expect.objectContaining({ asOfDate: "2026-07-18" }),
      manifestGeneration: initial.latest?.manifestGeneration,
      stale: true,
    });
  });

  it("[T-MARKET-002][MARKET-005] 새 generation 검증 실패는 warm cache를 원자적으로 보존한다", async () => {
    const initial = storedCatalog();
    const nextSnapshot = snapshot("2026-07-19", "generation-19");
    const nextManifest = manifest(nextSnapshot, "generation-19");
    const subject = createSubject({
      storage: initial,
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: {},
    });
    await subject.read({
      now: "2026-07-19T09:00:00+09:00",
      storage: { manifest: "available", snapshot: "available" },
    });

    const result = await subject.read({
      now: "2026-07-19T09:05:01+09:00",
      storage: {
        manifest: "available",
        snapshot: "checksum-mismatch",
        visibleManifest: nextManifest,
        visibleSnapshot: nextSnapshot,
      },
    });

    expect(result).toMatchObject({
      kind: "success",
      snapshot: initial.successfulSnapshots[0],
      manifestGeneration: initial.latest?.manifestGeneration,
      stale: true,
    });
  });

  it("[T-MARKET-002][MARKET-005] cold cache에서 Storage 실패 시 stocks.json 대신 RetryableFailure를 반환한다", async () => {
    const legacyOnlyItem: InstrumentRef = {
      market: "KRX",
      code: "LEGACY",
      name: "legacy stocks.json item",
      instrumentType: "STOCK",
    };
    const subject = createSubject({
      storage: storedCatalog(),
      minimumSourceCounts: { domestic: 1, us: 1 },
      runs: {},
      legacyStocksJson: [legacyOnlyItem],
    });

    const result = await subject.read({
      now: "2026-07-19T09:00:00+09:00",
      storage: { manifest: "unavailable", snapshot: "unavailable" },
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "CATALOG_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain(legacyOnlyItem.code);
  });
});
