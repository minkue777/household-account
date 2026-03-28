export const ALL_MEMBERS_OPTION = '전체';
export const HOUSEHOLD_OWNER_OPTION = '가구';

function normalizeMemberNames(memberNames: string[]): string[] {
  return Array.from(new Set(memberNames.map((name) => name.trim()).filter(Boolean)));
}

export function getAssetMemberOptions(memberNames: string[]): string[] {
  return [ALL_MEMBERS_OPTION, ...normalizeMemberNames(memberNames)];
}

export function getAssetOwnerOptions(memberNames: string[]): string[] {
  return [HOUSEHOLD_OWNER_OPTION, ...normalizeMemberNames(memberNames)];
}

export function buildLegacyAssetOwnerMap(memberNames: string[]): Record<string, string> {
  const normalizedNames = normalizeMemberNames(memberNames);
  const legacyNames = ['이민규', '이진선', '이지아'];
  const ownerMap: Record<string, string> = {};

  legacyNames.forEach((legacyName, index) => {
    const mappedName = normalizedNames[index];
    if (mappedName && mappedName !== legacyName) {
      ownerMap[legacyName] = mappedName;
    }
  });

  return ownerMap;
}
