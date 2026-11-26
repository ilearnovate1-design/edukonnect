import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Plus, 
  ExternalLink, 
  Globe, 
  ShieldCheck, 
  Search, 
  RefreshCcw,
  Navigation2,
  Trash2,
  AlertTriangle,
  Info,
  Wrench,
  AlertCircle,
  Users,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { collection, getDocs, getDoc, query, orderBy, where, doc, updateDoc, deleteDoc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { SchoolSettings, AppUser, UserApprovalStatus, SchoolMembership, Teacher, SchoolClass, Subject } from '../../types';
import { 
  getAllSchools, 
  saveSchoolSettings, 
  mapDomainToSchool, 
  removeDomainMapping,
  deleteSchool,
  seedStandardCurriculumForSchool
} from '../../services/schoolService';
import { activateTeacherReportPermissions } from '../../services/teacherActivationService';
import { purgeAllPlatformData } from '../../services/maintenanceService';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Modal } from '../../components/common/Modal';
import { formatDate, logAudit } from '../../utils/formatters';
import { useQueryTab } from '../../routes/useQueryTab';

interface MemberVerificationCheck {
  label: string;
  ok: boolean;
  detail: string;
}

interface MemberVerificationState {
  checking: boolean;
  syncing: boolean;
  readyForReportWrites: boolean;
  checks: MemberVerificationCheck[];
  summaryMessage: string;
  syncSuccessMessage?: string;
  syncError?: string;
}

export const SuperAdminPage: React.FC = () => {
  const { isSuperAdmin, logout, currentUser } = useAuth();
  const { schoolId: currentSchoolId, setSchoolId, reloadSettings } = useSchool();
  
  const [schools, setSchools] = useState<SchoolSettings[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useQueryTab<'schools' | 'users' | 'memberships' | 'maintenance'>(
    'tab',
    'schools',
    ['schools', 'users', 'memberships', 'maintenance']
  );

  // School Memberships Inspector
  const [membershipSchoolId, setMembershipSchoolId] = useState<string>('');
  const [schoolMemberships, setSchoolMemberships] = useState<SchoolMembership[]>([]);
  const [loadingMemberships, setLoadingMemberships] = useState(false);
  const [membershipError, setMembershipError] = useState('');
  const [membershipStatusFilter, setMembershipStatusFilter] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [membershipRoleFilter, setMembershipRoleFilter] = useState<'ALL' | 'ADMIN' | 'TEACHER' | 'PARENT'>('ALL');
  const [confirmedSchoolDoc, setConfirmedSchoolDoc] = useState<SchoolSettings | null>(null);
  const [memberVerifications, setMemberVerifications] = useState<Record<string, MemberVerificationState>>({});
  
  // Create School Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolId, setNewSchoolId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  
  // Domain Mapping Modal
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [selectedSchoolForDomain, setSelectedSchoolForDomain] = useState<SchoolSettings | null>(null);
  const [customDomain, setCustomDomain] = useState('');
  const [existingDomains, setExistingDomains] = useState<any[]>([]);

  // Delete School Modal
  const [showDeleteSchoolModal, setShowDeleteSchoolModal] = useState(false);
  const [schoolToDelete, setSchoolToDelete] = useState<SchoolSettings | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [purgeSchoolDataOnDelete, setPurgeSchoolDataOnDelete] = useState(true);
  const [isDeletingSchool, setIsDeletingSchool] = useState(false);
  const [deleteSchoolError, setDeleteSchoolError] = useState('');

  // User Deletion & Clear All Admins
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AppUser | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [deleteUserError, setDeleteUserError] = useState('');

  const [showClearAdminsModal, setShowClearAdminsModal] = useState(false);
  const [isClearingAdmins, setIsClearingAdmins] = useState(false);
  const [clearAdminsConfirmText, setClearAdminsConfirmText] = useState('');
  const [clearAdminsError, setClearAdminsError] = useState('');

  // Maintenance
  const [isPurging, setIsPurging] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  const fetchSchools = async () => {
    setLoading(true);
    try {
      const data = await getAllSchools();
      setSchools(data);
      
      const dSnap = await getDocs(collection(db, 'schoolDomains'));
      const dList: any[] = [];
      dSnap.forEach(d => dList.push(d.data()));
      setExistingDomains(dList);

      const uSnap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
      const uList: AppUser[] = [];
      uSnap.forEach(d => uList.push(d.data() as AppUser));
      setUsers(uList);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchSchools();
    }
  }, [isSuperAdmin]);

  const fetchMembershipsForSchool = async (
    targetSchoolId: string,
    options?: { preserveVerifications?: boolean }
  ) => {
    const cleanId = targetSchoolId.trim().toLowerCase();
    if (!cleanId) {
      setConfirmedSchoolDoc(null);
      setSchoolMemberships([]);
      if (!options?.preserveVerifications) {
        setMemberVerifications({});
      }
      return;
    }

    setLoadingMemberships(true);
    setMembershipError('');
    if (!options?.preserveVerifications) {
      setMemberVerifications({});
    }
    try {
      const [schoolSnap, memSnap] = await Promise.all([
        getDoc(doc(db, 'schools', cleanId)),
        getDocs(query(collection(db, 'memberships'), where('schoolId', '==', cleanId))),
      ]);

      setConfirmedSchoolDoc(schoolSnap.exists() ? (schoolSnap.data() as SchoolSettings) : null);

      const list: SchoolMembership[] = [];
      memSnap.forEach((d) => {
        list.push({ ...(d.data() as SchoolMembership), id: d.id });
      });
      list.sort((a, b) => (a.role || '').localeCompare(b.role || '') || (a.userEmail || '').localeCompare(b.userEmail || ''));
      setSchoolMemberships(list);
    } catch (err: any) {
      console.error('Failed to load memberships for school:', err);
      setMembershipError(err?.message || 'Could not load memberships for this school ID.');
    } finally {
      setLoadingMemberships(false);
    }
  };

  const inspectAndOptionallySyncMember = async (
    membership: SchoolMembership,
    mode: 'verify' | 'sync'
  ) => {
    const cleanSchool = (membership.schoolId || membershipSchoolId || '').trim().toLowerCase();
    const uid = (membership.userId || '').trim();
    const mEmail = (membership.userEmail || '').trim().toLowerCase();
    const rowKey = membership.id || `${cleanSchool}_${uid}`;

    if (!cleanSchool || !uid) {
      setMemberVerifications((prev) => ({
        ...prev,
        [rowKey]: {
          checking: false,
          syncing: false,
          readyForReportWrites: false,
          checks: [
            {
              label: 'Membership Keys',
              ok: false,
              detail: 'Membership record is missing schoolId or userId.',
            },
          ],
          summaryMessage: 'Cannot verify membership without schoolId and userId.',
        },
      }));
      return;
    }

    const canonicalId = `${cleanSchool}_${uid}`;
    setMemberVerifications((prev) => ({
      ...prev,
      [rowKey]: {
        checking: true,
        syncing: mode === 'sync',
        readyForReportWrites: prev[rowKey]?.readyForReportWrites ?? false,
        checks: prev[rowKey]?.checks ?? [],
        summaryMessage: mode === 'sync' ? 'Syncing membership, user, and staff links...' : 'Verifying Firestore permissions chain...',
      },
    }));

    try {
      const checks: MemberVerificationCheck[] = [];
      let syncSuccessMessage: string | undefined;

      // Load current membership (canonical), user doc, and school classes/subjects
      const [canonicalMemSnap, userSnap, classesSnap, subjectsSnap] = await Promise.all([
        getDoc(doc(db, 'memberships', canonicalId)),
        getDoc(doc(db, 'users', uid)),
        getDocs(query(collection(db, 'classes'), where('schoolId', '==', cleanSchool))),
        getDocs(query(collection(db, 'subjects'), where('schoolId', '==', cleanSchool))),
      ]);

      const schoolClasses: SchoolClass[] = classesSnap.docs.map((d) => ({
        ...(d.data() as SchoolClass),
        classId: (d.data() as any).classId || d.id,
      }));
      const schoolSubjects: Subject[] = subjectsSnap.docs.map((d) => ({
        ...(d.data() as Subject),
        subjectId: (d.data() as any).subjectId || d.id,
      }));

      // Resolve teacher document if TEACHER role
      let teacherDoc: Teacher | null = null;
      const requestedTeacherId = (membership.teacherId || (userSnap.exists() ? (userSnap.data() as any)?.teacherId : '') || '').trim();

      if (membership.role === 'TEACHER') {
        if (requestedTeacherId) {
          const tSnap = await getDoc(doc(db, 'teachers', requestedTeacherId));
          if (tSnap.exists()) {
            teacherDoc = { ...(tSnap.data() as Teacher), teacherId: (tSnap.data() as any).teacherId || tSnap.id };
          }
        }
        if (!teacherDoc) {
          const tByUidSnap = await getDocs(
            query(collection(db, 'teachers'), where('schoolId', '==', cleanSchool), where('userId', '==', uid))
          );
          if (!tByUidSnap.empty) {
            const d = tByUidSnap.docs[0];
            teacherDoc = { ...(d.data() as Teacher), teacherId: (d.data() as any).teacherId || d.id };
          }
        }
        if (!teacherDoc && mEmail) {
          const tByEmailSnap = await getDocs(
            query(collection(db, 'teachers'), where('schoolId', '==', cleanSchool), where('email', '==', mEmail))
          );
          if (!tByEmailSnap.empty) {
            const d = tByEmailSnap.docs[0];
            teacherDoc = { ...(d.data() as Teacher), teacherId: (d.data() as any).teacherId || d.id };
          }
        }
      }

      // Optional repair / sync pass before re-checking
      if (mode === 'sync') {
        if (membership.role === 'TEACHER') {
          if (teacherDoc) {
            const syncRes = await activateTeacherReportPermissions({
              schoolId: cleanSchool,
              schoolName: confirmedSchoolDoc?.schoolName,
              teacher: {
                ...teacherDoc,
                userId: uid,
                email: teacherDoc.email || mEmail,
              },
              classes: schoolClasses,
              actingAdminUid: currentUser?.uid,
              isSuperAdmin: true,
              provisionAuthIfMissing: false,
            });
            teacherDoc = syncRes.updatedTeacher;
            syncSuccessMessage = syncRes.message;
          } else {
            // Ensure canonical membership & user doc are at least ACTIVE and normalized
            await setDoc(
              doc(db, 'memberships', canonicalId),
              {
                id: canonicalId,
                userId: uid,
                userEmail: mEmail,
                schoolId: cleanSchool,
                ...(confirmedSchoolDoc?.schoolName ? { schoolName: confirmedSchoolDoc.schoolName } : {}),
                role: 'TEACHER',
                status: 'ACTIVE',
                ...(requestedTeacherId ? { teacherId: requestedTeacherId } : {}),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
            syncSuccessMessage = requestedTeacherId
              ? `Membership synced to ${canonicalId}, but teachers/${requestedTeacherId} was not found.`
              : `Membership synced to ${canonicalId}, but no linked teacher document was found.`;
          }
        } else {
          await setDoc(
            doc(db, 'memberships', canonicalId),
            {
              id: canonicalId,
              userId: uid,
              userEmail: mEmail,
              schoolId: cleanSchool,
              ...(confirmedSchoolDoc?.schoolName ? { schoolName: confirmedSchoolDoc.schoolName } : {}),
              role: membership.role,
              status: 'ACTIVE',
              ...(membership.parentId ? { parentId: membership.parentId } : {}),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          await setDoc(
            doc(db, 'users', uid),
            {
              uid,
              email: mEmail,
              schoolId: cleanSchool,
              role: membership.role,
              approvalStatus: 'APPROVED',
              active: true,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          syncSuccessMessage = `Synced ${membership.role} membership ${canonicalId} and user profile.`;
        }
      }

      // Re-read canonical membership & user profile after potential sync
      const [latestMemSnap, latestUserSnap] =
        mode === 'sync'
          ? await Promise.all([getDoc(doc(db, 'memberships', canonicalId)), getDoc(doc(db, 'users', uid))])
          : [canonicalMemSnap, userSnap];

      const memData = latestMemSnap.exists() ? (latestMemSnap.data() as any) : null;
      const memSchoolNorm = (memData?.schoolId || '').trim().toLowerCase();
      const memOk =
        latestMemSnap.exists() &&
        memData?.userId === uid &&
        memSchoolNorm === cleanSchool &&
        memData?.status === 'ACTIVE' &&
        memData?.role === membership.role;
      checks.push({
        label: `Canonical Membership (${canonicalId})`,
        ok: Boolean(memOk),
        detail: !latestMemSnap.exists()
          ? `Document memberships/${canonicalId} does not exist (rules require exact canonical ID).`
          : memOk
          ? `ACTIVE ${memData.role} membership verified for UID ${uid} in ${cleanSchool}.`
          : `Mismatch: status=${memData?.status}, role=${memData?.role}, schoolId=${memData?.schoolId}, userId=${memData?.userId}`,
      });

      const uData = latestUserSnap.exists() ? (latestUserSnap.data() as any) : null;
      const uSchoolNorm = (uData?.schoolId || '').trim().toLowerCase();
      const uOk =
        latestUserSnap.exists() &&
        uSchoolNorm === cleanSchool &&
        uData?.approvalStatus === 'APPROVED' &&
        (membership.role !== 'TEACHER' || !teacherDoc || uData?.teacherId === teacherDoc.teacherId);
      checks.push({
        label: `User Profile (users/${uid})`,
        ok: Boolean(uOk),
        detail: !latestUserSnap.exists()
          ? `users/${uid} does not exist yet (will be synced on Sign-In or Verify & Sync).`
          : uOk
          ? `APPROVED ${uData.role} profile linked to ${cleanSchool}${uData.teacherId ? ` (teacherId: ${uData.teacherId})` : ''}.`
          : `schoolId=${uData.schoolId || 'none'}, role=${uData.role || 'none'}, status=${uData.approvalStatus || 'none'}, teacherId=${uData.teacherId || 'none'}`,
      });

      let readyForReportWrites = Boolean(memOk && uOk);

      if (membership.role === 'TEACHER') {
        const tSchoolNorm = (teacherDoc?.schoolId || '').trim().toLowerCase();
        const tEmailNorm = (teacherDoc?.email || '').trim().toLowerCase();
        const tOwnerMatch =
          Boolean(teacherDoc) &&
          (teacherDoc!.userId === uid || (Boolean(mEmail) && tEmailNorm === mEmail));
        const tUidConflict = Boolean(teacherDoc?.userId && teacherDoc.userId !== uid);
        const tDocOk =
          Boolean(teacherDoc) &&
          tSchoolNorm === cleanSchool &&
          teacherDoc!.status !== 'INACTIVE' &&
          tOwnerMatch &&
          !tUidConflict;

        checks.push({
          label: `Teacher Record (teachers/${teacherDoc?.teacherId || requestedTeacherId || 'missing'})`,
          ok: tDocOk,
          detail: !teacherDoc
            ? `No matching teacher document found for teacherId=${requestedTeacherId || 'none'} in ${cleanSchool}.`
            : tUidConflict
            ? `UID conflict: teachers/${teacherDoc.teacherId}.userId is "${teacherDoc.userId}" instead of "${uid}". Click Verify & Sync to repair.`
            : tDocOk
            ? `ACTIVE teacher doc (${teacherDoc.firstName} ${teacherDoc.lastName}), userId=${teacherDoc.userId || 'email-matched'}, email=${teacherDoc.email}.`
            : `Mismatch: status=${teacherDoc.status}, schoolId=${teacherDoc.schoolId}, userId=${teacherDoc.userId || 'unset'}, email=${teacherDoc.email}.`,
        });

        const tid = teacherDoc?.teacherId || requestedTeacherId;
        const assignedClassIds = Array.isArray(teacherDoc?.assignedClassIds) ? teacherDoc!.assignedClassIds : [];
        const matchedClasses = schoolClasses.filter(
          (c) =>
            assignedClassIds.includes(c.classId) ||
            (tid && c.classTeacherId === tid) ||
            c.classTeacherId === uid
        );
        const classOk = matchedClasses.length > 0;
        checks.push({
          label: 'Class Assignment',
          ok: classOk,
          detail: classOk
            ? `Authorized for ${matchedClasses.length} class(es): ${matchedClasses.map((c) => `${c.name} (${c.classId})`).join(', ')}.`
            : `No classes assigned on teachers/${tid || 'unknown'} (assignedClassIds empty and not homeroom classTeacherId). Assign at least 1 class in Classes or Teachers.`,
        });

        const teacherSubjects = Array.isArray(teacherDoc?.subjects) ? teacherDoc!.subjects : [];
        const matchedSubjects =
          teacherSubjects.length === 0
            ? schoolSubjects
            : schoolSubjects.filter(
                (s) => teacherSubjects.includes(s.subjectId) || teacherSubjects.includes(s.name)
              );
        const subjectOk = teacherSubjects.length === 0 ? schoolSubjects.length > 0 : matchedSubjects.length > 0;
        checks.push({
          label: 'Subject Assignment',
          ok: subjectOk,
          detail:
            teacherSubjects.length === 0
              ? schoolSubjects.length > 0
                ? `Unrestricted (empty subjects list allows all ${schoolSubjects.length} school subjects).`
                : `Teacher has unrestricted subjects, but ${cleanSchool} has 0 subject documents in /subjects.`
              : matchedSubjects.length > 0
              ? `Matched ${matchedSubjects.length} subject(s): ${matchedSubjects.map((s) => `${s.name} (${s.subjectId})`).join(', ')}.`
              : `Teacher subjects [${teacherSubjects.join(', ')}] do not match any subjectId or name in ${cleanSchool}/subjects.`,
        });

        readyForReportWrites = Boolean(memOk && tDocOk && classOk && subjectOk);
      }

      const failingCount = checks.filter((c) => !c.ok).length;
      setMemberVerifications((prev) => ({
        ...prev,
        [rowKey]: {
          checking: false,
          syncing: false,
          readyForReportWrites,
          checks,
          summaryMessage:
            failingCount === 0
              ? membership.role === 'TEACHER'
                ? 'Verified: Teacher passes all Firestore security rule checks for saving & submitting reports.'
                : 'Verified: Membership and user profile match all tenant rules.'
              : `${failingCount} check(s) require attention before direct writes will succeed.`,
          syncSuccessMessage,
        },
      }));

      if (mode === 'sync') {
        await fetchMembershipsForSchool(cleanSchool, { preserveVerifications: true });
      }
    } catch (err: any) {
      setMemberVerifications((prev) => ({
        ...prev,
        [rowKey]: {
          checking: false,
          syncing: false,
          readyForReportWrites: false,
          checks: [],
          summaryMessage: 'Verification failed due to a Firestore query error.',
          syncError: err?.message || 'Verification failed.',
        },
      }));
    }
  };

  useEffect(() => {
    if (!isSuperAdmin || activeTab !== 'memberships') return;
    const initialTarget =
      membershipSchoolId ||
      (currentSchoolId && currentSchoolId !== 'default' ? currentSchoolId : '') ||
      schools[0]?.schoolId ||
      '';
    if (initialTarget && initialTarget !== membershipSchoolId) {
      setMembershipSchoolId(initialTarget);
    }
    if (initialTarget) {
      fetchMembershipsForSchool(initialTarget);
    }
  }, [isSuperAdmin, activeTab, schools]);

  const openSchoolMemberships = (targetId: string) => {
    const cleanId = targetId.trim().toLowerCase();
    setMembershipSchoolId(cleanId);
    setActiveTab('memberships');
    fetchMembershipsForSchool(cleanId);
  };

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchoolName || !newSchoolId) return;
    
    setIsSaving(true);
    setFormError('');
    try {
      const slug = newSchoolId.toLowerCase().trim().replace(/\s+/g, '-');
      await saveSchoolSettings({
        schoolName: newSchoolName.trim(),
        slug: slug,
        schoolId: slug
      }, slug);
      
      try {
        await seedStandardCurriculumForSchool(slug);
      } catch (seedErr) {
        console.warn('Auto-seed standard subjects notice:', seedErr);
      }

      setShowAddModal(false);
      setNewSchoolName('');
      setNewSchoolId('');
      fetchSchools();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create school');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDomainMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchoolForDomain || !customDomain) return;
    
    setIsSaving(true);
    try {
      await mapDomainToSchool(customDomain, selectedSchoolForDomain.schoolId!);
      setCustomDomain('');
      setShowDomainModal(false);
      fetchSchools();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    if (!window.confirm(`Are you sure you want to remove the mapping for ${domain}?`)) return;
    try {
      await removeDomainMapping(domain);
      fetchSchools();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSwitchSchool = (sId: string) => {
    setSchoolId(sId);
  };

  const openDeleteSchoolModal = (school: SchoolSettings) => {
    setSchoolToDelete(school);
    setDeleteConfirmationText('');
    setPurgeSchoolDataOnDelete(true);
    setDeleteSchoolError('');
    setShowDeleteSchoolModal(true);
  };

  const handleExecuteDeleteSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolToDelete || !schoolToDelete.schoolId) return;

    const targetId = schoolToDelete.schoolId.toLowerCase().trim();
    const isConfirmed = deleteConfirmationText.trim().toLowerCase() === targetId ||
                        deleteConfirmationText.trim().toUpperCase() === 'DELETE';

    if (!isConfirmed) {
      setDeleteSchoolError(`Please type "${targetId}" or "DELETE" to confirm.`);
      return;
    }

    setIsDeletingSchool(true);
    setDeleteSchoolError('');

    try {
      await deleteSchool(targetId, purgeSchoolDataOnDelete, currentUser?.uid || 'admin');
      
      // If we deleted the active school context, switch back to default
      if (currentSchoolId === targetId) {
        setSchoolId('default');
      }

      setShowDeleteSchoolModal(false);
      setSchoolToDelete(null);
      setDeleteConfirmationText('');
      await fetchSchools();
    } catch (err: any) {
      console.error('Error deleting school:', err);
      setDeleteSchoolError(err.message || 'Failed to delete school');
    } finally {
      setIsDeletingSchool(false);
    }
  };

  const handlePurgeData = async () => {
    if (purgeConfirmText !== 'PURGE') {
      alert('Please type PURGE to confirm.');
      return;
    }

    if (!window.confirm('CRITICAL: This will delete ALL students, teachers, results, and other data across the platform. This cannot be undone. Proceed?')) {
      return;
    }

    setIsPurging(true);
    try {
      const res = await purgeAllPlatformData(currentUser?.uid || '');
      if (res.success) {
        alert(res.message);
        setPurgeConfirmText('');
        fetchSchools();
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert(err.message || 'Purge failed');
    } finally {
      setIsPurging(false);
    }
  };

  const handleUpdateUserStatus = async (uid: string, status: UserApprovalStatus) => {
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        approvalStatus: status,
        updatedAt: serverTimestamp()
      });
      fetchSchools();
    } catch (err) {
      console.error('Failed to update user status:', err);
    }
  };

  const openDeleteUserModal = (user: AppUser) => {
    if (user.role === 'SUPER_ADMIN' || user.isSuperAdmin || user.email?.toLowerCase() === 'ilearnovate1@gmail.com') {
      alert('Cannot delete the root System Super Administrator account.');
      return;
    }
    setUserToDelete(user);
    setDeleteUserError('');
    setShowDeleteUserModal(true);
  };

  const handleExecuteDeleteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToDelete) return;
    setIsDeletingUser(true);
    setDeleteUserError('');
    try {
      await deleteDoc(doc(db, 'users', userToDelete.uid));
      await logAudit(
        currentUser?.uid || 'superadmin',
        'ADMIN_USER_DELETED',
        'users',
        userToDelete.uid,
        `Permanently deleted administrator account ${userToDelete.email} (${userToDelete.displayName || 'Admin'})`
      );
      setShowDeleteUserModal(false);
      setUserToDelete(null);
      await fetchSchools();
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      setDeleteUserError(err.message || 'Failed to delete administrator account');
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleExecuteClearAllAdmins = async (e: React.FormEvent) => {
    e.preventDefault();
    const adminUsers = users.filter(u => u.role === 'ADMIN' && !u.isSuperAdmin && u.email?.toLowerCase() !== 'ilearnovate1@gmail.com');
    if (adminUsers.length === 0) {
      setShowClearAdminsModal(false);
      return;
    }
    if (clearAdminsConfirmText.trim().toUpperCase() !== 'CLEAR') {
      setClearAdminsError('Please type "CLEAR" in the confirmation box to proceed.');
      return;
    }
    setIsClearingAdmins(true);
    setClearAdminsError('');
    try {
      const batch = writeBatch(db);
      for (const u of adminUsers) {
        batch.delete(doc(db, 'users', u.uid));
      }
      await batch.commit();
      await logAudit(
        currentUser?.uid || 'superadmin',
        'CLEAR_ALL_ADMIN_USERS',
        'users',
        'all',
        `Cleared all ${adminUsers.length} administrator accounts`
      );
      setShowClearAdminsModal(false);
      setClearAdminsConfirmText('');
      await fetchSchools();
    } catch (err: any) {
      console.error('Failed to clear admin accounts:', err);
      setClearAdminsError(err.message || 'Failed to clear administrator accounts');
    } finally {
      setIsClearingAdmins(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <ShieldCheck className="w-16 h-16 text-slate-200 mb-4" />
        <h2 className="text-xl font-bold text-slate-900">Access Denied</h2>
        <p className="text-slate-500 mt-2 max-w-md">
          This interface is reserved for System Super Administrators only.
        </p>
      </div>
    );
  }

  const filteredSchools = schools.filter(s => 
    s.schoolName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.schoolId?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Management</h1>
          <p className="text-slate-500 text-sm">Multi-tenant school directory and domain routing</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('schools')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'schools' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
          >
            Schools
          </button>
          <button
            onClick={() => setActiveTab('memberships')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'memberships' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
          >
            Memberships
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'users' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
          >
            Users & Approvals
          </button>
          <button
            onClick={() => setActiveTab('maintenance')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'maintenance' ? 'bg-red-600 text-white' : 'bg-white text-red-600 hover:bg-red-50 border border-red-200'}`}
          >
            Maintenance
          </button>
        </div>
      </div>

      {activeTab === 'schools' ? (
        <>
          {/* Stats / Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardBody className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Total Schools</p>
                  <p className="text-2xl font-bold text-slate-900">{schools.length}</p>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Domain Mappings</p>
                  <p className="text-2xl font-bold text-slate-900">{existingDomains.length}</p>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
                  <Navigation2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Current View</p>
                  <p className="text-lg font-bold text-slate-900 truncate max-w-[150px]">
                    {currentSchoolId}
                  </p>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search schools by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            <div className="flex gap-2">
              <button 
                onClick={fetchSchools}
                className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 transition-colors"
                title="Refresh List"
              >
                <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Register New School</span>
              </button>
            </div>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">School Details</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Domains</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Config</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={4} className="px-6 py-8">
                          <div className="h-4 bg-slate-100 rounded w-3/4 mb-2"></div>
                          <div className="h-3 bg-slate-50 rounded w-1/2"></div>
                        </td>
                      </tr>
                    ))
                  ) : filteredSchools.length > 0 ? (
                    filteredSchools.map((school) => {
                      const schoolDomains = existingDomains.filter(d => d.schoolId === school.schoolId);
                      const isActive = currentSchoolId === school.schoolId;

                      return (
                        <tr key={school.schoolId} className={isActive ? 'bg-emerald-50/30' : ''}>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 overflow-hidden">
                                {school.logoUrl ? (
                                  <img src={school.logoUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Building2 className="w-5 h-5" />
                                )}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 leading-tight">
                                  {school.schoolName}
                                  {isActive && (
                                    <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full align-middle">
                                      ACTIVE VIEW
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-400 mt-1 font-mono">ID: {school.schoolId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex flex-wrap gap-2">
                              <div className="group relative flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs border border-slate-200">
                                <span>{school.schoolId}.edu.ng</span>
                                <Info className="w-3 h-3 text-slate-400" />
                              </div>
                              
                              {schoolDomains.map(d => (
                                <div key={d.domain} className="group relative flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs border border-blue-100">
                                  <Globe className="w-3 h-3" />
                                  <span>{d.domain}</span>
                                  <button 
                                    onClick={() => handleDeleteDomain(d.domain)}
                                    className="ml-1 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                              
                              <button 
                                onClick={() => {
                                  setSelectedSchoolForDomain(school);
                                  setShowDomainModal(true);
                                }}
                                className="flex items-center gap-1 px-2 py-1 border border-dashed border-slate-300 text-slate-400 rounded text-xs hover:border-slate-400 hover:text-slate-500 transition-colors"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Add</span>
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="text-xs space-y-1">
                              <p className="text-slate-600"><span className="text-slate-400">Session:</span> {school.currentAcademicSession}</p>
                              <p className="text-slate-600"><span className="text-slate-400">Term:</span> {school.currentTerm}</p>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openSchoolMemberships(school.schoolId!)}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
                                title="Inspect active memberships for this school"
                              >
                                <Users className="w-3.5 h-3.5" />
                                <span>Memberships</span>
                              </button>

                              <button
                                onClick={() => handleSwitchSchool(school.schoolId!)}
                                disabled={isActive}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                  isActive 
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                                title="Switch current active view to this school"
                              >
                                <Navigation2 className="w-3.5 h-3.5" />
                                <span>{isActive ? 'Current' : 'Switch'}</span>
                              </button>

                              <button
                                onClick={() => openDeleteSchoolModal(school)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 transition-colors border border-rose-200/60"
                                title={`Delete ${school.schoolName || school.schoolId}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                        No schools registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : activeTab === 'users' ? (
        <Card>
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-900 text-lg">Administrator Accounts</h3>
              <p className="text-sm text-slate-500">Manage portal access, verification requests, and account privileges</p>
            </div>
            {users.filter(u => u.role === 'ADMIN').length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setClearAdminsConfirmText('');
                  setClearAdminsError('');
                  setShowClearAdminsModal(true);
                }}
                className="px-3.5 py-2 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All Admin Accounts ({users.filter(u => u.role === 'ADMIN').length})
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">User Details</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">School ID</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Approval Status</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.filter(u => u.role === 'ADMIN').length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <ShieldCheck className="w-10 h-10 text-emerald-500/30 mb-3" />
                        <p className="font-bold text-slate-800 text-sm">No Administrator Accounts</p>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          All institutional administrator accounts are cleared. When school administrators register, their profiles will appear here for verification and role management.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  users.filter(u => u.role === 'ADMIN').map((user) => (
                    <tr key={user.uid} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900 leading-none mb-1">{user.displayName || 'School Administrator'}</p>
                        <p className="text-xs text-slate-400">{user.email}</p>
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-slate-600">
                        {user.schoolId || 'PENDING'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          user.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                          user.approvalStatus === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                          user.approvalStatus === 'PENDING_APPROVAL' ? 'bg-amber-100 text-amber-700 animate-pulse' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {user.approvalStatus?.replace('_', ' ') || 'PENDING SETUP'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end items-center gap-2">
                          {user.approvalStatus !== 'APPROVED' && (
                            <button 
                              type="button"
                              onClick={() => handleUpdateUserStatus(user.uid, 'APPROVED')}
                              className="px-2.5 py-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-700 transition-colors uppercase cursor-pointer"
                              title="Approve administrator"
                            >
                              Approve
                            </button>
                          )}
                          {user.approvalStatus !== 'REJECTED' && (
                            <button 
                              type="button"
                              onClick={() => handleUpdateUserStatus(user.uid, 'REJECTED')}
                              className="px-2.5 py-1.5 border border-slate-200 text-slate-600 text-[10px] font-bold rounded-lg hover:bg-slate-50 transition-colors uppercase cursor-pointer"
                              title="Reject administrator"
                            >
                              Reject
                            </button>
                          )}
                          <button 
                            type="button"
                            onClick={() => openDeleteUserModal(user)}
                            className="px-2.5 py-1.5 border border-rose-200 text-rose-600 hover:bg-rose-50 text-[10px] font-bold rounded-lg transition-colors uppercase flex items-center gap-1 cursor-pointer"
                            title="Delete this administrator account"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : activeTab === 'memberships' ? (
        <div className="space-y-4">
          <Card>
            <CardBody className="p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Select School
                    </label>
                    <select
                      value={schools.some((s) => s.schoolId === membershipSchoolId) ? membershipSchoolId : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          setMembershipSchoolId(val);
                          fetchMembershipsForSchool(val);
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800"
                    >
                      <option value="">Choose registered school...</option>
                      {schools.map((s) => (
                        <option key={s.schoolId} value={s.schoolId}>
                          {s.schoolName} ({s.schoolId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Or Enter School ID
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={membershipSchoolId}
                        onChange={(e) => setMembershipSchoolId(e.target.value.toLowerCase().trim())}
                        placeholder="e.g. bistoland-elementary-school"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg bg-white text-slate-800"
                      />
                      <button
                        type="button"
                        onClick={() => fetchMembershipsForSchool(membershipSchoolId)}
                        className="px-3 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 shrink-0 cursor-pointer"
                      >
                        Verify
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Status Filter
                    </label>
                    <select
                      value={membershipStatusFilter}
                      onChange={(e) => setMembershipStatusFilter(e.target.value as 'ACTIVE' | 'ALL')}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800"
                    >
                      <option value="ACTIVE">ACTIVE Only</option>
                      <option value="ALL">All Statuses</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Role Filter
                    </label>
                    <select
                      value={membershipRoleFilter}
                      onChange={(e) => setMembershipRoleFilter(e.target.value as any)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800"
                    >
                      <option value="ALL">All Roles</option>
                      <option value="ADMIN">ADMIN</option>
                      <option value="TEACHER">TEACHER</option>
                      <option value="PARENT">PARENT</option>
                    </select>
                  </div>
                </div>
              </div>

              {membershipSchoolId && !loadingMemberships && (
                confirmedSchoolDoc ? (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-emerald-900">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Confirmed School ID <code className="font-mono font-bold">{confirmedSchoolDoc.schoolId || membershipSchoolId}</code>: <strong>{confirmedSchoolDoc.schoolName}</strong>
                        {confirmedSchoolDoc.email ? ` (${confirmedSchoolDoc.email})` : ''}
                      </span>
                    </div>
                    <span className="font-semibold text-emerald-800">
                      {schoolMemberships.filter((m) => m.status === 'ACTIVE').length} active membership(s) / {schoolMemberships.length} total
                    </span>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      No school profile document found at <code className="font-mono font-bold">schools/{membershipSchoolId}</code>.
                    </span>
                  </div>
                )
              )}

              {membershipError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {membershipError}
                </div>
              )}
            </CardBody>

            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">User Email / UID</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Linked Profile</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Document ID</th>
                    <th className="px-5 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Verify & Repair</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {loadingMemberships ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-xs">
                        Loading memberships...
                      </td>
                    </tr>
                  ) : (() => {
                    const visible = schoolMemberships.filter((m) => {
                      if (membershipStatusFilter === 'ACTIVE' && m.status !== 'ACTIVE') return false;
                      if (membershipRoleFilter !== 'ALL' && m.role !== membershipRoleFilter) return false;
                      return true;
                    });
                    if (visible.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-xs">
                            No {membershipStatusFilter === 'ACTIVE' ? 'ACTIVE ' : ''}memberships found for{' '}
                            <code className="font-mono">{membershipSchoolId || 'selected school'}</code>.
                          </td>
                        </tr>
                      );
                    }
                    return visible.map((m) => {
                      const expectedId = `${(m.schoolId || membershipSchoolId).toLowerCase()}_${m.userId}`;
                      const isCanonical = m.id === expectedId;
                      const rowKey = m.id || expectedId;
                      const vState = memberVerifications[rowKey];
                      return (
                        <React.Fragment key={rowKey}>
                          <tr className="hover:bg-slate-50/60">
                            <td className="px-5 py-3">
                              <p className="font-semibold text-slate-900 text-xs">{m.userEmail || 'No email'}</p>
                              <p className="text-[11px] font-mono text-slate-400">{m.userId}</p>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                m.role === 'ADMIN'
                                  ? 'bg-purple-100 text-purple-800'
                                  : m.role === 'TEACHER'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-teal-100 text-teal-800'
                              }`}>
                                {m.role}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                m.status === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {m.status}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-xs font-mono text-slate-600">
                              {m.role === 'TEACHER'
                                ? (m.teacherId ? `teacherId: ${m.teacherId}` : <span className="text-rose-600 font-sans font-semibold">Missing teacherId</span>)
                                : m.role === 'PARENT'
                                ? (m.parentId ? `parentId: ${m.parentId}` : <span className="text-amber-600 font-sans">No parentId</span>)
                                : 'School Admin'}
                            </td>
                            <td className="px-5 py-3">
                              <p className="text-[11px] font-mono text-slate-600 break-all">{m.id}</p>
                              {!isCanonical && (
                                <span className="text-[10px] font-semibold text-amber-700">
                                  Non-canonical (rules expect {expectedId})
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  disabled={Boolean(vState?.checking)}
                                  onClick={() => inspectAndOptionallySyncMember(m, 'verify')}
                                  className="px-2.5 py-1 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 rounded text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                                >
                                  {vState?.checking && !vState?.syncing ? 'Checking...' : 'Verify'}
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(vState?.checking)}
                                  onClick={() => inspectAndOptionallySyncMember(m, 'sync')}
                                  className="px-2.5 py-1 bg-emerald-600 text-white hover:bg-emerald-700 rounded text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                                >
                                  {vState?.syncing ? 'Syncing...' : 'Verify & Sync'}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {vState && (
                            <tr className="bg-slate-50/80">
                              <td colSpan={6} className="px-5 py-3 border-t border-slate-100">
                                <div className="space-y-2 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={`font-semibold flex items-center gap-1.5 ${vState.readyForReportWrites ? 'text-emerald-700' : 'text-amber-800'}`}>
                                      {vState.readyForReportWrites ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                      ) : (
                                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                      )}
                                      {vState.summaryMessage}
                                    </span>
                                  </div>
                                  {vState.syncSuccessMessage && (
                                    <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">
                                      {vState.syncSuccessMessage}
                                    </p>
                                  )}
                                  {vState.syncError && (
                                    <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
                                      {vState.syncError}
                                    </p>
                                  )}
                                  {vState.checks.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                                      {vState.checks.map((chk) => (
                                        <div
                                          key={chk.label}
                                          className={`p-2 rounded border text-[11px] flex items-start gap-2 ${
                                            chk.ok
                                              ? 'bg-white border-emerald-200 text-slate-700'
                                              : 'bg-rose-50/70 border-rose-200 text-rose-900'
                                          }`}
                                        >
                                          {chk.ok ? (
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                          ) : (
                                            <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                                          )}
                                          <div>
                                            <p className="font-semibold">{chk.label}</p>
                                            <p className="text-slate-500 mt-0.5 break-all">{chk.detail}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : (
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="border-red-100">
            <CardHeader className="bg-red-50 p-5 border-b border-red-100">
              <div className="flex items-center gap-3 text-red-700">
                <Wrench className="w-5 h-5" />
                <h3 className="font-bold">System Maintenance & Cleanup</h3>
              </div>
            </CardHeader>
            <CardBody className="p-6 space-y-6">
              <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl flex gap-3">
                <AlertTriangle className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-bold text-orange-900">Destructive Actions</p>
                  <p className="text-orange-700 mt-1 leading-relaxed">
                    Clearing platform data will permanently delete all students, teachers, results, and other institutional records across all schools. 
                    <strong> This action cannot be reversed.</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    To proceed, type <span className="font-mono font-bold text-red-600 select-all">PURGE</span> in the box below:
                  </label>
                  <input
                    type="text"
                    value={purgeConfirmText}
                    onChange={(e) => setPurgeConfirmText(e.target.value)}
                    placeholder="Type PURGE to confirm"
                    className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500/20 focus:border-red-500 font-mono"
                  />
                </div>

                <button
                  onClick={handlePurgeData}
                  disabled={isPurging || purgeConfirmText !== 'PURGE'}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {isPurging ? (
                    <>
                      <RefreshCcw className="w-5 h-5 animate-spin" />
                      <span>Purging All Data...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5" />
                      <span>Clear All Platform Test Data</span>
                    </>
                  )}
                </button>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-start gap-3 text-slate-500 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <ul className="space-y-1 list-disc pl-4">
                    <li>All <strong>students</strong>, <strong>parents</strong>, and <strong>teachers</strong> will be deleted.</li>
                    <li>All <strong>results</strong>, <strong>attendance</strong>, and <strong>fees</strong> will be deleted.</li>
                    <li>All <strong>user accounts</strong> (except your own) will be removed.</li>
                    <li>The <strong>'default'</strong> EduKonnect tenant will be preserved but its data cleared.</li>
                    <li>Platform pricing settings will remain intact.</li>
                  </ul>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Create School Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Register New Tenant"
      >
        <form onSubmit={handleAddSchool} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">School Full Name</label>
            <input
              type="text"
              required
              value={newSchoolName}
              onChange={(e) => setNewSchoolName(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
              placeholder="e.g. St. Jude's International School"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Unique School ID (Slug)</label>
            <input
              type="text"
              required
              value={newSchoolId}
              onChange={(e) => setNewSchoolId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 font-mono text-sm"
              placeholder="e.g. st-judes"
            />
            <p className="mt-1 text-[11px] text-slate-400 italic">Used for subdomains: schoolid.edukonnect.ng</p>
          </div>
          
          {formError && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {formError}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {isSaving ? 'Creating...' : 'Register School'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Domain Mapping Modal */}
      <Modal
        isOpen={showDomainModal}
        onClose={() => setShowDomainModal(false)}
        title={`Map Custom Domain for ${selectedSchoolForDomain?.schoolName}`}
      >
        <form onSubmit={handleAddDomainMapping} className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex gap-3">
            <Globe className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-blue-900">Custom Domain Routing</p>
              <p className="text-xs text-blue-700 mt-1">
                Enter the full hostname (e.g. portal.myschool.com). Users accessing this domain will automatically see this school's branding and data.
              </p>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hostname</label>
            <input
              type="text"
              required
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value.toLowerCase().trim())}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
              placeholder="portal.myschool.com"
            />
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setShowDomainModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Mapping...' : 'Save Mapping'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete School Modal */}
      <Modal
        isOpen={showDeleteSchoolModal}
        onClose={() => !isDeletingSchool && setShowDeleteSchoolModal(false)}
        title={`Delete School Institution`}
      >
        <form onSubmit={handleExecuteDeleteSchool} className="space-y-4">
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-rose-900">
                Permanently Decommission {schoolToDelete?.schoolName || schoolToDelete?.schoolId}
              </p>
              <p className="text-xs text-rose-700 mt-1">
                This action is irreversible. It will remove the school profile, configuration, and mapped custom domains.
              </p>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-xs">
            <p className="text-slate-600"><strong className="text-slate-800">School Name:</strong> {schoolToDelete?.schoolName}</p>
            <p className="text-slate-600"><strong className="text-slate-800">School ID / Slug:</strong> <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-900">{schoolToDelete?.schoolId}</code></p>
          </div>

          <label className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={purgeSchoolDataOnDelete}
              onChange={(e) => setPurgeSchoolDataOnDelete(e.target.checked)}
              className="mt-0.5 rounded text-rose-600 focus:ring-rose-500"
            />
            <div>
              <span className="font-semibold text-slate-800 block">Wipe all tenant records for this school</span>
              <span className="text-slate-500">Permanently delete students, classes, results, payments, and submissions linked to this school.</span>
            </div>
          </label>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Type <strong className="text-rose-600 font-mono">{schoolToDelete?.schoolId}</strong> or <strong className="text-rose-600 font-mono">DELETE</strong> to confirm:
            </label>
            <input
              type="text"
              required
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-mono"
              placeholder={schoolToDelete?.schoolId || 'DELETE'}
            />
          </div>

          {deleteSchoolError && (
            <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{deleteSchoolError}</span>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              disabled={isDeletingSchool}
              onClick={() => setShowDeleteSchoolModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeletingSchool || !deleteConfirmationText.trim()}
              className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-1.5"
            >
              {isDeletingSchool ? (
                <>
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>Delete School</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete User Account Modal */}
      <Modal
        isOpen={showDeleteUserModal}
        onClose={() => !isDeletingUser && setShowDeleteUserModal(false)}
        title="Delete Administrator Account"
      >
        <form onSubmit={handleExecuteDeleteUser} className="space-y-4">
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-rose-900">
                Permanently Delete Administrator
              </p>
              <p className="text-xs text-rose-700 mt-1">
                This will revoke all administrative privileges and access to the portal.
              </p>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs">
            <p className="text-slate-600"><strong className="text-slate-800">Name:</strong> {userToDelete?.displayName || 'School Administrator'}</p>
            <p className="text-slate-600"><strong className="text-slate-800">Email:</strong> <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-900">{userToDelete?.email}</code></p>
            <p className="text-slate-600"><strong className="text-slate-800">School ID:</strong> <span className="font-mono">{userToDelete?.schoolId || 'default'}</span></p>
          </div>

          {deleteUserError && (
            <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{deleteUserError}</span>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              disabled={isDeletingUser}
              onClick={() => setShowDeleteUserModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeletingUser}
              className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isDeletingUser ? (
                <>
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>Confirm Delete</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Clear All Administrator Accounts Modal */}
      <Modal
        isOpen={showClearAdminsModal}
        onClose={() => !isClearingAdmins && setShowClearAdminsModal(false)}
        title="Clear All Administrator Accounts"
      >
        <form onSubmit={handleExecuteClearAllAdmins} className="space-y-4">
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-rose-900">
                Purge All Administrator Accounts
              </p>
              <p className="text-xs text-rose-700 mt-1">
                This will permanently delete all {users.filter(u => u.role === 'ADMIN').length} administrator account(s). The root Super Administrator account ({currentUser?.email || 'ilearnovate1@gmail.com'}) will NOT be deleted.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Type <strong className="text-rose-600 font-mono">CLEAR</strong> to confirm:
            </label>
            <input
              type="text"
              required
              value={clearAdminsConfirmText}
              onChange={(e) => setClearAdminsConfirmText(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-mono"
              placeholder="CLEAR"
            />
          </div>

          {clearAdminsError && (
            <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{clearAdminsError}</span>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              disabled={isClearingAdmins}
              onClick={() => setShowClearAdminsModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isClearingAdmins || clearAdminsConfirmText.trim().toUpperCase() !== 'CLEAR'}
              className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isClearingAdmins ? (
                <>
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                  <span>Clearing Accounts...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>Clear All Admins</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
