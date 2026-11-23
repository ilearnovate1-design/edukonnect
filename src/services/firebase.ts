import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import localConfig from '../../firebase-applet-config.json';

// Support both embedded configuration and Vite environment variables for portability
const config = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || localConfig.apiKey,
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || localConfig.authDomain,
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || localConfig.projectId,
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || localConfig.storageBucket,
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || localConfig.messagingSenderId,
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || localConfig.appId,
  measurementId: import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID || localConfig.measurementId,
  firestoreDatabaseId: import.meta.env?.VITE_FIREBASE_DATABASE_ID || localConfig.firestoreDatabaseId,
};

const app = getApps().length > 0 ? getApp() : initializeApp({
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
  measurementId: config.measurementId
});

// Initialize Firestore reliably with ignoreUndefinedProperties to prevent fatal undefined field errors
let firestoreInstance;

try {
  firestoreInstance = config.firestoreDatabaseId
    ? initializeFirestore(app, { ignoreUndefinedProperties: true }, config.firestoreDatabaseId)
    : initializeFirestore(app, { ignoreUndefinedProperties: true });
} catch (e) {
  try {
    firestoreInstance = config.firestoreDatabaseId
      ? getFirestore(app, config.firestoreDatabaseId)
      : getFirestore(app);
  } catch (fallbackErr) {
    console.warn('Firestore fallback notice:', fallbackErr);
    firestoreInstance = getFirestore(app);
  }
}

export const db = firestoreInstance;
export const auth = getAuth(app);
export const storage = getStorage(app);

// Connectivity Test Utility
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

export default app;
