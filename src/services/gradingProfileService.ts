/**
 * Service for managing Configurable Grading Profiles in EduKonnect
 * Supports multi-tenancy, immutable snapshots, and hierarchical profile resolution.
 */

import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  serverTimestamp,
  writeBatch 
} from 'firebase/firestore';
import { db } from './firebase';
import { GradingProfile, SchoolClass, Subject } from '../types';
import { DEFAULT_GRADING_PROFILES, DEFAULT_AFFECTIVE_SCALE, validateGradingProfile } from './assessmentEngine';

const PROFILES_COLLECTION = 'gradingProfiles';

/**
 * Recursively removes any keys with undefined values from objects and arrays,
 * preserving special Firestore types like FieldValue (serverTimestamp), Timestamps, and Dates.
 */
export const sanitizeFirestoreData = <T>(data: T): T => {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeFirestoreData(item)) as unknown as T;
  }
  if (typeof data === 'object') {
    if (
      data instanceof Date ||
      ('_methodName' in (data as any)) ||
      ('nanoseconds' in (data as any)) ||
      ('seconds' in (data as any))
    ) {
      return data;
    }
    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(data as Record<string, any>)) {
      if (val !== undefined) {
        cleanObj[key] = sanitizeFirestoreData(val);
      }
    }
    return cleanObj as T;
  }
  return data;
};

/**
 * Fetch all grading profiles for a tenant school
 */
export const fetchGradingProfiles = async (schoolId: string = 'default'): Promise<GradingProfile[]> => {
  try {
    const q = query(
      collection(db, PROFILES_COLLECTION),
      where('schoolId', '==', schoolId)
    );
    const snap = await getDocs(q);
    const list: GradingProfile[] = [];
    snap.forEach((d) => {
      list.push(d.data() as GradingProfile);
    });

    // If no profiles exist for this school yet, auto-seed default configurable profiles
    if (list.length === 0) {
      return await seedDefaultGradingProfilesForSchool(schoolId);
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error fetching grading profiles:', error);
    return [];
  }
};

/**
 * Seed editable starter profiles for a school
 */
export const seedDefaultGradingProfilesForSchool = async (schoolId: string = 'default'): Promise<GradingProfile[]> => {
  const batch = writeBatch(db);
  const profilesToSeed: GradingProfile[] = [];

  const categories: (keyof typeof DEFAULT_GRADING_PROFILES)[] = ['PRIMARY', 'JSS', 'SSS', 'NURSERY'];

  for (const cat of categories) {
    const template = DEFAULT_GRADING_PROFILES[cat];
    const profileId = `gp_${schoolId}_${cat.toLowerCase()}`;
    const profile: GradingProfile = {
      ...template,
      profileId,
      schoolId,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const docRef = doc(db, PROFILES_COLLECTION, profileId);
    batch.set(docRef, sanitizeFirestoreData(profile), { merge: true });
    profilesToSeed.push(profile);
  }

  try {
    await batch.commit();
  } catch (e) {
    console.error('Error committing default grading profiles:', e);
  }

  return profilesToSeed;
};

/**
 * Save or update a grading profile with validation
 */
export const saveGradingProfile = async (
  profile: Partial<GradingProfile> & { name: string; schoolId: string }
): Promise<{ success: boolean; profileId?: string; errors?: string[] }> => {
  const validation = validateGradingProfile(profile);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const profileId = profile.profileId || `gp_${profile.schoolId}_${Date.now()}`;
  const currentVersion = profile.version || 1;
  const isUpdate = !!profile.profileId;

  const rawPayload: Record<string, any> = {
    profileId,
    schoolId: profile.schoolId,
    name: profile.name.trim(),
    levelCategory: profile.levelCategory || 'PRIMARY',
    description: profile.description?.trim() || '',
    isDefault: !!profile.isDefault,
    calculationMethod: profile.calculationMethod || 'SUM',
    treatMissingAsZero: !!profile.treatMissingAsZero,
    roundingPolicy: profile.roundingPolicy || 'ROUND_HALF_UP_INTEGER',
    components: profile.components || [],
    gradeBands: [...(profile.gradeBands || [])].sort((a, b) => b.min - a.min),
    subjectOverrides: profile.subjectOverrides || {},
    affectiveScale: profile.affectiveScale || DEFAULT_AFFECTIVE_SCALE,
    version: isUpdate ? currentVersion + 1 : 1,
    createdAt: profile.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (profile.promotionRule !== undefined) {
    rawPayload.promotionRule = profile.promotionRule;
  }
  if (profile.displaySettings !== undefined) {
    rawPayload.displaySettings = profile.displaySettings;
  }

  const payload = sanitizeFirestoreData(rawPayload);

  const docRef = doc(db, PROFILES_COLLECTION, profileId);
  await setDoc(docRef, payload, { merge: true });

  return { success: true, profileId };
};

/**
 * Delete a grading profile
 */
export const deleteGradingProfile = async (profileId: string): Promise<boolean> => {
  try {
    const docRef = doc(db, PROFILES_COLLECTION, profileId);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    console.error('Error deleting grading profile:', error);
    return false;
  }
};

/**
 * Resolves the appropriate grading profile for a given class and optional subject
 */
export const resolveGradingProfile = (
  profiles: GradingProfile[],
  selectedClass?: SchoolClass | null,
  subjectId?: string
): GradingProfile => {
  if (!profiles || profiles.length === 0) {
    return {
      ...DEFAULT_GRADING_PROFILES.PRIMARY,
      profileId: 'fallback-primary',
      schoolId: 'default',
    };
  }

  // 1. Check if class has an explicitly assigned profile
  if (selectedClass?.gradingProfileId) {
    const classProfile = profiles.find(p => p.profileId === selectedClass.gradingProfileId);
    if (classProfile) {
      // Check for subject override within this profile
      if (subjectId && classProfile.subjectOverrides && classProfile.subjectOverrides[subjectId]) {
        const overrideProfileId = classProfile.subjectOverrides[subjectId];
        const overrideProfile = profiles.find(p => p.profileId === overrideProfileId);
        if (overrideProfile) return overrideProfile;
      }
      return classProfile;
    }
  }

  // 2. Try matching by class level (e.g. Primary, JSS, SSS, Nursery)
  if (selectedClass) {
    const classNameLower = (selectedClass.name || '').toLowerCase();
    const classLevelLower = (selectedClass.level || '').toLowerCase();

    let category: 'NURSERY' | 'PRIMARY' | 'JSS' | 'SSS' | null = null;
    if (classLevelLower.includes('nursery') || classNameLower.includes('nursery') || classNameLower.includes('kg') || classNameLower.includes('reception')) {
      category = 'NURSERY';
    } else if (classLevelLower.includes('jss') || classNameLower.includes('jss') || classNameLower.includes('junior')) {
      category = 'JSS';
    } else if (classLevelLower.includes('sss') || classNameLower.includes('sss') || classNameLower.includes('senior')) {
      category = 'SSS';
    } else if (classLevelLower.includes('primary') || classNameLower.includes('primary') || classNameLower.includes('basic')) {
      category = 'PRIMARY';
    }

    if (category) {
      const levelProfile = profiles.find(p => p.levelCategory === category);
      if (levelProfile) {
        if (subjectId && levelProfile.subjectOverrides && levelProfile.subjectOverrides[subjectId]) {
          const overrideProfile = profiles.find(p => p.profileId === levelProfile.subjectOverrides![subjectId]);
          if (overrideProfile) return overrideProfile;
        }
        return levelProfile;
      }
    }
  }

  // 3. Fallback to default marked profile, or first available
  const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];
  return defaultProfile;
};
