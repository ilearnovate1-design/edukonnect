/**
 * Diagnostic & Audit Service for Teacher & Parent School Assignment Integrity
 *
 * Audits Firestore for:
 * - Missing school IDs on teachers and parents
 * - Missing or suspended authoritative /memberships/{schoolId}_{uid} documents
 * - School IDs that do not match user documents
 * - Inconsistent references to 'default'
 * - Cross-school parent-child relationships
 *
 * Adheres strictly to production safety:
 * Never modifies or overwrites data without an explicit, approved repair plan.
 */

import { collection, getDocs, getDoc, doc, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { Teacher, Parent, Student, AppUser, SchoolMembership } from '../types';

export interface AccountAuditIssue {
  type:
    | 'MISSING_SCHOOL_ID'
    | 'MISSING_MEMBERSHIP'
    | 'MISMATCHED_USER_SCHOOL'
    | 'INCONSISTENT_DEFAULT_SCHOOL'
    | 'CROSS_SCHOOL_PARENT_CHILD'
    | 'ORPHANED_USER_ROLE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  collection: 'teachers' | 'parents' | 'users' | 'students' | 'memberships';
  documentId: string;
  email?: string;
  name?: string;
  currentSchoolId?: string;
  inferredSchoolId?: string;
  linkedUserId?: string;
  linkedRole?: 'TEACHER' | 'PARENT';
  linkedEntityId?: string;
  details: string;
  canAutoRepair: boolean;
}

export interface TenantAccountAuditReport {
  timestamp: string;
  totalTeachersScanned: number;
  totalParentsScanned: number;
  totalUsersScanned: number;
  totalStudentsScanned: number;
  issues: AccountAuditIssue[];
  summary: {
    healthyCount: number;
    issuesCount: number;
    autoRepairableCount: number;
    manualReviewRequiredCount: number;
  };
}

/**
 * Non-destructive audit of teacher, parent, and membership records.
 * Pass filterSchoolId when invoked by a School Admin (non-superadmin) so queries remain tenant-scoped.
 */
export async function auditTeacherAndParentAccounts(filterSchoolId?: string): Promise<TenantAccountAuditReport> {
  const issues: AccountAuditIssue[] = [];
  const cleanSchool = filterSchoolId?.trim().toLowerCase() || '';

  const [teachersSnap, parentsSnap, usersSnap, studentsSnap, membershipsSnap] = await Promise.all([
    getDocs(cleanSchool ? query(collection(db, 'teachers'), where('schoolId', '==', cleanSchool)) : collection(db, 'teachers')),
    getDocs(cleanSchool ? query(collection(db, 'parents'), where('schoolId', '==', cleanSchool)) : collection(db, 'parents')),
    getDocs(cleanSchool ? query(collection(db, 'users'), where('schoolId', '==', cleanSchool)) : collection(db, 'users')),
    getDocs(cleanSchool ? query(collection(db, 'students'), where('schoolId', '==', cleanSchool)) : collection(db, 'students')),
    getDocs(cleanSchool ? query(collection(db, 'memberships'), where('schoolId', '==', cleanSchool)) : collection(db, 'memberships')),
  ]);

  if (cleanSchool) {
    await getDoc(doc(db, 'schools', cleanSchool)).catch(() => null);
  }

  const teachers = teachersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Teacher & { id: string }));
  const parents = parentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Parent & { id: string }));
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AppUser & { id: string }));
  const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student & { id: string }));
  const memberships = membershipsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SchoolMembership));

  const membershipById = new Map<string, SchoolMembership>();
  memberships.forEach((m) => membershipById.set(m.id, m));

  const userByUid = new Map<string, AppUser & { id: string }>();
  const userByEmail = new Map<string, AppUser & { id: string }>();
  users.forEach((u) => {
    userByUid.set(u.uid, u);
    if (u.email) userByEmail.set(u.email.toLowerCase().trim(), u);
  });

  // Audit Teachers
  teachers.forEach((teacher) => {
    const tEmail = teacher.email?.toLowerCase().trim();
    const tSchool = teacher.schoolId?.trim().toLowerCase();

    if (!tSchool) {
      issues.push({
        type: 'MISSING_SCHOOL_ID',
        severity: 'HIGH',
        collection: 'teachers',
        documentId: teacher.teacherId,
        email: teacher.email,
        name: `${teacher.firstName} ${teacher.lastName}`,
        details: `Teacher ${teacher.firstName} ${teacher.lastName} has no schoolId assigned.`,
        canAutoRepair: false,
      });
    }

    const linkedUser = teacher.userId ? userByUid.get(teacher.userId) : tEmail ? userByEmail.get(tEmail) : undefined;
    const resolvedUid = teacher.userId || linkedUser?.uid;

    if (tSchool && resolvedUid && teacher.status !== 'INACTIVE') {
      const expectedMembershipId = `${tSchool}_${resolvedUid}`;
      const existingMem = membershipById.get(expectedMembershipId);
      if (!existingMem || existingMem.status !== 'ACTIVE') {
        issues.push({
          type: 'MISSING_MEMBERSHIP',
          severity: 'HIGH',
          collection: 'memberships',
          documentId: expectedMembershipId,
          email: teacher.email,
          name: `${teacher.firstName} ${teacher.lastName}`,
          currentSchoolId: existingMem?.status || 'NONE',
          inferredSchoolId: tSchool,
          linkedUserId: resolvedUid,
          linkedRole: 'TEACHER',
          linkedEntityId: teacher.teacherId,
          details: `Teacher ${teacher.firstName} ${teacher.lastName} is missing an ACTIVE /memberships/${expectedMembershipId} record required by security rules.`,
          canAutoRepair: true,
        });
      }
    }

    if (linkedUser) {
      const uSchool = linkedUser.schoolId?.trim().toLowerCase();
      if (tSchool && uSchool && tSchool !== uSchool) {
        const isDefaultInconsistency = uSchool === 'default' && tSchool !== 'default';
        issues.push({
          type: isDefaultInconsistency ? 'INCONSISTENT_DEFAULT_SCHOOL' : 'MISMATCHED_USER_SCHOOL',
          severity: 'HIGH',
          collection: 'users',
          documentId: linkedUser.uid,
          email: linkedUser.email,
          name: linkedUser.displayName,
          currentSchoolId: uSchool,
          inferredSchoolId: tSchool,
          details: `User account is assigned to "${uSchool}" but authoritative teacher record belongs to "${tSchool}".`,
          canAutoRepair: true,
        });
      }
    }
  });

  // Audit Parents
  parents.forEach((parent) => {
    const pEmail = parent.email?.toLowerCase().trim();
    const pSchool = parent.schoolId?.trim().toLowerCase();

    if (!pSchool) {
      const linkedStudents = students.filter((s) => s.parentIds?.includes(parent.parentId));
      const childSchools = new Set(linkedStudents.map((s) => s.schoolId?.toLowerCase()).filter(Boolean));
      const canInfer = childSchools.size === 1;
      const inferred = canInfer ? Array.from(childSchools)[0] : undefined;

      issues.push({
        type: 'MISSING_SCHOOL_ID',
        severity: 'HIGH',
        collection: 'parents',
        documentId: parent.parentId,
        email: parent.email,
        name: `${parent.firstName} ${parent.lastName}`,
        inferredSchoolId: inferred,
        details: `Parent ${parent.firstName} ${parent.lastName} has no schoolId assigned.${canInfer ? ` Inferred school from child: "${inferred}".` : ''}`,
        canAutoRepair: canInfer,
      });
    }

    const linkedUser = parent.userId ? userByUid.get(parent.userId) : pEmail ? userByEmail.get(pEmail) : undefined;
    const resolvedUid = parent.userId || linkedUser?.uid;

    if (pSchool && resolvedUid) {
      const expectedMembershipId = `${pSchool}_${resolvedUid}`;
      const existingMem = membershipById.get(expectedMembershipId);
      if (!existingMem || existingMem.status !== 'ACTIVE') {
        issues.push({
          type: 'MISSING_MEMBERSHIP',
          severity: 'HIGH',
          collection: 'memberships',
          documentId: expectedMembershipId,
          email: parent.email,
          name: `${parent.firstName} ${parent.lastName}`,
          currentSchoolId: existingMem?.status || 'NONE',
          inferredSchoolId: pSchool,
          linkedUserId: resolvedUid,
          linkedRole: 'PARENT',
          linkedEntityId: parent.parentId,
          details: `Parent ${parent.firstName} ${parent.lastName} is missing an ACTIVE /memberships/${expectedMembershipId} record.`,
          canAutoRepair: true,
        });
      }
    }

    if (linkedUser) {
      const uSchool = linkedUser.schoolId?.trim().toLowerCase();
      if (pSchool && uSchool && pSchool !== uSchool) {
        const isDefaultInconsistency = uSchool === 'default' && pSchool !== 'default';
        issues.push({
          type: isDefaultInconsistency ? 'INCONSISTENT_DEFAULT_SCHOOL' : 'MISMATCHED_USER_SCHOOL',
          severity: 'HIGH',
          collection: 'users',
          documentId: linkedUser.uid,
          email: linkedUser.email,
          name: linkedUser.displayName,
          currentSchoolId: uSchool,
          inferredSchoolId: pSchool,
          details: `User account is assigned to "${uSchool}" but authoritative parent record belongs to "${pSchool}".`,
          canAutoRepair: true,
        });
      }
    }
  });

  // Audit Student-Parent Relationships for Cross-School Integrity
  students.forEach((student) => {
    const sSchool = student.schoolId?.trim().toLowerCase();
    if (student.parentIds && student.parentIds.length > 0) {
      student.parentIds.forEach((pId) => {
        const pRecord = parents.find((p) => p.parentId === pId);
        if (pRecord && pRecord.schoolId && sSchool && pRecord.schoolId.toLowerCase() !== sSchool) {
          issues.push({
            type: 'CROSS_SCHOOL_PARENT_CHILD',
            severity: 'HIGH',
            collection: 'students',
            documentId: student.studentId,
            details: `Student "${student.firstName} ${student.lastName}" (School: ${sSchool}) is linked to Parent "${pRecord.firstName} ${pRecord.lastName}" (School: ${pRecord.schoolId}). Cross-tenant link detected.`,
            canAutoRepair: false,
          });
        }
      });
    }
  });

  const autoRepairableCount = issues.filter((i) => i.canAutoRepair).length;
  const manualReviewRequiredCount = issues.length - autoRepairableCount;

  return {
    timestamp: new Date().toISOString(),
    totalTeachersScanned: teachers.length,
    totalParentsScanned: parents.length,
    totalUsersScanned: users.length,
    totalStudentsScanned: students.length,
    issues,
    summary: {
      healthyCount: Math.max(0, teachers.length + parents.length - issues.length),
      issuesCount: issues.length,
      autoRepairableCount,
      manualReviewRequiredCount,
    },
  };
}

/**
 * Controlled, transactional repair procedure.
 * Only executes repairs where the correct school association is unambiguous.
 */
export async function executeApprovedAccountRepair(
  report: TenantAccountAuditReport,
  approvedIssueIndices?: number[]
): Promise<{ repairedCount: number; skippedCount: number; errors: string[] }> {
  let repairedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  const batch = writeBatch(db);
  const issuesToProcess = report.issues.filter((issue, idx) => {
    if (!issue.canAutoRepair) return false;
    if (approvedIssueIndices && !approvedIssueIndices.includes(idx)) return false;
    return true;
  });

  for (const issue of issuesToProcess) {
    try {
      if (issue.type === 'MISSING_MEMBERSHIP' && issue.inferredSchoolId && issue.linkedUserId && issue.linkedRole) {
        const memRef = doc(db, 'memberships', issue.documentId);
        batch.set(
          memRef,
          {
            id: issue.documentId,
            userId: issue.linkedUserId,
            userEmail: (issue.email || '').toLowerCase().trim(),
            schoolId: issue.inferredSchoolId,
            role: issue.linkedRole,
            status: 'ACTIVE',
            ...(issue.linkedRole === 'TEACHER' && issue.linkedEntityId ? { teacherId: issue.linkedEntityId } : {}),
            ...(issue.linkedRole === 'PARENT' && issue.linkedEntityId ? { parentId: issue.linkedEntityId } : {}),
            activatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        repairedCount++;
      } else if (issue.type === 'MISMATCHED_USER_SCHOOL' || issue.type === 'INCONSISTENT_DEFAULT_SCHOOL') {
        if (issue.inferredSchoolId && issue.documentId) {
          const userRef = doc(db, 'users', issue.documentId);
          batch.update(userRef, {
            schoolId: issue.inferredSchoolId,
            updatedAt: serverTimestamp(),
          });
          repairedCount++;
        }
      } else if (issue.type === 'MISSING_SCHOOL_ID' && issue.collection === 'parents') {
        if (issue.inferredSchoolId && issue.documentId) {
          const parentRef = doc(db, 'parents', issue.documentId);
          batch.update(parentRef, {
            schoolId: issue.inferredSchoolId,
            updatedAt: serverTimestamp(),
          });
          repairedCount++;
        }
      } else {
        skippedCount++;
      }
    } catch (e: any) {
      errors.push(`Failed to repair ${issue.collection}/${issue.documentId}: ${e.message}`);
    }
  }

  if (repairedCount > 0) {
    await batch.commit();
  }

  return { repairedCount, skippedCount, errors };
}
