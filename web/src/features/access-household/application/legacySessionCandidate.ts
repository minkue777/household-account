import { HouseholdStorage } from '@/lib/storage/householdStorage';
import { MemberStorage } from '@/lib/storage/memberStorage';

export interface LegacySessionCandidate {
  legacyHouseholdId: string;
  legacyMemberId: string;
  legacyMemberName?: string;
}

export function captureLegacySessionCandidate(): LegacySessionCandidate | undefined {
  const legacyHouseholdId = HouseholdStorage.get()?.trim();
  const legacyMemberId = MemberStorage.getMemberId()?.trim();
  if (!legacyHouseholdId || !legacyMemberId) return undefined;

  const legacyMemberName = MemberStorage.getMemberName()?.trim();
  return {
    legacyHouseholdId,
    legacyMemberId,
    ...(legacyMemberName ? { legacyMemberName } : {}),
  };
}

export function clearLegacySessionCandidate(): void {
  HouseholdStorage.clear();
  MemberStorage.remove();
}
