/**
 * CSV Import / Export Helper for EduKonnect Assessment Scores
 */

import { Student, AssessmentComponentConfig, GradingProfile } from '../types';

/**
 * Generates CSV template string for marks entry based on active components
 */
export const generateResultsCsvTemplate = (
  students: Student[],
  components: AssessmentComponentConfig[],
  subjectName: string,
  className: string
): string => {
  const componentHeaders = components.map(c => `"${c.name} (Max ${c.maxScore})"`).join(',');
  const header = `"Admission Number","Student Name","Student ID",${componentHeaders}\n`;

  const rows = students.map((s) => {
    const fullName = `${s.firstName} ${s.lastName}`.replace(/"/g, '""');
    const emptyScores = components.map(() => '').join(',');
    return `"${s.admissionNumber || ''}","${fullName}","${s.studentId}",${emptyScores}`;
  }).join('\n');

  return header + rows;
};

export interface ParsedCsvScoreRow {
  studentId: string;
  admissionNumber: string;
  studentName: string;
  componentScores: Record<string, number | null>;
  errors: string[];
}

/**
 * Parses uploaded CSV content and maps to student scores with validation
 */
export const parseResultsCsv = (
  csvText: string,
  students: Student[],
  components: AssessmentComponentConfig[]
): { rows: ParsedCsvScoreRow[]; totalErrors: number } => {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], totalErrors: 1 };
  }

  // Parse header
  const headerCols = parseCsvLine(lines[0]);
  
  // Map column index to component
  const componentColMap: Record<number, AssessmentComponentConfig> = {};
  components.forEach((comp, idx) => {
    // Look for component name in header columns
    const foundIdx = headerCols.findIndex(h => 
      h.toLowerCase().includes(comp.name.toLowerCase()) || 
      h.toLowerCase().includes(comp.id.toLowerCase())
    );
    if (foundIdx !== -1) {
      componentColMap[foundIdx] = comp;
    } else {
      // Fallback: 3 + idx
      if (3 + idx < headerCols.length) {
        componentColMap[3 + idx] = comp;
      }
    }
  });

  const parsedRows: ParsedCsvScoreRow[] = [];
  let totalErrors = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 2) continue;

    const admissionNum = (cols[0] || '').trim();
    const studentName = (cols[1] || '').trim();
    const studentIdCol = (cols[2] || '').trim();

    // Match student
    let matchedStudent = students.find(s => 
      (studentIdCol && s.studentId === studentIdCol) ||
      (admissionNum && s.admissionNumber.toLowerCase() === admissionNum.toLowerCase()) ||
      (s.firstName.toLowerCase() + ' ' + s.lastName.toLowerCase() === studentName.toLowerCase())
    );

    const rowErrors: string[] = [];
    if (!matchedStudent) {
      rowErrors.push(`Student not found: ${studentName || admissionNum}`);
      totalErrors++;
    }

    const compScores: Record<string, number | null> = {};

    for (const [colIdxStr, comp] of Object.entries(componentColMap)) {
      const colIdx = parseInt(colIdxStr, 10);
      const rawVal = cols[colIdx]?.trim();

      if (!rawVal || rawVal === '') {
        compScores[comp.id] = null;
      } else {
        const num = parseFloat(rawVal);
        if (isNaN(num)) {
          rowErrors.push(`Invalid number for ${comp.name}: "${rawVal}"`);
          compScores[comp.id] = null;
          totalErrors++;
        } else if (num < 0 || num > comp.maxScore) {
          rowErrors.push(`Score ${num} for ${comp.name} exceeds max ${comp.maxScore}`);
          compScores[comp.id] = num;
          totalErrors++;
        } else {
          compScores[comp.id] = num;
        }
      }
    }

    if (matchedStudent) {
      parsedRows.push({
        studentId: matchedStudent.studentId,
        admissionNumber: matchedStudent.admissionNumber,
        studentName: `${matchedStudent.firstName} ${matchedStudent.lastName}`,
        componentScores: compScores,
        errors: rowErrors,
      });
    }
  }

  return { rows: parsedRows, totalErrors };
};

/**
 * Simple standard CSV line parser handling quotes
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
