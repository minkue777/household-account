'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppLoadingScreen from '@/components/AppLoadingScreen';

export default function GuestPage() {
  const router = useRouter();
  useEffect(() => router.replace('/'), [router]);
  return <AppLoadingScreen />;
}
