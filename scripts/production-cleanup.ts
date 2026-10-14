import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  writeBatch, 
  doc, 
  setDoc,
  serverTimestamp 
} from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Load config from firebase-applet-config.json
const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
let firebaseConfig: any = {};

if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, 'utf8');
  firebaseConfig = JSON.parse(raw);
} else {
  console.error('Error: firebase-applet-config.json not found in root directory.');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const TARGET_COLLECTIONS = [
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
  'platformUsage',
  'schoolDomains',
  'schools',
];

const PRESERVED_ADMIN_EMAILS = [
  'ilearnovate1@gmail.com',
  'admin@edukonnect.ng'
];

async function deleteCollection(colName: string) {
  try {
    const snap = await getDocs(collection(db, colName));
    if (snap.empty) {
      console.log(`- ${colName}: 0 documents (already clean)`);
      return;
    }
    const docs = snap.docs;
    const BATCH_SIZE = 400;
    let deleted = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const slice = docs.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      slice.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += slice.length;
    }
    console.log(`- ${colName}: deleted ${deleted} documents`);
  } catch (err: any) {
    console.warn(`! Failed cleaning ${colName}:`, err.message);
  }
}

async function cleanUsers() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    let deletedCount = 0;
    let updatedCount = 0;
    const batch = writeBatch(db);

    for (const d of snap.docs) {
      const data = d.data();
      const emailLower = (data.email || '').toLowerCase().trim();
      const isPreserved = PRESERVED_ADMIN_EMAILS.includes(emailLower);

      if (isPreserved) {
        batch.set(d.ref, {
          uid: d.id,
          email: data.email,
          displayName: 'EduKonnect Administrator',
          role: 'SUPER_ADMIN',
          isSuperAdmin: true,
          schoolId: 'default',
          approvalStatus: 'APPROVED',
          active: true,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        updatedCount++;
      } else {
        batch.delete(d.ref);
        deletedCount++;
      }
    }

    await batch.commit();
    console.log(`- users: deleted ${deletedCount} test users, preserved & updated ${updatedCount} super admin account(s)`);
  } catch (err: any) {
    console.warn('! Failed cleaning users:', err.message);
  }
}

async function resetSchoolSettings() {
  try {
    // 1. Delete all docs in schoolSettings
    const snap = await getDocs(collection(db, 'schoolSettings'));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    // 2. Write pristine EduKonnect school settings for 'default' and 'general'
    const defaultSettings = {
      schoolId: 'default',
      slug: 'default',
      schoolName: 'EduKonnect Portal',
      address: 'Lagos, Nigeria',
      phone: '+234 800 EDUKONNECT',
      email: 'admin@edukonnect.ng',
      website: 'https://edukonnect.ng',
      currentAcademicSession: '2026/2027',
      currentTerm: 'First Term',
      nextTermResumptionDate: '2026-09-21',
      currency: 'NGN',
      timeZone: 'Africa/Lagos',
      gradingScale: [
        { min: 70, max: 100, grade: 'A', remark: 'Distinction' },
        { min: 60, max: 69, grade: 'B', remark: 'Very Good' },
        { min: 50, max: 59, grade: 'C', remark: 'Credit' },
        { min: 45, max: 49, grade: 'D', remark: 'Pass' },
        { min: 40, max: 44, grade: 'E', remark: 'Fair' },
        { min: 0, max: 39, grade: 'F', remark: 'Fail' },
      ],
      reportTemplate: {
        principalName: 'School Principal',
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
        affectiveTraits: [
          { id: 'trait-punctuality', trait: 'Punctuality & Regularity', category: 'affective', defaultScore: 5 },
          { id: 'trait-neatness', trait: 'Neatness & Uniform', category: 'affective', defaultScore: 5 },
          { id: 'trait-politeness', trait: 'Politeness & Courtesy', category: 'affective', defaultScore: 5 },
          { id: 'trait-honesty', trait: 'Honesty & Reliability', category: 'affective', defaultScore: 4 },
          { id: 'trait-peers', trait: 'Relationship with Peers', category: 'affective', defaultScore: 4 },
          { id: 'trait-attentiveness', trait: 'Attentiveness in Class', category: 'affective', defaultScore: 4 },
          { id: 'trait-sports', trait: 'Sports & Physical Agility', category: 'psychomotor', defaultScore: 4 },
          { id: 'trait-creativity', trait: 'Creativity & Handiwork', category: 'psychomotor', defaultScore: 4 },
        ],
        clearanceNotice: 'Clearance Verified. Please present this report card upon resumption.',
        showAttendanceSummary: true,
        showOfficialSeal: true,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, 'schoolSettings', 'default'), defaultSettings);
    await setDoc(doc(db, 'schoolSettings', 'general'), { ...defaultSettings, schoolId: 'general' });
    console.log('- schoolSettings: reset to pristine EduKonnect branding (default & general)');
  } catch (err: any) {
    console.warn('! Failed resetting schoolSettings:', err.message);
  }
}

async function runCleanup() {
  console.log('====================================================');
  console.log('      EDUKONNECT PRODUCTION DATA PURGE & RESET      ');
  console.log('====================================================');
  console.log(`Database: ${firebaseConfig.firestoreDatabaseId}`);
  console.log(`Project:  ${firebaseConfig.projectId}`);
  console.log('----------------------------------------------------\n');

  console.log('1. Purging business data collections...');
  for (const col of TARGET_COLLECTIONS) {
    await deleteCollection(col);
  }

  console.log('\n2. Cleaning user accounts...');
  await cleanUsers();

  console.log('\n3. Resetting school settings to EduKonnect...');
  await resetSchoolSettings();

  console.log('\n----------------------------------------------------');
  console.log('✓ Cleanup successfully completed.');
  console.log('====================================================');
  process.exit(0);
}

runCleanup();
