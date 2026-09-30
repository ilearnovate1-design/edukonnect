import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Assignment, Submission, Student } from '../../types';
import { doc, getDoc, getDocs, collection, query, where, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate, parseFirebaseError } from '../../utils/formatters';
import { sendNotification } from '../../services/notificationService';
import { 
  Paperclip, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Edit3, 
  Check, 
  FileText,
  Calendar,
  Send
} from 'lucide-react';

interface SubmitWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment | null;
  student: Student | null;
  onSuccess?: () => void;
}

export const SubmitWorkModal: React.FC<SubmitWorkModalProps> = ({
  isOpen,
  onClose,
  assignment,
  student,
  onSuccess,
}) => {
  const { currentUser } = useAuth();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [answerText, setAnswerText] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [formError, setFormError] = useState('');
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  useEffect(() => {
    if (!isOpen || !assignment || !student) return;
    
    const fetchSubmission = async () => {
      setLoading(true);
      setFormError('');
      setSuccessNotice(null);
      try {
        const q = query(
          collection(db, 'submissions'),
          where('assignmentId', '==', assignment.assignmentId),
          where('studentId', '==', student.studentId)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const sub = snap.docs[0].data() as Submission;
          setSubmission(sub);
          setAnswerText(sub.answerText || '');
          setFileUrl(sub.fileUrl || '');
          setFileName(sub.fileName || '');
          // If already submitted and not graded, default to view mode
          setIsEditing(sub.status !== 'SUBMITTED' && sub.status !== 'GRADED');
        } else {
          setSubmission(null);
          setAnswerText('');
          setFileUrl('');
          setFileName('');
          setIsEditing(true);
        }
      } catch (error) {
        console.error('Error fetching submission:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSubmission();
  }, [isOpen, assignment, student]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 700 * 1024) {
      setFormError('File size must be under 700KB. Please choose a smaller file.');
      return;
    }
    setFormError('');
    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setFileUrl(ev.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignment || !student || !currentUser) return;
    
    if (!answerText.trim() && !fileUrl) {
      setFormError('Please provide an answer or attach a file.');
      return;
    }
    
    setSaving(true);
    setFormError('');
    setSuccessNotice(null);
    try {
      const submissionId = submission?.submissionId || `sub_${assignment.assignmentId}_${student.studentId}`;
      const docRef = doc(db, 'submissions', submissionId);
      const isUpdate = submission?.status === 'SUBMITTED';
      const targetSchoolId = assignment.schoolId || student.schoolId || 'bistoland';
      
      const payload: Partial<Submission> = {
        submissionId,
        schoolId: targetSchoolId,
        assignmentId: assignment.assignmentId,
        studentId: student.studentId,
        answerText,
        fileUrl,
        fileName,
        status: 'SUBMITTED',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      const submissionData: any = {
        ...payload,
      };
      if (!submission) {
        submissionData.createdAt = serverTimestamp();
      }
      
      await setDoc(docRef, submissionData, { merge: true });
      
      // Update local state
      const updatedSub: Submission = {
        ...(submission || {} as any),
        ...payload,
        submittedAt: new Date(),
        status: 'SUBMITTED',
      };
      setSubmission(updatedSub);
      setIsEditing(false);

      const noticeText = isUpdate
        ? 'Submission updated successfully! Your teacher will see the revised version.'
        : 'Assignment submitted successfully! Your submission has been confirmed and recorded.';
      setSuccessNotice(noticeText);

      // Trigger In-App Notification to current user (student/parent)
      try {
        if (currentUser?.uid) {
          await sendNotification(
            [currentUser.uid],
            isUpdate ? 'Submission Updated' : 'Homework Submitted Successfully',
            `Your homework for "${assignment.title}" (${student.firstName} ${student.lastName}) has been successfully submitted.`,
            'ASSIGNMENT',
            targetSchoolId
          );
        }

        // Also notify assignment teacher
        let teacherUid = assignment.teacherId;
        if (assignment.teacherId) {
          try {
            const teacherDoc = await getDoc(doc(db, 'teachers', assignment.teacherId));
            if (teacherDoc.exists() && teacherDoc.data().userId) {
              teacherUid = teacherDoc.data().userId;
            }
          } catch {
            // Keep original
          }
        }

        if (teacherUid && teacherUid !== currentUser?.uid) {
          await sendNotification(
            [teacherUid],
            'New Homework Submission',
            `${student.firstName} ${student.lastName} submitted homework for "${assignment.title}".`,
            'ASSIGNMENT',
            targetSchoolId
          );
        }
      } catch (notifErr) {
        console.warn('Could not dispatch in-app notification:', notifErr);
      }

      // Notify parent caller to refresh assignments list
      if (onSuccess) {
        onSuccess();
      }
      
    } catch (error: any) {
      console.error('Error submitting work:', error);
      setFormError(parseFirebaseError(error));
    } finally {
      setSaving(false);
    }
  };

  if (!assignment || !student) return null;

  const isGraded = submission?.status === 'GRADED';
  const isSubmitted = submission?.status === 'SUBMITTED';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Homework Submission"
      subtitle={`Pupil: ${student.firstName} ${student.lastName} (${student.admissionNumber || 'Student'})`}
      maxWidth="md"
    >
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
          <Clock className="w-5 h-5 text-slate-400 animate-spin" />
          <span>Loading assignment & submission details...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Assignment Information Card with Status Header */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">{assignment.title}</h4>
                <div className="flex items-center gap-2 mt-1 text-xs text-rose-600 font-medium">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Due Date: {formatDate(assignment.dueDate)}</span>
                </div>
              </div>

              {/* Status Badge */}
              {isGraded ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Graded
                </span>
              ) : isSubmitted ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  Submitted
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  Not Yet Submitted
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 mt-2 whitespace-pre-wrap leading-relaxed">
              {assignment.description}
            </p>

            {assignment.attachmentUrl && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <span className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">
                  Teacher Material / Worksheet
                </span>
                <a 
                  href={assignment.attachmentUrl}
                  download={assignment.attachmentName || 'assignment-attachment'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors text-xs font-semibold"
                >
                  <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                  <span className="truncate max-w-[200px]">{assignment.attachmentName || 'Download Worksheet'}</span>
                </a>
              </div>
            )}
          </div>

          {/* Success Notification Alert */}
          {successNotice && (
            <div className="p-4 bg-emerald-50 border-2 border-emerald-500/40 rounded-xl space-y-2 animate-in fade-in duration-200">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700 font-bold">
                  <Check className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-emerald-900">Submission Confirmed!</h4>
                  <p className="text-xs text-emerald-800 mt-0.5 leading-relaxed font-medium">
                    {successNotice}
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-emerald-200/70 flex items-center justify-between text-[11px] text-emerald-700">
                <span>Recorded: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="font-bold px-2 py-0.5 rounded bg-emerald-200/60">Ready for Teacher Review</span>
              </div>
            </div>
          )}

          {/* Graded View */}
          {isGraded ? (
            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-950 block">Teacher Evaluation</span>
                  <span className="text-[11px] text-emerald-700">Homework has been marked</span>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-emerald-700">{submission?.score}</span>
                  <span className="text-xs font-bold text-emerald-600"> / 100</span>
                </div>
              </div>

              {submission?.teacherComment && (
                <div className="bg-white/80 p-3 rounded-lg border border-emerald-200">
                  <span className="block text-[10px] font-bold uppercase text-emerald-700 mb-1">
                    Teacher's Feedback & Remarks
                  </span>
                  <p className="text-xs text-emerald-900 italic leading-relaxed">
                    "{submission.teacherComment}"
                  </p>
                </div>
              )}

              <div className="pt-2">
                <span className="block text-[10px] font-bold uppercase text-emerald-700 mb-1">Your Submitted Work</span>
                {submission?.answerText && (
                  <p className="text-xs text-slate-700 bg-white p-3 rounded-lg border border-emerald-100 whitespace-pre-wrap">
                    {submission.answerText}
                  </p>
                )}
                {submission?.fileUrl && (
                  <div className="mt-2">
                    <a 
                      href={submission.fileUrl}
                      download={submission.fileName || 'submission-attachment'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors text-xs font-semibold"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[200px]">{submission.fileName || 'View Attached Work'}</span>
                    </a>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : isSubmitted && !isEditing ? (
            /* Confirmed Submitted View with Edit Option */
            <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  <div>
                    <h5 className="text-xs font-bold text-blue-900">Your Submitted Work</h5>
                    <p className="text-[11px] text-blue-700">
                      Submitted on: {formatDate(submission?.submittedAt)}
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wider">
                  Pending Review
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-lg border border-blue-100 space-y-2">
                {submission?.answerText ? (
                  <div>
                    <span className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Answer Text</span>
                    <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {submission.answerText}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No written response provided.</p>
                )}

                {submission?.fileUrl && (
                  <div className="pt-2 border-t border-slate-100">
                    <span className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Attached Document</span>
                    <a 
                      href={submission.fileUrl}
                      download={submission.fileName || 'submission-attachment'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100 transition-colors text-xs font-semibold"
                    >
                      <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                      <span className="truncate max-w-[200px]">{submission.fileName || 'Attached File'}</span>
                    </a>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-blue-100">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Update Submission
                </Button>
                <Button variant="primary" size="sm" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            /* Submission Input Form (New submission or Editing) */
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSubmitted && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Editing previous submission. Submitting will update your answers.</span>
                  </div>
                </div>
              )}

              {formError && (
                <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Your Answer / Response
                </label>
                <textarea
                  rows={5}
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Type the assignment answers, solution steps, or comments here..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:ring-2 focus:ring-emerald-600 focus:bg-white transition-colors"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Attach File (Optional, max 700KB PDF / Doc / Image)
                </label>
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  disabled={saving}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
                />
                {fileName && (
                  <p className="mt-1 text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Attached: {fileName}
                  </p>
                )}
              </div>
              
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                {isSubmitted ? (
                  <Button 
                    variant="outline" 
                    type="button" 
                    onClick={() => setIsEditing(false)} 
                    disabled={saving}
                  >
                    Cancel Editing
                  </Button>
                ) : (
                  <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" isLoading={saving} className="flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" />
                  {isSubmitted ? 'Update Submission' : 'Submit Homework'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
};
