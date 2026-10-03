import { FeeStructure, Student } from '../types';

/**
 * Determines whether a given fee structure applies to a specific student.
 * Supports:
 * 1. Default (all students in class)
 * 2. Specific student assignments (only selected students are charged; others are ₦0)
 * 3. Student exemptions (all students in class except specified excluded students)
 * 4. Optional / Add-on fees
 */
export function isFeeApplicableToStudent(
  fee: FeeStructure,
  studentId: string
): boolean {
  if (!fee || !studentId) return false;

  // 1. Explicitly targeted to specific students
  if (fee.applicableTo === 'SPECIFIC_STUDENTS') {
    return Array.isArray(fee.assignedStudentIds) && fee.assignedStudentIds.includes(studentId);
  }

  // 2. Applied to class with specific exclusions/exemptions
  if (fee.applicableTo === 'EXCLUDE_STUDENTS') {
    return !Array.isArray(fee.excludedStudentIds) || !fee.excludedStudentIds.includes(studentId);
  }

  // 3. Backward compatibility: check assignedStudentIds if provided and non-empty
  if (Array.isArray(fee.assignedStudentIds) && fee.assignedStudentIds.length > 0) {
    return fee.assignedStudentIds.includes(studentId);
  }

  // 4. Backward compatibility: check excludedStudentIds if provided
  if (Array.isArray(fee.excludedStudentIds) && fee.excludedStudentIds.includes(studentId)) {
    return false;
  }

  // 5. Optional fee with designated assignments
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
    .filter((s) => s.classId === student.classId && s.term === currentTerm)
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
    .filter((s) => s.classId === student.classId && s.term === currentTerm)
    .map((fee) => {
      const isApplicable = isFeeApplicableToStudent(fee, student.studentId);
      return {
        fee,
        isApplicable,
        effectiveAmount: isApplicable ? fee.amount || 0 : 0,
      };
    });
}
