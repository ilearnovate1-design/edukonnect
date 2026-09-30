import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  serverTimestamp,
  Timestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  PlatformUsage, 
  SchoolUsageStats, 
  UsagePricing, 
  SchoolSettings 
} from '../types';

export const DEFAULT_PRICING: UsagePricing = {
  firestoreReadPerMillion: 0.30,
  firestoreWritePerMillion: 0.90,
  firestoreDeletePerMillion: 0.10,
  storagePerGB: 0.02,
  bandwidthPerGB: 0.12,
  exchangeRate: 1500, // ₦ per $
};

/**
 * Fetch pricing settings from platformSettings/pricing
 */
export const getPricingSettings = async (): Promise<UsagePricing> => {
  try {
    const d = await getDoc(doc(db, 'platformSettings', 'pricing'));
    if (d.exists()) {
      return (d.data() as any).pricing || DEFAULT_PRICING;
    }
  } catch (err) {
    console.error('Error fetching pricing:', err);
  }
  return DEFAULT_PRICING;
};

/**
 * Save pricing settings
 */
export const savePricingSettings = async (pricing: UsagePricing): Promise<void> => {
  await setDoc(doc(db, 'platformSettings', 'pricing'), {
    pricing,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

/**
 * Fetch platform usage for a specific date range
 */
export const getPlatformUsageHistory = async (days: number = 30): Promise<PlatformUsage[]> => {
  try {
    const q = query(
      collection(db, 'platformUsage'),
      orderBy('date', 'desc'),
      limit(days)
    );
    const snap = await getDocs(q);
    const results: PlatformUsage[] = [];
    snap.forEach(d => results.push({ ...d.data() } as PlatformUsage));
    return results.sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.error('Error fetching platform usage history:', err);
    return [];
  }
};

/**
 * Fetch school usage for a specific date
 */
export const getSchoolsUsageForDate = async (date: string): Promise<SchoolUsageStats[]> => {
  try {
    const snap = await getDocs(collection(db, 'platformUsage', date, 'schools'));
    const results: SchoolUsageStats[] = [];
    snap.forEach(d => results.push({ ...d.data() } as SchoolUsageStats));
    return results;
  } catch (err) {
    console.error('Error fetching school usage:', err);
    return [];
  }
};

/**
 * MANUAL AGGREGATION:
 * This scans the database to generate an aggregate usage report.
 * To be run manually by SUPER_ADMIN to avoid constant overhead.
 */
export const runUsageAggregation = async (): Promise<void> => {
  const date = new Date().toISOString().split('T')[0];
  const pricing = await getPricingSettings();
  
  // 1. Get all schools
  const schoolsSnap = await getDocs(collection(db, 'schools'));
  const schools: any[] = [];
  schoolsSnap.forEach(d => schools.push({ id: d.id, ...d.data() }));
  
  // 2. Count platform-wide stats
  // (Note: In a real large app, this would be done via Cloud Functions increments.
  // Here we do a count() which is 1 read per 1000 docs - cost efficient)
  const studentsSnap = await getDocs(collection(db, 'students'));
  const usersSnap = await getDocs(collection(db, 'users'));
  
  const platformData: PlatformUsage = {
    date,
    totalSchools: schools.length,
    activeSchools: schools.length, // Simplified
    totalStudents: studentsSnap.size,
    totalUsers: usersSnap.size,
    firestoreReads: 0, // Placeholder: Real reads requires Google Cloud Monitoring API
    firestoreWrites: 0,
    firestoreDeletes: 0,
    storageBytes: 0,
    appActivity: {
      studentsAdded: 0,
      attendanceRecords: 0,
      paymentsRecorded: 0,
      resultsPublished: 0,
      assignmentsCreated: 0,
      announcementsPublished: 0
    },
    updatedAt: serverTimestamp()
  };

  // 3. Count Activity from Audit Logs
  const startOfDay = new Date();
  startOfDay.setHours(0,0,0,0);
  const auditSnap = await getDocs(
    query(
      collection(db, 'auditLogs'), 
      where('createdAt', '>=', Timestamp.fromDate(startOfDay))
    )
  );
  
  auditSnap.forEach(d => {
    const action = d.data().action;
    if (action === 'STUDENT_CREATED') platformData.appActivity.studentsAdded++;
    if (action === 'ATTENDANCE_RECORDED') platformData.appActivity.attendanceRecords++;
    if (action === 'FEE_PAYMENT_RECORDED') platformData.appActivity.paymentsRecorded++;
    if (action === 'RESULTS_PUBLISHED') platformData.appActivity.resultsPublished++;
    if (action === 'ASSIGNMENT_CREATED') platformData.appActivity.assignmentsCreated++;
    if (action === 'ANNOUNCEMENT_POSTED') platformData.appActivity.announcementsPublished++;
  });

  // 4. Aggregate school-level stats
  const batch = writeBatch(db);
  const platformRef = doc(db, 'platformUsage', date);
  batch.set(platformRef, platformData, { merge: true });

  for (const school of schools) {
    const schoolId = school.id;
    // Filtered counts
    const sCount = studentsSnap.docs.filter(d => d.data().schoolId === schoolId).length;
    const uCount = usersSnap.docs.filter(d => d.data().schoolId === schoolId).length;
    
    const schoolStats: SchoolUsageStats = {
      schoolId,
      schoolName: school.schoolName || schoolId,
      students: sCount,
      users: uCount,
      reads: 0, // Placeholder
      writes: 0,
      storageBytes: 0,
      estimatedCost: 0,
      status: 'HEALTHY',
      lastUpdated: serverTimestamp()
    };
    
    const schoolRef = doc(db, 'platformUsage', date, 'schools', schoolId);
    batch.set(schoolRef, schoolStats, { merge: true });
  }

  await batch.commit();
};

export const calculateEstimatedCost = (usage: Partial<PlatformUsage>, pricing: UsagePricing): { usd: number, ngn: number } => {
  const reads = (usage.firestoreReads || 0) / 1000000 * pricing.firestoreReadPerMillion;
  const writes = (usage.firestoreWrites || 0) / 1000000 * pricing.firestoreWritePerMillion;
  const deletes = (usage.firestoreDeletes || 0) / 1000000 * pricing.firestoreDeletePerMillion;
  const storage = (usage.storageBytes || 0) / (1024 * 1024 * 1024) * pricing.storagePerGB;
  
  const totalUsd = reads + writes + deletes + storage;
  return {
    usd: totalUsd,
    ngn: totalUsd * pricing.exchangeRate
  };
};
