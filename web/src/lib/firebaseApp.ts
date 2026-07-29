import { getApps, initializeApp } from 'firebase/app';
import {
  firebaseRuntimeProjectId,
  isFirebaseEmulatorSuiteConfigured,
} from '@/platform/firebase/firebaseEmulatorConfig';

const firebaseConfig = isFirebaseEmulatorSuiteConfigured()
  ? {
      apiKey: 'demo-api-key',
      authDomain: `${firebaseRuntimeProjectId}.firebaseapp.com`,
      projectId: firebaseRuntimeProjectId,
      storageBucket: `${firebaseRuntimeProjectId}.appspot.com`,
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:emulator',
    }
  : {
      apiKey: 'AIzaSyCyjcqLX9Gs-yIghFsq9v-vC6K91ZhMuYM',
      authDomain: 'household-account-6f300.firebaseapp.com',
      projectId: firebaseRuntimeProjectId,
      storageBucket: 'household-account-6f300.firebasestorage.app',
      messagingSenderId: '530451947649',
      appId: '1:530451947649:web:b5630cc4326eaddbbfad80',
      measurementId: 'G-P93WXQT9WT',
    };

/** Firebase 제품 SDK와 분리된 가벼운 공통 App 인스턴스입니다. */
export const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];
