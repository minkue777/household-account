import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import type {
  CatalogPublicationStore,
  CatalogReadStore,
  InstrumentCatalogRunSource,
} from "../../../contexts/portfolio/holdings/application/ports/out/instrumentCatalogPorts";
import type {
  CatalogManifest,
  CatalogPublicationState,
  CatalogRunData,
  CatalogSnapshot,
  PublishCatalogResult,
} from "../../../contexts/portfolio/holdings/domain/model/instrumentCatalog";
import type { CatalogInstrument } from "../../../contexts/portfolio/holdings/domain/model/instrumentSearch";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

type StorageBucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

const CATALOG_VERSION = "v1";
const CATALOG_PREFIX = `market-catalog/${CATALOG_VERSION}`;
const LATEST_OBJECT = `${CATALOG_PREFIX}/latest.json`;
const RECEIPTS = "instrumentCatalogReceipts";
const NAVER_MARKET_API = "https://m.stock.naver.com/api/stocks/marketValue";
const NAVER_ETF_API =
  "https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc";
const KRX_CORPORATION_LIST =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const NASDAQ_LISTED =
  "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED =
  "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";
const PAGE_SIZE = 100;

interface NaverMarketRow {
  readonly itemCode?: unknown;
  readonly stockName?: unknown;
  readonly stockEndType?: unknown;
}

interface NaverMarketResponse {
  readonly totalCount?: unknown;
  readonly stocks?: readonly NaverMarketRow[];
}

interface StoredCatalogBody {
  readonly schemaVersion: 1;
  readonly asOfDate: string;
  readonly catalogVersion: string;
  readonly itemCount: number;
  readonly items: readonly CatalogInstrument[];
}

function requestHeaders(): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (compatible; HouseholdAccountCatalog/1.0)",
    Accept: "application/json,text/plain,text/html,*/*",
  };
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`CATALOG_SOURCE_HTTP_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse((await fetchBytes(url)).toString("utf8")) as T;
}

async function fetchNaverMarket(market: "KOSPI" | "KOSDAQ") {
  const page = (number: number) =>
    fetchJson<NaverMarketResponse>(
      `${NAVER_MARKET_API}/${market}?page=${number}&pageSize=${PAGE_SIZE}`,
    );
  const first = await page(1);
  const total = Number(first.totalCount);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error("CATALOG_DOMESTIC_COUNT_INVALID");
  }
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const payloads: NaverMarketResponse[] = [first];
  for (let start = 2; start <= pageCount; start += 6) {
    payloads.push(
      ...(await Promise.all(
        Array.from(
          { length: Math.min(6, pageCount - start + 1) },
          (_, index) => page(start + index),
        ),
      )),
    );
  }
  const rows = payloads.flatMap(({ stocks }) => stocks ?? []);
  if (rows.length !== total) throw new Error("CATALOG_DOMESTIC_PAGE_INCOMPLETE");
  return rows.map((row) => {
    const code = String(row.itemCode ?? "").trim();
    const name = String(row.stockName ?? "").trim();
    if (code === "" || name === "") throw new Error("CATALOG_DOMESTIC_ROW_INVALID");
    return { code, name, kind: String(row.stockEndType ?? "").toUpperCase() };
  });
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/giu, "&")
    .replace(/&nbsp;/giu, " ")
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/\s+/gu, " ")
    .trim();
}

async function fetchKonexCandidates() {
  const html = new TextDecoder("euc-kr").decode(
    await fetchBytes(KRX_CORPORATION_LIST),
  );
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)]
    .slice(1)
    .map((match) =>
      [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/giu)].map((cell) =>
        decodeHtmlText(cell[1]),
      ),
    )
    .filter((cells) => cells.length >= 3 && /^\d{6}$/u.test(cells[2] ?? ""))
    .map((cells) => ({ code: cells[2], name: cells[0], kind: "STOCK" }));
}

async function fetchEtfCodes(): Promise<ReadonlySet<string>> {
  const text = new TextDecoder("euc-kr").decode(await fetchBytes(NAVER_ETF_API));
  const parsed = JSON.parse(text) as {
    result?: { etfItemList?: readonly { itemcode?: unknown }[] };
  };
  const rows = parsed.result?.etfItemList;
  if (!Array.isArray(rows) || rows.length < 500) {
    throw new Error("CATALOG_ETF_SOURCE_INVALID");
  }
  return new Set(rows.map(({ itemcode }) => String(itemcode ?? "").trim()));
}

function headerIndex(line: string): Readonly<Record<string, number>> {
  return Object.fromEntries(
    line.split("|").map((field, index) => [field.trim(), index]),
  );
}

function field(
  columns: readonly string[],
  index: Readonly<Record<string, number>>,
  name: string,
): string {
  const position = index[name];
  return position === undefined ? "" : (columns[position] ?? "").trim();
}

function parseUsSymbols(
  text: string,
  kind: "nasdaq" | "other",
): readonly CatalogInstrument[] {
  const lines = text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const index = headerIndex(lines[0] ?? "");
  return lines
    .slice(1)
    .filter((line) => !line.startsWith("File Creation Time"))
    .map((line) => line.split("|"))
    .filter((columns) => field(columns, index, "Test Issue") !== "Y")
    .map((columns): CatalogInstrument | undefined => {
      const code =
        kind === "nasdaq"
          ? field(columns, index, "Symbol")
          : field(columns, index, "ACT Symbol") ||
            field(columns, index, "NASDAQ Symbol") ||
            field(columns, index, "CQS Symbol");
      const name = field(columns, index, "Security Name");
      if (code === "" || name === "") return undefined;
      return {
        market: "US",
        instrumentType:
          field(columns, index, "ETF") === "Y" ? "ETF" : "STOCK",
        code,
        name,
      };
    })
    .filter((value): value is CatalogInstrument => value !== undefined);
}

async function loadDomesticCatalog(): Promise<readonly CatalogInstrument[]> {
  const [kospi, kosdaq, konex, etfCodes] = await Promise.all([
    fetchNaverMarket("KOSPI"),
    fetchNaverMarket("KOSDAQ"),
    fetchKonexCandidates(),
    fetchEtfCodes(),
  ]);
  const unique = new Map<string, CatalogInstrument>();
  for (const row of [...kospi, ...kosdaq, ...konex]) {
    const instrumentType = etfCodes.has(row.code)
      ? "ETF"
      : row.kind.includes("ETN")
        ? "ETN"
        : "STOCK";
    unique.set(row.code, {
      market: "KRX",
      instrumentType,
      code: row.code,
      name: row.name,
    });
  }
  for (const code of etfCodes) {
    if (!unique.has(code)) throw new Error("CATALOG_ETF_MARKET_MISMATCH");
  }
  return [...unique.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
}

async function loadUsCatalog(): Promise<readonly CatalogInstrument[]> {
  const [nasdaq, other] = await Promise.all([
    fetchBytes(NASDAQ_LISTED),
    fetchBytes(OTHER_LISTED),
  ]);
  const unique = new Map<string, CatalogInstrument>();
  for (const item of [
    ...parseUsSymbols(nasdaq.toString("utf8"), "nasdaq"),
    ...parseUsSymbols(other.toString("utf8"), "other"),
  ]) {
    const previous = unique.get(item.code);
    if (previous === undefined || previous.instrumentType !== "ETF") {
      unique.set(item.code, item);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
}

async function currentManifestGeneration(
  bucket: StorageBucket,
): Promise<string | undefined> {
  const file = bucket.file(LATEST_OBJECT);
  const [exists] = await file.exists();
  if (!exists) return undefined;
  const [metadata] = await file.getMetadata();
  return String(metadata.generation);
}

export class RemoteInstrumentCatalogRunSource
  implements InstrumentCatalogRunSource
{
  constructor(private readonly bucket: StorageBucket) {}

  async load(_asOfDate: string): Promise<CatalogRunData> {
    const [domestic, us, manifestGeneration] = await Promise.allSettled([
      loadDomesticCatalog(),
      loadUsCatalog(),
      currentManifestGeneration(this.bucket),
    ]);
    if (manifestGeneration.status === "rejected") {
      return {
        domesticSource: { kind: "retryable-failure", code: "CATALOG_STORAGE_UNAVAILABLE" },
        usSource: { kind: "retryable-failure", code: "CATALOG_STORAGE_UNAVAILABLE" },
      };
    }
    return {
      domesticSource:
        domestic.status === "fulfilled"
          ? { kind: "success", items: domestic.value }
          : { kind: "retryable-failure", code: "DOMESTIC_CATALOG_UNAVAILABLE" },
      usSource:
        us.status === "fulfilled"
          ? { kind: "success", items: us.value }
          : { kind: "retryable-failure", code: "US_CATALOG_UNAVAILABLE" },
      ...(manifestGeneration.value === undefined
        ? {}
        : { expectedManifestGeneration: manifestGeneration.value }),
      uploadVerification: "valid",
    };
  }
}

function checksum(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseManifest(buffer: Buffer): CatalogManifest {
  return JSON.parse(buffer.toString("utf8")) as CatalogManifest;
}

function snapshotPath(asOfDate: string): string {
  return `${CATALOG_PREFIX}/snapshots/${asOfDate}/${CATALOG_VERSION}.json.gz`;
}

export class FirebaseInstrumentCatalogStorage
  implements CatalogPublicationStore, CatalogReadStore
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly bucket: StorageBucket,
  ) {}

  async findReceipt(runId: string): Promise<PublishCatalogResult | undefined> {
    const snapshot = await this.database
      .collection("operations")
      .doc("runtime")
      .collection(RECEIPTS)
      .doc(documentId(runId))
      .get();
    return snapshot.exists
      ? (snapshot.data()?.result as PublishCatalogResult | undefined)
      : undefined;
  }

  async state(): Promise<CatalogPublicationState> {
    const manifestRead = await this.readManifest();
    if (manifestRead.kind === "unavailable") return { successfulSnapshots: [] };
    const snapshotRead = await this.readSnapshot(manifestRead.value);
    return {
      latest: manifestRead.value,
      successfulSnapshots:
        snapshotRead.kind === "available" ? [snapshotRead.value] : [],
    };
  }

  async commit(input: Parameters<CatalogPublicationStore["commit"]>[0]) {
    const objectPath = snapshotPath(input.snapshot.asOfDate);
    const body: StoredCatalogBody = {
      schemaVersion: 1,
      asOfDate: input.snapshot.asOfDate,
      catalogVersion: CATALOG_VERSION,
      itemCount: input.snapshot.items.length,
      items: input.snapshot.items,
    };
    const compressed = gzipSync(Buffer.from(JSON.stringify(body), "utf8"), {
      level: 9,
    });
    const sha256 = checksum(compressed);
    const snapshotFile = this.bucket.file(objectPath);
    const [snapshotExists] = await snapshotFile.exists();
    if (!snapshotExists) {
      await snapshotFile.save(compressed, {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: "application/gzip",
          cacheControl: "public,max-age=31536000,immutable",
          metadata: { sha256 },
        },
      });
    } else {
      const [existing] = await snapshotFile.download();
      if (checksum(existing) !== sha256) {
        throw new Error("CATALOG_IMMUTABLE_SNAPSHOT_CONFLICT");
      }
    }
    const [snapshotMetadata] = await snapshotFile.getMetadata();
    const snapshotGeneration = String(snapshotMetadata.generation);
    const plannedManifest: CatalogManifest = {
      schemaVersion: 1,
      catalogVersion: CATALOG_VERSION,
      snapshotObject: objectPath,
      snapshotGeneration,
      asOfDate: input.snapshot.asOfDate,
      publishedAt: new Date().toISOString(),
      sha256,
      itemCount: body.itemCount,
      sources: input.manifest.sources,
      manifestGeneration: "pending",
    };
    const latest = this.bucket.file(LATEST_OBJECT);
    const currentGeneration = await currentManifestGeneration(this.bucket);
    if (currentGeneration !== input.expectedManifestGeneration) {
      return "generation-conflict" as const;
    }
    await latest.save(Buffer.from(JSON.stringify(plannedManifest), "utf8"), {
      resumable: false,
      validation: "crc32c",
      preconditionOpts: {
        ifGenerationMatch:
          input.expectedManifestGeneration === undefined
            ? 0
            : Number(input.expectedManifestGeneration),
      },
      metadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "public,max-age=60,must-revalidate",
      },
    });
    const [manifestMetadata] = await latest.getMetadata();
    const manifest: CatalogManifest = {
      ...plannedManifest,
      manifestGeneration: String(manifestMetadata.generation),
    };
    const result: PublishCatalogResult = { kind: "published", manifest };
    await this.database
      .collection("operations")
      .doc("runtime")
      .collection(RECEIPTS)
      .doc(documentId(input.runId))
      .set({
        runId: input.runId,
        result,
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: firestoreTtlAfter(new Date()),
      });
    await this.retainLatestSuccessfulDays(input.retainSuccessfulDays);
    return { kind: "committed", manifest } as const;
  }

  async readManifest() {
    try {
      const file = this.bucket.file(LATEST_OBJECT);
      const [[buffer], [metadata]] = await Promise.all([
        file.download(),
        file.getMetadata(),
      ]);
      return {
        kind: "available" as const,
        value: {
          ...parseManifest(buffer),
          manifestGeneration: String(metadata.generation),
        },
      };
    } catch (_error) {
      return { kind: "unavailable" as const };
    }
  }

  async readSnapshot(manifest: CatalogManifest) {
    try {
      const file = this.bucket.file(manifest.snapshotObject);
      const [[buffer], [metadata]] = await Promise.all([
        file.download(),
        file.getMetadata(),
      ]);
      if (
        String(metadata.generation) !== manifest.snapshotGeneration ||
        checksum(buffer) !== manifest.sha256
      ) {
        return { kind: "unavailable" as const };
      }
      const body = JSON.parse(
        gunzipSync(buffer).toString("utf8"),
      ) as StoredCatalogBody;
      const snapshot: CatalogSnapshot = {
        ...body,
        objectPath: manifest.snapshotObject,
        objectGeneration: manifest.snapshotGeneration,
        checksum: manifest.sha256,
      };
      return { kind: "available" as const, value: snapshot };
    } catch (_error) {
      return { kind: "unavailable" as const };
    }
  }

  private async retainLatestSuccessfulDays(days: number): Promise<void> {
    const [files] = await this.bucket.getFiles({
      prefix: `${CATALOG_PREFIX}/snapshots/`,
    });
    const dates = [...new Set(
      files
        .map(({ name }) => /\/snapshots\/(\d{4}-\d{2}-\d{2})\//u.exec(name)?.[1])
        .filter((value): value is string => value !== undefined),
    )].sort((left, right) => right.localeCompare(left));
    const retained = new Set(dates.slice(0, days));
    await Promise.all(
      files
        .filter(({ name }) => {
          const date = /\/snapshots\/(\d{4}-\d{2}-\d{2})\//u.exec(name)?.[1];
          return date !== undefined && !retained.has(date);
        })
        .map((file) => file.delete({ ignoreNotFound: true })),
    );
  }
}

function documentId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
