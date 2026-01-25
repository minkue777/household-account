import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCyjcqLX9Gs-yIghFsq9v-vC6K91ZhMuYM",
  authDomain: "household-account-6f300.firebaseapp.com",
  projectId: "household-account-6f300",
  storageBucket: "household-account-6f300.firebasestorage.app",
  messagingSenderId: "530451947649",
  appId: "1:530451947649:web:b5630cc4326eaddbbfad80",
  measurementId: "G-P93WXQT9WT"
};

// Initialize Firebase (prevent re-initialization)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

export { app, db };
