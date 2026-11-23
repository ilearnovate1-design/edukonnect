import { doc, getDoc } from 'firebase/firestore';
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
    conditions.C = { passed: true, detail: `Active ${mem.role} membership verified for ${schoolId}.` };
  } else {
    conditions.C = { passed: true, detail: 'Platform SUPER_ADMIN context verified.' };
  }

  if (isTeacherRole) {
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
    const isClassTeacher = input.selectedClass.classTeacherId === t.teacherId;
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

/**
 * Fetches live membership & teacher records from Firestore before evaluating Conditions A–J
 * so stale React state never hides missing memberships or out-of-sync teacher links.
 */
export async function verifyAndEvaluateReportAuthorization(
  input: Omit<EvaluateReportAuthInput, 'membership' | 'teacherProfile'> & {
    cachedMembership?: SchoolMembership | null;
    cachedTeacher?: Teacher | null;
  }
): Promise<{
  evaluation: ReportAuthorizationEvaluation;
  liveMembership: SchoolMembership | null;
  liveTeacher: Teacher | null;
}> {
  const schoolId = normalizeId(input.verifiedSchoolId);
  let liveMembership: SchoolMembership | null = input.cachedMembership || null;
  let liveTeacher: Teacher | null = input.cachedTeacher || null;

  if (input.authUid && schoolId && !input.isSuperAdmin) {
    try {
      const mId = `${schoolId}_${input.authUid}`;
      const mSnap = await getDoc(doc(db, 'memberships', mId));
      if (mSnap.exists()) {
        liveMembership = { id: mSnap.id, ...(mSnap.data() as any) } as SchoolMembership;
      } else {
        liveMembership = null;
      }
    } catch (err) {
      console.warn('[ReportAuthDiagnostic] Live membership lookup failed:', err);
    }

    const resolvedTid = liveMembership?.teacherId || input.cachedTeacher?.teacherId;
    if (input.role === 'TEACHER' && resolvedTid) {
      try {
        const tSnap = await getDoc(doc(db, 'teachers', resolvedTid));
        if (tSnap.exists()) {
          const td = tSnap.data() as Teacher;
          liveTeacher = { ...td, teacherId: td.teacherId || tSnap.id };
        } else {
          liveTeacher = null;
        }
      } catch (err) {
        console.warn('[ReportAuthDiagnostic] Live teacher lookup failed:', err);
      }
    }
  }

  const evaluation = evaluateReportConditionsSync({
    ...input,
    membership: liveMembership,
    teacherProfile: liveTeacher,
  });

  if (!evaluation.authorized && isDevEnv()) {
    console.error('[ReportAuthDiagnostic] Pre-flight check denied:', {
      diagnosticCode: evaluation.diagnosticCode,
      failedCondition: evaluation.failedCondition,
      devMessage: evaluation.devMessage,
      conditions: evaluation.conditions,
    });
  }

  return { evaluation, liveMembership, liveTeacher };
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
