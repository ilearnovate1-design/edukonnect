import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { StudentEvaluation } from '../types';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrors';

export const getEvaluationId = (studentId: string, term: string, academicSession: string): string => {
  const cleanTerm = term.replace(/[^a-zA-Z0-9]/g, '_');
  const cleanSession = academicSession.replace(/[^a-zA-Z0-9]/g, '_');
  return `eval_${studentId}_${cleanTerm}_${cleanSession}`;
};

export const getStudentEvaluation = async (
  studentId: string,
  term: string,
  academicSession: string
): Promise<StudentEvaluation | null> => {
  const evalId = getEvaluationId(studentId, term, academicSession);
  try {
    const docRef = doc(db, 'evaluations', evalId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as StudentEvaluation;
    }
    return null;
  } catch (error) {
    console.error('Error fetching student evaluation:', error);
    return null;
  }
};

export const saveStudentEvaluation = async (
  evaluation: Partial<StudentEvaluation> & { studentId: string; term: string; academicSession: string; schoolId?: string }
): Promise<void> => {
  const cleanSchoolId = (evaluation.schoolId || '').trim().toLowerCase();
  if (!cleanSchoolId || cleanSchoolId === 'default') {
    throw new Error('Verified school membership is required to save student evaluations.');
  }

  const evalId = evaluation.evaluationId || getEvaluationId(evaluation.studentId, evaluation.term, evaluation.academicSession);
  const docRef = doc(db, 'evaluations', evalId);

  const sanitized: Record<string, any> = {
    evaluationId: evalId,
    schoolId: cleanSchoolId,
    studentId: evaluation.studentId,
    term: evaluation.term,
    academicSession: evaluation.academicSession,
    updatedAt: serverTimestamp(),
  };

  Object.entries(evaluation).forEach(([key, val]) => {
    if (val !== undefined && key !== 'schoolId' && key !== 'evaluationId') {
      sanitized[key] = val;
    }
  });

  try {
    await setDoc(docRef, sanitized, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `evaluations/${evalId}`);
  }
};
