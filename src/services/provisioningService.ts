import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
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

const isProtectedSuperAdminEmail = (email: string) =>
  email === 'ilearnovate1@gmail.com' || email === 'admin@edukonnect.ng';

/**
 * Provisions a new Auth account for a teacher or parent using a secondary Firebase instance.
 * If the Auth email already exists with the supplied temp password, safely resolves the UID
 * via secondaryAuth without disturbing the admin's active session.
 * Atomically writes BOTH users/{uid} and memberships/{schoolId}_{uid} so tenant rules authorize immediately.
 */
export const provisionAccount = async (
  email: string,
  password: string,
  displayName: string,
  role: UserRole,
  schoolId: string,
  extraData: Record<string, any> = {}
): Promise<{ uid: string; reusedExistingAuth?: boolean }> => {
  if (!schoolId || !schoolId.trim()) {
    throw new Error('Provisioning failed: A verified, non-empty schoolId is required.');
  }
  if (role === 'SUPER_ADMIN') {
    throw new Error('Provisioning failed: Cannot provision SUPER_ADMIN accounts via school admin portal.');
  }

  const normalizedSchoolId = schoolId.trim().toLowerCase();
  const normalizedEmail = email.toLowerCase().trim();

  if (isProtectedSuperAdminEmail(normalizedEmail)) {
    throw new Error('Cannot provision a platform SuperAdmin email as a school staff or parent account.');
  }

  const secondaryAppName = `provision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const secondaryApp = initializeApp(config, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    let uid = '';
    let reusedExistingAuth = false;

    try {
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, password);
      uid = userCredential.user.uid;
    } catch (createErr: any) {
      const createCode = String(createErr?.code || createErr?.message || '');
      if (createCode.includes('auth/email-already-in-use')) {
        try {
          const existingCred = await signInWithEmailAndPassword(secondaryAuth, normalizedEmail, password);
          uid = existingCred.user.uid;
          reusedExistingAuth = true;
        } catch {
          // Account already exists with a different password (e.g. user changed password or Google Sign-In)
          console.warn('Account already exists in Firebase Auth; UID will link on next user sign-in.');
          throw createErr;
        }
      } else {
        throw createErr;
      }
    } finally {
      await signOut(secondaryAuth).catch(() => {});
    }

    const { schoolName, linkedStudentIds, ...userExtra } = extraData || {};
    const membershipId = `${normalizedSchoolId}_${uid}`;

    const batch = writeBatch(db);
    const userDocRef = doc(db, 'users', uid);

    // Preserve createdAt if user doc already exists
    let hasExistingUserDoc = false;
    if (reusedExistingAuth) {
      const existingSnap = await getDoc(userDocRef).catch(() => null);
      if (existingSnap?.exists()) {
        hasExistingUserDoc = true;
        const existingData = existingSnap.data() as any;
        if (existingData?.isSuperAdmin || existingData?.role === 'SUPER_ADMIN') {
          throw new Error('Cannot overwrite a platform SuperAdmin profile.');
        }
      }
    }

    batch.set(
      userDocRef,
      {
        uid,
        email: normalizedEmail,
        displayName,
        role,
        isSuperAdmin: false,
        schoolId: normalizedSchoolId,
        approvalStatus: 'APPROVED',
        active: true,
        ...(hasExistingUserDoc ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
        ...userExtra,
      },
      { merge: true }
    );

    const membershipRef = doc(db, 'memberships', membershipId);
    batch.set(
      membershipRef,
      {
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
        ...(reusedExistingAuth ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    return { uid, reusedExistingAuth };
  } catch (error: any) {
    const errCode = String(error?.code || error?.message || '');
    if (!errCode.includes('auth/email-already-in-use')) {
      console.warn('Provisioning notice:', error?.message || error);
    }
    throw error;
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
};
