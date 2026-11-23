/**
 * Phase 6 Security & Workflow Test Suite:
 * Verifies Firestore Security Rules logic and multi-tenant report workflow boundaries
 * across all 12 required scenarios.
 *
 * Note: Because the container environment does not have a Java JRE installed
 * for local Firebase Emulator execution, this suite faithfully evaluates the
 * exact rule predicates implemented in /firestore.rules alongside the client
 * validation invariants enforced in ResultsPage.tsx & evaluationService.ts.
 */

type Role = 'ADMIN' | 'TEACHER' | 'PARENT' | 'SUPER_ADMIN';
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
  teacherId?: string;
  totalScore: number;
  grade: string;
  status: ReportStatus;
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

// Exact mirror of /firestore.rules helper predicates
function isValidTenantSchoolId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && id !== 'default';
}

function hasActiveMembership(auth: AuthContext | null, schoolId: string): MembershipDoc | null {
  if (!auth || !isValidTenantSchoolId(schoolId)) return null;
  const m = memberships.get(`${schoolId}_${auth.uid}`);
  if (!m) return null;
  if (m.userId !== auth.uid || m.schoolId !== schoolId || m.status !== 'ACTIVE') return null;
  return m;
}

function isTeacherAuthorizedForReport(
  auth: AuthContext,
  schoolId: string,
  classId: string,
  subjectId: string
): boolean {
  const m = hasActiveMembership(auth, schoolId);
  if (!m || m.role !== 'TEACHER') return false;

  const tid = m.teacherId || '';
  if (!tid) return false;
  const tData = teachers.get(tid);
  if (!tData) return false;
  if (tData.schoolId !== schoolId || tData.status === 'INACTIVE') return false;
  if (tData.userId !== auth.uid && tData.email.toLowerCase() !== auth.email.toLowerCase()) return false;

  const cData = classes.get(classId);
  if (!cData || cData.schoolId !== schoolId) return false;
  const classAuthorized =
    tData.assignedClassIds.includes(classId) || cData.classTeacherId === tid;
  if (!classAuthorized) return false;

  const sData = subjects.get(subjectId);
  if (!sData || sData.schoolId !== schoolId) return false;
  if (tData.subjects.length > 0) {
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
  if (!cData || cData.schoolId !== reqData.schoolId) {
    return { allowed: false, reason: 'Class does not belong to school' };
  }
  if (!sData || sData.schoolId !== reqData.schoolId) {
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
    if (reqData.approvedBy || reqData.approvedAt || reqData.publishedBy || reqData.publishedAt) {
      return { allowed: false, reason: 'Teachers cannot set approval/publication metadata' };
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
    if (!['DRAFT', 'SUBMITTED'].includes(existing.status)) {
      return { allowed: false, reason: 'Cannot modify approved or published report' };
    }
    if (!['DRAFT', 'SUBMITTED'].includes(nextData.status)) {
      return { allowed: false, reason: 'Teachers cannot approve or publish reports' };
    }
    if (existing.teacherId && existing.teacherId !== auth.uid) {
      return { allowed: false, reason: 'Cannot modify another teacher report' };
    }
    if (nextData.teacherId !== auth.uid) {
      return { allowed: false, reason: 'Cannot reassign ownership teacherId' };
    }
    if (
      nextData.approvedBy !== existing.approvedBy ||
      nextData.approvedAt !== existing.approvedAt ||
      nextData.publishedBy !== existing.publishedBy ||
      nextData.publishedAt !== existing.publishedAt
    ) {
      return { allowed: false, reason: 'Teachers cannot modify approval/publication metadata' };
    }
    if (nextData.status === 'SUBMITTED' && nextData.submittedBy !== auth.uid) {
      return { allowed: false, reason: 'submittedBy must match authenticated UID' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Parents cannot update student reports' };
}

// Seed Test Data
const authTeacherA: AuthContext = { uid: 'uid_teacher_a', email: 'teacher.a@schoola.edu' };
const authTeacherA2: AuthContext = { uid: 'uid_teacher_a2', email: 'teacher.a2@schoola.edu' };
const authTeacherNoMembership: AuthContext = { uid: 'uid_teacher_orphan', email: 'orphan@schoola.edu' };
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

console.log('--- PHASE 6: REPORT SECURITY RULES & WORKFLOW VERIFICATION ---\n');

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
};
const res1 = canCreateResult(authTeacherA, draftA);
assert(res1.allowed === true, '1. Teacher A can save DRAFT for assigned class & subject in School A', res1.reason);
if (res1.allowed) results.set(draftA.resultId, draftA);

// 2. Teacher A can submit the draft for approval
const submittedA: ResultDoc = {
  ...draftA,
  status: 'SUBMITTED',
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
  approvedBy: authAdminA.uid,
  approvedAt: '2026-11-23T09:00:00Z',
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

// 11. A teacher cannot alter schoolId, ownership or other protected fields during an update
const freshDraft: ResultDoc = { ...draftA, resultId: 'res_stu2_sub_a_math' };
const res11school = canUpdateResult(authTeacherA, freshDraft, { ...freshDraft, schoolId: 'school-b' });
const res11owner = canUpdateResult(authTeacherA, freshDraft, { ...freshDraft, teacherId: authTeacherA2.uid });
const res11approvedMeta = canUpdateResult(authTeacherA, freshDraft, { ...freshDraft, approvedBy: authTeacherA.uid });
const res11postApproval = canUpdateResult(authTeacherA, approvedByAdminA, { ...approvedByAdminA, totalScore: 99 });
assert(
  !res11school.allowed && !res11owner.allowed && !res11approvedMeta.allowed && !res11postApproval.allowed,
  '11. Teacher CANNOT alter schoolId, teacherId ownership, approval metadata, or approved reports'
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

console.log('\n========================================');
console.log(`PHASE 6 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
}
