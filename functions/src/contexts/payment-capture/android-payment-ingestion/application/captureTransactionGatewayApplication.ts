import {
  createMerchantRuleSelectionPolicy,
  createOwnCardResolutionPolicy,
  createPaymentDraftEnrichmentBoundary,
  type MerchantMappingDecision,
} from "../../configuration/public";
import type { CaptureTransactionGatewayPort } from "./ports/out/captureTransactionGatewayPort";
import type { CaptureConfigurationQueryPort } from "./ports/out/captureConfigurationQueryPort";
import type { CaptureLedgerPersistencePort } from "./ports/out/captureLedgerPersistencePort";

function mappedValue(
  field: MerchantMappingDecision["merchant"] | MerchantMappingDecision["memo"],
): string | undefined {
  return field.kind === "replace" ? field.value : undefined;
}

function mappedCategory(
  field: MerchantMappingDecision["category"],
): string | undefined {
  return field.kind === "replace" ? field.categoryId : undefined;
}

export function createCaptureTransactionGatewayApplication(input: {
  readonly configuration: CaptureConfigurationQueryPort;
  readonly ledger: CaptureLedgerPersistencePort;
}): CaptureTransactionGatewayPort {
  const cardPolicy = createOwnCardResolutionPolicy();
  const merchantRulePolicy = createMerchantRuleSelectionPolicy();
  const enrichmentBoundary = createPaymentDraftEnrichmentBoundary();
  return {
    async record(command) {
      const context = command.branch.captureContext;
      if (context === undefined) {
        return { kind: "rejected", code: "CAPTURE_CONTEXT_REQUIRED" };
      }
      const loaded = await input.configuration.load({
        householdId: command.householdId,
        actingMemberId: context.creatorMemberId,
      });
      if (loaded.kind === "retryable-failure") {
        return { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" };
      }
      const configuration = loaded.value;
      const cityGas = command.branch.sourceType === "city-gas-bill";

      let canonicalCardId: string | undefined;
      let resolvedCardEvidence:
        | { readonly companyLabel: string; readonly lastFour: string }
        | undefined;
      if (!cityGas) {
        if (context.cardEvidence === undefined) {
          return { kind: "rejected", code: "CARD_EVIDENCE_REQUIRED" };
        }
        const card = cardPolicy.resolve({
          actingMemberId: context.creatorMemberId,
          evidence: context.cardEvidence,
          cards: configuration.cards.map((candidate) => ({
            cardId: candidate.cardId,
            ownerMemberId: candidate.ownerMemberId,
            cardCompany: candidate.companyLabel,
            lastFour: candidate.lastFour ?? "",
            lifecycleState: candidate.lifecycleState,
          })),
        });
        if (card.kind === "unmatched") {
          return { kind: "rejected", code: card.reason };
        }
        canonicalCardId = card.canonicalEvidence?.cardId;
        resolvedCardEvidence =
          card.canonicalEvidence === undefined
            ? undefined
            : {
                companyLabel: card.canonicalEvidence.companyLabel,
                lastFour: card.canonicalEvidence.lastFour,
              };
      }

      const rule = merchantRulePolicy.resolve({
        merchant: command.branch.merchant,
        memo: "",
        rules: configuration.merchantRules,
      });
      if (rule.kind === "contractFailure") {
        return { kind: "rejected", code: rule.code };
      }
      const mapping =
        rule.kind === "matched"
          ? {
              ...(mappedValue(rule.mapping.merchant) === undefined
                ? {}
                : { merchant: mappedValue(rule.mapping.merchant) }),
              ...(mappedCategory(rule.mapping.category) === undefined
                ? {}
                : { categoryId: mappedCategory(rule.mapping.category) }),
              ...(mappedValue(rule.mapping.memo) === undefined
                ? {}
                : { memo: mappedValue(rule.mapping.memo) }),
            }
          : undefined;

      if (context.observationType === "cancellation") {
        const mappedMerchant = mapping?.merchant ?? command.branch.merchant;
        return input.ledger.cancel({
          householdId: command.householdId,
          downstreamKey: command.downstreamKey,
          branch: {
            observationId: context.observationId,
            creatorMemberId: context.creatorMemberId,
            sourceType: command.branch.sourceType,
            parser: command.branch.parser,
            rawPayloadHash: command.branch.rawPayloadHash,
            observedAt: command.branch.occurredAt,
            cancellationDate: command.branch.accountingDate,
            amountInWon: command.branch.amountInWon,
            merchant: mappedMerchant,
            ...(context.cardEvidence === undefined
              ? {}
              : { cardEvidence: context.cardEvidence }),
            ...(canonicalCardId === undefined ? {} : { canonicalCardId }),
          },
        });
      }

      const enrichment = enrichmentBoundary.enrich({
        parsed: {
          sourceKind: cityGas ? "city-gas" : "payment",
          merchant: command.branch.merchant,
          categoryId: cityGas ? "fixed" : undefined,
          memo: "",
        },
        merchantRuleLookup:
          mapping === undefined
            ? { kind: "Unmatched" }
            : { kind: "Matched", mapping },
        defaultCategoryLookup:
          configuration.defaultCategoryId === undefined
            ? { kind: "Missing" }
            : configuration.activeCategoryIds.has(
                  configuration.defaultCategoryId,
                )
              ? {
                  kind: "Found",
                  categoryId: configuration.defaultCategoryId,
                }
              : { kind: "InvalidReference" },
      });
      if (enrichment.kind === "RetryableFailure") {
        return { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" };
      }
      if (enrichment.kind === "Rejected") {
        return { kind: "rejected", code: enrichment.code };
      }
      if (!configuration.activeCategoryIds.has(enrichment.draft.categoryId)) {
        return { kind: "rejected", code: "INVALID_CATEGORY_REFERENCE" };
      }

      return input.ledger.recordApproval({
        householdId: command.householdId,
        downstreamKey: command.downstreamKey,
        branch: {
          observationId: context.observationId,
          originChannel: context.originChannel,
          creatorMemberId: context.creatorMemberId,
          sourceType: command.branch.sourceType,
          parser: command.branch.parser,
          rawPayloadHash: command.branch.rawPayloadHash,
          occurredAt: command.branch.occurredAt,
          accountingDate: command.branch.accountingDate,
          amountInWon: command.branch.amountInWon,
          originalMerchant: command.branch.merchant,
          merchant: enrichment.draft.merchant,
          categoryId: enrichment.draft.categoryId,
          memo: enrichment.draft.memo,
          ...(context.cardEvidence === undefined
            ? {}
            : { cardEvidence: context.cardEvidence }),
          ...(resolvedCardEvidence === undefined
            ? {}
            : { resolvedCardEvidence }),
          ...(canonicalCardId === undefined ? {} : { canonicalCardId }),
          ...(command.branch.localCurrencyType === undefined
            ? {}
            : { localCurrencyType: command.branch.localCurrencyType }),
        },
      });
    },
  };
}
