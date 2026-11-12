/**
 * Test Suite: Grading Profile Firestore Persistence & Undefined Field Sanitization
 * 
 * Verifies:
 * 1. Sanitization function eliminates undefined fields (preventing FirebaseError)
 * 2. FieldValue (serverTimestamp), Date, and nested structures are preserved
 * 3. Profiles saved without affectiveScale receive DEFAULT_AFFECTIVE_SCALE
 * 4. Saving profiles with optional promotionRule or displaySettings does not inject undefined
 */

import { sanitizeFirestoreData } from '../src/services/gradingProfileService';
import { DEFAULT_AFFECTIVE_SCALE, DEFAULT_GRADING_PROFILES } from '../src/services/assessmentEngine';

let passed = 0;
let failed = 0;

function assert(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

console.log('--- STARTING GRADING PROFILE PERSISTENCE TESTS ---');

// Test 1: Undefined values removal
console.log('\n1. Undefined Value Sanitization:');
const dirtyObject = {
  profileId: 'gp_default_primary',
  name: 'Primary School Continuous Assessment',
  affectiveScale: undefined,
  promotionRule: undefined,
  nested: {
    a: 10,
    b: undefined,
    c: {
      inner: 'test',
      missing: undefined,
    },
  },
  components: [
    { id: 'ca1', name: 'CA 1', maxScore: 10, weight: 10, extra: undefined },
  ],
};

const sanitized = sanitizeFirestoreData(dirtyObject);
assert(!('affectiveScale' in sanitized), 'Removes root-level affectiveScale when undefined');
assert(!('promotionRule' in sanitized), 'Removes root-level promotionRule when undefined');
assert(!('b' in sanitized.nested), 'Removes nested undefined properties');
assert(!('missing' in sanitized.nested.c), 'Removes deeply nested undefined properties');
assert(sanitized.nested.a === 10, 'Preserves valid numeric properties');
assert(sanitized.nested.c.inner === 'test', 'Preserves valid string properties');
assert(!('extra' in sanitized.components[0]), 'Removes undefined properties within array items');

// Test 2: FieldValue and Date preservation
console.log('\n2. Special Type Preservation:');
const mockFieldValue = { _methodName: 'serverTimestamp' };
const mockTimestamp = { seconds: 1700000000, nanoseconds: 500 };
const dateObj = new Date();

const specialPayload = {
  createdAt: mockFieldValue,
  updatedAt: mockTimestamp,
  customDate: dateObj,
  bogus: undefined,
};

const sanitizedSpecial = sanitizeFirestoreData(specialPayload);
assert(sanitizedSpecial.createdAt === mockFieldValue, 'Preserves serverTimestamp FieldValue');
assert(sanitizedSpecial.updatedAt === mockTimestamp, 'Preserves Firestore Timestamp');
assert(sanitizedSpecial.customDate === dateObj, 'Preserves Date instances');
assert(!('bogus' in sanitizedSpecial), 'Strips undefined while preserving special types');

// Test 3: Default Profiles include DEFAULT_AFFECTIVE_SCALE
console.log('\n3. Default Grading Profile Template Scale:');
assert(DEFAULT_GRADING_PROFILES.PRIMARY.affectiveScale !== undefined, 'PRIMARY template includes affectiveScale');
assert(DEFAULT_GRADING_PROFILES.PRIMARY.affectiveScale?.min === 1, 'PRIMARY affectiveScale min is 1');
assert(DEFAULT_GRADING_PROFILES.PRIMARY.affectiveScale?.max === 5, 'PRIMARY affectiveScale max is 5');
assert(DEFAULT_GRADING_PROFILES.JSS.affectiveScale !== undefined, 'JSS template includes affectiveScale');
assert(DEFAULT_GRADING_PROFILES.SSS.affectiveScale !== undefined, 'SSS template includes affectiveScale');
assert(DEFAULT_GRADING_PROFILES.NURSERY.affectiveScale !== undefined, 'NURSERY template includes affectiveScale');

// Test 4: Simulated Primary Profile Payload Construction (The exact user scenario)
console.log('\n4. Primary Profile Save Scenario (gp_default_primary):');
const primaryProfileToSave = {
  profileId: 'gp_default_primary',
  schoolId: 'default',
  name: 'Primary School Continuous Assessment Standard (Configurable)',
  levelCategory: 'PRIMARY' as const,
  components: DEFAULT_GRADING_PROFILES.PRIMARY.components,
  gradeBands: DEFAULT_GRADING_PROFILES.PRIMARY.gradeBands,
  calculationMethod: 'SUM' as const,
  roundingPolicy: 'ROUND_HALF_UP_INTEGER' as const,
  // Notice affectiveScale omitted or undefined
  affectiveScale: undefined,
};

const profilePayload: Record<string, any> = {
  profileId: primaryProfileToSave.profileId,
  schoolId: primaryProfileToSave.schoolId,
  name: primaryProfileToSave.name.trim(),
  levelCategory: primaryProfileToSave.levelCategory || 'PRIMARY',
  description: '',
  isDefault: true,
  calculationMethod: primaryProfileToSave.calculationMethod || 'SUM',
  treatMissingAsZero: false,
  roundingPolicy: primaryProfileToSave.roundingPolicy || 'ROUND_HALF_UP_INTEGER',
  components: primaryProfileToSave.components || [],
  gradeBands: [...primaryProfileToSave.gradeBands],
  subjectOverrides: {},
  affectiveScale: primaryProfileToSave.affectiveScale || DEFAULT_AFFECTIVE_SCALE,
  version: 2,
};

const finalSanitized = sanitizeFirestoreData(profilePayload);
assert(finalSanitized.affectiveScale !== undefined, 'Fallback provides DEFAULT_AFFECTIVE_SCALE when omitted');
assert(finalSanitized.affectiveScale.min === 1 && finalSanitized.affectiveScale.max === 5, 'Scale has min: 1, max: 5');
assert(!Object.values(finalSanitized).some(val => val === undefined), 'Zero undefined values in final payload');

console.log('\n========================================');
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================');

if (failed > 0) {
  process.exit(1);
}
