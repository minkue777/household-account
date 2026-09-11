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
import { planCaptureLineageCancellation } from "../../../contexts/household-finance/ledger/domain/policies/captureLineageCancellationGraph";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";
import { verifiedRawCaptureFingerprint } from "../../crypto/payment-capture/verifiedRawCaptureFingerprint";

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
  command: CaptureApprovalPersistenceCommand | CaptureCancellationPersistenceCommand,
): CaptureTransactionBranchResult | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data?.payloadFingerprint !== payloadFingerprint &&
      data?.payloadFingerprint !== legacyBranchPayloadFingerprint(command)) {
    return { kind: "rejected", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" };
  }
  return data?.result as CaptureTransactionBranchResult | undefined;
}

function legacyBranchPayloadFingerprint(
  command: CaptureApprovalPersistenceCommand | CaptureCancellationPersistenceCommand,
): string {
  // 원문 hash가 이미 결박한 서버 파생 증거는 기존 receipt의 identity를 바꾸지 않습니다.
  // 배포 전 Ledger commit 후 응답을 잃은 요청도 같은 결과를 재생해야 합니다.
  const branch = { ...command.branch };
  if ("approvalAmountInWon" in branch) delete branch.approvalAmountInWon;
  delete branch.verifiedRawPayloadHash;
  return `sha256:${hash(JSON.stringify({ ...command, branch }))}`;
}

function branchPayloadFingerprint(
  command: CaptureApprovalPersistenceCommand | CaptureCancellationPersistenceCommand,
): string {
  const branch = command.branch;
  if (branch.verifiedRawPayloadHash !== undefined) {
    return verifiedRawCaptureFingerprint({ householdId: command.householdId,
      idempotencyKey: command.downstreamKey, creatorMemberId: branch.creatorMemberId,
      payloadHash: branch.verifiedRawPayloadHash });
  }
  // A public typed envelope's rawPayloadHash is caller supplied. Bind its original parsed
  // facts explicitly; configuration enrichment is not part of the submitted input.
  const approval = "occurredAt" in branch;
  const identity = [command.householdId, command.downstreamKey, approval ? "approval" : "cancellation",
    branch.observationId, branch.creatorMemberId, branch.sourceType,
    branch.parser.parserId, branch.parser.parserVersion, branch.rawPayloadHash,
    branch.amountInWon, branch.originalMerchant ?? branch.merchant,
    approval ? branch.originChannel : null,
    approval ? branch.occurredAt : branch.observedAt,
    approval ? branch.accountingDate : branch.cancellationDate,
    branch.cardEvidence?.companyLabel ?? null, branch.cardEvidence?.maskedToken ?? null,
    "localCurrencyType" in branch ? branch.localCurrencyType ?? null : null,
  ];
  return `capture-input.v2:${hash(JSON.stringify(identity))}`;
}

function digits(value: string | undefined): string {
  return (value ?? "").replace(/\D/gu, "").slice(-4);
}

function displayToken(value: string | undefined): string {
  const token = (value ?? "")
    .replace(/[xX＊]/gu, "*")
    .replace(/[^0-9*]/gu, "")
    .slice(-4);
  return token.length === 4 ? token : digits(value);
}

function normalizeCompany(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function cardDisplay(
  card: CaptureApprovalPersistenceCommand["branch"]["cardEvidence"],
  resolved:
    CaptureApprovalPersistenceCommand["branch"]["resolvedCardEvidence"],
): string {
  if (resolved !== undefined) {
    return `${resolved.companyLabel}(${resolved.lastFour})`;
  }
  if (card === undefined) return "자동 수집";
  const token = displayToken(card.maskedToken);
  return token === ""
    ? card.companyLabel
    : `${card.companyLabel}(${token})`;
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
  const values = [
    data.captureLineageId,
    data.sourceFingerprint,
    provenance?.captureLineageId,
  ];
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

function mergeLeafIds(data: FirebaseFirestore.DocumentData): readonly string[] {
  return Array.isArray(data.mergeLeafIds)
    ? data.mergeLeafIds.filter(
        (value): value is string => typeof value === "string" && value !== "",
      )
    : [];
}

function transactionLifecycleState(
  data: FirebaseFirestore.DocumentData,
): "active" | "superseded" | "deleted" {
  if (data.lifecycleState === "deleted" || data.deletedAt !== undefined) {
    return "deleted";
  }
  return data.lifecycleState === "superseded" ? "superseded" : "active";
}

function hasLegacyMergeSnapshot(
  data: FirebaseFirestore.DocumentData,
): boolean {
  return Array.isArray(data.mergedFrom) && data.mergedFrom.length > 0;
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
  readonly approvalAmountInWon: number;
  readonly merchant: string;
  readonly companyLabel: string;
  readonly lastFour: string;
  readonly canonicalCardId?: string;
}

function candidate(
  document: firestore.QueryDocumentSnapshot,
): CancellationCandidate | undefined {
  const data = document.data();
  const approvalAmountInWon = data.approvalAmountInWon === undefined
    ? data.amountInWon
    : data.approvalAmountInWon;
  if (
    data.observationType !== "approval" ||
    data.lifecycleState === "deleted" ||
    typeof data.transactionId !== "string" ||
    typeof data.captureLineageId !== "string" ||
    typeof data.fingerprintHash !== "string" ||
    typeof data.approvalDate !== "string" ||
    typeof data.amountInWon !== "number" ||
    !Number.isSafeInteger(approvalAmountInWon) ||
    approvalAmountInWon < data.amountInWon ||
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
    approvalAmountInWon,
    merchant: typeof data.originalMerchant === "string" ? data.originalMerchant : data.merchant,
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
    value.approvalAmountInWon !== command.branch.amountInWon ||
    normalizeCancellationMerchant(value.merchant) !==
      normalizeCancellationMerchant(command.branch.originalMerchant ?? command.branch.merchant)
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

async function loadCancellationGraph(
  database: firestore.Firestore,
  transaction: firestore.Transaction,
  householdId: string,
  captureLineageId: string,
): Promise<Map<string, firestore.DocumentSnapshot>> {
  const canonical = database.collection("households").doc(householdId).collection("ledgerTransactions");
  const legacy = database.collection("expenses").where("householdId", "==", householdId);
  const documents = new Map<string, firestore.DocumentSnapshot>();
  const add = (snapshots: readonly firestore.DocumentSnapshot[]) => {
    for (const document of snapshots) if (document.exists) documents.set(document.id, document);
  };
  for (const collection of [legacy, canonical]) {
    for (const field of ["captureLineageId", "sourceFingerprint", "provenance.captureLineageId", "captureLineageIds"]) {
      add((await transaction.get(collection.where(field, field === "captureLineageIds" ? "array-contains" : "==", captureLineageId))).docs);
    }
  }
  const visited = new Set<string>();
  while ([...documents.keys()].some((id) => !visited.has(id))) {
    for (const [id, document] of [...documents]) {
      if (visited.has(id)) continue;
      visited.add(id);
      // 분할/합치기 이전 버전도 부모 링크를 따라 범위를 확장합니다.
      for (const collection of [legacy, canonical]) {
        for (const field of ["derivedFromTransactionId", "splitOriginalId", "splitGroup.originalId", "mergeLeafIds"]) {
          add((await transaction.get(collection.where(field, field === "mergeLeafIds" ? "array-contains" : "==", id))).docs);
        }
      }
      for (const leafId of mergeLeafIds(document.data() ?? {})) {
        if (documents.has(leafId)) continue;
        const [old, current] = await Promise.all([
          transaction.get(database.collection("expenses").doc(leafId)), transaction.get(canonical.doc(leafId)),
        ]);
        add([old, current].filter((snapshot) => snapshot.data()?.householdId === householdId));
      }
    }
  }
  return documents;
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
        const [receiptSnapshot, claimSnapshot] = await transaction.getAll(receipt, dedup);
        const replay = terminalResult(receiptSnapshot, payloadFingerprint, command);
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
        const display = cardDisplay(
          command.branch.cardEvidence,
          command.branch.resolvedCardEvidence,
        );
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
          ...(command.branch.approvalAmountInWon === undefined
            ? {}
            : { approvalAmountInWon: command.branch.approvalAmountInWon }),
          merchant: command.branch.merchant,
          originalMerchant: command.branch.originalMerchant,
          cardEvidence: {
            companyLabel: command.branch.cardEvidence?.companyLabel ?? "",
            lastFour: digits(command.branch.cardEvidence?.maskedToken),
            maskedToken: displayToken(command.branch.cardEvidence?.maskedToken),
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
        const receiptSnapshot = await transaction.get(receipt);
        const replay = terminalResult(receiptSnapshot, payloadFingerprint, command);
        if (replay !== undefined) return replay;
        const end = Date.parse(`${command.branch.cancellationDate}T00:00:00+09:00`);
        const startDate = Number.isFinite(end)
          ? new Date(end - 30 * DAY + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
          : command.branch.cancellationDate;
        const captureRecords = await transaction.get(household.collection("captureRecords")
          .where("approvalDate", ">=", startDate)
          .where("approvalDate", "<=", command.branch.cancellationDate));
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
        const all = await loadCancellationGraph(this.database, transaction, command.householdId, captureLineageId);

        const original = all.get(matchedCapture.transactionId);
        if (
          original === undefined ||
          !lineageIds(original.data() ?? {}).includes(captureLineageId)
        ) {
          const result: CaptureTransactionBranchResult = {
            kind: "notFound",
            resource: "cancellationTarget",
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
        const cancellationPlan = planCaptureLineageCancellation({
          captureLineageId,
          transactions: [...all].map(([transactionId, document]) => ({
            transactionId,
            lifecycleState: transactionLifecycleState(document.data() ?? {}),
            captureLineageIds: lineageIds(document.data() ?? {}),
            parentTransactionIds: derivedParents(document.data() ?? {}),
            mergeLeafIds: mergeLeafIds(document.data() ?? {}),
            legacyMergeSnapshotPresent: hasLegacyMergeSnapshot(
              document.data() ?? {},
            ),
          })),
        });
        const affected = new Set(cancellationPlan.affectedTransactionIds);
        const restorable = new Set(cancellationPlan.restorableLeafIds);
        if (
          cancellationPlan.invalidGraph ||
          cancellationPlan.restorableLeafIds.some(
            (transactionId) => !all.has(transactionId),
          )
        ) {
          return {
            kind: "rejected" as const,
            code: "RESTORATION_SNAPSHOT_INCOMPLETE",
          };
        }

        for (const transactionId of affected) {
          const document = all.get(transactionId);
          if (document === undefined) {
            throw new Error("AFFECTED_TRANSACTION_INVARIANT_BROKEN");
          }
          const version = transactionVersion(document.data() ?? {}) + 1;
          transaction.delete(
            household.collection("ledgerTransactions").doc(transactionId),
          );
          transaction.delete(
            this.database.collection("expenses").doc(transactionId),
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

        for (const transactionId of restorable) {
          const document = all.get(transactionId);
          if (document === undefined) {
            throw new Error("RESTORATION_SNAPSHOT_INVARIANT_BROKEN");
          }
          const stored = document.data() ?? {};
          if (transactionLifecycleState(stored) === "active") continue;
          const version = transactionVersion(stored) + 1;
          const cardDisplay =
            typeof stored.cardDisplay === "string"
              ? stored.cardDisplay
              : typeof stored.cardLastFour === "string"
                ? stored.cardLastFour
                : "";
          const restoration = {
            ...stored,
            householdId: command.householdId,
            lifecycleState: "active",
            aggregateVersion: version,
            deletedAt: FieldValue.delete(),
            deletedByMemberId: FieldValue.delete(),
            cancellationObservationId: FieldValue.delete(),
            cancellationReceiptId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          };
          transaction.set(
            household.collection("ledgerTransactions").doc(transactionId),
            { ...restoration, schemaVersion: 2 },
            { merge: true },
          );
          transaction.set(
            this.database.collection("expenses").doc(transactionId),
            {
              ...restoration,
              cardLastFour: cardDisplay,
              schemaVersion: 1,
            },
            { merge: true },
          );
          new FirebaseTransactionalOutbox(this.database).append(transaction, {
            eventId: hash(
              `${command.householdId}\u0000${command.downstreamKey}\u0000TransactionChanged.v1\u0000${transactionId}`,
            ),
            eventType: "TransactionChanged.v1",
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
              householdId: command.householdId,
              captureLineageId,
              fingerprintHash: value.fingerprintHash,
              lifecycleState: "deleted",
              deletedAt: command.branch.observedAt,
              cancellationReceiptId: commandReceiptId(command.householdId, command.downstreamKey),
              schemaVersion: 1,
            },
          );
        }
        const cancellationId = `cancellation-${hash(
          `${command.householdId}\u0000${command.branch.observationId}`,
        ).slice(0, 40)}`;
        transaction.create(
          household.collection("captureRecords").doc(cancellationId),
          {
            householdId: command.householdId,
            observationType: "cancellation",
            captureLineageId,
            fingerprintHash: matchedCapture.fingerprintHash,
            lifecycleState: "recorded",
            observedAt: command.branch.observedAt,
            cancellationReceiptId: commandReceiptId(command.householdId, command.downstreamKey),
            schemaVersion: 1,
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
