import { FeeStructure, Student } from '../types';

/**
 * Normalizes term representations for uniform comparison:
 * e.g. "1st Term", "First Term", "1ST TERM", "first_term" -> "1st Term"
 */
export function normalizeTerm(term?: string): string {
  if (!term) return '';
  const clean = term.trim().toLowerCase();
  if (clean.includes('1') || clean.includes('first') || clean.includes('1st')) return '1st Term';
  if (clean.includes('2') || clean.includes('second') || clean.includes('2nd')) return '2nd Term';
  if (clean.includes('3') || clean.includes('third') || clean.includes('3rd')) return '3rd Term';
  return term.trim();
}

/**
 * Checks whether two term descriptors refer to the same academic term.
 * If either term is omitted, returns true to allow session-wide or unassigned tariffs.
 */
export function areTermsMatching(term1?: string, term2?: string): boolean {
  if (!term1 || !term2) return true;
  return normalizeTerm(term1) === normalizeTerm(term2);
}

/**
 * Determines whether a given fee structure applies to a specific student.
 * Supports:
 * 1. Default (all students in class)
 * 2. Specific student assignments (only selected students are charged; others are ₦0)
 * 3. Student exemptions (all students in class except specified excluded students)
 * 4. Not assigned to class / None assigned (₦0 for all pupils unless individually added)
 * 5. Optional / Add-on fees
 */
export function isFeeApplicableToStudent(
  fee: FeeStructure,
  studentId: string
): boolean {
  if (!fee || !studentId) return false;

  // 1. Explicitly unassigned / not assigned to pupils in class
  if (fee.applicableTo === ('NONE' as any)) {
    // If none assigned, only charged if student is explicitly listed in assignedStudentIds
    return Array.isArray(fee.assignedStudentIds) && fee.assignedStudentIds.includes(studentId);
  }

  // 2. Explicitly targeted to specific students only
  if (fee.applicableTo === 'SPECIFIC_STUDENTS') {
    return Array.isArray(fee.assignedStudentIds) && fee.assignedStudentIds.includes(studentId);
  }

  // 3. Applied to class with specific exclusions/exemptions
  if (fee.applicableTo === 'EXCLUDE_STUDENTS') {
    return !Array.isArray(fee.excludedStudentIds) || !fee.excludedStudentIds.includes(studentId);
  }

  // 4. Backward compatibility: check assignedStudentIds if provided and non-empty
  if (Array.isArray(fee.assignedStudentIds) && fee.assignedStudentIds.length > 0) {
    return fee.assignedStudentIds.includes(studentId);
  }

  // 5. Backward compatibility: check excludedStudentIds if provided
  if (Array.isArray(fee.excludedStudentIds) && fee.excludedStudentIds.includes(studentId)) {
    return false;
  }

  // 6. Optional fee with designated assignments
  if (fee.category === 'OPTIONAL' && fee.assignedStudentIds) {
    return fee.assignedStudentIds.includes(studentId);
  }

  return true;
}

/**
 * Calculates the total expected fee for a student based on fee structures matching their class and term
 */
export function calculateStudentExpectedFee(
  student: Student,
  structures: FeeStructure[],
  currentTerm: string
): number {
  if (!student || !student.classId) return 0;

  return structures
    .filter((s) => s.classId === student.classId && areTermsMatching(s.term, currentTerm))
    .filter((s) => isFeeApplicableToStudent(s, student.studentId))
    .reduce((sum, item) => sum + (item.amount || 0), 0);
}

/**
 * Returns an itemized list of all fee items for a student's class,
 * indicating whether each item is applied or unassigned/exempted.
 */
export function getStudentItemizedFeeList(
  student: Student,
  structures: FeeStructure[],
  currentTerm: string
): { fee: FeeStructure; isApplicable: boolean; effectiveAmount: number }[] {
  if (!student || !student.classId) return [];

  return structures
    .filter((s) => s.classId === student.classId && areTermsMatching(s.term, currentTerm))
    .map((fee) => {
      const isApplicable = isFeeApplicableToStudent(fee, student.studentId);
      return {
        fee,
        isApplicable,
        effectiveAmount: isApplicable ? fee.amount || 0 : 0,
      };
    });
}
