import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { AppUser, UserRole, Parent, Teacher, UserApprovalStatus } from '../types';

interface AuthContextType {
  currentUser: User | null;
  appUser: AppUser | null;
  role: UserRole | null;
  schoolId: string;
  isSuperAdmin: boolean;
  isAtLeastAdmin: boolean;
  loading: boolean;
  currentParent: Parent | null;
  currentTeacher: Teacher | null;
  login: (email: string, pass: string, portalRole?: UserRole) => Promise<void>;
  signup: (email: string, pass: string, name: string, role?: UserRole, schoolId?: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserPassword: (currentPass: string, newPass: string) => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  switchToRole: (newRole: UserRole, targetSchoolId?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [currentParent, setCurrentParent] = useState<Parent | null>(null);
  const [currentTeacher, setCurrentTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (firebaseUser: User, overrideRole?: UserRole) => {
    try {
      const fetchWithTimeout = async (ref: any) => {
        const snapPromise = getDoc(ref).catch((err) => {
          console.warn(`Notice reading ${ref.path} (offline or pending):`, err?.message || err);
          return null;
        });
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
        return await Promise.race([snapPromise, timeoutPromise]);
      };

      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const userSnap: any = await fetchWithTimeout(userDocRef);

      const emailLower = firebaseUser.email?.toLowerCase().trim() || '';
      const isSuperAdminEmail = 
        emailLower === 'ilearnovate1@gmail.com' || 
        emailLower === 'admin@edukonnect.ng';

      // 1. Authoritative Membership Search in Firestore
      // Search teachers collection by email or userId
      let teacherDoc: Teacher | null = null;
      try {
        const tQuery = query(collection(db, 'teachers'), where('email', '==', emailLower));
        const tSnap = await getDocs(tQuery);
        if (!tSnap.empty) {
          teacherDoc = tSnap.docs[0].data() as Teacher;
        } else {
          const tQuery2 = query(collection(db, 'teachers'), where('userId', '==', firebaseUser.uid));
          const tSnap2 = await getDocs(tQuery2);
          if (!tSnap2.empty) {
            teacherDoc = tSnap2.docs[0].data() as Teacher;
          }
        }
      } catch (tErr) {
        console.warn('Teacher lookup notice:', tErr);
      }

      // Search parents collection by email or userId
      let parentDoc: Parent | null = null;
      try {
        const pQuery = query(collection(db, 'parents'), where('email', '==', emailLower));
        const pSnap = await getDocs(pQuery);
        if (!pSnap.empty) {
          parentDoc = pSnap.docs[0].data() as Parent;
        } else {
          const pQuery2 = query(collection(db, 'parents'), where('userId', '==', firebaseUser.uid));
          const pSnap2 = await getDocs(pQuery2);
          if (!pSnap2.empty) {
            parentDoc = pSnap2.docs[0].data() as Parent;
          }
        }
      } catch (pErr) {
        console.warn('Parent lookup notice:', pErr);
      }

      // 2. Authoritative Teacher Resolution
      if (teacherDoc) {
        const targetSchoolId = teacherDoc.schoolId?.trim().toLowerCase() || '';
        const userDisplayName = teacherDoc.firstName && teacherDoc.lastName 
          ? `${teacherDoc.firstName} ${teacherDoc.lastName}`
          : firebaseUser.displayName || 'Teacher';

        // Link userId on teacher record if missing
        if (!teacherDoc.userId || teacherDoc.userId !== firebaseUser.uid) {
          try {
            await updateDoc(doc(db, 'teachers', teacherDoc.teacherId), {
              userId: firebaseUser.uid,
              updatedAt: serverTimestamp()
            });
            teacherDoc.userId = firebaseUser.uid;
          } catch (linkErr) {
            console.warn('Could not link teacher userId:', linkErr);
          }
        }

        const teacherUser: AppUser = {
          uid: firebaseUser.uid,
          email: emailLower,
          displayName: userDisplayName,
          role: 'TEACHER',
          isSuperAdmin: false,
          schoolId: targetSchoolId,
          teacherId: teacherDoc.teacherId,
          assignedClassIds: teacherDoc.assignedClassIds || [],
          approvalStatus: targetSchoolId ? 'APPROVED' : 'PENDING_APPROVAL',
          active: teacherDoc.status !== 'INACTIVE',
          createdAt: userSnap?.exists?.() ? userSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        try {
          await setDoc(userDocRef, teacherUser, { merge: true });
        } catch (syncErr) {
          console.warn('User doc sync notice for teacher:', syncErr);
        }

        setCurrentTeacher(teacherDoc);
        setCurrentParent(null);
        setAppUser(teacherUser);
        return;
      }

      // 3. Authoritative Parent Resolution
      if (parentDoc) {
        const targetSchoolId = parentDoc.schoolId?.trim().toLowerCase() || '';
        const userDisplayName = parentDoc.firstName && parentDoc.lastName
          ? `${parentDoc.firstName} ${parentDoc.lastName}`
          : firebaseUser.displayName || 'Parent';

        // Link userId on parent record if missing
        if (!parentDoc.userId || parentDoc.userId !== firebaseUser.uid) {
          try {
            await updateDoc(doc(db, 'parents', parentDoc.parentId), {
              userId: firebaseUser.uid,
              updatedAt: serverTimestamp()
            });
            parentDoc.userId = firebaseUser.uid;
          } catch (linkErr) {
            console.warn('Could not link parent userId:', linkErr);
          }
        }

        const parentUser: AppUser = {
          uid: firebaseUser.uid,
          email: emailLower,
          displayName: userDisplayName,
          role: 'PARENT',
          isSuperAdmin: false,
          schoolId: targetSchoolId,
          parentId: parentDoc.parentId,
          approvalStatus: targetSchoolId ? 'APPROVED' : 'PENDING_APPROVAL',
          active: true,
          createdAt: userSnap?.exists?.() ? userSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        try {
          await setDoc(userDocRef, parentUser, { merge: true });
        } catch (syncErr) {
          console.warn('User doc sync notice for parent:', syncErr);
        }

        setCurrentParent(parentDoc);
        setCurrentTeacher(null);
        setAppUser(parentUser);
        return;
      }

      // 4. Platform Super Admin Resolution
      if (isSuperAdminEmail) {
        const superAdminUser: AppUser = {
          uid: firebaseUser.uid,
          email: emailLower,
          displayName: firebaseUser.displayName || 'Platform Super Administrator',
          role: 'SUPER_ADMIN',
          isSuperAdmin: true,
          schoolId: 'default',
          approvalStatus: 'APPROVED',
          active: true,
          createdAt: userSnap?.exists?.() ? userSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        try {
          await setDoc(userDocRef, superAdminUser, { merge: true });
        } catch (syncErr) {
          console.warn('Superadmin user sync notice:', syncErr);
        }

        setCurrentTeacher(null);
        setCurrentParent(null);
        setAppUser(superAdminUser);
        return;
      }

      // 5. Existing User Document Processing (School Admin / Staff)
      if (userSnap && userSnap.exists && userSnap.exists()) {
        const uData = userSnap.data() as AppUser;
        
        // Prevent unauthorized client elevation to SUPER_ADMIN
        if (uData.role === 'SUPER_ADMIN' && !isSuperAdminEmail && !uData.isSuperAdmin) {
          uData.role = 'ADMIN';
        }

        // Validate School Admin school membership
        if (uData.role === 'ADMIN') {
          if (!uData.schoolId || uData.schoolId === 'default') {
            // Check if this admin has configured a school
            uData.approvalStatus = uData.approvalStatus || 'PENDING_SETUP';
          }
        }

        // If user document previously had role TEACHER or PARENT but no matching record exists in teachers/parents
        if (uData.role === 'TEACHER' || uData.role === 'PARENT') {
          if (!uData.schoolId || uData.schoolId === 'default') {
            // Unverified membership: do not assign default school
            uData.schoolId = '';
            uData.approvalStatus = 'PENDING_APPROVAL';
          }
        }

        setAppUser(uData);
        setCurrentTeacher(null);
        setCurrentParent(null);
        return;
      }

      // 6. First-time registration or login for School Administrator
      const initialApproval: UserApprovalStatus = 'PENDING_SETUP';
      const newAdminUser: AppUser = {
        uid: firebaseUser.uid,
        email: emailLower,
        role: 'ADMIN',
        isSuperAdmin: false,
        approvalStatus: initialApproval,
        schoolId: '', // Explicitly empty; must be configured in InitialSetupPage
        displayName: firebaseUser.displayName || 'School Administrator',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(userDocRef, newAdminUser);
      } catch (e) {
        console.warn('Could not persist initial admin user doc:', e);
      }

      setCurrentTeacher(null);
      setCurrentParent(null);
      setAppUser(newAdminUser);

    } catch (err: any) {
      console.warn('Notice fetching user profile from Firestore:', err?.message || err);
      const emailLower = firebaseUser.email?.toLowerCase().trim() || '';
      const isSuperAdminEmail = 
        emailLower === 'ilearnovate1@gmail.com' || 
        emailLower === 'admin@edukonnect.ng';

      setAppUser((prev) => prev || {
        uid: firebaseUser.uid,
        email: emailLower,
        displayName: firebaseUser.displayName || 'EduKonnect User',
        role: isSuperAdminEmail ? 'SUPER_ADMIN' : 'ADMIN',
        isSuperAdmin: isSuperAdminEmail,
        approvalStatus: isSuperAdminEmail ? 'APPROVED' : 'PENDING_SETUP',
        schoolId: isSuperAdminEmail ? 'default' : '',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  };

  /**
   * Privilege escalation prevention:
   * Only authenticated SUPER_ADMIN can switch views/roles for simulation.
   * Ordinary teachers, parents, and admins CANNOT modify their role or school membership.
   */
  const switchToRole = async (newRole: UserRole, targetSchoolId?: string) => {
    if (!currentUser || !appUser) return;

    if (!appUser.isSuperAdmin && appUser.role !== 'SUPER_ADMIN') {
      console.warn('Unauthorized role change attempt blocked. Users cannot alter their role or school membership.');
      return;
    }

    // SUPER_ADMIN preview role in memory only - do not overwrite database account
    setAppUser((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        role: newRole,
        schoolId: targetSchoolId || prev.schoolId || 'default'
      };
    });
  };

  useEffect(() => {
    // Safety timer: ensure loading is never stuck at true for more than 2.5 seconds
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      clearTimeout(safetyTimer);
      setCurrentUser(user);
      if (user) {
        try {
          await fetchProfile(user);
        } catch (e) {
          console.warn('Profile fetch notice:', e);
        }
      } else {
        setAppUser(null);
        setCurrentParent(null);
        setCurrentTeacher(null);
      }
      setLoading(false);
    });

    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, []);

  const login = async (email: string, pass: string, portalRole?: UserRole) => {
    const res = await signInWithEmailAndPassword(auth, email.trim(), pass);
    if (portalRole) {
      try {
        localStorage.setItem('preferred_portal_role', portalRole);
      } catch (e) {}
    }
    await fetchProfile(res.user, portalRole);
  };

  const signup = async (
    email: string, 
    pass: string, 
    name: string, 
    role: UserRole = 'ADMIN',
    schoolId: string = ''
  ) => {
    const res = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    // Leverage authoritative membership resolution
    await fetchProfile(res.user);
  };

  const logout = async () => {
    await signOut(auth);
    setAppUser(null);
    setCurrentParent(null);
    setCurrentTeacher(null);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const updateUserPassword = async (currentPass: string, newPass: string) => {
    if (!currentUser || !currentUser.email) {
      throw new Error('You must be signed in to change your password.');
    }
    if (!currentPass || !currentPass.trim()) {
      throw new Error('Please enter your current password.');
    }
    if (!newPass || newPass.length < 6) {
      throw new Error('New password must be at least 6 characters long.');
    }
    
    // 1. Re-authenticate first (required for sensitive ops)
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPass.trim());
      await reauthenticateWithCredential(currentUser, credential);
    } catch (authErr: any) {
      const msg = authErr?.message || authErr?.code || String(authErr);
      if (
        msg.includes('auth/invalid-credential') ||
        msg.includes('auth/invalid-login-credentials') ||
        msg.includes('auth/wrong-password')
      ) {
        throw new Error('The current password you entered is incorrect. Please check and try again, or send a password reset email below.');
      }
      if (msg.includes('auth/too-many-requests')) {
        throw new Error('Too many unsuccessful attempts. Please wait a moment or use the reset link option below.');
      }
      throw new Error(authErr?.message || 'Authentication verification failed. Please check your current password.');
    }
    
    // 2. Update password
    try {
      await updatePassword(currentUser, newPass.trim());
    } catch (passErr: any) {
      const msg = passErr?.message || passErr?.code || String(passErr);
      if (msg.includes('auth/weak-password')) {
        throw new Error('The new password is too weak. Please use at least 6 characters.');
      }
      if (msg.includes('auth/requires-recent-login')) {
        throw new Error('For security, your session has expired. Please sign out and sign in again before updating your password.');
      }
      throw new Error(passErr?.message || 'Failed to update password.');
    }
  };

  const refreshUserProfile = async () => {
    if (currentUser) {
      await fetchProfile(currentUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        appUser,
        role: appUser?.role || null,
        schoolId: appUser?.schoolId || 'default',
        isSuperAdmin: !!appUser?.isSuperAdmin,
        isAtLeastAdmin: appUser?.role === 'ADMIN' || !!appUser?.isSuperAdmin,
        loading,
        currentParent,
        currentTeacher,
        login,
        signup,
        logout,
        resetPassword,
        updateUserPassword,
        refreshUserProfile,
        switchToRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
