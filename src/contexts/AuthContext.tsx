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
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { AppUser, UserRole, Parent, Teacher, UserApprovalStatus, SchoolMembership } from '../types';
import { sanitizeFirestoreData } from '../services/gradingProfileService';

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
      const persistedMembershipIds = new Set<string>();
      const blockedMembershipKeys = new Set<string>();
      const nowIso = new Date().toISOString();

      // A. Query memberships collection
      try {
        const mQuery1 = query(collection(db, 'memberships'), where('userId', '==', firebaseUser.uid));
        const mSnap1 = await getDocs(mQuery1);
        mSnap1.forEach((d) => {
          const m = { id: d.id, ...d.data() } as SchoolMembership;
          const mSchool = m.schoolId?.trim().toLowerCase();
          if (m.status === 'SUSPENDED' || m.status === 'REVOKED') {
            if (mSchool) blockedMembershipKeys.add(`${mSchool}_${m.role}`);
            return;
          }
          if (m.status === 'ACTIVE' || !m.status) {
            persistedMembershipIds.add(d.id);
            discoveredMemberships.push(m);
          }
        });

        if (discoveredMemberships.length === 0 && emailLower) {
          const mQuery2 = query(collection(db, 'memberships'), where('userEmail', '==', emailLower));
          const mSnap2 = await getDocs(mQuery2);
          mSnap2.forEach((d) => {
            const m = { id: d.id, ...d.data() } as SchoolMembership;
            const mSchool = m.schoolId?.trim().toLowerCase();
            if (m.status === 'SUSPENDED' || m.status === 'REVOKED') {
              if (mSchool) blockedMembershipKeys.add(`${mSchool}_${m.role}`);
              return;
            }
            if (m.status === 'ACTIVE' || !m.status) {
              persistedMembershipIds.add(d.id);
              discoveredMemberships.push(m);
            }
          });
        }
      } catch (mErr) {
        console.warn('Membership query notice:', mErr);
      }

      // B. Query teachers collection
      const teacherDocs: Teacher[] = [];
      const teacherDocIdMap = new Map<string, string>();
      try {
        const tQuery = query(collection(db, 'teachers'), where('email', '==', emailLower));
        const tSnap = await getDocs(tQuery);
        tSnap.forEach((d) => {
          const data = d.data() as Teacher;
          const tId = data.teacherId || d.id;
          const td = { ...data, teacherId: tId };
          teacherDocs.push(td);
          teacherDocIdMap.set(tId, d.id);
        });

        const tQuery2 = query(collection(db, 'teachers'), where('userId', '==', firebaseUser.uid));
        const tSnap2 = await getDocs(tQuery2);
        tSnap2.forEach((d) => {
          const data = d.data() as Teacher;
          const tId = data.teacherId || d.id;
          const td = { ...data, teacherId: tId };
          if (!teacherDocs.some((t) => t.teacherId === td.teacherId)) {
            teacherDocs.push(td);
            teacherDocIdMap.set(tId, d.id);
          }
        });
      } catch (tErr) {
        console.warn('Teacher lookup notice:', tErr);
      }

      teacherDocs.forEach((t) => {
        const tSchool = t.schoolId?.trim().toLowerCase();
        if (tSchool && t.status !== 'INACTIVE' && !blockedMembershipKeys.has(`${tSchool}_TEACHER`)) {
          if (!discoveredMemberships.some((m) => m.schoolId.toLowerCase() === tSchool && m.role === 'TEACHER')) {
            discoveredMemberships.push({
              id: `${tSchool}_${firebaseUser.uid}`,
              userId: firebaseUser.uid,
              userEmail: emailLower,
              schoolId: tSchool,
              role: 'TEACHER',
              status: 'ACTIVE',
              teacherId: t.teacherId,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }
      });

      // C. Query parents collection
      const parentDocs: Parent[] = [];
      const parentDocIdMap = new Map<string, string>();
      try {
        const pQuery = query(collection(db, 'parents'), where('email', '==', emailLower));
        const pSnap = await getDocs(pQuery);
        pSnap.forEach((d) => {
          const data = d.data() as Parent;
          const pId = data.parentId || d.id;
          const pd = { ...data, parentId: pId };
          parentDocs.push(pd);
          parentDocIdMap.set(pId, d.id);
        });

        const pQuery2 = query(collection(db, 'parents'), where('userId', '==', firebaseUser.uid));
        const pSnap2 = await getDocs(pQuery2);
        pSnap2.forEach((d) => {
          const data = d.data() as Parent;
          const pId = data.parentId || d.id;
          const pd = { ...data, parentId: pId };
          if (!parentDocs.some((p) => p.parentId === pd.parentId)) {
            parentDocs.push(pd);
            parentDocIdMap.set(pId, d.id);
          }
        });
      } catch (pErr) {
        console.warn('Parent lookup notice:', pErr);
      }

      parentDocs.forEach((p) => {
        const pSchool = p.schoolId?.trim().toLowerCase();
        if (pSchool && !blockedMembershipKeys.has(`${pSchool}_PARENT`)) {
          if (!discoveredMemberships.some((m) => m.schoolId.toLowerCase() === pSchool && m.role === 'PARENT')) {
            discoveredMemberships.push({
              id: `${pSchool}_${firebaseUser.uid}`,
              userId: firebaseUser.uid,
              userEmail: emailLower,
              schoolId: pSchool,
              role: 'PARENT',
              status: 'ACTIVE',
              parentId: p.parentId,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }
      });

      // D. Check existing user document for ADMIN role & schoolId
      let existingUserDoc: AppUser | null = null;
      if (userSnap && userSnap.exists && userSnap.exists()) {
        existingUserDoc = userSnap.data() as AppUser;
        if (existingUserDoc.role === 'ADMIN' && existingUserDoc.schoolId && existingUserDoc.schoolId !== 'default') {
          const adminSchool = existingUserDoc.schoolId.trim().toLowerCase();
          if (!discoveredMemberships.some((m) => m.schoolId.toLowerCase() === adminSchool && m.role === 'ADMIN')) {
            discoveredMemberships.push({
              id: `${adminSchool}_${firebaseUser.uid}`,
              userId: firebaseUser.uid,
              userEmail: emailLower,
              schoolId: adminSchool,
              role: 'ADMIN',
              status: 'ACTIVE',
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
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

      // 4. Apply Active Membership Context & Atomically Persist Authoritative Membership + User Doc
      if (selectedMembership) {
        const targetSchoolId = selectedMembership.schoolId.trim().toLowerCase();
        const role = selectedMembership.role;

        let activeTeacher: Teacher | null = null;
        let activeParent: Parent | null = null;

        if (role === 'TEACHER') {
          activeTeacher = teacherDocs.find((t) => t.schoolId?.trim().toLowerCase() === targetSchoolId) || null;
          setCurrentTeacher(activeTeacher);
          setCurrentParent(null);
        } else if (role === 'PARENT') {
          activeParent = parentDocs.find((p) => p.schoolId?.trim().toLowerCase() === targetSchoolId) || null;
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

        // Firestore forbids FieldValue.serverTimestamp() inside arrays; normalize embedded membership summaries
        const safeUserMemberships: SchoolMembership[] = discoveredMemberships.map((m) =>
          sanitizeFirestoreData({
            ...m,
            createdAt: typeof m.createdAt === 'object' && m.createdAt && '_methodName' in m.createdAt ? nowIso : (m.createdAt || nowIso),
            updatedAt: typeof m.updatedAt === 'object' && m.updatedAt && '_methodName' in m.updatedAt ? nowIso : (m.updatedAt || nowIso),
            activatedAt: typeof m.activatedAt === 'object' && m.activatedAt && '_methodName' in m.activatedAt ? nowIso : m.activatedAt,
            invitedAt: typeof m.invitedAt === 'object' && m.invitedAt && '_methodName' in m.invitedAt ? nowIso : m.invitedAt,
          })
        );

        const resolvedTeacherId = activeTeacher?.teacherId || selectedMembership.teacherId;
        const resolvedParentId = activeParent?.parentId || selectedMembership.parentId;

        const finalUser: AppUser = sanitizeFirestoreData({
          uid: firebaseUser.uid,
          email: emailLower,
          displayName: userDisplayName,
          role,
          isSuperAdmin: false,
          schoolId: targetSchoolId,
          ...(resolvedTeacherId ? { teacherId: resolvedTeacherId } : {}),
          ...(resolvedParentId ? { parentId: resolvedParentId } : {}),
          assignedClassIds: activeTeacher?.assignedClassIds || [],
          approvalStatus: 'APPROVED',
          active: true,
          memberships: safeUserMemberships,
          createdAt: existingUserDoc?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        try {
          const syncBatch = writeBatch(db);
          const membershipDocId = `${targetSchoolId}_${firebaseUser.uid}`;

          // Persist authoritative membership doc if not already present (or missing userId link)
          if (!persistedMembershipIds.has(membershipDocId) && (resolvedTeacherId || resolvedParentId)) {
            syncBatch.set(
              doc(db, 'memberships', membershipDocId),
              sanitizeFirestoreData({
                id: membershipDocId,
                userId: firebaseUser.uid,
                userEmail: emailLower,
                schoolId: targetSchoolId,
                ...(selectedMembership.schoolName ? { schoolName: selectedMembership.schoolName } : {}),
                role,
                status: 'ACTIVE',
                ...(resolvedTeacherId ? { teacherId: resolvedTeacherId } : {}),
                ...(resolvedParentId ? { parentId: resolvedParentId } : {}),
                ...(selectedMembership.linkedStudentIds ? { linkedStudentIds: selectedMembership.linkedStudentIds } : {}),
                activatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }),
              { merge: true }
            );
          }

          // Link userId on teacher/parent record if discovered by email
          if (role === 'TEACHER' && activeTeacher && !activeTeacher.userId) {
            const tDocId = teacherDocIdMap.get(activeTeacher.teacherId) || activeTeacher.teacherId;
            syncBatch.update(doc(db, 'teachers', tDocId), {
              userId: firebaseUser.uid,
              status: 'ACTIVE',
              updatedAt: serverTimestamp(),
            });
          } else if (role === 'PARENT' && activeParent && !activeParent.userId) {
            const pDocId = parentDocIdMap.get(activeParent.parentId) || activeParent.parentId;
            syncBatch.update(doc(db, 'parents', pDocId), {
              userId: firebaseUser.uid,
              updatedAt: serverTimestamp(),
            });
          }

          syncBatch.set(userDocRef, finalUser, { merge: true });
          await syncBatch.commit();
        } catch (e) {
          console.warn('Could not sync active user and membership docs:', e);
        }

        setAppUser(finalUser);
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
      } catch (e) {}

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
        schoolId: targetSchoolId || prev.schoolId || 'default'
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
        schoolId: appUser?.schoolId || (appUser?.isSuperAdmin ? 'default' : ''),
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
