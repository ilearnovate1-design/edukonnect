/**
 * Assessment Calculation Engine for EduKonnect
 * 
 * Central, deterministic, reusable calculation engine for school grading,
 * weighted continuous assessments, grade band assignments, and cohort broadsheets.
 */

import { 
  GradingProfile, 
  AssessmentComponentConfig, 
  GradeBand, 
  Result, 
  RoundingPolicy, 
  PromotionRuleConfig,
  GradingLevelCategory 
} from '../types';

export interface ScoreValidationIssue {
  componentId: string;
  studentId: string;
  type: 'OUT_OF_RANGE' | 'MISSING' | 'INVALID_NUMBER';
  message: string;
  score?: number | null;
  maxScore?: number;
}

export interface CalculatedSubjectScore {
  totalScore: number;
  grade: string;
  remark: string;
  gradePoint?: number;
  isIncomplete: boolean;
  isMissingAny: boolean;
  missingComponentIds: string[];
  invalidComponentIds: string[];
  rawComponentScores: Record<string, number | null>;
  normalizedPercentage: number;
}

export interface StudentTermSummary {
  studentId: string;
  totalMarksObtained: number;
  totalPossibleMarks: number;
  averageScore: number; // Rounded according to policy
  gpa?: number;
  subjectsCount: number;
  passedCount: number;
  failedCount: number;
  hasIncompleteSubjects: boolean;
  verdict?: string; // "PASSED WITH DISTINCTION", "PROMOTED", etc.
  promotionEligible?: boolean;
  classPosition?: number;
}

export interface ClassBroadsheetSummary {
  classId: string;
  academicSession: string;
  term: string;
  studentsCount: number;
  subjectAverages: Record<string, number>; // subjectId -> class average
  classOverallAverage: number;
  highestAverage: number;
  lowestAverage: number;
  studentSummaries: Record<string, StudentTermSummary>; // studentId -> summary
}

/**
 * Standard rounding utility following specified policy
 */
export const applyRounding = (value: number, policy: RoundingPolicy = 'ROUND_HALF_UP_INTEGER'): number => {
  if (isNaN(value)) return 0;
  switch (policy) {
    case 'ROUND_HALF_UP_1DECIMAL':
      return Math.round(value * 10) / 10;
    case 'ROUND_HALF_UP_2DECIMAL':
      return Math.round(value * 100) / 100;
    case 'ROUND_HALF_UP_INTEGER':
    default:
      return Math.round(value);
  }
};

/**
 * Validates a single component score against configured bounds
 */
export const validateComponentScore = (
  score: number | null | undefined,
  component: AssessmentComponentConfig
): { valid: boolean; issue?: 'MISSING' | 'OUT_OF_RANGE' | 'INVALID_NUMBER' } => {
  if (score === null || score === undefined || (typeof score === 'string' && (score as string).trim() === '')) {
    return component.optional ? { valid: true } : { valid: false, issue: 'MISSING' };
  }
  const num = typeof score === 'number' ? score : parseFloat(score);
  if (isNaN(num)) {
    return { valid: false, issue: 'INVALID_NUMBER' };
  }
  if (num < 0 || num > component.maxScore) {
    return { valid: false, issue: 'OUT_OF_RANGE' };
  }
  return { valid: true };
};

/**
 * Validates grade bands for consistency:
 * - Checks for overlapping ranges
 * - Checks that min <= max
 * - Checks for gaps between 0 and 100
 */
export const validateGradeBands = (bands: GradeBand[]): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!bands || bands.length === 0) {
    errors.push('At least one grade band is required.');
    return { valid: false, errors };
  }

  // Check each band bounds
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    if (band.min < 0 || band.max > 100) {
      errors.push(`Grade "${band.grade}" range [${band.min}, ${band.max}] is outside allowable scale [0, 100].`);
    }
    if (band.min > band.max) {
      errors.push(`Grade "${band.grade}" has minimum (${band.min}) greater than maximum (${band.max}).`);
    }
    if (!band.grade.trim()) {
      errors.push(`Grade band #${i + 1} has an empty grade label.`);
    }
  }

  // Check overlaps
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const b1 = bands[i];
      const b2 = bands[j];
      const overlap = !(b1.max < b2.min || b1.min > b2.max);
      if (overlap) {
        errors.push(
          `Overlapping grade ranges detected: "${b1.grade}" [${b1.min}-${b1.max}] and "${b2.grade}" [${b2.min}-${b2.max}].`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validates full grading profile configuration before activation
 */
export const validateGradingProfile = (profile: Partial<GradingProfile>): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!profile.name || !profile.name.trim()) {
    errors.push('Profile name is required.');
  }
  if (!profile.components || profile.components.length === 0) {
    errors.push('At least one assessment component is required.');
  } else {
    let totalWeight = 0;
    let totalMax = 0;
    profile.components.forEach((c, idx) => {
      if (!c.name || !c.name.trim()) {
        errors.push(`Component #${idx + 1} is missing a name.`);
      }
      if (c.maxScore <= 0) {
        errors.push(`Component "${c.name || `#${idx + 1}`}" maximum score must be greater than 0.`);
      }
      totalMax += c.maxScore || 0;
      totalWeight += c.weight || 0;
    });

    if (profile.calculationMethod === 'WEIGHTED_PERCENTAGE') {
      if (Math.abs(totalWeight - 100) > 0.01) {
        errors.push(`Component weights must sum to exactly 100% (currently ${totalWeight}%).`);
      }
    } else if (profile.calculationMethod === 'SUM') {
      if (totalMax <= 0) {
        errors.push('Total maximum sum of assessment components must be greater than 0.');
      }
    }
  }

  if (profile.gradeBands) {
    const bandCheck = validateGradeBands(profile.gradeBands);
    if (!bandCheck.valid) {
      errors.push(...bandCheck.errors);
    }
  } else {
    errors.push('Grading bands must be configured.');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Calculates subject total score, grade, and remark from component scores
 */
export const calculateSubjectResult = (
  componentScores: Record<string, number | null | undefined>,
  profile: GradingProfile
): CalculatedSubjectScore => {
  const missingComponentIds: string[] = [];
  const invalidComponentIds: string[] = [];
  const cleanScores: Record<string, number | null> = {};

  let computedScore = 0;
  let totalMaxScore = 0;

  for (const component of profile.components) {
    const rawVal = componentScores[component.id];
    const validation = validateComponentScore(rawVal, component);

    if (!validation.valid) {
      if (validation.issue === 'MISSING') {
        missingComponentIds.push(component.id);
        cleanScores[component.id] = null;
      } else {
        invalidComponentIds.push(component.id);
        cleanScores[component.id] = null;
      }
    } else {
      const numVal = rawVal !== null && rawVal !== undefined
        ? (typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal)))
        : null;
      cleanScores[component.id] = isNaN(numVal as number) ? null : numVal;
    }
  }

  const isMissingAny = missingComponentIds.length > 0;
  const isIncomplete = isMissingAny && !profile.treatMissingAsZero;

  if (profile.calculationMethod === 'WEIGHTED_PERCENTAGE') {
    // Weighted percentage calculation: Sum of ((score / maxScore) * weight)
    for (const component of profile.components) {
      const score = cleanScores[component.id];
      const effectiveScore = score !== null && score !== undefined 
        ? score 
        : (profile.treatMissingAsZero ? 0 : 0);
      
      if (score !== null && score !== undefined) {
        const weighted = (effectiveScore / component.maxScore) * component.weight;
        computedScore += weighted;
      } else if (profile.treatMissingAsZero) {
        // missing treated as 0 adds 0 to score
      }
    }
  } else {
    // Simple SUM calculation
    for (const component of profile.components) {
      const score = cleanScores[component.id];
      totalMaxScore += component.maxScore;
      if (score !== null && score !== undefined) {
        computedScore += score;
      } else if (profile.treatMissingAsZero) {
        // Treated as 0
      }
    }
  }

  // Round according to rounding policy
  const roundedTotal = applyRounding(computedScore, profile.roundingPolicy);
  
  // Normalized percentage out of 100
  let normalizedPct = roundedTotal;
  if (profile.calculationMethod === 'SUM' && totalMaxScore > 0 && totalMaxScore !== 100) {
    normalizedPct = applyRounding((computedScore / totalMaxScore) * 100, profile.roundingPolicy);
  }

  // Find matching grade band based on normalized score (or raw score if max is 100)
  const scoreForGrading = normalizedPct;
  let matchingBand: GradeBand | undefined = undefined;

  // Search bands (ordered by min descending or exact bracket)
  for (const band of profile.gradeBands) {
    if (scoreForGrading >= band.min && scoreForGrading <= band.max) {
      matchingBand = band;
      break;
    }
  }

  // Fallback if boundary rounding hits 100.01 or -0.01
  if (!matchingBand && profile.gradeBands.length > 0) {
    if (scoreForGrading >= 100) {
      matchingBand = [...profile.gradeBands].sort((a, b) => b.max - a.max)[0];
    } else if (scoreForGrading <= 0) {
      matchingBand = [...profile.gradeBands].sort((a, b) => a.min - b.min)[0];
    }
  }

  const grade = isIncomplete 
    ? (profile.treatMissingAsZero ? (matchingBand?.grade || 'F') : 'INC') 
    : (matchingBand?.grade || '—');
  
  const remark = isIncomplete 
    ? (profile.treatMissingAsZero ? (matchingBand?.remark || 'Incomplete') : 'Incomplete Assessment') 
    : (matchingBand?.remark || 'No Remark');

  const gradePoint = matchingBand?.gradePoint;

  return {
    totalScore: roundedTotal,
    grade,
    remark,
    gradePoint,
    isIncomplete,
    isMissingAny,
    missingComponentIds,
    invalidComponentIds,
    rawComponentScores: cleanScores,
    normalizedPercentage: normalizedPct,
  };
};

/**
 * Calculates a student's term summary including average, GPA, and promotion verdict
 */
export const calculateStudentTermSummary = (
  results: Result[],
  profile: GradingProfile,
  allClassStudentAverages?: { studentId: string; average: number }[]
): StudentTermSummary => {
  const studentId = results[0]?.studentId || '';
  if (results.length === 0) {
    return {
      studentId,
      totalMarksObtained: 0,
      totalPossibleMarks: 0,
      averageScore: 0,
      subjectsCount: 0,
      passedCount: 0,
      failedCount: 0,
      hasIncompleteSubjects: false,
    };
  }

  let totalObtained = 0;
  let totalPossible = 0;
  let gradePointsSum = 0;
  let gradePointsCount = 0;
  let passedCount = 0;
  let failedCount = 0;
  let hasIncomplete = false;

  const standardMaxPerSubject = profile.calculationMethod === 'SUM'
    ? profile.components.reduce((sum, c) => sum + c.maxScore, 0)
    : 100;

  for (const r of results) {
    if (r.isIncomplete || r.grade === 'INC') {
      hasIncomplete = true;
    }

    totalObtained += r.totalScore || 0;
    totalPossible += standardMaxPerSubject;

    if (r.gradePoint !== undefined && r.gradePoint !== null) {
      gradePointsSum += r.gradePoint;
      gradePointsCount++;
    }

    // Determine pass vs fail
    const isFail = r.grade === 'F' || r.grade === 'F9' || (r.totalScore < 40);
    if (isFail) {
      failedCount++;
    } else {
      passedCount++;
    }
  }

  const rawAverage = results.length > 0 ? totalObtained / results.length : 0;
  const averageScore = applyRounding(rawAverage, profile.roundingPolicy);
  const gpa = gradePointsCount > 0 ? applyRounding(gradePointsSum / gradePointsCount, 'ROUND_HALF_UP_2DECIMAL') : undefined;

  // Promotion Rule check
  let verdict: string | undefined = undefined;
  let promotionEligible: boolean | undefined = undefined;

  if (profile.promotionRule?.enabled) {
    const minAvg = profile.promotionRule.minAverageScore || 50;
    let meetsSubjectRequirements = true;

    if (profile.promotionRule.requiredPassSubjectIds && profile.promotionRule.requiredPassSubjectIds.length > 0) {
      for (const requiredSubId of profile.promotionRule.requiredPassSubjectIds) {
        const found = results.find(r => r.subjectId === requiredSubId);
        if (!found || found.totalScore < 40 || found.grade === 'F' || found.grade === 'F9') {
          meetsSubjectRequirements = false;
          break;
        }
      }
    }

    if (averageScore >= minAvg && meetsSubjectRequirements && !hasIncomplete) {
      promotionEligible = true;
      verdict = profile.promotionRule.verdictPromotedLabel || 'PROMOTED';
    } else if (averageScore >= (minAvg - 10) && !hasIncomplete) {
      promotionEligible = false;
      verdict = profile.promotionRule.verdictTrialLabel || 'PROMOTED ON TRIAL';
    } else {
      promotionEligible = false;
      verdict = profile.promotionRule.verdictRepeatLabel || 'REPEAT';
    }
  }

  // Class Position Calculation
  let classPosition: number | undefined = undefined;
  if (allClassStudentAverages && allClassStudentAverages.length > 0) {
    // Sort descending by average
    const sorted = [...allClassStudentAverages].sort((a, b) => b.average - a.average);
    const rankIndex = sorted.findIndex(s => s.studentId === studentId);
    if (rankIndex !== -1) {
      classPosition = rankIndex + 1;
    }
  }

  return {
    studentId,
    totalMarksObtained: applyRounding(totalObtained, profile.roundingPolicy),
    totalPossibleMarks: totalPossible,
    averageScore,
    gpa,
    subjectsCount: results.length,
    passedCount,
    failedCount,
    hasIncompleteSubjects: hasIncomplete,
    verdict,
    promotionEligible,
    classPosition,
  };
};

/**
 * Calculates a complete class broadsheet summary
 */
export const calculateClassBroadsheet = (
  classId: string,
  academicSession: string,
  term: string,
  allResults: Result[],
  profile: GradingProfile
): ClassBroadsheetSummary => {
  const studentMap: Record<string, Result[]> = {};
  const subjectScoresMap: Record<string, number[]> = {};

  for (const r of allResults) {
    if (!studentMap[r.studentId]) studentMap[r.studentId] = [];
    studentMap[r.studentId].push(r);

    if (!subjectScoresMap[r.subjectId]) subjectScoresMap[r.subjectId] = [];
    if (!r.isIncomplete && r.totalScore !== undefined) {
      subjectScoresMap[r.subjectId].push(r.totalScore);
    }
  }

  // Compute subject averages
  const subjectAverages: Record<string, number> = {};
  for (const [subId, scores] of Object.entries(subjectScoresMap)) {
    if (scores.length > 0) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      subjectAverages[subId] = applyRounding(avg, profile.roundingPolicy);
    } else {
      subjectAverages[subId] = 0;
    }
  }

  // Calculate preliminary averages for rankings
  const prelimAverages: { studentId: string; average: number }[] = [];
  for (const [sId, rList] of Object.entries(studentMap)) {
    const total = rList.reduce((sum, r) => sum + (r.totalScore || 0), 0);
    const avg = rList.length > 0 ? total / rList.length : 0;
    prelimAverages.push({ studentId: sId, average: avg });
  }

  // Calculate full student summaries
  const studentSummaries: Record<string, StudentTermSummary> = {};
  let classTotalAverages = 0;
  let highestAverage = 0;
  let lowestAverage = 100;

  for (const [sId, rList] of Object.entries(studentMap)) {
    const summary = calculateStudentTermSummary(rList, profile, prelimAverages);
    studentSummaries[sId] = summary;
    classTotalAverages += summary.averageScore;
    if (summary.averageScore > highestAverage) highestAverage = summary.averageScore;
    if (summary.averageScore < lowestAverage) lowestAverage = summary.averageScore;
  }

  const studentCount = Object.keys(studentMap).length;
  const classOverallAverage = studentCount > 0 
    ? applyRounding(classTotalAverages / studentCount, profile.roundingPolicy) 
    : 0;

  return {
    classId,
    academicSession,
    term,
    studentsCount: studentCount,
    subjectAverages,
    classOverallAverage,
    highestAverage: studentCount > 0 ? highestAverage : 0,
    lowestAverage: studentCount > 0 ? lowestAverage : 0,
    studentSummaries,
  };
};

/**
 * Pre-configured editable default grading profiles
 * Clearly labeled as editable reference templates, not official universal standards.
 */
export const DEFAULT_GRADING_PROFILES: Record<GradingLevelCategory, Omit<GradingProfile, 'schoolId'>> = {
  NURSERY: {
    profileId: 'profile-nursery-default',
    name: 'Early Years & Nursery Foundation (Configurable)',
    levelCategory: 'NURSERY',
    description: 'Developmental assessment based on classroom observation, activities, and terminal oral evaluation.',
    isDefault: true,
    calculationMethod: 'SUM',
    treatMissingAsZero: false,
    roundingPolicy: 'ROUND_HALF_UP_INTEGER',
    components: [
      { id: 'act', name: 'Class Activity & Practical', maxScore: 20, weight: 20 },
      { id: 'mid', name: 'Mid-Term Review', maxScore: 20, weight: 20 },
      { id: 'oral', name: 'Terminal Evaluation', maxScore: 60, weight: 60 },
    ],
    gradeBands: [
      { min: 80, max: 100, grade: 'EX', remark: 'Exceeding Expectations', gradePoint: 4.0 },
      { min: 65, max: 79, grade: 'ME', remark: 'Meeting Expectations', gradePoint: 3.0 },
      { min: 50, max: 64, grade: 'EM', remark: 'Emerging Skills', gradePoint: 2.0 },
      { min: 0, max: 49, grade: 'ND', remark: 'Needs Development', gradePoint: 1.0 },
    ],
    displaySettings: {
      showAttendance: true,
      showPosition: false,
      showClassAverage: false,
      showStudentAverage: true,
      showGradePoints: false,
      showComponentBreakdown: true,
      showPromotionStatus: true,
      showAffectiveTraits: true,
      showTeacherRemarks: true,
      showPrincipalRemarks: true,
      showNextTermDate: true,
      showOfficialSeal: true,
    },
    promotionRule: {
      enabled: false,
      minAverageScore: 50,
      automaticVerdict: true,
      verdictPromotedLabel: 'PROMOTED TO NEXT GRADE',
      verdictTrialLabel: 'PROMOTED ON TRIAL',
      verdictRepeatLabel: 'RECOMMENDED TO REPEAT',
    },
    version: 1,
  },
  PRIMARY: {
    profileId: 'profile-primary-default',
    name: 'Primary School Continuous Assessment Standard (Configurable)',
    levelCategory: 'PRIMARY',
    description: 'Standard 40% Continuous Assessment (CA1 10%, CA2 10%, Midterm 20%) and 60% Terminal Examination.',
    isDefault: true,
    calculationMethod: 'SUM',
    treatMissingAsZero: false,
    roundingPolicy: 'ROUND_HALF_UP_INTEGER',
    components: [
      { id: 'ca1', name: '1st CA (Assignments)', maxScore: 10, weight: 10 },
      { id: 'ca2', name: '2nd CA (Projects & Quiz)', maxScore: 10, weight: 10 },
      { id: 'mid', name: 'Mid-Term Test', maxScore: 20, weight: 20 },
      { id: 'exam', name: 'Terminal Examination', maxScore: 60, weight: 60 },
    ],
    gradeBands: [
      { min: 75, max: 100, grade: 'A', remark: 'Excellent', gradePoint: 5.0 },
      { min: 65, max: 74, grade: 'B', remark: 'Very Good', gradePoint: 4.0 },
      { min: 50, max: 64, grade: 'C', remark: 'Good', gradePoint: 3.0 },
      { min: 40, max: 49, grade: 'D', remark: 'Pass', gradePoint: 2.0 },
      { min: 0, max: 39, grade: 'F', remark: 'Fail', gradePoint: 0.0 },
    ],
    displaySettings: {
      showAttendance: true,
      showPosition: true,
      showClassAverage: true,
      showStudentAverage: true,
      showGradePoints: false,
      showComponentBreakdown: true,
      showPromotionStatus: true,
      showAffectiveTraits: true,
      showTeacherRemarks: true,
      showPrincipalRemarks: true,
      showNextTermDate: true,
      showOfficialSeal: true,
    },
    promotionRule: {
      enabled: true,
      minAverageScore: 50,
      automaticVerdict: true,
      verdictPromotedLabel: 'PROMOTED TO NEXT CLASS',
      verdictTrialLabel: 'PROMOTED ON TRIAL',
      verdictRepeatLabel: 'TO REPEAT CLASS',
    },
    version: 1,
  },
  JSS: {
    profileId: 'profile-jss-default',
    name: 'Junior Secondary School (JSS 1-3) Standard (Configurable)',
    levelCategory: 'JSS',
    description: '30% Continuous Assessment (Test 15%, Project 15%) and 70% Terminal Examination.',
    isDefault: true,
    calculationMethod: 'SUM',
    treatMissingAsZero: false,
    roundingPolicy: 'ROUND_HALF_UP_INTEGER',
    components: [
      { id: 'ca1', name: '1st CA Test', maxScore: 15, weight: 15 },
      { id: 'ca2', name: '2nd CA / Project', maxScore: 15, weight: 15 },
      { id: 'exam', name: 'Terminal Examination', maxScore: 70, weight: 70 },
    ],
    gradeBands: [
      { min: 75, max: 100, grade: 'A', remark: 'Distinction', gradePoint: 5.0 },
      { min: 65, max: 74, grade: 'B', remark: 'Upper Credit', gradePoint: 4.0 },
      { min: 50, max: 64, grade: 'C', remark: 'Credit', gradePoint: 3.0 },
      { min: 40, max: 49, grade: 'P', remark: 'Pass', gradePoint: 2.0 },
      { min: 0, max: 39, grade: 'F', remark: 'Fail', gradePoint: 0.0 },
    ],
    displaySettings: {
      showAttendance: true,
      showPosition: true,
      showClassAverage: true,
      showStudentAverage: true,
      showGradePoints: true,
      showComponentBreakdown: true,
      showPromotionStatus: true,
      showAffectiveTraits: true,
      showTeacherRemarks: true,
      showPrincipalRemarks: true,
      showNextTermDate: true,
      showOfficialSeal: true,
    },
    promotionRule: {
      enabled: true,
      minAverageScore: 50,
      automaticVerdict: true,
      verdictPromotedLabel: 'PROMOTED',
      verdictTrialLabel: 'PROMOTED ON TRIAL',
      verdictRepeatLabel: 'REPEAT CLASS',
    },
    version: 1,
  },
  SSS: {
    profileId: 'profile-sss-default',
    name: 'Senior Secondary School (SSS 1-3) 9-Point Scale (Configurable)',
    levelCategory: 'SSS',
    description: 'WAEC / NECO compliant 9-point scale with 30% Continuous Assessment and 70% Final Exam.',
    isDefault: true,
    calculationMethod: 'SUM',
    treatMissingAsZero: false,
    roundingPolicy: 'ROUND_HALF_UP_INTEGER',
    components: [
      { id: 'ca1', name: 'Continuous Assessment', maxScore: 30, weight: 30 },
      { id: 'exam', name: 'Terminal Examination', maxScore: 70, weight: 70 },
    ],
    gradeBands: [
      { min: 75, max: 100, grade: 'A1', remark: 'Excellent', gradePoint: 5.0 },
      { min: 70, max: 74, grade: 'B2', remark: 'Very Good', gradePoint: 4.0 },
      { min: 65, max: 69, grade: 'B3', remark: 'Good', gradePoint: 3.5 },
      { min: 60, max: 64, grade: 'C4', remark: 'Credit', gradePoint: 3.0 },
      { min: 55, max: 59, grade: 'C5', remark: 'Credit', gradePoint: 2.5 },
      { min: 50, max: 54, grade: 'C6', remark: 'Credit', gradePoint: 2.0 },
      { min: 45, max: 49, grade: 'D7', remark: 'Pass', gradePoint: 1.5 },
      { min: 40, max: 44, grade: 'E8', remark: 'Fair', gradePoint: 1.0 },
      { min: 0, max: 39, grade: 'F9', remark: 'Fail', gradePoint: 0.0 },
    ],
    displaySettings: {
      showAttendance: true,
      showPosition: true,
      showClassAverage: true,
      showStudentAverage: true,
      showGradePoints: true,
      showComponentBreakdown: true,
      showPromotionStatus: true,
      showAffectiveTraits: true,
      showTeacherRemarks: true,
      showPrincipalRemarks: true,
      showNextTermDate: true,
      showOfficialSeal: true,
    },
    promotionRule: {
      enabled: true,
      minAverageScore: 50,
      automaticVerdict: true,
      verdictPromotedLabel: 'PROMOTED TO NEXT CLASS',
      verdictTrialLabel: 'PROMOTED ON TRIAL',
      verdictRepeatLabel: 'REPEAT CLASS',
    },
    version: 1,
  },
  CUSTOM: {
    profileId: 'profile-custom-default',
    name: 'Custom Institution Grading Template (Configurable)',
    levelCategory: 'CUSTOM',
    description: 'Fully customizable assessment structure and boundary definitions.',
    isDefault: false,
    calculationMethod: 'SUM',
    treatMissingAsZero: false,
    roundingPolicy: 'ROUND_HALF_UP_INTEGER',
    components: [
      { id: 'ca', name: 'Continuous Assessment', maxScore: 40, weight: 40 },
      { id: 'exam', name: 'Terminal Examination', maxScore: 60, weight: 60 },
    ],
    gradeBands: [
      { min: 70, max: 100, grade: 'A', remark: 'Distinction', gradePoint: 5.0 },
      { min: 60, max: 69, grade: 'B', remark: 'Very Good', gradePoint: 4.0 },
      { min: 50, max: 59, grade: 'C', remark: 'Credit', gradePoint: 3.0 },
      { min: 45, max: 49, grade: 'D', remark: 'Pass', gradePoint: 2.0 },
      { min: 40, max: 44, grade: 'E', remark: 'Fair', gradePoint: 1.0 },
      { min: 0, max: 39, grade: 'F', remark: 'Fail', gradePoint: 0.0 },
    ],
    displaySettings: {
      showAttendance: true,
      showPosition: true,
      showClassAverage: true,
      showStudentAverage: true,
      showGradePoints: false,
      showComponentBreakdown: true,
      showPromotionStatus: true,
      showAffectiveTraits: true,
      showTeacherRemarks: true,
      showPrincipalRemarks: true,
      showNextTermDate: true,
      showOfficialSeal: true,
    },
    version: 1,
  },
};
