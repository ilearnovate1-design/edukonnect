import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { ShieldAlert, LogOut, Clock, Mail, KeyRound, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { acceptAndActivateInvitation } from '../../services/invitationService';

export const AwaitingApprovalPage: React.FC = () => {
  const { logout, appUser, currentUser, refreshUserProfile } = useAuth();
  const { reloadSettings } = useSchool();
  const [inviteCode, setInviteCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim() || !currentUser) return;
    setActivating(true);
    setError('');
    setSuccess('');
    try {
      await acceptAndActivateInvitation({
        code: inviteCode.trim().toUpperCase(),
        userUid: currentUser.uid,
        userEmail: currentUser.email || appUser?.email || '',
        displayName: currentUser.displayName || appUser?.displayName,
      });
      setSuccess('Invitation activated! Loading your school dashboard...');
      await reloadSettings();
      await refreshUserProfile();
    } catch (err: any) {
      setError(err?.message || 'Failed to activate invitation code.');
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock className="w-10 h-10 text-amber-600 animate-pulse" />
        </div>
        
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Registration Pending
        </h1>
        
        <p className="text-slate-600 mb-6 leading-relaxed">
          Thank you for registering <strong>{appUser?.displayName || appUser?.email}</strong>. Your school portal request has been received and is currently awaiting administrator review and approval.
        </p>

        <div className="bg-slate-50 rounded-xl p-4 mb-6 text-left space-y-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Verification in Progress</p>
              <p className="text-xs text-slate-500">We verify all educational institutions to ensure platform security and data integrity.</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Notification</p>
              <p className="text-xs text-slate-500">You will receive an email confirmation once your account has been activated.</p>
            </div>
          </div>
        </div>

        {/* Direct invitation activation fallback for invited teachers & parents */}
        <form onSubmit={handleActivate} className="mb-6 p-4 rounded-xl border border-slate-200 bg-slate-50/70 text-left space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <KeyRound className="w-4 h-4 text-emerald-700" />
            <span>Have a School Invitation Code?</span>
          </div>
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}
          {success && (
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
              {success}
            </div>
          )}
          <Input
            id="awaiting-invite-code"
            placeholder="e.g. INV-ABCD-EFGH"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          />
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            isLoading={activating}
            disabled={!inviteCode.trim()}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            Activate Invitation Code
          </Button>
        </form>

        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Need urgent access? Contact support@edukonnect.ng
          </p>
          
          <Button
            variant="outline"
            className="w-full"
            onClick={logout}
            leftIcon={<LogOut className="w-4 h-4" />}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
};
