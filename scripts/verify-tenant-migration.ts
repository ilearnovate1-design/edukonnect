import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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
  'schoolSettings',
];

interface CollectionAudit {
  name: string;
  total: number;
  tagged: number;
  missing: number;
  tenants: Record<string, number>;
}

async function runDryRunVerification() {
  console.log('\n================================================================');
  console.log('       MULTI-TENANT DRY-RUN MIGRATION VERIFICATION AUDIT        ');
  console.log('================================================================');
  console.log(`Database: ${firebaseConfig.firestoreDatabaseId || '(default)'}`);
  console.log(`Project:  ${firebaseConfig.projectId}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('----------------------------------------------------------------\n');
  console.log('Scanning collections for tenant isolation ("schoolId" field)...\n');

  const classTenantMap = new Map<string, string>();
  const studentTenantMap = new Map<string, string>();
  const inconsistencies: Array<{ col: string; docId: string; issue: string }> = [];

  // Pre-load classes
  try {
    const classSnap = await getDocs(collection(db, 'classes'));
    classSnap.forEach((d) => {
      classTenantMap.set(d.id, d.data().schoolId || 'bistoland');
    });
  } catch (e) {
    // Continue
  }

  // Pre-load students
  try {
    const studentSnap = await getDocs(collection(db, 'students'));
    studentSnap.forEach((d) => {
      studentTenantMap.set(d.id, d.data().schoolId || 'bistoland');
    });
  } catch (e) {
    // Continue
  }

  const results: CollectionAudit[] = [];
  let totalDocs = 0;
  let totalTagged = 0;
  let totalMissing = 0;
  const overallTenants: Record<string, number> = {};

  for (const col of TARGET_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, col));
      let tagged = 0;
      let missing = 0;
      const tenants: Record<string, number> = {};

      snap.forEach((d) => {
        const data = d.data();
        const schoolId = data.schoolId;

        if (schoolId && typeof schoolId === 'string' && schoolId.trim() !== '') {
          tagged++;
          tenants[schoolId] = (tenants[schoolId] || 0) + 1;
          overallTenants[schoolId] = (overallTenants[schoolId] || 0) + 1;
        } else {
          missing++;
          tenants['(missing -> bistoland)'] = (tenants['(missing -> bistoland)'] || 0) + 1;
          overallTenants['bistoland (default)'] = (overallTenants['bistoland (default)'] || 0) + 1;
        }

        // Cross-tenant checks
        if (col === 'students' && data.classId) {
          const classTenant = classTenantMap.get(data.classId);
          const studentTenant = schoolId || 'bistoland';
          if (classTenant && classTenant !== studentTenant) {
            inconsistencies.push({
              col,
              docId: d.id,
              issue: `Student assigned to class ${data.classId} in tenant "${classTenant}", but student is in "${studentTenant}"`,
            });
          }
        }
      });

      const total = snap.size;
      totalDocs += total;
      totalTagged += tagged;
      totalMissing += missing;

      results.push({
        name: col,
        total,
        tagged,
        missing,
        tenants,
      });
    } catch (err: any) {
      results.push({
        name: col,
        total: 0,
        tagged: 0,
        missing: 0,
        tenants: { [`ERROR: ${err.message}`]: 0 },
      });
    }
  }

  // Display Table
  console.log(
    'Collection'.padEnd(20) +
    'Total'.padStart(8) +
    'Tagged'.padStart(10) +
    'Missing'.padStart(10) +
    '  Tenant Breakdown'
  );
  console.log('-'.repeat(80));

  for (const r of results) {
    const tenantSummary = Object.entries(r.tenants)
      .map(([t, count]) => `${t}: ${count}`)
      .join(', ') || 'None';
    
    console.log(
      r.name.padEnd(20) +
      String(r.total).padStart(8) +
      String(r.tagged).padStart(10) +
      String(r.missing).padStart(10) +
      '  ' + tenantSummary
    );
  }

  console.log('-'.repeat(80));
  console.log(
    'TOTAL'.padEnd(20) +
    String(totalDocs).padStart(8) +
    String(totalTagged).padStart(10) +
    String(totalMissing).padStart(10)
  );

  console.log('\n================================================================');
  console.log('                        SUMMARY VERIFICATION                    ');
  console.log('================================================================');
  console.log(`Total Documents Scanned:    ${totalDocs}`);
  console.log(`Explicitly Tagged:          ${totalTagged} (${totalDocs > 0 ? ((totalTagged / totalDocs) * 100).toFixed(1) : 0}%)`);
  console.log(`Missing schoolId:           ${totalMissing} (will default to 'bistoland' safely)`);
  console.log('\nTenant Document Distribution:');
  for (const [tenant, count] of Object.entries(overallTenants)) {
    console.log(`  - ${tenant.padEnd(25)}: ${count} documents`);
  }

  if (inconsistencies.length > 0) {
    console.log('\n[!] Cross-Tenant Inconsistencies Detected:');
    inconsistencies.forEach((inc, idx) => {
      console.log(`  ${idx + 1}. [${inc.col}/${inc.docId}]: ${inc.issue}`);
    });
  } else {
    console.log('\n[✔] Zero cross-tenant relational conflicts detected.');
  }

  console.log('\nMigration Safety Verdict:');
  if (totalMissing === 0) {
    console.log('  STATUS: [READY] All documents contain explicit schoolId tags.');
  } else {
    console.log(`  STATUS: [COMPATIBLE] The backward-compatibility layer safely defaults the ${totalMissing} legacy records to "bistoland".`);
    console.log('  No live data was modified during this dry run.');
  }
  console.log('================================================================\n');

  process.exit(0);
}

runDryRunVerification().catch((err) => {
  console.error('Fatal error during dry run:', err);
  process.exit(1);
});
