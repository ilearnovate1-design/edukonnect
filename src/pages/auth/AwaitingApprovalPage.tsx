import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ShieldAlert, LogOut, Clock, Mail } from 'lucide-react';
import { Button } from '../../components/common/Button';

export const AwaitingApprovalPage: React.FC = () => {
  const { logout, appUser } = useAuth();

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
          Thank you for registering <strong>{appUser?.displayName}</strong>. Your school portal request has been received and is currently awaiting administrator review and approval.
        </p>

        <div className="bg-slate-50 rounded-xl p-4 mb-8 text-left space-y-3">
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
