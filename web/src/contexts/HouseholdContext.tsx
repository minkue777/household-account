'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  Household,
  getHousehold,
  validateHouseholdKey,
  getStoredHouseholdKey,
  setStoredHouseholdKey,
  clearStoredHouseholdKey,
  addHouseholdMember,
  renameHouseholdMember as renameHouseholdMemberInService,
} from '@/lib/householdService';
import { HouseholdMember, WindowWithBridge } from '@/types/household';
import { MemberStorage } from '@/lib/storage/memberStorage';
import { refreshFcmToken } from '@/lib/pushNotificationService';

interface HouseholdContextType {
  household: Household | null;
  householdKey: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  currentMember: HouseholdMember | null;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
  selectMember: (member: HouseholdMember) => void;
  switchMember: () => void;
  addMember: (name: string) => Promise<HouseholdMember>;
  renameMember: (memberId: string, name: string) => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextType | undefined>(undefined);

/**
 * Android 브리지로 멤버 정보 동기화
 */
function syncMemberToAndroidBridge(member: HouseholdMember, partner: HouseholdMember | undefined) {
  const bridge = (window as unknown as WindowWithBridge).AndroidBridge;
  if (!bridge) return;
  bridge.setMemberName?.(member.name);
  if (partner) {
    bridge.setPartnerName?.(partner.name);
  }
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [householdKey, setHouseholdKey] = useState<string | null>(null);
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 초기 로드: 저장된 키 + 멤버 확인
  useEffect(() => {
    const loadHousehold = async () => {
      const storedKey = getStoredHouseholdKey();

      if (storedKey) {
        const isValid = await validateHouseholdKey(storedKey);
        if (isValid) {
          const data = await getHousehold(storedKey);
          setHousehold(data);
          setHouseholdKey(storedKey);

          // 저장된 멤버 ID로 currentMember 복원
          const storedMemberId = MemberStorage.getMemberId();
          if (storedMemberId && data?.members) {
            const member = data.members.find(m => m.id === storedMemberId);
            if (member) {
              setCurrentMember(member);
            } else {
              // 저장된 ID가 멤버 목록에 없으면 초기화
              MemberStorage.remove();
            }
          }
        } else {
          clearStoredHouseholdKey();
        }
      }

      setIsLoading(false);
    };

    loadHousehold();
  }, []);

  const login = async (key: string): Promise<boolean> => {
    const trimmedKey = key.trim();
    const isValid = await validateHouseholdKey(trimmedKey);

    if (isValid) {
      const data = await getHousehold(trimmedKey);
      setHousehold(data);
      setHouseholdKey(trimmedKey);
      setStoredHouseholdKey(trimmedKey);
      return true;
    }

    return false;
  };

  const logout = () => {
    setHousehold(null);
    setHouseholdKey(null);
    setCurrentMember(null);
    clearStoredHouseholdKey();
    MemberStorage.remove();
  };

  const switchMember = useCallback(() => {
    setCurrentMember(null);
    MemberStorage.remove();
  }, []);

  const selectMember = useCallback((member: HouseholdMember) => {
    setCurrentMember(member);
    MemberStorage.set(member.id, member.name);

    // 파트너 이름 계산 및 저장
    const partner = household?.members.find(m => m.id !== member.id);
    if (partner) {
      MemberStorage.setPartnerName(partner.name);
    }

    // Android 브리지 동기화
    if (typeof window !== 'undefined') {
      syncMemberToAndroidBridge(member, partner);
    }

    // FCM 토큰에 deviceOwner 반영
    refreshFcmToken().catch(() => {});
  }, [household]);

  const addMember = useCallback(async (name: string): Promise<HouseholdMember> => {
    if (!householdKey) {
      throw new Error('가구 키가 없습니다');
    }
    const newMember = await addHouseholdMember(householdKey, name);

    // household 상태 업데이트
    setHousehold(prev => prev ? {
      ...prev,
      members: [...prev.members, newMember],
    } : prev);

    return newMember;
  }, [householdKey]);

  const renameMember = useCallback(async (memberId: string, name: string): Promise<void> => {
    const trimmedName = name.trim();
    if (!householdKey || !household) {
      throw new Error('멤버 정보를 찾을 수 없습니다');
    }

    if (!trimmedName) {
      throw new Error('이름을 입력해주세요');
    }

    const targetMember = household.members.find((member) => member.id === memberId);
    if (!targetMember) {
      throw new Error('멤버 정보를 찾을 수 없습니다');
    }

    if (trimmedName === targetMember.name) {
      return;
    }

    await renameHouseholdMemberInService(householdKey, memberId, trimmedName);

    const updatedMembers = household.members.map((member) =>
      member.id === memberId ? { ...member, name: trimmedName } : member
    );

    setHousehold({
      ...household,
      members: updatedMembers,
    });

    if (currentMember?.id === memberId) {
      const updatedMember = { ...currentMember, name: trimmedName };
      const partner = updatedMembers.find((member) => member.id !== currentMember.id);

      setCurrentMember(updatedMember);
      MemberStorage.set(updatedMember.id, updatedMember.name);
      if (partner) {
        MemberStorage.setPartnerName(partner.name);
      }

      if (typeof window !== 'undefined') {
        syncMemberToAndroidBridge(updatedMember, partner);
      }

      refreshFcmToken().catch(() => {});
      return;
    }

    if (currentMember) {
      const partner = updatedMembers.find((member) => member.id !== currentMember.id);
      if (partner) {
        MemberStorage.setPartnerName(partner.name);
      }

      if (typeof window !== 'undefined') {
        syncMemberToAndroidBridge(currentMember, partner);
      }
    }
  }, [currentMember, household, householdKey]);

  return (
    <HouseholdContext.Provider
      value={{
        household,
        householdKey,
        isLoading,
        isAuthenticated: !!householdKey,
        currentMember,
        login,
        logout,
        selectMember,
        switchMember,
        addMember,
        renameMember,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const context = useContext(HouseholdContext);
  if (context === undefined) {
    throw new Error('useHousehold must be used within a HouseholdProvider');
  }
  return context;
}
