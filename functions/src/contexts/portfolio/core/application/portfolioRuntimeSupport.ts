import {
  validateAssetCreation,
  type AssetOwnerRef,
  type AssetType,
} from "../domain/model/assetCreation";
import { normalizeCanonicalAssetSubType } from "../domain/policies/legacyAssetNormalization";
import type {
  PortfolioAtomicResult,
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioOwnerProfileReference,
  PortfolioRuntimeAsset,
  PortfolioRuntimeEvent,
  PortfolioRuntimeMutation,
  PortfolioRuntimeState,
} from "./ports/out/portfolioRuntimeStorePort";

const ASSET_TYPES = new Set<AssetType>([
  "savings",
  "stock",
  "crypto",
  "property",
  "gold",
  "loan",
]);

export const ASSET_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "type",
  "subType",
  "owner",
  "ownerRef",
  "currentBalance",
  "costBasis",
  "initialInvestment",
  "currency",
  "memo",
  "icon",
  "color",
  "isActive",
  "order",
  "stockCode",
  "quantity",
  "recurringContributionAmount",
  "recurringContributionDay",
  "lastAutoContributionMonth",
  "loanInterestRate",
  "loanRepaymentMethod",
  "loanMonthlyPaymentAmount",
  "loanPaymentDay",
  "lastAutoRepaymentMonth",
]);

export type ParseResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "error"; readonly code: string };

export type PortfolioAtomicExecutor = (
  metadata: PortfolioCommandMetadata,
  decide: (state: PortfolioRuntimeState) => PortfolioRuntimeMutation,
) => Promise<PortfolioCommandResult>;

export function success(
  value: Readonly<Record<string, unknown>>,
): PortfolioCommandResult {
  return { kind: "success", value };
}

export function error(code: string, retryable = false): PortfolioCommandResult {
  return { kind: "error", code, ...(retryable ? { retryable: true } : {}) };
}

export function noWrite(
  state: PortfolioRuntimeState,
  value: PortfolioCommandResult,
): PortfolioRuntimeMutation {
  return { writes: false, state, events: [], value };
}

export function commit(
  state: PortfolioRuntimeState,
  events: readonly PortfolioRuntimeEvent[],
  value: PortfolioCommandResult,
): PortfolioRuntimeMutation {
  return { writes: true, state, events, value };
}

export function normalizeAtomicResult(
  result: PortfolioAtomicResult,
): PortfolioCommandResult {
  switch (result.kind) {
    case "committed":
    case "replayed":
      return result.value;
    case "payload-mismatch":
      return error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    case "commit-failed":
      return error("PORTFOLIO_UOW_FAILED", true);
  }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function containsOnly(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((field) => allowed.has(field));
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

export function requiredText(value: unknown, code: string): ParseResult<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return { kind: "error", code };
  }
  return { kind: "success", value: value.trim() };
}

export function optionalText(
  value: unknown,
  fallback: string,
  code: string,
): ParseResult<string> {
  if (value === undefined) return { kind: "success", value: fallback };
  return typeof value === "string"
    ? { kind: "success", value: value.trim() }
    : { kind: "error", code };
}

export function nonNegativeWon(
  value: unknown,
  code: string,
): ParseResult<number> {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? { kind: "success", value: value as number }
    : { kind: "error", code };
}

export function optionalNonNegativeWon(
  value: unknown,
  fallback: number | undefined,
  code: string,
): ParseResult<number | undefined> {
  if (value === undefined) return { kind: "success", value: fallback };
  return nonNegativeWon(value, code);
}

export function finiteNonNegative(
  value: unknown,
  code: string,
): ParseResult<number> {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { kind: "success", value }
    : { kind: "error", code };
}

export function optionalFiniteNonNegative(
  value: unknown,
  fallback: number | undefined,
  code: string,
): ParseResult<number | undefined> {
  if (value === undefined) return { kind: "success", value: fallback };
  return finiteNonNegative(value, code);
}

export function normalizeAssetType(value: unknown): AssetType | undefined {
  return typeof value === "string" && ASSET_TYPES.has(value as AssetType)
    ? (value as AssetType)
    : undefined;
}

export function normalizeSubType(
  type: AssetType,
  value: unknown,
): ParseResult<{ readonly canonical?: string; readonly legacy?: string }> {
  const normalized = normalizeCanonicalAssetSubType(type, value);
  return normalized === undefined
    ? { kind: "error", code: "INVALID_ASSET_SUBTYPE" }
    : { kind: "success", value: normalized };
}

function ownerDisplayName(
  ownerRef: AssetOwnerRef,
  profiles: readonly PortfolioOwnerProfileReference[],
  fallback = "가구",
): string {
  if (ownerRef.kind === "household") return "가구";
  return (
    profiles.find(({ profileId }) => profileId === ownerRef.profileId)
      ?.displayName ?? fallback
  );
}

export function parseOwner(input: {
  readonly rawOwnerRef?: unknown;
  readonly rawOwner?: unknown;
  readonly profiles: readonly PortfolioOwnerProfileReference[];
  readonly current?: PortfolioRuntimeAsset;
}): ParseResult<{ readonly ownerRef: AssetOwnerRef; readonly displayName: string }> {
  if (input.rawOwnerRef !== undefined) {
    const candidate = record(input.rawOwnerRef);
    if (candidate?.kind === "household" && Object.keys(candidate).length === 1) {
      return {
        kind: "success",
        value: { ownerRef: { kind: "household" }, displayName: "가구" },
      };
    }
    if (
      candidate?.kind === "profile" &&
      typeof candidate.profileId === "string" &&
      candidate.profileId.trim() !== "" &&
      Object.keys(candidate).every((key) => key === "kind" || key === "profileId")
    ) {
      const profileId = candidate.profileId.trim();
      if (
        input.current?.ownerRef.kind === "profile" &&
        input.current.ownerRef.profileId === profileId
      ) {
        return {
          kind: "success",
          value: {
            ownerRef: { kind: "profile", profileId },
            displayName: ownerDisplayName(
              { kind: "profile", profileId },
              input.profiles,
              input.current.ownerDisplayName,
            ),
          },
        };
      }
      const profile = input.profiles.find(
        (entry) =>
          entry.profileId === profileId && entry.lifecycleState === "active",
      );
      if (profile !== undefined) {
        return {
          kind: "success",
          value: {
            ownerRef: { kind: "profile", profileId },
            displayName: profile.displayName,
          },
        };
      }
    }
    return { kind: "error", code: "INVALID_OWNER_REF" };
  }

  if (input.rawOwner === undefined) {
    if (input.current !== undefined) {
      return {
        kind: "success",
        value: {
          ownerRef: input.current.ownerRef,
          displayName: input.current.ownerDisplayName,
        },
      };
    }
    return {
      kind: "success",
      value: { ownerRef: { kind: "household" }, displayName: "가구" },
    };
  }
  if (typeof input.rawOwner !== "string") {
    return { kind: "error", code: "INVALID_OWNER_REF" };
  }
  const displayName = input.rawOwner.trim();
  if (
    displayName === "" ||
    displayName === "가구" ||
    displayName.toLocaleLowerCase("en-US") === "household"
  ) {
    return {
      kind: "success",
      value: { ownerRef: { kind: "household" }, displayName: "가구" },
    };
  }
  if (input.current?.ownerDisplayName === displayName) {
    return {
      kind: "success",
      value: {
        ownerRef: input.current.ownerRef,
        displayName: input.current.ownerDisplayName,
      },
    };
  }
  const matches = input.profiles.filter(
    (profile) =>
      profile.lifecycleState === "active" && profile.displayName === displayName,
  );
  return matches.length === 1
    ? {
        kind: "success",
        value: {
          ownerRef: { kind: "profile", profileId: matches[0].profileId },
          displayName: matches[0].displayName,
        },
      }
    : { kind: "error", code: "INVALID_OWNER_REF" };
}

export { validateAssetCreation };
