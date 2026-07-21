export interface AssetOwnerProfile {
  profileId: string;
  householdId: string;
  displayName: string;
  profileType: "member" | "dependent";
  linkedMemberId?: string;
  /**
   * 가구의 자산 명의자 목록에 들어온 시각입니다. 공개 응답에는 노출하지 않고
   * 목록의 안정적인 등록 순서를 결정할 때만 사용합니다.
   */
  createdAt?: string;
  lifecycleState: "active" | "archived";
  aggregateVersion: number;
}

export interface HouseholdMember {
  principalUid: string;
  memberId: string;
  displayName: string;
  profileId: string;
  aggregateVersion: number;
}

export interface HouseholdMembership {
  principalUid: string;
  memberId: string;
  householdId: string;
  status: "active";
}

export interface AssetOwnerProfileChangedEvent {
  eventType: "AssetOwnerProfileChanged.v1";
  householdId: string;
  payload: {
    profileId: string;
    profileType: "member" | "dependent";
    lifecycleState: "active" | "archived";
    newDisplayName?: string;
  };
}

export interface AssetOwnerProfileState {
  householdId: string;
  profiles: readonly AssetOwnerProfile[];
  members: readonly HouseholdMember[];
  memberships: readonly HouseholdMembership[];
  events: readonly AssetOwnerProfileChangedEvent[];
}
