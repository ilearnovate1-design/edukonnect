import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import localConfig from '../../firebase-applet-config.json';
import { UserRole } from '../types';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || localConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || localConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || localConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || localConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || localConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || localConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || localConfig.measurementId,
};

/**
 * Provisions a new Auth account for a teacher or parent using a secondary Firebase instance.
 * This allows an admin to create accounts with default passwords without being logged out.
 */
export const provisionAccount = async (
  email: string, 
  password: string, 
  displayName: string, 
  role: UserRole, 
  schoolId: string,
  extraData: Record<string, any> = {}
): Promise<{ uid: string }> => {
  if (!schoolId || !schoolId.trim()) {
    throw new Error('Provisioning failed: A verified, non-empty schoolId is required.');
  }
  if (role === 'SUPER_ADMIN') {
    throw new Error('Provisioning failed: Cannot provision SUPER_ADMIN accounts via school admin portal.');
  }

  const normalizedSchoolId = schoolId.trim().toLowerCase();

  // 1. Initialize a secondary Firebase App
  const secondaryAppName = `provision-${Date.now()}`;
  const secondaryApp = initializeApp(config, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    // 2. Create the Auth account
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
    const uid = userCredential.user.uid;

    // 3. Immediately sign out of the secondary instance to be safe
    await signOut(secondaryAuth);

    // 4. Create the Firestore user profile in the main database
    // We use the main 'db' instance because we are still logged in as Admin there
    const userDocRef = doc(db, 'users', uid);
    await setDoc(userDocRef, {
      uid,
      email: email.toLowerCase().trim(),
      displayName,
      role,
      schoolId: normalizedSchoolId,
      approvalStatus: 'APPROVED',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...extraData
    });

    return { uid };
  } catch (error: any) {
    console.error('Provisioning failed:', error);
    throw error;
  } finally {
    // 5. Clean up: Delete the secondary app instance
    await deleteApp(secondaryApp);
  }
};
