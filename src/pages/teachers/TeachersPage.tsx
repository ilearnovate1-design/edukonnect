import React, { useState, useEffect } from 'react';
import { 
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where 
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { Teacher, SchoolClass, Subject, AccountInvitation } from '../../types';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Card } from '../../components/common/Card';
import { Modal } from '../../components/common/Modal';
import { 
  Plus, Search, Edit2, Trash2, Phone, Mail, BookOpen, Layers, Briefcase,
  Send, KeyRound, Copy, Check, Clock, UserCheck, UserX, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { logAudit } from '../../utils/formatters';
import { provisionAccount } from '../../services/provisioningService';
import { createTeacherInvitation, getSchoolInvitations, revokeInvitation } from '../../services/invitationService';
import { sanitizeFirestoreData } from '../../services/gradingProfileService';
import { useQueryTab } from '../../routes/useQueryTab';

export const TeachersPage: React.FC = () => {
  const { role, currentUser, appUser, isSuperAdmin } = useAuth();
  const { schoolId, settings } = useSchool();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [invitations, setInvitations] = useState<AccountInvitation[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useQueryTab<'teachers' | 'invitations'>(
    'tab',
    'teachers',
    ['teachers', 'invitations']
  );

  // Add/Edit Modal
  const [showModal, setShowModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [assignedClassIds, setAssignedClassIds] = useState<string[]>([]);
  const [assignedSubjects, setAssignedSubjects] = useState<string[]>([]);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [tempPassword, setTempPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Invitation Modal State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteEmployeeId, setInviteEmployeeId] = useState('');
  const [inviteClasses, setInviteClasses] = useState<string[]>([]);
  const [inviteSubjects, setInviteSubjects] = useState<string[]>([]);
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
      const tSnap = await getDocs(collection(db, 'teachers'));
      const tList: Teacher[] = [];
      tSnap.forEach((d) => {
        const item = d.data() as Teacher;
        if (matchesTenant(item.schoolId)) {
          tList.push(item);
        }
      });
      setTeachers(tList);

      const cSnap = await getDocs(collection(db, 'classes'));
      const cList: SchoolClass[] = [];
      cSnap.forEach((d) => {
        const item = d.data() as SchoolClass;
        if (matchesTenant(item.schoolId)) {
          cList.push(item);
        }
      });
      setClasses(cList);

      const subSnap = await getDocs(collection(db, 'subjects'));
      const subList: Subject[] = [];
      subSnap.forEach((d) => {
        const item = d.data() as Subject;
        if (matchesTenant(item.schoolId)) {
          subList.push(item);
        }
      });
      setSubjects(subList);

      if (schoolId) {
        try {
          const invList = await getSchoolInvitations(schoolId);
          setInvitations(invList);
        } catch (invErr) {
          console.warn('Invitations load notice:', invErr);
        }
      }
    } catch (err) {
      console.error('Error fetching teachers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [schoolId]);

  const handleToggleTeacherStatus = async (teacher: Teacher) => {
    const adminSchool = (isSuperAdmin ? (schoolId || appUser?.schoolId || '') : (appUser?.schoolId || schoolId || '')).trim().toLowerCase();
    const tSchool = teacher.schoolId?.trim().toLowerCase() || '';
    if (!isSuperAdmin && tSchool && tSchool !== adminSchool) {
      alert('Unauthorized: You cannot modify teachers belonging to another school.');
      return;
    }

    const nextStatus = teacher.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const targetSchool = tSchool || adminSchool;
    try {
      await updateDoc(doc(db, 'teachers', teacher.teacherId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      if (teacher.userId) {
        try {
          await updateDoc(doc(db, 'users', teacher.userId), {
            active: nextStatus === 'ACTIVE',
            updatedAt: serverTimestamp(),
          });
        } catch (uErr) {}
        if (targetSchool) {
          try {
            await setDoc(doc(db, 'memberships', `${targetSchool}_${teacher.userId}`), {
              id: `${targetSchool}_${teacher.userId}`,
              userId: teacher.userId,
              userEmail: teacher.email.trim().toLowerCase(),
              schoolId: targetSchool,
              role: 'TEACHER',
              teacherId: teacher.teacherId,
              status: nextStatus === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
              updatedAt: serverTimestamp(),
            }, { merge: true });
          } catch (mErr) {
            console.warn('Teacher membership status sync notice:', mErr);
          }
        }
      }
      await logAudit(
        currentUser?.uid || 'admin',
        'TEACHER_STATUS_CHANGED',
        'teachers',
        teacher.teacherId,
        `Changed teacher ${teacher.firstName} ${teacher.lastName} status to ${nextStatus}`,
        teacher.schoolId || adminSchool || 'default'
      );
      await fetchData();
    } catch (err: any) {
      console.error('Failed to change teacher status:', err);
      alert('Failed to update status');
    }
  };

  const openInviteModal = () => {
    setInviteFirstName('');
    setInviteLastName('');
    setInviteEmail('');
    setInvitePhone('');
    setInviteEmployeeId(`EMP-00${teachers.length + 1}`);
    setInviteClasses([]);
    setInviteSubjects([]);
    setCreatedInvite(null);
    setInviteError('');
    setCopiedCode(false);
    setShowInviteModal(true);
  };

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteFirstName.trim() || !inviteLastName.trim() || !inviteEmail.trim()) {
      setInviteError('Please fill in teacher name and email.');
      return;
    }

    if (!appUser) return;
    setInviteSaving(true);
    setInviteError('');
    try {
      const inv = await createTeacherInvitation({
        schoolId: schoolId || appUser.schoolId || '',
        schoolName: settings.schoolName || 'EduKonnect School',
        adminUser: appUser,
        email: inviteEmail.trim(),
        teacherData: {
          firstName: inviteFirstName.trim(),
          lastName: inviteLastName.trim(),
          phone: invitePhone.trim(),
          employeeId: inviteEmployeeId.trim(),
          assignedClassIds: inviteClasses,
          subjects: inviteSubjects,
        },
      });

      setCreatedInvite(inv);
      await fetchData();
    } catch (err: any) {
      console.error('Invite error:', err);
      setInviteError(err.message || 'Failed to generate invitation.');
    } finally {
      setInviteSaving(false);
    }
  };

  const handleRevokeInvitation = async (invId: string) => {
    if (!window.confirm('Are you sure you want to revoke this invitation? The recipient will not be able to activate it.')) {
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
    setEditingTeacher(null);
    setFirstName('');
    setLastName('');
    setPhone('');
    setEmail('');
    setEmployeeId(`EMP-00${teachers.length + 1}`);
    setAssignedClassIds([]);
    setAssignedSubjects([]);
    setStatus('ACTIVE');
    setTempPassword(generatePassword());
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setFirstName(teacher.firstName);
    setLastName(teacher.lastName);
    setPhone(teacher.phone);
    setEmail(teacher.email);
    setEmployeeId(teacher.employeeId || '');
    setAssignedClassIds(teacher.assignedClassIds || []);
    setAssignedSubjects(teacher.subjects || []);
    setStatus(teacher.status || 'ACTIVE');
    setTempPassword(teacher.tempPassword || '');
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !email.trim()) {
      setFormError('Please enter teacher full name, phone number, and email.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      // Authoritative Admin School Derivation
      const adminSchool = isSuperAdmin ? (schoolId || appUser?.schoolId || '') : (appUser?.schoolId || schoolId || '');
      let targetSchoolId = '';

      if (editingTeacher) {
        targetSchoolId = editingTeacher.schoolId || adminSchool;
        // Non-superadmin cannot edit teacher belonging to another school
        if (!isSuperAdmin && editingTeacher.schoolId && editingTeacher.schoolId !== adminSchool) {
          throw new Error('Unauthorized: You can only modify teachers belonging to your assigned school.');
        }
      } else {
        targetSchoolId = adminSchool;
      }

      if (!targetSchoolId || !targetSchoolId.trim()) {
        throw new Error('Cannot save teacher: Your administrator account has no verified school membership. Please configure your school first.');
      }

      const normalizedSchoolId = targetSchoolId.trim().toLowerCase();
      const normalizedEmail = email.trim().toLowerCase();
      const tId = editingTeacher?.teacherId || `teacher-${Date.now()}`;
      const teacherDocRef = doc(db, 'teachers', tId);

      const payload: any = {
        teacherId: tId,
        schoolId: normalizedSchoolId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: normalizedEmail,
        employeeId: employeeId.trim() || undefined,
        assignedClassIds,
        subjects: assignedSubjects,
        status,
        tempPassword: tempPassword.trim() || undefined,
        updatedAt: serverTimestamp(),
      };

      // Provision account if new or if email changed (and no userId yet)
      let resolvedUserId = editingTeacher?.userId;
      if (!editingTeacher && tempPassword) {
        try {
          const { uid } = await provisionAccount(
            normalizedEmail,
            tempPassword,
            `${firstName.trim()} ${lastName.trim()}`,
            'TEACHER',
            normalizedSchoolId,
            { teacherId: tId, assignedClassIds }
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

      // Keep membership & user doc securely in sync with verified schoolId, role, and assignments
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
              role: 'TEACHER',
              status: status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
              teacherId: tId,
              activatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
            { merge: true }
          );
        } catch (memSyncErr) {
          console.warn('Teacher membership sync notice:', memSyncErr);
        }

        try {
          await setDoc(doc(db, 'users', resolvedUserId), {
            schoolId: normalizedSchoolId,
            role: 'TEACHER',
            teacherId: tId,
            assignedClassIds,
            displayName: `${firstName.trim()} ${lastName.trim()}`,
            approvalStatus: 'APPROVED',
            active: status === 'ACTIVE',
            updatedAt: serverTimestamp()
          }, { merge: true });
        } catch (syncErr) {
          console.warn('User sync notice:', syncErr);
        }
      }

      if (!editingTeacher) {
        payload.createdAt = serverTimestamp();
      }

      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
          delete payload[key];
        }
      });

      await setDoc(teacherDocRef, payload, { merge: true });

      await logAudit(
        currentUser?.uid || 'admin',
        editingTeacher ? 'TEACHER_UPDATED' : 'TEACHER_CREATED',
        'teachers',
        tId,
        `${editingTeacher ? 'Updated' : 'Added'} teacher ${firstName} ${lastName} for school ${normalizedSchoolId}`,
        normalizedSchoolId
      );

      setShowModal(false);
      await fetchData();
    } catch (err: any) {
      console.error('Error saving teacher:', err);
      setFormError(err.message || 'Failed to save teacher.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeacher = async (teacher: Teacher) => {
    const adminSchool = isSuperAdmin ? (schoolId || appUser?.schoolId || '') : (appUser?.schoolId || schoolId || '');
    if (!isSuperAdmin && teacher.schoolId && teacher.schoolId !== adminSchool) {
      alert('Unauthorized: You cannot delete teachers belonging to another school.');
      return;
    }

    if (!window.confirm(`Are you sure you want to permanently delete teacher "${teacher.firstName} ${teacher.lastName}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'teachers', teacher.teacherId));
      if (teacher.userId) {
        const tSchool = (teacher.schoolId || adminSchool || '').trim().toLowerCase();
        if (tSchool) {
          try {
            await deleteDoc(doc(db, 'memberships', `${tSchool}_${teacher.userId}`));
          } catch (mErr) {
            console.warn('Teacher membership delete notice:', mErr);
          }
        }
        try {
          await deleteDoc(doc(db, 'users', teacher.userId));
        } catch (uErr) {
          console.warn('Teacher user record delete notice:', uErr);
        }
      }
      await logAudit(
        currentUser?.uid || 'admin',
        'TEACHER_DELETED',
        'teachers',
        teacher.teacherId,
        `Deleted teacher ${teacher.firstName} ${teacher.lastName}`,
        teacher.schoolId || adminSchool || 'default'
      );
      await fetchData();
    } catch (err) {
      console.error('Failed to delete teacher:', err);
      alert('Failed to delete teacher');
    }
  };

  const classesMap = new Map<string, SchoolClass>(classes.map((c) => [c.classId, c]));

  const filteredTeachers = teachers.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const fullName = `${t.firstName} ${t.lastName}`.toLowerCase();
    return fullName.includes(q) || t.phone.includes(q) || t.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Teaching Staff Directory</h2>
          <p className="text-xs sm:text-sm text-slate-500">
            {teachers.length} verified teacher(s) • Secure invitation and assignment management
          </p>
        </div>

        {role === 'ADMIN' && (
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={openInviteModal}
              leftIcon={<Send className="w-4 h-4" />}
            >
              Invite Teacher
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

      {/* Tab Switcher: Teachers vs Invitations */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('teachers')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'teachers'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Active Teachers ({teachers.length})
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
          Account Invitations ({invitations.length})
        </button>
      </div>

      {activeTab === 'teachers' ? (
        <>
          {/* Search */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by teacher name, phone, or email..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Teachers Grid/List */}
          <Card>
            {loading ? (
              <div className="py-12 text-center text-xs text-slate-500">Loading teaching staff...</div>
            ) : filteredTeachers.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">No teachers found. Click "Invite Teacher" to onboard instructors.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredTeachers.map((teacher) => (
                  <div key={teacher.teacherId} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm sm:text-base">
                          {teacher.firstName} {teacher.lastName}
                        </span>
                        {teacher.employeeId && (
                          <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            {teacher.employeeId}
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          teacher.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}>
                          {teacher.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {teacher.phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {teacher.email}
                        </span>
                        {!teacher.userId && teacher.tempPassword && (
                          <span className="flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                            Default Pass: <span className="font-mono">{teacher.tempPassword}</span>
                          </span>
                        )}
                      </div>

                      {/* Assigned classes & subjects */}
                      <div className="pt-1 flex flex-wrap gap-2 text-xs">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-medium text-[11px]">Classes:</span>
                          {teacher.assignedClassIds?.length > 0 ? (
                            teacher.assignedClassIds.map((cid) => (
                              <span key={cid} className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-medium text-[11px]">
                                {classesMap.get(cid)?.name || cid}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">None assigned</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 ml-2">
                          <span className="text-slate-400 font-medium text-[11px]">Subjects:</span>
                          {teacher.subjects?.length > 0 ? (
                            teacher.subjects.map((s) => (
                              <span key={s} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                                {s}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">General</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {role === 'ADMIN' && (
                      <div className="shrink-0 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggleTeacherStatus(teacher)}
                          title={teacher.status === 'ACTIVE' ? 'Deactivate Teacher Access' : 'Activate Teacher Access'}
                          leftIcon={teacher.status === 'ACTIVE' ? <UserX className="w-3.5 h-3.5 text-amber-600" /> : <UserCheck className="w-3.5 h-3.5 text-emerald-600" />}
                        >
                          {teacher.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditModal(teacher)}
                          leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                        >
                          Edit
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTeacher(teacher)}
                          title="Delete Teacher"
                          className="p-2 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : (
        /* Invitations Tab View */
        <Card>
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Expiring Single-Use Invitations</h3>
              <p className="text-xs text-slate-500">
                Track pending, activated, and revoked teacher invitations
              </p>
            </div>
            {role === 'ADMIN' && (
              <Button size="sm" variant="primary" onClick={openInviteModal} leftIcon={<Send className="w-3.5 h-3.5" />}>
                New Invitation
              </Button>
            )}
          </div>
          {invitations.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">No invitations created yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-xs">
                  <tr>
                    <th className="px-5 py-3">Invite Code</th>
                    <th className="px-5 py-3">Recipient</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Classes</th>
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
                          {inv.teacherData?.firstName} {inv.teacherData?.lastName}
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
                        {inv.teacherData?.assignedClassIds?.length || 0} class(es)
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

      {/* Add / Edit Teacher Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingTeacher ? 'Edit Teacher Record' : 'Register New Teacher'}
        subtitle="Manage teacher profile and classroom teaching assignments"
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="teacher-first-name"
              label="First Name *"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              placeholder="e.g. Blessing"
            />
            <Input
              id="teacher-last-name"
              label="Last Name *"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              placeholder="e.g. Musa"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="teacher-phone"
              label="Phone Number *"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="080XXXXXXXX"
            />
            <Input
              id="teacher-email"
              type="email"
              label="Email Address *"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="teacher@school.ng"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="teacher-emp-id"
              label="Employee ID"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="EMP-001"
            />
            <div className="relative">
              <Input
                id="teacher-temp-pass"
                label="Default Password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Auto-generated"
                helperText="Give this to the teacher for their first login."
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

          <Select
            id="teacher-status"
            label="Employment Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            options={[
              { value: 'ACTIVE', label: 'Active Staff' },
              { value: 'INACTIVE', label: 'Inactive / On Leave' },
            ]}
          />

          {/* Assigned Classes Multi-check */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Assigned Classes
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
              {classes.map((cls) => {
                const isSelected = assignedClassIds.includes(cls.classId);
                return (
                  <label key={cls.classId} className="flex items-center gap-2 text-xs cursor-pointer p-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAssignedClassIds([...assignedClassIds, cls.classId]);
                        } else {
                          setAssignedClassIds(assignedClassIds.filter((id) => id !== cls.classId));
                        }
                      }}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-slate-800 font-medium">{cls.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Assigned Subjects Multi-check */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Teaching Subjects
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
              {subjects.map((sub) => {
                const isSelected = assignedSubjects.includes(sub.name);
                return (
                  <label key={sub.subjectId} className="flex items-center gap-2 text-xs cursor-pointer p-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAssignedSubjects([...assignedSubjects, sub.name]);
                        } else {
                          setAssignedSubjects(assignedSubjects.filter((name) => name !== sub.name));
                        }
                      }}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-slate-800 font-medium">{sub.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <Button variant="outline" type="button" onClick={() => setShowModal(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saving}>
              {editingTeacher ? 'Save Changes' : 'Add Teacher'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Invite Teacher Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setCreatedInvite(null);
        }}
        title="Invite Teaching Staff Member"
        subtitle="Generate a secure, single-use activation invitation bound to your institution"
        maxWidth="lg"
      >
        {createdInvite ? (
          <div className="space-y-4 text-center py-2">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Invitation Generated Successfully</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Share this activation code or link with <strong>{createdInvite.teacherData?.firstName} {createdInvite.teacherData?.lastName}</strong> ({createdInvite.email})
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
                Expires in 7 days. Can only be redeemed once.
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
                id="invite-first-name"
                label="First Name *"
                value={inviteFirstName}
                onChange={(e) => setInviteFirstName(e.target.value)}
                required
                placeholder="e.g. Blessing"
              />
              <Input
                id="invite-last-name"
                label="Last Name *"
                value={inviteLastName}
                onChange={(e) => setInviteLastName(e.target.value)}
                required
                placeholder="e.g. Musa"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                id="invite-email"
                type="email"
                label="Teacher Email Address *"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                placeholder="teacher@school.ng"
                helperText="Invitation will be strictly bound to this email."
              />
              <Input
                id="invite-phone"
                label="Phone Number"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                placeholder="080XXXXXXXX"
              />
            </div>

            <Input
              id="invite-emp-id"
              label="Staff / Employee ID"
              value={inviteEmployeeId}
              onChange={(e) => setInviteEmployeeId(e.target.value)}
              placeholder="EMP-001"
            />

            {/* Assigned Classes */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Assign Initial Classes
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg max-h-36 overflow-y-auto">
                {classes.map((cls) => {
                  const isSelected = inviteClasses.includes(cls.classId);
                  return (
                    <label key={cls.classId} className="flex items-center gap-2 text-xs cursor-pointer p-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setInviteClasses([...inviteClasses, cls.classId]);
                          } else {
                            setInviteClasses(inviteClasses.filter((id) => id !== cls.classId));
                          }
                        }}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-slate-800 font-medium">{cls.name}</span>
                    </label>
                  );
                })}
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
                Generate Invitation Code
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
