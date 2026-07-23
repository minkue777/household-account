import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { logger } from "firebase-functions";

export const INTERACTIVE_LATENCY_LOG_NAME = "interactive-latency";
export const INTERACTIVE_LATENCY_SCHEMA_VERSION =
  "interactive-latency.v1" as const;

export type InteractiveLatencyEndpoint =
  | "executeHouseholdCommand"
  | "executeHouseholdQuery"
  | "submitAndroidRawNotification";

export type InteractiveLatencyStage =
  | "actor-membership"
  | "command-receipt-claim"
  | "command-receipt-complete"
  | "command-receipt-abandon"
  | "handler"
  | "capture-membership"
  | "capture-receipt-claim"
  | "capture-receipt-save"
  | "capture-configuration"
  | "capture-persistence";

export type InteractiveLatencyStatus =
  | "succeeded"
  | "rejected"
  | "failed";

export interface InteractiveLatencyLogEntry {
  readonly schemaVersion: typeof INTERACTIVE_LATENCY_SCHEMA_VERSION;
  readonly correlationId: string;
  readonly endpoint: InteractiveLatencyEndpoint;
  readonly operation: string;
  readonly revision: string;
  readonly processBootId: string;
  readonly invocationSequence: number;
  readonly stage: InteractiveLatencyStage | "total";
  readonly elapsedMs: number;
  readonly status: InteractiveLatencyStatus;
}

export interface InteractiveLatencyLogSink {
  write(entry: InteractiveLatencyLogEntry): void;
}

interface MonotonicClock {
  now(): number;
}

interface InteractiveLatencyContext {
  readonly correlationId: string;
  readonly endpoint: InteractiveLatencyEndpoint;
  readonly revision: string;
  readonly processBootId: string;
  readonly invocationSequence: number;
  readonly startedAt: number;
  readonly clock: MonotonicClock;
  readonly sink: InteractiveLatencyLogSink;
  operation: string;
  completed: boolean;
}

export interface InteractiveLatencyInvocation {
  readonly correlationId: string;
  run<T>(task: () => Promise<T>): Promise<T>;
  complete(status: InteractiveLatencyStatus): void;
}

const contexts = new AsyncLocalStorage<InteractiveLatencyContext>();
const PROCESS_BOOT_ID = randomUUID();
const CORRELATION_HASH_PATTERN = /^[a-f0-9]{16}$/u;
const OPERATION_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9][0-9]*$/u;
let invocationSequence = 0;

const defaultClock: MonotonicClock = {
  now: () => performance.now(),
};

const defaultSink: InteractiveLatencyLogSink = {
  write(entry) {
    // Firebase logger keeps this payload structured in Cloud Logging and renders
    // the same allowlisted fields in the local Functions emulator.
    logger.info(INTERACTIVE_LATENCY_LOG_NAME, entry);
  },
};

function safeRevision(candidate: string | undefined): string | undefined {
  const normalized = candidate?.trim();
  return normalized !== undefined &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)
    ? normalized
    : undefined;
}

function processRevision(): string {
  return (
    safeRevision(process.env.K_REVISION) ??
    safeRevision(process.env.FUNCTION_VERSION) ??
    safeRevision(process.env.GAE_VERSION) ??
    safeRevision(process.env.GIT_REVISION) ??
    (process.env.FUNCTIONS_EMULATOR === "true"
      ? "local-emulator"
      : "unknown")
  );
}

const PROCESS_REVISION = processRevision();

function elapsedMilliseconds(context: InteractiveLatencyContext, start: number) {
  const elapsed = Math.max(0, context.clock.now() - start);
  return Math.round(elapsed * 1_000) / 1_000;
}

function emit(
  context: InteractiveLatencyContext,
  stage: InteractiveLatencyStage | "total",
  start: number,
  status: InteractiveLatencyStatus,
): void {
  const entry: InteractiveLatencyLogEntry = {
    schemaVersion: INTERACTIVE_LATENCY_SCHEMA_VERSION,
    correlationId: context.correlationId,
    endpoint: context.endpoint,
    operation: context.operation,
    revision: context.revision,
    processBootId: context.processBootId,
    invocationSequence: context.invocationSequence,
    stage,
    elapsedMs: elapsedMilliseconds(context, start),
    status,
  };
  try {
    context.sink.write(entry);
  } catch {
    // Telemetry must never change an interactive request outcome.
  }
}

export function startInteractiveLatencyInvocation(
  endpoint: InteractiveLatencyEndpoint,
  options: {
    readonly clock?: MonotonicClock;
    readonly correlationId?: string;
    readonly sink?: InteractiveLatencyLogSink;
  } = {},
): InteractiveLatencyInvocation {
  const clock = options.clock ?? defaultClock;
  const context: InteractiveLatencyContext = {
    correlationId:
      options.correlationId !== undefined &&
      CORRELATION_HASH_PATTERN.test(options.correlationId)
        ? options.correlationId
        : randomUUID(),
    endpoint,
    operation: endpoint,
    revision: PROCESS_REVISION,
    processBootId: PROCESS_BOOT_ID,
    invocationSequence: ++invocationSequence,
    startedAt: clock.now(),
    clock,
    sink: options.sink ?? defaultSink,
    completed: false,
  };
  return {
    correlationId: context.correlationId,
    run: (task) => contexts.run(context, task),
    complete(status) {
      if (context.completed) return;
      context.completed = true;
      emit(context, "total", context.startedAt, status);
    },
  };
}

export function correlationIdFromOpaqueValue(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function setCurrentInteractiveLatencyOperation(operation: string): void {
  const context = contexts.getStore();
  if (
    context !== undefined &&
    operation.length <= 120 &&
    OPERATION_PATTERN.test(operation)
  ) {
    context.operation = operation;
  }
}

export async function measureCurrentInteractiveLatency<T>(
  stage: InteractiveLatencyStage,
  task: () => T | Promise<T>,
): Promise<T> {
  const context = contexts.getStore();
  if (context === undefined) return task();

  const startedAt = context.clock.now();
  try {
    const value = await task();
    emit(context, stage, startedAt, "succeeded");
    return value;
  } catch (error) {
    emit(context, stage, startedAt, "failed");
    throw error;
  }
}

export function measureCurrentInteractiveLatencySync<T>(
  stage: InteractiveLatencyStage,
  task: () => T,
): T {
  const context = contexts.getStore();
  if (context === undefined) return task();

  const startedAt = context.clock.now();
  try {
    const value = task();
    emit(context, stage, startedAt, "succeeded");
    return value;
  } catch (error) {
    emit(context, stage, startedAt, "failed");
    throw error;
  }
}
