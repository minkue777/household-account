import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { AssetAutomationRestorationState } from "../../../contexts/portfolio/automation/domain/model/assetAutomationRestoration";
import type {
  AssetLifecycleUnitOfWorkPort,
  AssetRestorationWorkflowDecision,
} from "../../../contexts/portfolio/core/application/ports/out/assetLifecyclePorts";
import type {
  AssetLifecycleAuditRecord,
  AssetLifecycleCommandResult,
  AssetLifecycleDecision,
  AssetLifecycleEvent,
  AssetLifecycleReceipt,
  AssetLifecycleRecord,
  AssetLifecycleView,
} from "../../../contexts/portfolio/core/domain/model/assetLifecycle";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import {
  ACCESS_SCHEMA_VERSION,
  accessEventId,
  accessReceiptReference,
  isoString,
  numberField,
  stringArrayField,
  stringField,
  terminalReceiptFields,
} from "../access/firebaseAccessPersistence";

export interface FirebaseAssetLifecycleUnitOfWorkInput {
  readonly administratorPrincipalRef: string;
  readonly householdId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly commandId: string;
}

interface LoadedAssetLifecycle {
  readonly record: AssetLifecycleRecord;
  readonly canonical: firestore.DocumentSnapshot;
  readonly legacy: firestore.DocumentSnapshot;
  readonly plan?: firestore.QueryDocumentSnapshot;
  readonly participantState?: AssetAutomationRestorationState;
  readonly receiptReference: firestore.DocumentReference;
  readonly receiptExists: boolean;
}

function lifecycle(
  canonical: FirebaseFirestore.DocumentData | undefined,
  legacy: FirebaseFirestore.DocumentData | undefined,
): "active" | "deleted" | "purging" {
  const value = stringField(canonical, "lifecycleState");
  if (value === "deleted" || value === "purging") return value;
  return legacy?.isActive === false ? "deleted" : "active";
}

function mapAsset(
  householdId: string,
  assetId: string,
  canonical: FirebaseFirestore.DocumentData | undefined,
  legacy: FirebaseFirestore.DocumentData | undefined,
): AssetLifecycleView | undefined {
  if (canonical === undefined && legacy === undefined) return undefined;
  const storedHouseholdId =
    stringField(canonical, "householdId") ?? stringField(legacy, "householdId");
  if (storedHouseholdId !== undefined && storedHouseholdId !== householdId) {
    return undefined;
  }
  const deletedAt =
    isoString(canonical?.deletedAt) ?? isoString(legacy?.deletedAt);
  return {
    assetId,
    householdId,
    lifecycleState: lifecycle(canonical, legacy),
    aggregateVersion: numberField(
      canonical,
      "aggregateVersion",
      numberField(legacy, "aggregateVersion", 1),
    ),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function commandReceipts(
  idempotencyKey: string,
  snapshot: firestore.DocumentSnapshot,
): AssetLifecycleRecord["commandReceipts"] {
  if (!snapshot.exists) return {};
  const fingerprint = stringField(snapshot.data(), "payloadFingerprint");
  const result = snapshot.data()?.result;
  return fingerprint !== undefined && typeof result === "object" && result !== null
    ? {
        [idempotencyKey]: {
          payloadFingerprint: fingerprint,
          result: result as AssetLifecycleCommandResult,
        },
      }
    : {};
}

function stringRecords<T extends Readonly<Record<string, unknown>>>(
  value: unknown,
  validate: (entry: Readonly<Record<string, unknown>>) => T | undefined,
): readonly T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
    const mapped = validate(raw as Readonly<Record<string, unknown>>);
    return mapped === undefined ? [] : [mapped];
  });
}

function participantState(
  assetId: string,
  plan: firestore.QueryDocumentSnapshot | undefined,
): AssetAutomationRestorationState | undefined {
  if (plan === undefined) return undefined;
  const data = plan.data();
  const configuredDay = data.configuredDay;
  if (
    typeof configuredDay !== "number" ||
    !Number.isSafeInteger(configuredDay) ||
    configuredDay < 1 ||
    configuredDay > 31
  ) {
    return undefined;
  }
  const suspensionIntervals = stringRecords(
    data.restorationSuspensionIntervals,
    (entry) =>
      typeof entry.startsOn === "string" && typeof entry.endsBefore === "string"
        ? { startsOn: entry.startsOn, endsBefore: entry.endsBefore }
        : undefined,
  );
  const resumeRevisions = stringRecords(data.restorationResumeRevisions, (entry) =>
    typeof entry.revision === "number" &&
    Number.isSafeInteger(entry.revision) &&
    typeof entry.restoredOn === "string" &&
    typeof entry.resumeFromDate === "string"
      ? {
          revision: entry.revision,
          restoredOn: entry.restoredOn,
          resumeFromDate: entry.resumeFromDate,
        }
      : undefined,
  );
  return {
    assetId,
    configuredDay,
    pendingMonths: stringArrayField(data, "pendingMonths"),
    suspensionIntervals,
    resumeRevisions,
  };
}

export class FirebaseAssetLifecycleUnitOfWork
  implements AssetLifecycleUnitOfWorkPort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseAssetLifecycleUnitOfWorkInput,
  ) {}

  private async load(
    transaction: firestore.Transaction,
    assetId: string,
  ): Promise<LoadedAssetLifecycle> {
    const household = this.database
      .collection("households")
      .doc(this.input.householdId);
    const canonicalReference = household.collection("assets").doc(assetId);
    const legacyReference = this.database.collection("assets").doc(assetId);
    const receiptReference = accessReceiptReference(
      this.database,
      "portfolio-asset-restoration",
      this.input.administratorPrincipalRef,
      this.input.idempotencyKey,
    );
    const [canonical, legacy, plans, receipt] = await Promise.all([
      transaction.get(canonicalReference),
      transaction.get(legacyReference),
      transaction.get(
        household.collection("assetAutomationPlans").where("assetId", "==", assetId),
      ),
      transaction.get(receiptReference),
    ]);
    if (plans.size > 1) throw new Error("MULTIPLE_AUTOMATION_PLANS_FOR_ASSET");
    const plan = plans.docs[0];
    const asset = mapAsset(
      this.input.householdId,
      assetId,
      canonical.data(),
      legacy.data(),
    );
    return {
      record: {
        ...(asset === undefined ? {} : { asset }),
        commandReceipts: commandReceipts(this.input.idempotencyKey, receipt),
      },
      canonical,
      legacy,
      ...(plan === undefined ? {} : { plan }),
      ...(participantState(assetId, plan) === undefined
        ? {}
        : { participantState: participantState(assetId, plan) }),
      receiptReference,
      receiptExists: receipt.exists,
    };
  }

  async read(assetId: string): Promise<AssetLifecycleRecord | undefined> {
    return this.database.runTransaction(async (transaction) => {
      const loaded = await this.load(transaction, assetId);
      return loaded.record.asset === undefined ? undefined : loaded.record;
    });
  }

  async listByHousehold(
    householdId: string,
  ): Promise<readonly AssetLifecycleRecord[]> {
    if (householdId !== this.input.householdId) return [];
    const household = this.database.collection("households").doc(householdId);
    const [canonical, legacy] = await Promise.all([
      household.collection("assets").get(),
      this.database.collection("assets").where("householdId", "==", householdId).get(),
    ]);
    const canonicalById = new Map(
      canonical.docs.map((snapshot) => [snapshot.id, snapshot.data()]),
    );
    const legacyById = new Map(
      legacy.docs.map((snapshot) => [snapshot.id, snapshot.data()]),
    );
    const assetIds = new Set([...canonicalById.keys(), ...legacyById.keys()]);
    return [...assetIds].flatMap((assetId) => {
      const asset = mapAsset(
        householdId,
        assetId,
        canonicalById.get(assetId),
        legacyById.get(assetId),
      );
      return asset === undefined
        ? []
        : [{ asset, commandReceipts: {} } satisfies AssetLifecycleRecord];
    });
  }

  async transact(
    assetId: string,
    decide: (record: AssetLifecycleRecord) => AssetLifecycleDecision,
  ): Promise<AssetLifecycleCommandResult> {
    return this.database.runTransaction(async (transaction) => {
      const loaded = await this.load(transaction, assetId);
      const decision = decide(loaded.record);
      if (decision.kind === "return") return decision.result;
      this.persistLifecycleDecision(transaction, loaded, decision);
      return decision.result;
    });
  }

  async transactRestoration(
    assetId: string,
    decide: (snapshot: {
      readonly lifecycleRecord: AssetLifecycleRecord;
      readonly participantState?: unknown;
    }) => AssetRestorationWorkflowDecision,
  ): Promise<AssetLifecycleCommandResult> {
    return this.database.runTransaction(async (transaction) => {
      const loaded = await this.load(transaction, assetId);
      const decision = decide({
        lifecycleRecord: loaded.record,
        ...(loaded.participantState === undefined
          ? {}
          : { participantState: loaded.participantState }),
      });
      if (decision.kind === "return") return decision.result;
      this.persistRestorationDecision(transaction, loaded, decision);
      return decision.result;
    });
  }

  private persistLifecycleDecision(
    transaction: firestore.Transaction,
    loaded: LoadedAssetLifecycle,
    decision: Extract<AssetLifecycleDecision, { readonly kind: "commit" }>,
  ): void {
    this.persistAsset(transaction, loaded, decision.nextRecord.asset);
    this.persistReceipt(transaction, loaded, decision.nextRecord, decision.result);
    this.persistEvents(transaction, decision.events);
    this.persistAudits(transaction, decision.auditRecords ?? []);
  }

  private persistRestorationDecision(
    transaction: firestore.Transaction,
    loaded: LoadedAssetLifecycle,
    decision: Extract<AssetRestorationWorkflowDecision, { readonly kind: "commit" }>,
  ): void {
    this.persistAsset(transaction, loaded, decision.nextLifecycleRecord.asset);
    if (decision.nextParticipantState !== undefined && loaded.plan !== undefined) {
      const next = decision.nextParticipantState as AssetAutomationRestorationState;
      const latest = next.resumeRevisions[next.resumeRevisions.length - 1];
      transaction.set(
        loaded.plan.ref,
        {
          status: "active",
          pendingMonths: [...next.pendingMonths],
          restorationSuspensionIntervals: next.suspensionIntervals.map((entry) => ({
            ...entry,
          })),
          restorationResumeRevisions: next.resumeRevisions.map((entry) => ({
            ...entry,
          })),
          ...(latest === undefined ? {} : { nextDueDate: latest.resumeFromDate }),
          aggregateVersion:
            numberField(loaded.plan.data(), "aggregateVersion", 1) + 1,
          schemaVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (latest !== undefined) {
        transaction.create(
          this.database
            .collection("households")
            .doc(this.input.householdId)
            .collection("assetAutomationRestorationRevisions")
            .doc(`${loaded.plan.id}_${latest.revision}`),
          {
            planId: loaded.plan.id,
            householdId: this.input.householdId,
            assetId: next.assetId,
            ...latest,
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          },
        );
      }
    }
    this.persistReceipt(
      transaction,
      loaded,
      decision.nextLifecycleRecord,
      decision.result,
    );
    this.persistEvents(transaction, decision.events);
    this.persistAudits(transaction, decision.auditRecords);
  }

  private persistAsset(
    transaction: firestore.Transaction,
    loaded: LoadedAssetLifecycle,
    asset: AssetLifecycleView | undefined,
  ): void {
    if (asset === undefined) return;
    const canonicalFields = {
      ...(!loaded.canonical.exists
        ? {
            ...(loaded.legacy.data() ?? {}),
            createdAt: FieldValue.serverTimestamp(),
          }
        : {}),
      assetId: asset.assetId,
      householdId: asset.householdId,
      lifecycleState: asset.lifecycleState,
      aggregateVersion: asset.aggregateVersion,
      ...(asset.deletedAt === undefined
        ? loaded.canonical.exists
          ? { deletedAt: FieldValue.delete() }
          : {}
        : { deletedAt: asset.deletedAt }),
      schemaVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(loaded.canonical.ref, canonicalFields, { merge: true });
    transaction.set(
      loaded.legacy.ref,
      {
        householdId: asset.householdId,
        isActive: asset.lifecycleState === "active",
        aggregateVersion: asset.aggregateVersion,
        ...(asset.deletedAt === undefined
          ? loaded.legacy.exists
            ? { deletedAt: FieldValue.delete() }
            : {}
          : { deletedAt: asset.deletedAt }),
        schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!loaded.legacy.exists
          ? { createdAt: FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
    );
  }

  private persistReceipt(
    transaction: firestore.Transaction,
    loaded: LoadedAssetLifecycle,
    record: AssetLifecycleRecord,
    result: AssetLifecycleCommandResult,
  ): void {
    if (loaded.receiptExists) return;
    const stored = record.commandReceipts[this.input.idempotencyKey];
    if (stored === undefined) return;
    transaction.create(
      loaded.receiptReference,
      terminalReceiptFields({
        principalUid: this.input.administratorPrincipalRef,
        householdId: this.input.householdId,
        payloadFingerprint: stored.payloadFingerprint,
        result,
        completedAt: this.input.requestedAt,
      }),
    );
  }

  private persistEvents(
    transaction: firestore.Transaction,
    events: readonly AssetLifecycleEvent[],
  ): void {
    for (const event of events) {
      new FirebaseTransactionalOutbox(this.database).append(transaction, {
        eventId: accessEventId(
          this.input.commandId,
          event.eventType,
          event.assetId,
        ),
        eventType: event.eventType,
        householdId: this.input.householdId,
        aggregateId: event.assetId,
        aggregateVersion: event.aggregateVersion,
        occurredAt: this.input.requestedAt,
        correlationId: this.input.commandId,
        causationId: this.input.commandId,
        payload: { ...event },
      });
    }
  }

  private persistAudits(
    transaction: firestore.Transaction,
    audits: readonly AssetLifecycleAuditRecord[],
  ): void {
    for (const audit of audits) {
      transaction.create(
        this.database
          .collection("assetLifecycleAuditRecords")
          .doc(`${this.input.householdId}_${audit.commandId}`),
        {
          ...audit,
          householdId: this.input.householdId,
          schemaVersion: ACCESS_SCHEMA_VERSION,
          createdAt: FieldValue.serverTimestamp(),
        },
      );
    }
  }

  receipts(): readonly AssetLifecycleReceipt[] {
    return [];
  }

  events(): readonly AssetLifecycleEvent[] {
    return [];
  }

  auditRecords(): readonly AssetLifecycleAuditRecord[] {
    return [];
  }
}
