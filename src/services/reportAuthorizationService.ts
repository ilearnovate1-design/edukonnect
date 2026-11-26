import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import {
  Result,
  ResultStatus,
  SchoolClass,
  SchoolMembership,
  Subject,
  Teacher,
  UserRole,
} from '../types';

export type ReportDiagnosticCode =
  | 'MEMBERSHIP_MISSING'
  | 'SCHOOL_ID_MISMATCH'
  | 'CLASS_ASSIGNMENT_MISSING'
  | 'SUBJECT_ASSIGNMENT_MISSING'
  | 'REPORT_LOCKED'
  | 'INVALID_STATUS_TRANSITION'
  | 'FIRESTORE_RULES_DENIED'
  | 'RELATED_WRITE_DENIED';

export type AuthorizationConditionKey =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L';

export interface ConditionCheckResult {
  passed: boolean;
  detail: string;
}

export interface ReportAuthorizationEvaluation {
  authorized: boolean;
  failedCondition?: AuthorizationConditionKey;
  diagnosticCode?: ReportDiagnosticCode;
  userMessage: string;
  devMessage: string;
  conditions: Partial<Record<AuthorizationConditionKey, ConditionCheckResult>>;
}

const isDevEnv = (): boolean => {
  try {
    return typeof import.meta !== 'undefined' && Boolean((import.meta as any).env?.DEV);
  } catch {
    return false;
  }
};

export const normalizeId = (val?: string | null): string => (val || '').trim().toLowerCase();

const cleanDocSegment = (val: string): string =>
  val
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const shortStableHash = (raw: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Generates a deterministic, tenant-and-class-scoped Firestore document ID for a subject result.
 * Including schoolId and classId prevents cross-tenant and cross-class document ID collisions
 * when multiple schools use standard student/subject IDs (e.g. demo data or shared templates).
 */
export function buildScopedResultId(
  schoolId: string,
  studentId: string,
  classId: string,
  subjectId: string,
  term: string,
  academicSession: string
): string {
  const s = cleanDocSegment(normalizeId(schoolId)) || 'school';
  const stu = cleanDocSegment(studentId) || 'stu';
  const cls = cleanDocSegment(classId) || 'cls';
  const sub = cleanDocSegment(subjectId) || 'sub';
  const trm = cleanDocSegment(term) || 'term';
  const ses = cleanDocSegment(academicSession) || 'ses';

  const fullId = `res_${s}_${stu}_${cls}_${sub}_${trm}_${ses}`;
  if (fullId.length <= 110) {
    return fullId;
  }

  const hash = shortStableHash(`${normalizeId(schoolId)}|${studentId}|${classId}|${subjectId}|${term}|${academicSession}`);
  return `res_${s.slice(0, 20)}_${stu.slice(0, 20)}_${cls.slice(0, 20)}_${sub.slice(0, 20)}_${hash}`;
}

/**
 * Single Source of Truth for Report Locking across UI, Services, and Firestore Rules.
 *
 * Rules:
 * - Admins / Super Admins can unlock/revise reports through controlled workflow.
 * - Draft ('DRAFT') and Submitted ('SUBMITTED') reports are editable ONLY when neither
 *   `isLocked` nor legacy `locked` is true AND status is explicitly in ['DRAFT', 'SUBMITTED'].
 * - Approved ('APPROVED'), Published ('PUBLISHED'), or any unknown status is ALWAYS treated as locked
 *   for teachers even if explicit lock fields are absent on legacy documents.
 * - Ownership is satisfied if `result.teacherId` is empty, equals `currentUserUid`, or equals
 *   the teacher's verified `teacherId` profile ID (for legacy/seeded records).
 */
export function isResultRecordLocked(
  result: Partial<Result> & { locked?: boolean } | undefined | null,
  currentUserUid?: string | null,
  currentTeacherDocId?: string | null,
  isAtLeastAdmin: boolean = false
): { locked: boolean; reason?: string } {
  if (isAtLeastAdmin) {
    return { locked: false };
  }
  if (!result) {
    return { locked: false };
  }

  const rawStatus = result.status;
  if (rawStatus === 'APPROVED' || rawStatus === 'PUBLISHED') {
    return { locked: true, reason: `Report status is ${rawStatus}.` };
  }
  if (rawStatus && rawStatus !== 'DRAFT' && rawStatus !== 'SUBMITTED') {
    return { locked: true, reason: `Unrecognized report status (${String(rawStatus)}).` };
  }
  if (result.isLocked === true || result.locked === true) {
    return { locked: true, reason: 'Report is explicitly locked by administration.' };
  }

  const ownerId = (result.teacherId || '').trim();
  if (ownerId) {
    const matchesUid = !!(currentUserUid && ownerId === currentUserUid);
    const matchesTeacherDoc = !!(currentTeacherDocId && ownerId === currentTeacherDocId);
    if (!matchesUid && !matchesTeacherDoc) {
      return { locked: true, reason: 'Report is owned by another teacher.' };
    }
  }

  return { locked: false };
}

export interface EvaluateReportAuthInput {
  authUid?: string | null;
  authEmail?: string | null;
  role: UserRole | null;
  isSuperAdmin: boolean;
  isAtLeastAdmin: boolean;
  verifiedSchoolId: string;
  membership?: SchoolMembership | null;
  teacherProfile?: Teacher | null;
  liveUserTeacherId?: string | null;
  enforceDbTeacherLink?: boolean;
  selectedClass?: SchoolClass | null;
  selectedSubject?: Subject | null;
  targetStatus: ResultStatus;
  existingResults?: Array<Partial<Result> & { locked?: boolean }>;
}

/**
 * Pure condition-by-condition evaluator (Conditions A through J).
 * Used both pre-flight in ResultsPage and directly in automated security/workflow tests.
 */
export function evaluateReportConditionsSync(
  input: EvaluateReportAuthInput
): ReportAuthorizationEvaluation {
  const conditions: Partial<Record<AuthorizationConditionKey, ConditionCheckResult>> = {};
  const schoolId = normalizeId(input.verifiedSchoolId);
  const authEmail = normalizeId(input.authEmail);
  const isTeacherRole = input.role === 'TEACHER' && !input.isAtLeastAdmin;

  const fail = (
    failedCondition: AuthorizationConditionKey,
    diagnosticCode: ReportDiagnosticCode,
    userMessage: string,
    devMessage: string
  ): ReportAuthorizationEvaluation => {
    const formattedUser = isDevEnv() ? `[${diagnosticCode}] ${userMessage}` : userMessage;
    return {
      authorized: false,
      failedCondition,
      diagnosticCode,
      userMessage: formattedUser,
      devMessage,
      conditions,
    };
  };

  // A. Authenticated user valid?
  if (!input.authUid) {
    conditions.A = { passed: false, detail: 'Missing authenticated Firebase UID.' };
    return fail(
      'A',
      'MEMBERSHIP_MISSING',
      'You must be signed in to save or submit student reports.',
      'Condition A failed: request.auth.uid is missing.'
    );
  }
  conditions.A = { passed: true, detail: `Authenticated UID present (${input.authUid}).` };

  // School ID baseline check (part of C/D)
  if (!schoolId || (!input.isSuperAdmin && schoolId === 'default')) {
    conditions.C = { passed: false, detail: 'Missing verified tenant schoolId or invalid default fallback.' };
    return fail(
      'C',
      'MEMBERSHIP_MISSING',
      'Your account does not have an active school assignment. Please contact your school administrator.',
      `Condition C failed: verifiedSchoolId="${schoolId || 'empty'}" is missing or invalid.`
    );
  }

  // B & C. Active membership and teacher profile (for non-superadmin users / teachers)
  if (!input.isSuperAdmin) {
    const mem = input.membership;
    const memSchool = normalizeId(mem?.schoolId);
    const memStatus = mem?.status || '';
    const hasValidMem =
      !!mem &&
      mem.userId === input.authUid &&
      memSchool !== '' &&
      memStatus === 'ACTIVE';

    if (!hasValidMem) {
      conditions.C = {
        passed: false,
        detail: mem
          ? `Membership status is "${memStatus || 'MISSING'}" or userId mismatch.`
          : `Deterministic membership document ${schoolId}_${input.authUid} not found.`,
      };
      return fail(
        'C',
        'MEMBERSHIP_MISSING',
        'Your active school membership could not be verified. Please refresh or contact your school administrator.',
        `Condition C failed: ${conditions.C.detail}`
      );
    }

    if (memSchool !== schoolId) {
      conditions.D = {
        passed: false,
        detail: `Membership schoolId (${memSchool}) differs from report schoolId (${schoolId}).`,
      };
      return fail(
        'D',
        'SCHOOL_ID_MISMATCH',
        'Your active school membership does not match the selected school.',
        `Condition D failed: ${conditions.D.detail}`
      );
    }

    if (input.isAtLeastAdmin && mem.role !== 'ADMIN') {
      conditions.C = {
        passed: false,
        detail: `Membership role "${mem.role}" cannot authorize ADMIN report actions.`,
      };
      return fail(
        'C',
        'MEMBERSHIP_MISSING',
        'Your active school membership does not grant administrative report permissions.',
        `Condition C failed: ${conditions.C.detail}`
      );
    }
    if (isTeacherRole && mem.role !== 'TEACHER') {
      conditions.C = {
        passed: false,
        detail: `Membership role "${mem.role}" cannot authorize TEACHER report actions.`,
      };
      return fail(
        'C',
        'MEMBERSHIP_MISSING',
        'Your active school membership does not have the Teacher role required to edit student reports.',
        `Condition C failed: ${conditions.C.detail}`
      );
    }
    if (!input.isAtLeastAdmin && !isTeacherRole) {
      conditions.C = {
        passed: false,
        detail: `Role "${String(input.role || mem.role)}" is not permitted to write reports.`,
      };
      return fail(
        'C',
        'MEMBERSHIP_MISSING',
        'Your account role does not have permission to create or edit student reports.',
        `Condition C failed: ${conditions.C.detail}`
      );
    }

    conditions.C = { passed: true, detail: `Active ${mem.role} membership verified for ${schoolId}.` };
  } else {
    conditions.C = { passed: true, detail: 'Platform SUPER_ADMIN context verified.' };
  }

  if (isTeacherRole) {
    if (input.enforceDbTeacherLink) {
      const dbTid = (input.membership?.teacherId || input.liveUserTeacherId || '').trim();
      if (!dbTid) {
        conditions.B = {
          passed: false,
          detail: 'Neither membership.teacherId nor users/{uid}.teacherId is populated in Firestore.',
        };
        return fail(
          'B',
          'MEMBERSHIP_MISSING',
          'Your school membership is missing its teaching staff profile link. Please sign out and sign back in, or ask your school administrator to re-link your teacher account.',
          `Condition B failed: ${conditions.B.detail}`
        );
      }
      if (input.teacherProfile && input.teacherProfile.teacherId !== dbTid) {
        conditions.B = {
          passed: false,
          detail: `Teacher profile (${input.teacherProfile.teacherId}) does not match DB membership link (${dbTid}).`,
        };
        return fail(
          'B',
          'MEMBERSHIP_MISSING',
          'Your teaching staff profile link is out of sync with your school membership. Please refresh the page.',
          `Condition B failed: ${conditions.B.detail}`
        );
      }
    }

    const t = input.teacherProfile;
    if (!t || t.status === 'INACTIVE') {
      conditions.B = {
        passed: false,
        detail: !t ? 'Teacher profile document missing.' : 'Teacher profile status is INACTIVE.',
      };
      return fail(
        'B',
        'MEMBERSHIP_MISSING',
        'Your teaching staff profile is missing or inactive. Please contact your school administrator.',
        `Condition B failed: ${conditions.B.detail}`
      );
    }

    const tOwnerMatch =
      t.userId === input.authUid ||
      (authEmail !== '' && normalizeId(t.email) === authEmail);
    if (!tOwnerMatch) {
      conditions.B = {
        passed: false,
        detail: 'Teacher profile UID/email does not match authenticated user.',
      };
      return fail(
        'B',
        'MEMBERSHIP_MISSING',
        'Your teacher profile link could not be verified for this account. Please contact your school administrator.',
        `Condition B failed: ${conditions.B.detail}`
      );
    }
    conditions.B = { passed: true, detail: `Active teacher profile (${t.teacherId}) verified.` };

    // D. Teacher schoolId matches report schoolId
    if (normalizeId(t.schoolId) !== schoolId) {
      conditions.D = {
        passed: false,
        detail: `Teacher schoolId (${normalizeId(t.schoolId)}) !== report schoolId (${schoolId}).`,
      };
      return fail(
        'D',
        'SCHOOL_ID_MISMATCH',
        'Your teacher profile belongs to a different school than the selected report.',
        `Condition D failed: ${conditions.D.detail}`
      );
    }
    conditions.D = { passed: true, detail: `Teacher schoolId matches report schoolId (${schoolId}).` };
  } else {
    conditions.B = { passed: true, detail: 'Administrative role active.' };
    conditions.D = { passed: true, detail: `Administrative schoolId matches (${schoolId}).` };
  }

  // E. Class and Subject exist and belong to the same school
  if (!input.selectedClass || !input.selectedSubject) {
    conditions.E = { passed: false, detail: 'Selected class or subject record not found.' };
    return fail(
      'E',
      'CLASS_ASSIGNMENT_MISSING',
      'Please select a valid class and subject before saving.',
      'Condition E failed: selectedClass or selectedSubject is null.'
    );
  }
  if (
    normalizeId(input.selectedClass.schoolId) !== schoolId ||
    normalizeId(input.selectedSubject.schoolId) !== schoolId
  ) {
    conditions.E = {
      passed: false,
      detail: `Class (${normalizeId(input.selectedClass.schoolId)}) or subject (${normalizeId(input.selectedSubject.schoolId)}) schoolId !== ${schoolId}.`,
    };
    return fail(
      'E',
      'SCHOOL_ID_MISMATCH',
      'The selected class or subject does not belong to your active school.',
      `Condition E failed: ${conditions.E.detail}`
    );
  }
  conditions.E = { passed: true, detail: 'Class and subject belong to the verified school.' };

  // F & G. Teacher class and subject assignments
  if (isTeacherRole && input.teacherProfile) {
    const t = input.teacherProfile;
    const assignedClasses = Array.isArray(t.assignedClassIds) ? t.assignedClassIds : [];
    const isClassTeacher =
      input.selectedClass.classTeacherId === t.teacherId ||
      (!!input.authUid && input.selectedClass.classTeacherId === input.authUid);
    const classAuthorized = assignedClasses.includes(input.selectedClass.classId) || isClassTeacher;

    if (!classAuthorized) {
      conditions.F = {
        passed: false,
        detail: `Teacher ${t.teacherId} is not in assignedClassIds and not classTeacherId for ${input.selectedClass.classId}.`,
      };
      return fail(
        'F',
        'CLASS_ASSIGNMENT_MISSING',
        'You are not assigned to teach or manage results for the selected class.',
        `Condition F failed: ${conditions.F.detail}`
      );
    }
    conditions.F = {
      passed: true,
      detail: isClassTeacher ? 'Verified as class teacher.' : 'Verified via assignedClassIds.',
    };

    const teacherSubjects = Array.isArray(t.subjects) ? t.subjects : [];
    if (teacherSubjects.length > 0) {
      const subjectAuthorized =
        teacherSubjects.includes(input.selectedSubject.subjectId) ||
        teacherSubjects.includes(input.selectedSubject.name);
      if (!subjectAuthorized) {
        conditions.G = {
          passed: false,
          detail: `Teacher ${t.teacherId} subjects list does not include ${input.selectedSubject.subjectId}.`,
        };
        return fail(
          'G',
          'SUBJECT_ASSIGNMENT_MISSING',
          'You are not assigned to teach the selected subject.',
          `Condition G failed: ${conditions.G.detail}`
        );
      }
      conditions.G = { passed: true, detail: 'Subject verified in teacher subjects list.' };
    } else {
      conditions.G = {
        passed: true,
        detail: 'Teacher has class-teacher scope (no subject restriction list configured).',
      };
    }
  } else {
    conditions.F = { passed: true, detail: 'Admin/SuperAdmin class access permitted.' };
    conditions.G = { passed: true, detail: 'Admin/SuperAdmin subject access permitted.' };
  }

  // J. Requested status transition permitted for role?
  if (isTeacherRole && (input.targetStatus === 'APPROVED' || input.targetStatus === 'PUBLISHED')) {
    conditions.J = {
      passed: false,
      detail: `Teacher role cannot transition reports to ${input.targetStatus}.`,
    };
    return fail(
      'J',
      'INVALID_STATUS_TRANSITION',
      'Only school administrators can approve or publish student reports.',
      `Condition J failed: ${conditions.J.detail}`
    );
  }

  if (!['DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED'].includes(input.targetStatus)) {
    conditions.J = {
      passed: false,
      detail: `Unsupported target status "${String(input.targetStatus)}".`,
    };
    return fail(
      'J',
      'INVALID_STATUS_TRANSITION',
      'Invalid report workflow status requested.',
      `Condition J failed: ${conditions.J.detail}`
    );
  }

  // H & I. Report lock / editability checks
  const rows = input.existingResults || [];
  if (rows.length > 0) {
    const unlockedRows = rows.filter(
      (r) =>
        !isResultRecordLocked(
          r,
          input.authUid,
          input.teacherProfile?.teacherId,
          input.isAtLeastAdmin
        ).locked
    );

    if (unlockedRows.length === 0) {
      const firstLock = isResultRecordLocked(
        rows[0],
        input.authUid,
        input.teacherProfile?.teacherId,
        input.isAtLeastAdmin
      );
      conditions.H = { passed: false, detail: firstLock.reason || 'All reports are locked.' };
      conditions.I = { passed: false, detail: firstLock.reason || 'Report lock prevents editing.' };
      return fail(
        'I',
        'REPORT_LOCKED',
        'These student reports are locked (already approved, published, or owned by another teacher) and cannot be modified.',
        `Condition H/I failed: ${firstLock.reason}`
      );
    }

    // Also verify status transitions on editable rows
    if (isTeacherRole) {
      const invalidTransitionRow = unlockedRows.find(
        (r) => r.status && r.status !== 'DRAFT' && r.status !== 'SUBMITTED'
      );
      if (invalidTransitionRow) {
        conditions.J = {
          passed: false,
          detail: `Cannot transition report from ${invalidTransitionRow.status} to ${input.targetStatus}.`,
        };
        return fail(
          'J',
          'INVALID_STATUS_TRANSITION',
          'The current report status does not allow saving or submitting.',
          `Condition J failed: ${conditions.J.detail}`
        );
      }
    }
  }

  conditions.H = { passed: true, detail: 'Report records are editable.' };
  conditions.I = { passed: true, detail: 'Report lock status permits editing.' };
  conditions.J = { passed: true, detail: `Status transition to ${input.targetStatus} is permitted.` };

  return {
    authorized: true,
    userMessage: '',
    devMessage: 'All pre-flight authorization conditions (A–J) passed.',
    conditions,
  };
}

export interface TargetResultCheckItem {
  studentId: string;
  targetResultId: string;
  hasOriginal: boolean;
  classScopedResultId?: string;
}

/**
 * Fetches live membership, user, teacher, class, subject, and target result records from Firestore
 * before evaluating Conditions A–J so stale React state or cross-tenant ID collisions never mask failures.
 */
export async function verifyAndEvaluateReportAuthorization(
  input: Omit<
    EvaluateReportAuthInput,
    'membership' | 'teacherProfile' | 'liveUserTeacherId' | 'enforceDbTeacherLink'
  > & {
    cachedMembership?: SchoolMembership | null;
    cachedTeacher?: Teacher | null;
    term?: string;
    academicSession?: string;
    targetResults?: TargetResultCheckItem[];
  }
): Promise<{
  evaluation: ReportAuthorizationEvaluation;
  liveMembership: SchoolMembership | null;
  liveTeacher: Teacher | null;
  resolvedResultIds: Map<string, string>;
  liveExistingResultsMap: Map<string, Partial<Result> & { locked?: boolean }>;
}> {
  const schoolId = normalizeId(input.verifiedSchoolId);
  let liveMembership: SchoolMembership | null = null;
  let liveTeacher: Teacher | null = null;
  let liveUserTeacherId: string | null = null;
  let liveClass: SchoolClass | null = input.selectedClass || null;
  let liveSubject: Subject | null = input.selectedSubject || null;
  const resolvedResultIds = new Map<string, string>();
  const liveExistingResultsMap = new Map<string, Partial<Result> & { locked?: boolean }>();

  const buildEarlyFail = (
    failedCondition: AuthorizationConditionKey,
    diagnosticCode: ReportDiagnosticCode,
    userMessage: string,
    devMessage: string
  ): ReportAuthorizationEvaluation => ({
    authorized: false,
    failedCondition,
    diagnosticCode,
    userMessage: isDevEnv() ? `[${diagnosticCode}] ${userMessage}` : userMessage,
    devMessage,
    conditions: {
      A: { passed: !!input.authUid, detail: input.authUid ? 'UID present.' : 'UID missing.' },
      [failedCondition]: { passed: false, detail: devMessage },
    },
  });

  if (input.authUid && schoolId && !input.isSuperAdmin) {
    // 1. Live membership lookup (deterministic path checked by Firestore Rules)
    try {
      const mId = `${schoolId}_${input.authUid}`;
      const mSnap = await getDoc(doc(db, 'memberships', mId));
      if (mSnap.exists()) {
        liveMembership = { id: mSnap.id, ...(mSnap.data() as any) } as SchoolMembership;
      }
    } catch (err) {
      console.warn('[ReportAuthDiagnostic] Live membership lookup failed:', err);
    }

    // 2. Live /users/{uid} fallback for resolveMembershipTeacherId()
    try {
      const uSnap = await getDoc(doc(db, 'users', input.authUid));
      if (uSnap.exists()) {
        const rawTid = (uSnap.data() as any)?.teacherId;
        if (typeof rawTid === 'string' && rawTid.trim()) {
          liveUserTeacherId = rawTid.trim();
        }
      }
    } catch (err) {
      console.warn('[ReportAuthDiagnostic] Live user doc lookup failed:', err);
    }

    // 3. Live teacher doc lookup strictly using DB-resolved teacherId (never cached React fallback)
    const resolvedTid = (liveMembership?.teacherId || liveUserTeacherId || '').trim();
    if (input.role === 'TEACHER' && !input.isAtLeastAdmin && resolvedTid) {
      try {
        const tSnap = await getDoc(doc(db, 'teachers', resolvedTid));
        if (tSnap.exists()) {
          const td = tSnap.data() as Teacher;
          liveTeacher = { ...td, teacherId: tSnap.id };
        }
      } catch (err) {
        console.warn('[ReportAuthDiagnostic] Live teacher lookup failed:', err);
      }
    }

    // 4. Live class & subject doc path verification (Rules require exists(/classes/$(classId)) & exists(/subjects/$(subjectId)))
    if (input.selectedClass) {
      try {
        const cSnap = await getDoc(doc(db, 'classes', input.selectedClass.classId));
        if (!cSnap.exists()) {
          return {
            evaluation: buildEarlyFail(
              'E',
              'CLASS_ASSIGNMENT_MISSING',
              'The selected class record could not be verified at its database path. Please ask your administrator to re-save the class in Classes Management.',
              `Condition E failed: /classes/${input.selectedClass.classId} does not exist.`
            ),
            liveMembership,
            liveTeacher,
            resolvedResultIds,
            liveExistingResultsMap,
          };
        }
        liveClass = { ...(cSnap.data() as SchoolClass), classId: cSnap.id };
      } catch (err) {
        console.warn('[ReportAuthDiagnostic] Live class path check failed:', err);
        let idMismatch = false;
        try {
          const cListSnap = await getDocs(
            query(collection(db, 'classes'), where('schoolId', '==', schoolId))
          );
          idMismatch = cListSnap.docs.some(
            (d) => (d.data() as any).classId === input.selectedClass?.classId && d.id !== input.selectedClass?.classId
          );
        } catch {
          // ignore secondary diagnostic query failure
        }
        return {
          evaluation: buildEarlyFail(
            'E',
            idMismatch ? 'CLASS_ASSIGNMENT_MISSING' : 'SCHOOL_ID_MISMATCH',
            idMismatch
              ? 'The selected class record could not be verified at its database path. Please ask your administrator to re-save the class in Classes Management.'
              : 'You do not have permission to access the selected class record.',
            `Condition E failed: reading /classes/${input.selectedClass.classId} failed (idMismatch=${idMismatch}).`
          ),
          liveMembership,
          liveTeacher,
          resolvedResultIds,
          liveExistingResultsMap,
        };
      }
    }

    if (input.selectedSubject) {
      try {
        const sSnap = await getDoc(doc(db, 'subjects', input.selectedSubject.subjectId));
        if (!sSnap.exists()) {
          return {
            evaluation: buildEarlyFail(
              'E',
              'SUBJECT_ASSIGNMENT_MISSING',
              'The selected subject record could not be verified at its database path. Please ask your administrator to re-save the subject in Subjects Management.',
              `Condition E failed: /subjects/${input.selectedSubject.subjectId} does not exist.`
            ),
            liveMembership,
            liveTeacher,
            resolvedResultIds,
            liveExistingResultsMap,
          };
        }
        liveSubject = { ...(sSnap.data() as Subject), subjectId: sSnap.id };
      } catch (err) {
        console.warn('[ReportAuthDiagnostic] Live subject path check failed:', err);
        let idMismatch = false;
        try {
          const sListSnap = await getDocs(
            query(collection(db, 'subjects'), where('schoolId', '==', schoolId))
          );
          idMismatch = sListSnap.docs.some(
            (d) => (d.data() as any).subjectId === input.selectedSubject?.subjectId && d.id !== input.selectedSubject?.subjectId
          );
        } catch {
          // ignore secondary diagnostic query failure
        }
        return {
          evaluation: buildEarlyFail(
            'E',
            idMismatch ? 'SUBJECT_ASSIGNMENT_MISSING' : 'SCHOOL_ID_MISMATCH',
            idMismatch
              ? 'The selected subject record could not be verified at its database path. Please ask your administrator to re-save the subject in Subjects Management.'
              : 'You do not have permission to access the selected subject record.',
            `Condition E failed: reading /subjects/${input.selectedSubject.subjectId} failed (idMismatch=${idMismatch}).`
          ),
          liveMembership,
          liveTeacher,
          resolvedResultIds,
          liveExistingResultsMap,
        };
      }
    }
  } else if (input.isSuperAdmin) {
    liveMembership = input.cachedMembership || null;
    liveTeacher = input.cachedTeacher || null;
  }

  const evaluation = evaluateReportConditionsSync({
    ...input,
    membership: liveMembership,
    teacherProfile: liveTeacher,
    liveUserTeacherId,
    enforceDbTeacherLink: !input.isSuperAdmin,
    selectedClass: liveClass,
    selectedSubject: liveSubject,
  });

  if (!evaluation.authorized) {
    if (isDevEnv()) {
      console.error('[ReportAuthDiagnostic] Pre-flight check denied:', {
        diagnosticCode: evaluation.diagnosticCode,
        failedCondition: evaluation.failedCondition,
        devMessage: evaluation.devMessage,
        conditions: evaluation.conditions,
      });
    }
    return { evaluation, liveMembership, liveTeacher, resolvedResultIds, liveExistingResultsMap };
  }

  // 5. Target /results/{resultId} pre-flight server state & lock inspection via scoped list query
  // (Never calls getDoc on non-existent /results IDs because Firestore allow get requires resource.data)
  if (!input.isSuperAdmin && input.targetResults && input.targetResults.length > 0 && liveClass && liveSubject) {
    const resolvedTid = (liveMembership?.teacherId || liveUserTeacherId || '').trim();
    const serverByStudent = new Map<string, Partial<Result> & { locked?: boolean }>();
    const serverByDocId = new Map<string, Partial<Result> & { locked?: boolean }>();

    try {
      const constraints = [
        where('schoolId', '==', schoolId),
        where('classId', '==', liveClass.classId),
        where('subjectId', '==', liveSubject.subjectId),
      ];
      if (input.term) {
        constraints.push(where('term', '==', input.term));
      }
      if (input.academicSession) {
        constraints.push(where('academicSession', '==', input.academicSession));
      }

      const rSnap = await getDocs(query(collection(db, 'results'), ...constraints));
      rSnap.forEach((d) => {
        const data = { ...(d.data() as Partial<Result> & { locked?: boolean }), resultId: d.id };
        serverByDocId.set(d.id, data);
        if (data.studentId) {
          serverByStudent.set(data.studentId, data);
        }
      });
    } catch (queryErr) {
      console.warn('[ReportAuthDiagnostic] Scoped results pre-flight query failed:', queryErr);
    }

    let totalCheckedRows = 0;
    let unlockedTargetCount = 0;
    let firstServerLockReason = '';

    for (const item of input.targetResults) {
      totalCheckedRows++;
      const existingData =
        serverByDocId.get(item.targetResultId) || serverByStudent.get(item.studentId);
      const chosenId = existingData?.resultId || item.targetResultId;
      resolvedResultIds.set(item.studentId, chosenId);

      if (existingData) {
        liveExistingResultsMap.set(item.studentId, existingData);
        const lockStatus = isResultRecordLocked(
          existingData,
          input.authUid,
          resolvedTid || null,
          input.isAtLeastAdmin
        );
        if (!lockStatus.locked) {
          unlockedTargetCount++;
        } else if (!firstServerLockReason) {
          firstServerLockReason = lockStatus.reason || 'Report record is locked.';
        }
      } else {
        unlockedTargetCount++;
      }
    }

    if (totalCheckedRows > 0 && unlockedTargetCount === 0) {
      const lockEval = buildEarlyFail(
        'I',
        'REPORT_LOCKED',
        'These student reports are locked on the server (already approved, published, or owned by another teacher) and cannot be modified.',
        `Condition I failed: ${firstServerLockReason}`
      );
      return {
        evaluation: lockEval,
        liveMembership,
        liveTeacher,
        resolvedResultIds,
        liveExistingResultsMap,
      };
    }
  }

  return { evaluation, liveMembership, liveTeacher, resolvedResultIds, liveExistingResultsMap };
}

export interface FailedReportWriteDetail {
  resultId: string;
  operationType: 'CREATE' | 'UPDATE';
  expectedSchoolId: string;
  studentId: string;
  classId: string;
  subjectId: string;
  academicSession: string;
  term: string;
}

/**
 * Runs read-only live diagnostics if a write to /results/{resultId} fails with Firestore permission-denied,
 * returning an accurate, safe, non-PII error message identifying the exact failing rule condition.
 */
export async function diagnoseReportRuleDenial(params: {
  err: unknown;
  actionLabel: 'save' | 'submit' | 'approve' | 'publish';
  authUid?: string | null;
  authEmail?: string | null;
  role: UserRole | null;
  isSuperAdmin: boolean;
  isAtLeastAdmin: boolean;
  verifiedSchoolId: string;
  classId: string;
  subjectId: string;
  targetStatus: ResultStatus;
  targetResultIds: string[];
  usedBatchCount?: number;
  failedDetail?: FailedReportWriteDetail;
}): Promise<{ code: ReportDiagnosticCode; userMessage: string }> {
  const baseFailure = formatReportWriteFailure(params.err, 'REPORT_WRITE', params.actionLabel);
  const raw = params.err instanceof Error ? errMessage(params.err) : String(params.err || '');
  const isPermError =
    raw.toLowerCase().includes('missing or insufficient permissions') ||
    raw.includes('permission-denied');

  if (!isPermError || !params.authUid || !params.verifiedSchoolId || params.isSuperAdmin) {
    return baseFailure;
  }

  const schoolId = normalizeId(params.verifiedSchoolId);
  const wrap = (code: ReportDiagnosticCode, msg: string) => ({
    code,
    userMessage: isDevEnv() ? `[${code}] ${msg}` : msg,
  });

  // Firestore Rules cap multi-document WriteBatch requests at 20 document access calls total
  // (no cross-document caching in batches; each teacher /results write evaluates 5 external docs).
  if (params.usedBatchCount && params.usedBatchCount * 5 > 20) {
    return wrap(
      'FIRESTORE_RULES_DENIED',
      `Batch write of ${params.usedBatchCount} student reports exceeded Firestore's 20-document security-rule lookup limit (${params.usedBatchCount * 5} lookups).`
    );
  }

  try {
    const mSnap = await getDoc(doc(db, 'memberships', `${schoolId}_${params.authUid}`));
    if (!mSnap.exists()) {
      return wrap(
        'MEMBERSHIP_MISSING',
        'Your active school membership record was not found in the database. Please sign out and sign back in.'
      );
    }
    const mData = mSnap.data() as any;
    if (mData.status !== 'ACTIVE' || mData.userId !== params.authUid) {
      return wrap(
        'MEMBERSHIP_MISSING',
        'Your school membership is not active or not linked to your current sign-in account.'
      );
    }
    if (normalizeId(mData.schoolId) !== schoolId) {
      return wrap(
        'SCHOOL_ID_MISMATCH',
        'Your school membership belongs to a different school than the active workspace.'
      );
    }

    if (params.role === 'TEACHER' && !params.isAtLeastAdmin) {
      if (mData.role !== 'TEACHER') {
        return wrap(
          'MEMBERSHIP_MISSING',
          'Your school membership role is not configured as Teacher for this school.'
        );
      }

      let tid = (mData.teacherId || '').trim();
      if (!tid) {
        const uSnap = await getDoc(doc(db, 'users', params.authUid));
        tid = ((uSnap.exists() ? (uSnap.data() as any)?.teacherId : '') || '').trim();
      }
      if (!tid) {
        return wrap(
          'MEMBERSHIP_MISSING',
          'Your school membership is missing its teacher profile link. Please sign out and sign in again.'
        );
      }

      const tSnap = await getDoc(doc(db, 'teachers', tid));
      if (!tSnap.exists()) {
        return wrap(
          'MEMBERSHIP_MISSING',
          'Your linked teaching staff profile could not be found in the database.'
        );
      }
      const tData = tSnap.data() as Teacher;
      if (tData.status === 'INACTIVE') {
        return wrap('MEMBERSHIP_MISSING', 'Your teaching staff profile is marked inactive.');
      }
      if (normalizeId(tData.schoolId) !== schoolId) {
        return wrap(
          'SCHOOL_ID_MISMATCH',
          'Your teaching staff profile belongs to a different school.'
        );
      }
      const authEmail = normalizeId(params.authEmail);
      if (tData.userId !== params.authUid && (!authEmail || normalizeId(tData.email) !== authEmail)) {
        return wrap(
          'MEMBERSHIP_MISSING',
          'Your teaching staff profile is not linked to your current email or account.'
        );
      }

      const cSnap = await getDoc(doc(db, 'classes', params.classId));
      if (!cSnap.exists() || normalizeId((cSnap.data() as any).schoolId) !== schoolId) {
        return wrap(
          'CLASS_ASSIGNMENT_MISSING',
          'The selected class does not exist under your active school.'
        );
      }
      const cData = cSnap.data() as SchoolClass;
      const assignedClasses = Array.isArray(tData.assignedClassIds) ? tData.assignedClassIds : [];
      const classOk =
        assignedClasses.includes(params.classId) ||
        cData.classTeacherId === tid ||
        cData.classTeacherId === params.authUid;
      if (!classOk) {
        return wrap(
          'CLASS_ASSIGNMENT_MISSING',
          'You are not assigned as a subject or class teacher for the selected class.'
        );
      }

      const sSnap = await getDoc(doc(db, 'subjects', params.subjectId));
      if (!sSnap.exists() || normalizeId((sSnap.data() as any).schoolId) !== schoolId) {
        return wrap(
          'SUBJECT_ASSIGNMENT_MISSING',
          'The selected subject does not exist under your active school.'
        );
      }
      const sData = sSnap.data() as Subject;
      const teacherSubs = Array.isArray(tData.subjects) ? tData.subjects : [];
      if (
        teacherSubs.length > 0 &&
        !teacherSubs.includes(params.subjectId) &&
        !teacherSubs.includes(sData.name)
      ) {
        return wrap(
          'SUBJECT_ASSIGNMENT_MISSING',
          'You are not assigned to teach the selected subject.'
        );
      }

      const inspectExistingResult = (rData: Partial<Result> & { locked?: boolean }) => {
        const lockCheck = isResultRecordLocked(rData, params.authUid, tid, false);
        if (lockCheck.locked) {
          return wrap(
            'REPORT_LOCKED',
            'One or more target student reports are already approved, published, locked, or owned by another teacher.'
          );
        }
        if (params.failedDetail) {
          const d = params.failedDetail;
          if (
            (rData.schoolId && rData.schoolId !== d.expectedSchoolId) ||
            (rData.studentId && rData.studentId !== d.studentId) ||
            (rData.classId && rData.classId !== d.classId) ||
            (rData.subjectId && rData.subjectId !== d.subjectId) ||
            (rData.academicSession && rData.academicSession !== d.academicSession) ||
            (rData.term && rData.term !== d.term)
          ) {
            return wrap(
              'SCHOOL_ID_MISMATCH',
              'An existing report record at this path has mismatched school, class, subject, session, or term metadata.'
            );
          }
        }
        return null;
      };

      // If a specific resultId failed, try reading it directly (safe-guarded against non-existent doc permission-denied)
      if (params.failedDetail?.resultId) {
        try {
          const directSnap = await getDoc(doc(db, 'results', params.failedDetail.resultId));
          if (directSnap.exists()) {
            const directDiagnosis = inspectExistingResult(
              directSnap.data() as Partial<Result> & { locked?: boolean }
            );
            if (directDiagnosis) return directDiagnosis;
          }
        } catch {
          // Non-existent doc or cross-tenant collision triggers allow get denial; continue to scoped list check
        }
      }

      const existingDocsSnap = await getDocs(
        query(
          collection(db, 'results'),
          where('schoolId', '==', schoolId),
          where('classId', '==', params.classId),
          where('subjectId', '==', params.subjectId)
        )
      );
      const targetIdSet = new Set(params.targetResultIds);
      for (const rDoc of existingDocsSnap.docs) {
        if (!targetIdSet.has(rDoc.id)) continue;
        const rData = rDoc.data() as Partial<Result> & { locked?: boolean };
        const listDiagnosis = inspectExistingResult(rData);
        if (listDiagnosis) return listDiagnosis;
      }
    }
  } catch (diagErr) {
    if (isDevEnv()) {
      console.warn('[ReportAuthDiagnostic] Post-denial inspection error:', diagErr);
    }
  }

  return baseFailure;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err || '');
}

/**
 * Formats Firestore rule or related-write errors cleanly with dev-only diagnostic codes
 * and safe production messages (never leaking PII, cross-school IDs, or internal secrets).
 */
export function formatReportWriteFailure(
  err: unknown,
  stage: 'REPORT_WRITE' | 'RELATED_WRITE',
  actionLabel: 'save' | 'submit' | 'approve' | 'publish'
): { code: ReportDiagnosticCode; userMessage: string } {
  const code: ReportDiagnosticCode =
    stage === 'REPORT_WRITE' ? 'FIRESTORE_RULES_DENIED' : 'RELATED_WRITE_DENIED';

  const raw = err instanceof Error ? err.message : String(err || '');
  const isPermError =
    raw.toLowerCase().includes('missing or insufficient permissions') ||
    raw.includes('permission-denied');

  if (isDevEnv()) {
    console.error('[ReportAuthDiagnostic]', {
      diagnosticCode: code,
      condition: stage === 'REPORT_WRITE' ? 'K' : 'L',
      stage,
      rawError: raw,
    });
  }

  if (stage === 'RELATED_WRITE') {
    const prodMsg =
      'Report scores were saved, but recording the accompanying activity log or notification was denied.';
    return {
      code,
      userMessage: isDevEnv() ? `[${code}] ${prodMsg}` : prodMsg,
    };
  }

  if (isPermError) {
    const prodMsg = `Unable to ${actionLabel} student reports due to insufficient permissions. Please verify your active school membership, class/subject assignment, and report lock status.`;
    return {
      code,
      userMessage: isDevEnv()
        ? `[${code}] Firestore Security Rules rejected the write to /results. Verify membership document, teacherId link, class/subject assignment, and lock state.`
        : prodMsg,
    };
  }

  const fallback = `Failed to ${actionLabel} student reports. Please try again.`;
  return {
    code,
    userMessage: isDevEnv() ? `[${code}] ${raw || fallback}` : fallback,
  };
}
