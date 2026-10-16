import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { 
  GraduationCap, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Lock, 
  School, 
  UserCheck, 
  KeyRound, 
  ArrowRight, 
  Sparkles,
  Info
} from 'lucide-react';
import { parseFirebaseError } from '../../utils/formatters';
import { registerNewSchoolAndOwner } from '../../services/schoolService';
import { getInvitationByCode, acceptAndActivateInvitation } from '../../services/invitationService';
import { AccountInvitation } from '../../types';

export const LoginPage: React.FC<{ onSetupRequested?: () => void }> = ({ onSetupRequested }) => {
  const { login, signup, resetPassword, currentUser, refreshUserProfile } = useAuth();
  const { settings, reloadSettings } = useSchool();

  // Mode: 'SIGN_IN' | 'REGISTER_SCHOOL' | 'ACTIVATE_INVITE'
  const [mode, setMode] = useState<'SIGN_IN' | 'REGISTER_SCHOOL' | 'ACTIVATE_INVITE'>('SIGN_IN');

  // Sign In Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Forgot Password Modal
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // School Registration Wizard State
  const [regStep, setRegStep] = useState<1 | 2>(1);
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [confirmOwnerPassword, setConfirmOwnerPassword] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [schoolAddress, setSchoolAddress] = useState('');
  const [schoolPhone, setSchoolPhone] = useState('');
  const [schoolEmail, setSchoolEmail] = useState('');
  const [academicSession, setAcademicSession] = useState('2026/2027');
  const [currentTerm, setCurrentTerm] = useState('First Term');

  // Invitation Activation State
  const [inviteCode, setInviteCode] = useState('');
  const [verifiedInvite, setVerifiedInvite] = useState<AccountInvitation | null>(null);
  const [inviteVerifying, setInviteVerifying] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
  const [confirmInvitePassword, setConfirmInvitePassword] = useState('');

  // Check URL parameters for ?invite=CODE
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const codeParam = urlParams.get('invite');
      if (codeParam) {
        setInviteCode(codeParam.toUpperCase().trim());
        setMode('ACTIVATE_INVITE');
        verifyInviteCode(codeParam.toUpperCase().trim());
      }
    } catch (e) {}
  }, []);

  const resetMessages = () => {
    setErrorMessage('');
    setSuccessMessage('');
  };

  /* -------------------------------------------------------------
   * 1. UNIFIED SIGN IN (NO PORTAL PRE-SELECTION)
   * ------------------------------------------------------------- */
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }
    resetMessages();
    setIsLoading(true);
    try {
      await login(email, password);
      // AuthContext will determine role and school membership automatically!
    } catch (err: any) {
      setErrorMessage(parseFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  /* -------------------------------------------------------------
   * 2. FORGOT PASSWORD
   * ------------------------------------------------------------- */
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    try {
      await resetPassword(forgotEmail);
      setSuccessMessage('Password reset instructions sent. Please check your inbox.');
      setShowForgotModal(false);
    } catch (err: any) {
      setErrorMessage(parseFirebaseError(err));
    } finally {
      setForgotLoading(false);
    }
  };

  /* -------------------------------------------------------------
   * 3. PUBLIC SCHOOL REGISTRATION
   * ------------------------------------------------------------- */
  const handleSchoolRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (regStep === 1) {
      if (!ownerName.trim() || !ownerEmail.trim() || !ownerPassword) {
        setErrorMessage('Please fill in all administrator account fields.');
        return;
      }
      if (ownerPassword.length < 6) {
        setErrorMessage('Password must be at least 6 characters.');
        return;
      }
      if (ownerPassword !== confirmOwnerPassword) {
        setErrorMessage('Passwords do not match. Please verify.');
        return;
      }
      setRegStep(2);
      return;
    }

    if (!schoolName.trim()) {
      setErrorMessage('Official school name is required.');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Create owner Firebase Auth account
      const cleanEmail = ownerEmail.toLowerCase().trim();
      await signup(cleanEmail, ownerPassword, ownerName.trim(), 'ADMIN');

      // 2. Fetch current authenticated user to register school
      const authUser = (await import('../../services/firebase')).auth.currentUser;
      if (!authUser) {
        throw new Error('Authentication state unavailable. Please sign in to finalize school setup.');
      }

      // 3. Securely register school and bind owner as verified ADMIN
      const { schoolId } = await registerNewSchoolAndOwner({
        schoolName: schoolName.trim(),
        address: schoolAddress.trim(),
        phone: schoolPhone.trim(),
        email: schoolEmail.trim() || cleanEmail,
        currentAcademicSession: academicSession,
        currentTerm,
        ownerUid: authUser.uid,
        ownerEmail: cleanEmail,
        ownerName: ownerName.trim(),
      });

      await reloadSettings();
      await refreshUserProfile();
      setSuccessMessage(`School registered successfully! Welcome to ${schoolName}.`);
    } catch (err: any) {
      console.error('School registration error:', err);
      setErrorMessage(parseFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  /* -------------------------------------------------------------
   * 4. INVITATION ACTIVATION (TEACHERS & PARENTS)
   * ------------------------------------------------------------- */
  const verifyInviteCode = async (codeToVerify?: string) => {
    const code = (codeToVerify || inviteCode).toUpperCase().trim();
    if (!code) {
      setErrorMessage('Please enter your invitation code.');
      return;
    }
    resetMessages();
    setInviteVerifying(true);
    try {
      const result = await getInvitationByCode(code);
      if (!result.valid || !result.invitation) {
        setErrorMessage(result.errorMessage || 'Invalid invitation code.');
        setVerifiedInvite(null);
      } else {
        setVerifiedInvite(result.invitation);
        setSuccessMessage(`Verified invitation for ${result.invitation.schoolName}!`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error verifying invitation.');
    } finally {
      setInviteVerifying(false);
    }
  };

  const handleActivateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedInvite) {
      await verifyInviteCode();
      return;
    }

    if (invitePassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    if (invitePassword !== confirmInvitePassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    resetMessages();
    setIsLoading(true);
    try {
      // 1. Create or authenticate user account
      const cleanEmail = verifiedInvite.email.toLowerCase().trim();
      let userUid = currentUser?.uid;

      if (!currentUser) {
        try {
          await signup(cleanEmail, invitePassword, verifiedInvite.role === 'TEACHER' 
            ? `${verifiedInvite.teacherData?.firstName} ${verifiedInvite.teacherData?.lastName}`
            : `${verifiedInvite.parentData?.firstName} ${verifiedInvite.parentData?.lastName}`,
            verifiedInvite.role
          );
          const freshUser = (await import('../../services/firebase')).auth.currentUser;
          userUid = freshUser?.uid;
        } catch (authErr: any) {
          // If account already exists, try logging in
          if (authErr?.code === 'auth/email-already-in-use') {
            await login(cleanEmail, invitePassword);
            const freshUser = (await import('../../services/firebase')).auth.currentUser;
            userUid = freshUser?.uid;
          } else {
            throw authErr;
          }
        }
      }

      if (!userUid) {
        throw new Error('Could not establish user authentication session.');
      }

      // 2. Accept and link invitation atomically
      await acceptAndActivateInvitation({
        code: verifiedInvite.id,
        userUid,
        userEmail: cleanEmail,
        displayName: verifiedInvite.role === 'TEACHER'
          ? `${verifiedInvite.teacherData?.firstName} ${verifiedInvite.teacherData?.lastName}`
          : `${verifiedInvite.parentData?.firstName} ${verifiedInvite.parentData?.lastName}`,
      });

      await reloadSettings();
      await refreshUserProfile();
      setSuccessMessage('Invitation activated successfully! Loading your dashboard...');
    } catch (err: any) {
      console.error('Invite activation error:', err);
      setErrorMessage(parseFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 sm:px-6 lg:px-8 px-4">
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shadow-md mb-4">
          <GraduationCap className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          {settings.schoolName || 'EduKonnect Portal'}
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-600">
          Unified Multi-Tenant Education & School Management Platform
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-7 px-6 shadow-sm rounded-2xl border border-slate-200">
          {/* Main Action Switcher: Sign In vs Register School */}
          <div className="flex p-1 bg-slate-100 rounded-xl mb-6 border border-slate-200">
            <button
              type="button"
              id="action-sign-in-tab"
              onClick={() => {
                setMode('SIGN_IN');
                resetMessages();
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'SIGN_IN'
                  ? 'bg-white text-emerald-800 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              Sign In
            </button>
            <button
              type="button"
              id="action-register-school-tab"
              onClick={() => {
                setMode('REGISTER_SCHOOL');
                resetMessages();
                setRegStep(1);
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'REGISTER_SCHOOL'
                  ? 'bg-white text-emerald-800 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <School className="w-3.5 h-3.5" />
              Register Your School
            </button>
          </div>

          {/* Feedback Messages */}
          {errorMessage && (
            <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-5 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* MODE 1: UNIFIED SIGN IN */}
          {mode === 'SIGN_IN' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 flex items-start gap-2.5 text-xs text-emerald-900 mb-2">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-emerald-700" />
                <span>
                  Single sign-in for <strong>Administrators, Teachers & Parents</strong>. Your role and authorized school will be verified automatically upon login.
                </span>
              </div>

              <Input
                id="login-email"
                type="email"
                label="Email Address"
                placeholder="name@school.edu.ng"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="login-password" className="text-xs font-medium text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(true)}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              <Button
                id="login-submit-btn"
                type="submit"
                variant="primary"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                Sign In to Dashboard
              </Button>

              {/* Explanatory invitation note */}
              <div className="mt-5 pt-4 border-t border-slate-100 text-center space-y-2">
                <p className="text-xs text-slate-500">
                  New teacher or parent? Teachers and parents must use the account invitation provided by their school.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode('ACTIVATE_INVITE');
                    resetMessages();
                  }}
                  className="text-xs font-bold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Have an invitation code? Activate Account
                </button>
              </div>
            </form>
          )}

          {/* MODE 2: REGISTER YOUR SCHOOL */}
          {mode === 'REGISTER_SCHOOL' && (
            <form onSubmit={handleSchoolRegistration} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Step {regStep} of 2: {regStep === 1 ? 'Owner Identity' : 'School Profile'}
                </span>
                <span className="text-[11px] text-emerald-700 font-semibold">
                  {regStep === 1 ? 'Account Credentials' : 'Multi-Tenant Setup'}
                </span>
              </div>

              {regStep === 1 ? (
                <>
                  <Input
                    id="owner-name"
                    type="text"
                    label="School Owner / Administrator Full Name"
                    placeholder="e.g. Dr. Emmanuel Okonjo"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    required
                  />

                  <Input
                    id="owner-email"
                    type="email"
                    label="Official Administrator Email"
                    placeholder="admin@yourschool.edu.ng"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    required
                    helperText="This email will receive official administrative privileges."
                  />

                  <Input
                    id="owner-password"
                    type="password"
                    label="Create Secure Password"
                    placeholder="Minimum 6 characters"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    required
                  />

                  <Input
                    id="confirm-owner-password"
                    type="password"
                    label="Confirm Password"
                    placeholder="Repeat password"
                    value={confirmOwnerPassword}
                    onChange={(e) => setConfirmOwnerPassword(e.target.value)}
                    required
                  />

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full mt-2"
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                  >
                    Continue to School Details
                  </Button>
                </>
              ) : (
                <>
                  <Input
                    id="reg-school-name"
                    type="text"
                    label="Official School Name"
                    placeholder="e.g. Gracefield Model College"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    required
                  />

                  <Input
                    id="reg-school-address"
                    type="text"
                    label="Campus Address"
                    placeholder="e.g. 14 Unity Road, Ikeja, Lagos"
                    value={schoolAddress}
                    onChange={(e) => setSchoolAddress(e.target.value)}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      id="reg-school-phone"
                      type="tel"
                      label="Official Phone"
                      placeholder="+234 800 000 0000"
                      value={schoolPhone}
                      onChange={(e) => setSchoolPhone(e.target.value)}
                    />
                    <Input
                      id="reg-school-email"
                      type="email"
                      label="School Contact Email"
                      placeholder="info@school.edu.ng"
                      value={schoolEmail}
                      onChange={(e) => setSchoolEmail(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      id="reg-academic-session"
                      type="text"
                      label="Academic Session"
                      placeholder="2026/2027"
                      value={academicSession}
                      onChange={(e) => setAcademicSession(e.target.value)}
                    />
                    <Input
                      id="reg-current-term"
                      type="text"
                      label="Current Term"
                      placeholder="First Term"
                      value={currentTerm}
                      onChange={(e) => setCurrentTerm(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setRegStep(1)}
                      disabled={isLoading}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      className="flex-1"
                      isLoading={isLoading}
                      leftIcon={<Sparkles className="w-4 h-4" />}
                    >
                      Complete Registration
                    </Button>
                  </div>
                </>
              )}

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setMode('SIGN_IN')}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Already have an account? Sign In
                </button>
              </div>
            </form>
          )}

          {/* MODE 3: ACTIVATE INVITATION */}
          {mode === 'ACTIVATE_INVITE' && (
            <form onSubmit={handleActivateInvite} className="space-y-4">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 mb-2">
                <strong>Account Invitation Activation</strong>: Enter the unique invitation code provided by your school administrator to securely link your profile.
              </div>

              {!verifiedInvite ? (
                <>
                  <Input
                    id="invite-code-input"
                    type="text"
                    label="Invitation Code"
                    placeholder="e.g. INV-ABCD-EFGH"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    required
                  />

                  <Button
                    type="button"
                    variant="primary"
                    className="w-full mt-2"
                    onClick={() => verifyInviteCode()}
                    isLoading={inviteVerifying}
                    leftIcon={<KeyRound className="w-4 h-4" />}
                  >
                    Verify Code
                  </Button>
                </>
              ) : (
                <>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                    <div className="flex justify-between font-semibold text-slate-800">
                      <span>Institution:</span>
                      <span className="text-emerald-700">{verifiedInvite.schoolName}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Authorized Role:</span>
                      <span className="font-bold">{verifiedInvite.role}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Assigned To:</span>
                      <span>{verifiedInvite.email}</span>
                    </div>
                    {verifiedInvite.parentData?.linkedStudentIds && (
                      <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                        Linked Children: {verifiedInvite.parentData.linkedStudentIds.length} student(s) pre-authorized.
                      </div>
                    )}
                  </div>

                  <Input
                    id="invite-create-pass"
                    type="password"
                    label="Create Account Password"
                    placeholder="Minimum 6 characters"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    required
                  />

                  <Input
                    id="invite-confirm-pass"
                    type="password"
                    label="Confirm Password"
                    placeholder="Repeat password"
                    value={confirmInvitePassword}
                    onChange={(e) => setConfirmInvitePassword(e.target.value)}
                    required
                  />

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setVerifiedInvite(null)}
                      disabled={isLoading}
                    >
                      Different Code
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      className="flex-1"
                      isLoading={isLoading}
                      leftIcon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      Activate & Access Portal
                    </Button>
                  </div>
                </>
              )}

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setMode('SIGN_IN')}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Return to Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Forgot Password Modal */}
      <Modal
        isOpen={showForgotModal}
        onClose={() => setShowForgotModal(false)}
        title="Reset Account Password"
        subtitle="Enter your email address to receive secure reset instructions"
      >
        <form onSubmit={handleForgotPassword} className="space-y-4">
          <Input
            id="forgot-email"
            type="email"
            label="Email Address"
            placeholder="name@school.edu.ng"
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            required
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowForgotModal(false)}
              disabled={forgotLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={forgotLoading}
            >
              Send Reset Link
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
