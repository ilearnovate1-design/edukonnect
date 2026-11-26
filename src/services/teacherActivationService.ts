import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { SchoolClass, Teacher } from '../types';
import { provisionAccount } from './provisioningService';
import { reconcilePendingInvitationsForMember } from './invitationService';
import { logAudit } from '../utils/formatters';

export interface ActivateTeacherReportResult {
  updatedTeacher: Teacher;
  membershipSynced: boolean;
  provisionedNewAuth: boolean;
  reportReady: boolean;
  message: string;
}

/**
 * Activates and repairs a teacher's ability to Save Drafts & Submit Term Reports for approval:
 * 1. Ensures teacher profile status is ACTIVE and schoolId is normalized.
 * 2. Syncs assignedClassIds (preserving existing + any homeroom classTeacherId links + additionalClassIds).
 * 3. Resolves or provisions the teacher's auth UID (when tempPassword is available).
 * 4. Writes/repairs deterministic memberships/{schoolId}_{uid} with status: ACTIVE, role: TEACHER, and teacherId.
 */
export async function activateTeacherReportPermissions(params: {
  schoolId: string;
  schoolName?: string;
  teacher: Teacher;
  classes: SchoolClass[];
  actingAdminUid?: string;
  isSuperAdmin?: boolean;
  additionalClassIds?: string[];
  provisionAuthIfMissing?: boolean;
}): Promise<ActivateTeacherReportResult> {
  const cleanSchool = (params.schoolId || params.teacher.schoolId || '').trim().toLowerCase();
  if (!cleanSchool || cleanSchool === 'default') {
    throw new Error('A verified school workspace is required to activate teacher report permissions.');
  }

  const { teacher, classes } = params;
  const cleanEmail = (teacher.email || '').trim().toLowerCase();

  // 1. Collect all assigned + homeroom classes for this teacher in the school
  const classIdSet = new Set<string>(Array.isArray(teacher.assignedClassIds) ? teacher.assignedClassIds : []);
  classes.forEach((c) => {
    const cSchool = (c.schoolId || '').trim().toLowerCase();
    if (cSchool && cSchool !== cleanSchool) return;
    if (
      c.classTeacherId === teacher.teacherId ||
      (teacher.userId && c.classTeacherId === teacher.userId)
    ) {
      classIdSet.add(c.classId);
    }
  });
  (params.additionalClassIds || []).forEach((cid) => {
    if (cid && cid.trim()) classIdSet.add(cid.trim());
  });
  const mergedClassIds = Array.from(classIdSet);

  // 2. Resolve userId if not already linked on teacher doc
  let resolvedUserId = (teacher.userId || '').trim();

  if (!resolvedUserId && cleanEmail) {
    // Check deterministic/scoped memberships for this school & email (permitted for School Admin & SuperAdmin)
    try {
      const mSnap = await getDocs(
        query(
          collection(db, 'memberships'),
          where('schoolId', '==', cleanSchool),
          where('userEmail', '==', cleanEmail)
        )
      );
      mSnap.forEach((d) => {
        const md = d.data() as any;
        if (!resolvedUserId && typeof md.userId === 'string' && md.userId.trim()) {
          resolvedUserId = md.userId.trim();
        }
      });
    } catch (mErr) {
      console.warn('Membership email lookup notice:', mErr);
    }
  }

  if (!resolvedUserId && cleanEmail) {
    // Check school-scoped /users docs (permitted for School Admin & SuperAdmin)
    try {
      const uSnap = await getDocs(
        query(
          collection(db, 'users'),
          where('schoolId', '==', cleanSchool),
          where('email', '==', cleanEmail)
        )
      );
      if (!uSnap.empty) {
        resolvedUserId = uSnap.docs[0].id;
      }
    } catch (uErr) {
      console.warn('Scoped user lookup notice:', uErr);
    }
  }

  if (!resolvedUserId && cleanEmail && params.isSuperAdmin) {
    // Platform SuperAdmin can also locate previously unassigned user docs by email
    try {
      const globalUSnap = await getDocs(
        query(collection(db, 'users'), where('email', '==', cleanEmail))
      );
      globalUSnap.forEach((d) => {
        const ud = d.data() as any;
        if (!resolvedUserId && ud.role !== 'SUPER_ADMIN' && !ud.isSuperAdmin) {
          resolvedUserId = d.id;
        }
      });
    } catch (gErr) {
      console.warn('SuperAdmin user lookup notice:', gErr);
    }
  }

  let provisionedNewAuth = false;
  let authEmailAlreadyInUse = false;
  if (!resolvedUserId && params.provisionAuthIfMissing && cleanEmail && teacher.tempPassword?.trim()) {
    try {
      const { uid, reusedExistingAuth } = await provisionAccount(
        cleanEmail,
        teacher.tempPassword.trim(),
        `${teacher.firstName} ${teacher.lastName}`.trim(),
        'TEACHER',
        cleanSchool,
        {
          teacherId: teacher.teacherId,
          assignedClassIds: mergedClassIds,
          schoolName: params.schoolName || '',
        }
      );
      resolvedUserId = uid;
      provisionedNewAuth = !reusedExistingAuth;
    } catch (provErr: any) {
      const code = String(provErr?.code || provErr?.message || '');
      if (code.includes('auth/email-already-in-use')) {
        authEmailAlreadyInUse = true;
      } else {
        console.warn('Teacher auth provision notice:', provErr);
      }
    }
  }

  // 3. Persist ACTIVE status, merged classes, and resolved userId on teachers/{teacherId}
  const teacherUpdatePayload: Record<string, any> = {
    teacherId: teacher.teacherId,
    schoolId: cleanSchool,
    status: 'ACTIVE',
    assignedClassIds: mergedClassIds,
    updatedAt: serverTimestamp(),
  };
  if (resolvedUserId) {
    teacherUpdatePayload.userId = resolvedUserId;
  }

  await setDoc(doc(db, 'teachers', teacher.teacherId), teacherUpdatePayload, { merge: true });

  // 4. Sync deterministic membership & user profile when userId is known
  let membershipSynced = false;
  if (resolvedUserId) {
    const membershipId = `${cleanSchool}_${resolvedUserId}`;
    const existingMemSnap = await getDoc(doc(db, 'memberships', membershipId)).catch(() => null);
    const membershipPayload: Record<string, any> = {
      id: membershipId,
      userId: resolvedUserId,
      userEmail: cleanEmail,
      schoolId: cleanSchool,
      ...(params.schoolName ? { schoolName: params.schoolName } : {}),
      role: 'TEACHER',
      status: 'ACTIVE',
      teacherId: teacher.teacherId,
      updatedAt: serverTimestamp(),
    };
    if (!existingMemSnap || !existingMemSnap.exists()) {
      membershipPayload.createdAt = serverTimestamp();
      membershipPayload.activatedAt = serverTimestamp();
    }

    await setDoc(doc(db, 'memberships', membershipId), membershipPayload, { merge: true });
    membershipSynced = true;

    try {
      await setDoc(
        doc(db, 'users', resolvedUserId),
        {
          uid: resolvedUserId,
          email: cleanEmail,
          schoolId: cleanSchool,
          role: 'TEACHER',
          teacherId: teacher.teacherId,
          assignedClassIds: mergedClassIds,
          displayName: `${teacher.firstName} ${teacher.lastName}`.trim(),
          approvalStatus: 'APPROVED',
          active: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (uSyncErr) {
      console.warn('User profile sync notice:', uSyncErr);
    }

    try {
      await reconcilePendingInvitationsForMember({
        schoolId: cleanSchool,
        email: cleanEmail,
        role: 'TEACHER',
        acceptedByUid: resolvedUserId,
      });
    } catch (invReconcileErr) {
      console.warn('Invitation reconciliation notice:', invReconcileErr);
    }
  }

  if (params.actingAdminUid) {
    await logAudit(
      params.actingAdminUid,
      'TEACHER_REPORT_ACCESS_ACTIVATED',
      'teachers',
      teacher.teacherId,
      `Activated Save Drafts & Submit Term Reports permissions for ${teacher.firstName} ${teacher.lastName} (${mergedClassIds.length} class(es), membershipSynced=${membershipSynced})`,
      cleanSchool
    );
  }

  const updatedTeacher: Teacher = {
    ...teacher,
    schoolId: cleanSchool,
    status: 'ACTIVE',
    assignedClassIds: mergedClassIds,
    ...(resolvedUserId ? { userId: resolvedUserId } : {}),
  };

  const hasClasses = mergedClassIds.length > 0;
  const reportReady = membershipSynced && hasClasses;

  let message = '';
  if (reportReady) {
    message = `Activated Save Drafts & Submit Term Reports for ${teacher.firstName} ${teacher.lastName} (${mergedClassIds.length} class(es)).`;
  } else if (authEmailAlreadyInUse) {
    message = `${teacher.firstName} ${teacher.lastName} is ACTIVE${hasClasses ? ` with ${mergedClassIds.length} class(es)` : ''}. An account with ${cleanEmail} already exists with a custom password — their UID and school membership will link automatically on next sign-in.`;
  } else if (!resolvedUserId && !hasClasses) {
    message = `${teacher.firstName} ${teacher.lastName} marked ACTIVE. Assign at least one class and have the teacher sign in once to finish linking their UID.`;
  } else if (!resolvedUserId) {
    message = `${teacher.firstName} ${teacher.lastName} has ${mergedClassIds.length} class(es) and ACTIVE status. Report submission will activate automatically once they sign in or accept their invite.`;
  } else {
    message = `Membership synced for ${teacher.firstName} ${teacher.lastName}. Assign at least one class so they can select a class and submit reports.`;
  }

  return {
    updatedTeacher,
    membershipSynced,
    provisionedNewAuth,
    reportReady,
    message,
  };
}

/**
 * Activates/syncs Save Drafts & Submit Term Reports permissions for all teachers in a school.
 */
export async function activateAllSchoolTeachersReportAccess(params: {
  schoolId: string;
  schoolName?: string;
  teachers: Teacher[];
  classes: SchoolClass[];
  actingAdminUid?: string;
  isSuperAdmin?: boolean;
}): Promise<{
  updatedTeachers: Teacher[];
  activatedCount: number;
  pendingSignInCount: number;
  unassignedClassCount: number;
}> {
  const updatedTeachers: Teacher[] = [];
  let activatedCount = 0;
  let pendingSignInCount = 0;
  let unassignedClassCount = 0;

  for (const teacher of params.teachers) {
    const res = await activateTeacherReportPermissions({
      schoolId: params.schoolId,
      schoolName: params.schoolName,
      teacher,
      classes: params.classes,
      actingAdminUid: params.actingAdminUid,
      isSuperAdmin: params.isSuperAdmin,
      provisionAuthIfMissing: false,
    });
    updatedTeachers.push(res.updatedTeacher);
    if (res.reportReady) {
      activatedCount++;
    } else {
      if (!res.membershipSynced) pendingSignInCount++;
      if ((res.updatedTeacher.assignedClassIds || []).length === 0) unassignedClassCount++;
    }
  }

  return {
    updatedTeachers,
    activatedCount,
    pendingSignInCount,
    unassignedClassCount,
  };
}
