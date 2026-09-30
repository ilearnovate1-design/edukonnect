import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Student, SchoolClass, Result, Subject, StudentEvaluation, AffectiveTraitConfig } from '../../types';
import { useSchool } from '../../contexts/SchoolContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../utils/formatters';
import { printDocumentElement, downloadDocumentAsFile } from '../../utils/documentGenerator';
import { getStudentEvaluation, saveStudentEvaluation } from '../../services/evaluationService';
import { DEFAULT_REPORT_TEMPLATE, DEFAULT_AFFECTIVE_TRAITS } from '../../services/schoolService';
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
  classPosition?: string;
  totalStudentsInClass?: number;
  term?: string;
  session?: string;
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
  attendanceSummary = { total: 60, present: 58, absent: 2, late: 0, rate: 97 },
  classPosition,
  totalStudentsInClass = 25,
  term,
  session,
}) => {
  const { settings } = useSchool();
  const { role, currentUser, currentTeacher } = useAuth();

  const reportTemplate = settings.reportTemplate || DEFAULT_REPORT_TEMPLATE;
  const traitsList: AffectiveTraitConfig[] = reportTemplate.affectiveTraits?.length 
    ? reportTemplate.affectiveTraits 
    : DEFAULT_AFFECTIVE_TRAITS;

  const currentTerm = term || settings.currentTerm;
  const currentSession = session || settings.currentAcademicSession;

  // Calculation of scores
  const totalPossible = results.length * 100;
  const totalScored = results.reduce((sum, r) => sum + (r.totalScore || 0), 0);
  const averageScore = results.length > 0 ? (totalScored / results.length).toFixed(1) : '0';
  const avgNum = parseFloat(averageScore);

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
          // Initialize with template defaults
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
    try {
      await saveStudentEvaluation({
        studentId: student.studentId,
        term: currentTerm,
        academicSession: currentSession,
        teacherRemark: customTeacherRemark.trim(),
        principalRemark: customPrincipalRemark.trim(),
        teacherName: customTeacherName.trim(),
        verdict: resultVerdict,
        affectiveScores: customAffectiveScores,
        updatedBy: currentUser?.uid || role,
      });

      setEvalSaveSuccess(true);
      setTimeout(() => setEvalSaveSuccess(false), 3000);
      setIsEditingRemarks(false);
    } catch (err) {
      console.error('Error saving student evaluation:', err);
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
  const canEdit = role === 'ADMIN' || role === 'TEACHER';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Official Terminal Examination Report Card"
      subtitle={`${student.firstName} ${student.lastName} • ${currentTerm} (${currentSession})`}
      maxWidth="3xl"
    >
      <div className="space-y-4">
        {/* Admin/Teacher Controls Bar */}
        {canEdit && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">Educator Evaluation Controls:</span>
              <span className="text-slate-500">Customize comments, Head of School's remark, & skills ratings for this report card.</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={isEditingRemarks ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setIsEditingRemarks(!isEditingRemarks)}
                leftIcon={isEditingRemarks ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
              >
                {isEditingRemarks ? 'Close Editor' : 'Edit Remarks & Ratings'}
              </Button>
            </div>
          </div>
        )}

        {/* Live Inline Remarks & Ratings Editor */}
        {canEdit && isEditingRemarks && (
          <div className="p-4 sm:p-5 bg-emerald-50/70 border-2 border-emerald-300 rounded-xl space-y-4 text-xs animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-emerald-200">
              <div>
                <h4 className="font-bold text-emerald-950 text-sm flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-emerald-700" />
                  Customize Student Appraisal, Remarks & Ratings
                </h4>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  Changes made here override template defaults specifically for {student.firstName} {student.lastName}.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCustomTeacherRemark(defaultTeacherRemark);
                    setCustomPrincipalRemark(defaultPrincipalRemark);
                    setCustomTeacherName(defaultTeacherName);
                  }}
                  leftIcon={<RotateCcw className="w-3 h-3 text-slate-500" />}
                >
                  Reset Defaults
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveEvaluation}
                  isLoading={isSavingEvaluation}
                  leftIcon={<Save className="w-3.5 h-3.5" />}
                >
                  Save Evaluation
                </Button>
              </div>
            </div>

            {/* Teacher Appraisal & Recommendation Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-800">
                  Class Teacher's Appraisal & Recommendation:
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalDistinction)}
                    className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200"
                  >
                    Distinction
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalCredit)}
                    className="px-1.5 py-0.5 text-[10px] bg-teal-100 text-teal-800 rounded hover:bg-teal-200"
                  >
                    Credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalPass)}
                    className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomTeacherRemark(reportTemplate.teacherAppraisalTrial)}
                    className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded hover:bg-amber-200"
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
                className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
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

            {/* Principal / Head of School's Remark Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-800">
                  Principal / Head of School's Remark:
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkDistinction)}
                    className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200"
                  >
                    Distinction
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkCredit)}
                    className="px-1.5 py-0.5 text-[10px] bg-teal-100 text-teal-800 rounded hover:bg-teal-200"
                  >
                    Credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkPass)}
                    className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomPrincipalRemark(reportTemplate.principalRemarkTrial)}
                    className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded hover:bg-amber-200"
                  >
                    Trial
                  </button>
                </div>
              </div>
              <textarea
                rows={2}
                value={customPrincipalRemark}
                onChange={(e) => setCustomPrincipalRemark(e.target.value)}
                placeholder="Enter Head of School's administrative assessment and stamp remark..."
                className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
              />
            </div>

            {/* Affective & Psychomotor Behavioral Domain Rating Editor */}
            <div className="space-y-2 pt-2 border-t border-emerald-200">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-800">
                  Affective & Psychomotor Skills Rating (1 - 5 Scale):
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
                            className={`w-5 h-5 rounded text-[11px] font-bold transition-all ${
                              currentScore === val
                                ? 'bg-emerald-700 text-white shadow-xs'
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

            <div className="flex items-center justify-end pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveEvaluation}
                isLoading={isSavingEvaluation}
                leftIcon={<Save className="w-3.5 h-3.5" />}
              >
                Save Evaluation
              </Button>
            </div>
          </div>
        )}

        {evalSaveSuccess && (
          <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-xl text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-700" />
            <span className="font-bold">Appraisal, Remarks and Ratings saved successfully for this report card!</span>
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
                {settings.schoolName ? settings.schoolName.charAt(0) : 'S'}
              </div>
              <div className="text-left sm:text-center">
                <h1 className="text-xl sm:text-2xl font-black text-emerald-950 uppercase tracking-wide leading-tight">
                  {settings.schoolName}
                </h1>
                <p className="text-[11px] text-slate-600 font-medium">{settings.address}</p>
              </div>
            </div>
            
            <p className="text-[11px] text-slate-500">
              Tel: {settings.phone} • Email: {settings.email} • Govt. Reg: ED/PRS/SCH/2019/842
            </p>
            
            <div className="inline-block mt-2.5 px-6 py-1 bg-emerald-900 text-white text-xs font-black uppercase tracking-widest rounded-sm shadow-xs">
              Continuous Assessment & Terminal Examination Report
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
              <strong className="text-slate-900 font-mono">{student.admissionNumber || 'STU-2026-N/A'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Class / Grade Arm</span>
              <strong className="text-slate-900 font-bold">{schoolClass ? schoolClass.name : 'Primary Class'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Academic Session & Term</span>
              <strong className="text-slate-900 font-bold">{currentTerm} ({currentSession})</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Total Enrolment in Class</span>
              <span className="text-slate-800 font-bold">{totalStudentsInClass} Pupils</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Term Attendance</span>
              <span className="text-slate-800 font-bold">
                {attendanceSummary.present} / {attendanceSummary.total} Days ({attendanceSummary.rate}%)
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Date of Birth / Gender</span>
              <span className="text-slate-800 font-bold">{student.gender || 'Pupil'} • {formatDate(student.dateOfBirth)}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Overall Average & Status</span>
              <span className="text-emerald-900 font-black text-sm">{averageScore}%</span>
            </div>
          </div>

          {/* Academic Results Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-300">
            <table className="w-full text-xs text-left">
              <thead className="bg-emerald-900 text-white font-bold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-3.5 py-2">Academic Subject</th>
                  <th className="px-2.5 py-2 text-center">CA (30)</th>
                  <th className="px-2.5 py-2 text-center">Exam (70)</th>
                  <th className="px-2.5 py-2 text-center">Total (100)</th>
                  <th className="px-2.5 py-2 text-center">Grade</th>
                  <th className="px-3 py-2 text-left">Teacher Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium">
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400 italic">
                      No examination marks registered for this pupil in {currentTerm} ({currentSession}).
                    </td>
                  </tr>
                ) : (
                  results.map((r, index) => (
                    <tr key={r.resultId || index} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                      <td className="px-3.5 py-2 font-bold text-slate-900">
                        {formatSubjectTitle(r.subjectId, subjects)}
                      </td>
                      <td className="px-2.5 py-2 text-center text-slate-700">{r.caScore ?? 0}</td>
                      <td className="px-2.5 py-2 text-center text-slate-700">{r.examScore ?? 0}</td>
                      <td className="px-2.5 py-2 text-center font-bold text-slate-900">{r.totalScore ?? 0}</td>
                      <td className="px-2.5 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                          r.grade === 'A' ? 'bg-emerald-100 text-emerald-800' :
                          r.grade === 'B' ? 'bg-teal-100 text-teal-800' :
                          r.grade === 'C' ? 'bg-blue-100 text-blue-800' :
                          r.grade === 'D' ? 'bg-amber-100 text-amber-800' :
                          'bg-rose-100 text-rose-800'
                        }`}>
                          {r.grade || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 italic text-[11px]">
                        {r.teacherComment || r.remark || 'Satisfactory work'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {results.length > 0 && (
                <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-300">
                  <tr>
                    <td className="px-3.5 py-2 text-left uppercase text-slate-800">Overall Summary</td>
                    <td colSpan={2} className="px-2.5 py-2 text-center text-slate-700">
                      Marks Scored: <strong className="text-slate-900">{totalScored}</strong> / {totalPossible}
                    </td>
                    <td className="px-2.5 py-2 text-center font-black text-emerald-900 text-sm">
                      {averageScore}%
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-left">
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

          {/* Grading Scale Key */}
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600 flex flex-wrap justify-between gap-1">
            <span className="font-bold text-slate-800 uppercase">Grading Scale:</span>
            {settings.gradingScale && settings.gradingScale.length > 0 ? (
              settings.gradingScale.map((g) => (
                <span key={g.grade}>
                  {g.min}-{g.max}: <strong>{g.grade} ({g.remark})</strong>
                </span>
              ))
            ) : (
              <>
                <span>70-100: <strong>A (Distinction)</strong></span>
                <span>60-69: <strong>B (Very Good)</strong></span>
                <span>50-59: <strong>C (Credit)</strong></span>
                <span>45-49: <strong>D (Pass)</strong></span>
                <span>40-44: <strong>E (Fair)</strong></span>
                <span>0-39: <strong>F (Fail)</strong></span>
              </>
            )}
          </div>

          {/* Teacher & Principal Remarks with Seals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* Teacher's Appraisal */}
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

            {/* Principal / Head of School's Remark */}
            <div className="p-3 bg-white border border-slate-300 rounded-lg space-y-1.5 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-950 uppercase text-[10px] block">
                  Principal / Head of School's Remark:
                </span>
                {reportTemplate.showOfficialSeal !== false && (
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
                    {reportTemplate.principalName || 'Dr. E. O. Okonjo (PhD)'}
                  </div>
                  <span className="text-[10px] text-slate-400 block">
                    {reportTemplate.principalTitle || 'Head of School Signature & Stamp'}
                  </span>
                </div>
                {reportTemplate.showOfficialSeal !== false && (
                  <div className="border border-emerald-700 text-emerald-800 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-50">
                    {reportTemplate.officialSealText || 'APPROVED'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Next Term Resumption & Fees Notice */}
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
              className="flex-1 sm:flex-none"
            >
              Print Report Card
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
