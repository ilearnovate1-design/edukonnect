import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import localConfig from '../../firebase-applet-config.json';
import { UserRole } from '../types';

const config = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || localConfig.apiKey,
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || localConfig.authDomain,
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || localConfig.projectId,
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || localConfig.storageBucket,
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || localConfig.messagingSenderId,
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || localConfig.appId,
  measurementId: import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID || localConfig.measurementId,
};

/**
 * Provisions a new Auth account for a teacher or parent using a secondary Firebase instance.
 * Atomically writes BOTH users/{uid} and memberships/{schoolId}_{uid} so tenant rules authorize immediately.
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
  const normalizedEmail = email.toLowerCase().trim();

  const secondaryAppName = `provision-${Date.now()}`;
  const secondaryApp = initializeApp(config, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, password);
    const uid = userCredential.user.uid;

    await signOut(secondaryAuth);

    const { schoolName, linkedStudentIds, ...userExtra } = extraData || {};
    const membershipId = `${normalizedSchoolId}_${uid}`;

    const batch = writeBatch(db);
    const userDocRef = doc(db, 'users', uid);
    batch.set(userDocRef, {
      uid,
      email: normalizedEmail,
      displayName,
      role,
      isSuperAdmin: false,
      schoolId: normalizedSchoolId,
      approvalStatus: 'APPROVED',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...userExtra,
    });

    const membershipRef = doc(db, 'memberships', membershipId);
    batch.set(membershipRef, {
      id: membershipId,
      userId: uid,
      userEmail: normalizedEmail,
      schoolId: normalizedSchoolId,
      ...(schoolName ? { schoolName } : {}),
      role,
      status: 'ACTIVE',
      ...(userExtra.teacherId ? { teacherId: userExtra.teacherId } : {}),
      ...(userExtra.parentId ? { parentId: userExtra.parentId } : {}),
      ...(Array.isArray(linkedStudentIds) ? { linkedStudentIds } : {}),
      activatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    return { uid };
  } catch (error: any) {
    console.error('Provisioning failed:', error);
    throw error;
  } finally {
    await deleteApp(secondaryApp);
  }
};
