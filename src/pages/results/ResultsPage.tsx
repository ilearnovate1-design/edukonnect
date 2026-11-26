import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, getDocs, doc, query, where, setDoc, serverTimestamp 
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { 
  Student, 
  SchoolClass, 
  Subject, 
  Result, 
  Term, 
  GradingProfile, 
  ResultStatus, 
  ResultAuditEntry 
} from '../../types';
import { Button } from '../../components/common/Button';
import { Select } from '../../components/common/Input';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Modal } from '../../components/common/Modal';
import { ReportCardModal } from '../../components/results/ReportCardModal';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { logAudit } from '../../utils/formatters';
import { formatFriendlyFirestoreError } from '../../utils/firestoreErrors';
import {
  buildScopedResultId,
  diagnoseReportRuleDenial,
  evaluateReportConditionsSync,
  formatReportWriteFailure,
  isResultRecordLocked,
  verifyAndEvaluateReportAuthorization,
} from '../../services/reportAuthorizationService';
import { broadcastAnnouncementNotifications } from '../../services/notificationService';
import { 
  fetchGradingProfiles, 
  resolveGradingProfile 
} from '../../services/gradingProfileService';
import { 
  calculateSubjectResult, 
  calculateClassBroadsheet, 
  DEFAULT_GRADING_PROFILES, 
  ClassBroadsheetSummary 
} from '../../services/assessmentEngine';
import { 
  generateResultsCsvTemplate, 
  parseResultsCsv, 
  ParsedCsvScoreRow 
} from '../../utils/resultsCsvHelper';
import { 
  Award, 
  Save, 
  CheckCircle2, 
  Send, 
  Printer, 
  Eye, 
  BookOpen, 
  Sliders, 
  Upload, 
  Download, 
  AlertCircle, 
  AlertTriangle, 
  Clock, 
  Check, 
  ShieldCheck, 
  History, 
  FileSpreadsheet, 
  Layers,
  Sparkles,
  X
} from 'lucide-react';

interface StudentScoreDraft {
  studentId: string;
  componentScores: Record<string, number | null>;
  totalScore: number;
  grade: string;
  remark: string;
  gradePoint?: number;
  isIncomplete: boolean;
  isMissingAny: boolean;
  status: ResultStatus;
  originalResult?: Result;
}

export const ResultsPage: React.FC = () => {
  const { role, currentUser, currentTeacher, activeMembership, isAtLeastAdmin, isSuperAdmin } = useAuth();
  const { settings, schoolId } = useSchool();
  const verifiedSchoolId = (schoolId || '').trim().toLowerCase();

  // Navigation & View mode
  const [activeView, setActiveView] = useState<'subject_entry' | 'broadsheet'>('subject_entry');

  // Core Data
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [gradingProfiles, setGradingProfiles] = useState<GradingProfile[]>([]);

  // Selections
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedTerm, setSelectedTerm] = useState<Term>(settings.currentTerm);
  const [selectedSession, setSelectedSession] = useState(settings.currentAcademicSession);
  const [manualProfileId, setManualProfileId] = useState<string>('');

  // Active Draft Scores Map: studentId -> StudentScoreDraft
  const [scoresMap, setScoresMap] = useState<Map<string, StudentScoreDraft>>(new Map());

  // Broadsheet State (All results for class in this session/term)
  const [allClassResults, setAllClassResults] = useState<Result[]>([]);
  const [broadsheetSummary, setBroadsheetSummary] = useState<ClassBroadsheetSummary | null>(null);
  const [loadingBroadsheet, setLoadingBroadsheet] = useState(false);

  // Loading & Feedback
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Controlled Revision Modal (for modifying PUBLISHED records)
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [pendingSaveStatus, setPendingSaveStatus] = useState<ResultStatus>('PUBLISHED');
  const [pendingWriteContext, setPendingWriteContext] = useState<{
    resolvedResultIds?: Map<string, string>;
    liveExistingResultsMap?: Map<string, Partial<Result> & { locked?: boolean }>;
    verifiedTeacherDocId?: string | null;
    conditionsSummary?: Record<string, { passed: boolean; detail: string }>;
  } | null>(null);

  // CSV Import Modal
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [csvPreviewRows, setCsvPreviewRows] = useState<ParsedCsvScoreRow[]>([]);
  const [csvErrorsCount, setCsvErrorsCount] = useState(0);

  // Report Card Modal
  const [selectedStudentForReport, setSelectedStudentForReport] = useState<Student | null>(null);
  const [studentAllResults, setStudentAllResults] = useState<Result[]>([]);

  const selectedClass = useMemo(() => {
    return classes.find(c => c.classId === selectedClassId) || null;
  }, [classes, selectedClassId]);

  const selectedSubject = useMemo(() => {
    return subjects.find(s => s.subjectId === selectedSubjectId) || null;
  }, [subjects, selectedSubjectId]);

  const effectivePreviewUid =
    isSuperAdmin && role === 'TEACHER' && currentTeacher?.userId
      ? currentTeacher.userId
      : currentUser?.uid;

  const isRowLockedForCurrentUser = (draft?: StudentScoreDraft): boolean => {
    if (isAtLeastAdmin) return false;
    if (!draft) return false;
    const candidate = draft.originalResult
      ? draft.originalResult
      : ({ status: draft.status } as Partial<Result>);
    return isResultRecordLocked(
      candidate,
      effectivePreviewUid,
      currentTeacher?.teacherId,
      isAtLeastAdmin
    ).locked;
  };

  // Active Grading Profile resolution
  const activeProfile = useMemo<GradingProfile>(() => {
    if (manualProfileId && gradingProfiles.length > 0) {
      const match = gradingProfiles.find(p => p.profileId === manualProfileId);
      if (match) return match;
    }
    return resolveGradingProfile(gradingProfiles, selectedClass, selectedSubjectId);
  }, [gradingProfiles, selectedClass, selectedSubjectId, manualProfileId]);

  // 1. Fetch Classes, Subjects, and Grading Profiles (strictly scoped by schoolId)
  useEffect(() => {
    const fetchBase = async () => {
      if (!verifiedSchoolId) {
        setClasses([]);
        setSubjects([]);
        setLoading(false);
        return;
      }

      try {
        // Classes
        const cSnap = await getDocs(
          query(collection(db, 'classes'), where('schoolId', '==', verifiedSchoolId))
        );
        let cList: SchoolClass[] = [];
        cSnap.forEach((d) => {
          const item = d.data() as SchoolClass;
          if ((item.schoolId || '').trim().toLowerCase() === verifiedSchoolId) {
            cList.push({ ...item, classId: item.classId || d.id });
          }
        });

        if (role === 'TEACHER') {
          if (!currentTeacher) {
            cList = [];
          } else {
            const assignedIds = currentTeacher.assignedClassIds || [];
            cList = cList.filter(
              (c) =>
                assignedIds.includes(c.classId) ||
                (!!currentTeacher.teacherId && c.classTeacherId === currentTeacher.teacherId) ||
                (!!currentTeacher.userId && c.classTeacherId === currentTeacher.userId)
            );
          }
        }

        setClasses(cList);
        if (cList.length > 0 && (!selectedClassId || !cList.some(c => c.classId === selectedClassId))) {
          setSelectedClassId(cList[0].classId);
        } else if (cList.length === 0) {
          setSelectedClassId('');
        }

        // Subjects
        const subSnap = await getDocs(
          query(collection(db, 'subjects'), where('schoolId', '==', verifiedSchoolId))
        );
        let subList: Subject[] = [];
        subSnap.forEach((d) => {
          const item = d.data() as Subject;
          if ((item.schoolId || '').trim().toLowerCase() === verifiedSchoolId) {
            subList.push({ ...item, subjectId: item.subjectId || d.id });
          }
        });

        if (role === 'TEACHER' && currentTeacher?.subjects && currentTeacher.subjects.length > 0) {
          const allowedSubjects = new Set(currentTeacher.subjects);
          subList = subList.filter((s) => allowedSubjects.has(s.subjectId) || allowedSubjects.has(s.name));
        }

        setSubjects(subList);
        if (subList.length > 0 && (!selectedSubjectId || !subList.some(s => s.subjectId === selectedSubjectId))) {
          setSelectedSubjectId(subList[0].subjectId);
        } else if (subList.length === 0) {
          setSelectedSubjectId('');
        }

        // Grading Profiles
        const profs = await fetchGradingProfiles(verifiedSchoolId);
        setGradingProfiles(profs);
      } catch (err: any) {
        console.error('Error fetching base data:', err);
        setErrorMsg(formatFriendlyFirestoreError(err, 'load classes and subjects'));
      }
    };
    fetchBase();
  }, [role, currentTeacher, verifiedSchoolId]);

  // 2. Fetch Students & Existing Scores for selected Class, Subject, Term, Session
  useEffect(() => {
    if (!selectedClassId || !verifiedSchoolId) {
      setLoading(false);
      return;
    }

    const fetchStudentsAndScores = async () => {
      setLoading(true);
      setSuccessMsg('');
      setErrorMsg('');
      try {
        // Students in active class (scoped to verifiedSchoolId)
        const sSnap = await getDocs(
          query(
            collection(db, 'students'),
            where('schoolId', '==', verifiedSchoolId),
            where('classId', '==', selectedClassId),
            where('status', '==', 'ACTIVE')
          )
        );
        const sList: Student[] = [];
        sSnap.forEach((d) => sList.push(d.data() as Student));
        sList.sort((a, b) => a.firstName.localeCompare(b.firstName));
        setStudents(sList);

        if (!selectedSubjectId) {
          setLoading(false);
          return;
        }

        // Results for this school + class + subject + term + session
        const rSnap = await getDocs(
          query(
            collection(db, 'results'),
            where('schoolId', '==', verifiedSchoolId),
            where('classId', '==', selectedClassId),
            where('subjectId', '==', selectedSubjectId),
            where('term', '==', selectedTerm),
            where('academicSession', '==', selectedSession)
          )
        );

        const existingResultsMap = new Map<string, Result>();
        rSnap.forEach((d) => {
          const r = d.data() as Result;
          existingResultsMap.set(r.studentId, { ...r, resultId: d.id });
        });

        const newDraftMap = new Map<string, StudentScoreDraft>();

        sList.forEach((s) => {
          const existing = existingResultsMap.get(s.studentId);
          let compScores: Record<string, number | null> = {};

          if (existing) {
            if (existing.componentScores && Object.keys(existing.componentScores).length > 0) {
              compScores = { ...existing.componentScores };
            } else {
              // Backward compatibility for legacy caScore and examScore
              compScores = {
                ca: existing.caScore ?? null,
                exam: existing.examScore ?? null,
              };
            }
          } else {
            // New draft: empty components
            activeProfile.components.forEach(c => {
              compScores[c.id] = null;
            });
          }

          // Calculate deterministic values
          const calculated = calculateSubjectResult(compScores, activeProfile);

          newDraftMap.set(s.studentId, {
            studentId: s.studentId,
            componentScores: compScores,
            totalScore: calculated.totalScore,
            grade: calculated.grade,
            remark: calculated.remark,
            gradePoint: calculated.gradePoint,
            isIncomplete: calculated.isIncomplete,
            isMissingAny: calculated.isMissingAny,
            status: existing ? existing.status : 'DRAFT',
            originalResult: existing,
          });
        });

        setScoresMap(newDraftMap);
      } catch (err: any) {
        console.error('Error fetching scores:', err);
        setErrorMsg(formatFriendlyFirestoreError(err, 'load class scores'));
      } finally {
        setLoading(false);
      }
    };

    fetchStudentsAndScores();
  }, [selectedClassId, selectedSubjectId, selectedTerm, selectedSession, activeProfile, verifiedSchoolId]);

  // 3. Load Broadsheet when broadsheet view is toggled
  useEffect(() => {
    if (activeView !== 'broadsheet' || !selectedClassId || !verifiedSchoolId) return;

    const fetchClassBroadsheet = async () => {
      setLoadingBroadsheet(true);
      try {
        const rSnap = await getDocs(
          query(
            collection(db, 'results'),
            where('schoolId', '==', verifiedSchoolId),
            where('classId', '==', selectedClassId),
            where('term', '==', selectedTerm),
            where('academicSession', '==', selectedSession)
          )
        );
        const rList: Result[] = [];
        rSnap.forEach(d => rList.push(d.data() as Result));
        setAllClassResults(rList);

        const summary = calculateClassBroadsheet(
          selectedClassId,
          selectedSession,
          selectedTerm,
          rList,
          activeProfile
        );
        setBroadsheetSummary(summary);
      } catch (err: any) {
        console.error('Error loading broadsheet:', err);
        setErrorMsg(formatFriendlyFirestoreError(err, 'load class broadsheet'));
      } finally {
        setLoadingBroadsheet(false);
      }
    };

    fetchClassBroadsheet();
  }, [activeView, selectedClassId, selectedTerm, selectedSession, activeProfile, verifiedSchoolId]);

  // Update a single component score for a student
  const handleScoreChange = (studentId: string, componentId: string, value: string) => {
    const updated = new Map<string, StudentScoreDraft>(scoresMap);
    const existing = updated.get(studentId);
    if (!existing || isRowLockedForCurrentUser(existing)) return;

    const compConfig = activeProfile.components.find(c => c.id === componentId);
    const max = compConfig?.maxScore || 100;

    let numVal: number | null = null;
    if (value.trim() !== '') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        numVal = parsed < 0 ? 0 : parsed > max ? max : parsed;
      }
    }

    const newComponentScores = {
      ...existing.componentScores,
      [componentId]: numVal,
    };

    // Real-time calculation using central calculation engine
    const calculated = calculateSubjectResult(newComponentScores, activeProfile);

    updated.set(studentId, {
      ...existing,
      componentScores: newComponentScores,
      totalScore: calculated.totalScore,
      grade: calculated.grade,
      remark: calculated.remark,
      gradePoint: calculated.gradePoint,
      isIncomplete: calculated.isIncomplete,
      isMissingAny: calculated.isMissingAny,
    });

    setScoresMap(updated);
  };

  // Workflow Save (Draft, Submit, Approve, Publish)
  const initiateSaveResults = async (statusToSet: ResultStatus) => {
    if (saving) return;
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedClassId || !selectedSubjectId) {
      setErrorMsg('Please select both a valid class and subject.');
      return;
    }

    const existingRows = students.map((s) => {
      const draft = scoresMap.get(s.studentId);
      return draft?.originalResult || ({ status: draft?.status || 'DRAFT' } as Partial<Result>);
    });

    const editableStudents = students.filter((s) => !isRowLockedForCurrentUser(scoresMap.get(s.studentId)));
    const cleanSession = selectedSession.replace(/[^a-zA-Z0-9]/g, '-');
    const cleanTerm = selectedTerm.replace(/\s+/g, '-');
    const targetResults = editableStudents.map((s) => {
      const draft = scoresMap.get(s.studentId);
      const scopedId = buildScopedResultId(
        verifiedSchoolId,
        s.studentId,
        selectedClassId,
        selectedSubjectId,
        cleanTerm,
        cleanSession
      );
      return {
        studentId: s.studentId,
        targetResultId: draft?.originalResult?.resultId || scopedId,
        hasOriginal: !!draft?.originalResult,
        classScopedResultId: scopedId,
      };
    });

    const { evaluation, liveMembership, liveTeacher, resolvedResultIds, liveExistingResultsMap } =
      await verifyAndEvaluateReportAuthorization({
        authUid: currentUser?.uid,
        authEmail: currentUser?.email,
        role,
        isSuperAdmin,
        isAtLeastAdmin,
        verifiedSchoolId,
        cachedMembership: activeMembership,
        cachedTeacher: currentTeacher,
        selectedClass,
        selectedSubject,
        term: selectedTerm,
        academicSession: selectedSession,
        targetStatus: statusToSet,
        existingResults: existingRows,
        targetResults,
      });

    if (!evaluation.authorized) {
      setErrorMsg(evaluation.userMessage);
      return;
    }

    const dbVerifiedTeacherId =
      liveTeacher?.teacherId || liveMembership?.teacherId || currentTeacher?.teacherId || null;
    const conditionsSummary = evaluation.conditions as Record<
      string,
      { passed: boolean; detail: string }
    >;

    if (editableStudents.length === 0) {
      const lockCheck = evaluateReportConditionsSync({
        authUid: currentUser?.uid,
        authEmail: currentUser?.email,
        role,
        isSuperAdmin,
        isAtLeastAdmin,
        verifiedSchoolId,
        membership: activeMembership,
        teacherProfile: currentTeacher,
        selectedClass,
        selectedSubject,
        targetStatus: statusToSet,
        existingResults: existingRows,
      });
      setErrorMsg(lockCheck.userMessage || 'All student reports in this sheet are locked.');
      return;
    }

    // Validation before submission/publication
    if (statusToSet === 'SUBMITTED' || statusToSet === 'PUBLISHED' || statusToSet === 'APPROVED') {
      const incompleteStudents: string[] = [];
      editableStudents.forEach((s) => {
        const entry = scoresMap.get(s.studentId);
        if (entry && entry.isIncomplete && !activeProfile.treatMissingAsZero) {
          incompleteStudents.push(`${s.firstName} ${s.lastName}`);
        }
      });

      if (incompleteStudents.length > 0 && !activeProfile.treatMissingAsZero) {
        if (statusToSet === 'PUBLISHED' || statusToSet === 'APPROVED') {
          setErrorMsg(
            `Cannot publish: ${incompleteStudents.length} student(s) have unentered marks (${incompleteStudents.slice(0, 3).join(', ')}${incompleteStudents.length > 3 ? '...' : ''}). Either enter marks or configure profile to treat missing scores as zero.`
          );
          return;
        }
      }
    }

    // Check if any existing result is already published (Admins revising published scores)
    let hasPublishedChanges = false;
    editableStudents.forEach((s) => {
      const entry = scoresMap.get(s.studentId);
      if (entry?.originalResult?.status === 'PUBLISHED') {
        const originalTotal = entry.originalResult.totalScore;
        if (originalTotal !== entry.totalScore) {
          hasPublishedChanges = true;
        }
      }
    });

    if (hasPublishedChanges) {
      setPendingSaveStatus(statusToSet);
      setPendingWriteContext({
        resolvedResultIds,
        liveExistingResultsMap,
        verifiedTeacherDocId: dbVerifiedTeacherId,
        conditionsSummary,
      });
      setShowRevisionModal(true);
      return;
    }

    executeSaveResults(statusToSet, undefined, {
      resolvedResultIds,
      liveExistingResultsMap,
      verifiedTeacherDocId: dbVerifiedTeacherId,
      conditionsSummary,
    });
  };

  const executeSaveResults = async (
    statusToSet: ResultStatus,
    reason?: string,
    writeContext?: {
      resolvedResultIds?: Map<string, string>;
      liveExistingResultsMap?: Map<string, Partial<Result> & { locked?: boolean }>;
      verifiedTeacherDocId?: string | null;
      conditionsSummary?: Record<string, { passed: boolean; detail: string }>;
    }
  ) => {
    if (!currentUser?.uid || !verifiedSchoolId) {
      setErrorMsg('Missing authenticated user or verified school membership.');
      return;
    }

    const actionVerb: 'save' | 'submit' | 'approve' | 'publish' =
      statusToSet === 'PUBLISHED'
        ? 'publish'
        : statusToSet === 'APPROVED'
        ? 'approve'
        : statusToSet === 'SUBMITTED'
        ? 'submit'
        : 'save';

    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      const profileSnapshot = {
        profileId: activeProfile.profileId,
        name: activeProfile.name,
        calculationMethod: activeProfile.calculationMethod,
        treatMissingAsZero: activeProfile.treatMissingAsZero,
        roundingPolicy: activeProfile.roundingPolicy,
        components: activeProfile.components,
        gradeBands: activeProfile.gradeBands,
        version: activeProfile.version,
      };

      const nowIso = new Date().toISOString();
      const cleanSession = selectedSession.replace(/[^a-zA-Z0-9]/g, '-');
      const cleanTerm = selectedTerm.replace(/\s+/g, '-');
      const savedResultIds = new Map<string, string>();
      const effectiveTeacherDocId = writeContext?.verifiedTeacherDocId ?? currentTeacher?.teacherId ?? null;
      const lockedSkippedCount = students.filter((s) => isRowLockedForCurrentUser(scoresMap.get(s.studentId))).length;
      const willLock = statusToSet === 'APPROVED' || statusToSet === 'PUBLISHED';

      interface PreparedResultWrite {
        studentId: string;
        resultId: string;
        docPath: string;
        operationType: 'CREATE' | 'UPDATE';
        currentStatus: string;
        lockStatus: boolean;
        ref: ReturnType<typeof doc>;
        payload: Record<string, any>;
      }

      const writeQueue: PreparedResultWrite[] = [];

      students.forEach((s) => {
        const item = scoresMap.get(s.studentId);
        if (!item) return;

        // Enforce student belongs to active verified school
        if (s.schoolId && s.schoolId.trim().toLowerCase() !== verifiedSchoolId) return;

        // Skip rows that teachers cannot edit (APPROVED/PUBLISHED/locked or owned by another teacher)
        if (isRowLockedForCurrentUser(item)) return;

        const serverExisting = writeContext?.liveExistingResultsMap?.get(s.studentId);
        const effectiveOriginal = item.originalResult || (serverExisting as Result | undefined);
        const serverLockInfo = serverExisting
          ? isResultRecordLocked(
              serverExisting,
              effectivePreviewUid || currentUser.uid,
              effectiveTeacherDocId,
              isAtLeastAdmin
            )
          : { locked: false };
        if (serverLockInfo.locked) {
          return;
        }

        const scopedFallbackId = buildScopedResultId(
          verifiedSchoolId,
          s.studentId,
          selectedClassId,
          selectedSubjectId,
          cleanTerm,
          cleanSession
        );
        const resultId =
          writeContext?.resolvedResultIds?.get(s.studentId) ||
          effectiveOriginal?.resultId ||
          scopedFallbackId;
        const ref = doc(db, 'results', resultId);

        const caScore = item.componentScores['ca'] ?? item.componentScores['ca1'] ?? 0;
        const examScore = item.componentScores['exam'] ?? item.totalScore ?? 0;

        // Clone auditHistory cleanly (never mutate existing state array)
        const auditHistory: ResultAuditEntry[] = [...(effectiveOriginal?.auditHistory || [])];
        if (effectiveOriginal && effectiveOriginal.status === 'PUBLISHED' && effectiveOriginal.totalScore !== item.totalScore) {
          auditHistory.push({
            timestamp: nowIso,
            userId: currentUser.uid,
            userName: currentUser.displayName || currentUser.email || 'User',
            action: 'UPDATED',
            previousScores: effectiveOriginal.componentScores,
            newScores: item.componentScores,
            previousTotal: effectiveOriginal.totalScore,
            newTotal: item.totalScore,
            previousGrade: effectiveOriginal.grade,
            newGrade: item.grade,
            reason: reason || 'Administrative correction',
          });
        }

        // Teachers always normalize teacherId to their verified auth UID so rules ownership passes cleanly
        const ownerUid = isAtLeastAdmin
          ? (effectiveOriginal?.teacherId || currentUser.uid)
          : isSuperAdmin
          ? (effectiveOriginal?.teacherId || currentTeacher?.userId || currentTeacher?.teacherId || currentUser.uid)
          : currentUser.uid;

        // Preserve exact immutable keys on existing docs so Firestore Rules equality never trips
        const docSchoolId = effectiveOriginal?.schoolId || verifiedSchoolId;
        const docStudentId = effectiveOriginal?.studentId || s.studentId;
        const docClassId = effectiveOriginal?.classId || selectedClassId;
        const docSubjectId = effectiveOriginal?.subjectId || selectedSubjectId;
        const docSession = effectiveOriginal?.academicSession || selectedSession;
        const docTerm = effectiveOriginal?.term || selectedTerm;

        const payload: Record<string, any> = {
          resultId,
          schoolId: docSchoolId,
          studentId: docStudentId,
          classId: docClassId,
          subjectId: docSubjectId,
          academicSession: docSession,
          term: docTerm,
          componentScores: item.componentScores,
          caScore,
          examScore,
          totalScore: item.totalScore,
          grade: item.grade,
          remark: item.remark,
          gradingProfileId: activeProfile.profileId,
          gradingProfileSnapshot: profileSnapshot,
          isIncomplete: item.isIncomplete,
          isMissingAny: item.isMissingAny,
          status: statusToSet,
          isLocked: willLock,
          teacherId: ownerUid,
          updatedAt: serverTimestamp(),
          auditHistory,
        };

        if (item.gradePoint !== undefined) {
          payload.gradePoint = item.gradePoint;
        }

        if (statusToSet === 'SUBMITTED') {
          payload.submittedBy = currentUser.uid;
          payload.submittedAt = serverTimestamp();
        }
        if (statusToSet === 'APPROVED' && isAtLeastAdmin) {
          payload.approvedBy = currentUser.uid;
          payload.approvedAt = serverTimestamp();
          payload.lockedBy = currentUser.uid;
          payload.lockedAt = serverTimestamp();
        }
        if (statusToSet === 'PUBLISHED' && isAtLeastAdmin) {
          payload.publishedBy = currentUser.uid;
          payload.publishedAt = serverTimestamp();
          payload.lockedBy = currentUser.uid;
          payload.lockedAt = serverTimestamp();
        }

        if (!effectiveOriginal?.createdAt) {
          payload.createdAt = serverTimestamp();
        } else {
          payload.createdAt = effectiveOriginal.createdAt;
        }

        const isUpdate = !!(serverExisting || item.originalResult);
        writeQueue.push({
          studentId: s.studentId,
          resultId,
          docPath: `results/${resultId}`,
          operationType: isUpdate ? 'UPDATE' : 'CREATE',
          currentStatus: effectiveOriginal?.status || item.status || 'NONE',
          lockStatus: Boolean(effectiveOriginal?.isLocked || (effectiveOriginal as any)?.locked),
          ref,
          payload,
        });
      });

      const count = writeQueue.length;
      if (count === 0) {
        setErrorMsg('No editable student reports were eligible to save.');
        return;
      }

      // Safe DEV-only pre-write diagnostics (no PII, tokens, or student names)
      if (import.meta.env?.DEV) {
        console.info('[ReportWriteDiagnostics] Pre-write payload summary:', {
          authUid: currentUser.uid,
          role,
          verifiedSchoolId,
          classId: selectedClassId,
          subjectId: selectedSubjectId,
          requestedStatus: statusToSet,
          writeMode: 'SINGLE_DOC_SET_MERGE',
          documentCount: count,
          authorizationChecks: writeContext?.conditionsSummary || {},
          operations: writeQueue.map((w) => ({
            docPath: w.docPath,
            resultId: w.resultId,
            reportSchoolId: w.payload.schoolId,
            classId: w.payload.classId,
            subjectId: w.payload.subjectId,
            currentStatus: w.currentStatus,
            requestedStatus: w.payload.status,
            lockStatus: w.lockStatus,
            operationType: w.operationType,
          })),
        });
      }

      // Condition K: Execute single-document writes in small bounded chunks (max 5 concurrent)
      // so Firestore evaluates each write independently (5 lookups <= 10 single-doc cap) and
      // never hits the 20-lookup multi-document WriteBatch cap across >= 5 students.
      const CONCURRENCY = 5;
      let failedEntry: PreparedResultWrite | null = null;
      let writeError: unknown = null;

      for (let i = 0; i < writeQueue.length; i += CONCURRENCY) {
        const chunk = writeQueue.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          chunk.map(async (entry) => {
            await setDoc(entry.ref, entry.payload, { merge: true });
            return entry;
          })
        );

        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j];
          const entry = chunk[j];
          if (outcome.status === 'fulfilled') {
            savedResultIds.set(entry.studentId, entry.resultId);
          } else if (!writeError) {
            failedEntry = entry;
            writeError = outcome.reason;
          }
        }

        if (writeError) break;
      }

      // Update local state statuses for any rows whose Firestore writes succeeded
      if (savedResultIds.size > 0) {
        const updated = new Map<string, StudentScoreDraft>(scoresMap);
        students.forEach((s) => {
          const usedResultId = savedResultIds.get(s.studentId);
          if (!usedResultId) return;
          const existing = updated.get(s.studentId);
          if (existing) {
            const serverOriginal = writeContext?.liveExistingResultsMap?.get(s.studentId);
            const mergedOriginal = existing.originalResult || (serverOriginal as Result | undefined);
            updated.set(s.studentId, {
              ...existing,
              status: statusToSet,
              originalResult: {
                ...(mergedOriginal || {}),
                resultId: usedResultId,
                schoolId: mergedOriginal?.schoolId || verifiedSchoolId,
                studentId: mergedOriginal?.studentId || s.studentId,
                classId: mergedOriginal?.classId || selectedClassId,
                subjectId: mergedOriginal?.subjectId || selectedSubjectId,
                academicSession: mergedOriginal?.academicSession || selectedSession,
                term: mergedOriginal?.term || selectedTerm,
                caScore: existing.componentScores['ca'] ?? existing.componentScores['ca1'] ?? 0,
                examScore: existing.componentScores['exam'] ?? existing.totalScore ?? 0,
                totalScore: existing.totalScore,
                grade: existing.grade,
                status: statusToSet,
                isLocked: willLock,
                teacherId: isAtLeastAdmin
                  ? (mergedOriginal?.teacherId || currentUser.uid)
                  : isSuperAdmin
                  ? (mergedOriginal?.teacherId || currentTeacher?.userId || currentTeacher?.teacherId || currentUser.uid)
                  : currentUser.uid,
                createdAt: mergedOriginal?.createdAt || null,
                updatedAt: null,
              } as Result
            });
          }
        });
        setScoresMap(updated);
      }

      if (writeError) {
        const failure = await diagnoseReportRuleDenial({
          err: writeError,
          actionLabel: actionVerb,
          authUid: currentUser.uid,
          authEmail: currentUser.email,
          role,
          isSuperAdmin,
          isAtLeastAdmin,
          verifiedSchoolId,
          classId: selectedClassId,
          subjectId: selectedSubjectId,
          targetStatus: statusToSet,
          targetResultIds: failedEntry
            ? [failedEntry.resultId]
            : writeQueue.map((w) => w.resultId),
          failedDetail: failedEntry
            ? {
                resultId: failedEntry.resultId,
                operationType: failedEntry.operationType,
                expectedSchoolId: failedEntry.payload.schoolId,
                studentId: failedEntry.payload.studentId,
                classId: failedEntry.payload.classId,
                subjectId: failedEntry.payload.subjectId,
                academicSession: failedEntry.payload.academicSession,
                term: failedEntry.payload.term,
              }
            : undefined,
        });
        setErrorMsg(failure.userMessage);
        return;
      }

      const savedCount = savedResultIds.size;

      // Condition L: Execute related audit & notification writes independently so errors are never conflated
      let relatedWriteWarning = '';
      try {
        await logAudit(
          currentUser.uid,
          statusToSet === 'PUBLISHED' ? 'RESULTS_PUBLISHED' : statusToSet === 'APPROVED' ? 'RESULTS_APPROVED' : statusToSet === 'SUBMITTED' ? 'RESULTS_SUBMITTED' : 'RESULTS_SAVED_DRAFT',
          'results',
          `${selectedClassId}_${selectedSubjectId}`,
          `${statusToSet} scores for ${savedCount} students in ${selectedSubjectName} (${activeProfile.name})`,
          verifiedSchoolId,
          { throwOnError: true }
        );

        if (statusToSet === 'PUBLISHED') {
          await broadcastAnnouncementNotifications(
            'CLASS_SPECIFIC',
            'Examination Results Published',
            `Terminal results for ${selectedSubjectName} have been published and are available on parent portals.`,
            selectedClassId,
            verifiedSchoolId
          );
        }
      } catch (relatedErr: any) {
        const relatedFailure = formatReportWriteFailure(relatedErr, 'RELATED_WRITE', actionVerb);
        relatedWriteWarning = relatedFailure.userMessage;
      }

      const skippedSuffix = lockedSkippedCount > 0 ? ` (${lockedSkippedCount} locked row(s) left unchanged.)` : '';
      setSuccessMsg(
        (statusToSet === 'PUBLISHED'
          ? `Successfully published results for ${savedCount} students! Visible on parent and student portals.`
          : statusToSet === 'APPROVED'
          ? `Approved results for ${savedCount} students.`
          : statusToSet === 'SUBMITTED'
          ? `Submitted marks for ${savedCount} students for administrative review.`
          : `Saved scores as DRAFT for ${savedCount} students.`) + skippedSuffix
      );
      if (relatedWriteWarning) {
        setErrorMsg(relatedWriteWarning);
      }
      setShowRevisionModal(false);
      setRevisionReason('');
      setPendingWriteContext(null);
    } finally {
      setSaving(false);
    }
  };

  // CSV Template Download
  const handleDownloadTemplate = () => {
    const csv = generateResultsCsvTemplate(students, activeProfile.components, selectedSubjectName, selectedClassName);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Results_Template_${selectedClassName.replace(/\s+/g, '_')}_${selectedSubjectName.replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV Import Parse
  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text);
      const parsed = parseResultsCsv(text, students, activeProfile.components);
      setCsvPreviewRows(parsed.rows);
      setCsvErrorsCount(parsed.totalErrors);
    };
    reader.readAsText(file);
  };

  const handleApplyCsvImport = () => {
    if (csvPreviewRows.length === 0) return;

    const updated = new Map<string, StudentScoreDraft>(scoresMap);
    let appliedCount = 0;
    let skippedLockedCount = 0;

    csvPreviewRows.forEach((row) => {
      const existing = updated.get(row.studentId);
      if (!existing) return;
      if (isRowLockedForCurrentUser(existing)) {
        skippedLockedCount++;
        return;
      }

      const mergedScores = {
        ...existing.componentScores,
        ...row.componentScores,
      };

      const calculated = calculateSubjectResult(mergedScores, activeProfile);

      updated.set(row.studentId, {
        ...existing,
        componentScores: mergedScores,
        totalScore: calculated.totalScore,
        grade: calculated.grade,
        remark: calculated.remark,
        gradePoint: calculated.gradePoint,
        isIncomplete: calculated.isIncomplete,
        isMissingAny: calculated.isMissingAny,
      });
      appliedCount++;
    });

    setScoresMap(updated);
    setShowCsvModal(false);
    setCsvContent('');
    setCsvPreviewRows([]);
    setSuccessMsg(
      `Imported scores from CSV for ${appliedCount} students!` +
        (skippedLockedCount > 0 ? ` (${skippedLockedCount} locked row(s) skipped.)` : '') +
        ' Remember to save.'
    );
  };

  // Open Full Report Card for student
  const handleOpenReportCard = async (student: Student) => {
    try {
      const targetSchool = (student.schoolId || verifiedSchoolId).trim().toLowerCase();
      const rSnap = await getDocs(
        query(
          collection(db, 'results'),
          where('schoolId', '==', targetSchool),
          where('studentId', '==', student.studentId),
          where('term', '==', selectedTerm),
          where('academicSession', '==', selectedSession)
        )
      );
      const resList: Result[] = [];
      rSnap.forEach((d) => resList.push(d.data() as Result));
      setStudentAllResults(resList);
      setSelectedStudentForReport(student);
    } catch (err) {
      console.error('Error fetching student report:', err);
      setErrorMsg(formatFriendlyFirestoreError(err, 'load student report card'));
    }
  };

  const selectedClassName = classes.find((c) => c.classId === selectedClassId)?.name || 'Class';
  const selectedSubjectName = subjects.find((s) => s.subjectId === selectedSubjectId)?.name || 'Subject';

  // Overall status of the class scores
  const classStatusSummary = useMemo(() => {
    let drafts = 0, submitted = 0, approved = 0, published = 0;
    scoresMap.forEach((item) => {
      if (item.status === 'PUBLISHED') published++;
      else if (item.status === 'APPROVED') approved++;
      else if (item.status === 'SUBMITTED') submitted++;
      else drafts++;
    });
    return { drafts, submitted, approved, published };
  }, [scoresMap]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
              <Award className="w-5 h-5" />
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
              Terminal Results & Report Cards
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Record continuous assessments, compute grades deterministically, manage approvals, and publish report cards.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveView('subject_entry')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeView === 'subject_entry'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Subject Score Entry
          </button>
          <button
            type="button"
            onClick={() => setActiveView('broadsheet')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeView === 'broadsheet'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Class Broadsheet Summary
          </button>
        </div>
      </div>

      {/* Filter / Context Control Bar */}
      <Card>
        <CardBody className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Select
              id="filter-session"
              label="Academic Session"
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              options={[
                { value: '2025/2026', label: '2025/2026' },
                { value: '2026/2027', label: '2026/2027' },
                { value: '2027/2028', label: '2027/2028' },
              ]}
            />

            <Select
              id="filter-term"
              label="Academic Term"
              value={selectedTerm}
              onChange={(e) => setSelectedTerm(e.target.value as Term)}
              options={[
                { value: 'First Term', label: 'First Term' },
                { value: 'Second Term', label: 'Second Term' },
                { value: 'Third Term', label: 'Third Term' },
              ]}
            />

            <Select
              id="filter-class"
              label="Class & Grade Arm"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              options={classes.map((c) => ({
                value: c.classId,
                label: `${c.name} ${c.section ? `(${c.section})` : ''}`,
              }))}
            />

            {activeView === 'subject_entry' && (
              <Select
                id="filter-subject"
                label="Curriculum Subject"
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                options={subjects.map((s) => ({
                  value: s.subjectId,
                  label: `${s.name} ${s.code ? `[${s.code}]` : ''}`,
                }))}
              />
            )}

            {activeView === 'broadsheet' && (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Class Cohort Size</label>
                <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800">
                  {students.length} Pupils Enrolled
                </div>
              </div>
            )}
          </div>

          {/* Active Grading Profile Information Strip */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-500">Active Grading Profile:</span>
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-md font-bold flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                {activeProfile.name}
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-600">
                Mode: <strong>{activeProfile.calculationMethod === 'SUM' ? 'Sum of Marks' : 'Weighted %'}</strong>
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-600">
                Missing Marks: <strong>{activeProfile.treatMissingAsZero ? 'Treated as 0' : 'Flagged as Incomplete'}</strong>
              </span>
            </div>

            {/* Profile Components Breakdown Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {activeProfile.components.map((comp) => (
                <span 
                  key={comp.id} 
                  className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-semibold border border-slate-200"
                >
                  {comp.name}: <strong>{comp.maxScore}m</strong>
                </span>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* SuperAdmin Teacher View helper notice when no teacher profile is active */}
      {isSuperAdmin && role === 'TEACHER' && !currentTeacher && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
          <span>
            No teacher profile is currently selected. Choose a teacher in the <strong>SuperAdmin Preview</strong> bar above to inspect their assigned classes, subjects, and report submission workflow.
          </span>
        </div>
      )}

      {/* Messages */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* VIEW 1: SUBJECT SCORE ENTRY GRID */}
      {activeView === 'subject_entry' && (
        <Card>
          <CardHeader
            title={`${selectedClassName} • ${selectedSubjectName}`}
            subtitle={`${selectedTerm} (${selectedSession}) • Real-time deterministic assessment calculation`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadTemplate}
                  className="text-xs flex items-center gap-1.5"
                  title="Download standard CSV template for this class"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV Template
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowCsvModal(true)}
                  className="text-xs flex items-center gap-1.5"
                  title="Upload scores via CSV"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Import CSV
                </Button>

                {/* Workflow Save Actions */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => initiateSaveResults('DRAFT')}
                  disabled={saving || students.length === 0}
                  className="text-xs flex items-center gap-1.5 font-bold"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Draft
                </Button>

                {role === 'TEACHER' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => initiateSaveResults('SUBMITTED')}
                    disabled={saving || students.length === 0}
                    className="text-xs flex items-center gap-1.5 font-bold bg-blue-700 hover:bg-blue-800"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Submit for Approval
                  </Button>
                )}

                {isAtLeastAdmin && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => initiateSaveResults('APPROVED')}
                      disabled={saving || students.length === 0}
                      className="text-xs flex items-center gap-1.5 font-bold text-teal-800 border-teal-300 hover:bg-teal-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve Results
                    </Button>

                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => initiateSaveResults('PUBLISHED')}
                      disabled={saving || students.length === 0}
                      className="text-xs flex items-center gap-1.5 font-bold shadow-xs"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve & Publish to Parents
                    </Button>
                  </>
                )}
              </div>
            }
          />

          <CardBody className="p-0">
            {loading ? (
              <div className="p-12 text-center text-slate-500">
                <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs font-semibold">Loading student assessment sheet...</p>
              </div>
            ) : students.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-bold text-slate-700">No active students found in this class.</p>
                <p className="text-xs text-slate-400 mt-1">Please enroll students into {selectedClassName} first.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Student Name</th>
                      <th className="px-3 py-3">Adm. No</th>
                      {/* Dynamic Component Columns based on Active Profile */}
                      {activeProfile.components.map((comp) => (
                        <th key={comp.id} className="px-3 py-3 text-center">
                          <div>{comp.name}</div>
                          <div className="text-[10px] font-normal text-slate-500">(Max {comp.maxScore})</div>
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center font-bold text-slate-900">Total</th>
                      <th className="px-3 py-3 text-center font-bold text-slate-900">Grade</th>
                      <th className="px-3 py-3 text-left">Remark</th>
                      <th className="px-3 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Report Card</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {students.map((student, idx) => {
                      const scoreData = scoresMap.get(student.studentId);
                      const isComplete = !scoreData?.isIncomplete;
                      const status = scoreData?.status || 'DRAFT';
                      const rowLocked = isRowLockedForCurrentUser(scoreData);

                      return (
                        <tr 
                          key={student.studentId} 
                          className={`hover:bg-slate-50/80 transition-colors ${
                            scoreData?.isIncomplete ? 'bg-amber-50/30' : ''
                          } ${rowLocked ? 'opacity-75 bg-slate-50/50' : ''}`}
                        >
                          <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold text-slate-900">
                            {student.firstName} {student.lastName}
                          </td>
                          <td className="px-3 py-3 font-mono text-slate-500 text-[11px]">
                            {student.admissionNumber || '—'}
                          </td>

                          {/* Dynamic Component Inputs */}
                          {activeProfile.components.map((comp) => {
                            const val = scoreData?.componentScores[comp.id];
                            const displayVal = val !== null && val !== undefined ? String(val) : '';
                            const isOutOfRange = val !== null && val !== undefined && (val < 0 || val > comp.maxScore);

                            return (
                              <td key={comp.id} className="px-3 py-2 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  max={comp.maxScore}
                                  step="any"
                                  placeholder="—"
                                  disabled={rowLocked}
                                  title={rowLocked ? 'Locked (Approved, Published, or owned by another teacher)' : undefined}
                                  value={displayVal}
                                  onChange={(e) => handleScoreChange(student.studentId, comp.id, e.target.value)}
                                  className={`w-16 px-2 py-1 text-center text-xs font-semibold rounded border transition-colors focus:outline-none focus:ring-1 ${
                                    rowLocked
                                      ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                                      : isOutOfRange
                                      ? 'bg-rose-50 border-rose-400 text-rose-800 focus:ring-rose-500'
                                      : displayVal === ''
                                      ? 'bg-white border-slate-300 text-slate-700 focus:ring-emerald-500'
                                      : 'bg-emerald-50/50 border-emerald-300 text-emerald-950 font-bold focus:ring-emerald-500'
                                  }`}
                                />
                              </td>
                            );
                          })}

                          {/* Calculated Total */}
                          <td className="px-3 py-3 text-center">
                            <span className="font-extrabold text-slate-900 text-sm">
                              {scoreData?.totalScore ?? 0}
                            </span>
                          </td>

                          {/* Grade */}
                          <td className="px-3 py-3 text-center">
                            <span 
                              className={`px-2 py-0.5 rounded font-black text-[11px] border ${
                                scoreData?.grade === 'A' || scoreData?.grade === 'A1'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : scoreData?.grade === 'B' || scoreData?.grade === 'B2' || scoreData?.grade === 'B3'
                                  ? 'bg-teal-100 text-teal-800 border-teal-300'
                                  : scoreData?.grade === 'C' || scoreData?.grade?.startsWith('C')
                                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                                  : scoreData?.grade === 'INC'
                                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                                  : 'bg-rose-100 text-rose-800 border-rose-300'
                              }`}
                            >
                              {scoreData?.grade || '—'}
                            </span>
                          </td>

                          {/* Remark */}
                          <td className="px-3 py-3 text-slate-600 text-[11px] truncate max-w-[140px]" title={scoreData?.remark}>
                            {scoreData?.remark || '—'}
                          </td>

                          {/* Status */}
                          <td className="px-3 py-3 text-center">
                            <span 
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                status === 'PUBLISHED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : status === 'APPROVED'
                                  ? 'bg-teal-100 text-teal-800'
                                  : status === 'SUBMITTED'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {status}
                            </span>
                          </td>

                          {/* Action: Open Report Card Modal */}
                          <td className="px-4 py-3 text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenReportCard(student)}
                              className="text-xs text-emerald-800 hover:bg-emerald-50 p-1.5 flex items-center gap-1 mx-auto"
                              title="Preview terminal report card for this student"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Report Card
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* VIEW 2: CLASS BROADSHEET SUMMARY */}
      {activeView === 'broadsheet' && (
        <Card>
          <CardHeader
            title={`Class Broadsheet Summary • ${selectedClassName}`}
            subtitle={`${selectedTerm} (${selectedSession}) • Cumulative subject averages and student cohort rankings`}
            action={
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.print()}
                  className="text-xs flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Broadsheet
                </Button>
              </div>
            }
          />

          <CardBody className="p-0">
            {loadingBroadsheet ? (
              <div className="p-12 text-center text-slate-500">
                <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs font-semibold">Generating class broadsheet matrix...</p>
              </div>
            ) : !broadsheetSummary || students.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-bold text-slate-700">No examination results recorded for this class yet.</p>
                <p className="text-xs text-slate-400 mt-1">Enter marks in the Subject Score Entry view first.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-800 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-3">Rank</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-3 py-3">Adm. No</th>
                      {/* Subjects Columns */}
                      {subjects.map((sub) => (
                        <th key={sub.subjectId} className="px-2 py-3 text-center truncate max-w-[100px]" title={sub.name}>
                          {sub.code || sub.name.substring(0, 4)}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center font-black text-slate-900">Total</th>
                      <th className="px-3 py-3 text-center font-black text-emerald-900">Average (%)</th>
                      {activeProfile.promotionRule?.enabled && (
                        <th className="px-3 py-3 text-center font-bold">Promotion</th>
                      )}
                      <th className="px-3 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {students.map((student) => {
                      const summary = broadsheetSummary.studentSummaries[student.studentId];
                      const studentResults = allClassResults.filter(r => r.studentId === student.studentId);

                      return (
                        <tr key={student.studentId} className="hover:bg-slate-50/70">
                          <td className="px-3 py-3 font-mono font-bold text-emerald-900">
                            {summary?.classPosition ? `${summary.classPosition}` : '—'}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {student.firstName} {student.lastName}
                          </td>
                          <td className="px-3 py-3 font-mono text-slate-500 text-[11px]">
                            {student.admissionNumber || '—'}
                          </td>

                          {/* Scores across subjects */}
                          {subjects.map((sub) => {
                            const match = studentResults.find(r => r.subjectId === sub.subjectId);
                            return (
                              <td key={sub.subjectId} className="px-2 py-3 text-center font-mono">
                                {match ? (
                                  <span className={`font-semibold ${match.totalScore < 40 ? 'text-rose-700' : 'text-slate-800'}`}>
                                    {match.totalScore}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            );
                          })}

                          <td className="px-3 py-3 text-center font-extrabold text-slate-900">
                            {summary?.totalMarksObtained ?? 0}
                          </td>
                          <td className="px-3 py-3 text-center font-black text-emerald-900">
                            {summary?.averageScore ?? 0}%
                          </td>

                          {activeProfile.promotionRule?.enabled && (
                            <td className="px-3 py-3 text-center">
                              <span 
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  summary?.promotionEligible
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {summary?.verdict || 'PENDING'}
                              </span>
                            </td>
                          )}

                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleOpenReportCard(student)}
                              className="text-emerald-800 hover:text-emerald-950 font-bold hover:underline cursor-pointer"
                            >
                              Report
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Subject Averages Footer */}
                  <tfoot className="bg-slate-50 border-t-2 border-slate-300 font-bold">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-left uppercase text-slate-700">
                        Class Subject Averages
                      </td>
                      {subjects.map((sub) => (
                        <td key={sub.subjectId} className="px-2 py-3 text-center font-mono text-emerald-950">
                          {broadsheetSummary.subjectAverages[sub.subjectId] ?? '—'}
                        </td>
                      ))}
                      <td className="px-3 py-3 text-center font-bold text-slate-800">Class Mean</td>
                      <td className="px-3 py-3 text-center font-black text-emerald-900 text-sm">
                        {broadsheetSummary.classOverallAverage}%
                      </td>
                      {activeProfile.promotionRule?.enabled && <td />}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* REVISION AUDIT MODAL (FOR EDITING PUBLISHED RESULTS) */}
      <Modal
        isOpen={showRevisionModal}
        onClose={() => setShowRevisionModal(false)}
        title="Revision of Published Examination Results"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800">
              <strong>Notice:</strong> One or more of these results were previously published to parent and student portals. To maintain institutional integrity, changes must include an authorized audit justification.
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-800 block mb-1">
              Reason for Mark Revision <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={3}
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
              placeholder="e.g. Script recount after student query, approval by Academic Board..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRevisionModal(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!revisionReason.trim() || saving}
              onClick={() => executeSaveResults(pendingSaveStatus, revisionReason.trim(), pendingWriteContext || undefined)}
              className="text-xs font-bold"
            >
              Confirm & Save Revision
            </Button>
          </div>
        </div>
      </Modal>

      {/* CSV IMPORT MODAL */}
      <Modal
        isOpen={showCsvModal}
        onClose={() => setShowCsvModal(false)}
        title={`Import Scores from CSV • ${selectedSubjectName}`}
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Select a CSV file containing pupil scores. Columns should include Admission Number, Student Name, and the configured component scores.
          </p>

          <input
            type="file"
            accept=".csv"
            onChange={handleCsvFileChange}
            className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer border border-slate-200 rounded-xl p-2"
          />

          {csvPreviewRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Preview: {csvPreviewRows.length} students detected</span>
                {csvErrorsCount > 0 ? (
                  <span className="text-rose-600 font-bold">{csvErrorsCount} format issues found</span>
                ) : (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready to import
                  </span>
                )}
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg text-[11px]">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5">Student</th>
                      <th className="px-2 py-1.5">Adm #</th>
                      {activeProfile.components.map(c => (
                        <th key={c.id} className="px-2 py-1.5 text-center">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {csvPreviewRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-2 py-1 font-medium">{r.studentName}</td>
                        <td className="px-2 py-1 font-mono text-slate-500">{r.admissionNumber}</td>
                        {activeProfile.components.map(c => (
                          <td key={c.id} className="px-2 py-1 text-center font-mono">
                            {r.componentScores[c.id] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCsvModal(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={csvPreviewRows.length === 0 || csvErrorsCount > 0}
              onClick={handleApplyCsvImport}
              className="text-xs font-bold"
            >
              Populate Scores Grid
            </Button>
          </div>
        </div>
      </Modal>

      {/* REPORT CARD MODAL */}
      <ReportCardModal
        isOpen={!!selectedStudentForReport}
        onClose={() => setSelectedStudentForReport(null)}
        student={selectedStudentForReport}
        schoolClass={selectedClass}
        results={studentAllResults}
        subjects={subjects}
        term={selectedTerm}
        session={selectedSession}
        gradingProfile={activeProfile}
      />
    </div>
  );
};
