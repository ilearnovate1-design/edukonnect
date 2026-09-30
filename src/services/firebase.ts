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

// Initialize Firestore with auto-detected long polling and fetch stream disabled.
// This prevents connection drops and enables smooth connectivity in containerized environments.
let firestoreInstance;
const firestoreSettings = {
  experimentalForceLongPolling: true,
  useFetchStream: false,
  host: 'firestore.googleapis.com',
  ssl: true,
};

try {
  // Use initializeFirestore with optimized settings.
  firestoreInstance = config.firestoreDatabaseId 
    ? initializeFirestore(app, firestoreSettings, config.firestoreDatabaseId)
    : initializeFirestore(app, firestoreSettings);
  console.log("Firestore initialized with long polling and fetch stream disabled.");
} catch (e) {
  console.warn('Firestore initialization failed, falling back to basic setup:', e);
  firestoreInstance = config.firestoreDatabaseId
    ? getFirestore(app, config.firestoreDatabaseId)
    : getFirestore(app);
}

export const db = firestoreInstance;
export const auth = getAuth(app);
export const storage = getStorage(app);

// Connectivity Test Utility (Skill Requirement)
import { getDocFromServer, doc } from 'firebase/firestore';
export async function testFirestoreConnection() {
  try {
    const testDoc = doc(db, '_internal_test_', 'connection');
    await getDocFromServer(testDoc);
    console.log("Firestore connection verified successfully.");
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Firebase connection failed: The client is offline. Check configuration or internet.");
    } else {
      console.warn("Firestore connection check produced an expected error for an empty DB, but reached the server.");
    }
    return false;
  }
}

export default app;
