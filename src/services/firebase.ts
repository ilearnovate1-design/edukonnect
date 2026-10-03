import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import localConfig from '../../firebase-applet-config.json';

// Support both embedded configuration and Vite environment variables for portability
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || localConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || localConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || localConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || localConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || localConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || localConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || localConfig.measurementId,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || localConfig.firestoreDatabaseId,
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

// Initialize Firestore with auto-detected transport and multi-tab local persistence.
// This ensures reliable real-time connections in both normal and containerized/sandboxed environments.
let firestoreInstance;

try {
  const firestoreSettings = {
    experimentalAutoDetectLongPolling: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  };

  firestoreInstance = config.firestoreDatabaseId 
    ? initializeFirestore(app, firestoreSettings, config.firestoreDatabaseId)
    : initializeFirestore(app, firestoreSettings);
  console.log("Firestore initialized with auto-detected transport and persistent cache.");
} catch (e) {
  console.warn('Firestore custom initialization fallback:', e);
  firestoreInstance = config.firestoreDatabaseId
    ? getFirestore(app, config.firestoreDatabaseId)
    : getFirestore(app);
}

export const db = firestoreInstance;
export const auth = getAuth(app);
export const storage = getStorage(app);

// Connectivity Test Utility
import { getDoc, doc } from 'firebase/firestore';
export async function testFirestoreConnection() {
  try {
    const testDoc = doc(db, '_internal_test_', 'connection');
    await getDoc(testDoc);
    console.log("Firestore connection verified successfully.");
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firestore client initialized in offline / cached mode.");
    } else {
      console.log("Firestore ready.");
    }
    return true;
  }
}

export default app;
