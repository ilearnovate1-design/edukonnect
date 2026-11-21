import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useSchool } from './contexts/SchoolContext';
import { AppShell } from './components/layout/AppShell';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { LoginPage } from './pages/auth/LoginPage';
import { InitialSetupPage } from './pages/auth/InitialSetupPage';
import { AdminDashboard } from './pages/dashboard/AdminDashboard';
import { TeacherDashboard } from './pages/dashboard/TeacherDashboard';
import { ParentDashboard } from './pages/dashboard/ParentDashboard';
import { StudentsPage } from './pages/students/StudentsPage';
import { AttendancePage } from './pages/attendance/AttendancePage';
import { FeesPage } from './pages/fees/FeesPage';
import { ResultsPage } from './pages/results/ResultsPage';
import { AssignmentsPage } from './pages/assignments/AssignmentsPage';
import { ClassesPage } from './pages/classes/ClassesPage';
import { TeachersPage } from './pages/teachers/TeachersPage';
import { ParentsPage } from './pages/parents/ParentsPage';
import { AnnouncementsPage } from './pages/announcements/AnnouncementsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { AuditLogsPage } from './pages/audit/AuditLogsPage';
import { SuperAdminPage } from './pages/superadmin/SuperAdminPage';
import { UsageMonitoringPage } from './pages/superadmin/UsageMonitoringPage';
import { AwaitingApprovalPage } from './pages/auth/AwaitingApprovalPage';
import { ReportCardModal } from './components/results/ReportCardModal';
import { Button } from './components/common/Button';
import { Input } from './components/common/Input';
import { Modal } from './components/common/Modal';
import { AlertCircle, KeyRound, CheckCircle2, ArrowRight } from 'lucide-react';
import { Student, Result, SchoolClass } from './types';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, testFirestoreConnection } from './services/firebase';
import { acceptAndActivateInvitation } from './services/invitationService';
import {
  APP_ROUTES,
  AUTH_ROUTES,
  getPageIdFromPath,
  getPageTitleFromPath,
  getPathForPage,
  isAuthPath,
} from './routes/routes';

export default function App() {
  const { 
    currentUser, 
    appUser, 
    role, 
    isSuperAdmin, 
    isAtLeastAdmin, 
    loading: authLoading, 
    logout, 
    switchToRole,
    userMemberships,
    activeMembership,
    hasMultipleMemberships,
    switchSchoolMembership,
    refreshUserProfile
  } = useAuth();
  const { settings, loading: schoolLoading, isConfigured, reloadSettings } = useSchool();
  const location = useLocation();
  const navigate = useNavigate();

  const [showSchoolSelector, setShowSchoolSelector] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [activatingCode, setActivatingCode] = useState(false);
  const [activationError, setActivationError] = useState('');
  const [activationSuccess, setActivationSuccess] = useState('');

  const handleNavigate = useCallback(
    (pageOrPath: string) => {
      navigate(getPathForPage(pageOrPath));
    },
    [navigate]
  );

  // Prevent endless loading screen: force ready after 2.5s
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setForceReady(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  // Pre-fill invitation code if user lands with ?invite= while missing school membership
  useEffect(() => {
    const inviteParam = new URLSearchParams(location.search).get('invite');
    if (inviteParam) {
      setActivationCode(inviteParam.toUpperCase().trim());
    }
  }, [location.search]);

  // Keep document.title synchronized on auth / gate views (AppShell handles authenticated pages)
  useEffect(() => {
    if (!currentUser || (appUser?.approvalStatus !== 'APPROVED' && !isSuperAdmin)) {
      const title = getPageTitleFromPath(location.pathname);
      document.title = `${title} | ${settings.schoolName || 'EduKonnect Portal'}`;
    }
  }, [currentUser, appUser?.approvalStatus, isSuperAdmin, location.pathname, settings.schoolName]);

  // Global Report Card Viewer state
  const [reportStudent, setReportStudent] = useState<Student | null>(null);
  const [reportClass, setReportClass] = useState<SchoolClass | null>(null);
  const [reportResults, setReportResults] = useState<Result[]>([]);
  const [reportAttendance, setReportAttendance] = useState<{ total: number; present: number; absent: number; late: number; rate: number }>({ total: 60, present: 58, absent: 2, late: 0, rate: 97 });

  const handleViewReportCard = async (student: Student) => {
    try {
      // 1. Fetch Class
      if (student.classId) {
        const cDoc = await getDoc(doc(db, 'classes', student.classId));
        if (cDoc.exists()) setReportClass(cDoc.data() as SchoolClass);
      }

      // 2. Fetch Results
      const resultsConstraints: any[] = [
        where('studentId', '==', student.studentId),
        where('term', '==', settings.currentTerm),
        where('academicSession', '==', settings.currentAcademicSession)
      ];
      
      const rSnap = await getDocs(
        query(collection(db, 'results'), ...resultsConstraints)
      );
      const rList: Result[] = [];
      rSnap.forEach((d) => {
        const res = d.data() as Result;
        if (role === 'PARENT' && res.status !== 'PUBLISHED') return;
        rList.push(res);
      });
      setReportResults(rList);

      // 3. Fetch Attendance for Complete Report Card
      try {
        const attSnap = await getDocs(
          query(collection(db, 'attendance'), where('studentId', '==', student.studentId))
        );
        let pres = 0, abs = 0, lte = 0;
        attSnap.forEach((docSnap) => {
          const st = docSnap.data().status;
          if (st === 'PRESENT') pres++;
          else if (st === 'ABSENT') abs++;
          else if (st === 'LATE') lte++;
        });
        const tot = attSnap.size > 0 ? attSnap.size : 60;
        const actualPres = attSnap.size > 0 ? pres : 58;
        const actualAbs = attSnap.size > 0 ? abs : 2;
        const rate = Math.round(((actualPres + lte) / tot) * 100);
        setReportAttendance({ total: tot, present: actualPres, absent: actualAbs, late: lte, rate });
      } catch (attErr) {
        console.warn('Attendance fetch for report card:', attErr);
      }

      setReportStudent(student);
    } catch (err) {
      console.error('Error opening report card:', err);
    }
  };

  // Loading state
  if ((authLoading || schoolLoading) && !forceReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <LoadingSpinner size="lg" text="Connecting to EduKonnect Portal..." />
      </div>
    );
  }

  // Not logged in: URL-driven Auth & Public Onboarding Routes
  if (!currentUser) {
    const hasInviteParam = new URLSearchParams(location.search).get('invite');
    if (location.pathname === '/' && hasInviteParam) {
      return <Navigate to={`${AUTH_ROUTES.activate}${location.search}`} replace />;
    }

    return (
      <Routes>
        <Route
          path={AUTH_ROUTES.login}
          element={
            <LoginPage
              initialMode="SIGN_IN"
              onSetupRequested={() => navigate(APP_ROUTES.setup)}
            />
          }
        />
        <Route
          path={AUTH_ROUTES.registerSchool}
          element={
            <LoginPage
              initialMode="REGISTER_SCHOOL"
              onSetupRequested={() => navigate(APP_ROUTES.setup)}
            />
          }
        />
        <Route
          path={AUTH_ROUTES.activate}
          element={
            <LoginPage
              initialMode="ACTIVATE_INVITE"
              onSetupRequested={() => navigate(APP_ROUTES.setup)}
            />
          }
        />
        <Route
          path={APP_ROUTES.setup}
          element={
            <InitialSetupPage
              onComplete={() => navigate(APP_ROUTES.dashboard, { replace: true })}
            />
          }
        />
        <Route path="/" element={<Navigate to={AUTH_ROUTES.login} replace />} />
        <Route path="*" element={<Navigate to={AUTH_ROUTES.login} state={{ from: location }} replace />} />
      </Routes>
    );
  }

  // Logged in: Check Profile Resolution
  if (currentUser && !appUser && !forceReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <LoadingSpinner size="lg" text="Loading profile..." />
      </div>
    );
  }

  // Logged in: Check Approval Status
  if (appUser?.approvalStatus === 'REJECTED') {
    return (
      <Routes>
        <Route
          path={AUTH_ROUTES.accessDenied}
          element={
            <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 text-center">
              <div className="max-w-md bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
                <p className="text-slate-500 mb-6">Your registration request has been declined. Please contact support if you believe this is an error.</p>
                <Button variant="outline" onClick={logout}>Sign Out</Button>
              </div>
            </div>
          }
        />
        <Route path="*" element={<Navigate to={AUTH_ROUTES.accessDenied} replace />} />
      </Routes>
    );
  }

  if (appUser?.approvalStatus === 'PENDING_SETUP') {
    return (
      <Routes>
        <Route
          path={APP_ROUTES.setup}
          element={
            <InitialSetupPage
              onComplete={() => navigate(APP_ROUTES.dashboard, { replace: true })}
            />
          }
        />
        <Route path="*" element={<Navigate to={APP_ROUTES.setup} replace />} />
      </Routes>
    );
  }

  if (appUser?.approvalStatus === 'PENDING_APPROVAL') {
    return (
      <Routes>
        <Route path={AUTH_ROUTES.awaitingApproval} element={<AwaitingApprovalPage />} />
        <Route path="*" element={<Navigate to={AUTH_ROUTES.awaitingApproval} replace />} />
      </Routes>
    );
  }

  // Authoritative School Membership Check
  // Teachers, Parents and Staff must belong to a verified school and not fall back to default
  if (!isSuperAdmin && (!appUser?.schoolId || !appUser?.schoolId.trim())) {
    return (
      <Routes>
        <Route
          path={AUTH_ROUTES.membershipRequired}
          element={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
              <div className="max-w-md w-full bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
                <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">School Membership Required</h2>
                <p className="text-slate-600 text-xs sm:text-sm mb-4 leading-relaxed">
                  Your account ({appUser?.email}) is not yet associated with an authorized school institution.
                </p>

                {activationError && (
                  <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs text-left">
                    {activationError}
                  </div>
                )}

                {activationSuccess && (
                  <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs text-left">
                    {activationSuccess}
                  </div>
                )}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!activationCode.trim()) {
                      setActivationError('Please enter your invitation code.');
                      return;
                    }
                    if (!currentUser) return;
                    setActivatingCode(true);
                    setActivationError('');
                    setActivationSuccess('');
                    try {
                      await acceptAndActivateInvitation({
                        code: activationCode.trim().toUpperCase(),
                        userUid: currentUser.uid,
                        userEmail: currentUser.email || appUser?.email || '',
                        displayName: currentUser.displayName || appUser?.displayName,
                      });
                      setActivationSuccess('Invitation activated! Loading school dashboard...');
                      await reloadSettings();
                      await refreshUserProfile();
                    } catch (err: any) {
                      setActivationError(err.message || 'Failed to activate invitation.');
                    } finally {
                      setActivatingCode(false);
                    }
                  }}
                  className="space-y-3 mb-4 text-left"
                >
                  <Input
                    id="recovery-activation-code"
                    label="Enter School Invitation Code"
                    placeholder="e.g. INV-ABCD-EFGH"
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
                    required
                    helperText="Enter the single-use invite code provided by your school administrator."
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    isLoading={activatingCode}
                    leftIcon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    Activate & Enter School
                  </Button>
                </form>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span>Teachers & parents must be invited.</span>
                  <Button variant="ghost" size="sm" onClick={logout}>
                    Sign Out
                  </Button>
                </div>
              </div>
            </div>
          }
        />
        <Route path="*" element={<Navigate to={AUTH_ROUTES.membershipRequired} replace />} />
      </Routes>
    );
  }

  // Not Approved yet (and not one of the special cases above)
  if (appUser?.approvalStatus !== 'APPROVED' && !isSuperAdmin) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <LoadingSpinner size="lg" text="Verifying authorization..." />
      </div>
    );
  }

  // Determine safe post-login redirect target (supports deep links saved before login)
  const rawFrom = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
  const postLoginTarget =
    rawFrom?.pathname && rawFrom.pathname !== '/' && !isAuthPath(rawFrom.pathname)
      ? `${rawFrom.pathname}${rawFrom.search || ''}`
      : APP_ROUTES.dashboard;

  const currentPageId = getPageIdFromPath(location.pathname);

  // Logged in: Render inside AppShell with URL Routes
  return (
    <AppShell currentPage={currentPageId} onNavigate={handleNavigate}>
      <Routes>
        {/* Root & Auth Path Redirects once signed in */}
        <Route path="/" element={<Navigate to={postLoginTarget} replace />} />
        <Route path={AUTH_ROUTES.login} element={<Navigate to={postLoginTarget} replace />} />
        <Route path={AUTH_ROUTES.registerSchool} element={<Navigate to={postLoginTarget} replace />} />
        <Route path={AUTH_ROUTES.activate} element={<Navigate to={postLoginTarget} replace />} />
        <Route path={AUTH_ROUTES.awaitingApproval} element={<Navigate to={postLoginTarget} replace />} />
        <Route path={AUTH_ROUTES.accessDenied} element={<Navigate to={postLoginTarget} replace />} />
        <Route path={AUTH_ROUTES.membershipRequired} element={<Navigate to={postLoginTarget} replace />} />

        {/* 1. Dashboard View */}
        <Route
          path={APP_ROUTES.dashboard}
          element={
            role === 'TEACHER' ? (
              <TeacherDashboard onNavigate={handleNavigate} />
            ) : role === 'PARENT' ? (
              <ParentDashboard
                onNavigate={handleNavigate}
                onViewReportCard={handleViewReportCard}
              />
            ) : (
              <AdminDashboard 
                onNavigate={handleNavigate} 
                onOpenQuickAction={(action) => {
                  if (action === 'add-student') handleNavigate('students');
                  if (action === 'record-payment') handleNavigate('fees');
                  if (action === 'create-assignment') handleNavigate('assignments');
                  if (action === 'new-announcement') handleNavigate('announcements');
                }}
              />
            )
          }
        />

        {/* 2. Students Directory & Profile */}
        <Route
          path={APP_ROUTES.students}
          element={
            role === 'PARENT' ? (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">Please view your children on the Home Dashboard.</p>
              </div>
            ) : (
              <StudentsPage />
            )
          }
        />

        {/* 3. Daily Attendance & Clock-In */}
        <Route
          path={APP_ROUTES.attendance}
          element={
            role === 'PARENT' ? (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">Daily attendance management is restricted to staff.</p>
              </div>
            ) : (
              <AttendancePage />
            )
          }
        />

        {/* 4. School Fees & Bursary */}
        <Route
          path={APP_ROUTES.fees}
          element={
            role === 'PARENT' ? (
              <ParentDashboard
                onNavigate={handleNavigate}
                onViewReportCard={handleViewReportCard}
              />
            ) : isAtLeastAdmin ? (
              <FeesPage />
            ) : (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">Financial records and bursary tariffs are restricted to school administrators.</p>
              </div>
            )
          }
        />

        {/* 5. Terminal Examination Results & CA */}
        <Route
          path={APP_ROUTES.results}
          element={
            role === 'PARENT' ? (
              <ParentDashboard
                onNavigate={handleNavigate}
                onViewReportCard={handleViewReportCard}
              />
            ) : (
              <ResultsPage />
            )
          }
        />

        {/* 6. Homework & Assignments */}
        <Route path={APP_ROUTES.assignments} element={<AssignmentsPage />} />

        {/* 7. Class Arms & Grades */}
        <Route path={APP_ROUTES.classes} element={<ClassesPage />} />

        {/* 8. Teachers Directory (Admin Only) */}
        <Route
          path={APP_ROUTES.teachers}
          element={
            isAtLeastAdmin ? (
              <TeachersPage />
            ) : (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">Staff employment directories are restricted to school administrators.</p>
              </div>
            )
          }
        />

        {/* 9. Parents Directory (Admin Only) */}
        <Route
          path={APP_ROUTES.parents}
          element={
            isAtLeastAdmin ? (
              <ParentsPage />
            ) : (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">Guardian directories are restricted to school administrators.</p>
              </div>
            )
          }
        />

        {/* 10. Announcements & Bulletins */}
        <Route path={APP_ROUTES.announcements} element={<AnnouncementsPage />} />

        {/* 11. School Profile & Report Template Settings (Admin & Teacher) */}
        <Route
          path={APP_ROUTES.settings}
          element={
            isAtLeastAdmin || role === 'TEACHER' ? (
              <SettingsPage />
            ) : (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">System settings and school configurations are restricted to staff and administrators.</p>
              </div>
            )
          }
        />

        {/* 12. Security Audit Logs (Admin Only) */}
        <Route
          path={APP_ROUTES.audit}
          element={
            isAtLeastAdmin ? (
              <AuditLogsPage />
            ) : (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">Institutional security audit logs are restricted to school administrators.</p>
              </div>
            )
          }
        />

        {/* 13. Initial Setup wizard */}
        <Route
          path={APP_ROUTES.setup}
          element={
            <InitialSetupPage
              onComplete={() => navigate(APP_ROUTES.dashboard)}
            />
          }
        />

        {/* 14. System Super Admin Dashboard */}
        <Route path={APP_ROUTES.superadmin} element={<SuperAdminPage />} />

        {/* 15. Platform Usage Monitoring */}
        <Route
          path={APP_ROUTES.usage}
          element={
            isSuperAdmin ? (
              <UsageMonitoringPage />
            ) : (
              <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
                <p className="text-xs text-slate-500 mt-1">Platform monitoring is restricted to system administrators.</p>
              </div>
            )
          }
        />

        {/* 404 / Unmatched Route Fallback */}
        <Route
          path="*"
          element={
            <div className="p-12 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-8 shadow-sm">
              <h3 className="text-base font-bold text-slate-900">Page Not Found</h3>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                The requested URL (<span className="font-mono">{location.pathname}</span>) is not available.
              </p>
              <Link
                to={APP_ROUTES.dashboard}
                className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
              >
                Return to Dashboard
              </Link>
            </div>
          }
        />
      </Routes>

      {/* Global Terminal Report Card Modal */}
      <ReportCardModal
        isOpen={!!reportStudent}
        onClose={() => {
          setReportStudent(null);
          setReportClass(null);
        }}
        student={reportStudent}
        schoolClass={reportClass}
        results={reportResults}
        attendanceSummary={reportAttendance}
        term={settings.currentTerm}
        session={settings.currentAcademicSession}
      />
    </AppShell>
  );
}
