import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  CaptureApprovalPersistenceCommand,
  CaptureCancellationPersistenceCommand,
  CaptureLedgerPersistencePort,
} from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureLedgerPersistencePort";
import type { CaptureTransactionBranchResult } from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/in/captureBranchSubmissionInputPort";
import { normalizeCancellationMerchant } from "../../../contexts/payment-capture/android-payment-ingestion/domain/value-objects/cancellationEvidence";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "payment-capture-ledger";
const FINGERPRINT_VERSION = 1;
const DAY = 24 * 60 * 60 * 1_000;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function commandReceiptId(householdId: string, downstreamKey: string): string {
  return hash(`${householdId}\u0000${downstreamKey}`);
}

function expiry(instant: string) {
  return firestoreTtlAfter(instant, 30 * DAY);
}

function approvalFingerprint(command: CaptureApprovalPersistenceCommand): {
  readonly canonical: string;
  readonly fingerprintHash: string;
} {
  const localTime = command.branch.occurredAt.slice(11, 16);
  const canonical = JSON.stringify([
    `payment-fingerprint.v${FINGERPRINT_VERSION}`,
    command.householdId,
    command.branch.accountingDate,
    localTime,
    command.branch.amountInWon,
    normalizeCancellationMerchant(command.branch.originalMerchant),
  ]);
  return { canonical, fingerprintHash: hash(canonical) };
}

function deterministicIds(householdId: string, fingerprintHash: string) {
  const identity = hash(`${householdId}\u0000${fingerprintHash}`);
  return {
    transactionId: `capture-${identity.slice(0, 48)}`,
    captureId: `capture-record-${identity.slice(0, 40)}`,
    captureLineageId: `capture-lineage-${identity.slice(0, 40)}`,
  };
}

function terminalResult(
  snapshot: firestore.DocumentSnapshot,
  payloadFingerprint: string,
): CaptureTransactionBranchResult | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data?.payloadFingerprint !== payloadFingerprint) {
    return { kind: "rejected", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" };
  }
  return data?.result as CaptureTransactionBranchResult | undefined;
}

function branchPayloadFingerprint(command: unknown): string {
  return `sha256:${hash(JSON.stringify(command))}`;
}

function digits(value: string | undefined): string {
  return (value ?? "").replace(/\D/gu, "").slice(-4);
}

function normalizeCompany(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function cardDisplay(
  card: CaptureApprovalPersistenceCommand["branch"]["cardEvidence"],
): string {
  if (card === undefined) return "자동 수집";
  const lastFour = digits(card.maskedToken);
  return lastFour === ""
    ? card.companyLabel
    : `${card.companyLabel}(${lastFour})`;
}

function receiptReference(
  database: firestore.Firestore,
  householdId: string,
  downstreamKey: string,
) {
  return database
    .collection("commandReceipts")
    .doc(RECEIPT_CONTEXT)
    .collection("receipts")
    .doc(commandReceiptId(householdId, downstreamKey));
}

function receiptDocument(input: {
  readonly householdId: string;
  readonly downstreamKey: string;
  readonly result: CaptureTransactionBranchResult;
  readonly terminalAt: string;
  readonly payloadFingerprint: string;
}) {
  return {
    householdId: input.householdId,
    downstreamKey: input.downstreamKey,
    result: input.result,
    payloadFingerprint: input.payloadFingerprint,
    status: "completed",
    terminalAt: input.terminalAt,
    expiresAt: expiry(input.terminalAt),
    schemaVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
  };
}

function lineageIds(data: FirebaseFirestore.DocumentData): readonly string[] {
  const provenance =
    typeof data.provenance === "object" && data.provenance !== null
      ? (data.provenance as FirebaseFirestore.DocumentData)
      : undefined;
  const values = [data.captureLineageId, provenance?.captureLineageId];
  if (Array.isArray(data.captureLineageIds)) values.push(...data.captureLineageIds);
  return values.filter(
    (value): value is string => typeof value === "string" && value !== "",
  );
}

function derivedParents(data: FirebaseFirestore.DocumentData): readonly string[] {
  const splitGroup =
    typeof data.splitGroup === "object" && data.splitGroup !== null
      ? (data.splitGroup as FirebaseFirestore.DocumentData)
      : undefined;
  return [
    data.derivedFromTransactionId,
    data.splitOriginalId,
    splitGroup?.originalId,
  ].filter((value): value is string => typeof value === "string" && value !== "");
}

function transactionVersion(data: FirebaseFirestore.DocumentData): number {
  return typeof data.aggregateVersion === "number" &&
    Number.isSafeInteger(data.aggregateVersion) &&
    data.aggregateVersion > 0
    ? data.aggregateVersion
    : 1;
}

interface CancellationCandidate {
  readonly documentId: string;
  readonly transactionId: string;
  readonly captureLineageId: string;
  readonly fingerprintHash: string;
  readonly approvalDate: string;
  readonly amountInWon: number;
  readonly merchant: string;
  readonly companyLabel: string;
  readonly lastFour: string;
  readonly canonicalCardId?: string;
}

function candidate(
  document: firestore.QueryDocumentSnapshot,
): CancellationCandidate | undefined {
  const data = document.data();
  if (
    data.observationType !== "approval" ||
    data.lifecycleState === "deleted" ||
    typeof data.transactionId !== "string" ||
    typeof data.captureLineageId !== "string" ||
    typeof data.fingerprintHash !== "string" ||
    typeof data.approvalDate !== "string" ||
    typeof data.amountInWon !== "number" ||
    typeof data.merchant !== "string"
  ) {
    return undefined;
  }
  const card =
    typeof data.cardEvidence === "object" && data.cardEvidence !== null
      ? (data.cardEvidence as FirebaseFirestore.DocumentData)
      : {};
  return {
    documentId: document.id,
    transactionId: data.transactionId,
    captureLineageId: data.captureLineageId,
    fingerprintHash: data.fingerprintHash,
    approvalDate: data.approvalDate,
    amountInWon: data.amountInWon,
    merchant: data.merchant,
    companyLabel: typeof card.companyLabel === "string" ? card.companyLabel : "",
    lastFour: typeof card.lastFour === "string" ? card.lastFour : "",
    ...(typeof data.canonicalCardId === "string"
      ? { canonicalCardId: data.canonicalCardId }
      : {}),
  };
}

function matchesCancellation(
  command: CaptureCancellationPersistenceCommand,
  value: CancellationCandidate,
): boolean {
  const end = Date.parse(`${command.branch.cancellationDate}T00:00:00+09:00`);
  const approval = Date.parse(`${value.approvalDate}T00:00:00+09:00`);
  if (
    !Number.isFinite(end) ||
    !Number.isFinite(approval) ||
    approval > end ||
    approval < end - 30 * DAY ||
    value.amountInWon !== command.branch.amountInWon ||
    normalizeCancellationMerchant(value.merchant) !==
      normalizeCancellationMerchant(command.branch.merchant)
  ) {
    return false;
  }
  if (
    command.branch.canonicalCardId !== undefined &&
    value.canonicalCardId !== undefined
  ) {
    return command.branch.canonicalCardId === value.canonicalCardId;
  }
  const evidence = command.branch.cardEvidence;
  if (evidence === undefined) return value.companyLabel === "";
  if (normalizeCompany(evidence.companyLabel) !== normalizeCompany(value.companyLabel)) {
    return false;
  }
  const evidenceDigits = digits(evidence.maskedToken);
  return evidenceDigits === "" || evidenceDigits === value.lastFour;
}

function appendDuplicateEvent(
  database: firestore.Firestore,
  transaction: firestore.Transaction,
  command: CaptureApprovalPersistenceCommand,
  existingTransactionId: string,
): string {
  const eventId = hash(
    `${command.householdId}\u0000${command.downstreamKey}\u0000CaptureDuplicateObserved.v1`,
  );
  transaction.create(database.collection("outboxEvents").doc(eventId), {
    eventId,
    eventType: "CaptureDuplicateObserved",
    eventVersion: 1,
    producerContext: "payment-capture.intake",
    householdId: command.householdId,
    aggregateId: existingTransactionId,
    aggregateVersion: 1,
    occurredAt: command.branch.occurredAt,
    correlationId: command.downstreamKey,
    causationId: command.branch.observationId,
    payload: {
      transactionId: existingTransactionId,
      creatorMemberId: command.branch.creatorMemberId,
      originChannel: command.branch.originChannel,
    },
    status: "pending",
    schemaVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
  });
  return eventId;
}

export class FirebaseCaptureLedgerPersistence
  implements CaptureLedgerPersistencePort
{
  constructor(private readonly database: firestore.Firestore) {}

  async recordApproval(
    command: CaptureApprovalPersistenceCommand,
  ): Promise<CaptureTransactionBranchResult> {
    const household = this.database.collection("households").doc(command.householdId);
    const receipt = receiptReference(
      this.database,
      command.householdId,
      command.downstreamKey,
    );
    const fingerprint = approvalFingerprint(command);
    const payloadFingerprint = branchPayloadFingerprint(command);
    const dedup = household
      .collection("ledgerDedupKeys")
      .doc(fingerprint.fingerprintHash);
    const ids = deterministicIds(command.householdId, fingerprint.fingerprintHash);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [receiptSnapshot, claimSnapshot] = await Promise.all([
          transaction.get(receipt),
          transaction.get(dedup),
        ]);
        const replay = terminalResult(receiptSnapshot, payloadFingerprint);
        if (replay !== undefined) return replay;

        if (claimSnapshot.exists) {
          const claim = claimSnapshot.data() ?? {};
          const existingTransactionId =
            typeof claim.transactionId === "string"
              ? claim.transactionId
              : ids.transactionId;
          const editable = claim.state !== "cancelled";
          const followUp =
            command.branch.originChannel === "ios-shortcut"
              ? {
                  kind: "outboxQueued" as const,
                  eventType: "CaptureDuplicateObserved.v1" as const,
                  eventId: appendDuplicateEvent(
                    this.database,
                    transaction,
                    command,
                    existingTransactionId,
                  ),
                }
              : ({ kind: "notRequested" } as const);
          const result: CaptureTransactionBranchResult = {
            kind: "duplicate",
            existingTransactionId,
            editable,
            followUp,
          };
          transaction.create(
            receipt,
            receiptDocument({
              householdId: command.householdId,
              downstreamKey: command.downstreamKey,
              result,
              terminalAt: command.branch.occurredAt,
              payloadFingerprint,
            }),
          );
          return result;
        }

        const canonical = household
          .collection("ledgerTransactions")
          .doc(ids.transactionId);
        const legacy = this.database.collection("expenses").doc(ids.transactionId);
        const captureRecord = household
          .collection("captureRecords")
          .doc(ids.captureId);
        const localTime = command.branch.occurredAt.slice(11, 16);
        const display = cardDisplay(command.branch.cardEvidence);
        const common = {
          householdId: command.householdId,
          transactionType: "expense",
          lifecycleState: "active",
          merchant: command.branch.merchant,
          originalMerchant: command.branch.originalMerchant,
          amountInWon: command.branch.amountInWon,
          amount: command.branch.amountInWon,
          categoryId: command.branch.categoryId,
          category: command.branch.categoryId,
          memo: command.branch.memo,
          accountingDate: command.branch.accountingDate,
          date: command.branch.accountingDate,
          localTime,
          time: localTime,
          cardType: "captured",
          cardDisplay: display,
          cardName: display,
          creatorMemberId: command.branch.creatorMemberId,
          createdBy: command.branch.creatorMemberId,
          source: command.branch.sourceType,
          originChannel: command.branch.originChannel,
          captureId: ids.captureId,
          captureLineageId: ids.captureLineageId,
          aggregateVersion: 1,
          suppressAutomaticNotification:
            command.branch.originChannel === "android-notification",
          notificationPolicy:
            command.branch.originChannel === "android-notification"
              ? "android-quick-edit-only"
              : "creator-notification",
          ...(command.branch.canonicalCardId === undefined
            ? {}
            : { canonicalCardId: command.branch.canonicalCardId }),
          ...(command.branch.localCurrencyType === undefined
            ? {}
            : { localCurrencyType: command.branch.localCurrencyType }),
          schemaVersion: 2,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        transaction.create(canonical, common);
        transaction.create(legacy, {
          ...common,
          // 기존 Web read model은 카드 표시 문자열을 cardLastFour에서 읽습니다.
          cardLastFour: display,
          schemaVersion: 1,
        });
        transaction.create(captureRecord, {
          householdId: command.householdId,
          captureId: ids.captureId,
          captureLineageId: ids.captureLineageId,
          transactionId: ids.transactionId,
          observationId: command.branch.observationId,
          observationType: "approval",
          lifecycleState: "active",
          approvalDate: command.branch.accountingDate,
          occurredAt: command.branch.occurredAt,
          amountInWon: command.branch.amountInWon,
          merchant: command.branch.merchant,
          originalMerchant: command.branch.originalMerchant,
          cardEvidence: {
            companyLabel: command.branch.cardEvidence?.companyLabel ?? "",
            lastFour: digits(command.branch.cardEvidence?.maskedToken),
          },
          ...(command.branch.canonicalCardId === undefined
            ? {}
            : { canonicalCardId: command.branch.canonicalCardId }),
          creatorMemberId: command.branch.creatorMemberId,
          originChannel: command.branch.originChannel,
          sourceType: command.branch.sourceType,
          parser: command.branch.parser,
          rawPayloadHash: command.branch.rawPayloadHash,
          fingerprintVersion: FINGERPRINT_VERSION,
          fingerprintHash: fingerprint.fingerprintHash,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.create(dedup, {
          householdId: command.householdId,
          fingerprintVersion: FINGERPRINT_VERSION,
          fingerprintHash: fingerprint.fingerprintHash,
          transactionId: ids.transactionId,
          captureLineageId: ids.captureLineageId,
          state: "active",
          claimedAt: command.branch.occurredAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        new FirebaseTransactionalOutbox(this.database).append(transaction, {
          eventId: hash(
            `${command.householdId}\u0000${command.downstreamKey}\u0000TransactionRecorded.v1`,
          ),
          eventType: "TransactionRecorded.v1",
          householdId: command.householdId,
          aggregateId: ids.transactionId,
          aggregateVersion: 1,
          occurredAt: command.branch.occurredAt,
          correlationId: command.downstreamKey,
          causationId: command.branch.observationId,
          payload: {
            transactionId: ids.transactionId,
            creatorMemberId: command.branch.creatorMemberId,
            originChannel: command.branch.originChannel,
            creatorDelivery:
              command.branch.originChannel === "android-notification"
                ? "none"
                : "self",
            clientFollowUp:
              command.branch.originChannel === "android-notification"
                ? "android-quick-edit"
                : "notification",
          },
        });
        const result: CaptureTransactionBranchResult = {
          kind: "recorded",
          transactionId: ids.transactionId,
          editable: true,
          captureLineageId: ids.captureLineageId,
          aggregateVersion: 1,
          quickEditSnapshot: {
            transactionId: ids.transactionId,
            merchant: common.merchant,
            amountInWon: common.amountInWon,
            accountingDate: common.accountingDate,
            localTime,
            categoryId: common.categoryId,
            memo: common.memo,
            aggregateVersion: 1,
          },
        };
        transaction.create(
          receipt,
          receiptDocument({
            householdId: command.householdId,
            downstreamKey: command.downstreamKey,
            result,
            terminalAt: command.branch.occurredAt,
            payloadFingerprint,
          }),
        );
        return result;
      });
    } catch (_error) {
      return { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" };
    }
  }

  async cancel(
    command: CaptureCancellationPersistenceCommand,
  ): Promise<CaptureTransactionBranchResult> {
    const household = this.database.collection("households").doc(command.householdId);
    const receipt = receiptReference(
      this.database,
      command.householdId,
      command.downstreamKey,
    );
    const payloadFingerprint = branchPayloadFingerprint(command);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const [receiptSnapshot, captureRecords, canonical, legacy] =
          await Promise.all([
            transaction.get(receipt),
            transaction.get(household.collection("captureRecords")),
            transaction.get(household.collection("ledgerTransactions")),
            transaction.get(
              this.database
                .collection("expenses")
                .where("householdId", "==", command.householdId),
            ),
          ]);
        const replay = terminalResult(receiptSnapshot, payloadFingerprint);
        if (replay !== undefined) return replay;

        const matches = captureRecords.docs
          .map(candidate)
          .filter((value): value is CancellationCandidate => value !== undefined)
          .filter((value) => matchesCancellation(command, value));
        const distinctLineages = [
          ...new Set(matches.map((value) => value.captureLineageId)),
        ].sort((left, right) => left.localeCompare(right, "en"));
        if (distinctLineages.length !== 1) {
          const result: CaptureTransactionBranchResult =
            distinctLineages.length === 0
              ? { kind: "notFound", resource: "cancellationTarget" }
              : {
                  kind: "needsConfirmation",
                  captureLineageIds: distinctLineages,
                };
          transaction.create(
            receipt,
            receiptDocument({
              householdId: command.householdId,
              downstreamKey: command.downstreamKey,
              result,
              terminalAt: command.branch.observedAt,
              payloadFingerprint,
            }),
          );
          return result;
        }

        const captureLineageId = distinctLineages[0];
        const matchedCapture = matches.find(
          (value) => value.captureLineageId === captureLineageId,
        );
        if (matchedCapture === undefined) {
          throw new Error("MATCHED_CAPTURE_INVARIANT_BROKEN");
        }
        const all = new Map<string, firestore.QueryDocumentSnapshot>();
        for (const document of legacy.docs) all.set(document.id, document);
        for (const document of canonical.docs) all.set(document.id, document);

        const affected = new Set<string>();
        for (const [id, document] of all) {
          if (lineageIds(document.data()).includes(captureLineageId)) affected.add(id);
        }
        let changed = true;
        while (changed) {
          changed = false;
          for (const [id, document] of all) {
            if (
              !affected.has(id) &&
              derivedParents(document.data()).some((parent) => affected.has(parent))
            ) {
              affected.add(id);
              changed = true;
            }
          }
        }

        for (const transactionId of affected) {
          const document = all.get(transactionId);
          if (document === undefined) continue;
          const version = transactionVersion(document.data()) + 1;
          const deletion = {
            lifecycleState: "deleted",
            deletedAt: command.branch.observedAt,
            deletedByMemberId: command.branch.creatorMemberId,
            cancellationObservationId: command.branch.observationId,
            cancellationReceiptId: commandReceiptId(
              command.householdId,
              command.downstreamKey,
            ),
            aggregateVersion: version,
            updatedAt: FieldValue.serverTimestamp(),
          };
          transaction.set(
            household.collection("ledgerTransactions").doc(transactionId),
            { householdId: command.householdId, ...deletion, schemaVersion: 2 },
            { merge: true },
          );
          transaction.set(
            this.database.collection("expenses").doc(transactionId),
            { householdId: command.householdId, ...deletion, schemaVersion: 1 },
            { merge: true },
          );
          new FirebaseTransactionalOutbox(this.database).append(transaction, {
            eventId: hash(
              `${command.householdId}\u0000${command.downstreamKey}\u0000TransactionDeleted.v1\u0000${transactionId}`,
            ),
            eventType: "TransactionDeleted.v1",
            householdId: command.householdId,
            aggregateId: transactionId,
            aggregateVersion: version,
            occurredAt: command.branch.observedAt,
            correlationId: command.downstreamKey,
            causationId: command.branch.observationId,
            payload: { transactionId, captureLineageId },
          });
        }

        const claim = household
          .collection("ledgerDedupKeys")
          .doc(matchedCapture.fingerprintHash);
        transaction.set(
          claim,
          {
            householdId: command.householdId,
            fingerprintVersion: FINGERPRINT_VERSION,
            fingerprintHash: matchedCapture.fingerprintHash,
            captureLineageId,
            state: "cancelled",
            cancelledAt: command.branch.observedAt,
            transactionId: FieldValue.delete(),
            claimedAt: FieldValue.delete(),
            createdAt: FieldValue.delete(),
            cancellationReceiptId: commandReceiptId(
              command.householdId,
              command.downstreamKey,
            ),
            schemaVersion: 1,
          },
          { merge: true },
        );
        for (const value of matches.filter(
          (candidateValue) => candidateValue.captureLineageId === captureLineageId,
        )) {
          transaction.set(
            household.collection("captureRecords").doc(value.documentId),
            {
              lifecycleState: "deleted",
              deletedAt: command.branch.observedAt,
              cancellationObservationId: command.branch.observationId,
            },
            { merge: true },
          );
        }
        const cancellationId = `cancellation-${hash(
          `${command.householdId}\u0000${command.branch.observationId}`,
        ).slice(0, 40)}`;
        transaction.create(
          household.collection("captureRecords").doc(cancellationId),
          {
            householdId: command.householdId,
            captureId: cancellationId,
            observationId: command.branch.observationId,
            observationType: "cancellation",
            captureLineageId,
            lifecycleState: "recorded",
            creatorMemberId: command.branch.creatorMemberId,
            sourceType: command.branch.sourceType,
            parser: command.branch.parser,
            rawPayloadHash: command.branch.rawPayloadHash,
            observedAt: command.branch.observedAt,
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          },
        );
        const transactionIds = [...affected].sort((left, right) =>
          left.localeCompare(right, "en"),
        );
        const result: CaptureTransactionBranchResult = {
          kind: "cancelled",
          transactionIds,
        };
        transaction.create(
          receipt,
          receiptDocument({
            householdId: command.householdId,
            downstreamKey: command.downstreamKey,
            result,
            terminalAt: command.branch.observedAt,
            payloadFingerprint,
          }),
        );
        return result;
      });
    } catch (_error) {
      return { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" };
    }
  }
}
