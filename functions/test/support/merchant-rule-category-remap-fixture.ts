import { remapMerchantRulePage, type MerchantRuleRemapPage } from "../../src/contexts/payment-capture/configuration/application/merchantRuleCategoryRemapApplication";
import type { RemappableMerchantRule } from "../../src/contexts/payment-capture/configuration/application/ports/in/merchantRuleCategoryRemapInputPort";

export function createMerchantRuleCategoryRemapFixture(fixture: { readonly rules: readonly RemappableMerchantRule[] }) {
  let rules = structuredClone(fixture.rules);
  const receipts = new Map<string, ReturnType<typeof remapMerchantRulePage>["result"]>();
  return {
    remapPage(input: MerchantRuleRemapPage & { readonly commitOutcome?: "success" | "failure" }) {
      const key = JSON.stringify([input.processId, input.cursor]);
      const replay = receipts.get(key);
      if (replay) return structuredClone(replay);
      const change = remapMerchantRulePage(rules, input);
      if (input.commitOutcome === "failure") return { kind: "RetryableFailure" as const, code: "PAGE_COMMIT_FAILED" as const };
      rules = change.rules;
      receipts.set(key, change.result);
      return structuredClone(change.result);
    },
    state() { return { rules: structuredClone(rules), processedPages: [...receipts.values()].map(result => ({
      processId: result.processId, cursor: result.cursor, result: structuredClone(result),
    })) }; },
  };
}
