import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { SchoolSettings, ReportTemplateSettings, AffectiveTraitConfig } from '../types';
import { DEFAULT_GRADING_SCALE } from '../utils/formatters';

export const DEFAULT_AFFECTIVE_TRAITS: AffectiveTraitConfig[] = [
  { id: 'trait-punctuality', trait: 'Punctuality & Regularity', category: 'affective', defaultScore: 5 },
  { id: 'trait-neatness', trait: 'Neatness & Uniform', category: 'affective', defaultScore: 5 },
  { id: 'trait-politeness', trait: 'Politeness & Courtesy', category: 'affective', defaultScore: 5 },
  { id: 'trait-honesty', trait: 'Honesty & Reliability', category: 'affective', defaultScore: 4 },
  { id: 'trait-peers', trait: 'Relationship with Peers', category: 'affective', defaultScore: 4 },
  { id: 'trait-attentiveness', trait: 'Attentiveness in Class', category: 'affective', defaultScore: 4 },
  { id: 'trait-sports', trait: 'Sports & Physical Agility', category: 'psychomotor', defaultScore: 4 },
  { id: 'trait-creativity', trait: 'Creativity & Handiwork', category: 'psychomotor', defaultScore: 4 },
];

export const DEFAULT_REPORT_TEMPLATE: ReportTemplateSettings = {
  principalName: 'Dr. E. O. Okonjo (PhD)',
  principalTitle: 'Head of School Signature & Stamp',
  officialSealText: 'APPROVED',
  teacherTitle: 'Class Teacher Signature',
  defaultTeacherName: 'Class Teacher',

  principalRemarkDistinction: 'Executive Academic Distinction. Commended for superior intellect and exemplary conduct.',
  principalRemarkCredit: 'Good academic standing. Maintain steady revision to sustain this standard.',
  principalRemarkPass: 'Satisfactory performance. Advised to focus on weaker subject areas.',
  principalRemarkTrial: 'Fair effort. Compulsory holiday coaching recommended in core calculation subjects.',

  teacherAppraisalDistinction: 'An exceptionally brilliant, diligent, and disciplined pupil. Outstanding overall performance!',
  teacherAppraisalCredit: 'Very good work throughout the term. Shows keen analytical interest and participates actively.',
  teacherAppraisalPass: 'A steady pupil capable of higher attainment. More diligence required in home assignments.',
  teacherAppraisalTrial: 'Needs to pay strict attention in class, avoid distractions, and complete all assignments.',

  verdictDistinction: 'PASSED WITH HIGH DISTINCTION',
  verdictCredit: 'PASSED WITH CREDIT',
  verdictPass: 'PASSED',
  verdictTrial: 'PROMOTED ON TRIAL',

  ratingScaleDescription: 'Affective & Psychomotor Skills Rating (5: Excellent | 4: Good | 3: Fair | 2: Poor | 1: Very Poor)',
  affectiveTraits: DEFAULT_AFFECTIVE_TRAITS,

  clearanceNotice: 'Clearance Verified. Please present this report card upon resumption.',
  showAttendanceSummary: true,
  showOfficialSeal: true,
};

export const DEFAULT_TENANT_ID = 'default';

export const STANDARD_CURRICULUM_SUBJECTS = [
  { name: 'Mathematics', code: 'MTH', category: 'Core' },
  { name: 'English Language', code: 'ENG', category: 'Core' },
  { name: 'Basic Science & Technology', code: 'BST', category: 'Sciences' },
  { name: 'Social Studies', code: 'SOS', category: 'Humanities' },
  { name: 'Civic Education', code: 'CIV', category: 'Core' },
  { name: 'Agricultural Science', code: 'AGR', category: 'Sciences' },
  { name: 'Information & Communication Technology', code: 'ICT', category: 'Sciences' },
  { name: 'Christian Religious Studies', code: 'CRS', category: 'Humanities' },
  { name: 'Islamic Religious Studies', code: 'IRS', category: 'Humanities' },
  { name: 'Physical & Health Education', code: 'PHE', category: 'General' },
  { name: 'Cultural & Creative Arts', code: 'CCA', category: 'Humanities' },
  { name: 'Business Studies', code: 'BUS', category: 'Commercial' },
  { name: 'Home Economics', code: 'HEC', category: 'Vocational' },
  { name: 'Biology', code: 'BIO', category: 'Sciences' },
  { name: 'Chemistry', code: 'CHM', category: 'Sciences' },
  { name: 'Physics', code: 'PHY', category: 'Sciences' },
  { name: 'Economics', code: 'ECO', category: 'Commercial' },
  { name: 'Government', code: 'GOV', category: 'Humanities' },
  { name: 'Literature in English', code: 'LIT', category: 'Humanities' },
  { name: 'French Language', code: 'FRE', category: 'Languages' },
  { name: 'Yoruba Language', code: 'YOR', category: 'Languages' },
  { name: 'Hausa Language', code: 'HAU', category: 'Languages' },
  { name: 'Igbo Language', code: 'IGB', category: 'Languages' },
];

/**
 * Seed standard Nigerian curriculum subjects for a specific tenant school
 */
export const seedStandardCurriculumForSchool = async (
  schoolId: string = DEFAULT_TENANT_ID
): Promise<{ success: boolean; count: number }> => {
  const targetSchoolId = (schoolId && schoolId.trim()) ? schoolId.trim().toLowerCase() : DEFAULT_TENANT_ID;
  const { writeBatch } = await import('firebase/firestore');
  const batch = writeBatch(db);

  let count = 0;
  for (const item of STANDARD_CURRICULUM_SUBJECTS) {
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const subId = targetSchoolId === DEFAULT_TENANT_ID ? `sub-${slug}` : `sub-${targetSchoolId}-${slug}`;
    const docRef = doc(db, 'subjects', subId);
    
    batch.set(docRef, {
      subjectId: subId,
      schoolId: targetSchoolId,
      name: item.name,
      code: item.code,
      category: item.category,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    count++;
  }

  await batch.commit();
  return { success: true, count };
};

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  schoolId: DEFAULT_TENANT_ID,
  slug: DEFAULT_TENANT_ID,
  schoolName: 'EduKonnect Portal',
  address: 'Lagos, Nigeria',
  phone: '+234 800 EDUKONNECT',
  email: 'support@edukonnect.ng',
  website: 'https://edukonnect.ng',
  currentAcademicSession: '2026/2027',
  currentTerm: 'First Term',
  nextTermResumptionDate: '2026-09-21',
  currency: 'NGN',
  timeZone: 'Africa/Lagos',
  gradingScale: DEFAULT_GRADING_SCALE,
  reportTemplate: DEFAULT_REPORT_TEMPLATE,
};

/**
 * Fetch school settings by schoolId with seamless fallback to legacy schoolSettings/general
 */
export const getSchoolSettings = async (schoolId: string = DEFAULT_TENANT_ID): Promise<SchoolSettings | null> => {
  const targetId = (schoolId && schoolId.trim()) ? schoolId.trim().toLowerCase() : DEFAULT_TENANT_ID;

  try {
    const fetchWithTimeout = async (ref: any) => {
      const snapPromise = getDoc(ref).catch((err) => {
        console.warn(`Notice reading ${ref.path} (offline or pending):`, err?.message || err);
        return null;
      });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
      return await Promise.race([snapPromise, timeoutPromise]);
    };

    // 1. Try modern multi-tenant collection: schools/{schoolId}
    const schoolDocRef = doc(db, 'schools', targetId);
    const schoolSnap: any = await fetchWithTimeout(schoolDocRef);

    if (schoolSnap && schoolSnap.exists && schoolSnap.exists()) {
      const data = schoolSnap.data() as SchoolSettings;
      return {
        ...DEFAULT_SCHOOL_SETTINGS,
        ...data,
        schoolId: targetId,
        reportTemplate: {
          ...DEFAULT_REPORT_TEMPLATE,
          ...(data.reportTemplate || {}),
          affectiveTraits: data.reportTemplate?.affectiveTraits?.length
            ? data.reportTemplate.affectiveTraits
            : DEFAULT_AFFECTIVE_TRAITS,
        },
      };
    }

    // 2. If target is default, check legacy schoolSettings/general
    if (targetId === DEFAULT_TENANT_ID) {
      const legacyRef = doc(db, 'schoolSettings', 'general');
      const legacySnap: any = await fetchWithTimeout(legacyRef);
      if (legacySnap && legacySnap.exists && legacySnap.exists()) {
        const data = legacySnap.data() as SchoolSettings;
        return {
          ...DEFAULT_SCHOOL_SETTINGS,
          ...data,
          schoolId: DEFAULT_TENANT_ID,
          slug: DEFAULT_TENANT_ID,
          reportTemplate: {
            ...DEFAULT_REPORT_TEMPLATE,
            ...(data.reportTemplate || {}),
            affectiveTraits: data.reportTemplate?.affectiveTraits?.length
              ? data.reportTemplate.affectiveTraits
              : DEFAULT_AFFECTIVE_TRAITS,
          },
        };
      }
    }

    return {
      ...DEFAULT_SCHOOL_SETTINGS,
      schoolId: targetId,
      slug: targetId,
    };
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      console.warn(`Permission notice fetching school settings for ${targetId}:`, err);
    } else {
      console.warn(`Notice fetching school settings for ${targetId}, using default:`, err?.message || err);
    }
    return DEFAULT_SCHOOL_SETTINGS;
  }
};

/**
 * Save school settings for a specific schoolId, keeping legacy schoolSettings/general synchronized for default
 */
export const saveSchoolSettings = async (
  settings: Partial<SchoolSettings>,
  schoolId: string = DEFAULT_TENANT_ID
): Promise<void> => {
  const targetId = (schoolId && schoolId.trim()) ? schoolId.trim().toLowerCase() : DEFAULT_TENANT_ID;

  // 1. Write to modern multi-tenant collection: schools/{targetId}
  const schoolDocRef = doc(db, 'schools', targetId);
  const existing = await getDoc(schoolDocRef);

  const payload = {
    ...settings,
    schoolId: targetId,
    slug: targetId,
    updatedAt: serverTimestamp(),
  };

  if (existing.exists()) {
    await setDoc(schoolDocRef, payload, { merge: true });
  } else {
    await setDoc(schoolDocRef, {
      ...DEFAULT_SCHOOL_SETTINGS,
      ...payload,
      createdAt: serverTimestamp(),
    });
  }

  // 2. If targetId is default, also sync to general doc for zero-disruption compatibility
  if (targetId === DEFAULT_TENANT_ID) {
    try {
      const legacyRef = doc(db, 'schoolSettings', 'general');
      await setDoc(legacyRef, payload, { merge: true });
    } catch (legacyErr) {
      console.warn('Could not sync to legacy schoolSettings/general:', legacyErr);
    }
  }
};

/**
 * Resolve schoolId by domain or hostname
 */
export const resolveSchoolByDomain = async (hostname: string): Promise<string> => {
  if (!hostname) return DEFAULT_TENANT_ID;

  const cleanHost = hostname.toLowerCase().trim();

  // If subdomain pattern: e.g. academy.edukonnect.ng -> academy
  const parts = cleanHost.split('.');
  if (parts.length > 2) {
    const sub = parts[0];
    // Ignore common infrastructure subdomains and AI Studio auto-generated dev domains
    const isInfra = ['www', 'portal', 'app', 'dev', 'test', 'stage'].includes(sub);
    const isAiStudioDev = sub.startsWith('ais-dev-') || sub.startsWith('ais-pre-');
    
    if (sub && !isInfra && !isAiStudioDev) {
      return sub;
    }
  }

  try {
    const fetchDomainPromise = getDoc(doc(db, 'schoolDomains', cleanHost)).catch(() => null);
    const domainTimeout = new Promise<null>((res) => setTimeout(() => res(null), 1500));
    const domainDoc: any = await Promise.race([fetchDomainPromise, domainTimeout]);
    if (domainDoc && domainDoc.exists && domainDoc.exists()) {
      const dData = domainDoc.data();
      if (dData.schoolId) return dData.schoolId;
    }
  } catch (e) {
    // Ignore and fallback
  }

  return DEFAULT_TENANT_ID;
};

/**
 * List all registered schools for super-admin management
 */
export const getAllSchools = async (): Promise<SchoolSettings[]> => {
  try {
    const { getDocs, collection, query, orderBy } = await import('firebase/firestore');
    const snap = await getDocs(query(collection(db, 'schools'), orderBy('schoolName')));
    const list: SchoolSettings[] = [];
    snap.forEach((d) => list.push({ ...d.data(), schoolId: d.id } as SchoolSettings));
    return list;
  } catch (err) {
    console.error('Error listing all schools:', err);
    return [];
  }
};

/**
 * Associate a domain with a specific schoolId
 */
export const mapDomainToSchool = async (domain: string, schoolId: string): Promise<void> => {
  try {
    const cleanDomain = domain.toLowerCase().trim();
    await setDoc(doc(db, 'schoolDomains', cleanDomain), {
      domain: cleanDomain,
      schoolId: schoolId.toLowerCase().trim(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error mapping domain:', err);
    throw err;
  }
};

/**
 * Remove a domain mapping
 */
export const removeDomainMapping = async (domain: string): Promise<void> => {
  try {
    const { deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db, 'schoolDomains', domain.toLowerCase().trim()));
  } catch (err) {
    console.error('Error removing domain mapping:', err);
    throw err;
  }
};

/**
 * Delete a school institution, remove domain mappings, and optionally wipe all tenant records
 */
export const deleteSchool = async (
  schoolId: string, 
  purgeTenantData: boolean = true,
  adminUid: string = 'admin'
): Promise<{ success: boolean; deletedCollectionsCount?: number }> => {
  const targetId = (schoolId && schoolId.trim()) ? schoolId.trim().toLowerCase() : '';
  if (!targetId) {
    throw new Error('Valid school ID is required for deletion');
  }

  try {
    const { deleteDoc, getDocs, collection, query, where, writeBatch } = await import('firebase/firestore');

    // 1. Optionally purge all tenant-specific data
    let deletedCount = 0;
    if (purgeTenantData) {
      try {
        const { purgeCollections } = await import('./dataManagement');
        const allCollections = [
          'students', 'classes', 'subjects', 'teachers', 'parents', 'attendance', 
          'feeStructures', 'payments', 'results', 'assignments', 'submissions', 
          'announcements', 'notifications', 'evaluations', 'auditLogs'
        ];
        const res = await purgeCollections(allCollections, adminUid, targetId);
        deletedCount = res.deletedCount;
      } catch (purgeErr) {
        console.warn(`Warning while purging tenant records for ${targetId}:`, purgeErr);
      }
    }

    // 2. Remove domain mappings for this school
    try {
      const domainSnap = await getDocs(query(collection(db, 'schoolDomains'), where('schoolId', '==', targetId)));
      if (!domainSnap.empty) {
        const dBatch = writeBatch(db);
        domainSnap.docs.forEach((d) => dBatch.delete(d.ref));
        await dBatch.commit();
      }
    } catch (domainErr) {
      console.warn(`Could not remove domain mappings for ${targetId}:`, domainErr);
    }

    // 3. Delete the primary school document
    await deleteDoc(doc(db, 'schools', targetId));

    // 4. Delete legacy or secondary schoolSettings document if present
    try {
      await deleteDoc(doc(db, 'schoolSettings', targetId));
    } catch (settingsErr) {
      // Ignore if document didn't exist
    }

    return { success: true, deletedCollectionsCount: deletedCount };
  } catch (err) {
    console.error(`Error deleting school ${targetId}:`, err);
    throw err;
  }
};

/**
 * Public School Registration:
 * Safely registers a new school, prevents duplicate slugs/hijacking,
 * binds the owner as the initial verified ADMIN, creates explicit membership,
 * and provisions the standard curriculum.
 */
export const registerNewSchoolAndOwner = async (params: {
  schoolName: string;
  address: string;
  phone: string;
  email: string;
  currentAcademicSession?: string;
  currentTerm?: string;
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
}): Promise<{ schoolId: string; success: boolean }> => {
  const {
    schoolName,
    address,
    phone,
    email,
    currentAcademicSession = '2026/2027',
    currentTerm = 'First Term',
    ownerUid,
    ownerEmail,
    ownerName,
  } = params;

  if (!schoolName || !schoolName.trim()) {
    throw new Error('School name is required.');
  }
  if (!ownerUid || !ownerEmail) {
    throw new Error('Authenticated owner identity is required.');
  }

  // 1. Generate unique, clean slug
  let baseSlug = schoolName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  if (!baseSlug) {
    baseSlug = `school-${Date.now().toString(36)}`;
  }

  let finalSlug = baseSlug;
  const existingSchool = await getDoc(doc(db, 'schools', finalSlug));
  if (existingSchool.exists()) {
    // Generate unique suffix
    finalSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
  }

  const { writeBatch } = await import('firebase/firestore');
  const batch = writeBatch(db);

  // 2. School Document
  const schoolRef = doc(db, 'schools', finalSlug);
  const newSchoolData: SchoolSettings = {
    ...DEFAULT_SCHOOL_SETTINGS,
    schoolId: finalSlug,
    slug: finalSlug,
    schoolName: schoolName.trim(),
    address: address?.trim() || '',
    phone: phone?.trim() || '',
    email: email?.trim() || ownerEmail.trim(),
    currentAcademicSession,
    currentTerm,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(schoolRef, newSchoolData);

  // 3. User Document for Owner (Explicit ADMIN, NOT SUPER_ADMIN)
  const userRef = doc(db, 'users', ownerUid);
  batch.set(
    userRef,
    {
      uid: ownerUid,
      email: ownerEmail.toLowerCase().trim(),
      displayName: ownerName?.trim() || 'School Administrator',
      role: 'ADMIN',
      schoolId: finalSlug,
      isSuperAdmin: false,
      approvalStatus: 'APPROVED',
      active: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 4. Explicit SchoolMembership Document
  const membershipId = `${finalSlug}_${ownerUid}`;
  const membershipRef = doc(db, 'memberships', membershipId);
  batch.set(membershipRef, {
    id: membershipId,
    userId: ownerUid,
    userEmail: ownerEmail.toLowerCase().trim(),
    schoolId: finalSlug,
    schoolName: schoolName.trim(),
    role: 'ADMIN',
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  // 5. Seed curriculum
  try {
    await seedStandardCurriculumForSchool(finalSlug);
  } catch (seedErr) {
    console.warn('Notice seeding standard curriculum:', seedErr);
  }

  return { schoolId: finalSlug, success: true };
};


