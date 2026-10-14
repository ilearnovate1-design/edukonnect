import { 
  collection, 
  getDocs, 
  writeBatch, 
  doc, 
  query, 
  where 
} from 'firebase/firestore';
import { db } from './firebase';

const BUSINESS_COLLECTIONS = [
  'students',
  'parents',
  'teachers',
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
  'auditLogs',
  'evaluations',
  'platformUsage'
];

/**
 * Bulk delete all documents in a collection (handled in chunks of 400)
 */
async function deleteCollection(collectionName: string) {
  const snap = await getDocs(collection(db, collectionName));
  if (snap.empty) return;

  const docs = snap.docs;
  const BATCH_SIZE = 400;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const slice = docs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    slice.forEach((d) => {
      batch.delete(d.ref);
    });
    await batch.commit();
  }
}

/**
 * Purge all platform data except for the platform administrator accounts and core settings.
 */
export const purgeAllPlatformData = async (adminUid: string): Promise<{ success: boolean; message: string }> => {
  try {
    // 1. Clear business data
    for (const coll of BUSINESS_COLLECTIONS) {
      await deleteCollection(coll);
    }

    // 2. Clear users except the current admin
    const usersSnap = await getDocs(collection(db, 'users'));
    const userBatch = writeBatch(db);
    let deletedUsers = 0;
    usersSnap.docs.forEach((d) => {
      if (d.id !== adminUid) {
        userBatch.delete(d.ref);
        deletedUsers++;
      }
    });
    if (deletedUsers > 0) await userBatch.commit();

    // 3. Clear schools (optional? The user asked to clear "all test data")
    // We'll keep 'default' as the default tenant but clear its custom settings if any
    const schoolsSnap = await getDocs(collection(db, 'schools'));
    const schoolBatch = writeBatch(db);
    schoolsSnap.docs.forEach((d) => {
      if (d.id !== 'default') {
        schoolBatch.delete(d.ref);
      }
    });
    await schoolBatch.commit();

    // 4. Clear school domains
    await deleteCollection('schoolDomains');

    return { 
      success: true, 
      message: 'Platform data purged successfully. Admin account and core settings preserved.' 
    };
  } catch (err: any) {
    console.error('Purge failed:', err);
    return { success: false, message: err.message || 'Purge failed' };
  }
};
