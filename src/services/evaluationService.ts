import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { StudentEvaluation } from '../types';

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
  try {
    const evalId = getEvaluationId(studentId, term, academicSession);
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
  const evalId = evaluation.evaluationId || getEvaluationId(evaluation.studentId, evaluation.term, evaluation.academicSession);
  const docRef = doc(db, 'evaluations', evalId);
  
  await setDoc(
    docRef,
    {
      ...evaluation,
      schoolId: evaluation.schoolId || 'default',
      evaluationId: evalId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};
