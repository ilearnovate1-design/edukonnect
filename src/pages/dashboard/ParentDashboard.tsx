import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { AttendanceBadge } from '../../components/common/Badge';
import { 
  Users, CalendarCheck2, Receipt, Award, ClipboardList, Megaphone, CheckCircle2, AlertCircle, FileText, Clock, ShieldCheck 
} from 'lucide-react';
import { Student, SchoolClass, AttendanceRecord, Result, Payment, Assignment, Announcement, FeeStructure, Submission } from '../../types';
import { formatNaira, formatDate, formatTime, getTodayDateString } from '../../utils/formatters';
import { isFeeApplicableToStudent, areTermsMatching } from '../../utils/feeUtils';
import { SubmitWorkModal } from '../../components/assignments/SubmitWorkModal';
import { ReceiptModal } from '../../components/fees/ReceiptModal';

interface ParentDashboardProps {
  onNavigate: (page: string, params?: any) => void;
  onViewReportCard: (student: Student) => void;
}

export const ParentDashboard: React.FC<ParentDashboardProps> = ({ 
  onNavigate,
  onViewReportCard,
}) => {
  const { currentParent, currentUser, appUser, switchToRole } = useAuth();
  const { settings, schoolId } = useSchool();
  const [isSwitchingToAdmin, setIsSwitchingToAdmin] = useState(false);

  const matchesTenant = (itemSchoolId?: string) => {
    return itemSchoolId ? itemSchoolId === schoolId : (schoolId === 'default' || !schoolId);
  };

  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [classesMap, setClassesMap] = useState<Map<string, SchoolClass>>(new Map());

  // Child data
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const [attendanceSummary, setAttendanceSummary] = useState({ total: 0, present: 0, absent: 0, late: 0, rate: 0 });
  const [results, setResults] = useState<Result[]>([]);
  const [feeExpected, setFeeExpected] = useState<number>(0);
  const [feePaid, setFeePaid] = useState<number>(0);
  const [recentPayments, setRecentPayments] = useState<Payment[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissionsMap, setSubmissionsMap] = useState<Map<string, Submission>>(new Map());
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Submit Work Modal
  const [selectedAssignmentForSubmission, setSelectedAssignmentForSubmission] = useState<Assignment | null>(null);
  const [selectedPaymentForReceipt, setSelectedPaymentForReceipt] = useState<Payment | null>(null);

  // 1. Fetch Children linked to this Parent
  useEffect(() => {
    const fetchLinkedChildren = async () => {
      setLoading(true);
      try {
        const verifiedSchool = (schoolId || appUser?.schoolId || '').toLowerCase().trim();
        if (!verifiedSchool) {
          setClassesMap(new Map());
          setChildren([]);
          setLoading(false);
          return;
        }

        // Classes map (scoped by schoolId)
        const cSnap = await getDocs(query(collection(db, 'classes'), where('schoolId', '==', verifiedSchool)));
        const cMap = new Map<string, SchoolClass>();
        cSnap.forEach((d) => {
          const c = d.data() as SchoolClass;
          cMap.set(c.classId, c);
        });
        setClassesMap(cMap);

        // Fetch students safely using both email and parentId within verifiedSchool
        let studentsList: Student[] = [];
        const userEmail = currentUser?.email?.toLowerCase().trim();

        // 1. Fetch by email
        if (userEmail) {
          try {
            const sQuery = query(
              collection(db, 'students'),
              where('schoolId', '==', verifiedSchool),
              where('parentEmails', 'array-contains', userEmail)
            );
            const sSnap = await getDocs(sQuery);
            sSnap.forEach((d) => {
              studentsList.push(d.data() as Student);
            });
          } catch (e) {
            console.warn('Failed to fetch by parentEmails:', e);
          }
        }

        // 2. Fetch by parentId if available, and deduplicate
        if (currentParent?.parentId) {
          try {
            const sQuery = query(
              collection(db, 'students'),
              where('schoolId', '==', verifiedSchool),
              where('parentIds', 'array-contains', currentParent.parentId)
            );
            const sSnap = await getDocs(sQuery);
            sSnap.forEach((d) => {
              const s = d.data() as Student;
              if (!studentsList.find(item => item.studentId === d.id)) {
                studentsList.push(s);
              }
            });
          } catch (e) {
            console.warn('Failed to fetch by parentIds:', e);
          }
        }

        // 3. Last fallback: Look up parent by email
        if (studentsList.length === 0 && userEmail && !currentParent) {
          try {
            const pSnap = await getDocs(
              query(collection(db, 'parents'), where('schoolId', '==', verifiedSchool), where('email', '==', userEmail))
            );
            if (!pSnap.empty) {
              const pid = pSnap.docs[0].id;
              const sSnap = await getDocs(
                query(collection(db, 'students'), where('schoolId', '==', verifiedSchool), where('parentIds', 'array-contains', pid))
              );
              sSnap.forEach((d) => {
                const s = d.data() as Student;
                if (!studentsList.find(item => item.studentId === d.id)) {
                  studentsList.push(s);
                }
              });
            }
          } catch (e) {
            console.warn('Failed parent fallback query:', e);
          }
        }

        setChildren(studentsList);
        if (studentsList.length > 0) {
          setSelectedChildId(studentsList[0].studentId);
        }
      } catch (err) {
        console.error('Error fetching parent children:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLinkedChildren();
  }, [currentParent, currentUser]);

  // 2. Fetch selected child's details
  useEffect(() => {
    if (!selectedChildId) return;

    const fetchChildData = async () => {
      try {
        const today = getTodayDateString();
        const selectedChild = children.find((c) => c.studentId === selectedChildId);

        const childSchool = (selectedChild?.schoolId || schoolId || appUser?.schoolId || '').toLowerCase().trim();
        if (!childSchool) return;

        // A. Today's Attendance
        try {
          const attSnap = await getDocs(
            query(
              collection(db, 'attendance'),
              where('schoolId', '==', childSchool),
              where('studentId', '==', selectedChildId),
              where('date', '==', today)
            )
          );
          if (!attSnap.empty) {
            setTodayAttendance(attSnap.docs[0].data() as AttendanceRecord);
          } else {
            setTodayAttendance(null);
          }
        } catch (e) {
          console.warn('Attendance fetch notice:', e);
        }

        // B. Attendance History Summary
        try {
          const allAttSnap = await getDocs(
            query(
              collection(db, 'attendance'),
              where('schoolId', '==', childSchool),
              where('studentId', '==', selectedChildId)
            )
          );
          let present = 0, absent = 0, late = 0;
          allAttSnap.forEach((d) => {
            const a = d.data() as AttendanceRecord;
            if (a.status === 'PRESENT') present++;
            else if (a.status === 'ABSENT') absent++;
            else if (a.status === 'LATE') late++;
          });
          const total = allAttSnap.size;
          const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 100;
          setAttendanceSummary({ total, present, absent, late, rate });
        } catch (e) {
          console.warn('Attendance history fetch notice:', e);
        }

        // C. Fees
        if (selectedChild) {
          try {
            const fSnap = await getDocs(
              query(
                collection(db, 'feeStructures'),
                where('schoolId', '==', childSchool),
                where('classId', '==', selectedChild.classId)
              )
            );
            let exp = 0;
            fSnap.forEach((d) => {
              const fee = d.data() as FeeStructure;
              if (fee.academicSession && fee.academicSession !== settings.currentAcademicSession) return;
              if (!areTermsMatching(fee.term, settings.currentTerm)) return;
              if (isFeeApplicableToStudent(fee, selectedChild.studentId)) {
                exp += fee.amount || 0;
              }
            });
            setFeeExpected(exp);

            const pSnap = await getDocs(
              query(
                collection(db, 'payments'),
                where('schoolId', '==', childSchool),
                where('studentId', '==', selectedChildId),
                where('academicSession', '==', settings.currentAcademicSession),
                where('term', '==', settings.currentTerm)
              )
            );
            let paid = 0;
            const pList: Payment[] = [];
            pSnap.forEach((d) => {
              const p = d.data() as Payment;
              paid += p.amount || 0;
              pList.push(p);
            });
            setFeePaid(paid);
            setRecentPayments(pList);
          } catch (e) {
            console.warn('Fee fetch notice:', e);
          }
        }

        // D. Published Results (strictly constrained to status == 'PUBLISHED')
        try {
          const rSnap = await getDocs(
            query(
              collection(db, 'results'),
              where('schoolId', '==', childSchool),
              where('studentId', '==', selectedChildId),
              where('status', '==', 'PUBLISHED')
            )
          );
          const rList: Result[] = [];
          rSnap.forEach((d) => {
            const res = d.data() as Result;
            if (res.status === 'PUBLISHED') rList.push(res);
          });
          setResults(rList);
        } catch (e) {
          console.warn('Results fetch notice:', e);
        }

        // E. Assignments for child's class
        if (selectedChild) {
          try {
            const aSnap = await getDocs(
              query(
                collection(db, 'assignments'),
                where('schoolId', '==', childSchool),
                where('classId', '==', selectedChild.classId)
              )
            );
            const aList: Assignment[] = [];
            aSnap.forEach((d) => {
              const assign = d.data() as Assignment;
              if (assign.status === 'PUBLISHED') aList.push(assign);
            });
            setAssignments(aList);
          } catch (e) {
            console.warn('Assignments fetch notice:', e);
          }
        }

        // F. Announcements
        try {
          const annSnap = await getDocs(
            query(
              collection(db, 'announcements'),
              where('schoolId', '==', childSchool),
              where('audience', 'in', ['ALL', 'PARENTS']),
              limit(20)
            )
          );
          const annList: Announcement[] = [];
          annSnap.forEach((d) => {
            const ann = d.data() as Announcement;
            if (annList.length < 4) {
              annList.push(ann);
            }
          });
          setAnnouncements(annList);
        } catch (e) {
          console.warn('Announcements fetch notice:', e);
        }

        // G. Pupil Homework Submissions
        try {
          const subSnap = await getDocs(
            query(
              collection(db, 'submissions'),
              where('schoolId', '==', childSchool),
              where('studentId', '==', selectedChildId)
            )
          );
          const sMap = new Map<string, Submission>();
          subSnap.forEach((d) => {
            const s = d.data() as Submission;
            sMap.set(s.assignmentId, s);
          });
          setSubmissionsMap(sMap);
        } catch (e) {
          console.warn('Submissions fetch notice:', e);
        }

      } catch (err) {
        console.error('Error fetching child details:', err);
      }
    };

    fetchChildData();
  }, [selectedChildId, children, settings]);

  const selectedChild = children.find((c) => c.studentId === selectedChildId);
  const selectedChildClass = selectedChild ? classesMap.get(selectedChild.classId)?.name : 'Class';
  const feeBalance = Math.max(0, feeExpected - feePaid);

  return (
    <div className="space-y-6">

      {/* Welcome & Child Selector */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200/60">
            Parent Portal • {settings.schoolName}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">
            Welcome, {currentParent ? `${currentParent.firstName} ${currentParent.lastName}` : currentUser?.displayName || 'Parent'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            View attendance, monitor school fee balance, check term results and homework.
          </p>
        </div>

        {/* Children selector tabs */}
        {children.length > 1 && (
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
            {children.map((child) => (
              <button
                key={child.studentId}
                type="button"
                onClick={() => setSelectedChildId(child.studentId)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] cursor-pointer ${
                  selectedChildId === child.studentId
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {child.firstName} ({classesMap.get(child.classId)?.name || 'Class'})
              </button>
            ))}
          </div>
        )}
      </div>

      {!loading && children.length === 0 && (
        <Card>
          <CardBody className="py-12 px-4 text-center max-w-md mx-auto space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No Student Records Linked Yet</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Your guardian portal account is active, but no enrolled student records have been linked to your phone number or email address.
            </p>
            <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 text-left">
              Please contact the school administrative office with your registered phone number or child's admission number so an administrator can attach your guardian profile to your child.
            </p>
          </CardBody>
        </Card>
      )}

      {selectedChild && (
        <>
          {/* Child Identity Card */}
          <div className="bg-emerald-900 text-white rounded-2xl p-5 sm:p-6 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-800 border-2 border-emerald-600 flex items-center justify-center font-bold text-xl text-white shrink-0">
                {selectedChild.photoUrl ? (
                  <img src={selectedChild.photoUrl} alt="Photo" className="w-14 h-14 rounded-full object-cover" />
                ) : (
                  selectedChild.firstName.charAt(0)
                )}
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-bold">
                  {selectedChild.firstName} {selectedChild.middleName || ''} {selectedChild.lastName}
                </h3>
                <p className="text-xs text-emerald-200 mt-0.5">
                  Admission No: <span className="font-semibold text-white">{selectedChild.admissionNumber}</span> • Class: <span className="font-semibold text-white">{selectedChildClass}</span>
                </p>
                <p className="text-xs text-emerald-300 mt-0.5">
                  Gender: {selectedChild.gender} • DOB: {formatDate(selectedChild.dateOfBirth)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="bg-emerald-800/80 hover:bg-emerald-800 text-white border-emerald-700"
                onClick={() => onViewReportCard(selectedChild)}
                leftIcon={<Award className="w-4 h-4" />}
              >
                Print Report Card
              </Button>
            </div>
          </div>

          {/* 3 Overview Cards: Attendance Today, School Fees, and Homework */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Today's Attendance */}
            <Card>
              <CardBody>
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase text-slate-600">Today's Attendance</span>
                  <CalendarCheck2 className="w-4 h-4 text-emerald-700" />
                </div>
                <div className="mt-2">
                  <AttendanceBadge status={todayAttendance?.status || 'UNMARKED'} />
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  {todayAttendance?.timeIn
                    ? `Arrived at school: ${formatTime(todayAttendance.timeIn)}`
                    : 'No check-in recorded for today yet'}
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                  <span>Term Attendance Rate:</span>
                  <span className="font-bold text-emerald-700">{attendanceSummary.rate}%</span>
                </div>
              </CardBody>
            </Card>

            {/* School Fees Status */}
            <Card>
              <CardBody>
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase text-slate-600">School Fees</span>
                  <Receipt className="w-4 h-4 text-emerald-700" />
                </div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {feeBalance > 0 ? (
                    <span className="text-rose-600">{formatNaira(feeBalance)} Due</span>
                  ) : (
                    <span className="text-emerald-700">Fully Paid ✓</span>
                  )}
                </div>
                <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                  <div className="flex justify-between">
                    <span>Expected Fee:</span>
                    <span className="font-medium text-slate-700">{formatNaira(feeExpected)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Amount Paid:</span>
                    <span className="font-semibold text-emerald-700">{formatNaira(feePaid)}</span>
                  </div>
                </div>
                {recentPayments.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 font-medium">Receipts Available</span>
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentForReceipt(recentPayments[0])}
                      className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline flex items-center gap-1 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      View & Print Receipt
                    </button>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Assignments Due */}
            <Card>
              <CardBody>
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase text-slate-600">Homework & Tasks</span>
                  <ClipboardList className="w-4 h-4 text-emerald-700" />
                </div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {assignments.length}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Active assignments for {selectedChildClass}
                </p>
              </CardBody>
            </Card>
          </div>

          {/* Published Results Table */}
          <Card>
            <CardHeader
              title={`Academic Results — ${settings.currentTerm} (${settings.currentAcademicSession})`}
              subtitle="Official scores published by class teachers"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onViewReportCard(selectedChild)}
                  leftIcon={<Award className="w-4 h-4" />}
                >
                  View Full Report Card
                </Button>
              }
            />
            <CardBody className="p-0">
              {results.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No examination results have been published for this term yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                      <tr>
                        <th className="px-5 py-3">Subject</th>
                        <th className="px-5 py-3 text-center">Continuous Assessment</th>
                        <th className="px-5 py-3 text-center">Examination</th>
                        <th className="px-5 py-3 text-center">Total Score</th>
                        <th className="px-5 py-3 text-center">Grade</th>
                        <th className="px-5 py-3">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map((r) => {
                        // Support dynamic component scores
                        const caDisplay = r.componentScores
                          ? Object.entries(r.componentScores)
                              .filter(([k]) => k !== 'exam')
                              .map(([_, v]) => v ?? '—')
                              .join(' + ') || (r.caScore ?? 0)
                          : (r.caScore ?? 0);
                        const examDisplay = r.componentScores?.['exam'] ?? r.examScore ?? 0;

                        return (
                          <tr key={r.resultId} className="hover:bg-slate-50/50">
                            <td className="px-5 py-3 font-semibold text-slate-900 capitalize">
                              {r.subjectId.replace('sub-', '').replace(/-/g, ' ')}
                            </td>
                            <td className="px-5 py-3 text-center text-slate-600 font-mono">{caDisplay}</td>
                            <td className="px-5 py-3 text-center text-slate-600 font-mono">{examDisplay}</td>
                            <td className="px-5 py-3 text-center font-bold text-slate-900">{r.totalScore}</td>
                            <td className="px-5 py-3 text-center font-bold text-emerald-800">
                              <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 font-black">
                                {r.grade}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-xs text-slate-500">{r.remark || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Assignments and Announcements */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Homework List */}
            <Card>
              <CardHeader title="Current Homework & Assignments" subtitle="Tasks given by subject teachers" />
              <CardBody className="p-0">
                {assignments.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No active assignments for this class.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {assignments.map((a) => {
                      const sub = submissionsMap.get(a.assignmentId);
                      const isGraded = sub?.status === 'GRADED';
                      const isSubmitted = sub?.status === 'SUBMITTED';

                      return (
                        <div key={a.assignmentId} className="p-4 sm:p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-semibold text-slate-900 text-sm">{a.title}</h4>
                                {isGraded ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    Graded ({sub.score}/100)
                                  </span>
                                ) : isSubmitted ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                                    <CheckCircle2 className="w-3 h-3 text-blue-600" />
                                    Submitted (Pending Review)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                    <Clock className="w-3 h-3 text-amber-600" />
                                    Not Submitted
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-rose-600 font-medium block mt-1">Due: {formatDate(a.dueDate)}</span>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600 mt-2 leading-relaxed">{a.description}</p>
                          <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-50">
                            <span className="text-[11px] text-slate-500">
                              {isGraded
                                ? `Mark: ${sub.score}/100`
                                : isSubmitted
                                ? 'Submitted & queued for teacher'
                                : 'Pending submission'}
                            </span>
                            <Button 
                              variant={isSubmitted || isGraded ? 'outline' : 'primary'} 
                              size="sm"
                              onClick={() => setSelectedAssignmentForSubmission(a)}
                            >
                              {isGraded ? 'View Grade & Remarks' : isSubmitted ? 'View / Edit Submission' : 'Submit Homework'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* School Announcements */}
            <Card>
              <CardHeader title="PTA & School Notices" subtitle="Official communication from administration" />
              <CardBody className="p-0">
                {announcements.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No announcements available.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {announcements.map((ann) => (
                      <div key={ann.announcementId} className="p-4 sm:p-5">
                        <h4 className="font-semibold text-slate-900 text-sm">{ann.title}</h4>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{ann.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
          
          <SubmitWorkModal
            isOpen={!!selectedAssignmentForSubmission}
            onClose={() => setSelectedAssignmentForSubmission(null)}
            assignment={selectedAssignmentForSubmission}
            student={selectedChild || null}
            onSuccess={() => {
              if (selectedChildId && selectedChild) {
                const childSchool = (selectedChild.schoolId || schoolId || appUser?.schoolId || '').toLowerCase().trim();
                if (childSchool) {
                  getDocs(
                    query(
                      collection(db, 'submissions'),
                      where('schoolId', '==', childSchool),
                      where('studentId', '==', selectedChildId)
                    )
                  ).then((snap) => {
                    const sMap = new Map<string, Submission>();
                    snap.forEach((d) => {
                      const s = d.data() as Submission;
                      sMap.set(s.assignmentId, s);
                    });
                    setSubmissionsMap(sMap);
                  }).catch(console.warn);
                }
              }
            }}
          />

          <ReceiptModal
            isOpen={!!selectedPaymentForReceipt}
            onClose={() => setSelectedPaymentForReceipt(null)}
            payment={selectedPaymentForReceipt}
            student={selectedChild || null}
            schoolClass={selectedChild ? classesMap.get(selectedChild.classId) : null}
            parent={currentParent}
            balanceRemaining={Math.max(0, feeExpected - feePaid)}
            totalTariff={feeExpected}
          />
        </>
      )}
    </div>
  );
};
