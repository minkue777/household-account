import type { PwaRootRegistration } from "../model/pwaRootRuntime";
import type {
  PwaSessionCleanupState,
  PwaSessionReadGate,
} from "../model/pwaSessionScope";
import { isIntegratedRootRegistration } from "./pwaRootRuntimePolicy";

export function canInstallPwaWorkerUpdate(
  registration: PwaRootRegistration,
  requiredAssetsPrepared: boolean,
): boolean {
  return requiredAssetsPrepared && isIntegratedRootRegistration(registration);
}

export function pwaStaticCacheNamespace(cacheVersion: string): string {
  return `household-static-${cacheVersion}`;
}

export function isPwaOwnedStaticCache(namespace: string): boolean {
  return namespace.startsWith("household-static-");
}

export function isPwaSessionDerivedCache(namespace: string): boolean {
  return namespace.startsWith("session:");
}

export function pwaSessionReadGate(input: {
  readonly sessionGeneration?: string;
  readonly cleanupState: PwaSessionCleanupState;
}): PwaSessionReadGate {
  if (input.cleanupState !== "clean") return "blocked-cleanup-failed";
  return input.sessionGeneration === undefined
    ? "blocked-until-authentication"
    : "open";
}
