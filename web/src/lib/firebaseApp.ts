import { getApps, initializeApp } from 'firebase/app';
import { firebaseConfig } from '@/platform/firebase/firebasePublicConfig';

/** Web과 통합 worker가 동일한 빌드 설정을 사용합니다. */
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
