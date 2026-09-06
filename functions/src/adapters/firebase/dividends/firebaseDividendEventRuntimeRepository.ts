import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  DividendAnnouncementUpsertResult,
  DividendLifecycleEvidence,
  DividendEventRuntimeRepository,
  DividendTransitionResult,
  KindDividendDisclosure,
  ScheduledDividendEvent,
} from "../../../contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import type { DividendHoldingTargetView } from "../../../contexts/portfolio/holdings/public";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";

const EVENTS = "dividend_events";
const PROJECTIONS = "dividend_snapshots";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableEventId(
  householdId: string,
  sourceDisclosureId: string,
  instrumentCode: string,
): string {
  return `dividend-event:v3:${hash(
    `${householdId}\u0000KIND\u0000${sourceDisclosureId}\u0000${instrumentCode.toLocaleUpperCase("en-US")}`,
  )}`;
}

function receiptReference(
  database: firestore.Firestore,
  idempotencyKey: string,
): firestore.DocumentReference {
  return database
    .collection("operations")
    .doc("runtime")
    .collection("dividendReceipts")
    .doc(hash(idempotencyKey));
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function storedStatus(data: FirebaseFirestore.DocumentData):
  | "announced"
  | "fixed"
  | "paid" {
  if (data.status === "paid") return "paid";
  if (
    data.status === "fixed" ||
    (number(data.eligibleQuantity) !== undefined && number(data.totalAmount) !== undefined)
  ) {
    return "fixed";
  }
  return "announced";
}

function sameDisclosureFact(
  data: FirebaseFirestore.DocumentData,
  disclosure: KindDividendDisclosure,
): boolean {
  return (
    text(data.stockCode ?? data.instrumentCode) === disclosure.instrumentCode &&
    text(data.recordDate) === disclosure.recordDate &&
    text(data.paymentDate) === disclosure.paymentDate &&
    number(data.perShareAmount) === disclosure.perShareAmount
  );
}

function currentSourceMatches(
  data: FirebaseFirestore.DocumentData,
  sourceDisclosureId: string,
  instrumentCode: string,
): boolean {
  const storedInstrumentCode = text(data.instrumentCode ?? data.stockCode);
  return (
    storedInstrumentCode?.toLocaleUpperCase("en-US") ===
      instrumentCode.toLocaleUpperCase("en-US") &&
    (text(data.sourceDisclosureId) === sourceDisclosureId ||
      strings(data.disclosureAliases).includes(sourceDisclosureId))
  );
}

function resultFromReceipt<T>(snapshot: firestore.DocumentSnapshot): T | undefined {
  return snapshot.exists ? (snapshot.data()?.result as T | undefined) : undefined;
}

function eventDocument(input: {
  readonly eventId: string;
  readonly target: DividendHoldingTargetView;
  readonly disclosure: KindDividendDisclosure;
  readonly current?: FirebaseFirestore.DocumentData;
  readonly status: "announced" | "fixed";
  readonly aggregateVersion: number;
  readonly observedAt: string;
  readonly correction?: { readonly eligibleQuantity: number; readonly evidence: readonly DividendLifecycleEvidence[] };
}): FirebaseFirestore.DocumentData {
  const current = input.current;
  const eligibleQuantity = input.correction?.eligibleQuantity ?? number(current?.eligibleQuantity);
  const totalAmount =
    input.status === "fixed" && eligibleQuantity !== undefined
      ? Math.round(eligibleQuantity * input.disclosure.perShareAmount)
      : number(current?.totalAmount);
  return {
    schemaVersion: 1,
    eventId: input.eventId,
    householdId: input.target.householdId,
    source: "KIND",
    sourceDisclosureId: input.disclosure.sourceDisclosureId,
    disclosureAliases: [
      ...new Set([
        ...strings(current?.disclosureAliases),
        input.disclosure.sourceDisclosureId,
      ]),
    ].sort(),
    sourceAssetIds: [
      ...new Set([
        ...strings(current?.sourceAssetIds),
        ...input.target.sourceAssetIds,
      ]),
    ].sort(),
    instrument: input.target.instrument,
    instrumentCode: input.disclosure.instrumentCode,
    instrumentName: input.disclosure.instrumentName,
    stockCode: input.disclosure.instrumentCode,
    stockName: input.disclosure.instrumentName,
    recordDate: input.disclosure.recordDate,
    paymentDate: input.disclosure.paymentDate,
    paymentYear: Number(input.disclosure.paymentDate.slice(0, 4)),
    perShareAmount: input.disclosure.perShareAmount,
    status: input.status,
    ...(eligibleQuantity === undefined ? {} : { eligibleQuantity }),
    ...(totalAmount === undefined ? {} : { totalAmount }),
    ...(input.correction !== undefined ? { eligibilityContributions: input.correction.evidence.map(item => ({
      assetId: item.assetId, quantity: item.quantity,
      kind: item.selectionKind === "exact" ? "record-date-position" : "nearest-position-snapshot",
      snapshotDate: item.snapshotDate, sourceVersion: item.sourceVersion, observedAt: item.observedAt,
    })) } : Array.isArray(current?.eligibilityContributions)
      ? { eligibilityContributions: current.eligibilityContributions }
      : {}),
    sourceReferenceHash: input.disclosure.sourceReferenceHash,
    disclosedAt: input.disclosure.disclosedAt,
    aggregateVersion: input.aggregateVersion,
    updatedAt: input.observedAt,
    persistedAt: FieldValue.serverTimestamp(),
    ...(current === undefined ? { createdAt: input.observedAt } : {}),
  };
}

function scheduledEvent(
  snapshot: firestore.QueryDocumentSnapshot,
): ScheduledDividendEvent | undefined {
  const data = snapshot.data();
  const householdId = text(data.householdId);
  const instrumentCode = text(data.instrumentCode ?? data.stockCode);
  const instrumentName = text(data.instrumentName ?? data.stockName) ?? instrumentCode;
  const recordDate = text(data.recordDate);
  const paymentDate = text(data.paymentDate);
  const perShareAmount = number(data.perShareAmount);
  const status = storedStatus(data);
  if (
    status === "paid" ||
    householdId === undefined ||
    instrumentCode === undefined ||
    instrumentName === undefined ||
    recordDate === undefined ||
    paymentDate === undefined ||
    perShareAmount === undefined
  ) {
    return undefined;
  }
  const eventId = text(data.eventId) ?? `legacy-dividend:${snapshot.id}`;
  return {
    documentId: snapshot.id,
    eventId,
    householdId,
    sourceDisclosureId:
      text(data.sourceDisclosureId) ?? `legacy:${snapshot.id}`,
    sourceAssetIds: strings(data.sourceAssetIds),
    instrumentCode,
    instrumentName,
    recordDate,
    paymentDate,
    perShareAmount,
    status,
    ...(number(data.eligibleQuantity) === undefined
      ? {}
      : { eligibleQuantity: number(data.eligibleQuantity)! }),
    ...(number(data.totalAmount) === undefined
      ? {}
      : { totalAmount: number(data.totalAmount)! }),
    aggregateVersion: Math.max(1, Math.trunc(number(data.aggregateVersion) ?? 1)),
  };
}

export class FirebaseDividendEventRuntimeRepository
  implements DividendEventRuntimeRepository
{
  constructor(private readonly database: firestore.Firestore) {}

  private async matchingAnnouncement(input: { readonly target: DividendHoldingTargetView; readonly disclosure: KindDividendDisclosure }) {
    const events = await this.database.collection(EVENTS).where("householdId", "==", input.target.householdId).get();
    return events.docs.find(document => currentSourceMatches(document.data(), input.disclosure.sourceDisclosureId, input.disclosure.instrumentCode)) ??
      events.docs.find(document => text(document.data().sourceDisclosureId) === undefined && sameDisclosureFact(document.data(), input.disclosure));
  }

  async findAnnouncement(input: { readonly target: DividendHoldingTargetView; readonly disclosure: KindDividendDisclosure }) {
    const matching = await this.matchingAnnouncement(input);
    return matching === undefined ? undefined : scheduledEvent(matching);
  }

  async upsertAnnouncement(input: {
    readonly target: DividendHoldingTargetView;
    readonly disclosure: KindDividendDisclosure;
    readonly observedAt: string;
    readonly idempotencyKey: string;
    readonly correction?: { readonly expectedVersion: number; readonly eligibleQuantity: number; readonly evidence: readonly DividendLifecycleEvidence[] };
  }): Promise<DividendAnnouncementUpsertResult> {
    const receipt = receiptReference(this.database, input.idempotencyKey);
    const matching = await this.matchingAnnouncement(input);
    const canonicalEventId = stableEventId(
      input.target.householdId,
      input.disclosure.sourceDisclosureId,
      input.disclosure.instrumentCode,
    );
    const reference =
      matching?.ref ?? this.database.collection(EVENTS).doc(hash(canonicalEventId));
    const outbox = new FirebaseTransactionalOutbox(this.database);

    return this.database.runTransaction(async (transaction) => {
      const [receiptSnapshot, currentSnapshot] = await Promise.all([
        transaction.get(receipt),
        transaction.get(reference),
      ]);
      const replay = resultFromReceipt<DividendAnnouncementUpsertResult>(receiptSnapshot);
      if (replay !== undefined) return replay;
      const current = currentSnapshot.exists ? currentSnapshot.data() : undefined;
      const currentEventId = text(current?.eventId) ?? canonicalEventId;
      const currentVersion = Math.max(
        1,
        Math.trunc(number(current?.aggregateVersion) ?? 1),
      );
      if (storedStatus(current ?? {}) === "paid" && current !== undefined) {
        const result: DividendAnnouncementUpsertResult = {
          kind: "paid-preserved",
          eventId: currentEventId,
          aggregateVersion: currentVersion,
        };
        transaction.create(receipt, {
          schemaVersion: 1,
          result,
          committedAt: input.observedAt,
        });
        return result;
      }
      if (input.disclosure.disclosureState === "cancelled") {
        if (current === undefined) {
          const result: DividendAnnouncementUpsertResult = {
            kind: "unchanged",
            eventId: canonicalEventId,
            aggregateVersion: 0,
          };
          transaction.create(receipt, {
            schemaVersion: 1,
            result,
            committedAt: input.observedAt,
          });
          return result;
        }
        const result: DividendAnnouncementUpsertResult = {
          kind: "removed",
          eventId: currentEventId,
        };
        transaction.delete(reference);
        outbox.append(transaction, {
          eventId: hash(`${input.idempotencyKey}\u0000removed`),
          eventType: "DividendEventRemoved.v1",
          householdId: input.target.householdId,
          aggregateId: currentEventId,
          aggregateVersion: currentVersion + 1,
          occurredAt: input.observedAt,
          correlationId: input.idempotencyKey,
          causationId: input.idempotencyKey,
          payload: { reason: "DISCLOSURE_CANCELLED" },
        });
        transaction.create(receipt, {
          schemaVersion: 1,
          result,
          committedAt: input.observedAt,
        });
        return result;
      }

      const status = current === undefined ? "announced" : storedStatus(current);
      const requiresCorrection = status === "fixed" && current !== undefined &&
        (text(current.recordDate) !== input.disclosure.recordDate || number(current.perShareAmount) !== input.disclosure.perShareAmount);
      if (requiresCorrection && (input.correction === undefined || input.correction.evidence.length === 0)) {
        return { kind: "retryable-failure", code: "DIVIDEND_CORRECTION_EVIDENCE_REQUIRED" };
      }
      if (input.correction !== undefined && (currentVersion !== input.correction.expectedVersion || !Number.isFinite(input.correction.eligibleQuantity) || input.correction.eligibleQuantity < 0)) {
        return { kind: "retryable-failure", code: "DIVIDEND_VERSION_CONFLICT" };
      }
      const candidate = eventDocument({
        eventId: currentEventId,
        target: input.target,
        disclosure: input.disclosure,
        ...(current === undefined ? {} : { current }),
        status: status === "paid" ? "fixed" : status,
        aggregateVersion: current === undefined ? 1 : currentVersion + 1,
        observedAt: input.observedAt,
        ...(input.correction === undefined ? {} : { correction: input.correction }),
      });
      const unchanged =
        current !== undefined &&
        text(current.sourceReferenceHash) === input.disclosure.sourceReferenceHash &&
        strings(current.sourceAssetIds).slice().sort().join("|") ===
          candidate.sourceAssetIds.join("|") &&
        text(current.eventId) !== undefined;
      const result: DividendAnnouncementUpsertResult = unchanged
        ? {
            kind: "unchanged",
            eventId: currentEventId,
            aggregateVersion: currentVersion,
          }
        : {
            kind: current === undefined ? "created" : "changed",
            eventId: currentEventId,
            aggregateVersion: Number(candidate.aggregateVersion),
          };
      if (!unchanged) {
        transaction.set(reference, candidate, { merge: true });
        outbox.append(transaction, {
          eventId: hash(`${input.idempotencyKey}\u0000changed`),
          eventType: "DividendEventChanged.v1",
          householdId: input.target.householdId,
          aggregateId: currentEventId,
          aggregateVersion: Number(candidate.aggregateVersion),
          occurredAt: input.observedAt,
          correlationId: input.idempotencyKey,
          causationId: input.idempotencyKey,
          payload: { status: candidate.status },
        });
      }
      transaction.create(receipt, {
        schemaVersion: 1,
        result,
        committedAt: input.observedAt,
      });
      return result;
    });
  }

  async listNonterminal(input: { readonly cursor?: string; readonly limit: number }) {
    let query = this.database.collection(EVENTS).orderBy("__name__").limit(input.limit);
    if (input.cursor !== undefined) query = query.startAfter(input.cursor);
    const snapshot = await query.get();
    const items = snapshot.docs.flatMap((document) => {
        const event = scheduledEvent(document);
        return event === undefined ? [] : [event];
      });
    return {
      items,
      ...(snapshot.size === input.limit
        ? { nextCursor: snapshot.docs.at(-1)!.id }
        : {}),
    };
  }

  async transition(input: {
    readonly event: ScheduledDividendEvent;
    readonly targetStatus: "fixed" | "paid";
    readonly observedAt: string;
    readonly eligibleQuantity?: number;
    readonly evidence?: readonly {
      readonly assetId: string;
      readonly snapshotDate: string;
      readonly observedAt: string;
      readonly sourceVersion: string;
      readonly quantity: number;
      readonly selectionKind: "exact" | "nearest";
    }[];
    readonly idempotencyKey: string;
  }): Promise<DividendTransitionResult> {
    const reference = this.database.collection(EVENTS).doc(input.event.documentId);
    const receipt = receiptReference(this.database, input.idempotencyKey);
    const outbox = new FirebaseTransactionalOutbox(this.database);
    return this.database.runTransaction(async (transaction) => {
      const [receiptSnapshot, currentSnapshot] = await Promise.all([
        transaction.get(receipt),
        transaction.get(reference),
      ]);
      const replay = resultFromReceipt<DividendTransitionResult>(receiptSnapshot);
      if (replay !== undefined) return replay;
      if (!currentSnapshot.exists) {
        return { kind: "unchanged", code: "DIVIDEND_EVENT_NOT_FOUND" };
      }
      const current = currentSnapshot.data()!;
      const currentStatus = storedStatus(current);
      const currentVersion = Math.max(
        1,
        Math.trunc(number(current.aggregateVersion) ?? 1),
      );
      let result: DividendTransitionResult;
      let update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> | undefined;
      if (currentVersion !== input.event.aggregateVersion) {
        result = { kind: "unchanged", code: "DIVIDEND_VERSION_CONFLICT" };
      } else if (input.targetStatus === "fixed") {
        if (
          currentStatus !== "announced" ||
          input.eligibleQuantity === undefined ||
          !Number.isFinite(input.eligibleQuantity) ||
          input.eligibleQuantity < 0
        ) {
          result = { kind: "unchanged", code: "DIVIDEND_TRANSITION_NOT_APPLICABLE" };
        } else {
          const nextVersion = currentVersion + 1;
          result = {
            kind: "changed",
            eventId: input.event.eventId,
            status: "fixed",
            aggregateVersion: nextVersion,
          };
          update = {
            status: "fixed",
            eligibleQuantity: input.eligibleQuantity,
            totalAmount: Math.round(
              input.eligibleQuantity * input.event.perShareAmount,
            ),
            eligibilityContributions: (input.evidence ?? []).map((item) => ({
              assetId: item.assetId,
              quantity: item.quantity,
              kind:
                item.selectionKind === "exact"
                  ? "record-date-position"
                  : "nearest-position-snapshot",
              snapshotDate: item.snapshotDate,
              sourceVersion: item.sourceVersion,
              observedAt: item.observedAt,
            })),
            aggregateVersion: nextVersion,
            updatedAt: input.observedAt,
            persistedAt: FieldValue.serverTimestamp(),
          };
        }
      } else if (currentStatus !== "fixed") {
        result = { kind: "unchanged", code: "DIVIDEND_TRANSITION_NOT_APPLICABLE" };
      } else {
        const nextVersion = currentVersion + 1;
        result = {
          kind: "changed",
          eventId: input.event.eventId,
          status: "paid",
          aggregateVersion: nextVersion,
        };
        update = {
          status: "paid",
          paidAt: input.observedAt,
          aggregateVersion: nextVersion,
          updatedAt: input.observedAt,
          persistedAt: FieldValue.serverTimestamp(),
        };
      }
      if (update !== undefined && result.kind === "changed") {
        transaction.update(reference, update);
        outbox.append(transaction, {
          eventId: hash(`${input.idempotencyKey}\u0000changed`),
          eventType: "DividendEventChanged.v1",
          householdId: input.event.householdId,
          aggregateId: input.event.eventId,
          aggregateVersion: result.aggregateVersion,
          occurredAt: input.observedAt,
          correlationId: input.idempotencyKey,
          causationId: input.idempotencyKey,
          payload: { status: result.status },
        });
      }
      transaction.create(receipt, {
        schemaVersion: 1,
        result,
        committedAt: input.observedAt,
      });
      return result;
    });
  }

  async rebuildAllAnnualProjections(input: {
    readonly sourceCheckpoint: string;
    readonly observedAt: string;
  }): Promise<{ readonly projectionCount: number }> {
    const [eventSnapshot, projectionSnapshot] = await Promise.all([
      this.database.collection(EVENTS).get(),
      this.database.collection(PROJECTIONS).get(),
    ]);
    const grouped = new Map<
      string,
      {
        householdId: string;
        year: number;
        events: Record<string, Record<string, unknown>>;
      }
    >();
    for (const document of eventSnapshot.docs) {
      const data = document.data();
      const status = storedStatus(data);
      const householdId = text(data.householdId);
      const paymentDate = text(data.paymentDate);
      const totalAmount = number(data.totalAmount);
      if (
        (status !== "fixed" && status !== "paid") ||
        householdId === undefined ||
        paymentDate === undefined ||
        totalAmount === undefined
      ) {
        continue;
      }
      const year = Number(paymentDate.slice(0, 4));
      if (!Number.isSafeInteger(year)) continue;
      const key = `${householdId}:${year}`;
      const current = grouped.get(key) ?? { householdId, year, events: {} };
      const eventId = text(data.eventId) ?? `legacy-dividend:${document.id}`;
      current.events[eventId] = {
        eventId,
        stockCode: text(data.instrumentCode ?? data.stockCode) ?? "UNKNOWN",
        stockName:
          text(data.instrumentName ?? data.stockName) ??
          text(data.instrumentCode ?? data.stockCode) ??
          "UNKNOWN",
        recordDate: text(data.recordDate) ?? "",
        paymentDate,
        perShareAmount: number(data.perShareAmount) ?? 0,
        quantity: number(data.eligibleQuantity) ?? 0,
        eligibleQuantity: number(data.eligibleQuantity) ?? 0,
        totalAmount,
        status,
        aggregateVersion: Math.max(
          1,
          Math.trunc(number(data.aggregateVersion) ?? 1),
        ),
      };
      grouped.set(key, current);
    }
    for (const projection of projectionSnapshot.docs) {
      const data = projection.data();
      const householdId = text(data.householdId);
      const year = number(data.year);
      if (householdId === undefined || year === undefined) continue;
      const key = `${householdId}:${year}`;
      if (!grouped.has(key)) {
        grouped.set(key, { householdId, year, events: {} });
      }
    }

    const writer = this.database.bulkWriter();
    for (const value of grouped.values()) {
      const monthlyData = Array.from({ length: 12 }, () => 0);
      for (const event of Object.values(value.events)) {
        const paymentDate = String(event.paymentDate);
        const month = Number(paymentDate.slice(5, 7));
        if (month >= 1 && month <= 12) {
          monthlyData[month - 1] += Number(event.totalAmount);
        }
      }
      const sortedEventIds = Object.keys(value.events).sort();
      writer.set(
        this.database
          .collection(PROJECTIONS)
          .doc(`${value.householdId}_${value.year}`),
        {
          schemaVersion: 1,
          householdId: value.householdId,
          year: value.year,
          monthlyData: monthlyData.map(Math.round),
          monthlyAmounts: monthlyData.map(Math.round),
          events: value.events,
          sourceCheckpoint: input.sourceCheckpoint,
          ...(sortedEventIds.length === 0
            ? {}
            : { lastEventId: sortedEventIds[sortedEventIds.length - 1] }),
          freshness: "fresh",
          updatedAt: input.observedAt,
          persistedAt: FieldValue.serverTimestamp(),
        },
      );
    }
    await writer.close();
    return { projectionCount: grouped.size };
  }
}
