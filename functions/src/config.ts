import * as admin from 'firebase-admin';

admin.initializeApp();

export const db = admin.firestore();
export const messaging = admin.messaging();
export const REGION = 'asia-northeast3';
export const API_TOKEN = 'household-account-ios-shortcut-2024';
