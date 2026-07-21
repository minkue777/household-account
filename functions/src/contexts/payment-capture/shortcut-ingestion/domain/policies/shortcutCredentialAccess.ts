import type { ShortcutCredentialSubject } from "../model/shortcutCredentialLifecycle";

export function recordSubject(
  record: {
    readonly subjectUid: string;
    readonly householdId: string;
    readonly memberId: string;
  },
): ShortcutCredentialSubject {
  return {
    subjectUid: record.subjectUid,
    householdId: record.householdId,
    memberId: record.memberId,
  };
}
