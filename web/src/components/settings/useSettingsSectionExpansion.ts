'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/** Expansion belongs to the current settings visit, not browser history. */
export function useSettingsSectionExpansion() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => { setIsOpen(false); }, [pathname]);

  useEffect(() => {
    const collapse = () => setIsOpen(false);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) collapse();
    };
    // A restored document keeps React state instead of mounting the page again.
    window.addEventListener('pagehide', collapse);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', collapse);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return [isOpen, setIsOpen] as const;
}
