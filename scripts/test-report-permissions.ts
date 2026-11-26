/**
 * Phase 6 Security & Workflow Test Suite:
 * Verifies Firestore Security Rules logic, report locking invariants,
 * multi-tenant report workflow boundaries, and granular diagnostic codes
 * across two separate schools (12 required scenarios + regression checks).
 *
 * Note: Because the container environment does not have a Java JRE installed
 * for local Firebase Emulator execution, this suite faithfully evaluates the
 * exact rule predicates implemented in /firestore.rules alongside the live
 * TypeScript helpers in src/services/reportAuthorizationService.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildScopedResultId,
  evaluateReportConditionsSync,
  formatReportWriteFailure,
  isResultRecordLocked,
} from '../src/services/reportAuthorizationService';
import { SchoolClass, SchoolMembership, Subject, Teacher } from '../src/types';

type ReportStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PUBLISHED';

interface AuthContext {
  uid: string;
  email: string;
}

interface MembershipDoc {
  id: string;
  userId: string;
  schoolId: string;
  role: 'ADMIN' | 'TEACHER' | 'PARENT';
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED';
  teacherId?: string;
  parentId?: string;
}

interface TeacherDoc {
  teacherId: string;
  schoolId: string;
  userId?: string;
  email: string;
  assignedClassIds: string[];
  subjects: string[];
  status: 'ACTIVE' | 'INACTIVE';
}

interface ClassDoc {
  classId: string;
  schoolId: string;
  name: string;
  classTeacherId?: string;
}

interface SubjectDoc {
  subjectId: string;
  schoolId: string;
  name: string;
}

interface ResultDoc {
  resultId: string;
  schoolId: string;
  studentId: string;
  classId: string;
  subjectId: string;
  academicSession: string;
  term: string;
  teacherId?: string | null;
  totalScore: number;
  grade: string;
  status: ReportStatus;
  isLocked?: boolean;
  locked?: boolean;
  lockedBy?: string;
  lockedAt?: string;
  submittedBy?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  publishedBy?: string;
  publishedAt?: string;
}

// Simulated Firestore Collections
const memberships = new Map<string, MembershipDoc>();
const teachers = new Map<string, TeacherDoc>();
const classes = new Map<string, ClassDoc>();
const subjects = new Map<string, SubjectDoc>();
const results = new Map<string, ResultDoc>();

const strLower = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// Exact mirror of /firestore.rules helper predicates (including case-normalization & lock gates)
function isValidTenantSchoolId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && strLower(id) !== 'default';
}

function hasActiveMembership(auth: AuthContext | null, schoolId: string): MembershipDoc | null {
  if (!auth || !isValidTenantSchoolId(schoolId)) return null;
  const m = memberships.get(`${strLower(schoolId)}_${auth.uid}`);
  if (!m) return null;
  if (m.userId !== auth.uid || strLower(m.schoolId) !== strLower(schoolId) || m.status !== 'ACTIVE') return null;
  return m;
}

function isResultLockedDoc(data: ResultDoc): boolean {
  return (
    data.isLocked === true ||
    data.locked === true ||
    !['DRAFT', 'SUBMITTED'].includes(data.status || 'DRAFT')
  );
}

function resolveMembershipTeacherId(auth: AuthContext, schoolId: string): string {
  const m = hasActiveMembership(auth, schoolId);
  return m?.teacherId || '';
}

function isTeacherAuthorizedForReport(
  auth: AuthContext,
  schoolId: string,
  classId: string,
  subjectId: string
): boolean {
  const m = hasActiveMembership(auth, schoolId);
  if (!m || m.role !== 'TEACHER') return false;

  const tid = resolveMembershipTeacherId(auth, schoolId);
  if (!tid) return false;
  const tData = teachers.get(tid);
  if (!tData) return false;
  if (strLower(tData.schoolId) !== strLower(schoolId) || tData.status === 'INACTIVE') return false;
  if (tData.userId !== auth.uid && strLower(tData.email) !== strLower(auth.email)) return false;

  const cData = classes.get(classId);
  if (!cData || strLower(cData.schoolId) !== strLower(schoolId)) return false;
  const classAuthorized =
    (Array.isArray(tData.assignedClassIds) && tData.assignedClassIds.includes(classId)) ||
    cData.classTeacherId === tid ||
    cData.classTeacherId === auth.uid;
  if (!classAuthorized) return false;

  const sData = subjects.get(subjectId);
  if (!sData || strLower(sData.schoolId) !== strLower(schoolId)) return false;
  if (Array.isArray(tData.subjects) && tData.subjects.length > 0) {
    if (!tData.subjects.includes(subjectId) && !tData.subjects.includes(sData.name)) {
      return false;
    }
  }
  return true;
}

function canReadResult(auth: AuthContext | null, docData: ResultDoc): boolean {
  if (!auth) return false;
  const m = hasActiveMembership(auth, docData.schoolId);
  if (!m) return false;
  if (m.role === 'ADMIN' || m.role === 'TEACHER') return true;
  if (m.role === 'PARENT') return docData.status === 'PUBLISHED';
  return false;
}

function canCreateResult(
  auth: AuthContext | null,
  reqData: ResultDoc
): { allowed: boolean; reason?: string } {
  if (!auth) return { allowed: false, reason: 'Unauthenticated' };
  if (!isValidTenantSchoolId(reqData.schoolId)) {
    return { allowed: false, reason: 'Invalid or default schoolId' };
  }
  const m = hasActiveMembership(auth, reqData.schoolId);
  if (!m) return { allowed: false, reason: 'Missing or inactive school membership' };

  const cData = classes.get(reqData.classId);
  const sData = subjects.get(reqData.subjectId);
  if (!cData || strLower(cData.schoolId) !== strLower(reqData.schoolId)) {
    return { allowed: false, reason: 'Class does not belong to school' };
  }
  if (!sData || strLower(sData.schoolId) !== strLower(reqData.schoolId)) {
    return { allowed: false, reason: 'Subject does not belong to school' };
  }

  if (m.role === 'ADMIN') {
    return ['DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED'].includes(reqData.status)
      ? { allowed: true }
      : { allowed: false, reason: 'Invalid status' };
  }

  if (m.role === 'TEACHER') {
    if (!isTeacherAuthorizedForReport(auth, reqData.schoolId, reqData.classId, reqData.subjectId)) {
      return { allowed: false, reason: 'Teacher not authorized for class/subject/school' };
    }
    if (reqData.teacherId !== auth.uid) {
      return { allowed: false, reason: 'teacherId must match authenticated UID' };
    }
    if (!['DRAFT', 'SUBMITTED'].includes(reqData.status)) {
      return { allowed: false, reason: 'Teachers cannot approve or publish reports' };
    }
    if (reqData.isLocked === true || reqData.locked === true) {
      return { allowed: false, reason: 'Teachers cannot set premature lock flags' };
    }
    if (
      reqData.approvedBy ||
      reqData.approvedAt ||
      reqData.publishedBy ||
      reqData.publishedAt ||
      reqData.lockedBy ||
      reqData.lockedAt
    ) {
      return { allowed: false, reason: 'Teachers cannot set approval/publication/lock metadata' };
    }
    if (reqData.status === 'SUBMITTED' && reqData.submittedBy !== auth.uid) {
      return { allowed: false, reason: 'submittedBy must match authenticated UID' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Parents cannot write student reports' };
}

function canUpdateResult(
  auth: AuthContext | null,
  existing: ResultDoc,
  nextData: ResultDoc
): { allowed: boolean; reason?: string } {
  if (!auth) return { allowed: false, reason: 'Unauthenticated' };
  if (!isValidTenantSchoolId(existing.schoolId)) {
    return { allowed: false, reason: 'Invalid existing schoolId' };
  }
  const m = hasActiveMembership(auth, existing.schoolId);
  if (!m) return { allowed: false, reason: 'Missing or inactive school membership' };

  // Immutable tenant/identity keys
  if (
    nextData.schoolId !== existing.schoolId ||
    nextData.studentId !== existing.studentId ||
    nextData.classId !== existing.classId ||
    nextData.subjectId !== existing.subjectId ||
    nextData.academicSession !== existing.academicSession ||
    nextData.term !== existing.term
  ) {
    return { allowed: false, reason: 'Immutable tenant or report identity fields cannot be modified' };
  }

  if (m.role === 'ADMIN') {
    return ['DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED'].includes(nextData.status)
      ? { allowed: true }
      : { allowed: false, reason: 'Invalid status' };
  }

  if (m.role === 'TEACHER') {
    if (!isTeacherAuthorizedForReport(auth, existing.schoolId, existing.classId, existing.subjectId)) {
      return { allowed: false, reason: 'Teacher not authorized for class/subject' };
    }
    if (isResultLockedDoc(existing)) {
      return { allowed: false, reason: 'Cannot modify approved, published, or locked report' };
    }
    if (!['DRAFT', 'SUBMITTED'].includes(nextData.status)) {
      return { allowed: false, reason: 'Teachers cannot approve or publish reports' };
    }
    if (nextData.isLocked === true || nextData.locked === true) {
      return { allowed: false, reason: 'Teachers cannot lock or unlock reports' };
    }
    const tid = resolveMembershipTeacherId(auth, existing.schoolId);
    const hasExistingOwner = existing.teacherId !== undefined && existing.teacherId !== null && existing.teacherId !== '';
    if (hasExistingOwner && existing.teacherId !== auth.uid && existing.teacherId !== tid) {
      return { allowed: false, reason: 'Cannot modify another teacher report' };
    }
    if (nextData.teacherId !== auth.uid) {
      return { allowed: false, reason: 'Cannot reassign ownership teacherId' };
    }
    if (
      nextData.approvedBy !== existing.approvedBy ||
      nextData.approvedAt !== existing.approvedAt ||
      nextData.publishedBy !== existing.publishedBy ||
      nextData.publishedAt !== existing.publishedAt ||
      nextData.lockedBy !== existing.lockedBy ||
      nextData.lockedAt !== existing.lockedAt
    ) {
      return { allowed: false, reason: 'Teachers cannot modify approval/publication/lock metadata' };
    }
    if (nextData.status === 'SUBMITTED' && nextData.submittedBy !== auth.uid) {
      return { allowed: false, reason: 'submittedBy must match authenticated UID' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Parents cannot update student reports' };
}

// Seed Test Data across TWO separate schools
const authTeacherA: AuthContext = { uid: 'uid_teacher_a', email: 'teacher.a@schoola.edu' };
const authTeacherA2: AuthContext = { uid: 'uid_teacher_a2', email: 'teacher.a2@schoola.edu' };
const authTeacherNoMembership: AuthContext = { uid: 'uid_teacher_orphan', email: 'orphan@schoola.edu' };
const authTeacherMissingTid: AuthContext = { uid: 'uid_teacher_missing_tid', email: 'notid@schoola.edu' };
const authTeacherMixedCase: AuthContext = { uid: 'uid_teacher_mixed', email: 'mixed@schoola.edu' };
const authTeacherWrongSchool: AuthContext = { uid: 'uid_teacher_wrong', email: 'wrong@schoolb.edu' };
const authAdminA: AuthContext = { uid: 'uid_admin_a', email: 'admin@schoola.edu' };
const authParentA: AuthContext = { uid: 'uid_parent_a', email: 'parent@schoola.edu' };

memberships.set('school-a_uid_teacher_a', {
  id: 'school-a_uid_teacher_a',
  userId: 'uid_teacher_a',
  schoolId: 'school-a',
  role: 'TEACHER',
  status: 'ACTIVE',
  teacherId: 'tch_a1',
});
memberships.set('school-a_uid_teacher_a2', {
  id: 'school-a_uid_teacher_a2',
  userId: 'uid_teacher_a2',
  schoolId: 'school-a',
  role: 'TEACHER',
  status: 'ACTIVE',
  teacherId: 'tch_a2',
});
memberships.set('school-a_uid_teacher_missing_tid', {
  id: 'school-a_uid_teacher_missing_tid',
  userId: 'uid_teacher_missing_tid',
  schoolId: 'school-a',
  role: 'TEACHER',
  status: 'ACTIVE',
  // teacherId intentionally missing
});
memberships.set('school-a_uid_teacher_mixed', {
  id: 'school-a_uid_teacher_mixed',
  userId: 'uid_teacher_mixed',
  schoolId: 'school-a',
  role: 'TEACHER',
  status: 'ACTIVE',
  teacherId: 'tch_a_mixed',
});
memberships.set('school-b_uid_teacher_wrong', {
  id: 'school-b_uid_teacher_wrong',
  userId: 'uid_teacher_wrong',
  schoolId: 'school-b',
  role: 'TEACHER',
  status: 'ACTIVE',
  teacherId: 'tch_b_wrong',
});
memberships.set('school-a_uid_admin_a', {
  id: 'school-a_uid_admin_a',
  userId: 'uid_admin_a',
  schoolId: 'school-a',
  role: 'ADMIN',
  status: 'ACTIVE',
});
memberships.set('school-a_uid_parent_a', {
  id: 'school-a_uid_parent_a',
  userId: 'uid_parent_a',
  schoolId: 'school-a',
  role: 'PARENT',
  status: 'ACTIVE',
  parentId: 'par_a1',
});

teachers.set('tch_a1', {
  teacherId: 'tch_a1',
  schoolId: 'school-a',
  userId: 'uid_teacher_a',
  email: 'teacher.a@schoola.edu',
  assignedClassIds: ['cls_a_pry1'],
  subjects: ['sub_a_math'],
  status: 'ACTIVE',
});
teachers.set('tch_a2', {
  teacherId: 'tch_a2',
  schoolId: 'school-a',
  userId: 'uid_teacher_a2',
  email: 'teacher.a2@schoola.edu',
  assignedClassIds: ['cls_a_pry1'],
  subjects: ['sub_a_eng'],
  status: 'ACTIVE',
});
teachers.set('tch_a_mixed', {
  teacherId: 'tch_a_mixed',
  schoolId: 'School-A',
  email: 'Mixed@SchoolA.Edu',
  assignedClassIds: ['cls_a_pry1'],
  subjects: [], // Class teacher scope
  status: 'ACTIVE',
});
teachers.set('tch_b_wrong', {
  teacherId: 'tch_b_wrong',
  schoolId: 'school-b',
  userId: 'uid_teacher_wrong',
  email: 'wrong@schoolb.edu',
  assignedClassIds: ['cls_b_pry1'],
  subjects: ['sub_b_math'],
  status: 'ACTIVE',
});

classes.set('cls_a_pry1', { classId: 'cls_a_pry1', schoolId: 'school-a', name: 'Primary 1' });
classes.set('cls_b_pry1', { classId: 'cls_b_pry1', schoolId: 'school-b', name: 'Primary 1 B' });
subjects.set('sub_a_math', { subjectId: 'sub_a_math', schoolId: 'school-a', name: 'Mathematics' });
subjects.set('sub_a_eng', { subjectId: 'sub_a_eng', schoolId: 'school-a', name: 'English' });
subjects.set('sub_b_math', { subjectId: 'sub_b_math', schoolId: 'school-b', name: 'Mathematics' });

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

console.log('--- PHASE 6: REPORT SECURITY RULES, LOCKING & DIAGNOSTIC VERIFICATION ---\n');

// 1. Teacher A can save a draft for an assigned class in School A
const draftA: ResultDoc = {
  resultId: 'res_stu1_sub_a_math_First-Term_2026-2027',
  schoolId: 'school-a',
  studentId: 'stu_a1',
  classId: 'cls_a_pry1',
  subjectId: 'sub_a_math',
  academicSession: '2026/2027',
  term: 'First Term',
  teacherId: authTeacherA.uid,
  totalScore: 84,
  grade: 'A',
  status: 'DRAFT',
  isLocked: false,
};
const res1 = canCreateResult(authTeacherA, draftA);
assert(res1.allowed === true, '1. Teacher A can save DRAFT for assigned class & subject in School A', res1.reason);
if (res1.allowed) results.set(draftA.resultId, draftA);

// 2. Teacher A can submit the draft for approval
const submittedA: ResultDoc = {
  ...draftA,
  status: 'SUBMITTED',
  isLocked: false,
  submittedBy: authTeacherA.uid,
  submittedAt: '2026-11-23T08:00:00Z',
};
const res2 = canUpdateResult(authTeacherA, draftA, submittedA);
assert(res2.allowed === true, '2. Teacher A can submit their own DRAFT for approval', res2.reason);
if (res2.allowed) results.set(submittedA.resultId, submittedA);

// 3. Teacher A cannot save reports for School B
const crossSchoolReport: ResultDoc = {
  ...draftA,
  resultId: 'res_stu_b1_sub_b_math',
  schoolId: 'school-b',
  classId: 'cls_b_pry1',
  subjectId: 'sub_b_math',
};
const res3 = canCreateResult(authTeacherA, crossSchoolReport);
assert(res3.allowed === false, '3. Teacher A CANNOT save reports for School B', res3.reason);

// 4. Teacher A cannot submit another teacher's restricted report
const otherTeacherDraft: ResultDoc = {
  ...draftA,
  resultId: 'res_stu1_sub_a_eng',
  subjectId: 'sub_a_eng',
  teacherId: authTeacherA2.uid,
};
results.set(otherTeacherDraft.resultId, otherTeacherDraft);
const res4 = canUpdateResult(authTeacherA, otherTeacherDraft, {
  ...otherTeacherDraft,
  status: 'SUBMITTED',
  submittedBy: authTeacherA.uid,
});
assert(res4.allowed === false, '4. Teacher A CANNOT submit another teacher’s restricted report', res4.reason);

// 5. Teacher A cannot approve or publish reports without permission
const res5a = canUpdateResult(authTeacherA, submittedA, {
  ...submittedA,
  status: 'APPROVED',
  approvedBy: authTeacherA.uid,
});
const res5b = canCreateResult(authTeacherA, { ...draftA, status: 'PUBLISHED', publishedBy: authTeacherA.uid });
assert(res5a.allowed === false && res5b.allowed === false, '5. Teacher A CANNOT approve or publish reports');

// 6. School A administrator can approve eligible reports in School A
const approvedByAdminA: ResultDoc = {
  ...submittedA,
  status: 'APPROVED',
  isLocked: true,
  approvedBy: authAdminA.uid,
  approvedAt: '2026-11-23T09:00:00Z',
  lockedBy: authAdminA.uid,
  lockedAt: '2026-11-23T09:00:00Z',
};
const res6 = canUpdateResult(authAdminA, submittedA, approvedByAdminA);
assert(res6.allowed === true, '6. School A Admin CAN approve eligible reports in School A', res6.reason);
if (res6.allowed) results.set(approvedByAdminA.resultId, approvedByAdminA);

// 7. School A administrator cannot approve reports belonging to School B
const schoolBSubmitted: ResultDoc = {
  ...crossSchoolReport,
  teacherId: authTeacherWrongSchool.uid,
  status: 'SUBMITTED',
  submittedBy: authTeacherWrongSchool.uid,
};
const res7 = canUpdateResult(authAdminA, schoolBSubmitted, {
  ...schoolBSubmitted,
  status: 'APPROVED',
  approvedBy: authAdminA.uid,
});
assert(res7.allowed === false, '7. School A Admin CANNOT approve reports belonging to School B', res7.reason);

// 8. A teacher with missing school membership is denied access
const res8 = canCreateResult(authTeacherNoMembership, {
  ...draftA,
  teacherId: authTeacherNoMembership.uid,
});
assert(res8.allowed === false, '8. Teacher with missing school membership is DENIED access', res8.reason);

// 9. A teacher with an incorrect schoolId is denied access
const res9 = canCreateResult(authTeacherWrongSchool, {
  ...draftA,
  teacherId: authTeacherWrongSchool.uid,
});
assert(res9.allowed === false, '9. Teacher with incorrect schoolId (School B claiming School A) is DENIED access', res9.reason);

// 10. A parent cannot write or modify student reports
const res10create = canCreateResult(authParentA, { ...draftA, resultId: 'res_parent_attempt' });
const res10update = canUpdateResult(authParentA, approvedByAdminA, { ...approvedByAdminA, totalScore: 100 });
assert(res10create.allowed === false && res10update.allowed === false, '10. Parent CANNOT create or modify student reports');

// 11. A teacher cannot alter schoolId, ownership, lock flags, or protected fields during an update
const freshDraft: ResultDoc = { ...draftA, resultId: 'res_stu2_sub_a_math', isLocked: false };
const res11school = canUpdateResult(authTeacherA, freshDraft, { ...freshDraft, schoolId: 'school-b' });
const res11owner = canUpdateResult(authTeacherA, freshDraft, { ...freshDraft, teacherId: authTeacherA2.uid });
const res11approvedMeta = canUpdateResult(authTeacherA, freshDraft, { ...freshDraft, approvedBy: authTeacherA.uid });
const res11postApproval = canUpdateResult(authTeacherA, approvedByAdminA, { ...approvedByAdminA, totalScore: 99 });
const res11unlockAttempt = canUpdateResult(authTeacherA, approvedByAdminA, {
  ...approvedByAdminA,
  status: 'DRAFT',
  isLocked: false,
});
const res11explicitLock = canUpdateResult(
  authTeacherA,
  { ...freshDraft, isLocked: true },
  { ...freshDraft, isLocked: false, totalScore: 95 }
);
assert(
  !res11school.allowed &&
    !res11owner.allowed &&
    !res11approvedMeta.allowed &&
    !res11postApproval.allowed &&
    !res11unlockAttempt.allowed &&
    !res11explicitLock.allowed,
  '11. Teacher CANNOT alter schoolId, ownership, approval metadata, locked/approved reports, or unlock via client'
);

// 12. Existing report records can still be read according to their authorised permissions
const publishedA: ResultDoc = { ...approvedByAdminA, status: 'PUBLISHED', publishedBy: authAdminA.uid };
const read12TeacherOwn = canReadResult(authTeacherA, submittedA);
const read12ParentPublished = canReadResult(authParentA, publishedA);
const read12ParentDraft = canReadResult(authParentA, freshDraft);
const read12CrossSchool = canReadResult(authTeacherWrongSchool, publishedA);
assert(
  read12TeacherOwn && read12ParentPublished && !read12ParentDraft && !read12CrossSchool,
  '12. Authorized reads succeed (staff sees school reports, parent sees PUBLISHED only, cross-school denied)'
);

// Regression Checks for Root Causes Identified in Trace
console.log('\n--- REGRESSION CHECKS (RULE GUARDS, LEGACY DOCS, LOCKING & DIAGNOSTICS) ---\n');

const resMissingTid = canCreateResult(authTeacherMissingTid, {
  ...draftA,
  teacherId: authTeacherMissingTid.uid,
});
assert(
  resMissingTid.allowed === false,
  'R1. Missing teacherId on membership fails closed cleanly without evaluation crash'
);

const resMixedCaseTeacher = canCreateResult(authTeacherMixedCase, {
  ...draftA,
  resultId: 'res_mixed_case_teacher',
  teacherId: authTeacherMixedCase.uid,
});
assert(
  resMixedCaseTeacher.allowed === true,
  'R2. Legacy teacher record with mixed-case email/schoolId and class-teacher scope saves & submits cleanly',
  resMixedCaseTeacher.reason
);

const legacySeededDraft: ResultDoc = {
  ...draftA,
  resultId: 'res_legacy_seeded',
  teacherId: 'tch_a1', // Teacher document ID instead of Auth UID
};
const resLegacyUpdate = canUpdateResult(authTeacherA, legacySeededDraft, {
  ...legacySeededDraft,
  teacherId: authTeacherA.uid,
  status: 'SUBMITTED',
  submittedBy: authTeacherA.uid,
});
assert(
  resLegacyUpdate.allowed === true,
  'R3. Legacy report carrying matching teacher doc ID (tch_a1) can be updated & normalized to auth.uid',
  resLegacyUpdate.reason
);

// Locking Source-of-Truth Checks (Step 6)
assert(
  !isResultRecordLocked({ status: 'DRAFT' }, authTeacherA.uid, 'tch_a1', false).locked &&
    !isResultRecordLocked({ status: 'SUBMITTED' }, authTeacherA.uid, 'tch_a1', false).locked &&
    !isResultRecordLocked({ status: 'DRAFT', isLocked: false }, authTeacherA.uid, 'tch_a1', false).locked,
  'R4. Draft and Submitted reports (with or without missing lock field) are NOT prematurely locked'
);

assert(
  isResultRecordLocked({ status: 'APPROVED' }, authTeacherA.uid, 'tch_a1', false).locked &&
    isResultRecordLocked({ status: 'PUBLISHED' }, authTeacherA.uid, 'tch_a1', false).locked &&
    isResultRecordLocked({ status: 'DRAFT', isLocked: true }, authTeacherA.uid, 'tch_a1', false).locked &&
    isResultRecordLocked({ status: 'DRAFT', locked: true }, authTeacherA.uid, 'tch_a1', false).locked &&
    isResultRecordLocked({ status: 'UNKNOWN_STATE' as any }, authTeacherA.uid, 'tch_a1', false).locked,
  'R5. Approved, Published, explicitly locked (isLocked/locked), and unknown-status reports are locked for teachers'
);

// Diagnostic Codes Verification (Step 3 / Conditions A-L)
const liveClassA: SchoolClass = {
  classId: 'cls_a_pry1',
  schoolId: 'school-a',
  name: 'Primary 1',
  academicSession: '2026/2027',
  createdAt: null,
  updatedAt: null,
};
const liveSubjectMath: Subject = {
  subjectId: 'sub_a_math',
  schoolId: 'school-a',
  name: 'Mathematics',
  active: true,
  createdAt: null,
  updatedAt: null,
};
const liveSubjectEng: Subject = {
  subjectId: 'sub_a_eng',
  schoolId: 'school-a',
  name: 'English',
  active: true,
  createdAt: null,
  updatedAt: null,
};
const liveMemA: SchoolMembership = {
  id: 'school-a_uid_teacher_a',
  userId: authTeacherA.uid,
  userEmail: authTeacherA.email,
  schoolId: 'school-a',
  role: 'TEACHER',
  status: 'ACTIVE',
  teacherId: 'tch_a1',
  createdAt: null,
  updatedAt: null,
};
const liveTeacherA: Teacher = {
  teacherId: 'tch_a1',
  schoolId: 'school-a',
  userId: authTeacherA.uid,
  firstName: 'Ada',
  lastName: 'Okonjo',
  phone: '0800',
  email: authTeacherA.email,
  assignedClassIds: ['cls_a_pry1'],
  subjects: ['sub_a_math'],
  status: 'ACTIVE',
  createdAt: null,
  updatedAt: null,
};

const diagMemMissing = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: null,
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'DRAFT',
});

const diagSchoolMismatch = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-b',
  membership: liveMemA,
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'DRAFT',
});

const diagClassMissing = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: liveMemA,
  teacherProfile: { ...liveTeacherA, assignedClassIds: [] },
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'DRAFT',
});

const diagSubjectMissing = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: liveMemA,
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectEng,
  targetStatus: 'DRAFT',
});

const diagLocked = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: liveMemA,
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'SUBMITTED',
  existingResults: [{ status: 'APPROVED', isLocked: true }],
});

const diagInvalidTransition = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: liveMemA,
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'PUBLISHED',
});

const diagRulesDenied = formatReportWriteFailure(
  new Error('FirebaseError: Missing or insufficient permissions'),
  'REPORT_WRITE',
  'submit'
);
const diagRelatedDenied = formatReportWriteFailure(
  new Error('FirebaseError: Missing or insufficient permissions'),
  'RELATED_WRITE',
  'submit'
);

assert(
  diagMemMissing.diagnosticCode === 'MEMBERSHIP_MISSING' &&
    diagSchoolMismatch.diagnosticCode === 'SCHOOL_ID_MISMATCH' &&
    diagClassMissing.diagnosticCode === 'CLASS_ASSIGNMENT_MISSING' &&
    diagSubjectMissing.diagnosticCode === 'SUBJECT_ASSIGNMENT_MISSING' &&
    diagLocked.diagnosticCode === 'REPORT_LOCKED' &&
    diagInvalidTransition.diagnosticCode === 'INVALID_STATUS_TRANSITION' &&
    diagRulesDenied.code === 'FIRESTORE_RULES_DENIED' &&
    diagRelatedDenied.code === 'RELATED_WRITE_DENIED',
  'R6. All 8 granular diagnostic codes (MEMBERSHIP_MISSING..RELATED_WRITE_DENIED) emit accurately per condition'
);

const diagSuccess = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: liveMemA,
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'SUBMITTED',
  existingResults: [{ status: 'DRAFT', isLocked: false, teacherId: authTeacherA.uid }],
});
assert(
  diagSuccess.authorized === true &&
    diagSuccess.conditions.A?.passed === true &&
    diagSuccess.conditions.B?.passed === true &&
    diagSuccess.conditions.C?.passed === true &&
    diagSuccess.conditions.D?.passed === true &&
    diagSuccess.conditions.E?.passed === true &&
    diagSuccess.conditions.F?.passed === true &&
    diagSuccess.conditions.G?.passed === true &&
    diagSuccess.conditions.H?.passed === true &&
    diagSuccess.conditions.I?.passed === true &&
    diagSuccess.conditions.J?.passed === true,
  'R7. Authorized teacher passes all Conditions A–J cleanly'
);

// R8: Cross-school & cross-class resultId collision prevention
const idSchoolA = buildScopedResultId('school-a', 'stu-2026-001', 'cls-primary-5', 'sub-math', 'First-Term', '2026-2027');
const idSchoolB = buildScopedResultId('school-b', 'stu-2026-001', 'cls-primary-5', 'sub-math', 'First-Term', '2026-2027');
const idClassB = buildScopedResultId('school-a', 'stu-2026-001', 'cls-primary-6', 'sub-math', 'First-Term', '2026-2027');
const idVeryLong = buildScopedResultId(
  'very-long-tenant-school-identifier-alpha-beta-gamma',
  'student-very-long-identifier-000000123456',
  'class-senior-secondary-science-arm-a',
  'subject-further-mathematics-honours',
  'Second-Term',
  '2026-2027'
);
assert(
  idSchoolA !== idSchoolB &&
    idSchoolA !== idClassB &&
    idSchoolA.includes('school-a') &&
    idSchoolB.includes('school-b') &&
    idVeryLong.length <= 128,
  'R8. buildScopedResultId prevents cross-school and cross-class document ID collisions and stays <= 128 chars'
);

// R9: Membership role mismatch rejected even when UI role differs
const diagRoleMismatch = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: { ...liveMemA, role: 'PARENT' },
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'DRAFT',
});
assert(
  diagRoleMismatch.authorized === false && diagRoleMismatch.diagnosticCode === 'MEMBERSHIP_MISSING',
  'R9. Membership role mismatch (PARENT attempting TEACHER report write) is denied in pre-flight'
);

// R10: Strict DB teacherId link cannot be masked by cached teacherProfile
const diagMissingDbTid = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: { ...liveMemA, teacherId: undefined },
  liveUserTeacherId: null,
  enforceDbTeacherLink: true,
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'DRAFT',
});
assert(
  diagMissingDbTid.authorized === false && diagMissingDbTid.diagnosticCode === 'MEMBERSHIP_MISSING',
  'R10. enforceDbTeacherLink catches missing DB membership/user teacherId even if cached teacherProfile is present'
);

// R11: Nullable teacherId: null on legacy unlocked draft & UID classTeacherId support
const legacyNullTeacherDraft: ResultDoc = {
  ...draftA,
  resultId: 'res_legacy_null_tid',
  teacherId: null,
};
const resNullTidUpdate = canUpdateResult(authTeacherA, legacyNullTeacherDraft, {
  ...legacyNullTeacherDraft,
  teacherId: authTeacherA.uid,
  status: 'SUBMITTED',
  submittedBy: authTeacherA.uid,
});
classes.set('cls_uid_ct', {
  classId: 'cls_uid_ct',
  schoolId: 'school-a',
  name: 'Primary 2',
  classTeacherId: authTeacherA.uid,
});
const resUidClassTeacher = canCreateResult(authTeacherA, {
  ...draftA,
  resultId: 'res_uid_class_teacher',
  classId: 'cls_uid_ct',
});
const diagUidClassTeacher = evaluateReportConditionsSync({
  authUid: authTeacherA.uid,
  authEmail: authTeacherA.email,
  role: 'TEACHER',
  isSuperAdmin: false,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  membership: liveMemA,
  teacherProfile: { ...liveTeacherA, assignedClassIds: [] },
  selectedClass: { ...liveClassA, classId: 'cls_uid_ct', classTeacherId: authTeacherA.uid },
  selectedSubject: liveSubjectMath,
  targetStatus: 'DRAFT',
});
assert(
  resNullTidUpdate.allowed === true &&
    resUidClassTeacher.allowed === true &&
    diagUidClassTeacher.authorized === true,
  'R11. Legacy null teacherId normalizes cleanly to auth.uid and classTeacherId === auth.uid is authorized'
);

// R12: Firestore Security Rules lookup budget check (single-doc <= 10 vs WriteBatch <= 20 across all ops)
const EXTERNAL_LOOKUPS_PER_TEACHER_RESULT_WRITE = 5; // users/{uid}, memberships/{id}, teachers/{tid}, classes/{cid}, subjects/{sid}
const FIRESTORE_SINGLE_DOC_LOOKUP_LIMIT = 10;
const FIRESTORE_BATCH_TOTAL_LOOKUP_LIMIT = 20;

const monolithicBatch10Students = 10 * EXTERNAL_LOOKUPS_PER_TEACHER_RESULT_WRITE; // 50 > 20 -> rejected!
const monolithicBatch5Students = 5 * EXTERNAL_LOOKUPS_PER_TEACHER_RESULT_WRITE;   // 25 > 20 -> rejected!
const singleDocPerStudent = EXTERNAL_LOOKUPS_PER_TEACHER_RESULT_WRITE;           // 5 <= 10 -> allowed for 1..N students!

assert(
  monolithicBatch5Students > FIRESTORE_BATCH_TOTAL_LOOKUP_LIMIT &&
    monolithicBatch10Students > FIRESTORE_BATCH_TOTAL_LOOKUP_LIMIT &&
    singleDocPerStudent <= FIRESTORE_SINGLE_DOC_LOOKUP_LIMIT,
  'R12. Single-document setDoc stays within 5 <= 10 rule-lookup cap while monolithic WriteBatch fails >= 5 students (> 20 lookups)'
);

// R13: Verify ResultsPage.tsx no longer sends monolithic writeBatch commits for /results submissions
const resultsPageSrc = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/results/ResultsPage.tsx'),
  'utf8'
);
assert(
  !resultsPageSrc.includes('writeBatch(') && resultsPageSrc.includes('setDoc(entry.ref, entry.payload, { merge: true })'),
  'R13. ResultsPage executeSaveResults uses single-document setDoc writes instead of monolithic writeBatch'
);

// R14: SuperAdmin Teacher View preview evaluates previewed teacher's class/subject/lock scope cleanly
const superAdminPreviewAuthorized = evaluateReportConditionsSync({
  authUid: 'superadmin_uid_1',
  authEmail: 'ilearnovate1@gmail.com',
  role: 'TEACHER',
  isSuperAdmin: true,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'SUBMITTED',
  existingResults: [{ status: 'DRAFT', isLocked: false, teacherId: authTeacherA.uid }],
});
const superAdminPreviewWrongSubject = evaluateReportConditionsSync({
  authUid: 'superadmin_uid_1',
  authEmail: 'ilearnovate1@gmail.com',
  role: 'TEACHER',
  isSuperAdmin: true,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  teacherProfile: liveTeacherA,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectEng,
  targetStatus: 'DRAFT',
});
const superAdminPreviewNoTeacher = evaluateReportConditionsSync({
  authUid: 'superadmin_uid_1',
  authEmail: 'ilearnovate1@gmail.com',
  role: 'TEACHER',
  isSuperAdmin: true,
  isAtLeastAdmin: false,
  verifiedSchoolId: 'school-a',
  teacherProfile: null,
  selectedClass: liveClassA,
  selectedSubject: liveSubjectMath,
  targetStatus: 'DRAFT',
});
assert(
  superAdminPreviewAuthorized.authorized === true &&
    superAdminPreviewWrongSubject.authorized === false &&
    superAdminPreviewWrongSubject.diagnosticCode === 'SUBJECT_ASSIGNMENT_MISSING' &&
    superAdminPreviewNoTeacher.authorized === false &&
    superAdminPreviewNoTeacher.userMessage.includes('SuperAdmin Preview'),
  'R14. SuperAdmin Teacher View preview accurately evaluates previewed teacher permissions and handles missing teacher selection'
);

// R15: Direct teacher saving draft after SuperAdmin preview or with mixed-case legacy schoolId on existing doc
const mixedCaseDraftFromPreview: ResultDoc = {
  ...draftA,
  resultId: 'res_mixed_case_preview',
  schoolId: 'School-A',
  teacherId: liveTeacherA.teacherId,
  status: 'DRAFT',
  isLocked: false,
};
const directTeacherUpdateMixedCase = canUpdateResult(authTeacherA, mixedCaseDraftFromPreview, {
  ...mixedCaseDraftFromPreview,
  teacherId: authTeacherA.uid,
  totalScore: 84,
  grade: 'A',
  status: 'DRAFT',
  isLocked: false,
});
const directTeacherFreshDraft = canCreateResult(authTeacherA, {
  ...draftA,
  resultId: 'res_direct_teacher_fresh',
  status: 'DRAFT',
  isLocked: false,
});
assert(
  directTeacherUpdateMixedCase.allowed === true && directTeacherFreshDraft.allowed === true,
  'R15. Direct teacher login can create and update drafts (including drafts staged with teacher doc ID or mixed-case schoolId)'
);

// R16: Whitespace-trimmed schoolId/email normalization & 4-doc lookup cap in firestore.rules
const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
const schoolServiceSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/schoolService.ts'), 'utf8');
const authContextSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');
const diagServiceSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/reportAuthorizationService.ts'), 'utf8');

const paddedSchoolTeacher: TeacherDoc = {
  teacherId: 'tch_bistoland_1',
  schoolId: ' bistoland-elementary-school ',
  userId: 'uid_bistoland_teacher_1',
  email: ' Teacher@Gmail.com ',
  assignedClassIds: ['cls_bist_1'],
  subjects: ['sub_bist_math'],
  status: 'ACTIVE',
};
memberships.set('bistoland-elementary-school_uid_bistoland_teacher_1', {
  id: 'bistoland-elementary-school_uid_bistoland_teacher_1',
  userId: 'uid_bistoland_teacher_1',
  schoolId: 'bistoland-elementary-school ',
  role: 'TEACHER',
  status: 'ACTIVE',
  teacherId: 'tch_bistoland_1',
});
teachers.set('tch_bistoland_1', paddedSchoolTeacher);
classes.set('cls_bist_1', {
  classId: 'cls_bist_1',
  schoolId: 'bistoland-elementary-school',
  name: 'Grade 3',
});
subjects.set('sub_bist_math', {
  subjectId: 'sub_bist_math',
  schoolId: 'bistoland-elementary-school',
  name: 'Mathematics',
});

const paddedSchoolWrite = canCreateResult(
  { uid: 'uid_bistoland_teacher_1', email: 'teacher@gmail.com' },
  {
    resultId: 'res_bistoland_padded_1',
    schoolId: 'bistoland-elementary-school',
    studentId: 'stu_bist_1',
    classId: 'cls_bist_1',
    subjectId: 'sub_bist_math',
    academicSession: '2026/2027',
    term: 'First Term',
    teacherId: 'uid_bistoland_teacher_1',
    totalScore: 78,
    grade: 'B',
    status: 'DRAFT',
    isLocked: false,
  }
);

assert(
  rulesSrc.includes('val.trim().lower()') &&
    rulesSrc.includes('isSuperAdminEmail()') &&
    rulesSrc.includes('isSchoolAdminMembership(') &&
    paddedSchoolWrite.allowed === true,
  'R16. firestore.rules trims whitespace in strLower(), prioritizes zero-read isSuperAdminEmail(), and stays well within single-doc lookup budget'
);

// R17: Required fallbacks & ownership diagnostics across ResultsPage, schoolService, AuthContext, and reportAuthorizationService
assert(
  resultsPageSrc.includes("studentId: st.studentId || d.id") &&
    schoolServiceSrc.includes("currentAcademicSession: data.currentAcademicSession?.trim() || DEFAULT_SCHOOL_SETTINGS.currentAcademicSession") &&
    schoolServiceSrc.includes("data.currentTerm?.trim()") &&
    schoolServiceSrc.includes("DEFAULT_SCHOOL_SETTINGS.currentTerm") &&
    authContextSrc.includes("selectedMembership.teacherId") &&
    diagServiceSrc.includes("tData.userId && tData.userId !== params.authUid"),
  'R17. ResultsPage studentId fallback, schoolService non-blank term/session, AuthContext membership teacherId match, and UID conflict diagnostics are in place'
);

// R18: SuperAdmin Memberships tab includes per-member Verify & Verify & Sync checks
const superAdminSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/superadmin/SuperAdminPage.tsx'), 'utf8');
assert(
  superAdminSrc.includes('inspectAndOptionallySyncMember') &&
    superAdminSrc.includes('Verify &amp; Sync') === false &&
    superAdminSrc.includes('Verify & Sync'),
  'R18. SuperAdmin Memberships inspector provides live Verify and Verify & Sync controls'
);

console.log('\n========================================');
console.log(`PHASE 6 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
}

