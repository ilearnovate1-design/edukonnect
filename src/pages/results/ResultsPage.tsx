import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, getDocs, doc, query, where, writeBatch, serverTimestamp 
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
import { useQueryTab } from '../../routes/useQueryTab';
import { logAudit, parseFirebaseError } from '../../utils/formatters';
import { broadcastAnnouncementNotifications } from '../../services/notificationService';
import { 
  fetchGradingProfiles, 
  resolveGradingProfile,
  sanitizeFirestoreData
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
  const { role, currentUser, currentTeacher, isAtLeastAdmin, appUser } = useAuth();
  const { settings, schoolId } = useSchool();

  // Navigation & View mode synchronized with URL ?view=
  const [activeView, setActiveView] = useQueryTab<'subject_entry' | 'broadsheet'>(
    'view',
    'subject_entry',
    ['subject_entry', 'broadsheet']
  );

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

  // CSV Import Modal
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [csvPreviewRows, setCsvPreviewRows] = useState<ParsedCsvScoreRow[]>([]);
  const [csvErrorsCount, setCsvErrorsCount] = useState(0);

  // Report Card Modal
  const [selectedStudentForReport, setSelectedStudentForReport] = useState<Student | null>(null);
  const [studentAllResults, setStudentAllResults] = useState<Result[]>([]);

  const normalizedActiveSchool = (schoolId || appUser?.schoolId || '').trim().toLowerCase();

  const matchesTenant = (itemSchoolId?: string) => {
    const itemNorm = itemSchoolId?.trim().toLowerCase();
    if (!normalizedActiveSchool || normalizedActiveSchool === 'default') {
      return !itemNorm || itemNorm === 'default';
    }
    return itemNorm === normalizedActiveSchool;
  };

  const selectedClass = useMemo(() => {
    return classes.find(c => c.classId === selectedClassId) || null;
  }, [classes, selectedClassId]);

  // Active Grading Profile resolution
  const activeProfile = useMemo<GradingProfile>(() => {
    if (manualProfileId && gradingProfiles.length > 0) {
      const match = gradingProfiles.find(p => p.profileId === manualProfileId);
      if (match) return match;
    }
    return resolveGradingProfile(gradingProfiles, selectedClass, selectedSubjectId);
  }, [gradingProfiles, selectedClass, selectedSubjectId, manualProfileId]);

  // 1. Fetch Classes, Subjects, and Grading Profiles
  useEffect(() => {
    const fetchBase = async () => {
      try {
        // Classes
        const cSnap = await getDocs(collection(db, 'classes'));
        let cList: SchoolClass[] = [];
        cSnap.forEach((d) => {
          const item = d.data() as SchoolClass;
          if (matchesTenant(item.schoolId)) cList.push(item);
        });

        if (role === 'TEACHER') {
          const assignedIds = currentTeacher?.assignedClassIds || [];
          cList = cList.filter(
            (c) => assignedIds.includes(c.classId) || c.classTeacherId === currentTeacher?.teacherId
          );
        }

        setClasses(cList);
        if (cList.length > 0 && !selectedClassId) setSelectedClassId(cList[0].classId);
        else if (cList.length === 0) setSelectedClassId('');

        // Subjects
        const subSnap = await getDocs(collection(db, 'subjects'));
        let subList: Subject[] = [];
        subSnap.forEach((d) => {
          const item = d.data() as Subject;
          if (matchesTenant(item.schoolId)) subList.push(item);
        });

        if (role === 'TEACHER' && currentTeacher?.subjects && currentTeacher.subjects.length > 0) {
          const allowedSubjects = new Set(currentTeacher.subjects);
          subList = subList.filter((s) => allowedSubjects.has(s.subjectId) || allowedSubjects.has(s.name));
        }

        setSubjects(subList);
        if (subList.length > 0 && !selectedSubjectId) setSelectedSubjectId(subList[0].subjectId);
        else if (subList.length === 0) setSelectedSubjectId('');

        // Grading Profiles
        const profs = await fetchGradingProfiles(schoolId || 'default');
        setGradingProfiles(profs);
      } catch (err) {
        console.error('Error fetching base data:', err);
      }
    };
    fetchBase();
  }, [role, currentTeacher, schoolId]);

  // 2. Fetch Students & Existing Scores for selected Class, Subject, Term, Session
  useEffect(() => {
    if (!selectedClassId) return;

    const fetchStudentsAndScores = async () => {
      setLoading(true);
      setSuccessMsg('');
      setErrorMsg('');
      try {
        // Students in active class
        const sSnap = await getDocs(
          query(collection(db, 'students'), where('classId', '==', selectedClassId), where('status', '==', 'ACTIVE'))
        );
        const sList: Student[] = [];
        sSnap.forEach((d) => {
          const st = d.data() as Student;
          if (matchesTenant(st.schoolId)) sList.push(st);
        });
        sList.sort((a, b) => a.firstName.localeCompare(b.firstName));
        setStudents(sList);

        if (!selectedSubjectId) {
          setLoading(false);
          return;
        }

        // Results for this class + subject + term + session
        const rSnap = await getDocs(
          query(
            collection(db, 'results'),
            where('classId', '==', selectedClassId),
            where('subjectId', '==', selectedSubjectId),
            where('term', '==', selectedTerm),
            where('academicSession', '==', selectedSession)
          )
        );

        const existingResultsMap = new Map<string, Result>();
        rSnap.forEach((d) => {
          const r = d.data() as Result;
          if (matchesTenant(r.schoolId)) {
            existingResultsMap.set(r.studentId, r);
          }
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
      } catch (err) {
        console.error('Error fetching scores:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStudentsAndScores();
  }, [selectedClassId, selectedSubjectId, selectedTerm, selectedSession, activeProfile]);

  // 3. Load Broadsheet when broadsheet view is toggled
  useEffect(() => {
    if (activeView !== 'broadsheet' || !selectedClassId) return;

    const fetchClassBroadsheet = async () => {
      setLoadingBroadsheet(true);
      try {
        const rSnap = await getDocs(
          query(
            collection(db, 'results'),
            where('classId', '==', selectedClassId),
            where('term', '==', selectedTerm),
            where('academicSession', '==', selectedSession)
          )
        );
        const rList: Result[] = [];
        rSnap.forEach((d) => {
          const r = d.data() as Result;
          if (matchesTenant(r.schoolId)) rList.push(r);
        });
        setAllClassResults(rList);

        const summary = calculateClassBroadsheet(
          selectedClassId,
          selectedSession,
          selectedTerm,
          rList,
          activeProfile
        );
        setBroadsheetSummary(summary);
      } catch (err) {
        console.error('Error loading broadsheet:', err);
      } finally {
        setLoadingBroadsheet(false);
      }
    };

    fetchClassBroadsheet();
  }, [activeView, selectedClassId, selectedTerm, selectedSession, activeProfile]);

  // Update a single component score for a student
  const handleScoreChange = (studentId: string, componentId: string, value: string) => {
    const updated = new Map<string, StudentScoreDraft>(scoresMap);
    const existing = updated.get(studentId);
    if (!existing) return;
    if (role === 'TEACHER' && existing.originalResult?.status === 'PUBLISHED') return;

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
  const initiateSaveResults = (statusToSet: ResultStatus) => {
    if (saving) return;
    if (!selectedClassId || !selectedSubjectId) {
      setErrorMsg('Please select both a valid class and subject.');
      return;
    }

    if (!normalizedActiveSchool) {
      setErrorMsg('Cannot save results: Your account is not linked to an active school.');
      return;
    }

    // Role Security checks
    if (role === 'TEACHER') {
      if (statusToSet === 'APPROVED' || statusToSet === 'PUBLISHED') {
        setErrorMsg('Security Restriction: Only administrators and designated approvers can approve or publish results.');
        return;
      }

      const assignedIds = currentTeacher?.assignedClassIds || [];
      const isAuthorized = assignedIds.includes(selectedClassId) || classes.some(c => c.classId === selectedClassId && c.classTeacherId === currentTeacher?.teacherId);
      if (!isAuthorized) {
        setErrorMsg('Security Restriction: You are not authorized to record scores for this class.');
        return;
      }
    }

    // Validation before submission
    if (statusToSet === 'SUBMITTED' || statusToSet === 'PUBLISHED' || statusToSet === 'APPROVED') {
      const incompleteStudents: string[] = [];
      scoresMap.forEach((entry, sId) => {
        if (entry.isIncomplete && !activeProfile.treatMissingAsZero) {
          const s = students.find(st => st.studentId === sId);
          incompleteStudents.push(s ? `${s.firstName} ${s.lastName}` : sId);
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

    // Check if any existing result is already published
    let hasPublishedChanges = false;
    scoresMap.forEach((entry) => {
      if (entry.originalResult?.status === 'PUBLISHED') {
        const originalTotal = entry.originalResult.totalScore;
        if (originalTotal !== entry.totalScore) {
          hasPublishedChanges = true;
        }
      }
    });

    if (hasPublishedChanges) {
      if (role === 'TEACHER') {
        setErrorMsg('Published results are locked and cannot be modified by teachers. Please contact a school administrator for post-publication revisions.');
        return;
      }
      // Prompt for revision reason to record in immutable audit log (Admin only)
      setPendingSaveStatus(statusToSet);
      setShowRevisionModal(true);
      return;
    }

    // Proceed to direct save
    executeSaveResults(statusToSet);
  };

  const executeSaveResults = async (statusToSet: ResultStatus, reason?: string) => {
    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const activeSchoolId = normalizedActiveSchool;
      if (!activeSchoolId) {
        throw new Error('Your account is not associated with an active school. Please refresh or contact your administrator.');
      }

      const batch = writeBatch(db);
      let count = 0;
      let skippedPublishedCount = 0;
      const writtenStudentIds = new Set<string>();

      // Frozen snapshot of active grading profile
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

      students.forEach((s) => {
        const item = scoresMap.get(s.studentId);
        if (!item) return;

        // Teachers cannot update already-PUBLISHED records; skip them cleanly instead of failing the batch
        if (role === 'TEACHER' && item.originalResult?.status === 'PUBLISHED') {
          skippedPublishedCount++;
          return;
        }

        // Clean deterministic session & term string for key
        const cleanSession = selectedSession.replace(/[^a-zA-Z0-9]/g, '-');
        const cleanTerm = selectedTerm.replace(/\s+/g, '-');
        const resultId = item.originalResult?.resultId || `res_${s.studentId}_${selectedSubjectId}_${cleanTerm}_${cleanSession}`;
        const ref = doc(db, 'results', resultId);

        const recordSchoolId =
          item.originalResult?.schoolId &&
          item.originalResult.schoolId.trim().toLowerCase() === activeSchoolId
            ? item.originalResult.schoolId
            : activeSchoolId;

        // Fallback backward compatibility numbers
        const caScore = item.componentScores['ca'] ?? item.componentScores['ca1'] ?? 0;
        const examScore = item.componentScores['exam'] ?? item.totalScore ?? 0;

        // Audit History Entry if revised
        const auditHistory: ResultAuditEntry[] = [...(item.originalResult?.auditHistory || [])];
        if (item.originalResult && item.originalResult.status === 'PUBLISHED' && item.originalResult.totalScore !== item.totalScore) {
          auditHistory.push({
            timestamp: nowIso,
            userId: currentUser?.uid || 'user',
            userName: currentUser?.displayName || currentUser?.email || 'User',
            action: 'UPDATED',
            previousScores: item.originalResult.componentScores,
            newScores: item.componentScores,
            previousTotal: item.originalResult.totalScore,
            newTotal: item.totalScore,
            previousGrade: item.originalResult.grade,
            newGrade: item.grade,
            reason: reason || 'Administrative correction',
          });
        }

        const payload: Partial<Result> = {
          resultId,
          schoolId: recordSchoolId,
          studentId: s.studentId,
          classId: selectedClassId,
          subjectId: selectedSubjectId,
          academicSession: selectedSession,
          term: selectedTerm,
          componentScores: item.componentScores,
          caScore,
          examScore,
          totalScore: item.totalScore,
          grade: item.grade,
          remark: item.remark,
          gradePoint: item.gradePoint,
          gradingProfileId: activeProfile.profileId,
          gradingProfileSnapshot: profileSnapshot,
          isIncomplete: item.isIncomplete,
          isMissingAny: item.isMissingAny,
          status: statusToSet,
          teacherId: currentUser?.uid || 'teacher',
          updatedAt: serverTimestamp(),
          auditHistory,
        };

        if (statusToSet === 'SUBMITTED' && !item.originalResult?.submittedAt) {
          payload.submittedBy = currentUser?.uid;
          payload.submittedAt = serverTimestamp();
        }
        if (statusToSet === 'APPROVED' && !item.originalResult?.approvedAt) {
          payload.approvedBy = currentUser?.uid;
          payload.approvedAt = serverTimestamp();
        }
        if (statusToSet === 'PUBLISHED') {
          payload.publishedBy = currentUser?.uid;
          payload.publishedAt = serverTimestamp();
        }

        const sanitizedDoc = sanitizeFirestoreData({
          ...payload,
          createdAt: item.originalResult?.createdAt || serverTimestamp(),
        });

        batch.set(ref, sanitizedDoc, { merge: true });
        writtenStudentIds.add(s.studentId);
        count++;
      });

      if (count === 0) {
        if (skippedPublishedCount > 0) {
          setErrorMsg('All student results for this subject are already PUBLISHED and locked from teacher edits.');
        } else {
          setErrorMsg('No student score records were available to save.');
        }
        return;
      }

      await batch.commit();

      // Update local state statuses only for written records
      const updated = new Map<string, StudentScoreDraft>(scoresMap);
      students.forEach((s) => {
        if (!writtenStudentIds.has(s.studentId)) return;
        const existing = updated.get(s.studentId);
        if (existing) {
          const cleanSession = selectedSession.replace(/[^a-zA-Z0-9]/g, '-');
          const cleanTerm = selectedTerm.replace(/\s+/g, '-');
          const resultId = existing.originalResult?.resultId || `res_${s.studentId}_${selectedSubjectId}_${cleanTerm}_${cleanSession}`;
          updated.set(s.studentId, { 
            ...existing, 
            status: statusToSet,
            originalResult: {
              ...(existing.originalResult || {}),
              resultId,
              schoolId: activeSchoolId,
              studentId: s.studentId,
              classId: selectedClassId,
              subjectId: selectedSubjectId,
              academicSession: selectedSession,
              term: selectedTerm,
              caScore: existing.componentScores['ca'] ?? existing.componentScores['ca1'] ?? 0,
              examScore: existing.componentScores['exam'] ?? existing.totalScore ?? 0,
              totalScore: existing.totalScore,
              grade: existing.grade,
              status: statusToSet,
              createdAt: existing.originalResult?.createdAt || null,
              updatedAt: null,
            } as Result
          });
        }
      });
      setScoresMap(updated);

      await logAudit(
        currentUser?.uid || 'staff',
        statusToSet === 'PUBLISHED' ? 'RESULTS_PUBLISHED' : statusToSet === 'SUBMITTED' ? 'RESULTS_SUBMITTED' : 'RESULTS_SAVED_DRAFT',
        'results',
        `${selectedClassId}_${selectedSubjectId}`,
        `${statusToSet} scores for ${count} students in ${selectedSubjectName} (${activeProfile.name})`,
        activeSchoolId
      );
      
      if (statusToSet === 'PUBLISHED') {
        await broadcastAnnouncementNotifications(
          'CLASS_SPECIFIC',
          'Examination Results Published',
          `Terminal results for ${selectedSubjectName} have been published and are available on parent portals.`,
          selectedClassId,
          activeSchoolId
        );
      }

      const lockedNote = skippedPublishedCount > 0 ? ` (${skippedPublishedCount} already-published record(s) remained locked)` : '';
      setSuccessMsg(
        statusToSet === 'PUBLISHED'
          ? `Successfully published results for ${count} students! Visible on parent and student portals.`
          : statusToSet === 'SUBMITTED'
          ? `Submitted marks for ${count} students for administrative review.${lockedNote}`
          : `Saved scores as DRAFT for ${count} students.${lockedNote}`
      );
      setShowRevisionModal(false);
      setRevisionReason('');
    } catch (err: any) {
      console.error('Error saving results:', err);
      setErrorMsg(parseFirebaseError(err));
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

    csvPreviewRows.forEach((row) => {
      const existing = updated.get(row.studentId);
      if (!existing) return;

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
    });

    setScoresMap(updated);
    setShowCsvModal(false);
    setCsvContent('');
    setCsvPreviewRows([]);
    setSuccessMsg(`Imported scores from CSV for ${csvPreviewRows.length} students! Remember to save.`);
  };

  // Open Full Report Card for student
  const handleOpenReportCard = async (student: Student) => {
    try {
      const rSnap = await getDocs(
        query(
          collection(db, 'results'),
          where('studentId', '==', student.studentId),
          where('term', '==', selectedTerm),
          where('academicSession', '==', selectedSession)
        )
      );
      const resList: Result[] = [];
      rSnap.forEach((d) => {
        const r = d.data() as Result;
        if (matchesTenant(r.schoolId)) resList.push(r);
      });
      setStudentAllResults(resList);
      setSelectedStudentForReport(student);
    } catch (err) {
      console.error('Error fetching student report:', err);
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

                      return (
                        <tr 
                          key={student.studentId} 
                          className={`hover:bg-slate-50/80 transition-colors ${
                            scoreData?.isIncomplete ? 'bg-amber-50/30' : ''
                          }`}
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
                                  disabled={role === 'TEACHER' && scoreData?.originalResult?.status === 'PUBLISHED'}
                                  value={displayVal}
                                  onChange={(e) => handleScoreChange(student.studentId, comp.id, e.target.value)}
                                  className={`w-16 px-2 py-1 text-center text-xs font-semibold rounded border transition-colors focus:outline-none focus:ring-1 ${
                                    role === 'TEACHER' && scoreData?.originalResult?.status === 'PUBLISHED'
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
              onClick={() => executeSaveResults(pendingSaveStatus, revisionReason.trim())}
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
