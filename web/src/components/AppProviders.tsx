'use client';

import { ThemeProvider } from '@/contexts/ThemeContext';
import { CalendarStyleProvider } from '@/contexts/CalendarStyleContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <HouseholdProvider>
      <HouseholdGuard>
        <ThemeProvider>
          <CalendarStyleProvider>
            <CategoryProvider>
              {children}
            </CategoryProvider>
          </CalendarStyleProvider>
        </ThemeProvider>
      </HouseholdGuard>
    </HouseholdProvider>
  );
}
