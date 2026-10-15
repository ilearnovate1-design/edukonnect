/**
 * Comprehensive Unit Test Suite for Assessment Calculation Engine
 * 
 * Verifies:
 * - Boundaries (exact cutoffs, upper and lower limits)
 * - Rounding policies (integer, 1 decimal, 2 decimals)
 * - Missing scores handling (treatMissingAsZero: false vs true)
 * - Invalid marks (negative, exceeding max, invalid numbers)
 * - Weighting calculations (SUM vs WEIGHTED_PERCENTAGE)
 * - Grade assignment across different profiles (Primary, JSS, SSS 9-point scale)
 * - Profile validation (preventing overlapping ranges, invalid weights)
 */

import { 
  validateGradeBands,
  validateGradingProfile,
  calculateSubjectResult,
  calculateStudentTermSummary,
  applyRounding,
  DEFAULT_GRADING_PROFILES 
} from '../src/services/assessmentEngine';
import { GradingProfile, Result } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('--- STARTING ASSESSMENT CALCULATION ENGINE TESTS ---\n');

// 1. BOUNDARIES & CUTOFFS
console.log('1. Grade Boundaries & Cutoffs:');
const primaryProfile: GradingProfile = {
  ...DEFAULT_GRADING_PROFILES.PRIMARY,
  schoolId: 'test-school',
};

// Test boundary edge cases: 74.9 vs 75.0 (A vs B)
const res75 = calculateSubjectResult({ ca1: 10, ca2: 10, mid: 15, exam: 40 }, primaryProfile); // total 75
assert(res75.totalScore === 75 && res75.grade === 'A', 'Exact boundary score 75 receives Grade A');

const res74 = calculateSubjectResult({ ca1: 10, ca2: 10, mid: 14, exam: 40 }, primaryProfile); // total 74
assert(res74.totalScore === 74 && res74.grade === 'B', 'Exact boundary score 74 receives Grade B');

const res39 = calculateSubjectResult({ ca1: 5, ca2: 4, mid: 10, exam: 20 }, primaryProfile); // total 39
assert(res39.totalScore === 39 && res39.grade === 'F', 'Score 39 receives Grade F');

const res40 = calculateSubjectResult({ ca1: 5, ca2: 5, mid: 10, exam: 20 }, primaryProfile); // total 40
assert(res40.totalScore === 40 && res40.grade === 'D', 'Exact boundary score 40 receives Grade D');

// 2. ROUNDING POLICIES
console.log('\n2. Rounding Policies:');
assert(applyRounding(74.49, 'ROUND_HALF_UP_INTEGER') === 74, 'Half-up integer: 74.49 rounds to 74');
assert(applyRounding(74.50, 'ROUND_HALF_UP_INTEGER') === 75, 'Half-up integer: 74.50 rounds to 75');
assert(applyRounding(74.54, 'ROUND_HALF_UP_1DECIMAL') === 74.5, 'Half-up 1 decimal: 74.54 rounds to 74.5');
assert(applyRounding(74.55, 'ROUND_HALF_UP_1DECIMAL') === 74.6, 'Half-up 1 decimal: 74.55 rounds to 74.6');
assert(applyRounding(74.555, 'ROUND_HALF_UP_2DECIMAL') === 74.56, 'Half-up 2 decimals: 74.555 rounds to 74.56');

// 3. MISSING SCORES HANDLING
console.log('\n3. Missing Scores Handling:');
// When treatMissingAsZero is FALSE (default)
const resMissingDefault = calculateSubjectResult(
  { ca1: 10, ca2: null, mid: 20, exam: 50 }, // ca2 is missing
  { ...primaryProfile, treatMissingAsZero: false }
);
assert(resMissingDefault.isMissingAny === true, 'Flags isMissingAny when component is null');
assert(resMissingDefault.isIncomplete === true, 'Flags isIncomplete when treatMissingAsZero is false');
assert(resMissingDefault.grade === 'INC', 'Assigns grade INC when incomplete');

// When treatMissingAsZero is TRUE
const resMissingAsZero = calculateSubjectResult(
  { ca1: 10, ca2: null, mid: 20, exam: 50 }, // ca2 missing, treated as 0: 10+0+20+50 = 80
  { ...primaryProfile, treatMissingAsZero: true }
);
assert(resMissingAsZero.isMissingAny === true, 'Flags isMissingAny even when treated as zero');
assert(resMissingAsZero.isIncomplete === false, 'isIncomplete is false when treatMissingAsZero is true');
assert(resMissingAsZero.totalScore === 80, 'Calculates score treating missing as 0 (total 80)');
assert(resMissingAsZero.grade === 'A', 'Assigns Grade A for total 80');

// 4. INVALID & OUT-OF-RANGE MARKS
console.log('\n4. Invalid Marks Validation:');
const resOutOfRange = calculateSubjectResult(
  { ca1: -5, ca2: 10, mid: 20, exam: 999 }, // ca1 < 0, exam > 60
  primaryProfile
);
assert(resOutOfRange.invalidComponentIds.includes('ca1'), 'Detects negative score as invalid');
assert(resOutOfRange.invalidComponentIds.includes('exam'), 'Detects score exceeding maxScore as invalid');

// 5. WEIGHTED PERCENTAGE CALCULATION
console.log('\n5. Weighted Percentage Calculation:');
const weightedProfile: GradingProfile = {
  ...primaryProfile,
  calculationMethod: 'WEIGHTED_PERCENTAGE',
  components: [
    { id: 'quiz', name: 'Quiz (out of 20)', maxScore: 20, weight: 20 }, // scored 20/20 -> 20%
    { id: 'mid', name: 'Midterm (out of 50)', maxScore: 50, weight: 30 }, // scored 25/50 -> 15%
    { id: 'exam', name: 'Exam (out of 100)', maxScore: 100, weight: 50 }, // scored 80/100 -> 40%
  ],
  roundingPolicy: 'ROUND_HALF_UP_INTEGER',
};

const resWeighted = calculateSubjectResult(
  { quiz: 20, mid: 25, exam: 80 },
  weightedProfile
);
// Total should be: 20% + 15% + 40% = 75%
assert(resWeighted.totalScore === 75, `Calculates weighted score correctly: got ${resWeighted.totalScore}, expected 75`);
assert(resWeighted.grade === 'A', 'Assigns Grade A to weighted 75');

// 6. SSS 9-POINT SCALE (WAEC / NECO)
console.log('\n6. SSS 9-Point Grade Assignment:');
const sssProfile: GradingProfile = {
  ...DEFAULT_GRADING_PROFILES.SSS,
  schoolId: 'test-school',
};

const sssTestCases = [
  { ca1: 28, exam: 60, expectedGrade: 'A1', expectedPt: 5.0 }, // 88 -> A1
  { ca1: 22, exam: 50, expectedGrade: 'B2', expectedPt: 4.0 }, // 72 -> B2
  { ca1: 20, exam: 47, expectedGrade: 'B3', expectedPt: 3.5 }, // 67 -> B3
  { ca1: 18, exam: 44, expectedGrade: 'C4', expectedPt: 3.0 }, // 62 -> C4
  { ca1: 16, exam: 40, expectedGrade: 'C5', expectedPt: 2.5 }, // 56 -> C5
  { ca1: 15, exam: 37, expectedGrade: 'C6', expectedPt: 2.0 }, // 52 -> C6
  { ca1: 14, exam: 33, expectedGrade: 'D7', expectedPt: 1.5 }, // 47 -> D7
  { ca1: 12, exam: 30, expectedGrade: 'E8', expectedPt: 1.0 }, // 42 -> E8
  { ca1: 10, exam: 20, expectedGrade: 'F9', expectedPt: 0.0 }, // 30 -> F9
];

for (const tc of sssTestCases) {
  const r = calculateSubjectResult({ ca1: tc.ca1, exam: tc.exam }, sssProfile);
  assert(
    r.grade === tc.expectedGrade && r.gradePoint === tc.expectedPt,
    `Score ${tc.ca1 + tc.exam} assigns ${tc.expectedGrade} (${tc.expectedPt} pts)`
  );
}

// 7. PROFILE VALIDATION (Preventing overlaps, gaps, and invalid weights)
console.log('\n7. Profile Validation Rules:');
const overlappingBands = [
  { min: 70, max: 100, grade: 'A', remark: 'Distinction' },
  { min: 60, max: 75, grade: 'B', remark: 'Credit' }, // Overlaps 70-75 with A!
];
const overlapValidation = validateGradeBands(overlappingBands);
assert(!overlapValidation.valid, 'Detects and rejects overlapping grade bands');

const invalidWeightProfile: Partial<GradingProfile> = {
  name: 'Invalid Weights Profile',
  calculationMethod: 'WEIGHTED_PERCENTAGE',
  components: [
    { id: 'c1', name: 'CA 1', maxScore: 20, weight: 30 },
    { id: 'exam', name: 'Exam', maxScore: 80, weight: 50 }, // Total weights = 80, not 100
  ],
  gradeBands: primaryProfile.gradeBands,
};
const weightValidation = validateGradingProfile(invalidWeightProfile);
assert(!weightValidation.valid, 'Detects and rejects weighted profile where sum of weights != 100');

// 8. STUDENT TERM SUMMARY & PROMOTION
console.log('\n8. Student Term Summary & Promotion Rules:');
const mockResults: Result[] = [
  {
    resultId: 'r1',
    studentId: 'stud-1',
    classId: 'class-1',
    subjectId: 'sub-math',
    academicSession: '2026/2027',
    term: 'First Term',
    caScore: 30,
    examScore: 50,
    totalScore: 80,
    grade: 'A',
    gradePoint: 5.0,
    status: 'PUBLISHED',
    createdAt: null,
    updatedAt: null,
  },
  {
    resultId: 'r2',
    studentId: 'stud-1',
    classId: 'class-1',
    subjectId: 'sub-eng',
    academicSession: '2026/2027',
    term: 'First Term',
    caScore: 25,
    examScore: 45,
    totalScore: 70,
    grade: 'B',
    gradePoint: 4.0,
    status: 'PUBLISHED',
    createdAt: null,
    updatedAt: null,
  },
];

const summary = calculateStudentTermSummary(mockResults, primaryProfile);
assert(summary.averageScore === 75, 'Calculates student term average (80 + 70) / 2 = 75');
assert(summary.gpa === 4.5, 'Calculates student GPA (5.0 + 4.0) / 2 = 4.5');
assert(summary.passedCount === 2, 'Counts passed subjects correctly');
assert(summary.verdict === 'PROMOTED TO NEXT CLASS', 'Evaluates promotion verdict for average >= 50');

console.log(`\n========================================`);
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
