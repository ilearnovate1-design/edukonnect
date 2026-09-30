import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Plus, 
  ExternalLink, 
  Globe, 
  ShieldCheck, 
  Search, 
  RefreshCcw,
  Navigation2,
  Trash2,
  AlertTriangle,
  Info,
  Wrench,
  AlertCircle
} from 'lucide-react';
import { collection, getDocs, query, orderBy, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { SchoolSettings, AppUser, UserApprovalStatus } from '../../types';
import { 
  getAllSchools, 
  saveSchoolSettings, 
  mapDomainToSchool, 
  removeDomainMapping,
  deleteSchool
} from '../../services/schoolService';
import { purgeAllPlatformData } from '../../services/maintenanceService';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Modal } from '../../components/common/Modal';
import { formatDate } from '../../utils/formatters';

export const SuperAdminPage: React.FC = () => {
  const { isSuperAdmin, logout, currentUser } = useAuth();
  const { schoolId: currentSchoolId, setSchoolId, reloadSettings } = useSchool();
  
  const [schools, setSchools] = useState<SchoolSettings[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'schools' | 'users' | 'maintenance'>('schools');
  
  // Create School Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolId, setNewSchoolId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  
  // Domain Mapping Modal
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [selectedSchoolForDomain, setSelectedSchoolForDomain] = useState<SchoolSettings | null>(null);
  const [customDomain, setCustomDomain] = useState('');
  const [existingDomains, setExistingDomains] = useState<any[]>([]);

  // Delete School Modal
  const [showDeleteSchoolModal, setShowDeleteSchoolModal] = useState(false);
  const [schoolToDelete, setSchoolToDelete] = useState<SchoolSettings | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [purgeSchoolDataOnDelete, setPurgeSchoolDataOnDelete] = useState(true);
  const [isDeletingSchool, setIsDeletingSchool] = useState(false);
  const [deleteSchoolError, setDeleteSchoolError] = useState('');

  // Maintenance
  const [isPurging, setIsPurging] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  const fetchSchools = async () => {
    setLoading(true);
    try {
      const data = await getAllSchools();
      setSchools(data);
      
      const dSnap = await getDocs(collection(db, 'schoolDomains'));
      const dList: any[] = [];
      dSnap.forEach(d => dList.push(d.data()));
      setExistingDomains(dList);

      const uSnap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
      const uList: AppUser[] = [];
      uSnap.forEach(d => uList.push(d.data() as AppUser));
      setUsers(uList);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchSchools();
    }
  }, [isSuperAdmin]);

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchoolName || !newSchoolId) return;
    
    setIsSaving(true);
    setFormError('');
    try {
      const slug = newSchoolId.toLowerCase().trim().replace(/\s+/g, '-');
      await saveSchoolSettings({
        schoolName: newSchoolName.trim(),
        slug: slug,
        schoolId: slug
      }, slug);
      
      setShowAddModal(false);
      setNewSchoolName('');
      setNewSchoolId('');
      fetchSchools();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create school');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDomainMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchoolForDomain || !customDomain) return;
    
    setIsSaving(true);
    try {
      await mapDomainToSchool(customDomain, selectedSchoolForDomain.schoolId!);
      setCustomDomain('');
      setShowDomainModal(false);
      fetchSchools();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    if (!window.confirm(`Are you sure you want to remove the mapping for ${domain}?`)) return;
    try {
      await removeDomainMapping(domain);
      fetchSchools();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSwitchSchool = (sId: string) => {
    setSchoolId(sId);
  };

  const openDeleteSchoolModal = (school: SchoolSettings) => {
    setSchoolToDelete(school);
    setDeleteConfirmationText('');
    setPurgeSchoolDataOnDelete(true);
    setDeleteSchoolError('');
    setShowDeleteSchoolModal(true);
  };

  const handleExecuteDeleteSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolToDelete || !schoolToDelete.schoolId) return;

    const targetId = schoolToDelete.schoolId.toLowerCase().trim();
    const isConfirmed = deleteConfirmationText.trim().toLowerCase() === targetId ||
                        deleteConfirmationText.trim().toUpperCase() === 'DELETE';

    if (!isConfirmed) {
      setDeleteSchoolError(`Please type "${targetId}" or "DELETE" to confirm.`);
      return;
    }

    setIsDeletingSchool(true);
    setDeleteSchoolError('');

    try {
      await deleteSchool(targetId, purgeSchoolDataOnDelete, currentUser?.uid || 'admin');
      
      // If we deleted the active school context, switch back to bistoland
      if (currentSchoolId === targetId) {
        setSchoolId('bistoland');
      }

      setShowDeleteSchoolModal(false);
      setSchoolToDelete(null);
      setDeleteConfirmationText('');
      await fetchSchools();
    } catch (err: any) {
      console.error('Error deleting school:', err);
      setDeleteSchoolError(err.message || 'Failed to delete school');
    } finally {
      setIsDeletingSchool(false);
    }
  };

  const handlePurgeData = async () => {
    if (purgeConfirmText !== 'PURGE') {
      alert('Please type PURGE to confirm.');
      return;
    }

    if (!window.confirm('CRITICAL: This will delete ALL students, teachers, results, and other data across the platform. This cannot be undone. Proceed?')) {
      return;
    }

    setIsPurging(true);
    try {
      const res = await purgeAllPlatformData(currentUser?.uid || '');
      if (res.success) {
        alert(res.message);
        setPurgeConfirmText('');
        fetchSchools();
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert(err.message || 'Purge failed');
    } finally {
      setIsPurging(false);
    }
  };

  const handleUpdateUserStatus = async (uid: string, status: UserApprovalStatus) => {
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        approvalStatus: status,
        updatedAt: serverTimestamp()
      });
      fetchSchools();
    } catch (err) {
      console.error('Failed to update user status:', err);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <ShieldCheck className="w-16 h-16 text-slate-200 mb-4" />
        <h2 className="text-xl font-bold text-slate-900">Access Denied</h2>
        <p className="text-slate-500 mt-2 max-w-md">
          This interface is reserved for System Super Administrators only.
        </p>
      </div>
    );
  }

  const filteredSchools = schools.filter(s => 
    s.schoolName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.schoolId?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Management</h1>
          <p className="text-slate-500 text-sm">Multi-tenant school directory and domain routing</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('schools')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'schools' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
          >
            Schools
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'users' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}`}
          >
            Users & Approvals
          </button>
          <button
            onClick={() => setActiveTab('maintenance')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'maintenance' ? 'bg-red-600 text-white' : 'bg-white text-red-600 hover:bg-red-50 border border-red-200'}`}
          >
            Maintenance
          </button>
        </div>
      </div>

      {activeTab === 'schools' ? (
        <>
          {/* Stats / Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardBody className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Total Schools</p>
                  <p className="text-2xl font-bold text-slate-900">{schools.length}</p>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Domain Mappings</p>
                  <p className="text-2xl font-bold text-slate-900">{existingDomains.length}</p>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
                  <Navigation2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Current View</p>
                  <p className="text-lg font-bold text-slate-900 truncate max-w-[150px]">
                    {currentSchoolId}
                  </p>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search schools by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            <div className="flex gap-2">
              <button 
                onClick={fetchSchools}
                className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 transition-colors"
                title="Refresh List"
              >
                <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Register New School</span>
              </button>
            </div>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">School Details</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Domains</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Config</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={4} className="px-6 py-8">
                          <div className="h-4 bg-slate-100 rounded w-3/4 mb-2"></div>
                          <div className="h-3 bg-slate-50 rounded w-1/2"></div>
                        </td>
                      </tr>
                    ))
                  ) : filteredSchools.length > 0 ? (
                    filteredSchools.map((school) => {
                      const schoolDomains = existingDomains.filter(d => d.schoolId === school.schoolId);
                      const isActive = currentSchoolId === school.schoolId;

                      return (
                        <tr key={school.schoolId} className={isActive ? 'bg-emerald-50/30' : ''}>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 overflow-hidden">
                                {school.logoUrl ? (
                                  <img src={school.logoUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Building2 className="w-5 h-5" />
                                )}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 leading-tight">
                                  {school.schoolName}
                                  {isActive && (
                                    <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full align-middle">
                                      ACTIVE VIEW
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-400 mt-1 font-mono">ID: {school.schoolId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex flex-wrap gap-2">
                              <div className="group relative flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs border border-slate-200">
                                <span>{school.schoolId}.edu.ng</span>
                                <Info className="w-3 h-3 text-slate-400" />
                              </div>
                              
                              {schoolDomains.map(d => (
                                <div key={d.domain} className="group relative flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs border border-blue-100">
                                  <Globe className="w-3 h-3" />
                                  <span>{d.domain}</span>
                                  <button 
                                    onClick={() => handleDeleteDomain(d.domain)}
                                    className="ml-1 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                              
                              <button 
                                onClick={() => {
                                  setSelectedSchoolForDomain(school);
                                  setShowDomainModal(true);
                                }}
                                className="flex items-center gap-1 px-2 py-1 border border-dashed border-slate-300 text-slate-400 rounded text-xs hover:border-slate-400 hover:text-slate-500 transition-colors"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Add</span>
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="text-xs space-y-1">
                              <p className="text-slate-600"><span className="text-slate-400">Session:</span> {school.currentAcademicSession}</p>
                              <p className="text-slate-600"><span className="text-slate-400">Term:</span> {school.currentTerm}</p>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleSwitchSchool(school.schoolId!)}
                                disabled={isActive}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                  isActive 
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                                title="Switch current active view to this school"
                              >
                                <Navigation2 className="w-3.5 h-3.5" />
                                <span>{isActive ? 'Current' : 'Switch'}</span>
                              </button>

                              <button
                                onClick={() => openDeleteSchoolModal(school)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 transition-colors border border-rose-200/60"
                                title={`Delete ${school.schoolName || school.schoolId}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                        No schools registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : activeTab === 'users' ? (
        <Card>
          <CardHeader 
            title="Administrator Accounts" 
            subtitle="Manage portal access and institutional verification requests" 
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">User Details</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">School ID</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Approval Status</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.filter(u => u.role === 'ADMIN').map((user) => (
                  <tr key={user.uid}>
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-900 leading-none mb-1">{user.displayName}</p>
                      <p className="text-xs text-slate-400">{user.email}</p>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-slate-600">
                      {user.schoolId || 'PENDING'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        user.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        user.approvalStatus === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                        user.approvalStatus === 'PENDING_APPROVAL' ? 'bg-amber-100 text-amber-700 animate-pulse' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {user.approvalStatus?.replace('_', ' ') || 'PENDING SETUP'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {user.approvalStatus !== 'APPROVED' && (
                          <button 
                            onClick={() => handleUpdateUserStatus(user.uid, 'APPROVED')}
                            className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-700 transition-colors uppercase"
                          >
                            Approve
                          </button>
                        )}
                        {user.approvalStatus !== 'REJECTED' && (
                          <button 
                            onClick={() => handleUpdateUserStatus(user.uid, 'REJECTED')}
                            className="px-3 py-1.5 border border-rose-200 text-rose-600 text-[10px] font-bold rounded-lg hover:bg-rose-50 transition-colors uppercase"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="border-red-100">
            <CardHeader className="bg-red-50 p-5 border-b border-red-100">
              <div className="flex items-center gap-3 text-red-700">
                <Wrench className="w-5 h-5" />
                <h3 className="font-bold">System Maintenance & Cleanup</h3>
              </div>
            </CardHeader>
            <CardBody className="p-6 space-y-6">
              <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl flex gap-3">
                <AlertTriangle className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-bold text-orange-900">Destructive Actions</p>
                  <p className="text-orange-700 mt-1 leading-relaxed">
                    Clearing platform data will permanently delete all students, teachers, results, and other institutional records across all schools. 
                    <strong> This action cannot be reversed.</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    To proceed, type <span className="font-mono font-bold text-red-600 select-all">PURGE</span> in the box below:
                  </label>
                  <input
                    type="text"
                    value={purgeConfirmText}
                    onChange={(e) => setPurgeConfirmText(e.target.value)}
                    placeholder="Type PURGE to confirm"
                    className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500/20 focus:border-red-500 font-mono"
                  />
                </div>

                <button
                  onClick={handlePurgeData}
                  disabled={isPurging || purgeConfirmText !== 'PURGE'}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {isPurging ? (
                    <>
                      <RefreshCcw className="w-5 h-5 animate-spin" />
                      <span>Purging All Data...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5" />
                      <span>Clear All Platform Test Data</span>
                    </>
                  )}
                </button>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-start gap-3 text-slate-500 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <ul className="space-y-1 list-disc pl-4">
                    <li>All <strong>students</strong>, <strong>parents</strong>, and <strong>teachers</strong> will be deleted.</li>
                    <li>All <strong>results</strong>, <strong>attendance</strong>, and <strong>fees</strong> will be deleted.</li>
                    <li>All <strong>user accounts</strong> (except your own) will be removed.</li>
                    <li>The <strong>'bistoland'</strong> tenant will be preserved but its data cleared.</li>
                    <li>Platform pricing settings will remain intact.</li>
                  </ul>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Create School Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Register New Tenant"
      >
        <form onSubmit={handleAddSchool} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">School Full Name</label>
            <input
              type="text"
              required
              value={newSchoolName}
              onChange={(e) => setNewSchoolName(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
              placeholder="e.g. St. Jude's International School"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Unique School ID (Slug)</label>
            <input
              type="text"
              required
              value={newSchoolId}
              onChange={(e) => setNewSchoolId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 font-mono text-sm"
              placeholder="e.g. st-judes"
            />
            <p className="mt-1 text-[11px] text-slate-400 italic">Used for subdomains: schoolid.edukonnect.ng</p>
          </div>
          
          {formError && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {formError}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {isSaving ? 'Creating...' : 'Register School'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Domain Mapping Modal */}
      <Modal
        isOpen={showDomainModal}
        onClose={() => setShowDomainModal(false)}
        title={`Map Custom Domain for ${selectedSchoolForDomain?.schoolName}`}
      >
        <form onSubmit={handleAddDomainMapping} className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex gap-3">
            <Globe className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-blue-900">Custom Domain Routing</p>
              <p className="text-xs text-blue-700 mt-1">
                Enter the full hostname (e.g. portal.myschool.com). Users accessing this domain will automatically see this school's branding and data.
              </p>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hostname</label>
            <input
              type="text"
              required
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value.toLowerCase().trim())}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
              placeholder="portal.myschool.com"
            />
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setShowDomainModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Mapping...' : 'Save Mapping'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete School Modal */}
      <Modal
        isOpen={showDeleteSchoolModal}
        onClose={() => !isDeletingSchool && setShowDeleteSchoolModal(false)}
        title={`Delete School Institution`}
      >
        <form onSubmit={handleExecuteDeleteSchool} className="space-y-4">
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-rose-900">
                Permanently Decommission {schoolToDelete?.schoolName || schoolToDelete?.schoolId}
              </p>
              <p className="text-xs text-rose-700 mt-1">
                This action is irreversible. It will remove the school profile, configuration, and mapped custom domains.
              </p>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-xs">
            <p className="text-slate-600"><strong className="text-slate-800">School Name:</strong> {schoolToDelete?.schoolName}</p>
            <p className="text-slate-600"><strong className="text-slate-800">School ID / Slug:</strong> <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-900">{schoolToDelete?.schoolId}</code></p>
          </div>

          <label className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={purgeSchoolDataOnDelete}
              onChange={(e) => setPurgeSchoolDataOnDelete(e.target.checked)}
              className="mt-0.5 rounded text-rose-600 focus:ring-rose-500"
            />
            <div>
              <span className="font-semibold text-slate-800 block">Wipe all tenant records for this school</span>
              <span className="text-slate-500">Permanently delete students, classes, results, payments, and submissions linked to this school.</span>
            </div>
          </label>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Type <strong className="text-rose-600 font-mono">{schoolToDelete?.schoolId}</strong> or <strong className="text-rose-600 font-mono">DELETE</strong> to confirm:
            </label>
            <input
              type="text"
              required
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-mono"
              placeholder={schoolToDelete?.schoolId || 'DELETE'}
            />
          </div>

          {deleteSchoolError && (
            <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{deleteSchoolError}</span>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              disabled={isDeletingSchool}
              onClick={() => setShowDeleteSchoolModal(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeletingSchool || !deleteConfirmationText.trim()}
              className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-1.5"
            >
              {isDeletingSchool ? (
                <>
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>Delete School</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
