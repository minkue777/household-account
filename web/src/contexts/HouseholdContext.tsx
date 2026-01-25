'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  Household,
  getHousehold,
  validateHouseholdKey,
  getStoredHouseholdKey,
  setStoredHouseholdKey,
  clearStoredHouseholdKey,
} from '@/lib/householdService';

interface HouseholdContextType {
  household: Household | null;
  householdKey: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
}

const HouseholdContext = createContext<HouseholdContextType | undefined>(undefined);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [householdKey, setHouseholdKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 초기 로드: 저장된 키 확인
  useEffect(() => {
    const loadHousehold = async () => {
      const storedKey = getStoredHouseholdKey();

      if (storedKey) {
        const isValid = await validateHouseholdKey(storedKey);
        if (isValid) {
          const data = await getHousehold(storedKey);
          setHousehold(data);
          setHouseholdKey(storedKey);
        } else {
          clearStoredHouseholdKey();
        }
      }

      setIsLoading(false);
    };

    loadHousehold();
  }, []);

  const login = async (key: string): Promise<boolean> => {
    const upperKey = key.toUpperCase();
    const isValid = await validateHouseholdKey(upperKey);

    if (isValid) {
      const data = await getHousehold(upperKey);
      setHousehold(data);
      setHouseholdKey(upperKey);
      setStoredHouseholdKey(upperKey);
      return true;
    }

    return false;
  };

  const logout = () => {
    setHousehold(null);
    setHouseholdKey(null);
    clearStoredHouseholdKey();
  };

  return (
    <HouseholdContext.Provider
      value={{
        household,
        householdKey,
        isLoading,
        isAuthenticated: !!householdKey,
        login,
        logout,
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
