import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { AccountInvitation, SchoolMembership, AppUser, Teacher, Parent, Student } from '../types';

/**
 * Generate a secure, unique, human-friendly invitation code.
 * Format: INV-XXXX-XXXX (uppercase alphanumeric)
 */
export function generateInvitationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing 0/O, 1/I
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `INV-${part1}-${part2}`;
}

/**
 * Create a secure teacher invitation initiated by a verified school administrator.
 */
export async function createTeacherInvitation(params: {
  schoolId: string;
  schoolName: string;
  adminUser: AppUser;
  email: string;
  teacherData: {
    firstName: string;
    lastName: string;
    phone?: string;
    employeeId?: string;
    assignedClassIds: string[];
    subjects: string[];
  };
  expiresInDays?: number;
}): Promise<AccountInvitation> {
  const { schoolId, schoolName, adminUser, email, teacherData, expiresInDays = 7 } = params;

  // 1. Authorize: adminUser must be verified ADMIN in target schoolId or SUPER_ADMIN
  if (!adminUser.isSuperAdmin) {
    if (adminUser.role !== 'ADMIN' || adminUser.schoolId?.toLowerCase() !== schoolId.toLowerCase()) {
      throw new Error('Unauthorized: Only administrators of this school can invite teachers.');
    }
  }

  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('A valid email address is required for teacher invitation.');
  }

  // 2. Generate unique code
  let inviteCode = generateInvitationCode();
  let existingDoc = await getDoc(doc(db, 'invitations', inviteCode));
  let attempts = 0;
  while (existingDoc.exists() && attempts < 5) {
    inviteCode = generateInvitationCode();
    existingDoc = await getDoc(doc(db, 'invitations', inviteCode));
    attempts++;
  }

  const expiresDate = new Date();
  expiresDate.setDate(expiresDate.getDate() + expiresInDays);

  const invitation: AccountInvitation = {
    id: inviteCode,
    schoolId: schoolId.toLowerCase().trim(),
    schoolName: schoolName || 'EduKonnect School',
    email: cleanEmail,
    role: 'TEACHER',
    status: 'PENDING',
    teacherData: {
      firstName: teacherData.firstName.trim(),
      lastName: teacherData.lastName.trim(),
      phone: teacherData.phone?.trim() || '',
      employeeId: teacherData.employeeId?.trim() || '',
      assignedClassIds: teacherData.assignedClassIds || [],
      subjects: teacherData.subjects || [],
    },
    invitedBy: adminUser.uid,
    invitedByName: adminUser.displayName || 'School Administrator',
    expiresAt: expiresDate,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // 3. Atomically persist invitation & stage the teacher record
  const batch = writeBatch(db);
  const inviteRef = doc(db, 'invitations', inviteCode);
  batch.set(inviteRef, invitation);

  // Check if a teacher record already exists for this email in this school
  const tQuery = query(
    collection(db, 'teachers'),
    where('schoolId', '==', schoolId.toLowerCase().trim()),
    where('email', '==', cleanEmail)
  );
  const tSnap = await getDocs(tQuery);

  let teacherId = '';
  if (tSnap.empty) {
    const newTeacherRef = doc(collection(db, 'teachers'));
    teacherId = newTeacherRef.id;
    const initialTeacher: Teacher = {
      teacherId,
      schoolId: schoolId.toLowerCase().trim(),
      firstName: teacherData.firstName.trim(),
      lastName: teacherData.lastName.trim(),
      email: cleanEmail,
      phone: teacherData.phone?.trim() || '',
      employeeId: teacherData.employeeId?.trim() || '',
      assignedClassIds: teacherData.assignedClassIds || [],
      subjects: teacherData.subjects || [],
      status: 'ACTIVE',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(newTeacherRef, initialTeacher);
  } else {
    teacherId = tSnap.docs[0].id;
    batch.update(doc(db, 'teachers', teacherId), {
      assignedClassIds: teacherData.assignedClassIds || [],
      subjects: teacherData.subjects || [],
      status: 'ACTIVE',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return invitation;
}

/**
 * Create a secure parent invitation with explicit child-linking.
 */
export async function createParentInvitation(params: {
  schoolId: string;
  schoolName: string;
  adminUser: AppUser;
  email: string;
  parentData: {
    firstName: string;
    lastName: string;
    phone?: string;
    relationship?: string;
    linkedStudentIds: string[];
  };
  expiresInDays?: number;
}): Promise<AccountInvitation> {
  const { schoolId, schoolName, adminUser, email, parentData, expiresInDays = 7 } = params;

  // 1. Authorize: adminUser must be verified ADMIN in target schoolId or SUPER_ADMIN
  if (!adminUser.isSuperAdmin) {
    if (adminUser.role !== 'ADMIN' || adminUser.schoolId?.toLowerCase() !== schoolId.toLowerCase()) {
      throw new Error('Unauthorized: Only administrators of this school can invite parents.');
    }
  }

  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('A valid email address is required for parent invitation.');
  }

  if (!parentData.linkedStudentIds || parentData.linkedStudentIds.length === 0) {
    throw new Error('At least one enrolled student must be linked to the parent invitation.');
  }

  // 2. Validate that all linked students strictly belong to this school
  const studentChecks = await Promise.all(
    parentData.linkedStudentIds.map(async (sId) => {
      const sDoc = await getDoc(doc(db, 'students', sId));
      if (!sDoc.exists()) {
        throw new Error(`Student ${sId} was not found.`);
      }
      const sData = sDoc.data() as Student;
      if (sData.schoolId?.toLowerCase() !== schoolId.toLowerCase()) {
        throw new Error(`Cross-tenant security violation: Student ${sId} does not belong to this school.`);
      }
      return { id: sId, data: sData };
    })
  );

  // 3. Generate unique code
  let inviteCode = generateInvitationCode();
  let existingDoc = await getDoc(doc(db, 'invitations', inviteCode));
  let attempts = 0;
  while (existingDoc.exists() && attempts < 5) {
    inviteCode = generateInvitationCode();
    existingDoc = await getDoc(doc(db, 'invitations', inviteCode));
    attempts++;
  }

  const expiresDate = new Date();
  expiresDate.setDate(expiresDate.getDate() + expiresInDays);

  const invitation: AccountInvitation = {
    id: inviteCode,
    schoolId: schoolId.toLowerCase().trim(),
    schoolName: schoolName || 'EduKonnect School',
    email: cleanEmail,
    role: 'PARENT',
    status: 'PENDING',
    parentData: {
      firstName: parentData.firstName.trim(),
      lastName: parentData.lastName.trim(),
      phone: parentData.phone?.trim() || '',
      relationship: parentData.relationship || 'Guardian',
      linkedStudentIds: parentData.linkedStudentIds,
    },
    invitedBy: adminUser.uid,
    invitedByName: adminUser.displayName || 'School Administrator',
    expiresAt: expiresDate,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // 4. Atomically persist invitation & stage the parent record
  const batch = writeBatch(db);
  const inviteRef = doc(db, 'invitations', inviteCode);
  batch.set(inviteRef, invitation);

  // Check if a parent record already exists for this email in this school
  const pQuery = query(
    collection(db, 'parents'),
    where('schoolId', '==', schoolId.toLowerCase().trim()),
    where('email', '==', cleanEmail)
  );
  const pSnap = await getDocs(pQuery);

  let parentId = '';
  if (pSnap.empty) {
    const newParentRef = doc(collection(db, 'parents'));
    parentId = newParentRef.id;
    const initialParent: Parent = {
      parentId,
      schoolId: schoolId.toLowerCase().trim(),
      firstName: parentData.firstName.trim(),
      lastName: parentData.lastName.trim(),
      email: cleanEmail,
      phone: parentData.phone?.trim() || '',
      relationship: parentData.relationship || 'Guardian',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(newParentRef, initialParent);
  } else {
    parentId = pSnap.docs[0].id;
  }

  // Link parentId into the student records
  for (const s of studentChecks) {
    const sRef = doc(db, 'students', s.id);
    const existingParentIds: string[] = s.data.parentIds || [];
    const existingParentEmails: string[] = s.data.parentEmails || [];
    
    const updatedIds = Array.from(new Set([...existingParentIds, parentId]));
    const updatedEmails = Array.from(new Set([...existingParentEmails, cleanEmail]));

    batch.update(sRef, {
      parentIds: updatedIds,
      parentEmails: updatedEmails,
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return invitation;
}

/**
 * Retrieve and validate an invitation by code.
 */
export async function getInvitationByCode(code: string): Promise<{
  valid: boolean;
  invitation?: AccountInvitation;
  errorMessage?: string;
}> {
  const cleanCode = code.toUpperCase().trim();
  if (!cleanCode) {
    return { valid: false, errorMessage: 'Please enter an invitation code.' };
  }

  try {
    const inviteDoc = await getDoc(doc(db, 'invitations', cleanCode));
    if (!inviteDoc.exists()) {
      return { valid: false, errorMessage: 'Invitation code not found or invalid.' };
    }

    const invitation = { id: inviteDoc.id, ...inviteDoc.data() } as AccountInvitation;

    if (invitation.status === 'ACCEPTED') {
      return { valid: false, errorMessage: 'This invitation has already been used and activated.' };
    }

    if (invitation.status === 'REVOKED') {
      return { valid: false, errorMessage: 'This invitation has been revoked by the school administration.' };
    }

    // Check expiration
    const expiryTime = invitation.expiresAt?.toDate ? invitation.expiresAt.toDate().getTime() : (
      invitation.expiresAt ? new Date(invitation.expiresAt).getTime() : 0
    );
    if (expiryTime && expiryTime < Date.now()) {
      return { valid: false, errorMessage: 'This invitation has expired. Please ask your school to issue a fresh invite.' };
    }

    return { valid: true, invitation };
  } catch (err: any) {
    console.error('Error fetching invitation:', err);
    return { valid: false, errorMessage: err.message || 'Error verifying invitation.' };
  }
}

/**
 * Accept and activate an invitation for an authenticated user.
 * Binds role, schoolId, creates SchoolMembership, and links profile.
 */
export async function acceptAndActivateInvitation(params: {
  code: string;
  userUid: string;
  userEmail: string;
  displayName?: string;
}): Promise<{ success: boolean; schoolId: string; role: 'TEACHER' | 'PARENT' }> {
  const { code, userUid, userEmail, displayName } = params;

  const check = await getInvitationByCode(code);
  if (!check.valid || !check.invitation) {
    throw new Error(check.errorMessage || 'Invalid invitation.');
  }

  const invitation = check.invitation;
  const targetSchoolId = invitation.schoolId.toLowerCase().trim();
  const cleanEmail = userEmail.toLowerCase().trim();

  const batch = writeBatch(db);

  // 1. Mark invitation accepted
  const inviteRef = doc(db, 'invitations', invitation.id);
  batch.update(inviteRef, {
    status: 'ACCEPTED',
    acceptedAt: serverTimestamp(),
    acceptedBy: userUid,
    updatedAt: serverTimestamp(),
  });

  // 2. Create explicit SchoolMembership record
  const membershipId = `${targetSchoolId}_${userUid}`;
  const membershipRef = doc(db, 'memberships', membershipId);
  const membership: SchoolMembership = {
    id: membershipId,
    userId: userUid,
    userEmail: cleanEmail,
    schoolId: targetSchoolId,
    schoolName: invitation.schoolName,
    role: invitation.role,
    status: 'ACTIVE',
    invitationId: invitation.id,
    activatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  let linkedTeacherId: string | undefined;
  let linkedParentId: string | undefined;

  // 3. Update or link role-specific records
  if (invitation.role === 'TEACHER') {
    // Find teacher doc
    const tQuery = query(
      collection(db, 'teachers'),
      where('schoolId', '==', targetSchoolId),
      where('email', '==', cleanEmail)
    );
    const tSnap = await getDocs(tQuery);
    if (!tSnap.empty) {
      const tDoc = tSnap.docs[0];
      linkedTeacherId = tDoc.id;
      batch.update(tDoc.ref, {
        userId: userUid,
        status: 'ACTIVE',
        updatedAt: serverTimestamp(),
      });
    } else {
      // Create new teacher record
      const tRef = doc(collection(db, 'teachers'));
      linkedTeacherId = tRef.id;
      batch.set(tRef, {
        teacherId: linkedTeacherId,
        schoolId: targetSchoolId,
        userId: userUid,
        firstName: invitation.teacherData?.firstName || displayName?.split(' ')[0] || 'Teacher',
        lastName: invitation.teacherData?.lastName || displayName?.split(' ')[1] || '',
        email: cleanEmail,
        phone: invitation.teacherData?.phone || '',
        employeeId: invitation.teacherData?.employeeId || '',
        assignedClassIds: invitation.teacherData?.assignedClassIds || [],
        subjects: invitation.teacherData?.subjects || [],
        status: 'ACTIVE',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    membership.teacherId = linkedTeacherId;
  } else if (invitation.role === 'PARENT') {
    // Find parent doc
    const pQuery = query(
      collection(db, 'parents'),
      where('schoolId', '==', targetSchoolId),
      where('email', '==', cleanEmail)
    );
    const pSnap = await getDocs(pQuery);
    if (!pSnap.empty) {
      const pDoc = pSnap.docs[0];
      linkedParentId = pDoc.id;
      batch.update(pDoc.ref, {
        userId: userUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      const pRef = doc(collection(db, 'parents'));
      linkedParentId = pRef.id;
      batch.set(pRef, {
        parentId: linkedParentId,
        schoolId: targetSchoolId,
        userId: userUid,
        firstName: invitation.parentData?.firstName || displayName?.split(' ')[0] || 'Parent',
        lastName: invitation.parentData?.lastName || displayName?.split(' ')[1] || '',
        email: cleanEmail,
        phone: invitation.parentData?.phone || '',
        relationship: invitation.parentData?.relationship || 'Guardian',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    membership.parentId = linkedParentId;
    membership.linkedStudentIds = invitation.parentData?.linkedStudentIds || [];

    // Ensure all linked students have this parentId and email
    if (invitation.parentData?.linkedStudentIds) {
      for (const sId of invitation.parentData.linkedStudentIds) {
        const sRef = doc(db, 'students', sId);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          const sData = sSnap.data() as Student;
          const updatedIds = Array.from(new Set([...(sData.parentIds || []), linkedParentId]));
          const updatedEmails = Array.from(new Set([...(sData.parentEmails || []), cleanEmail]));
          batch.update(sRef, {
            parentIds: updatedIds,
            parentEmails: updatedEmails,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  }

  batch.set(membershipRef, membership);

  // 4. Update the user document to lock to target school and role
  const userRef = doc(db, 'users', userUid);
  const updatedUserDoc: Partial<AppUser> = {
    uid: userUid,
    email: cleanEmail,
    displayName: displayName || (invitation.role === 'TEACHER' 
      ? `${invitation.teacherData?.firstName || ''} ${invitation.teacherData?.lastName || ''}`.trim()
      : `${invitation.parentData?.firstName || ''} ${invitation.parentData?.lastName || ''}`.trim()
    ),
    role: invitation.role,
    schoolId: targetSchoolId,
    approvalStatus: 'APPROVED',
    active: true,
    teacherId: linkedTeacherId,
    parentId: linkedParentId,
    assignedClassIds: invitation.teacherData?.assignedClassIds || [],
    updatedAt: serverTimestamp(),
  };

  batch.set(userRef, updatedUserDoc, { merge: true });

  await batch.commit();
  return { success: true, schoolId: targetSchoolId, role: invitation.role };
}

/**
 * Revoke an active invitation.
 */
export async function revokeInvitation(invitationId: string, adminSchoolId: string): Promise<void> {
  const inviteRef = doc(db, 'invitations', invitationId);
  const snap = await getDoc(inviteRef);
  if (!snap.exists()) {
    throw new Error('Invitation not found.');
  }

  const data = snap.data() as AccountInvitation;
  if (data.schoolId.toLowerCase() !== adminSchoolId.toLowerCase()) {
    throw new Error('Unauthorized to revoke invitations for another school.');
  }

  await updateDoc(inviteRef, {
    status: 'REVOKED',
    updatedAt: serverTimestamp(),
  });
}

/**
 * Fetch all invitations for a school.
 */
export async function getSchoolInvitations(schoolId: string): Promise<AccountInvitation[]> {
  const cleanSchoolId = schoolId.toLowerCase().trim();
  const q = query(collection(db, 'invitations'), where('schoolId', '==', cleanSchoolId));
  const snap = await getDocs(q);
  const list: AccountInvitation[] = [];
  snap.forEach((d) => {
    list.push({ id: d.id, ...d.data() } as AccountInvitation);
  });
  return list;
}
