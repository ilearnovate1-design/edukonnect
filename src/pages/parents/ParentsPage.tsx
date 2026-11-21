import React, { useState, useEffect } from 'react';
import { 
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where 
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { Parent, Student, AccountInvitation } from '../../types';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Card } from '../../components/common/Card';
import { Modal } from '../../components/common/Modal';
import { 
  Plus, Search, Edit2, Phone, Mail, MapPin, Users, HeartHandshake,
  Send, KeyRound, Copy, Check, Clock, UserCheck
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { logAudit } from '../../utils/formatters';
import { provisionAccount } from '../../services/provisioningService';
import { createParentInvitation, getSchoolInvitations, revokeInvitation } from '../../services/invitationService';
import { sanitizeFirestoreData } from '../../services/gradingProfileService';
import { useQueryTab } from '../../routes/useQueryTab';

export const ParentsPage: React.FC = () => {
  const { role, currentUser, appUser, isSuperAdmin } = useAuth();
  const { schoolId, settings } = useSchool();
  const [parents, setParents] = useState<Parent[]>([]);
  const [invitations, setInvitations] = useState<AccountInvitation[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useQueryTab<'parents' | 'invitations'>(
    'tab',
    'parents',
    ['parents', 'invitations']
  );

  // Add/Edit Parent Modal
  const [showModal, setShowModal] = useState(false);
  const [editingParent, setEditingParent] = useState<Parent | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('Mother');
  const [occupation, setOccupation] = useState('');
  const [address, setAddress] = useState('');
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [tempPassword, setTempPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Invite Parent Modal State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRelationship, setInviteRelationship] = useState('Father');
  const [inviteChildIds, setInviteChildIds] = useState<string[]>([]);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [createdInvite, setCreatedInvite] = useState<AccountInvitation | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const matchesTenant = (itemSchoolId?: string) => {
    const active = schoolId?.trim().toLowerCase();
    const item = itemSchoolId?.trim().toLowerCase();
    return item ? item === active : (active === 'default' || !active);
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let pass = '';
    for (let i = 0; i < 8; i++) {
      pass += chars.charAt(Math.floor(chars.length * Math.random()));
    }
    return pass;
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const pSnap = await getDocs(collection(db, 'parents'));
      const pList: Parent[] = [];
      pSnap.forEach((d) => {
        const item = d.data() as Parent;
        if (matchesTenant(item.schoolId)) pList.push(item);
      });
      setParents(pList);

      const sSnap = await getDocs(collection(db, 'students'));
      const sList: Student[] = [];
      sSnap.forEach((d) => {
        const item = d.data() as Student;
        if (matchesTenant(item.schoolId)) sList.push(item);
      });
      setStudents(sList);
      if (schoolId) {
        try {
          const invList = await getSchoolInvitations(schoolId);
          setInvitations(invList.filter((i) => i.role === 'PARENT'));
        } catch (invErr) {
          console.warn('Parent invitations notice:', invErr);
        }
      }
    } catch (err) {
      console.error('Error fetching parents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [schoolId]);

  const openInviteModal = () => {
    setInviteFirstName('');
    setInviteLastName('');
    setInviteEmail('');
    setInvitePhone('');
    setInviteRelationship('Father');
    setInviteChildIds([]);
    setCreatedInvite(null);
    setInviteError('');
    setCopiedCode(false);
    setShowInviteModal(true);
  };

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteFirstName.trim() || !inviteLastName.trim() || !inviteEmail.trim()) {
      setInviteError('Please fill in parent name and email.');
      return;
    }
    if (inviteChildIds.length === 0) {
      setInviteError('Please select at least one enrolled child to link with this parent.');
      return;
    }

    if (!appUser) return;
    setInviteSaving(true);
    setInviteError('');
    try {
      const inv = await createParentInvitation({
        schoolId: schoolId || appUser.schoolId || '',
        schoolName: settings.schoolName || 'EduKonnect School',
        adminUser: appUser,
        email: inviteEmail.trim(),
        parentData: {
          firstName: inviteFirstName.trim(),
          lastName: inviteLastName.trim(),
          phone: invitePhone.trim(),
          relationship: inviteRelationship,
          linkedStudentIds: inviteChildIds,
        },
      });

      setCreatedInvite(inv);
      await fetchData();
    } catch (err: any) {
      console.error('Parent invite error:', err);
      setInviteError(err.message || 'Failed to generate parent invitation.');
    } finally {
      setInviteSaving(false);
    }
  };

  const handleRevokeInvitation = async (invId: string) => {
    if (!window.confirm('Are you sure you want to revoke this invitation? The guardian will not be able to activate it.')) {
      return;
    }
    try {
      await revokeInvitation(invId, schoolId || appUser?.schoolId || '');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke invitation.');
    }
  };

  const openAddModal = () => {
    setEditingParent(null);
    setFirstName('');
    setLastName('');
    setPhone('');
    setEmail('');
    setRelationship('Mother');
    setOccupation('');
    setAddress('');
    setSelectedChildIds([]);
    setTempPassword(generatePassword());
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (parent: Parent) => {
    setEditingParent(parent);
    setFirstName(parent.firstName);
    setLastName(parent.lastName);
    setPhone(parent.phone);
    setEmail(parent.email);
    setRelationship(parent.relationship || 'Mother');
    setOccupation(parent.occupation || '');
    setAddress(parent.address || '');
    setTempPassword(parent.tempPassword || '');

    // find all students that currently have this parentId
    const linked = students
      .filter((s) => s.parentIds?.includes(parent.parentId))
      .map((s) => s.studentId);
    setSelectedChildIds(linked);
    setFormError('');
    setShowModal(true);
  };

  const handleSaveParent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !email.trim()) {
      setFormError('First name, last name, phone and email are required.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      // Authoritative Admin School Derivation
      const adminSchool = isSuperAdmin ? (schoolId || appUser?.schoolId || '') : (appUser?.schoolId || schoolId || '');
      let targetSchoolId = '';

      if (editingParent) {
        targetSchoolId = editingParent.schoolId || adminSchool;
        if (!isSuperAdmin && editingParent.schoolId && editingParent.schoolId !== adminSchool) {
          throw new Error('Unauthorized: You can only modify parents belonging to your assigned school.');
        }
      } else {
        targetSchoolId = adminSchool;
      }

      if (!targetSchoolId || !targetSchoolId.trim()) {
        throw new Error('Cannot save parent: Your administrator account has no verified school membership. Please configure your school first.');
      }

      const normalizedSchoolId = targetSchoolId.trim().toLowerCase();
      const normalizedEmail = email.trim().toLowerCase();
      const pId = editingParent?.parentId || `parent-${Date.now()}`;
      const parentDocRef = doc(db, 'parents', pId);

      const payload: any = {
        parentId: pId,
        schoolId: normalizedSchoolId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: normalizedEmail,
        relationship,
        occupation: occupation.trim() || undefined,
        address: address.trim() || undefined,
        tempPassword: tempPassword.trim() || undefined,
        updatedAt: serverTimestamp(),
      };

      // Provision account if new
      let resolvedUserId = editingParent?.userId;
      if (!editingParent && tempPassword) {
        try {
          const { uid } = await provisionAccount(
            normalizedEmail,
            tempPassword,
            `${firstName.trim()} ${lastName.trim()}`,
            'PARENT',
            normalizedSchoolId,
            { parentId: pId }
          );
          resolvedUserId = uid;
          payload.userId = uid;
        } catch (provErr: any) {
          console.warn('Auto-provisioning notice (account may already exist):', provErr);
        }
      }

      // If user ID was not assigned yet, check memberships or school users with this email
      if (!resolvedUserId) {
        try {
          const mSnap = await getDocs(
            query(
              collection(db, 'memberships'),
              where('schoolId', '==', normalizedSchoolId),
              where('userEmail', '==', normalizedEmail)
            )
          );
          if (!mSnap.empty) {
            resolvedUserId = (mSnap.docs[0].data() as any).userId;
            if (resolvedUserId) payload.userId = resolvedUserId;
          }
        } catch (mLookupErr) {
          console.warn('Membership lookup notice:', mLookupErr);
        }
      }

      if (!resolvedUserId) {
        try {
          const uSnap = await getDocs(
            query(
              collection(db, 'users'),
              where('schoolId', '==', normalizedSchoolId),
              where('email', '==', normalizedEmail)
            )
          );
          if (!uSnap.empty) {
            resolvedUserId = uSnap.docs[0].id;
            payload.userId = resolvedUserId;
          }
        } catch (lookupErr) {
          console.warn('User lookup notice:', lookupErr);
        }
      }

      // Keep membership & user doc securely in sync with verified schoolId, role, and parentId
      if (resolvedUserId) {
        try {
          await setDoc(
            doc(db, 'memberships', `${normalizedSchoolId}_${resolvedUserId}`),
            sanitizeFirestoreData({
              id: `${normalizedSchoolId}_${resolvedUserId}`,
              userId: resolvedUserId,
              userEmail: normalizedEmail,
              schoolId: normalizedSchoolId,
              schoolName: settings.schoolName || 'EduKonnect School',
              role: 'PARENT',
              status: 'ACTIVE',
              parentId: pId,
              linkedStudentIds: selectedChildIds,
              activatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
            { merge: true }
          );
        } catch (memSyncErr) {
          console.warn('Parent membership sync notice:', memSyncErr);
        }

        try {
          await setDoc(doc(db, 'users', resolvedUserId), {
            schoolId: normalizedSchoolId,
            role: 'PARENT',
            parentId: pId,
            displayName: `${firstName.trim()} ${lastName.trim()}`,
            approvalStatus: 'APPROVED',
            active: true,
            updatedAt: serverTimestamp()
          }, { merge: true });
        } catch (syncErr) {
          console.warn('User sync notice:', syncErr);
        }
      }

      if (!editingParent) {
        payload.createdAt = serverTimestamp();
      }

      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
          delete payload[key];
        }
      });

      await setDoc(parentDocRef, payload, { merge: true });

      // Link / unlink selected children - strictly within current school
      for (const student of students) {
        // Enforce school isolation for student-parent relationship
        if (student.schoolId && student.schoolId !== normalizedSchoolId) {
          continue;
        }

        const isSelected = selectedChildIds.includes(student.studentId);
        const currentParents = student.parentIds || [];
        const hasParent = currentParents.includes(pId);

        if (isSelected && !hasParent) {
          // link
          await updateDoc(doc(db, 'students', student.studentId), {
            parentIds: [...currentParents, pId],
            updatedAt: serverTimestamp(),
          });
        } else if (!isSelected && hasParent) {
          // unlink
          await updateDoc(doc(db, 'students', student.studentId), {
            parentIds: currentParents.filter((id) => id !== pId),
            updatedAt: serverTimestamp(),
          });
        }
      }

      await logAudit(
        currentUser?.uid || 'admin',
        editingParent ? 'PARENT_UPDATED' : 'PARENT_CREATED',
        'parents',
        pId,
        `${editingParent ? 'Updated' : 'Added'} parent ${firstName} ${lastName} for school ${normalizedSchoolId}`,
        normalizedSchoolId
      );

      setShowModal(false);
      await fetchData();
    } catch (err: any) {
      console.error('Error saving parent:', err);
      setFormError(err.message || 'Failed to save parent record.');
    } finally {
      setSaving(false);
    }
  };

  const filteredParents = parents.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
    return fullName.includes(q) || p.phone.includes(q) || p.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Parent / Guardian Directory</h2>
          <p className="text-xs sm:text-sm text-slate-500">
            {parents.length} registered parent(s) • Authorized child-linking and secure invitation onboarding
          </p>
        </div>

        {role === 'ADMIN' && (
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={openInviteModal}
              leftIcon={<Send className="w-4 h-4" />}
            >
              Invite Parent
            </Button>
            <Button
              variant="outline"
              onClick={openAddModal}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Add Direct
            </Button>
          </div>
        )}
      </div>

      {/* Tab Switcher: Parents vs Invitations */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('parents')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'parents'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Enrolled Parents ({parents.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('invitations')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'invitations'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          Parent Invitations ({invitations.length})
        </button>
      </div>

      {activeTab === 'parents' ? (
        <>
          {/* Search */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by parent name, phone, or email..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Parents List */}
          <Card>
            {loading ? (
              <div className="py-12 text-center text-xs text-slate-500">Loading parents...</div>
            ) : filteredParents.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">No parents found. Click "Invite Parent" to onboard guardians.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredParents.map((parent) => {
                  const linkedStudents = students.filter((s) => s.parentIds?.includes(parent.parentId));

                  return (
                    <div key={parent.parentId} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm sm:text-base">
                            {parent.firstName} {parent.lastName}
                          </span>
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                            {parent.relationship || 'Guardian'}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            {parent.phone}
                          </span>
                          <span className="flex items-center gap-1">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            {parent.email}
                          </span>
                          {!parent.userId && parent.tempPassword && (
                            <span className="flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              Default Pass: <span className="font-mono">{parent.tempPassword}</span>
                            </span>
                          )}
                          {parent.occupation && (
                            <span className="text-slate-400">• {parent.occupation}</span>
                          )}
                        </div>

                        {/* Linked Children */}
                        <div className="pt-1.5 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-slate-400 font-medium">Children:</span>
                          {linkedStudents.length === 0 ? (
                            <span className="text-[11px] text-slate-400 italic">No pupils linked</span>
                          ) : (
                            linkedStudents.map((child) => (
                              <span
                                key={child.studentId}
                                className="inline-flex items-center text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded"
                              >
                                {child.firstName} {child.lastName} ({child.admissionNumber})
                              </span>
                            ))
                          )}
                        </div>
                      </div>

                      {role === 'ADMIN' && (
                        <div className="shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(parent)}
                            leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                          >
                            Edit & Link Children
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      ) : (
        /* Invitations Tab View */
        <Card>
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Expiring Single-Use Parent Invitations</h3>
              <p className="text-xs text-slate-500">
                Single-use activation invitations with verified child-linking
              </p>
            </div>
            {role === 'ADMIN' && (
              <Button size="sm" variant="primary" onClick={openInviteModal} leftIcon={<Send className="w-3.5 h-3.5" />}>
                Invite Guardian
              </Button>
            )}
          </div>
          {invitations.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">No parent invitations created yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-xs">
                  <tr>
                    <th className="px-5 py-3">Invite Code</th>
                    <th className="px-5 py-3">Guardian</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Pre-Authorized Children</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50">
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                          {inv.id}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-slate-900">
                          {inv.parentData?.firstName} {inv.parentData?.lastName}
                        </div>
                        <div className="text-[11px] text-slate-500">{inv.email}</div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            inv.status === 'ACCEPTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : inv.status === 'REVOKED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {inv.parentData?.linkedStudentIds?.length || 0} pupil(s) linked
                      </td>
                      <td className="px-5 py-3 flex items-center gap-2">
                        {inv.status === 'PENDING' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(inv.id);
                                alert(`Invitation code ${inv.id} copied to clipboard!`);
                              }}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                              Copy Code
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevokeInvitation(inv.id)}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded cursor-pointer"
                            >
                              Revoke
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Add / Edit Parent Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingParent ? 'Edit Parent & Link Pupils' : 'Add New Parent'}
        subtitle="Record guardian details and connect to children enrolled in school"
        maxWidth="lg"
      >
        <form onSubmit={handleSaveParent} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="parent-first-name"
              label="First Name *"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              placeholder="e.g. Babajide"
            />
            <Input
              id="parent-last-name"
              label="Last Name *"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              placeholder="e.g. Bello"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="parent-phone"
              label="Phone Number *"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="080XXXXXXXX"
            />
            <Input
              id="parent-email"
              type="email"
              label="Email Address *"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="parent@gmail.com"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              id="parent-relationship"
              label="Relationship"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              options={[
                { value: 'Father', label: 'Father' },
                { value: 'Mother', label: 'Mother' },
                { value: 'Guardian', label: 'Legal Guardian' },
                { value: 'Aunt / Uncle', label: 'Aunt / Uncle' },
              ]}
            />
            <Input
              id="parent-occupation"
              label="Occupation"
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
              placeholder="e.g. Civil Engineer"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="parent-address"
              label="Residential Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 7 Johnson Close, Ikeja"
            />
            <div className="relative">
              <Input
                id="parent-temp-pass"
                label="Default Password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Auto-generated"
                helperText="Give this to the parent for their first login."
              />
              <button
                type="button"
                onClick={() => setTempPassword(generatePassword())}
                className="absolute right-2 top-[26px] text-emerald-600 hover:text-emerald-700 text-[10px] font-bold uppercase"
              >
                Regen
              </button>
            </div>
          </div>

          {/* Link Children Checklist */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
              Link Enrolled Pupils (Support Multiple Children)
            </label>
            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1.5 bg-slate-50">
              {students.length === 0 ? (
                <p className="text-xs text-slate-400 p-2">No students registered yet.</p>
              ) : (
                students.map((st) => {
                  const isChecked = selectedChildIds.includes(st.studentId);
                  return (
                    <label
                      key={st.studentId}
                      className="flex items-center gap-2 p-2 rounded bg-white border border-slate-200/80 text-xs cursor-pointer hover:bg-emerald-50/50"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedChildIds([...selectedChildIds, st.studentId]);
                          } else {
                            setSelectedChildIds(selectedChildIds.filter((id) => id !== st.studentId));
                          }
                        }}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="font-semibold text-slate-900">
                        {st.firstName} {st.lastName}
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        ({st.admissionNumber})
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <Button variant="outline" type="button" onClick={() => setShowModal(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saving}>
              {editingParent ? 'Save Changes' : 'Add Parent'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Invite Parent Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setCreatedInvite(null);
        }}
        title="Invite Parent / Legal Guardian"
        subtitle="Generate an invitation with pre-authorized pupil linking strictly bound to your school"
        maxWidth="lg"
      >
        {createdInvite ? (
          <div className="space-y-4 text-center py-2">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Parent Invitation Generated</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Share this activation code or link with <strong>{createdInvite.parentData?.firstName} {createdInvite.parentData?.lastName}</strong> ({createdInvite.email})
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Single-Use Activation Code
              </span>
              <div className="font-mono text-xl font-black text-emerald-800 tracking-wider">
                {createdInvite.id}
              </div>
              <p className="text-[11px] text-slate-400">
                Linked to {createdInvite.parentData?.linkedStudentIds.length} pupil(s). Expires in 7 days.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(createdInvite.id);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                leftIcon={copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              >
                {copiedCode ? 'Copied Code!' : 'Copy Code'}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const inviteUrl = `${window.location.origin}/activate?invite=${createdInvite.id}`;
                  navigator.clipboard.writeText(inviteUrl);
                  alert('Full invitation activation link copied to clipboard!');
                }}
                leftIcon={<Copy className="w-4 h-4" />}
              >
                Copy Invite Link
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSendInvitation} className="space-y-4">
            {inviteError && (
              <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg">
                {inviteError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                id="invite-p-first-name"
                label="First Name *"
                value={inviteFirstName}
                onChange={(e) => setInviteFirstName(e.target.value)}
                required
                placeholder="e.g. Babajide"
              />
              <Input
                id="invite-p-last-name"
                label="Last Name *"
                value={inviteLastName}
                onChange={(e) => setInviteLastName(e.target.value)}
                required
                placeholder="e.g. Bello"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                id="invite-p-email"
                type="email"
                label="Parent Email Address *"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                placeholder="parent@gmail.com"
                helperText="Invitation and pupil access will be locked to this email."
              />
              <Input
                id="invite-p-phone"
                label="Phone Number"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                placeholder="080XXXXXXXX"
              />
            </div>

            <Select
              id="invite-p-relationship"
              label="Relationship"
              value={inviteRelationship}
              onChange={(e) => setInviteRelationship(e.target.value)}
              options={[
                { value: 'Father', label: 'Father' },
                { value: 'Mother', label: 'Mother' },
                { value: 'Guardian', label: 'Legal Guardian' },
                { value: 'Aunt / Uncle', label: 'Aunt / Uncle' },
              ]}
            />

            {/* Select Children to Link */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Select Enrolled Children (Required) *
              </label>
              <p className="text-[11px] text-slate-500 mb-2">
                Only students enrolled in this school can be linked. Parents cannot access arbitrary student IDs.
              </p>
              <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1.5 bg-slate-50">
                {students.length === 0 ? (
                  <p className="text-xs text-slate-400 p-2">No students enrolled yet.</p>
                ) : (
                  students.map((st) => {
                    const isChecked = inviteChildIds.includes(st.studentId);
                    return (
                      <label
                        key={st.studentId}
                        className="flex items-center gap-2 p-2 rounded bg-white border border-slate-200/80 text-xs cursor-pointer hover:bg-emerald-50/50"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setInviteChildIds([...inviteChildIds, st.studentId]);
                            } else {
                              setInviteChildIds(inviteChildIds.filter((id) => id !== st.studentId));
                            }
                          }}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="font-semibold text-slate-900">
                          {st.firstName} {st.lastName}
                        </span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          ({st.admissionNumber})
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <Button
                variant="outline"
                type="button"
                onClick={() => setShowInviteModal(false)}
                disabled={inviteSaving}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={inviteSaving} leftIcon={<Send className="w-4 h-4" />}>
                Generate Parent Invitation Code
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
