import {
  firebaseRuntimeProjectId,
  isFirebaseEmulatorSuiteConfigured,
} from './firebaseEmulatorConfig';

export const firebaseConfig = isFirebaseEmulatorSuiteConfigured()
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
