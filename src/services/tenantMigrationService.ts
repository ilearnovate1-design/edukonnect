import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

export interface CollectionAuditStats {
  collectionName: string;
  totalRecords: number;
  taggedRecords: number;
  missingSchoolIdRecords: number;
  distinctTenants: Record<string, number>;
}

export interface TenantInconsistency {
  collection: string;
  documentId: string;
  issue: string;
  details: string;
}

export interface DryRunReport {
  timestamp: string;
  collections: CollectionAuditStats[];
  totalRecordsScanned: number;
  totalMissingSchoolId: number;
  totalTagged: number;
  inconsistencies: TenantInconsistency[];
  tenantDistribution: Record<string, number>;
  summary: {
    status: 'HEALTHY' | 'NEEDS_MIGRATION' | 'ATTENTION_REQUIRED';
    recommendedDefaultTenant: string;
    impactSummary: string;
  };
}

export const TARGET_COLLECTIONS = [
  'students',
  'teachers',
  'parents',
  'classes',
  'subjects',
  'attendance',
  'feeStructures',
  'payments',
  'results',
  'assignments',
  'submissions',
  'announcements',
  'notifications',
  'evaluations',
  'auditLogs',
  'schoolSettings',
];

export async function runTenantDryRunVerification(): Promise<DryRunReport> {
  const collectionStats: CollectionAuditStats[] = [];
  const inconsistencies: TenantInconsistency[] = [];
  const tenantDistribution: Record<string, number> = {};

  let totalScanned = 0;
  let totalMissing = 0;
  let totalTagged = 0;

  // Cache for cross-referencing consistency
  const classTenantMap = new Map<string, string>();
  const studentTenantMap = new Map<string, string>();

  // 1. Scan classes first to map classId -> schoolId
  try {
    const classSnap = await getDocs(collection(db, 'classes'));
    classSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const school = data.schoolId || 'default';
      classTenantMap.set(docSnap.id, school);
    });
  } catch (err) {
    console.warn('Could not pre-load classes for reference checks:', err);
  }

  // 2. Scan students to map studentId -> schoolId
  try {
    const studentSnap = await getDocs(collection(db, 'students'));
    studentSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const school = data.schoolId || 'default';
      studentTenantMap.set(docSnap.id, school);
    });
  } catch (err) {
    console.warn('Could not pre-load students for reference checks:', err);
  }

  // 3. Scan each collection
  for (const colName of TARGET_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, colName));
      let tagged = 0;
      let missing = 0;
      const distinct: Record<string, number> = {};

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const schoolId = data.schoolId;

        if (schoolId && typeof schoolId === 'string' && schoolId.trim() !== '') {
          tagged++;
          distinct[schoolId] = (distinct[schoolId] || 0) + 1;
          tenantDistribution[schoolId] = (tenantDistribution[schoolId] || 0) + 1;
        } else {
          missing++;
          distinct['[MISSING -> default]'] = (distinct['[MISSING -> default]'] || 0) + 1;
          tenantDistribution['default (defaulted)'] = (tenantDistribution['default (defaulted)'] || 0) + 1;
        }

        // Cross-entity reference checks
        if (colName === 'students' && data.classId) {
          const expectedClassTenant = classTenantMap.get(data.classId);
          const studentTenant = schoolId || 'default';
          if (expectedClassTenant && expectedClassTenant !== studentTenant) {
            inconsistencies.push({
              collection: colName,
              documentId: docSnap.id,
              issue: 'Student-Class Cross-Tenant Mismatch',
              details: `Student tenant is "${studentTenant}", but assigned class ${data.classId} belongs to "${expectedClassTenant}".`,
            });
          }
        }

        if ((colName === 'results' || colName === 'payments') && data.studentId) {
          const expectedStudentTenant = studentTenantMap.get(data.studentId);
          const recordTenant = schoolId || 'default';
          if (expectedStudentTenant && expectedStudentTenant !== recordTenant) {
            inconsistencies.push({
              collection: colName,
              documentId: docSnap.id,
              issue: `${colName.toUpperCase()} Cross-Tenant Mismatch`,
              details: `Record tenant is "${recordTenant}", but student ${data.studentId} belongs to "${expectedStudentTenant}".`,
            });
          }
        }
      });

      const total = snap.size;
      totalScanned += total;
      totalTagged += tagged;
      totalMissing += missing;

      collectionStats.push({
        collectionName: colName,
        totalRecords: total,
        taggedRecords: tagged,
        missingSchoolIdRecords: missing,
        distinctTenants: distinct,
      });
    } catch (err: any) {
      console.error(`Error scanning collection ${colName}:`, err);
      collectionStats.push({
        collectionName: colName,
        totalRecords: 0,
        taggedRecords: 0,
        missingSchoolIdRecords: 0,
        distinctTenants: { error: 0 },
      });
    }
  }

  // Determine summary status
  let status: 'HEALTHY' | 'NEEDS_MIGRATION' | 'ATTENTION_REQUIRED' = 'HEALTHY';
  let impactSummary = 'All records are tagged with a tenant identifier and cross-referenced consistently.';

  if (inconsistencies.length > 0) {
    status = 'ATTENTION_REQUIRED';
    impactSummary = `Found ${inconsistencies.length} cross-tenant reference inconsistencies that should be verified.`;
  } else if (totalMissing > 0) {
    status = 'NEEDS_MIGRATION';
    impactSummary = `${totalMissing} legacy records currently lack a "schoolId" field and will automatically resolve to "default" for backward compatibility until migrated.`;
  }

  return {
    timestamp: new Date().toISOString(),
    collections: collectionStats,
    totalRecordsScanned: totalScanned,
    totalMissingSchoolId: totalMissing,
    totalTagged: totalTagged,
    inconsistencies,
    tenantDistribution,
    summary: {
      status,
      recommendedDefaultTenant: 'default',
      impactSummary,
    },
  };
}
