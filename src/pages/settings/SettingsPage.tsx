import React, { useState, useEffect } from 'react';
import { useSchool } from '../../contexts/SchoolContext';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Term, SchoolSettings, ReportTemplateSettings, AffectiveTraitConfig } from '../../types';
import { 
  CheckCircle2, 
  Save, 
  Database, 
  Download, 
  Trash2, 
  AlertTriangle,
  RefreshCw,
  HardDrive,
  Sparkles,
  RotateCcw,
  Sliders,
  Award,
  BookOpen,
  Plus,
  X,
  FileText,
  Building2,
  Check,
  UserCheck,
  ShieldCheck,
  Search,
  Mail
} from 'lucide-react';
import { logAudit } from '../../utils/formatters';
import { 
  getDatabaseStats, 
  purgeCollections, 
  generateTestRecords, 
  exportSchoolDataBackup,
  CollectionStat 
} from '../../services/dataManagement';
import { DEFAULT_REPORT_TEMPLATE, DEFAULT_AFFECTIVE_TRAITS, deleteSchool } from '../../services/schoolService';
import { runTenantDryRunVerification, DryRunReport } from '../../services/tenantMigrationService';
import { GradingSettingsTab } from '../../components/settings/GradingSettingsTab';
import { useQueryTab } from '../../routes/useQueryTab';

export const SettingsPage: React.FC = () => {
  const { settings, updateSettings, schoolId } = useSchool();
  const { currentUser, role, isAtLeastAdmin, updateUserPassword, resetPassword } = useAuth();

  // Active tab synchronized with URL ?tab= query param
  const [activeTab, setActiveTab] = useQueryTab<
    'grading_settings' | 'report_template' | 'general_profile' | 'database' | 'security'
  >('tab', 'grading_settings', [
    'grading_settings',
    'report_template',
    'general_profile',
    'database',
    'security',
  ]);

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSendingResetEmail, setIsSendingResetEmail] = useState(false);
  const [resetEmailSuccess, setResetEmailSuccess] = useState('');

  // General Institutional Settings
  const [schoolName, setSchoolName] = useState(settings.schoolName);
  const [address, setAddress] = useState(settings.address || '');
  const [phone, setPhone] = useState(settings.phone || '');
  const [email, setEmail] = useState(settings.email || '');
  const [currentAcademicSession, setCurrentAcademicSession] = useState(settings.currentAcademicSession);
  const [currentTerm, setCurrentTerm] = useState<Term>(settings.currentTerm);
  const [nextTermResumptionDate, setNextTermResumptionDate] = useState(settings.nextTermResumptionDate || '2026-09-21');

  // Report Card Template Settings
  const initialTemplate = settings.reportTemplate || DEFAULT_REPORT_TEMPLATE;
  const [principalName, setPrincipalName] = useState(initialTemplate.principalName || 'Dr. E. O. Okonjo (PhD)');
  const [principalTitle, setPrincipalTitle] = useState(initialTemplate.principalTitle || 'Head of School Signature & Stamp');
  const [officialSealText, setOfficialSealText] = useState(initialTemplate.officialSealText || 'APPROVED');
  const [teacherTitle, setTeacherTitle] = useState(initialTemplate.teacherTitle || 'Class Teacher Signature');
  const [defaultTeacherName, setDefaultTeacherName] = useState(initialTemplate.defaultTeacherName || 'Class Teacher');

  // Principal performance remarks
  const [principalDistinction, setPrincipalDistinction] = useState(initialTemplate.principalRemarkDistinction || '');
  const [principalCredit, setPrincipalCredit] = useState(initialTemplate.principalRemarkCredit || '');
  const [principalPass, setPrincipalPass] = useState(initialTemplate.principalRemarkPass || '');
  const [principalTrial, setPrincipalTrial] = useState(initialTemplate.principalRemarkTrial || '');

  // Teacher appraisal remarks
  const [teacherDistinction, setTeacherDistinction] = useState(initialTemplate.teacherAppraisalDistinction || '');
  const [teacherCredit, setTeacherCredit] = useState(initialTemplate.teacherAppraisalCredit || '');
  const [teacherPass, setTeacherPass] = useState(initialTemplate.teacherAppraisalPass || '');
  const [teacherTrial, setTeacherTrial] = useState(initialTemplate.teacherAppraisalTrial || '');

  // Academic verdict labels
  const [verdictDistinction, setVerdictDistinction] = useState(initialTemplate.verdictDistinction || 'PASSED WITH HIGH DISTINCTION');
  const [verdictCredit, setVerdictCredit] = useState(initialTemplate.verdictCredit || 'PASSED WITH CREDIT');
  const [verdictPass, setVerdictPass] = useState(initialTemplate.verdictPass || 'PASSED');
  const [verdictTrial, setVerdictTrial] = useState(initialTemplate.verdictTrial || 'PROMOTED ON TRIAL');

  // Affective & Psychomotor traits
  const [ratingScaleDesc, setRatingScaleDesc] = useState(
    initialTemplate.ratingScaleDescription || 'Affective & Psychomotor Skills Rating (5: Excellent | 4: Good | 3: Fair | 2: Poor | 1: Very Poor)'
  );
  const [traits, setTraits] = useState<AffectiveTraitConfig[]>(
    initialTemplate.affectiveTraits?.length ? initialTemplate.affectiveTraits : DEFAULT_AFFECTIVE_TRAITS
  );

  // New trait creation draft
  const [newTraitName, setNewTraitName] = useState('');
  const [newTraitCategory, setNewTraitCategory] = useState<'affective' | 'psychomotor'>('affective');
  const [newTraitScore, setNewTraitScore] = useState<number>(4);

  // Clearance and display flags
  const [clearanceNotice, setClearanceNotice] = useState(
    initialTemplate.clearanceNotice || 'Clearance Verified. Please present this report card upon resumption.'
  );
  const [showAttendanceSummary, setShowAttendanceSummary] = useState(initialTemplate.showAttendanceSummary !== false);
  const [showOfficialSeal, setShowOfficialSeal] = useState(initialTemplate.showOfficialSeal !== false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Database Management & Stats
  const [dbStats, setDbStats] = useState<CollectionStat[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Purge Modal
  const ALL_PURGEABLE_COLLECTIONS = [
    { id: 'students', label: 'Students Directory' },
    { id: 'classes', label: 'Classes & Grade Arms' },
    { id: 'subjects', label: 'Curriculum Subjects' },
    { id: 'teachers', label: 'Teachers Records' },
    { id: 'parents', label: 'Parent Contacts' },
    { id: 'attendance', label: 'Attendance Records' },
    { id: 'feeStructures', label: 'Fee Tariffs' },
    { id: 'payments', label: 'Payments & Receipts' },
    { id: 'results', label: 'Examination Results' },
    { id: 'assignments', label: 'Homework & Assignments' },
    { id: 'submissions', label: 'Student Submissions' },
    { id: 'announcements', label: 'Announcements' },
    { id: 'notifications', label: 'In-App Notifications' },
    { id: 'evaluations', label: 'Student Evaluations' },
    { id: 'auditLogs', label: 'Audit Logs' },
  ];

  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeConfirmationText, setPurgeConfirmationText] = useState('');
  const [selectedCollectionsToPurge, setSelectedCollectionsToPurge] = useState<string[]>([
    'students', 'classes', 'subjects', 'teachers', 'parents', 'attendance', 'feeStructures', 
    'payments', 'results', 'assignments', 'submissions', 'announcements', 'notifications', 'evaluations', 'auditLogs'
  ]);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeSuccessMessage, setPurgeSuccessMessage] = useState('');
  const [purgeErrorMessage, setPurgeErrorMessage] = useState('');

  // Regenerate Test Data Modal
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateProgress, setRegenerateProgress] = useState('');
  const [regenerateSuccessMessage, setRegenerateSuccessMessage] = useState('');
  const [regenerateErrorMessage, setRegenerateErrorMessage] = useState('');
  const [purgeFirst, setPurgeFirst] = useState(true);

  // Delete School Institution Modal
  const [showDeleteSchoolModal, setShowDeleteSchoolModal] = useState(false);
  const [deleteSchoolConfirmText, setDeleteSchoolConfirmText] = useState('');
  const [isDeletingSchool, setIsDeletingSchool] = useState(false);
  const [deleteSchoolError, setDeleteSchoolError] = useState('');
  const [deleteSchoolSuccess, setDeleteSchoolSuccess] = useState('');

  // Multi-Tenant Dry-Run Verification
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [isRunningDryRun, setIsRunningDryRun] = useState(false);
  const [dryRunReport, setDryRunReport] = useState<DryRunReport | null>(null);

  const handleRunDryRun = async () => {
    setIsRunningDryRun(true);
    try {
      const report = await runTenantDryRunVerification();
      setDryRunReport(report);
    } catch (err: any) {
      console.error('Failed to run dry-run audit:', err);
    } finally {
      setIsRunningDryRun(false);
    }
  };

  const loadStats = async () => {
    if (!isAtLeastAdmin) return;
    setLoadingStats(true);
    try {
      const stats = await getDatabaseStats(schoolId);
      setDbStats(stats);
    } catch (e) {
      console.error('Error loading db stats:', e);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [role, schoolId]);

  // Sync settings when loaded from Firestore
  useEffect(() => {
    if (settings) {
      setSchoolName(settings.schoolName || '');
      setAddress(settings.address || '');
      setPhone(settings.phone || '');
      setEmail(settings.email || '');
      setCurrentAcademicSession(settings.currentAcademicSession || '2026/2027');
      setCurrentTerm(settings.currentTerm || 'First Term');
      setNextTermResumptionDate(settings.nextTermResumptionDate || '2026-09-21');

      if (settings.reportTemplate) {
        const rt = settings.reportTemplate;
        setPrincipalName(rt.principalName || 'Dr. E. O. Okonjo (PhD)');
        setPrincipalTitle(rt.principalTitle || 'Head of School Signature & Stamp');
        setOfficialSealText(rt.officialSealText || 'APPROVED');
        setTeacherTitle(rt.teacherTitle || 'Class Teacher Signature');
        setDefaultTeacherName(rt.defaultTeacherName || 'Class Teacher');

        setPrincipalDistinction(rt.principalRemarkDistinction || '');
        setPrincipalCredit(rt.principalRemarkCredit || '');
        setPrincipalPass(rt.principalRemarkPass || '');
        setPrincipalTrial(rt.principalRemarkTrial || '');

        setTeacherDistinction(rt.teacherAppraisalDistinction || '');
        setTeacherCredit(rt.teacherAppraisalCredit || '');
        setTeacherPass(rt.teacherAppraisalPass || '');
        setTeacherTrial(rt.teacherAppraisalTrial || '');

        setVerdictDistinction(rt.verdictDistinction || 'PASSED WITH HIGH DISTINCTION');
        setVerdictCredit(rt.verdictCredit || 'PASSED WITH CREDIT');
        setVerdictPass(rt.verdictPass || 'PASSED');
        setVerdictTrial(rt.verdictTrial || 'PROMOTED ON TRIAL');

        setRatingScaleDesc(rt.ratingScaleDescription || 'Affective & Psychomotor Skills Rating (5: Excellent | 4: Good | 3: Fair | 2: Poor | 1: Very Poor)');
        if (rt.affectiveTraits?.length) {
          setTraits(rt.affectiveTraits);
        }
        setClearanceNotice(rt.clearanceNotice || 'Clearance Verified. Please present this report card upon resumption.');
        setShowAttendanceSummary(rt.showAttendanceSummary !== false);
        setShowOfficialSeal(rt.showOfficialSeal !== false);
      }
    }
  }, [settings]);

  const handleAddTrait = () => {
    if (!newTraitName.trim()) return;
    const newTrait: AffectiveTraitConfig = {
      id: `trait_${Date.now()}`,
      trait: newTraitName.trim(),
      category: newTraitCategory,
      defaultScore: newTraitScore,
    };
    setTraits([...traits, newTrait]);
    setNewTraitName('');
    setNewTraitScore(4);
  };

  const handleRemoveTrait = (id: string) => {
    setTraits(traits.filter(t => t.id !== id && t.trait !== id));
  };

  const handleResetDefaultTraits = () => {
    setTraits(DEFAULT_AFFECTIVE_TRAITS);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const updatedReportTemplate: ReportTemplateSettings = {
        principalName: principalName.trim(),
        principalTitle: principalTitle.trim(),
        officialSealText: officialSealText.trim(),
        teacherTitle: teacherTitle.trim(),
        defaultTeacherName: defaultTeacherName.trim(),

        principalRemarkDistinction: principalDistinction.trim(),
        principalRemarkCredit: principalCredit.trim(),
        principalRemarkPass: principalPass.trim(),
        principalRemarkTrial: principalTrial.trim(),

        teacherAppraisalDistinction: teacherDistinction.trim(),
        teacherAppraisalCredit: teacherCredit.trim(),
        teacherAppraisalPass: teacherPass.trim(),
        teacherAppraisalTrial: teacherTrial.trim(),

        verdictDistinction: verdictDistinction.trim(),
        verdictCredit: verdictCredit.trim(),
        verdictPass: verdictPass.trim(),
        verdictTrial: verdictTrial.trim(),

        ratingScaleDescription: ratingScaleDesc.trim(),
        affectiveTraits: traits,

        clearanceNotice: clearanceNotice.trim(),
        showAttendanceSummary,
        showOfficialSeal,
      };

      const payload: Partial<SchoolSettings> = {
        schoolName: schoolName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        currentAcademicSession: currentAcademicSession.trim(),
        currentTerm,
        nextTermResumptionDate,
        timeZone: 'Africa/Lagos',
        currency: 'NGN',
        reportTemplate: updatedReportTemplate,
      };

      await updateSettings(payload);

      await logAudit(
        currentUser?.uid || (role === 'TEACHER' ? 'teacher' : 'admin'),
        'REPORT_SETTINGS_UPDATED',
        'schoolSettings',
        'general',
        `Updated report card templates, remarks, and affective traits`
      );

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      console.error('Error updating settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      await exportSchoolDataBackup(schoolId);
    } catch (e) {
      console.error('Error exporting backup:', e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExecutePurge = async () => {
    if (purgeConfirmationText.trim().toUpperCase() !== 'PURGE') {
      setPurgeErrorMessage('Please type PURGE to confirm.');
      return;
    }

    setIsPurging(true);
    setPurgeErrorMessage('');
    setPurgeSuccessMessage('');

    try {
      const res = await purgeCollections(selectedCollectionsToPurge, currentUser?.uid || 'admin', schoolId);
      setPurgeSuccessMessage(`Successfully wiped ${res.deletedCount} records. Database reset to clean state.`);
      setPurgeConfirmationText('');
      await loadStats();
      setTimeout(() => {
        setShowPurgeModal(false);
        setPurgeSuccessMessage('');
      }, 2500);
    } catch (err: any) {
      setPurgeErrorMessage(err.message || 'Failed to purge records');
    } finally {
      setIsPurging(false);
    }
  };

  const togglePurgeCollection = (colName: string) => {
    if (selectedCollectionsToPurge.includes(colName)) {
      setSelectedCollectionsToPurge(selectedCollectionsToPurge.filter(c => c !== colName));
    } else {
      setSelectedCollectionsToPurge([...selectedCollectionsToPurge, colName]);
    }
  };

  const handleExecuteRegenerate = async () => {
    setIsRegenerating(true);
    setRegenerateProgress('Initializing demo records engine...');
    setRegenerateErrorMessage('');
    setRegenerateSuccessMessage('');

    try {
      const res = await generateTestRecords(currentUser?.uid || 'admin', {
        purgeFirst,
        schoolId,
        onProgress: (msg) => setRegenerateProgress(msg),
      });
      setRegenerateSuccessMessage(`Successfully regenerated ${res.createdCount} realistic school records across all collections!`);
      await loadStats();
      setTimeout(() => {
        setShowRegenerateModal(false);
        setRegenerateSuccessMessage('');
        setRegenerateProgress('');
      }, 3000);
    } catch (err: any) {
      console.error('Error generating test records:', err);
      setRegenerateErrorMessage(err.message || 'Failed to generate test records');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleExecuteDeleteSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = (schoolId || 'default').toLowerCase().trim();
    const isConfirmed = deleteSchoolConfirmText.trim().toLowerCase() === targetId ||
                        deleteSchoolConfirmText.trim().toUpperCase() === 'DELETE';

    if (!isConfirmed) {
      setDeleteSchoolError(`Please type "${targetId}" or "DELETE" to confirm.`);
      return;
    }

    setIsDeletingSchool(true);
    setDeleteSchoolError('');
    setDeleteSchoolSuccess('');

    try {
      await deleteSchool(targetId, true, currentUser?.uid || 'admin');
      setDeleteSchoolSuccess(`School institution "${targetId}" and all associated tenant records have been removed.`);
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      console.error('Error removing school institution:', err);
      setDeleteSchoolError(err.message || 'Failed to remove school');
    } finally {
      setIsDeletingSchool(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!currentUser?.email) {
      setPasswordError('No email associated with current user account.');
      return;
    }
    setIsSendingResetEmail(true);
    setPasswordError('');
    setPasswordSuccess('');
    setResetEmailSuccess('');

    try {
      await resetPassword(currentUser.email);
      setResetEmailSuccess(`Password reset email sent to ${currentUser.email}! Please check your inbox or spam folder.`);
    } catch (err: any) {
      console.warn('Password reset notice:', err?.message || err);
      setPasswordError(err?.message || 'Failed to send password reset email. Please try again.');
    } finally {
      setIsSendingResetEmail(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match. Please verify.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }

    setIsChangingPassword(true);
    setPasswordError('');
    setPasswordSuccess('');
    setResetEmailSuccess('');

    try {
      await updateUserPassword(currentPassword, newPassword);
      setPasswordSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.warn('Password update notice:', err?.message || err);
      setPasswordError(err?.message || 'Failed to update password. Please verify your current password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          Settings & Report Card Templates
        </h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Configure report card evaluation remarks, affective traits, Principal stamps, teacher appraisal presets, and academic term calendar.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('grading_settings')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'grading_settings'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Grading & Report Card Settings
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('report_template')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'report_template'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Award className="w-4 h-4" />
          Report Layout & Appraisal Remarks
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('general_profile')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'general_profile'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          School Profile & Academic Calendar
        </button>

        {isAtLeastAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('database')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'database'
                ? 'bg-emerald-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            Database Maintenance & Tools
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'security'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Security & Password
        </button>
      </div>

      {saveSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <span className="font-semibold">Settings and evaluation templates updated and saved successfully!</span>
        </div>
      )}

      {/* TAB 0: Grading & Report Card Settings */}
      {activeTab === 'grading_settings' && <GradingSettingsTab />}

      {/* TAB 1: Report Card & Evaluation Template Settings */}
      {activeTab === 'report_template' && (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Section A: Head of School / Principal's Appraisal & Official Seal */}
          <Card>
            <CardHeader
              title="1. Principal / Head of School's Authority & Remarks"
              subtitle="Official authority title, seal approval stamp, and performance-tiered automated remarks"
            />
            <CardBody className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  id="settings-principal-name"
                  label="Head of School / Principal Name"
                  value={principalName}
                  onChange={(e) => setPrincipalName(e.target.value)}
                  required
                  placeholder="e.g. Dr. E. O. Okonjo (PhD)"
                />

                <Input
                  id="settings-principal-title"
                  label="Designation / Signature Label"
                  value={principalTitle}
                  onChange={(e) => setPrincipalTitle(e.target.value)}
                  required
                  placeholder="e.g. Head of School Signature & Stamp"
                />

                <Input
                  id="settings-official-seal-text"
                  label="Official Seal / Stamp Badge Text"
                  value={officialSealText}
                  onChange={(e) => setOfficialSealText(e.target.value)}
                  placeholder="e.g. APPROVED or OFFICIAL SEAL"
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-800 block mb-2 uppercase tracking-wide">
                  Tiered Automated Remarks for Head of School (Based on Student Average):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-emerald-900 block mb-1">
                      Distinction Tier (Average ≥ 80%):
                    </label>
                    <textarea
                      rows={2}
                      value={principalDistinction}
                      onChange={(e) => setPrincipalDistinction(e.target.value)}
                      placeholder="e.g. Executive Academic Distinction. Commended for superior intellect and exemplary conduct."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-teal-800 block mb-1">
                      Credit Tier (Average 65% – 79%):
                    </label>
                    <textarea
                      rows={2}
                      value={principalCredit}
                      onChange={(e) => setPrincipalCredit(e.target.value)}
                      placeholder="e.g. Good academic standing. Maintain steady revision to sustain this standard."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-blue-800 block mb-1">
                      Pass Tier (Average 50% – 64%):
                    </label>
                    <textarea
                      rows={2}
                      value={principalPass}
                      onChange={(e) => setPrincipalPass(e.target.value)}
                      placeholder="e.g. Satisfactory performance. Advised to focus on weaker subject areas."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-amber-800 block mb-1">
                      Trial / Remedial Tier (Average &lt; 50%):
                    </label>
                    <textarea
                      rows={2}
                      value={principalTrial}
                      onChange={(e) => setPrincipalTrial(e.target.value)}
                      placeholder="e.g. Fair effort. Compulsory holiday coaching recommended in core calculation subjects."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Section B: Class Teacher's Appraisal & Comments */}
          <Card>
            <CardHeader
              title="2. Class Teacher's Appraisal & Recommendation Templates"
              subtitle="Default signature attribution and tiered appraisal comments for classroom educators"
            />
            <CardBody className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  id="settings-teacher-title"
                  label="Teacher Signature Label"
                  value={teacherTitle}
                  onChange={(e) => setTeacherTitle(e.target.value)}
                  placeholder="e.g. Class Teacher Signature"
                />

                <Input
                  id="settings-default-teacher-name"
                  label="Default Class Teacher Attribution"
                  value={defaultTeacherName}
                  onChange={(e) => setDefaultTeacherName(e.target.value)}
                  placeholder="e.g. Class Teacher or Form Master"
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-800 block mb-2 uppercase tracking-wide">
                  Tiered Educator Appraisal Comments (Based on Student Average):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-emerald-900 block mb-1">
                      Distinction Appraisal (Average ≥ 80%):
                    </label>
                    <textarea
                      rows={2}
                      value={teacherDistinction}
                      onChange={(e) => setTeacherDistinction(e.target.value)}
                      placeholder="e.g. An exceptionally brilliant, diligent, and disciplined pupil. Outstanding overall performance!"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-teal-800 block mb-1">
                      Credit Appraisal (Average 65% – 79%):
                    </label>
                    <textarea
                      rows={2}
                      value={teacherCredit}
                      onChange={(e) => setTeacherCredit(e.target.value)}
                      placeholder="e.g. Very good work throughout the term. Shows keen analytical interest and participates actively."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-blue-800 block mb-1">
                      Pass Appraisal (Average 50% – 64%):
                    </label>
                    <textarea
                      rows={2}
                      value={teacherPass}
                      onChange={(e) => setTeacherPass(e.target.value)}
                      placeholder="e.g. A steady pupil capable of higher attainment. More diligence required in home assignments."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-amber-800 block mb-1">
                      Trial / Remedial Appraisal (Average &lt; 50%):
                    </label>
                    <textarea
                      rows={2}
                      value={teacherTrial}
                      onChange={(e) => setTeacherTrial(e.target.value)}
                      placeholder="e.g. Needs to pay strict attention in class, avoid distractions, and complete all assignments."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Section C: Affective & Psychomotor Behavioral Domain Rating */}
          <Card>
            <CardHeader
              title="3. Affective & Psychomotor Behavioral Domain Rating"
              subtitle="Configure assessed traits, ratings scale key, and behavioral evaluation criteria"
            />
            <CardBody className="p-6 space-y-4">
              <div>
                <Input
                  id="settings-rating-scale-desc"
                  label="Rating Scale Key Description"
                  value={ratingScaleDesc}
                  onChange={(e) => setRatingScaleDesc(e.target.value)}
                  placeholder="e.g. Affective & Psychomotor Skills Rating (5: Excellent | 4: Good | 3: Fair | 2: Poor | 1: Very Poor)"
                />
              </div>

              {/* Trait list management */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Evaluated Character & Physical Traits ({traits.length}):
                  </span>
                  <button
                    type="button"
                    onClick={handleResetDefaultTraits}
                    className="text-xs text-emerald-800 hover:text-emerald-950 font-semibold underline"
                  >
                    Reset to Standard National Curriculum Traits
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {traits.map((t) => (
                    <div
                      key={t.id || t.trait}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-800 block truncate" title={t.trait}>
                          {t.trait}
                        </span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                            t.category === 'psychomotor' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {t.category || 'affective'}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            Default: <strong>{t.defaultScore || 4}/5</strong>
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveTrait(t.id || t.trait)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors"
                        title="Delete Trait"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add new trait */}
                <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3">
                  <span className="text-xs font-bold text-emerald-950 block">
                    Add New Character or Psychomotor Trait:
                  </span>
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <input
                      type="text"
                      value={newTraitName}
                      onChange={(e) => setNewTraitName(e.target.value)}
                      placeholder="e.g. Leadership & Initiative, Verbal Fluency, Crafts"
                      className="flex-1 px-3 py-2 bg-white border border-emerald-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                    />

                    <select
                      value={newTraitCategory}
                      onChange={(e) => setNewTraitCategory(e.target.value as 'affective' | 'psychomotor')}
                      className="px-3 py-2 bg-white border border-emerald-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-emerald-600"
                    >
                      <option value="affective">Affective Domain (Behavioral)</option>
                      <option value="psychomotor">Psychomotor Domain (Physical/Skill)</option>
                    </select>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 font-medium">Default:</span>
                      <select
                        value={newTraitScore}
                        onChange={(e) => setNewTraitScore(parseInt(e.target.value, 10))}
                        className="px-2.5 py-2 bg-white border border-emerald-300 rounded-lg text-xs font-bold"
                      >
                        <option value={5}>5 (Excellent)</option>
                        <option value={4}>4 (Good)</option>
                        <option value={3}>3 (Fair)</option>
                        <option value={2}>2 (Poor)</option>
                        <option value={1}>1 (Very Poor)</option>
                      </select>
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={handleAddTrait}
                      disabled={!newTraitName.trim()}
                      leftIcon={<Plus className="w-3.5 h-3.5" />}
                    >
                      Add Trait
                    </Button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Section D: Academic Verdicts & Clearance Notice */}
          <Card>
            <CardHeader
              title="4. Academic Verdicts, Next Term Resumption & Clearance"
              subtitle="Official promotion verdicts and administrative clearance instructions"
            />
            <CardBody className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Input
                  id="settings-verdict-distinction"
                  label="Distinction Verdict (≥80%)"
                  value={verdictDistinction}
                  onChange={(e) => setVerdictDistinction(e.target.value)}
                  placeholder="PASSED WITH HIGH DISTINCTION"
                />

                <Input
                  id="settings-verdict-credit"
                  label="Credit Verdict (65-79%)"
                  value={verdictCredit}
                  onChange={(e) => setVerdictCredit(e.target.value)}
                  placeholder="PASSED WITH CREDIT"
                />

                <Input
                  id="settings-verdict-pass"
                  label="Pass Verdict (50-64%)"
                  value={verdictPass}
                  onChange={(e) => setVerdictPass(e.target.value)}
                  placeholder="PASSED"
                />

                <Input
                  id="settings-verdict-trial"
                  label="Remedial / Trial Verdict (<50%)"
                  value={verdictTrial}
                  onChange={(e) => setVerdictTrial(e.target.value)}
                  placeholder="PROMOTED ON TRIAL"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <Input
                  id="settings-resumption-date-rt"
                  type="date"
                  label="Next Academic Term Resumption Date"
                  value={nextTermResumptionDate}
                  onChange={(e) => setNextTermResumptionDate(e.target.value)}
                  required
                />

                <Input
                  id="settings-clearance-notice"
                  label="Clearance Status Instruction"
                  value={clearanceNotice}
                  onChange={(e) => setClearanceNotice(e.target.value)}
                  placeholder="e.g. Clearance Verified. Please present this report card upon resumption."
                />
              </div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAttendanceSummary}
                    onChange={(e) => setShowAttendanceSummary(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-800 focus:ring-emerald-600"
                  />
                  <span>Display Student Attendance Summary on Report Card</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showOfficialSeal}
                    onChange={(e) => setShowOfficialSeal(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-800 focus:ring-emerald-600"
                  />
                  <span>Display Official Approval Seal Badge</span>
                </label>
              </div>
            </CardBody>
          </Card>

          {/* Submit button */}
          <div className="flex justify-end gap-3">
            <Button
              id="save-report-template-btn"
              type="submit"
              size="lg"
              variant="primary"
              isLoading={isSaving}
              leftIcon={<Save className="w-4 h-4" />}
            >
              Save Report Template & Evaluation Settings
            </Button>
          </div>
        </form>
      )}

      {/* TAB 2: General Institutional Profile & Calendar */}
      {activeTab === 'general_profile' && (
        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardHeader
              title="Institutional Information"
              subtitle="Official identity shown on receipts, report cards, and communications"
            />
            <CardBody className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  id="settings-school-name"
                  label="School Full Name"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  disabled={!isAtLeastAdmin}
                  required
                  placeholder="e.g. Gracefield International College"
                />

                <Input
                  id="settings-school-email"
                  type="email"
                  label="Administrative Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!isAtLeastAdmin}
                  required
                  placeholder="admin@school.edu.ng"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  id="settings-school-phone"
                  label="Contact Telephone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={!isAtLeastAdmin}
                  placeholder="+234 803 123 4567"
                />

                <Input
                  id="settings-school-address"
                  label="Physical Address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={!isAtLeastAdmin}
                  required
                  placeholder="e.g. Plot 15, Unity Crescent, Ikeja, Lagos"
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Academic Term & Session"
              subtitle="Current calendar active across student attendance, billing, and report cards"
            />
            <CardBody className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  id="settings-academic-session"
                  label="Academic Session"
                  value={currentAcademicSession}
                  onChange={(e) => setCurrentAcademicSession(e.target.value)}
                  disabled={!isAtLeastAdmin}
                  required
                  placeholder="e.g. 2026/2027"
                />

                <Select
                  id="settings-academic-term"
                  label="Current Term"
                  value={currentTerm}
                  onChange={(e) => setCurrentTerm(e.target.value as Term)}
                  disabled={!isAtLeastAdmin}
                  options={[
                    { value: 'First Term', label: 'First Term' },
                    { value: 'Second Term', label: 'Second Term' },
                    { value: 'Third Term', label: 'Third Term' },
                  ]}
                />

                <Input
                  id="settings-next-term-date"
                  type="date"
                  label="Next Term Resumption Date"
                  value={nextTermResumptionDate}
                  onChange={(e) => setNextTermResumptionDate(e.target.value)}
                  disabled={!isAtLeastAdmin}
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </CardBody>
          </Card>

          {isAtLeastAdmin && (
            <div className="flex justify-end">
              <Button
                id="save-settings-btn"
                type="submit"
                size="lg"
                isLoading={isSaving}
                leftIcon={<Save className="w-4 h-4" />}
              >
                Save Configuration
              </Button>
            </div>
          )}
        </form>
      )}

      {/* TAB 3: Database Maintenance & Launch Readiness (Admin Only) */}
      {activeTab === 'database' && isAtLeastAdmin && (
        <Card>
          <CardHeader
            title="System & Database Maintenance"
            subtitle="Database record statistics, complete JSON backups, and launch cleanup tools"
          />
          <CardBody className="p-6 space-y-6">
            {/* Live Database Statistics */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-700" />
                  <h4 className="text-sm font-bold text-slate-800">Current Database Records</h4>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={loadStats}
                  isLoading={loadingStats}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  Refresh Counts
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {dbStats.map((stat) => (
                  <div 
                    key={stat.name}
                    className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl"
                  >
                    <span className="text-xs text-slate-500 block truncate">{stat.label}</span>
                    <span className="text-lg font-bold text-slate-900 mt-0.5 block">{stat.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="max-w-md">
                <h4 className="text-sm font-bold text-slate-900">Download School Data Backup</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Export complete JSON snapshot of classes, students, fees, results, and staff records for offline archiving.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleExportBackup}
                isLoading={isExporting}
                leftIcon={<Download className="w-4 h-4" />}
              >
                Export Backup (JSON)
              </Button>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="max-w-md">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-sm font-bold text-slate-900">Regenerate Nigerian School Demo Records</h4>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Populate realistic Nigerian names, active classes (Creche to JSS 3), realistic fees, and assessment scores.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setShowRegenerateModal(true)}
                leftIcon={<RotateCcw className="w-4 h-4 text-emerald-700" />}
              >
                Populate Demo Data
              </Button>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="max-w-md">
                <div className="flex items-center gap-1.5">
                  <Trash2 className="w-4 h-4 text-rose-600" />
                  <h4 className="text-sm font-bold text-rose-900">Purge Records (Reset to Clean Slate)</h4>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Permanently wipe selected collections for institutional deployment. Admin account remains untouched.
                </p>
              </div>
              <Button
                variant="danger"
                onClick={() => setShowPurgeModal(true)}
                leftIcon={<Trash2 className="w-4 h-4" />}
              >
                Purge Database Records
              </Button>
            </div>

            <div className="pt-4 border-t border-rose-100 bg-rose-50/40 -mx-6 -mb-6 p-6 rounded-b-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="max-w-md">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <h4 className="text-sm font-bold text-rose-900">Decommission / Remove School</h4>
                </div>
                <p className="text-xs text-rose-700/80 mt-0.5">
                  Permanently delete this entire school institution, its settings, domain mappings, and all tenant data.
                </p>
              </div>
              <Button
                variant="danger"
                onClick={() => {
                  setDeleteSchoolConfirmText('');
                  setDeleteSchoolError('');
                  setDeleteSchoolSuccess('');
                  setShowDeleteSchoolModal(true);
                }}
                leftIcon={<Trash2 className="w-4 h-4" />}
              >
                Delete School
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* TAB 4: Security & Password */}
      {activeTab === 'security' && (
        <Card>
          <CardHeader
            title="Account Security & Password"
            subtitle="Update your authentication credentials and login password"
          />
          <CardBody className="p-6">
            <form onSubmit={handlePasswordChange} className="max-w-md space-y-4">
              {passwordError && (
                <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span>{passwordError}</span>
                    {passwordError.toLowerCase().includes('incorrect') && currentUser?.email && (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={handleSendResetEmail}
                          disabled={isSendingResetEmail}
                          className="font-bold underline hover:text-rose-900 cursor-pointer text-xs flex items-center gap-1"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          {isSendingResetEmail ? 'Sending reset link...' : `Forgot password? Send reset link to ${currentUser.email}`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {passwordSuccess && (
                <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{passwordSuccess}</span>
                </div>
              )}
              {resetEmailSuccess && (
                <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-start gap-2">
                  <Mail className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <span>{resetEmailSuccess}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="current-password" className="text-sm font-medium text-slate-700">
                    Current Password
                  </label>
                  {currentUser?.email && (
                    <button
                      type="button"
                      onClick={handleSendResetEmail}
                      disabled={isSendingResetEmail}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline cursor-pointer"
                    >
                      {isSendingResetEmail ? 'Sending...' : 'Forgot password?'}
                    </button>
                  )}
                </div>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  helperText="Required to verify your identity before changes"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-4">
                <Input
                  id="new-password"
                  type="password"
                  label="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  helperText="Minimum 6 characters"
                />

                <Input
                  id="confirm-password"
                  type="password"
                  label="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                />
              </div>

              <div className="pt-4 flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isChangingPassword}
                  leftIcon={<ShieldCheck className="w-4 h-4" />}
                >
                  Update Password
                </Button>
              </div>
            </form>

            <div className="mt-8 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Password Security & Self-Service</span>
                </div>
                {currentUser?.email && (
                  <button
                    type="button"
                    onClick={handleSendResetEmail}
                    disabled={isSendingResetEmail}
                    className="text-xs font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 cursor-pointer bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Send Reset Email</span>
                  </button>
                )}
              </div>
              <ul className="text-xs text-slate-500 list-disc pl-4 space-y-1">
                <li>Passwords must be at least 6 characters long.</li>
                <li>Avoid using easily guessable information like your name or birthdate.</li>
                <li>If you do not remember your current password, click <strong>Send Reset Email</strong> to receive a direct password reset link in your email inbox ({currentUser?.email}).</li>
              </ul>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Purge Modal */}
      <Modal
        isOpen={showPurgeModal}
        onClose={() => !isPurging && setShowPurgeModal(false)}
        title="Confirm Record Purge"
        subtitle="Irreversible operation. Please select collections to wipe."
      >
        <div className="space-y-4">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800 space-y-1">
              <p className="font-bold">Warning: This will permanently delete documents in selected collections!</p>
              <p>Your current Admin user login and School settings are preserved.</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700">Select Collections to Purge ({selectedCollectionsToPurge.length} selected):</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCollectionsToPurge(ALL_PURGEABLE_COLLECTIONS.map(c => c.id))}
                  className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedCollectionsToPurge([])}
                  className="text-xs text-slate-500 hover:text-slate-700 font-semibold"
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-1 border border-slate-200 rounded-lg">
              {ALL_PURGEABLE_COLLECTIONS.map((c) => (
                <label key={c.id} className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer border transition-colors ${
                  selectedCollectionsToPurge.includes(c.id)
                    ? 'bg-rose-50/60 border-rose-200 text-rose-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}>
                  <input
                    type="checkbox"
                    checked={selectedCollectionsToPurge.includes(c.id)}
                    onChange={() => togglePurgeCollection(c.id)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span className="font-medium truncate">{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Type <strong className="text-rose-600">PURGE</strong> to confirm:
            </label>
            <Input
              id="purge-confirm-text"
              value={purgeConfirmationText}
              onChange={(e) => setPurgeConfirmationText(e.target.value)}
              placeholder="PURGE"
            />
          </div>

          {purgeErrorMessage && (
            <p className="text-xs text-rose-600 font-semibold">{purgeErrorMessage}</p>
          )}

          {purgeSuccessMessage && (
            <p className="text-xs text-emerald-600 font-semibold">{purgeSuccessMessage}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowPurgeModal(false)}
              disabled={isPurging}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleExecutePurge}
              isLoading={isPurging}
              disabled={purgeConfirmationText.trim().toUpperCase() !== 'PURGE' || selectedCollectionsToPurge.length === 0}
            >
              Confirm Purge
            </Button>
          </div>
        </div>
      </Modal>

      {/* Regenerate Demo Records Modal */}
      <Modal
        isOpen={showRegenerateModal}
        onClose={() => !isRegenerating && setShowRegenerateModal(false)}
        title="Regenerate Nigerian School Test Data"
        subtitle="Quickly seed your portal with realistic classes, students, and results"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600">
            This operation populates realistic Nigerian names (Yoruba, Igbo, Hausa, Edo), standard classes (Nursery to JSS 3), realistic term fees, and exam results.
          </p>

          <label className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={purgeFirst}
              onChange={(e) => setPurgeFirst(e.target.checked)}
              className="rounded text-emerald-600"
            />
            <span className="font-semibold text-slate-800">
              Purge existing records first before regenerating (Recommended for clean state)
            </span>
          </label>

          {isRegenerating && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
              <RefreshCw className="w-4 h-4 text-emerald-700 animate-spin" />
              <span className="font-semibold text-emerald-900">{regenerateProgress}</span>
            </div>
          )}

          {regenerateSuccessMessage && (
            <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-xl text-emerald-900 font-bold">
              {regenerateSuccessMessage}
            </div>
          )}

          {regenerateErrorMessage && (
            <div className="p-3 bg-rose-100 border border-rose-300 rounded-xl text-rose-900 font-bold">
              {regenerateErrorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowRegenerateModal(false)}
              disabled={isRegenerating}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleExecuteRegenerate}
              isLoading={isRegenerating}
            >
              Start Data Generation
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete School Modal */}
      <Modal
        isOpen={showDeleteSchoolModal}
        onClose={() => !isDeletingSchool && setShowDeleteSchoolModal(false)}
        title="Decommission & Delete School"
        subtitle="Irreversible institutional deletion"
      >
        <form onSubmit={handleExecuteDeleteSchool} className="space-y-4">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800 space-y-1">
              <p className="font-bold">Warning: This will permanently delete this school and all its records!</p>
              <p>All classes, students, staff, results, fee receipts, and domain routes will be wiped.</p>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
            <p className="text-slate-600"><strong className="text-slate-800">School Name:</strong> {settings?.schoolName || 'Current School'}</p>
            <p className="text-slate-600"><strong className="text-slate-800">School ID:</strong> <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-900">{schoolId}</code></p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Type <strong className="text-rose-600 font-mono">{schoolId}</strong> or <strong className="text-rose-600 font-mono">DELETE</strong> to confirm:
            </label>
            <Input
              id="delete-school-confirm-input"
              value={deleteSchoolConfirmText}
              onChange={(e) => setDeleteSchoolConfirmText(e.target.value)}
              placeholder={schoolId || 'DELETE'}
            />
          </div>

          {deleteSchoolError && (
            <p className="text-xs text-rose-600 font-semibold">{deleteSchoolError}</p>
          )}

          {deleteSchoolSuccess && (
            <p className="text-xs text-emerald-600 font-semibold">{deleteSchoolSuccess}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowDeleteSchoolModal(false)}
              disabled={isDeletingSchool}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              isLoading={isDeletingSchool}
              disabled={!deleteSchoolConfirmText.trim()}
              leftIcon={<Trash2 className="w-4 h-4" />}
            >
              Confirm Delete School
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
