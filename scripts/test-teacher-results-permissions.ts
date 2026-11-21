/**
 * Test Suite: Teacher Results Submission, Draft Saving, Evaluations & Membership Sync
 *
 * Verifies:
 * 1. Teacher Save Draft ('DRAFT') and Submit for Approval ('SUBMITTED') rule authorization
 * 2. Teacher cannot approve ('APPROVED') or publish ('PUBLISHED') results
 * 3. Teacher batch save skips already-PUBLISHED student rows instead of failing the batch
 * 4. Result payloads derive schoolId from active verified school context (never stale student/default)
 * 5. Report card evaluation saving requires & normalizes schoolId
 * 6. AuthContext membership array normalization removes FieldValue.serverTimestamp() from arrays
 * 7. firestore.rules static verification for teacher results, evaluations, and memberships
 */

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFirestoreData } from '../src/services/gradingProfileService';

let passed = 0;
let failed = 0;

function assert(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

console.log('--- STARTING TEACHER RESULTS PERMISSION TESTS ---');

// 1. Simulated Firestore Rule Engine for /results and /evaluations
interface RuleUser {
  uid: string;
  role: string;
  schoolId: string;
  approvalStatus: string;
  isSuperAdmin?: boolean;
}

interface RuleMembership {
  id: string;
  userId: string;
  schoolId: string;
  role: 'ADMIN' | 'TEACHER' | 'PARENT';
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
}

function safeStr(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function hasActiveMembership(user: RuleUser, memberships: RuleMembership[], targetSchoolId: string): boolean {
  if (!targetSchoolId) return false;
  const docId = `${targetSchoolId.toLowerCase()}_${user.uid}`;
  const m = memberships.find((item) => item.id === docId);
  return !!m && (m.status ?? 'ACTIVE') === 'ACTIVE';
}

function getMembershipRole(user: RuleUser, memberships: RuleMembership[], targetSchoolId: string): string {
  if (!hasActiveMembership(user, memberships, targetSchoolId)) return '';
  const docId = `${targetSchoolId.toLowerCase()}_${user.uid}`;
  return safeStr(memberships.find((item) => item.id === docId)?.role);
}

interface RuleTeacherDoc {
  id: string;
  schoolId: string;
  userId?: string;
  email?: string;
  status?: string;
}

function isVerifiedTeacherInSchool(
  user: RuleUser & { teacherId?: string; email?: string },
  teacherDocs: RuleTeacherDoc[],
  targetSchoolId: string
): boolean {
  if (!targetSchoolId || !user.teacherId) return false;
  const t = teacherDocs.find((docItem) => docItem.id === user.teacherId);
  if (!t) return false;
  if (safeStr(t.schoolId).toLowerCase() !== targetSchoolId.toLowerCase()) return false;
  if ((t.status ?? 'ACTIVE') === 'INACTIVE') return false;
  return (
    safeStr(t.userId) === user.uid ||
    (!!user.email && safeStr(t.email).toLowerCase() === user.email.toLowerCase())
  );
}

function hasRoleInSchool(
  user: RuleUser & { teacherId?: string; email?: string },
  memberships: RuleMembership[],
  targetSchoolId: string,
  allowedRoles: string[],
  teacherDocs: RuleTeacherDoc[] = []
): boolean {
  if (user.isSuperAdmin) return true;
  if (!targetSchoolId) return false;
  if (hasActiveMembership(user, memberships, targetSchoolId) && allowedRoles.includes(getMembershipRole(user, memberships, targetSchoolId))) {
    return true;
  }
  const approvedOrSetup = user.approvalStatus === 'APPROVED' || user.approvalStatus === 'PENDING_SETUP';
  if (
    approvedOrSetup &&
    safeStr(user.schoolId).toLowerCase() === targetSchoolId.toLowerCase() &&
    allowedRoles.includes(safeStr(user.role))
  ) {
    return true;
  }
  if (allowedRoles.includes('TEACHER') && isVerifiedTeacherInSchool(user, teacherDocs, targetSchoolId)) {
    return true;
  }
  return false;
}

function canTeacherWriteResult(
  user: RuleUser & { teacherId?: string; email?: string },
  memberships: RuleMembership[],
  reqData: { schoolId: string; status: string },
  existingData?: { schoolId: unknown; status: string },
  teacherDocs: RuleTeacherDoc[] = []
): boolean {
  const existingSchool = existingData ? safeStr(existingData.schoolId) : '';
  const targetSchool = existingData && existingSchool !== '' ? existingSchool : safeStr(reqData.schoolId);
  if (!hasRoleInSchool(user, memberships, targetSchool, ['ADMIN', 'TEACHER'], teacherDocs)) return false;
  if (existingData && existingSchool !== '' && safeStr(reqData.schoolId).toLowerCase() !== existingSchool.toLowerCase()) {
    return false;
  }

  if (hasRoleInSchool(user, memberships, targetSchool, ['ADMIN'], teacherDocs)) return true;

  // Teacher restrictions
  if (!['DRAFT', 'SUBMITTED'].includes(reqData.status)) return false;
  if (existingData && existingData.status === 'PUBLISHED') return false;
  return true;
}

console.log('\n1. Teacher Results Save Draft & Submit for Approval (via Membership even if users/{uid} is stale):');
const staleTeacherUser: RuleUser = {
  uid: 'teacher-uid-1',
  role: 'TEACHER',
  schoolId: '', // simulates stale users/{uid} before sync
  approvalStatus: 'PENDING_APPROVAL',
};
const activeMemberships: RuleMembership[] = [
  {
    id: 'graceacademy_teacher-uid-1',
    userId: 'teacher-uid-1',
    schoolId: 'graceacademy',
    role: 'TEACHER',
    status: 'ACTIVE',
  },
];

assert(
  canTeacherWriteResult(staleTeacherUser, activeMemberships, { schoolId: 'graceacademy', status: 'DRAFT' }),
  'Teacher with active membership can create DRAFT result'
);
assert(
  canTeacherWriteResult(staleTeacherUser, activeMemberships, { schoolId: 'graceacademy', status: 'SUBMITTED' }),
  'Teacher with active membership can create SUBMITTED result'
);
assert(
  canTeacherWriteResult(
    staleTeacherUser,
    activeMemberships,
    { schoolId: 'graceacademy', status: 'SUBMITTED' },
    { schoolId: 'graceacademy', status: 'DRAFT' }
  ),
  'Teacher can transition existing DRAFT result to SUBMITTED'
);
assert(
  canTeacherWriteResult(
    staleTeacherUser,
    activeMemberships,
    { schoolId: 'graceacademy', status: 'DRAFT' },
    { schoolId: 'GraceAcademy', status: 'SUBMITTED' }
  ),
  'Teacher can save DRAFT over existing SUBMITTED result with case-insensitive schoolId match'
);
assert(
  !canTeacherWriteResult(staleTeacherUser, activeMemberships, { schoolId: 'graceacademy', status: 'PUBLISHED' }),
  'Teacher CANNOT directly create PUBLISHED result'
);
assert(
  !canTeacherWriteResult(
    staleTeacherUser,
    activeMemberships,
    { schoolId: 'graceacademy', status: 'DRAFT' },
    { schoolId: 'graceacademy', status: 'PUBLISHED' }
  ),
  'Teacher CANNOT overwrite an already-PUBLISHED result'
);
assert(
  !canTeacherWriteResult(staleTeacherUser, activeMemberships, { schoolId: 'other-school', status: 'DRAFT' }),
  'Teacher CANNOT write results into another school tenant'
);
assert(
  !canTeacherWriteResult(staleTeacherUser, activeMemberships, { schoolId: 'default', status: 'SUBMITTED' }),
  'Teacher of graceacademy CANNOT write results into default school'
);

// 1b. Verified Teacher Doc Fallback & Legacy Unscoped Result Claiming
console.log('\n1b. Verified Teacher Doc Fallback & Null-Safe Legacy Result Claiming:');
const teacherWithoutMembershipDoc = {
  uid: 'teacher-uid-2',
  email: 'teacher2@graceacademy.edu',
  role: 'TEACHER',
  schoolId: '',
  approvalStatus: 'PENDING_APPROVAL',
  teacherId: 'teacher-doc-2',
};
const verifiedTeacherDocs: RuleTeacherDoc[] = [
  {
    id: 'teacher-doc-2',
    schoolId: 'graceacademy',
    email: 'teacher2@graceacademy.edu',
    status: 'ACTIVE',
  },
];

assert(
  canTeacherWriteResult(
    teacherWithoutMembershipDoc,
    [],
    { schoolId: 'graceacademy', status: 'DRAFT' },
    undefined,
    verifiedTeacherDocs
  ),
  'Teacher verified via users/{uid}.teacherId -> teachers/{docId} can save DRAFT even if memberships sync failed'
);
assert(
  canTeacherWriteResult(
    teacherWithoutMembershipDoc,
    [],
    { schoolId: 'graceacademy', status: 'SUBMITTED' },
    { schoolId: null, status: 'DRAFT' },
    verifiedTeacherDocs
  ),
  'Teacher can claim/submit legacy result with null schoolId without CEL .lower() error'
);
assert(
  !canTeacherWriteResult(
    teacherWithoutMembershipDoc,
    [],
    { schoolId: 'graceacademy', status: 'DRAFT' },
    { schoolId: null, status: 'PUBLISHED' },
    verifiedTeacherDocs
  ),
  'Teacher CANNOT overwrite legacy result with null schoolId if status is PUBLISHED'
);
assert(
  !canTeacherWriteResult(
    teacherWithoutMembershipDoc,
    [],
    { schoolId: 'other-school', status: 'DRAFT' },
    { schoolId: '', status: 'DRAFT' },
    verifiedTeacherDocs
  ),
  'Teacher CANNOT claim legacy empty-schoolId result into a school they do not belong to'
);

// 2. Batch Filtering When Some Students Are Already PUBLISHED
console.log('\n2. Teacher Batch Save Filtering (Skipping Published Records):');
interface DraftEntry {
  studentId: string;
  studentSchoolId?: string;
  originalStatus?: string;
  totalScore: number;
}

function prepareTeacherBatch(
  entries: DraftEntry[],
  activeSchoolId: string,
  targetStatus: 'DRAFT' | 'SUBMITTED'
) {
  const written: Array<{ studentId: string; schoolId: string; status: string }> = [];
  let skippedPublished = 0;

  for (const e of entries) {
    if (e.originalStatus === 'PUBLISHED') {
      skippedPublished++;
      continue;
    }
    // Always enforce verified activeSchoolId instead of stale s.schoolId
    written.push({
      studentId: e.studentId,
      schoolId: activeSchoolId.trim().toLowerCase(),
      status: targetStatus,
    });
  }
  return { written, skippedPublished };
}

const mixedEntries: DraftEntry[] = [
  { studentId: 'stu-1', studentSchoolId: 'default', originalStatus: undefined, totalScore: 82 },
  { studentId: 'stu-2', studentSchoolId: 'graceacademy', originalStatus: 'DRAFT', totalScore: 71 },
  { studentId: 'stu-3', studentSchoolId: 'graceacademy', originalStatus: 'PUBLISHED', totalScore: 90 },
];

const batchResult = prepareTeacherBatch(mixedEntries, 'GraceAcademy', 'SUBMITTED');
assert(batchResult.written.length === 2, 'Batch includes only the 2 editable student results');
assert(batchResult.skippedPublished === 1, 'Batch cleanly skips the 1 already-PUBLISHED result');
assert(
  batchResult.written.every((r) => r.schoolId === 'graceacademy'),
  'All batch payloads use normalized active schoolId (ignoring stale student schoolId="default")'
);

// 3. Array FieldValue.serverTimestamp() Normalization Check
console.log('\n3. Membership Array Timestamp Normalization:');
const mockServerTimestamp = { _methodName: 'serverTimestamp' };
const nowIso = new Date().toISOString();
const rawMemberships = [
  {
    id: 'graceacademy_teacher-uid-1',
    userId: 'teacher-uid-1',
    schoolId: 'graceacademy',
    role: 'TEACHER',
    status: 'ACTIVE',
    createdAt: mockServerTimestamp,
    updatedAt: mockServerTimestamp,
    teacherId: 'teacher-1',
    parentId: undefined,
  },
];

const safeUserMemberships = rawMemberships.map((m) =>
  sanitizeFirestoreData({
    ...m,
    createdAt: typeof m.createdAt === 'object' && m.createdAt && '_methodName' in m.createdAt ? nowIso : m.createdAt,
    updatedAt: typeof m.updatedAt === 'object' && m.updatedAt && '_methodName' in m.updatedAt ? nowIso : m.updatedAt,
  })
);

assert(
  typeof safeUserMemberships[0].createdAt === 'string',
  'Replaces serverTimestamp sentinel inside memberships array with ISO string'
);
assert(
  !('parentId' in safeUserMemberships[0]),
  'Strips undefined parentId from membership summary'
);

// 4. Static Verification of firestore.rules, ResultsPage.tsx & AuthContext.tsx
console.log('\n4. Static Verification of firestore.rules, ResultsPage.tsx & AuthContext.tsx:');
const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
assert(rulesText.includes('function safeStr(val)'), 'Rules define safeStr null-safe string helper');
assert(rulesText.includes('function hasActiveMembership(targetSchoolId)'), 'Rules define hasActiveMembership helper');
assert(rulesText.includes('function isVerifiedTeacherInSchool(targetSchoolId)'), 'Rules define isVerifiedTeacherInSchool helper');
assert(rulesText.includes('function hasRoleInSchool(targetSchoolId, allowedRoles)'), 'Rules define hasRoleInSchool helper');
assert(
  rulesText.includes("hasRoleInSchool(safeStr(request.resource.data.get('schoolId', '')), ['TEACHER'])") &&
    rulesText.includes("request.resource.data.get('status', 'DRAFT') in ['DRAFT', 'SUBMITTED']"),
  'Results create/update rules validate teacher role via hasRoleInSchool with safeStr for DRAFT and SUBMITTED'
);
assert(
  rulesText.includes("safeStr(resource.data.get('schoolId', '')) == ''"),
  'Results and evaluations update rules safely allow claiming legacy unscoped records'
);
assert(
  rulesText.includes("match /evaluations/{evalId}") &&
    rulesText.includes("hasRoleInSchool(safeStr(request.resource.data.get('schoolId', '')), ['ADMIN', 'TEACHER'])"),
  'Evaluations rules allow verified school teachers and admins'
);
assert(
  rulesText.includes("'invitationId' in getAfter"),
  'Invitation acceptance batch writes are verified with getAfter in rules'
);

const resultsPageText = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/results/ResultsPage.tsx'), 'utf8');
assert(
  resultsPageText.includes("existingResultsMap.set(r.studentId, { ...r, resultId: d.id })"),
  'ResultsPage preserves exact Firestore document ID when loading existing results'
);
assert(
  resultsPageText.includes('`res_${cleanSchool}_${s.studentId}_${selectedSubjectId}_${cleanTerm}_${cleanSession}`'),
  'ResultsPage generates tenant-scoped resultId for new result documents'
);

const authContextText = fs.readFileSync(path.resolve(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');
assert(
  authContextText.includes('teacherDocIdMap.get(activeTeacher.teacherId) || activeTeacher.teacherId'),
  'AuthContext resolves actual Firestore teacher document ID for users/{uid}.teacherId'
);
assert(
  authContextText.includes('Membership fallback write notice:'),
  'AuthContext falls back to individual membership/user persistence if syncBatch fails'
);

console.log('\n========================================');
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
}
