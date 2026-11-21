import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { purgeCollections } from '../../services/dataManagement';
import { AuditLog } from '../../types';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { formatDate, formatTime } from '../../utils/formatters';
import { ShieldCheck, Search, Filter, Clock, Trash2, AlertTriangle, Users, CheckCircle, RefreshCw, Wrench } from 'lucide-react';
import { auditTeacherAndParentAccounts, executeApprovedAccountRepair, TenantAccountAuditReport } from '../../services/tenantDiagnosticService';

export const AuditLogsPage: React.FC = () => {
  const { isAtLeastAdmin, isSuperAdmin, currentUser } = useAuth();
  const { schoolId } = useSchool();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeError, setPurgeError] = useState('');

  // Tenant Account Isolation Diagnostics state
  const [activeTab, setActiveTab] = useState<'logs' | 'isolation_diagnostics'>('logs');
  const [diagnosticReport, setDiagnosticReport] = useState<TenantAccountAuditReport | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<{ repairedCount: number; skippedCount: number; errors: string[] } | null>(null);

  const runDiagnostics = async () => {
    setDiagnosticLoading(true);
    setRepairResult(null);
    try {
      const report = await auditTeacherAndParentAccounts();
      setDiagnosticReport(report);
    } catch (err) {
      console.error('Error running account diagnostics:', err);
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const handleExecuteControlledRepair = async () => {
    if (!diagnosticReport) return;
    setIsRepairing(true);
    try {
      const result = await executeApprovedAccountRepair(diagnosticReport);
      setRepairResult(result);
      // Re-run diagnostic to refresh status
      const updatedReport = await auditTeacherAndParentAccounts();
      setDiagnosticReport(updatedReport);
    } catch (err) {
      console.error('Error executing controlled repair:', err);
    } finally {
      setIsRepairing(false);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'auditLogs'), limit(150))
      );
      const list: AuditLog[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (!data.schoolId || data.schoolId === schoolId || isSuperAdmin) {
          list.push({ ...data, auditId: d.id } as AuditLog);
        }
      });
      // Sort by timestamp desc
      list.sort((a, b) => {
        const tA = a.createdAt?.seconds ? a.createdAt.seconds : 0;
        const tB = b.createdAt?.seconds ? b.createdAt.seconds : 0;
        return tB - tA;
      });
      setLogs(list);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePurgeAuditLogs = async () => {
    setIsPurging(true);
    setPurgeError('');
    try {
      await purgeCollections(['auditLogs'], currentUser?.uid || 'admin', schoolId);
      setShowPurgeModal(false);
      await fetchLogs();
    } catch (err: any) {
      setPurgeError(err.message || 'Failed to purge audit logs');
    } finally {
      setIsPurging(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        log.action.toLowerCase().includes(q) ||
        (log.description || '').toLowerCase().includes(q) ||
        (log.userId || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            Security & Audit Trails
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Immutable audit records and tenant account isolation diagnostics for school management
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl border border-slate-200 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'logs'
                ? 'bg-white text-slate-800 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Audit Logs Trail
          </button>
          <button
            onClick={() => {
              setActiveTab('isolation_diagnostics');
              if (!diagnosticReport) runDiagnostics();
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'isolation_diagnostics'
                ? 'bg-white text-emerald-800 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Tenant Account Diagnostics
            {diagnosticReport && diagnosticReport.summary.issuesCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px] font-bold">
                {diagnosticReport.summary.issuesCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'isolation_diagnostics' ? (
        <div className="space-y-5">
          {/* Diagnostic Action & Status Bar */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 sm:p-5 shadow-2xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    Cross-Tenant Isolation & Account Assignment Auditor
                  </h3>
                </div>
                <p className="text-xs text-slate-500">
                  Scans all teacher, parent, and user accounts to detect missing school IDs, inconsistent default assignments, and cross-school links.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runDiagnostics}
                  isLoading={diagnosticLoading}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  {diagnosticReport ? 'Re-scan Accounts' : 'Run Diagnostics'}
                </Button>
                {diagnosticReport && diagnosticReport.summary.autoRepairableCount > 0 && isAtLeastAdmin && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleExecuteControlledRepair}
                    isLoading={isRepairing}
                    leftIcon={<Wrench className="w-3.5 h-3.5" />}
                  >
                    Execute Safe Repairs ({diagnosticReport.summary.autoRepairableCount})
                  </Button>
                )}
              </div>
            </div>

            {/* Repair Result Notification */}
            {repairResult && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-emerald-900">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Successfully corrected <strong>{repairResult.repairedCount}</strong> account(s). Zero destructive actions taken.
                  </span>
                </div>
                {repairResult.errors.length > 0 && (
                  <span className="text-xs text-rose-600 font-medium">
                    {repairResult.errors.length} warning(s) logged
                  </span>
                )}
              </div>
            )}

            {/* Summary Metrics */}
            {diagnosticReport && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-[11px] font-medium text-slate-500 uppercase">Accounts Scanned</span>
                  <div className="text-lg font-bold text-slate-800">
                    {diagnosticReport.totalTeachersScanned + diagnosticReport.totalParentsScanned + diagnosticReport.totalUsersScanned}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {diagnosticReport.totalTeachersScanned} teachers, {diagnosticReport.totalParentsScanned} parents
                  </span>
                </div>

                <div className="p-3 bg-emerald-50/50 rounded-lg">
                  <span className="text-[11px] font-medium text-emerald-700 uppercase">Properly Isolated</span>
                  <div className="text-lg font-bold text-emerald-700">
                    {diagnosticReport.summary.healthyCount}
                  </div>
                  <span className="text-[10px] text-emerald-600">Verified school membership</span>
                </div>

                <div className="p-3 bg-amber-50/50 rounded-lg">
                  <span className="text-[11px] font-medium text-amber-700 uppercase">Auto-Repairable</span>
                  <div className="text-lg font-bold text-amber-700">
                    {diagnosticReport.summary.autoRepairableCount}
                  </div>
                  <span className="text-[10px] text-amber-600">Unambiguous school records</span>
                </div>

                <div className="p-3 bg-rose-50/50 rounded-lg">
                  <span className="text-[11px] font-medium text-rose-700 uppercase">Manual Review</span>
                  <div className="text-lg font-bold text-rose-700">
                    {diagnosticReport.summary.manualReviewRequiredCount}
                  </div>
                  <span className="text-[10px] text-rose-600">Ambiguous or missing links</span>
                </div>
              </div>
            )}
          </div>

          {/* Diagnostic Findings */}
          <Card>
            <CardHeader
              title="Audit Findings & Integrity Status"
              subtitle={
                diagnosticReport
                  ? `Scan completed at ${new Date(diagnosticReport.timestamp).toLocaleTimeString()} — ${diagnosticReport.issues.length} items flagged`
                  : 'Click Run Diagnostics to begin safety evaluation'
              }
            />
            <CardBody className="p-0">
              {diagnosticLoading ? (
                <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-emerald-600" />
                  <span>Auditing tenant memberships and security boundary across collections...</span>
                </div>
              ) : !diagnosticReport ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No scan report generated yet. Click "Run Diagnostics" above to audit all accounts.
                </div>
              ) : diagnosticReport.issues.length === 0 ? (
                <div className="py-12 text-center text-xs text-emerald-700 flex flex-col items-center gap-2">
                  <CheckCircle className="w-8 h-8 text-emerald-500" />
                  <span className="font-semibold text-sm">All Teacher & Parent Accounts Are Fully Compliant!</span>
                  <span className="text-slate-500 max-w-md">
                    Every teacher and parent record is mapped to a verified school ID. No orphaned records or default school fallbacks detected.
                  </span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-xs">
                      <tr>
                        <th className="px-5 py-3">Severity</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3">Account Details</th>
                        <th className="px-5 py-3">Current School</th>
                        <th className="px-5 py-3">Inferred / Target School</th>
                        <th className="px-5 py-3">Action Required</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {diagnosticReport.issues.map((issue, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="px-5 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                issue.severity === 'HIGH'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {issue.severity}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-700">
                            {issue.type}
                          </td>
                          <td className="px-5 py-3">
                            <div className="font-medium text-slate-900">{issue.name || issue.documentId}</div>
                            {issue.email && <div className="text-[11px] text-slate-400">{issue.email}</div>}
                            <div className="text-[11px] text-slate-500 mt-0.5">{issue.details}</div>
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-600">
                            {issue.currentSchoolId || '—'}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs font-semibold text-emerald-700">
                            {issue.inferredSchoolId || 'Manual Decision'}
                          </td>
                          <td className="px-5 py-3">
                            {issue.canAutoRepair ? (
                              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                                Safe Controlled Fix
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                                Manual Review
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : (
        <>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-3 sm:p-4 shadow-2xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by action, user ID, or detail..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
            />
          </div>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 text-slate-700"
          >
            <option value="ALL">All Actions</option>
            <option value="FEE_PAYMENT_RECORDED">FEE_PAYMENT_RECORDED</option>
            <option value="RESULTS_PUBLISHED">RESULTS_PUBLISHED</option>
            <option value="ATTENDANCE_RECORDED">ATTENDANCE_RECORDED</option>
            <option value="STUDENT_CREATED">STUDENT_CREATED</option>
            <option value="STUDENT_UPDATED">STUDENT_UPDATED</option>
            <option value="STUDENT_ARCHIVED">STUDENT_ARCHIVED</option>
            <option value="SETTINGS_UPDATED">SETTINGS_UPDATED</option>
            <option value="ANNOUNCEMENT_POSTED">ANNOUNCEMENT_POSTED</option>
          </select>
        </div>
      </div>

      <Card>
        <CardHeader
          title="System Audit Log History"
          subtitle={`${filteredLogs.length} events retrieved`}
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={fetchLogs}>
                Refresh Logs
              </Button>
              {isAtLeastAdmin && (
                <Button 
                  size="sm" 
                  variant="danger" 
                  onClick={() => setShowPurgeModal(true)}
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                >
                  Purge Audit Logs
                </Button>
              )}
            </div>
          }
        />
        <CardBody className="p-0">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">Loading audit trail...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">No audit events matched your filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-xs">
                  <tr>
                    <th className="px-5 py-3">Timestamp</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">Collection</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.map((log) => {
                    const dateObj = log.createdAt?.toDate ? log.createdAt.toDate() : new Date();
                    return (
                      <tr key={log.auditId || Math.random().toString()} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                          {formatDate(dateObj)} {formatTime(dateObj)}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-600">
                          {log.entityType || log.collectionName || '—'}
                        </td>
                        <td className="px-5 py-3 text-xs font-medium text-slate-800">
                          {log.userId}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600 max-w-xs truncate">
                          {log.description || log.details || '—'}
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
      </>
      )}

      {/* Purge Audit Logs Modal */}
      <Modal
        isOpen={showPurgeModal}
        onClose={() => !isPurging && setShowPurgeModal(false)}
        title="Purge Audit Trail Records"
        subtitle="Irreversible security action. Wipe security and system logs."
      >
        <div className="space-y-4">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800 space-y-1">
              <p className="font-bold">Warning: This will permanently delete all audit log records for this institution!</p>
              <p>System configuration, student records, and user credentials will remain safe.</p>
            </div>
          </div>

          {purgeError && (
            <p className="text-xs text-rose-600 font-semibold">{purgeError}</p>
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
              onClick={handlePurgeAuditLogs}
              isLoading={isPurging}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Confirm Purge Audit Logs
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
