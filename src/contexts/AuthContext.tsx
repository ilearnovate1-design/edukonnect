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
import { AppUser, UserRole, Parent, Teacher, UserApprovalStatus, SchoolMembership } from '../types';

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
  userMemberships: SchoolMembership[];
  activeMembership: SchoolMembership | null;
  hasMultipleMemberships: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (email: string, pass: string, name: string, role?: UserRole, schoolId?: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserPassword: (currentPass: string, newPass: string) => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  switchToRole: (newRole: UserRole, targetSchoolId?: string) => Promise<void>;
  switchSchoolMembership: (schoolId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [currentParent, setCurrentParent] = useState<Parent | null>(null);
  const [currentTeacher, setCurrentTeacher] = useState<Teacher | null>(null);
  const [userMemberships, setUserMemberships] = useState<SchoolMembership[]>([]);
  const [activeMembership, setActiveMembership] = useState<SchoolMembership | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (firebaseUser: User) => {
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

      // 1. Platform Super Admin Resolution
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
        setUserMemberships([]);
        setActiveMembership(null);
        setAppUser(superAdminUser);
        return;
      }

      // 2. Discover Authoritative Memberships across sources
      const discoveredMemberships: SchoolMembership[] = [];
      const existingMembershipSchoolIds = new Set<string>();
      const blockedMembershipSchoolIds = new Set<string>();

      // A. Query memberships collection
      try {
        const mQuery1 = query(collection(db, 'memberships'), where('userId', '==', firebaseUser.uid));
        const mSnap1 = await getDocs(mQuery1);
        mSnap1.forEach((d) => {
          const m = { id: d.id, ...d.data() } as SchoolMembership;
          const mSchool = (m.schoolId || '').trim().toLowerCase();
          if (mSchool) existingMembershipSchoolIds.add(mSchool);
          if (m.status === 'ACTIVE' || !m.status) {
            discoveredMemberships.push(m);
          } else if (mSchool) {
            blockedMembershipSchoolIds.add(mSchool);
          }
        });

        if (discoveredMemberships.length === 0 && emailLower) {
          const mQuery2 = query(collection(db, 'memberships'), where('userEmail', '==', emailLower));
          const mSnap2 = await getDocs(mQuery2);
          mSnap2.forEach((d) => {
            const m = { id: d.id, ...d.data() } as SchoolMembership;
            const mSchool = (m.schoolId || '').trim().toLowerCase();
            if (mSchool) existingMembershipSchoolIds.add(mSchool);
            if (m.status === 'ACTIVE' || !m.status) {
              discoveredMemberships.push(m);
            } else if (mSchool) {
              blockedMembershipSchoolIds.add(mSchool);
            }
          });
        }
      } catch (mErr) {
        console.warn('Membership query notice:', mErr);
      }

      // B. Query teachers collection
      let teacherDocs: Teacher[] = [];
      try {
        if (emailLower) {
          const tQuery = query(collection(db, 'teachers'), where('email', '==', emailLower));
          const tSnap = await getDocs(tQuery);
          tSnap.forEach((d) => teacherDocs.push({ ...(d.data() as Teacher), teacherId: (d.data() as Teacher).teacherId || d.id }));
        }

        const tQuery2 = query(collection(db, 'teachers'), where('userId', '==', firebaseUser.uid));
        const tSnap2 = await getDocs(tQuery2);
        tSnap2.forEach((d) => {
          const td = { ...(d.data() as Teacher), teacherId: (d.data() as Teacher).teacherId || d.id };
          if (!teacherDocs.some((t) => t.teacherId === td.teacherId)) {
            teacherDocs.push(td);
          }
        });
      } catch (tErr) {
        console.warn('Teacher lookup notice:', tErr);
      }

      const inferredMembershipsToPersist: SchoolMembership[] = [];

      teacherDocs.forEach((t) => {
        const tSchool = t.schoolId?.trim().toLowerCase();
        if (tSchool && tSchool !== 'default' && t.status !== 'INACTIVE' && !blockedMembershipSchoolIds.has(tSchool)) {
          if (!discoveredMemberships.some((m) => m.schoolId.toLowerCase() === tSchool && m.role === 'TEACHER')) {
            const inferred: SchoolMembership = {
              id: `${tSchool}_${firebaseUser.uid}`,
              userId: firebaseUser.uid,
              userEmail: emailLower,
              schoolId: tSchool,
              role: 'TEACHER',
              status: 'ACTIVE',
              teacherId: t.teacherId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            discoveredMemberships.push(inferred);
            if (!existingMembershipSchoolIds.has(tSchool)) {
              inferredMembershipsToPersist.push(inferred);
            }
          }
        }
      });

      // C. Query parents collection
      let parentDocs: Parent[] = [];
      try {
        if (emailLower) {
          const pQuery = query(collection(db, 'parents'), where('email', '==', emailLower));
          const pSnap = await getDocs(pQuery);
          pSnap.forEach((d) => parentDocs.push({ ...(d.data() as Parent), parentId: (d.data() as Parent).parentId || d.id }));
        }

        const pQuery2 = query(collection(db, 'parents'), where('userId', '==', firebaseUser.uid));
        const pSnap2 = await getDocs(pQuery2);
        pSnap2.forEach((d) => {
          const pd = { ...(d.data() as Parent), parentId: (d.data() as Parent).parentId || d.id };
          if (!parentDocs.some((p) => p.parentId === pd.parentId)) {
            parentDocs.push(pd);
          }
        });
      } catch (pErr) {
        console.warn('Parent lookup notice:', pErr);
      }

      parentDocs.forEach((p) => {
        const pSchool = p.schoolId?.trim().toLowerCase();
        if (pSchool && pSchool !== 'default' && p.status !== 'INACTIVE' && !blockedMembershipSchoolIds.has(pSchool)) {
          if (!discoveredMemberships.some((m) => m.schoolId.toLowerCase() === pSchool && m.role === 'PARENT')) {
            const inferred: SchoolMembership = {
              id: `${pSchool}_${firebaseUser.uid}`,
              userId: firebaseUser.uid,
              userEmail: emailLower,
              schoolId: pSchool,
              role: 'PARENT',
              status: 'ACTIVE',
              parentId: p.parentId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            discoveredMemberships.push(inferred);
            if (!existingMembershipSchoolIds.has(pSchool)) {
              inferredMembershipsToPersist.push(inferred);
            }
          }
        }
      });

      // D. Check existing user document for ADMIN role & schoolId
      let existingUserDoc: AppUser | null = null;
      if (userSnap && userSnap.exists && userSnap.exists()) {
        existingUserDoc = userSnap.data() as AppUser;
        if (existingUserDoc.role === 'ADMIN' && existingUserDoc.schoolId && existingUserDoc.schoolId !== 'default') {
          const adminSchool = existingUserDoc.schoolId.trim().toLowerCase();
          if (!blockedMembershipSchoolIds.has(adminSchool) && !discoveredMemberships.some((m) => m.schoolId.toLowerCase() === adminSchool && m.role === 'ADMIN')) {
            const inferredAdmin: SchoolMembership = {
              id: `${adminSchool}_${firebaseUser.uid}`,
              userId: firebaseUser.uid,
              userEmail: emailLower,
              schoolId: adminSchool,
              role: 'ADMIN',
              status: 'ACTIVE',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            discoveredMemberships.push(inferredAdmin);
            if (!existingMembershipSchoolIds.has(adminSchool)) {
              inferredMembershipsToPersist.push(inferredAdmin);
            }
          }
        }
      }

      // Auto-sync missing deterministic /memberships/{schoolId}_{uid} docs for verified legacy records
      // (Enforced server-side by firestore.rules to require proof via teacherId/parentId/ADMIN user doc)
      for (const m of inferredMembershipsToPersist) {
        try {
          const membershipRef = doc(db, 'memberships', m.id);
          const { id: _ignoreId, ...mPayload } = m;
          await setDoc(membershipRef, mPayload);
        } catch (mSyncErr) {
          console.warn(`Could not persist membership ${m.id}:`, mSyncErr);
        }
      }

      setUserMemberships(discoveredMemberships);

      // 3. Determine Active Membership
      let preferredSchoolId: string | null = null;
      try {
        preferredSchoolId = localStorage.getItem('active_authorized_school_id');
      } catch (e) {}

      let selectedMembership: SchoolMembership | null = null;
      if (preferredSchoolId) {
        selectedMembership = discoveredMemberships.find(
          (m) => m.schoolId.toLowerCase() === preferredSchoolId?.toLowerCase()
        ) || null;
      }

      if (!selectedMembership && discoveredMemberships.length > 0) {
        selectedMembership = discoveredMemberships[0];
      }

      setActiveMembership(selectedMembership);

      // 4. Apply Active Membership Context
      if (selectedMembership) {
        const targetSchoolId = selectedMembership.schoolId.trim().toLowerCase();
        const role = selectedMembership.role;

        let activeTeacher: Teacher | null = null;
        let activeParent: Parent | null = null;

        if (role === 'TEACHER') {
          activeTeacher = teacherDocs.find((t) => t.schoolId?.toLowerCase() === targetSchoolId && t.status !== 'INACTIVE') || null;
          setCurrentTeacher(activeTeacher);
          setCurrentParent(null);
        } else if (role === 'PARENT') {
          activeParent = parentDocs.find((p) => p.schoolId?.toLowerCase() === targetSchoolId && p.status !== 'INACTIVE') || null;
          setCurrentParent(activeParent);
          setCurrentTeacher(null);
        } else {
          setCurrentTeacher(null);
          setCurrentParent(null);
        }

        const userDisplayName = activeTeacher
          ? `${activeTeacher.firstName} ${activeTeacher.lastName}`.trim()
          : activeParent
          ? `${activeParent.firstName} ${activeParent.lastName}`.trim()
          : existingUserDoc?.displayName || firebaseUser.displayName || 'EduKonnect User';

        const finalUser: AppUser = {
          uid: firebaseUser.uid,
          email: emailLower,
          displayName: userDisplayName,
          role,
          isSuperAdmin: false,
          schoolId: targetSchoolId,
          ...(activeTeacher?.teacherId || selectedMembership.teacherId ? { teacherId: activeTeacher?.teacherId || selectedMembership.teacherId } : {}),
          ...(activeParent?.parentId || selectedMembership.parentId ? { parentId: activeParent?.parentId || selectedMembership.parentId } : {}),
          assignedClassIds: activeTeacher?.assignedClassIds || [],
          approvalStatus: 'APPROVED',
          active: true,
          createdAt: existingUserDoc?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        try {
          await setDoc(userDocRef, finalUser, { merge: true });
        } catch (e) {
          console.warn('Could not update active user doc:', e);
        }

        setAppUser({ ...finalUser, memberships: discoveredMemberships });
        return;
      }

      // 5. No Active Membership Found:
      // If user is a new school admin awaiting initial setup
      if (existingUserDoc && existingUserDoc.role === 'ADMIN' && (!existingUserDoc.schoolId || existingUserDoc.schoolId === 'default')) {
        const setupUser: AppUser = {
          ...existingUserDoc,
          schoolId: '',
          approvalStatus: 'PENDING_SETUP',
          memberships: [],
        };
        setAppUser(setupUser);
        setCurrentTeacher(null);
        setCurrentParent(null);
        return;
      }

      // 6. Otherwise: Account has no valid school membership.
      // Must NOT default to default school.
      const unassignedUser: AppUser = {
        uid: firebaseUser.uid,
        email: emailLower,
        displayName: firebaseUser.displayName || 'User',
        role: existingUserDoc?.role || 'TEACHER',
        isSuperAdmin: false,
        schoolId: '', // Explicitly empty
        approvalStatus: 'PENDING_APPROVAL',
        active: true,
        memberships: [],
        createdAt: existingUserDoc?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(userDocRef, unassignedUser, { merge: true });
      } catch (e) {
        console.warn('Could not update unassigned user doc:', e);
      }

      setAppUser(unassignedUser);
      setCurrentTeacher(null);
      setCurrentParent(null);

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
   * Switch between multiple authorized school memberships safely.
   */
  const switchSchoolMembership = async (targetSchoolId: string) => {
    const cleanTarget = targetSchoolId.trim().toLowerCase();
    const targetMembership = userMemberships.find((m) => m.schoolId.toLowerCase() === cleanTarget);
    if (!targetMembership) {
      console.warn('Unauthorized switch attempt: No membership found for school', targetSchoolId);
      return;
    }

    try {
      localStorage.setItem('active_authorized_school_id', cleanTarget);
    } catch (e) {}

    setActiveMembership(targetMembership);

    if (currentUser) {
      await fetchProfile(currentUser);
    }
  };

  /**
   * Simulation role switch (SUPER_ADMIN only)
   */
  const switchToRole = async (newRole: UserRole, targetSchoolId?: string) => {
    if (!currentUser || !appUser) return;

    if (!appUser.isSuperAdmin && appUser.role !== 'SUPER_ADMIN') {
      console.warn('Unauthorized role change attempt blocked. Users cannot alter their role or school membership.');
      return;
    }

    setAppUser((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        role: newRole,
        schoolId: targetSchoolId || prev.schoolId || ''
      };
    });
  };

  useEffect(() => {
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
        setUserMemberships([]);
        setActiveMembership(null);
      }
      setLoading(false);
    });

    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, []);

  const login = async (email: string, pass: string) => {
    const res = await signInWithEmailAndPassword(auth, email.trim(), pass);
    await fetchProfile(res.user);
  };

  const signup = async (
    email: string, 
    pass: string, 
    name: string, 
    role: UserRole = 'ADMIN',
    schoolId: string = ''
  ) => {
    const res = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    await fetchProfile(res.user);
  };

  const logout = async () => {
    await signOut(auth);
    setAppUser(null);
    setCurrentParent(null);
    setCurrentTeacher(null);
    setUserMemberships([]);
    setActiveMembership(null);
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
    
    // 1. Re-authenticate first
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
        schoolId: appUser?.isSuperAdmin ? (appUser.schoolId || 'default') : (appUser?.schoolId || ''),
        isSuperAdmin: !!appUser?.isSuperAdmin,
        isAtLeastAdmin: appUser?.role === 'ADMIN' || !!appUser?.isSuperAdmin,
        loading,
        currentParent,
        currentTeacher,
        userMemberships,
        activeMembership,
        hasMultipleMemberships: userMemberships.length > 1,
        login,
        signup,
        logout,
        resetPassword,
        updateUserPassword,
        refreshUserProfile,
        switchToRole,
        switchSchoolMembership,
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
