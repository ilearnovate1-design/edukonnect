import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { SchoolClass, SchoolMembership, Subject, Teacher } from '../../types';
import { evaluateReportConditionsSync } from '../../services/reportAuthorizationService';
import { activateTeacherReportPermissions } from '../../services/teacherActivationService';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Lock,
  BookOpen,
  Layers,
  UserCheck,
  Zap,
} from 'lucide-react';

interface TeacherAccessInspectorProps {
  teacher: Teacher;
  schoolId: string;
  schoolName?: string;
  classes: SchoolClass[];
  subjects: Subject[];
  compact?: boolean;
  allowActivation?: boolean;
  onTeacherUpdated?: (updatedTeacher: Teacher) => void;
}

export const TeacherAccessInspector: React.FC<TeacherAccessInspectorProps> = ({
  teacher,
  schoolId,
  schoolName,
  classes,
  subjects,
  compact = false,
  allowActivation = true,
  onTeacherUpdated,
}) => {
  const { currentUser, isSuperAdmin } = useAuth();
  const cleanSchool = (schoolId || teacher.schoolId || '').trim().toLowerCase();
  const [membership, setMembership] = useState<SchoolMembership | null>(null);
  const [loadingMem, setLoadingMem] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  // Activation state
  const [activating, setActivating] = useState(false);
  const [activationNotice, setActivationNotice] = useState('');
  const [activationError, setActivationError] = useState('');
  const [quickClassIds, setQuickClassIds] = useState<string[]>([]);

  useEffect(() => {
    setQuickClassIds([]);
    setActivationNotice('');
    setActivationError('');
  }, [teacher.teacherId]);

  useEffect(() => {
    let active = true;
    const loadMembership = async () => {
      if (!cleanSchool || !teacher.userId) {
        setMembership(null);
        return;
      }
      setLoadingMem(true);
      try {
        const mSnap = await getDoc(doc(db, 'memberships', `${cleanSchool}_${teacher.userId}`));
        if (!active) return;
        if (mSnap.exists()) {
          setMembership({ id: mSnap.id, ...(mSnap.data() as any) } as SchoolMembership);
        } else {
          setMembership(null);
        }
      } catch (err) {
        if (active) setMembership(null);
      } finally {
        if (active) setLoadingMem(false);
      }
    };
    loadMembership();
    return () => {
      active = false;
    };
  }, [cleanSchool, teacher.userId, teacher.teacherId, refreshTick]);

  const classMap = useMemo(() => new Map(classes.map((c) => [c.classId, c])), [classes]);

  const assignedClasses = useMemo(() => {
    const ids = new Set(teacher.assignedClassIds || []);
    return classes.filter(
      (c) =>
        ids.has(c.classId) ||
        c.classTeacherId === teacher.teacherId ||
        (!!teacher.userId && c.classTeacherId === teacher.userId)
    );
  }, [classes, teacher]);

  const subjectScope = useMemo(() => {
    const list = Array.isArray(teacher.subjects) ? teacher.subjects : [];
    if (list.length === 0) {
      return { isAllSubjects: true, labels: [] as string[] };
    }
    const labels = list.map((sVal) => {
      const match = subjects.find((s) => s.subjectId === sVal || s.name === sVal);
      return match ? match.name : sVal;
    });
    return { isAllSubjects: false, labels };
  }, [teacher.subjects, subjects]);

  const reportReadiness = useMemo(() => {
    const sampleClass = assignedClasses[0] || null;
    const sampleSubject =
      subjects.find(
        (s) =>
          subjectScope.isAllSubjects ||
          teacher.subjects?.includes(s.subjectId) ||
          teacher.subjects?.includes(s.name)
      ) ||
      subjects[0] ||
      null;

    if (!sampleClass) {
      return {
        authorized: false,
        reason: 'No classes assigned to this teacher yet.',
      };
    }

    if (!sampleSubject) {
      return {
        authorized: false,
        reason: 'No subjects configured for this school yet.',
      };
    }

    if (!teacher.userId) {
      return {
        authorized: false,
        reason: teacher.tempPassword
          ? 'Auth login not provisioned yet. Click Activate below to provision & link account.'
          : 'Pending first sign-in or invitation activation by teacher.',
      };
    }

    const evalRes = evaluateReportConditionsSync({
      authUid: teacher.userId,
      authEmail: teacher.email,
      role: 'TEACHER',
      isSuperAdmin: false,
      isAtLeastAdmin: false,
      verifiedSchoolId: cleanSchool,
      membership,
      teacherProfile: teacher,
      liveUserTeacherId: teacher.teacherId,
      enforceDbTeacherLink: true,
      selectedClass: sampleClass,
      selectedSubject: sampleSubject,
      targetStatus: 'SUBMITTED',
    });

    return {
      authorized: evalRes.authorized,
      reason: evalRes.authorized
        ? `Verified for ${assignedClasses.length} class(es) and ${
            subjectScope.isAllSubjects ? 'all school subjects' : `${subjectScope.labels.length} subject(s)`
          }.`
        : evalRes.userMessage,
    };
  }, [assignedClasses, subjects, subjectScope, teacher, cleanSchool, membership]);

  const membershipOk =
    !!membership &&
    membership.status === 'ACTIVE' &&
    membership.role === 'TEACHER' &&
    membership.userId === teacher.userId &&
    (!membership.teacherId || membership.teacherId === teacher.teacherId);

  const handleActivateReportAccess = async () => {
    if (activating) return;
    setActivating(true);
    setActivationNotice('');
    setActivationError('');
    try {
      const result = await activateTeacherReportPermissions({
        schoolId: cleanSchool,
        schoolName,
        teacher,
        classes,
        actingAdminUid: currentUser?.uid,
        isSuperAdmin,
        additionalClassIds: quickClassIds,
        provisionAuthIfMissing: true,
      });

      setActivationNotice(result.message);
      setQuickClassIds([]);
      onTeacherUpdated?.(result.updatedTeacher);
      setRefreshTick((n) => n + 1);
    } catch (err: any) {
      setActivationError(err?.message || 'Failed to activate report permissions for this teacher.');
    } finally {
      setActivating(false);
    }
  };

  const portalCapabilities = [
    {
      label: 'Teacher Dashboard & My Classes',
      allowed: teacher.status === 'ACTIVE' && assignedClasses.length > 0,
      note:
        assignedClasses.length > 0
          ? `${assignedClasses.length} assigned class(es)`
          : 'No assigned classes',
    },
    {
      label: 'Mark Daily Attendance',
      allowed: teacher.status === 'ACTIVE' && assignedClasses.length > 0,
      note: 'Scoped to assigned classes only',
    },
    {
      label: 'Create & Grade Assignments',
      allowed: teacher.status === 'ACTIVE' && assignedClasses.length > 0,
      note: 'Scoped to assigned classes',
    },
    {
      label: 'Save Drafts & Submit Term Reports',
      allowed: reportReadiness.authorized,
      note: reportReadiness.authorized ? 'Draft & Submit permitted' : reportReadiness.reason,
    },
    {
      label: 'Approve / Publish Results to Parents',
      allowed: false,
      note: 'School Admin only',
    },
    {
      label: 'Fees, Bursary, Staff & Parent Directories, Audit Logs',
      allowed: false,
      note: 'School Admin only',
    },
  ];

  const needsActivation = !reportReadiness.authorized;

  return (
    <div className={compact ? 'space-y-3 text-xs' : 'space-y-4 text-xs sm:text-sm'}>
      {/* Identity & Membership Verification Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <UserCheck className="w-3.5 h-3.5 text-slate-500" />
            Account Link
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 font-semibold">
            {teacher.userId ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-emerald-800 truncate">Linked UID</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-amber-800">Pending First Sign-In</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            {teacher.userId ? `UID: ${teacher.userId.slice(0, 12)}...` : 'Teacher must sign in or accept invite'}
          </p>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
            School Membership
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 font-semibold">
            {loadingMem ? (
              <span className="text-slate-500">Checking membership...</span>
            ) : membershipOk ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-emerald-800">ACTIVE (TEACHER)</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="text-rose-700">
                  {membership ? `${membership.status} (${membership.role})` : 'Missing Membership'}
                </span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            School: <span className="font-mono">{cleanSchool || 'unassigned'}</span>
          </p>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            Staff Status
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 font-semibold">
            {teacher.status === 'ACTIVE' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-emerald-800">ACTIVE</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="text-rose-700">INACTIVE (Blocked)</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            Profile ID: <span className="font-mono">{teacher.teacherId}</span>
          </p>
        </div>
      </div>

      {/* Assigned Classes & Subjects */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            <Layers className="w-3.5 h-3.5 text-emerald-700" />
            Permitted Classes ({assignedClasses.length})
          </div>
          {assignedClasses.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {assignedClasses.map((cls) => {
                const isHomeroom =
                  cls.classTeacherId === teacher.teacherId ||
                  (!!teacher.userId && cls.classTeacherId === teacher.userId);
                return (
                  <span
                    key={cls.classId}
                    className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold"
                  >
                    {cls.name}
                    {cls.section ? ` (${cls.section})` : ''}
                    {isHomeroom ? ' • Class Teacher' : ''}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-amber-700">
              No classes assigned. Teacher cannot mark attendance or submit results until assigned a class.
            </p>
          )}
          {(teacher.assignedClassIds || []).some((id) => !classMap.has(id)) && (
            <p className="text-[11px] text-amber-700 mt-1.5">
              Warning: Some assigned class IDs no longer exist in this school.
            </p>
          )}
        </div>

        <div className="p-3 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            <BookOpen className="w-3.5 h-3.5 text-blue-700" />
            Permitted Subjects
          </div>
          {subjectScope.isAllSubjects ? (
            <p className="text-xs text-slate-700">
              <span className="font-semibold text-blue-800">All School Subjects</span>{' '}
              <span className="text-slate-500">(Class Teacher / Unrestricted subject scope)</span>
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {subjectScope.labels.map((label) => (
                <span
                  key={label}
                  className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 text-[11px] font-semibold"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activation Action Strip when Save Drafts & Submit Term Reports is not yet active */}
      {allowActivation && (needsActivation || activationNotice || activationError) && (
        <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/70 space-y-2.5">
          {activationNotice && (
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{activationNotice}</span>
            </div>
          )}
          {activationError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{activationError}</span>
            </div>
          )}
          {needsActivation && (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="text-xs text-slate-700">
                  <strong className="text-slate-900">Report Draft &amp; Submission Setup:</strong>{' '}
                  {reportReadiness.reason}
                </div>
                <button
                  type="button"
                  onClick={handleActivateReportAccess}
                  disabled={activating || (assignedClasses.length === 0 && classes.length > 0 && quickClassIds.length === 0 && !membershipOk && teacher.status === 'ACTIVE' && !teacher.userId && !teacher.tempPassword)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {activating ? 'Activating...' : 'Activate Save Drafts & Submit Term Reports'}
                </button>
              </div>

              {assignedClasses.length === 0 && classes.length > 0 && (
                <div className="pt-1 border-t border-blue-200/70">
                  <p className="text-[11px] font-bold text-slate-600 mb-1.5">
                    Select class(es) to assign &amp; activate immediately:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {classes.map((cls) => {
                      const checked = quickClassIds.includes(cls.classId);
                      return (
                        <label
                          key={cls.classId}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                            checked
                              ? 'bg-emerald-700 text-white border-emerald-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setQuickClassIds([...quickClassIds, cls.classId]);
                              } else {
                                setQuickClassIds(quickClassIds.filter((id) => id !== cls.classId));
                              }
                            }}
                            className="sr-only"
                          />
                          <span>{cls.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Effective Feature & Action Permissions Matrix */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Effective Portal Access & Permissions
          </span>
          <span
            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
              reportReadiness.authorized
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {reportReadiness.authorized ? 'Report Submit Ready' : 'Action Needed'}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {portalCapabilities.map((cap) => (
            <div key={cap.label} className="px-3.5 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {cap.allowed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span className={`text-xs font-medium truncate ${cap.allowed ? 'text-slate-900' : 'text-slate-500'}`}>
                  {cap.label}
                </span>
              </div>
              <span
                className={`text-[11px] shrink-0 text-right max-w-[55%] truncate ${
                  cap.allowed ? 'text-emerald-700 font-semibold' : 'text-slate-500'
                }`}
                title={cap.note}
              >
                {cap.note}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
