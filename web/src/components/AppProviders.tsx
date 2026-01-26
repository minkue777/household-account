'use client';

import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <HouseholdProvider>
      <HouseholdGuard>
        <ThemeProvider>
          <CategoryProvider>
            {children}
          </CategoryProvider>
        </ThemeProvider>
      </HouseholdGuard>
    </HouseholdProvider>
  );
}
