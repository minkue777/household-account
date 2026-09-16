import type { Household } from '@/types/household';
import type { SignedInUserResolution } from './signedInMembershipCache';
import { resolveHomeSummaryConfig } from '@/features/home-preferences/application/homeSummaryConfig';

export function householdFromResolution(
  resolution: Extract<SignedInUserResolution, { kind: 'membership-found' }>
): Household | undefined {
  const value = resolution.household;
  if (
    !value
    || value.id !== resolution.membership.householdId
    || value.name.trim() === ''
    || Number.isNaN(Date.parse(value.createdAt))
    || value.members.some(
      (member) =>
        member.id.trim() === ''
        || member.name.trim() === ''
        || !Number.isInteger(member.aggregateVersion)
        || member.aggregateVersion < 1
    )
  ) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    createdAt: new Date(value.createdAt),
    categoryCatalogVersion: value.categoryCatalogVersion ?? 0,
    homeSummaryConfigVersion: value.homeSummaryConfigVersion ?? 0,
    selectedLocalCurrencyType: value.selectedLocalCurrencyType,
    initializationStatus: value.initializationStatus,
    ...(value.defaultCategoryKey === undefined
      ? {}
      : { defaultCategoryKey: value.defaultCategoryKey }),
    homeSummaryConfig: resolveHomeSummaryConfig(value.homeSummaryConfig),
    members: value.members.map((member) => ({ ...member })),
  };
}

export function householdToResolutionView(
  household: Household
): NonNullable<
  Extract<SignedInUserResolution, { kind: 'membership-found' }>['household']
> {
  return {
    id: household.id,
    name: household.name,
    createdAt: household.createdAt.toISOString(),
    categoryCatalogVersion: household.categoryCatalogVersion ?? 0,
    homeSummaryConfigVersion: household.homeSummaryConfigVersion ?? 0,
    selectedLocalCurrencyType: household.selectedLocalCurrencyType,
    initializationStatus: household.initializationStatus,
    ...(household.defaultCategoryKey === undefined
      ? {}
      : { defaultCategoryKey: household.defaultCategoryKey }),
    ...(household.homeSummaryConfig === undefined
      ? {}
      : { homeSummaryConfig: household.homeSummaryConfig }),
    members: household.members.map((member) => ({ ...member })),
  };
}

export function sameHousehold(left: Household | null, right: Household): boolean {
  if (
    left === null
    || left.id !== right.id
    || left.name !== right.name
    || left.createdAt.getTime() !== right.createdAt.getTime()
    || left.defaultCategoryKey !== right.defaultCategoryKey
    || (left.categoryCatalogVersion ?? 0) !== (right.categoryCatalogVersion ?? 0)
    || (left.homeSummaryConfigVersion ?? 0) !== (right.homeSummaryConfigVersion ?? 0)
    || left.selectedLocalCurrencyType !== right.selectedLocalCurrencyType
    || left.initializationStatus !== right.initializationStatus
    || left.homeSummaryConfig?.leftCard !== right.homeSummaryConfig?.leftCard
    || left.homeSummaryConfig?.rightCard !== right.homeSummaryConfig?.rightCard
    || left.members.length !== right.members.length
  ) {
    return false;
  }

  return left.members.every((member, index) => {
    const nextMember = right.members[index];
    return member.id === nextMember.id
      && member.name === nextMember.name
      && member.aggregateVersion === nextMember.aggregateVersion;
  });
}
