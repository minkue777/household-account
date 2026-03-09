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
} from '@/lib/householdService';
import { HouseholdMember, WindowWithBridge } from '@/types/household';
import { MemberStorage } from '@/lib/storage/memberStorage';

interface HouseholdContextType {
  household: Household | null;
  householdKey: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  currentMember: HouseholdMember | null;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
  selectMember: (member: HouseholdMember) => void;
  addMember: (name: string) => Promise<HouseholdMember>;
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
        addMember,
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
