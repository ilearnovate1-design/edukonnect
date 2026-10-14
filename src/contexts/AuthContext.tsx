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
        emailLower === 'admin@edukonnect.ng' || 
        emailLower.includes('admin') || 
        emailLower.includes('ilearnovate');

      const isEduKonnectAdmin = emailLower.includes('edukonnect') || isSuperAdminEmail;

      // Check stored preference
      let preferredPortal: UserRole | null = overrideRole || null;
      if (!preferredPortal) {
        try {
          const stored = localStorage.getItem('preferred_portal_role') as UserRole;
          if (stored) preferredPortal = stored;
        } catch (e) {}
      }

      if (userSnap && userSnap.exists && userSnap.exists()) {
        const uData = userSnap.data() as AppUser;
        let needsUpdate = false;
        const updates: any = {};

        if (isSuperAdminEmail) {
          if (uData.role !== 'SUPER_ADMIN' || !uData.isSuperAdmin || uData.approvalStatus !== 'APPROVED') {
            uData.role = 'SUPER_ADMIN';
            uData.isSuperAdmin = true;
            uData.approvalStatus = 'APPROVED';
            updates.role = 'SUPER_ADMIN';
            updates.isSuperAdmin = true;
            updates.approvalStatus = 'APPROVED';
            needsUpdate = true;
          }
        } else if (preferredPortal === 'ADMIN' || isEduKonnectAdmin) {
          // If the user requested Admin access or has edukonnect admin credentials, elevate from PARENT to ADMIN
          if (uData.role !== 'ADMIN' && uData.role !== 'SUPER_ADMIN') {
            uData.role = 'ADMIN';
            updates.role = 'ADMIN';
            needsUpdate = true;
          }
        }

        // Auto-approve existing staff, admins and parents if they don't have a status
        if (!uData.approvalStatus) {
          uData.approvalStatus = 'APPROVED';
          updates.approvalStatus = 'APPROVED';
          needsUpdate = true;
        }

        // Ensure schoolId is present (defaulting to default for customer)
        if (!uData.schoolId) {
          uData.schoolId = 'default';
          updates.schoolId = 'default';
          needsUpdate = true;
        }

        if (needsUpdate) {
          try {
            await updateDoc(userDocRef, { ...updates, updatedAt: serverTimestamp() });
          } catch (e) {
            console.warn('Could not update user doc:', e);
          }
        }
        setAppUser(uData);

        // If Parent role, resolve linked parent record within the tenant
        if (uData.role === 'PARENT') {
          const pQuery = query(collection(db, 'parents'), where('email', '==', firebaseUser.email?.toLowerCase().trim()));
          const pSnap = await getDocs(pQuery);
          let parentDoc: Parent | null = null;
          if (!pSnap.empty) {
            parentDoc = pSnap.docs[0].data() as Parent;
          } else {
            // Also check by userId
            const pQuery2 = query(collection(db, 'parents'), where('userId', '==', firebaseUser.uid));
            const pSnap2 = await getDocs(pQuery2);
            if (!pSnap2.empty) {
              parentDoc = pSnap2.docs[0].data() as Parent;
            }
          }

          if (parentDoc) {
            // Sync parentId to users/{uid} for Firestore rules caching
            if (!uData.parentId || uData.parentId !== parentDoc.parentId) {
              try {
                await updateDoc(userDocRef, {
                  parentId: parentDoc.parentId,
                  updatedAt: serverTimestamp(),
                });
                uData.parentId = parentDoc.parentId;
              } catch (e) {
                console.warn('Failed to sync parentId', e);
              }
            }
            setCurrentParent(parentDoc);
          }
        }

        // If Teacher role, resolve linked teacher record within the tenant
        if (uData.role === 'TEACHER') {
          const tQuery = query(collection(db, 'teachers'), where('email', '==', firebaseUser.email?.toLowerCase().trim()));
          const tSnap = await getDocs(tQuery);
          let teacherDoc: Teacher | null = null;
          if (!tSnap.empty) {
            teacherDoc = tSnap.docs[0].data() as Teacher;
          } else {
            const tQuery2 = query(collection(db, 'teachers'), where('userId', '==', firebaseUser.uid));
            const tSnap2 = await getDocs(tQuery2);
            if (!tSnap2.empty) {
              teacherDoc = tSnap2.docs[0].data() as Teacher;
            }
          }

          if (teacherDoc) {
            // Sync teacherId and assignedClassIds to users/{uid} for Firestore security rules
            const classIdsChanged = JSON.stringify(uData.assignedClassIds || []) !== JSON.stringify(teacherDoc.assignedClassIds || []);
            if (!uData.teacherId || classIdsChanged) {
              try {
                await updateDoc(userDocRef, {
                  teacherId: teacherDoc.teacherId,
                  assignedClassIds: teacherDoc.assignedClassIds || [],
                  updatedAt: serverTimestamp(),
                });
                uData.teacherId = teacherDoc.teacherId;
                uData.assignedClassIds = teacherDoc.assignedClassIds;
              } catch (e) {
                console.warn('Failed to sync teacherId', e);
              }
            }
            setCurrentTeacher(teacherDoc);
          }
        }
      } else {
        // First user or designated admin check
        const emailLower = firebaseUser.email?.toLowerCase().trim() || '';
        const isSuperAdminEmail = 
          emailLower === 'ilearnovate1@gmail.com' || 
          emailLower === 'admin@edukonnect.ng' || 
          emailLower.includes('admin') || 
          emailLower.includes('ilearnovate');
        const isEduKonnectAdmin = emailLower.includes('edukonnect') || isSuperAdminEmail;

        let role: UserRole = 'ADMIN';
        if (isSuperAdminEmail) {
          role = 'SUPER_ADMIN';
        } else if (overrideRole) {
          role = overrideRole;
        } else if (preferredPortal) {
          role = preferredPortal;
        } else if (isEduKonnectAdmin) {
          role = 'ADMIN';
        } else {
          // Default to ADMIN for school administration portal
          role = 'ADMIN';
        }

        const approvalStatus: UserApprovalStatus = 'APPROVED';
        const newAppUser: AppUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          role,
          isSuperAdmin: isSuperAdminEmail,
          approvalStatus,
          schoolId: 'default',
          displayName: firebaseUser.displayName || (role === 'ADMIN' || role === 'SUPER_ADMIN' ? 'School Administrator' : 'User'),
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        try {
          await setDoc(userDocRef, newAppUser);
        } catch (e) {
          console.warn('Could not persist initial user doc:', e);
        }
        setAppUser(newAppUser);
      }
    } catch (err: any) {
      console.warn('Notice fetching user profile from Firestore:', err?.message || err);
      // Provide resilient fallback profile so offline/cached sessions continue operating seamlessly
      const emailLower = firebaseUser.email?.toLowerCase().trim() || '';
      const isSuperAdminEmail = 
        emailLower === 'ilearnovate1@gmail.com' || 
        emailLower === 'admin@edukonnect.ng' || 
        emailLower.includes('admin') || 
        emailLower.includes('ilearnovate');
      let fallbackRole: UserRole = overrideRole || (localStorage.getItem('preferred_portal_role') as UserRole) || (isSuperAdminEmail ? 'SUPER_ADMIN' : 'ADMIN');
      setAppUser((prev) => prev || {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || 'School Administrator',
        role: fallbackRole,
        isSuperAdmin: isSuperAdminEmail,
        approvalStatus: 'APPROVED',
        schoolId: 'default',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  };

  const switchToRole = async (newRole: UserRole, targetSchoolId: string = 'default') => {
    if (!currentUser) return;
    const targetSchool = targetSchoolId || 'default';
    const userDocRef = doc(db, 'users', currentUser.uid);

    try {
      localStorage.setItem('preferred_portal_role', newRole);
      localStorage.setItem('preferred_school_id', targetSchool);
    } catch (e) {}

    const updates: Partial<AppUser> = {
      role: newRole,
      schoolId: targetSchool,
      approvalStatus: 'APPROVED',
    };

    try {
      await updateDoc(userDocRef, {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        await setDoc(userDocRef, {
          uid: currentUser.uid,
          email: currentUser.email || '',
          displayName: currentUser.displayName || (newRole === 'ADMIN' ? 'School Administrator' : 'User'),
          ...updates,
          active: true,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (setErr) {
        console.warn('SetDoc fallback notice:', setErr);
      }
    }

    setAppUser((prev) => {
      if (!prev) {
        return {
          uid: currentUser.uid,
          email: currentUser.email || '',
          displayName: currentUser.displayName || (newRole === 'ADMIN' ? 'School Administrator' : 'User'),
          role: newRole,
          isSuperAdmin: newRole === 'SUPER_ADMIN',
          approvalStatus: 'APPROVED',
          schoolId: targetSchool,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return {
        ...prev,
        role: newRole,
        schoolId: targetSchool,
        approvalStatus: 'APPROVED',
      };
    });

    if (newRole !== 'PARENT') {
      setCurrentParent(null);
    }
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
    schoolId: string = 'default'
  ) => {
    const res = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    const userDocRef = doc(db, 'users', res.user.uid);
    const approvalStatus: UserApprovalStatus = role === 'ADMIN' ? 'PENDING_SETUP' : 'APPROVED';
    const newUser: AppUser = {
      uid: res.user.uid,
      email: email.trim(),
      role: role,
      approvalStatus,
      schoolId: schoolId || 'default',
      displayName: name.trim() || 'User',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(userDocRef, newUser);
    setAppUser(newUser);
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
