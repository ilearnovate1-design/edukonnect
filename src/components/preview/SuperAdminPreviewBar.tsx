import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { SchoolClass, Subject, Teacher } from '../../types';
import { TeacherAccessInspector } from './TeacherAccessInspector';
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  Eye,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';

interface SuperAdminPreviewBarProps {
  onNavigate: (page: string) => void;
}

export const SuperAdminPreviewBar: React.FC<SuperAdminPreviewBarProps> = ({ onNavigate }) => {
  const {
    appUser,
    role,
    isSuperAdmin,
    isPreviewMode,
    currentTeacher,
    switchToRole,
    setPreviewTeacher,
  } = useAuth();
  const { schoolId, settings } = useSchool();

  const cleanSchool = ((schoolId && schoolId !== 'default' ? schoolId : appUser?.schoolId) || '')
    .trim()
    .toLowerCase();

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingTeacherData, setLoadingTeacherData] = useState(false);
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(true);

  useEffect(() => {
    if (!isPreviewMode || role !== 'TEACHER' || !cleanSchool || cleanSchool === 'default') {
      return;
    }

    let active = true;
    const loadSchoolTeacherContext = async () => {
      setLoadingTeacherData(true);
      try {
        const [tSnap, cSnap, sSnap] = await Promise.all([
          getDocs(query(collection(db, 'teachers'), where('schoolId', '==', cleanSchool))),
          getDocs(query(collection(db, 'classes'), where('schoolId', '==', cleanSchool))),
          getDocs(query(collection(db, 'subjects'), where('schoolId', '==', cleanSchool))),
        ]);

        if (!active) return;

        const tList: Teacher[] = [];
        tSnap.forEach((d) => {
          tList.push({ ...(d.data() as Teacher), teacherId: d.id });
        });
        tList.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

        const cList: SchoolClass[] = [];
        cSnap.forEach((d) => {
          cList.push({ ...(d.data() as SchoolClass), classId: d.id });
        });

        const sList: Subject[] = [];
        sSnap.forEach((d) => {
          sList.push({ ...(d.data() as Subject), subjectId: d.id });
        });

        setTeachers(tList);
        setClasses(cList);
        setSubjects(sList);

        // If no teacher is selected yet (or currentTeacher belongs to another school), select first active teacher
        if (
          tList.length > 0 &&
          (!currentTeacher || (currentTeacher.schoolId || '').trim().toLowerCase() !== cleanSchool)
        ) {
          const firstActive = tList.find((t) => t.status === 'ACTIVE') || tList[0];
          setPreviewTeacher(firstActive);
        }
      } catch (err) {
        console.warn('Preview teacher lookup notice:', err);
      } finally {
        if (active) setLoadingTeacherData(false);
      }
    };

    loadSchoolTeacherContext();
    return () => {
      active = false;
    };
  }, [isPreviewMode, role, cleanSchool]);

  if (!isSuperAdmin || !isPreviewMode) {
    return null;
  }

  const targetPreviewSchool = cleanSchool || 'default';

  return (
    <div className="mb-5 rounded-2xl border border-blue-200 bg-white shadow-xs overflow-hidden">
      {/* Top Preview Control Strip */}
      <div className="px-4 py-3 bg-slate-900 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wider">
            <Eye className="w-3.5 h-3.5" />
            SuperAdmin Preview
          </span>
          <span className="text-xs font-semibold text-slate-200">
            Viewing as{' '}
            <strong className="text-white">
              {role === 'ADMIN'
                ? 'School Admin'
                : role === 'TEACHER'
                ? 'Teacher Portal'
                : 'Parent Portal'}
            </strong>
          </span>
          <span className="text-xs text-slate-400">
            • School:{' '}
            <strong className="text-emerald-300">
              {settings.schoolName || (targetPreviewSchool !== 'default' ? targetPreviewSchool : 'Select a school in System Admin')}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={async () => {
              await switchToRole('ADMIN', targetPreviewSchool);
              onNavigate('dashboard');
            }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              role === 'ADMIN'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Admin View
          </button>

          <button
            type="button"
            onClick={async () => {
              await switchToRole('TEACHER', targetPreviewSchool);
              onNavigate('dashboard');
            }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              role === 'TEACHER'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            Teacher View
          </button>

          <button
            type="button"
            onClick={async () => {
              await switchToRole('PARENT', targetPreviewSchool);
              onNavigate('dashboard');
            }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              role === 'PARENT'
                ? 'bg-teal-600 text-white'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Parent View
          </button>

          <button
            type="button"
            onClick={async () => {
              await switchToRole('SUPER_ADMIN', 'default');
              onNavigate('superadmin');
            }}
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/90 hover:bg-rose-600 text-white flex items-center gap-1 transition-colors cursor-pointer ml-1"
          >
            <X className="w-3.5 h-3.5" />
            Exit Preview
          </button>
        </div>
      </div>

      {/* Teacher Selection & Permissions Inspector Strip (Teacher View only) */}
      {role === 'TEACHER' && (
        <div className="p-4 bg-blue-50/50 border-t border-blue-100 space-y-3">
          {!cleanSchool || cleanSchool === 'default' ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
              <span>
                No school selected yet. Open <strong>System Admin</strong> to switch into a school and inspect its teachers&apos; access &amp; permissions.
              </span>
              <button
                type="button"
                onClick={async () => {
                  await switchToRole('SUPER_ADMIN', 'default');
                  onNavigate('superadmin');
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-700 text-white font-semibold hover:bg-amber-800 shrink-0 cursor-pointer"
              >
                Select School
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
                  <label
                    htmlFor="preview-teacher-select"
                    className="text-xs font-bold text-slate-700 shrink-0"
                  >
                    Inspecting Teacher:
                  </label>
                  <select
                    id="preview-teacher-select"
                    value={currentTeacher?.teacherId || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const match = teachers.find((t) => t.teacherId === val) || null;
                      setPreviewTeacher(match);
                    }}
                    disabled={loadingTeacherData}
                    className="w-full sm:w-80 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">
                      {loadingTeacherData
                        ? 'Loading school teachers...'
                        : teachers.length === 0
                        ? 'No teachers registered in this school'
                        : '— Unlinked / Default Teacher (Zero Assignments) —'}
                    </option>
                    {teachers.map((t) => (
                      <option key={t.teacherId} value={t.teacherId}>
                        {t.firstName} {t.lastName} ({t.status}) — {t.assignedClassIds?.length || 0} class(es)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('results')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Test Results View
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('attendance')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Test Attendance View
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPermissionsPanel((prev) => !prev)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-700 text-white hover:bg-blue-800 flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {showPermissionsPanel ? 'Hide Permissions' : 'View Access & Permissions'}
                    {showPermissionsPanel ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {showPermissionsPanel && (
                currentTeacher ? (
                  <TeacherAccessInspector
                    teacher={currentTeacher}
                    schoolId={cleanSchool}
                    schoolName={settings.schoolName}
                    classes={classes}
                    subjects={subjects}
                    compact
                    onTeacherUpdated={(updated) => {
                      setTeachers((prev) =>
                        prev.map((t) => (t.teacherId === updated.teacherId ? updated : t))
                      );
                      setPreviewTeacher(updated);
                    }}
                  />
                ) : (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    No teacher profile is currently selected. Select a teacher above to inspect their class assignments, subject scope, membership status, and portal permissions.
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
