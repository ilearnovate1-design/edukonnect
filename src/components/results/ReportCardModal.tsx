import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { 
  Student, 
  SchoolClass, 
  Result, 
  Subject, 
  StudentEvaluation, 
  AffectiveTraitConfig,
  GradingProfile,
  AssessmentComponentConfig
} from '../../types';
import { useSchool } from '../../contexts/SchoolContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate, parseFirebaseError } from '../../utils/formatters';
import { printDocumentElement, downloadDocumentAsFile } from '../../utils/documentGenerator';
import { getStudentEvaluation, saveStudentEvaluation } from '../../services/evaluationService';
import { DEFAULT_REPORT_TEMPLATE, DEFAULT_AFFECTIVE_TRAITS } from '../../services/schoolService';
import { DEFAULT_GRADING_PROFILES } from '../../services/assessmentEngine';
import { 
  Printer, 
  Download, 
  Award, 
  CheckCircle2, 
  ShieldCheck, 
  BookOpen, 
  GraduationCap,
  Edit3,
  Save,
  RotateCcw,
  Check,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  Sliders,
  X
} from 'lucide-react';

interface ReportCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  schoolClass: SchoolClass | null;
  results: Result[];
  subjects?: Subject[];
  attendanceSummary?: { total: number; present: number; absent: number; late: number; rate: number };
  classPosition?: string | number;
  classAverage?: number;
  totalStudentsInClass?: number;
  term?: string;
  session?: string;
  gradingProfile?: GradingProfile;
}

const formatSubjectTitle = (subjectId: string, subjectsList?: Subject[]): string => {
  if (subjectsList && subjectsList.length > 0) {
    const match = subjectsList.find(s => s.subjectId === subjectId);
    if (match) return match.name;
  }
  const clean = subjectId.replace(/^sub-/, '').replace(/-/g, ' ');
  const titleMap: Record<string, string> = {
    math: 'Mathematics',
    eng: 'English Language & Studies',
    english: 'English Language & Studies',
    sci: 'Basic Science & Technology',
    science: 'Basic Science & Technology',
    'basic science': 'Basic Science & Technology',
    social: 'Social Studies & Civic Education',
    'social studies': 'Social Studies & Civic Education',
    ict: 'Information & Comm. Tech (ICT)',
    computer: 'Computer Studies / ICT',
    crk: 'Christian Religious Studies',
    irk: 'Islamic Religious Studies',
    civic: 'Civic Education',
    agric: 'Agricultural Science',
    french: 'French Language',
    arts: 'Cultural & Creative Arts',
    phe: 'Physical & Health Education',
    yoruba: 'Yoruba Language',
    hausa: 'Hausa Language',
    igbo: 'Igbo Language',
  };
  const key = clean.toLowerCase().trim();
  if (titleMap[key]) return titleMap[key];
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
};

export const ReportCardModal: React.FC<ReportCardModalProps> = ({
  isOpen,
  onClose,
  student,
  schoolClass,
  results,
  subjects = [],
  attendanceSummary,
  classPosition,
  classAverage,
  totalStudentsInClass = 25,
  term,
  session,
  gradingProfile,
}) => {
  const { settings, schoolId } = useSchool();
  const { role, currentUser, currentTeacher, appUser } = useAuth();

  const reportTemplate = settings.reportTemplate || DEFAULT_REPORT_TEMPLATE;
  const traitsList: AffectiveTraitConfig[] = reportTemplate.affectiveTraits?.length 
    ? reportTemplate.affectiveTraits 
    : DEFAULT_AFFECTIVE_TRAITS;

  const currentTerm = term || settings.currentTerm;
  const currentSession = session || settings.currentAcademicSession;

  // Resolve Active Grading Profile or Snapshot for Historical Integrity
  const effectiveProfile: GradingProfile = React.useMemo(() => {
    // 1. If explicit profile prop provided
    if (gradingProfile) return gradingProfile;

    // 2. If results have an immutable snapshot from time of calculation
    const snap = results[0]?.gradingProfileSnapshot;
    if (snap) {
      return {
        profileId: snap.profileId,
        schoolId: 'default',
        name: snap.name,
        levelCategory: 'PRIMARY',
        calculationMethod: snap.calculationMethod,
        treatMissingAsZero: snap.treatMissingAsZero,
        roundingPolicy: snap.roundingPolicy,
        components: snap.components,
        gradeBands: snap.gradeBands,
        version: snap.version,
      };
    }

    // 3. Fallback based on class level or default
    return {
      ...DEFAULT_GRADING_PROFILES.PRIMARY,
      profileId: 'default-primary',
      schoolId: 'default',
    };
  }, [gradingProfile, results]);

  const displaySettings = effectiveProfile.displaySettings || {
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
  };

  const components: AssessmentComponentConfig[] = effectiveProfile.components || [
    { id: 'ca', name: 'Continuous Assessment', maxScore: 30, weight: 30 },
    { id: 'exam', name: 'Terminal Examination', maxScore: 70, weight: 70 },
  ];

  const totalPossiblePerSubject = effectiveProfile.calculationMethod === 'SUM'
    ? components.reduce((sum, c) => sum + c.maxScore, 0)
    : 100;

  // Calculation of overall scores
  const totalPossible = results.length * totalPossiblePerSubject;
  const totalScored = results.reduce((sum, r) => sum + (r.totalScore || 0), 0);
  const averageScore = results.length > 0 ? (totalScored / results.length).toFixed(1) : '0';
  const avgNum = parseFloat(averageScore);

  // Check if any results are incomplete
  const hasIncompleteResults = results.some(r => r.isIncomplete || r.grade === 'INC');

  // Determine standard automated template defaults based on average score
  let defaultTeacherRemark = reportTemplate.teacherAppraisalPass || 'A steady pupil capable of higher attainment.';
  let defaultPrincipalRemark = reportTemplate.principalRemarkPass || 'Satisfactory academic performance.';
  let resultVerdict = reportTemplate.verdictPass || 'PASSED';
  let verdictColor = 'text-blue-800 bg-blue-50 border-blue-300';

  if (avgNum >= 80) {
    defaultTeacherRemark = reportTemplate.teacherAppraisalDistinction;
    defaultPrincipalRemark = reportTemplate.principalRemarkDistinction;
    resultVerdict = reportTemplate.verdictDistinction || 'PASSED WITH HIGH DISTINCTION';
    verdictColor = 'text-emerald-900 bg-emerald-100 border-emerald-400';
  } else if (avgNum >= 65) {
    defaultTeacherRemark = reportTemplate.teacherAppraisalCredit;
    defaultPrincipalRemark = reportTemplate.principalRemarkCredit;
    resultVerdict = reportTemplate.verdictCredit || 'PASSED WITH CREDIT';
    verdictColor = 'text-teal-800 bg-teal-50 border-teal-300';
  } else if (avgNum >= 50) {
    defaultTeacherRemark = reportTemplate.teacherAppraisalPass;
    defaultPrincipalRemark = reportTemplate.principalRemarkPass;
    resultVerdict = reportTemplate.verdictPass || 'PASSED';
    verdictColor = 'text-blue-800 bg-blue-50 border-blue-300';
  } else if (avgNum > 0) {
    defaultTeacherRemark = reportTemplate.teacherAppraisalTrial;
    defaultPrincipalRemark = reportTemplate.principalRemarkTrial;
    resultVerdict = reportTemplate.verdictTrial || 'PROMOTED ON TRIAL';
    verdictColor = 'text-amber-800 bg-amber-50 border-amber-300';
  }

  // Teacher signature name default
  const defaultTeacherName = currentTeacher 
    ? `${currentTeacher.firstName} ${currentTeacher.lastName}` 
    : (reportTemplate.defaultTeacherName || 'Class Teacher');

  // Custom evaluation state
  const [isEditingRemarks, setIsEditingRemarks] = useState(false);
  const [customTeacherRemark, setCustomTeacherRemark] = useState('');
  const [customPrincipalRemark, setCustomPrincipalRemark] = useState('');
  const [customTeacherName, setCustomTeacherName] = useState('');
  const [customAffectiveScores, setCustomAffectiveScores] = useState<Record<string, number>>({});
  
  const [isSavingEvaluation, setIsSavingEvaluation] = useState(false);
  const [evalSaveSuccess, setEvalSaveSuccess] = useState(false);
  const [evalSaveError, setEvalSaveError] = useState('');

  // Load existing student evaluation from Firestore
  useEffect(() => {
    if (!student || !isOpen) return;

    let isMounted = true;
    const loadEvaluation = async () => {
      try {
        const existing = await getStudentEvaluation(student.studentId, currentTerm, currentSession);
        if (!isMounted) return;

        if (existing) {
          setCustomTeacherRemark(existing.teacherRemark || defaultTeacherRemark);
          setCustomPrincipalRemark(existing.principalRemark || defaultPrincipalRemark);
          setCustomTeacherName(existing.teacherName || defaultTeacherName);
          
          if (existing.affectiveScores) {
            setCustomAffectiveScores(existing.affectiveScores);
          } else {
            const initialMap: Record<string, number> = {};
            traitsList.forEach(t => {
              initialMap[t.id || t.trait] = t.defaultScore || 4;
            });
            setCustomAffectiveScores(initialMap);
          }
        } else {
          setCustomTeacherRemark(defaultTeacherRemark);
          setCustomPrincipalRemark(defaultPrincipalRemark);
          setCustomTeacherName(defaultTeacherName);
          
          const initialMap: Record<string, number> = {};
          traitsList.forEach(t => {
            let score = t.defaultScore || 4;
            if (t.trait.toLowerCase().includes('attentive') && avgNum >= 75) score = 5;
            initialMap[t.id || t.trait] = score;
          });
          setCustomAffectiveScores(initialMap);
        }
      } catch (err) {
        console.error('Error loading evaluation:', err);
      }
    };

    loadEvaluation();
    setIsEditingRemarks(false);
    setEvalSaveSuccess(false);
    setEvalSaveError('');

    return () => {
      isMounted = false;
    };
  }, [student, currentTerm, currentSession, isOpen, defaultTeacherRemark, defaultPrincipalRemark, defaultTeacherName]);

  if (!student) return null;

  const handleScoreTraitChange = (traitKey: string, score: number) => {
    setCustomAffectiveScores(prev => ({
      ...prev,
      [traitKey]: score
    }));
  };

  const handleSaveEvaluation = async () => {
    if (!student) return;
    setIsSavingEvaluation(true);
    setEvalSaveError('');
    setEvalSaveSuccess(false);
    try {
      const activeSchoolId = (schoolId || appUser?.schoolId || student.schoolId || '').trim().toLowerCase();
      if (!activeSchoolId) {
        throw new Error('Cannot save remarks: your account has no active school association.');
      }

      await saveStudentEvaluation({
        schoolId: activeSchoolId,
        studentId: student.studentId,
        term: currentTerm,
        academicSession: currentSession,
        teacherRemark: customTeacherRemark.trim(),
        principalRemark: customPrincipalRemark.trim(),
        teacherName: customTeacherName.trim(),
        verdict: resultVerdict,
        affectiveScores: customAffectiveScores,
        updatedBy: currentUser?.uid || role || 'staff',
      });

      setEvalSaveSuccess(true);
      setTimeout(() => setEvalSaveSuccess(false), 3000);
      setIsEditingRemarks(false);
    } catch (err: any) {
      console.error('Error saving student evaluation:', err);
      setEvalSaveError(parseFirebaseError(err));
    } finally {
      setIsSavingEvaluation(false);
    }
  };

  const documentTitle = `${student.firstName}_${student.lastName}_ReportCard_${currentTerm.replace(/\s+/g, '_')}`;
  const filename = `${documentTitle}.html`;

  const handlePrint = () => {
    printDocumentElement('official-report-card-print', `Report Card - ${student.firstName} ${student.lastName}`);
  };

  const handleDownload = () => {
    downloadDocumentAsFile('official-report-card-print', filename, `Terminal Report Card - ${student.firstName} ${student.lastName}`);
  };

  const activeTeacherRemark = customTeacherRemark || defaultTeacherRemark;
  const activePrincipalRemark = customPrincipalRemark || defaultPrincipalRemark;
  const activeTeacherName = customTeacherName || defaultTeacherName;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Official Termly Report Card • ${student.firstName} ${student.lastName}`}
      maxWidth="3xl"
    >
      <div className="space-y-6">
        {/* Actions Bar & Notice */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2">
            <span className="p-1 bg-emerald-100 text-emerald-800 rounded-md">
              <GraduationCap className="w-4 h-4" />
            </span>
            <div>
              <span className="text-xs font-bold text-slate-800">
                {currentTerm} ({currentSession}) • {effectiveProfile.name}
              </span>
              <p className="text-[11px] text-slate-500">
                A4 Portrait print-ready layout with official seal, marks breakdown, and signatures.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {role !== 'PARENT' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsEditingRemarks(!isEditingRemarks)}
                leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                className="text-xs"
              >
                {isEditingRemarks ? 'Close Editor' : 'Edit Remarks & Ratings'}
              </Button>
            )}

            <Button
              size="sm"
              variant="primary"
              onClick={handlePrint}
              leftIcon={<Printer className="w-3.5 h-3.5" />}
              className="text-xs font-bold shadow-xs"
            >
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Warning if Incomplete Scores Detected */}
        {hasIncompleteResults && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Incomplete Assessment Notice:</strong> One or more subject scores are pending or marked as incomplete. Results will be labeled as incomplete until all components are provided.
            </div>
          </div>
        )}

        {/* Evaluation Remarks & Affective Domain Editor (Staff Only) */}
        {isEditingRemarks && role !== 'PARENT' && (
          <div className="p-4 sm:p-5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
              <div className="flex items-center gap-1.5 font-bold text-emerald-950 text-xs">
                <Sliders className="w-4 h-4 text-emerald-700" />
                Customize Teacher & Principal Remarks for this Student
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={handleSaveEvaluation}
                disabled={isSavingEvaluation}
                leftIcon={<Save className="w-3.5 h-3.5" />}
                className="text-xs"
              >
                {isSavingEvaluation ? 'Saving...' : 'Save Remarks & Ratings'}
              </Button>
            </div>

            {/* Teacher's Remark Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800">
                  Class Teacher's Appraisal Remark:
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalDistinction)}
                    className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200 cursor-pointer"
                  >
                    Distinction
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalCredit)}
                    className="px-1.5 py-0.5 text-[10px] bg-teal-100 text-teal-800 rounded hover:bg-teal-200 cursor-pointer"
                  >
                    Credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalPass)}
                    className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-800 rounded hover:bg-blue-200 cursor-pointer"
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalTrial)}
                    className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded hover:bg-amber-200 cursor-pointer"
                  >
                    Trial
                  </button>
                </div>
              </div>
              <textarea
                rows={2}
                value={customTeacherRemark}
                onChange={(e) => setCustomTeacherRemark(e.target.value)}
                placeholder="Enter teacher's comments and academic recommendation..."
                className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-700">Teacher Signature Name:</span>
                <input
                  type="text"
                  value={customTeacherName}
                  onChange={(e) => setCustomTeacherName(e.target.value)}
                  placeholder="e.g. A. Adeleke (B.Sc Ed)"
                  className="px-2.5 py-1 bg-white border border-emerald-300 rounded text-xs focus:ring-2 focus:ring-emerald-600 w-64"
                />
              </div>
            </div>

            {/* Principal Remark Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800">
                  Head of School / Principal's Remark:
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkDistinction)}
                    className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200 cursor-pointer"
                  >
                    Distinction
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkCredit)}
                    className="px-1.5 py-0.5 text-[10px] bg-teal-100 text-teal-800 rounded hover:bg-teal-200 cursor-pointer"
                  >
                    Credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkPass)}
                    className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-800 rounded hover:bg-blue-200 cursor-pointer"
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkTrial)}
                    className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded hover:bg-amber-200 cursor-pointer"
                  >
                    Trial
                  </button>
                </div>
              </div>
              <textarea
                rows={2}
                value={customPrincipalRemark}
                onChange={(e) => setCustomPrincipalRemark(e.target.value)}
                placeholder="Enter Head of School's administrative assessment and remark..."
                className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>

            {/* Affective & Psychomotor Domain Rating Editor */}
            <div className="space-y-2 pt-2 border-t border-emerald-200">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800">
                  Affective & Psychomotor Behavioral Scale:
                </label>
                <span className="text-[11px] text-emerald-800 font-medium">
                  5: Excellent | 4: Good | 3: Fair | 2: Poor | 1: Very Poor
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {traitsList.map((t) => {
                  const key = t.id || t.trait;
                  const currentScore = customAffectiveScores[key] ?? t.defaultScore ?? 4;
                  return (
                    <div key={key} className="p-2 bg-white border border-emerald-200 rounded-lg flex items-center justify-between">
                      <span className="font-medium text-slate-700 text-[11px] truncate mr-2" title={t.trait}>
                        {t.trait}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {[1, 2, 3, 4, 5].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => handleScoreTraitChange(key, val)}
                            className={`w-5 h-5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                              currentScore === val
                                ? 'bg-emerald-800 text-white shadow-xs scale-105'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {evalSaveError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
            <span className="font-medium">{evalSaveError}</span>
          </div>
        )}

        {evalSaveSuccess && (
          <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-xl text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-700" />
            <span className="font-bold">Remarks and Ratings saved successfully for this report card!</span>
          </div>
        )}

        {/* Printable & Downloadable Report Card Sheet */}
        <div 
          id="official-report-card-print"
          className="bg-white border-2 border-emerald-900 rounded-xl p-6 sm:p-8 space-y-5 text-slate-900 shadow-xs"
        >
          {/* Header */}
          <div className="text-center border-b-2 border-emerald-900 pb-4 relative">
            <div className="flex items-center justify-center gap-3 mb-1">
              <div className="w-12 h-12 rounded-xl bg-emerald-900 text-white flex items-center justify-center font-black text-xl shadow-xs">
                {settings.schoolName ? settings.schoolName.charAt(0) : 'E'}
              </div>
              <div className="text-left sm:text-center">
                <h1 className="text-xl sm:text-2xl font-black text-emerald-950 uppercase tracking-wide leading-tight">
                  {settings.schoolName}
                </h1>
                <p className="text-[11px] text-slate-600 font-medium">{settings.address || 'Lagos, Nigeria'}</p>
              </div>
            </div>
            
            <p className="text-[11px] text-slate-500">
              Tel: {settings.phone || '+234 800 EDUKONNECT'} • Email: {settings.email || 'portal@edukonnect.ng'}
            </p>
            
            <div className="inline-block mt-2.5 px-6 py-1 bg-emerald-900 text-white text-xs font-black uppercase tracking-widest rounded-sm shadow-xs">
              Continuous Assessment & Terminal Examination Report Card
            </div>
          </div>

          {/* Student Profile & Academic Term Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Pupil's Full Name</span>
              <strong className="text-slate-900 font-bold">{student.firstName} {student.lastName}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Admission / Reg No.</span>
              <strong className="text-slate-900 font-mono">{student.admissionNumber || student.studentId}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Class / Grade Arm</span>
              <strong className="text-slate-900 font-bold">{schoolClass ? schoolClass.name : 'Class'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Academic Session & Term</span>
              <strong className="text-slate-900 font-bold">{currentTerm} ({currentSession})</strong>
            </div>

            {displaySettings.showPosition && classPosition !== undefined && (
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Class Cohort Position</span>
                <span className="text-emerald-900 font-black text-sm">
                  {classPosition}{classPosition === 1 ? 'st' : classPosition === 2 ? 'nd' : classPosition === 3 ? 'rd' : 'th'} Position
                </span>
              </div>
            )}

            {displaySettings.showAttendance && (
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Term Attendance</span>
                <span className="text-slate-800 font-bold">
                  {attendanceSummary && attendanceSummary.total > 0
                    ? `${attendanceSummary.present} / ${attendanceSummary.total} Days (${attendanceSummary.rate}%)`
                    : 'Attendance Not Recorded'}
                </span>
              </div>
            )}

            {displaySettings.showStudentAverage && (
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Student Overall Average</span>
                <span className="text-emerald-900 font-black text-sm">{averageScore}%</span>
              </div>
            )}

            {displaySettings.showClassAverage && classAverage !== undefined && (
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Class Cohort Average</span>
                <span className="text-slate-800 font-bold">{classAverage}%</span>
              </div>
            )}
          </div>

          {/* Academic Results Table - Configurable Dynamic Components */}
          <div className="overflow-x-auto rounded-lg border border-slate-300">
            <table className="w-full text-xs text-left">
              <thead className="bg-emerald-900 text-white font-bold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-3.5 py-2">Academic Subject</th>
                  {displaySettings.showComponentBreakdown !== false && components.map((comp) => (
                    <th key={comp.id} className="px-2.5 py-2 text-center">
                      <div>{comp.name}</div>
                      <div className="text-[9px] font-normal opacity-80">({comp.maxScore})</div>
                    </th>
                  ))}
                  <th className="px-2.5 py-2 text-center">Total ({totalPossiblePerSubject})</th>
                  <th className="px-2.5 py-2 text-center">Grade</th>
                  {displaySettings.showGradePoints && (
                    <th className="px-2.5 py-2 text-center">GP</th>
                  )}
                  <th className="px-3 py-2 text-left">Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium">
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={components.length + 5} className="px-4 py-6 text-center text-slate-400 italic">
                      No examination marks registered for this pupil in {currentTerm} ({currentSession}).
                    </td>
                  </tr>
                ) : (
                  results.map((r, index) => {
                    const isInc = r.isIncomplete || r.grade === 'INC';

                    return (
                      <tr key={r.resultId || index} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                        <td className="px-3.5 py-2 font-bold text-slate-900">
                          {formatSubjectTitle(r.subjectId, subjects)}
                        </td>

                        {/* Component Scores */}
                        {displaySettings.showComponentBreakdown !== false && components.map((comp) => {
                          const val = r.componentScores?.[comp.id] ?? (comp.id === 'exam' ? r.examScore : r.caScore);
                          return (
                            <td key={comp.id} className="px-2.5 py-2 text-center text-slate-700 font-mono">
                              {val !== null && val !== undefined ? val : <span className="text-amber-600 font-bold">INC</span>}
                            </td>
                          );
                        })}

                        {/* Total Score */}
                        <td className="px-2.5 py-2 text-center font-bold text-slate-900">
                          {r.totalScore ?? 0}
                        </td>

                        {/* Grade */}
                        <td className="px-2.5 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                            r.grade === 'A' || r.grade === 'A1' ? 'bg-emerald-100 text-emerald-800' :
                            r.grade === 'B' || r.grade?.startsWith('B') ? 'bg-teal-100 text-teal-800' :
                            r.grade === 'C' || r.grade?.startsWith('C') ? 'bg-blue-100 text-blue-800' :
                            r.grade === 'INC' ? 'bg-amber-100 text-amber-800' :
                            'bg-rose-100 text-rose-800'
                          }`}>
                            {r.grade || '—'}
                          </span>
                        </td>

                        {/* Optional Grade Points */}
                        {displaySettings.showGradePoints && (
                          <td className="px-2.5 py-2 text-center font-mono text-slate-700">
                            {r.gradePoint !== undefined ? r.gradePoint.toFixed(1) : '—'}
                          </td>
                        )}

                        {/* Remark */}
                        <td className="px-3 py-2 text-slate-600 italic text-[11px]">
                          {r.teacherComment || r.remark || (isInc ? 'Incomplete' : 'Satisfactory')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {results.length > 0 && (
                <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-300">
                  <tr>
                    <td className="px-3.5 py-2 text-left uppercase text-slate-800">Overall Summary</td>
                    {displaySettings.showComponentBreakdown !== false && (
                      <td colSpan={components.length} className="px-2.5 py-2 text-center text-slate-700">
                        Marks Scored: <strong className="text-slate-900">{totalScored}</strong> / {totalPossible}
                      </td>
                    )}
                    <td className="px-2.5 py-2 text-center font-black text-emerald-900 text-sm">
                      {averageScore}%
                    </td>
                    <td colSpan={displaySettings.showGradePoints ? 3 : 2} className="px-3 py-2 text-left">
                      <span className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider border ${verdictColor}`}>
                        {resultVerdict}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Affective & Psychomotor Behavioral Domain Rating */}
          {displaySettings.showAffectiveTraits && (
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800 uppercase tracking-wider">
                <span>{reportTemplate.ratingScaleDescription || 'Affective & Psychomotor Skills Rating (5: Excellent | 4: Good | 3: Fair | 2: Poor | 1: Very Poor)'}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                {traitsList.map((t) => {
                  const key = t.id || t.trait;
                  const score = customAffectiveScores[key] ?? t.defaultScore ?? 4;
                  return (
                    <div key={key} className="flex items-center justify-between p-1.5 bg-white border border-slate-200 rounded px-2">
                      <span className="text-slate-600 truncate mr-1" title={t.trait}>{t.trait}:</span>
                      <span className="font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                        {score} / 5
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Grading Scale Key */}
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600 flex flex-wrap justify-between gap-1">
            <span className="font-bold text-slate-800 uppercase">Grading Scale:</span>
            {effectiveProfile.gradeBands && effectiveProfile.gradeBands.length > 0 ? (
              effectiveProfile.gradeBands.map((g) => (
                <span key={g.grade}>
                  {g.min}-{g.max}: <strong>{g.grade} ({g.remark})</strong>
                </span>
              ))
            ) : (
              <span>75-100: A | 65-74: B | 50-64: C | 40-49: D | 0-39: F</span>
            )}
          </div>

          {/* Teacher & Principal Remarks with Seals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* Teacher's Appraisal */}
            {displaySettings.showTeacherRemarks && (
              <div className="p-3 bg-white border border-slate-300 rounded-lg space-y-1.5">
                <span className="font-bold text-emerald-950 uppercase text-[10px] block">
                  Class Teacher's Appraisal & Recommendation:
                </span>
                <p className="italic text-slate-700 min-h-8 text-[11px] leading-relaxed">
                  "{activeTeacherRemark}"
                </p>
                <div className="pt-3 flex items-end justify-between border-t border-slate-200">
                  <div>
                    <div className="font-serif italic font-semibold text-emerald-900 text-xs">
                      {activeTeacherName}
                    </div>
                    <span className="text-[10px] text-slate-400 block">
                      {reportTemplate.teacherTitle || 'Class Teacher Signature'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">{formatDate(new Date())}</span>
                </div>
              </div>
            )}

            {/* Principal / Head of School's Remark */}
            {displaySettings.showPrincipalRemarks && (
              <div className="p-3 bg-white border border-slate-300 rounded-lg space-y-1.5 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 uppercase text-[10px] block">
                    Principal / Head of School's Remark:
                  </span>
                  {displaySettings.showOfficialSeal && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-emerald-800 text-white rounded font-bold uppercase">
                      {reportTemplate.officialSealText || 'Official Seal'}
                    </span>
                  )}
                </div>
                <p className="italic text-slate-700 min-h-8 text-[11px] leading-relaxed">
                  "{activePrincipalRemark}"
                </p>
                <div className="pt-3 flex items-end justify-between border-t border-slate-200">
                  <div>
                    <div className="font-serif italic font-semibold text-emerald-900 text-xs">
                      {reportTemplate.principalName || 'Head of School'}
                    </div>
                    <span className="text-[10px] text-slate-400 block">
                      {reportTemplate.principalTitle || 'Head of School Signature & Stamp'}
                    </span>
                  </div>
                  {displaySettings.showOfficialSeal && (
                    <div className="border border-emerald-700 text-emerald-800 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-50">
                      {reportTemplate.officialSealText || 'APPROVED'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Next Term Resumption & Fees Notice */}
          {displaySettings.showNextTermDate && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs flex flex-col sm:flex-row items-center justify-between gap-2">
              <div>
                <span className="text-slate-600 block text-[11px]">Next Academic Term Resumption Date:</span>
                <strong className="text-emerald-950 font-bold text-sm">
                  {formatDate(settings.nextTermResumptionDate || '2026-09-21')}
                </strong>
              </div>
              <div className="text-right sm:text-right text-[11px] text-slate-600">
                <span>Status: <strong className="text-emerald-800">Clearance Verified</strong></span>
                <p className="text-[10px] text-slate-500">
                  {reportTemplate.clearanceNotice || 'Please present this report card upon resumption.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button 
              variant="outline" 
              onClick={handleDownload} 
              leftIcon={<Download className="w-4 h-4 text-emerald-800" />}
              className="flex-1 sm:flex-none"
            >
              Download Report Card
            </Button>
            <Button 
              variant="primary" 
              onClick={handlePrint} 
              leftIcon={<Printer className="w-4 h-4" />}
              className="flex-1 sm:flex-none font-bold"
            >
              Print Report Card
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
