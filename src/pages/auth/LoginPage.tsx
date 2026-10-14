import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { GraduationCap, ShieldCheck, AlertCircle, Info, Lock } from 'lucide-react';
import { parseFirebaseError } from '../../utils/formatters';

export const LoginPage: React.FC<{ onSetupRequested?: () => void }> = ({ onSetupRequested }) => {
  const { login, signup, resetPassword } = useAuth();
  const { settings, reloadSettings } = useSchool();

  const [activeTab, setActiveTab] = useState<'LOGIN' | 'REGISTER_ADMIN'>('LOGIN');

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginPortal, setLoginPortal] = useState<'ADMIN' | 'PARENT'>('ADMIN');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Forgot password modal
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // Registration state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [confirmRegPass, setConfirmRegPass] = useState('');

  const resetForm = () => {
    setErrorMessage('');
    setRegName('');
    setRegEmail('');
    setRegPass('');
    setConfirmRegPass('');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }
    setErrorMessage('');
    setIsLoading(true);
    try {
      await login(email, password, loginPortal);
    } catch (err: any) {
      setErrorMessage(parseFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName || !regEmail || !regPass) {
      setErrorMessage('Please fill in all registration fields.');
      return;
    }
    if (regPass.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (regPass !== confirmRegPass) {
      setErrorMessage('Passwords do not match. Please verify.');
      return;
    }

    setErrorMessage('');
    setIsLoading(true);
    
    let role: 'ADMIN' | 'TEACHER' | 'PARENT' = 'ADMIN';
    if (activeTab === 'REGISTER_ADMIN') role = 'ADMIN';

    try {
      await signup(regEmail, regPass, regName, role);
      if (role === 'ADMIN') {
        await reloadSettings();
        if (onSetupRequested) {
          onSetupRequested();
        }
      }
    } catch (err: any) {
      setErrorMessage(parseFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    try {
      await resetPassword(forgotEmail);
      setSuccessMessage('Password reset email sent! Check your inbox.');
      setShowForgotModal(false);
    } catch (err: any) {
      setErrorMessage(parseFirebaseError(err));
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-10 sm:px-6 lg:px-8 px-4">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shadow-md mb-4">
          <GraduationCap className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          {settings.schoolName || 'School Management Portal'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Official Access for Administration, Teachers & Guardians
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-7 px-6 shadow-md rounded-2xl border border-slate-200/80">
          {/* Tab Selection */}
          <div className="flex border-b border-slate-200 mb-6">
            <button
              type="button"
              id="tab-sign-in"
              onClick={() => {
                setActiveTab('LOGIN');
                resetForm();
              }}
              className={`flex-1 py-3 text-sm font-semibold text-center border-b-2 transition-colors cursor-pointer ${
                activeTab === 'LOGIN'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              id="tab-register"
              onClick={() => {
                setActiveTab('REGISTER_ADMIN');
                resetForm();
              }}
              className={`flex-1 py-3 text-sm font-semibold text-center border-b-2 transition-colors cursor-pointer ${
                activeTab !== 'LOGIN'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Register
            </button>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
              {successMessage}
            </div>
          )}

          {activeTab === 'LOGIN' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* Portal Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Access Portal
                </label>
                <div className="p-1 bg-slate-100 rounded-xl flex gap-1 border border-slate-200">
                  <button
                    type="button"
                    id="portal-select-admin-btn"
                    onClick={() => setLoginPortal('ADMIN')}
                    className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      loginPortal === 'ADMIN'
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Admin Access
                  </button>
                  <button
                    type="button"
                    id="portal-select-parent-btn"
                    onClick={() => setLoginPortal('PARENT')}
                    className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      loginPortal === 'PARENT'
                        ? 'bg-white text-emerald-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    Parents Access
                  </button>
                </div>
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
                  <label htmlFor="login-password" className="text-sm font-medium text-slate-700">
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
                className="w-full mt-2"
                isLoading={isLoading}
                size="lg"
              >
                {loginPortal === 'ADMIN' ? 'Sign In as Administrator' : 'Sign In as Parent / Guardian'}
              </Button>

              <div className="mt-5 p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-start gap-2.5 text-xs text-slate-600">
                <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-slate-800 block mb-0.5">
                    Teachers & Parents Account Notice
                  </span>
                  Your account is provisioned by the school administrator. Please use the email registered in your school records or contact the school administrative office for access.
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              
              <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-900 mb-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold block">Primary Administrative Account</span>
                  Use this form to register the school principal, proprietor, or head IT administrator.
                </div>
              </div>

              <Input
                id="setup-reg-name"
                label="Full Name"
                placeholder={activeTab === 'REGISTER_ADMIN' ? 'e.g. Dr. A. Adebayo (Principal)' : 'e.g. John Doe'}
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                required
              />

              <Input
                id="setup-reg-email"
                type="email"
                label="Email Address"
                placeholder="email@example.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                required
              />

              <Input
                id="setup-reg-pass"
                type="password"
                label="Password (min 6 characters)"
                placeholder="••••••••"
                value={regPass}
                onChange={(e) => setRegPass(e.target.value)}
                required
              />

              <Input
                id="setup-reg-confirm-pass"
                type="password"
                label="Confirm Password"
                placeholder="••••••••"
                value={confirmRegPass}
                onChange={(e) => setConfirmRegPass(e.target.value)}
                required
              />

              <Button
                id="register-submit-btn"
                type="submit"
                className="w-full mt-2"
                isLoading={isLoading}
                size="lg"
                leftIcon={<Lock className="w-4 h-4" />}
              >
                Create Account
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Forgot Password Modal */}
      <Modal
        isOpen={showForgotModal}
        onClose={() => setShowForgotModal(false)}
        title="Reset Password"
        subtitle="We will send a reset link to your registered email"
      >
        <form onSubmit={handleForgotPassword} className="space-y-4">
          <Input
            id="forgot-email-input"
            type="email"
            label="Registered Email"
            placeholder="you@school.edu.ng"
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setShowForgotModal(false)}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={forgotLoading}>
              Send Reset Link
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
