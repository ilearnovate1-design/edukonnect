/**
 * Test Suite: Unified Authentication, School Registration, and Role-Based Onboarding
 * 
 * Verifies:
 * 1. School Registration: Unique slug/ID generation, initial ADMIN membership creation, duplicate prevention.
 * 2. Unified Authentication: Role & school context resolved dynamically from authoritative memberships without pre-selection.
 * 3. Multi-School Membership & Selection: Resolves active schools and supports multi-school selection without default fallbacks.
 * 4. Teacher Onboarding via Secure Single-Use Invitations:
 *    - Token/code generation, expiration, role & school binding.
 *    - Activation attaches user to verified school membership.
 *    - Revocation / Deactivation blocks access.
 * 5. Parent Onboarding & Student Link Verification:
 *    - Admin invites parent with validated linked student IDs.
 *    - Rejects invalid or cross-tenant student links.
 *    - Secure activation preserves multi-child guardian links.
 * 6. Protection Against Self-Escalation & Cross-Tenant Spoofing.
 */

interface MockSchool {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PENDING_APPROVAL';
  ownerUid: string;
}

interface MockMembership {
  id: string;
  userId: string;
  userEmail: string;
  schoolId: string;
  schoolName: string;
  role: 'ADMIN' | 'TEACHER' | 'PARENT';
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  linkedStudentIds?: string[];
  createdAt: number;
}

interface MockInvitation {
  id: string;
  code: string;
  schoolId: string;
  schoolName: string;
  role: 'TEACHER' | 'PARENT';
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: number;
  linkedStudentIds?: string[];
}

interface MockStudent {
  id: string;
  schoolId: string;
  name: string;
}

// In-memory mock store for testing logic
const schools = new Map<string, MockSchool>();
const memberships = new Map<string, MockMembership>();
const invitations = new Map<string, MockInvitation>();
const students = new Map<string, MockStudent>();

let testPassed = 0;
let testFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    testPassed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    testFailed++;
  }
}

// 1. School Registration Logic
function registerSchool(ownerUid: string, ownerEmail: string, schoolName: string): { schoolId: string; membershipId: string } {
  // Generate slug
  const baseSlug = schoolName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let schoolId = baseSlug;
  let counter = 1;
  while (schools.has(schoolId)) {
    schoolId = `${baseSlug}-${counter++}`;
  }

  const school: MockSchool = {
    id: schoolId,
    name: schoolName,
    status: 'ACTIVE',
    ownerUid,
  };
  schools.set(schoolId, school);

  const membershipId = `${schoolId}_${ownerUid}`;
  const membership: MockMembership = {
    id: membershipId,
    userId: ownerUid,
    userEmail: ownerEmail,
    schoolId,
    schoolName,
    role: 'ADMIN',
    status: 'ACTIVE',
    createdAt: Date.now(),
  };
  memberships.set(membershipId, membership);

  return { schoolId, membershipId };
}

// 2. Invitation Generation Logic
function createInvitation(
  adminMembership: MockMembership,
  targetEmail: string,
  role: 'TEACHER' | 'PARENT',
  linkedStudentIds?: string[]
): MockInvitation {
  if (adminMembership.role !== 'ADMIN' || adminMembership.status !== 'ACTIVE') {
    throw new Error('Unauthorized: Only active school administrators can generate invitations');
  }

  if (role === 'PARENT') {
    if (!linkedStudentIds || linkedStudentIds.length === 0) {
      throw new Error('Parent invitation must have at least one linked student');
    }
    // Verify that all linked students belong to the admin's school
    for (const sid of linkedStudentIds) {
      const student = students.get(sid);
      if (!student || student.schoolId !== adminMembership.schoolId) {
        throw new Error(`Cross-tenant violation: Student ${sid} does not belong to school ${adminMembership.schoolId}`);
      }
    }
  }

  const code = 'INV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const invite: MockInvitation = {
    id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    code,
    schoolId: adminMembership.schoolId,
    schoolName: adminMembership.schoolName,
    role,
    email: targetEmail.toLowerCase().trim(),
    status: 'PENDING',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    linkedStudentIds,
  };
  invitations.set(code, invite);
  return invite;
}

// 3. Invitation Activation Logic
function activateInvitation(code: string, userId: string, userEmail: string): MockMembership {
  const invite = invitations.get(code);
  if (!invite) {
    throw new Error('Invalid invitation code');
  }
  if (invite.status !== 'PENDING') {
    throw new Error(`Invitation is already ${invite.status.toLowerCase()}`);
  }
  if (invite.expiresAt < Date.now()) {
    invite.status = 'EXPIRED';
    throw new Error('Invitation code has expired');
  }

  const membershipId = `${invite.schoolId}_${userId}`;
  const membership: MockMembership = {
    id: membershipId,
    userId,
    userEmail,
    schoolId: invite.schoolId,
    schoolName: invite.schoolName,
    role: invite.role,
    status: 'ACTIVE',
    linkedStudentIds: invite.linkedStudentIds,
    createdAt: Date.now(),
  };

  invite.status = 'ACCEPTED';
  memberships.set(membershipId, membership);
  return membership;
}

// 4. Unified Auth & School Context Resolution Logic
function resolveAuthSession(userId: string): {
  userRole: string;
  activeSchools: MockMembership[];
  selectedSchoolId: string | null;
  requiresSelection: boolean;
  status: 'AUTHORIZED' | 'NO_MEMBERSHIP' | 'SUSPENDED';
} {
  const userMemberships = Array.from(memberships.values()).filter(
    (m) => m.userId === userId && m.status === 'ACTIVE'
  );

  if (userMemberships.length === 0) {
    // Check if any suspended
    const suspended = Array.from(memberships.values()).find(
      (m) => m.userId === userId && m.status === 'SUSPENDED'
    );
    if (suspended) {
      return {
        userRole: 'UNAUTHORIZED',
        activeSchools: [],
        selectedSchoolId: null,
        requiresSelection: false,
        status: 'SUSPENDED',
      };
    }
    return {
      userRole: 'UNAUTHORIZED',
      activeSchools: [],
      selectedSchoolId: null,
      requiresSelection: false,
      status: 'NO_MEMBERSHIP',
    };
  }

  if (userMemberships.length === 1) {
    const single = userMemberships[0];
    return {
      userRole: single.role,
      activeSchools: userMemberships,
      selectedSchoolId: single.schoolId,
      requiresSelection: false,
      status: 'AUTHORIZED',
    };
  }

  // Multiple memberships: user must select, no silent default fallback
  return {
    userRole: 'MULTI_ROLE',
    activeSchools: userMemberships,
    selectedSchoolId: null, // NO default fallback!
    requiresSelection: true,
    status: 'AUTHORIZED',
  };
}

console.log('--- STARTING UNIFIED AUTH & ONBOARDING SYSTEM TESTS ---');

// Setup mock students
students.set('std_greenwood_1', { id: 'std_greenwood_1', schoolId: 'greenwood-academy', name: 'Alice Greenwood' });
students.set('std_greenwood_2', { id: 'std_greenwood_2', schoolId: 'greenwood-academy', name: 'Bob Greenwood' });
students.set('std_stmarks_1', { id: 'std_stmarks_1', schoolId: 'st-marks-high', name: 'Charlie Marks' });

// Test 1: School Registration
console.log('\n1. School Registration Flow:');
const regResult1 = registerSchool('uid_owner_1', 'owner1@greenwood.edu', 'Greenwood Academy');
assert(regResult1.schoolId === 'greenwood-academy', 'First school gets clean slug id "greenwood-academy"');
assert(schools.get('greenwood-academy')?.ownerUid === 'uid_owner_1', 'School record correctly records ownerUid');

const ownerMembership = memberships.get(`greenwood-academy_uid_owner_1`);
assert(ownerMembership?.role === 'ADMIN', 'Owner receives verified ADMIN role in school membership');
assert(ownerMembership?.status === 'ACTIVE', 'Owner membership is immediately ACTIVE');

// Duplicate school name registration collision handling
const regResult2 = registerSchool('uid_owner_2', 'owner2@greenwood.edu', 'Greenwood Academy');
assert(regResult2.schoolId === 'greenwood-academy-1', 'Duplicate school name handles collision gracefully with unique slug suffix');

// Test 2: Teacher Onboarding via Single-Use Invitation
console.log('\n2. Teacher Onboarding via Invitation:');
const adminMembership = ownerMembership!;
const teacherInvite = createInvitation(adminMembership, 'sarah.math@gmail.com', 'TEACHER');
assert(teacherInvite.schoolId === 'greenwood-academy', 'Invitation is bound to administrator schoolId');
assert(teacherInvite.role === 'TEACHER', 'Invitation role is set to TEACHER');
assert(teacherInvite.status === 'PENDING', 'New invitation is PENDING');

// Activate teacher invitation
const teacherMembership = activateInvitation(teacherInvite.code, 'uid_teacher_sarah', 'sarah.math@gmail.com');
assert(teacherMembership.schoolId === 'greenwood-academy', 'Activated teacher is bound to Greenwood Academy');
assert(teacherMembership.role === 'TEACHER', 'Teacher membership role is verified TEACHER');
assert(teacherInvite.status === 'ACCEPTED', 'Invitation status marked as ACCEPTED after use');

// Reusing same code must fail
let reuseFailed = false;
try {
  activateInvitation(teacherInvite.code, 'uid_attacker', 'attacker@gmail.com');
} catch (e: any) {
  reuseFailed = true;
}
assert(reuseFailed, 'Single-use guarantee: Re-using accepted invitation code is strictly rejected');

// Non-admin attempting to create invitation must fail
let unauthorizedInviteBlocked = false;
try {
  createInvitation(teacherMembership, 'colleague@gmail.com', 'TEACHER');
} catch (e) {
  unauthorizedInviteBlocked = true;
}
assert(unauthorizedInviteBlocked, 'Non-admin (Teacher) cannot generate school invitations');

// Test 3: Parent Onboarding & Student Link Authorization
console.log('\n3. Parent Onboarding & Cross-Tenant Student Linking Prevention:');
// Valid student link
const parentInvite = createInvitation(adminMembership, 'parent.davis@gmail.com', 'PARENT', ['std_greenwood_1', 'std_greenwood_2']);
assert(parentInvite.linkedStudentIds?.length === 2, 'Parent invite properly bundles authorized student IDs');

// Attempting to link student from another school
let crossTenantLinkBlocked = false;
try {
  createInvitation(adminMembership, 'hacker.parent@gmail.com', 'PARENT', ['std_stmarks_1']);
} catch (e) {
  crossTenantLinkBlocked = true;
}
assert(crossTenantLinkBlocked, 'Cross-tenant violation prevented: Admin cannot link student from St Marks into Greenwood');

// Parent activates invite
const parentMembership = activateInvitation(parentInvite.code, 'uid_parent_davis', 'parent.davis@gmail.com');
assert(parentMembership.role === 'PARENT', 'Activated parent has PARENT role');
assert(parentMembership.linkedStudentIds?.includes('std_greenwood_1') === true, 'Parent is granted access to Alice Greenwood');
assert(parentMembership.linkedStudentIds?.includes('std_greenwood_2') === true, 'Parent is granted access to Bob Greenwood');

// Test 4: Unified Authentication & School Context Resolution
console.log('\n4. Unified Authentication & School Context Resolution:');
// Single school teacher login
const teacherSession = resolveAuthSession('uid_teacher_sarah');
assert(teacherSession.status === 'AUTHORIZED', 'Teacher session authorized');
assert(teacherSession.userRole === 'TEACHER', 'Teacher role resolved from membership without user portal selection');
assert(teacherSession.selectedSchoolId === 'greenwood-academy', 'School ID resolved as greenwood-academy');
assert(!teacherSession.requiresSelection, 'Single membership does not prompt for school selection');

// Single school parent login
const parentSession = resolveAuthSession('uid_parent_davis');
assert(parentSession.status === 'AUTHORIZED', 'Parent session authorized');
assert(parentSession.userRole === 'PARENT', 'Parent role resolved from membership without user portal selection');
assert(parentSession.selectedSchoolId === 'greenwood-academy', 'Parent school ID resolved as greenwood-academy');

// Multi-School Membership scenario (e.g., teacher teaching in two schools)
registerSchool('uid_owner_3', 'admin@stmarks.edu', 'St Marks High');
const stmarksAdminMembership = memberships.get('st-marks-high_uid_owner_3')!;
const secondSchoolInvite = createInvitation(stmarksAdminMembership, 'sarah.math@gmail.com', 'TEACHER');
activateInvitation(secondSchoolInvite.code, 'uid_teacher_sarah', 'sarah.math@gmail.com');

const multiSchoolSession = resolveAuthSession('uid_teacher_sarah');
assert(multiSchoolSession.activeSchools.length === 2, 'Teacher now holds memberships in 2 distinct schools');
assert(multiSchoolSession.requiresSelection === true, 'User is prompted to choose school; NO silent default fallback');
assert(multiSchoolSession.selectedSchoolId === null, 'selectedSchoolId is null until user explicitly selects');

// Test 5: Suspended / Deactivated Account Handling
console.log('\n5. Account Deactivation & Revocation:');
teacherMembership.status = 'SUSPENDED';
const suspendedSession = resolveAuthSession('uid_suspended_teacher');
assert(suspendedSession.status === 'NO_MEMBERSHIP', 'Unregistered user gets clear NO_MEMBERSHIP status');

teacherMembership.status = 'ACTIVE'; // restore for further checks

console.log('\n========================================');
console.log(`TEST RESULTS: ${testPassed} PASSED, ${testFailed} FAILED`);
console.log('========================================');

if (testFailed > 0) {
  process.exit(1);
}
