import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, getDocs, doc, setDoc, deleteDoc, query, where, orderBy, serverTimestamp, limit 
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { 
  FeeStructure, Payment, Student, SchoolClass, Parent, PaymentMethod, Term, 
  FeeCategory, FeeApplicableScope 
} from '../../types';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Modal } from '../../components/common/Modal';
import { PaymentStatusBadge } from '../../components/common/Badge';
import { ReceiptModal } from '../../components/fees/ReceiptModal';
import { FeeStatementModal } from '../../components/fees/FeeStatementModal';
import { printDocumentElement } from '../../utils/documentGenerator';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { 
  formatNaira, formatDate, formatTime, generateReceiptNumber, logAudit 
} from '../../utils/formatters';
import { 
  isFeeApplicableToStudent, calculateStudentExpectedFee, getStudentItemizedFeeList 
} from '../../utils/feeUtils';
import { 
  Receipt, Plus, Search, Printer, Copy, Check, AlertCircle, 
  CreditCard, Send, Layers, UserCheck, Trash2, Edit2, Users, 
  Tag, CheckSquare, Square, X, Filter, ShieldAlert, Sparkles, CheckCircle2
} from 'lucide-react';

const COMMON_FEE_PRESETS = [
  { name: 'Tuition Fee', category: 'MANDATORY' as FeeCategory, desc: 'Core instructional fee for the term' },
  { name: 'Development Levy', category: 'MANDATORY' as FeeCategory, desc: 'School infrastructure and facilities maintenance' },
  { name: 'Examination Fee', category: 'MANDATORY' as FeeCategory, desc: 'Terminal examination printing and materials' },
  { name: 'ICT & Computer Lab Dues', category: 'MANDATORY' as FeeCategory, desc: 'Digital learning and computer lab access' },
  { name: 'School Bus Shuttle', category: 'OTHER' as FeeCategory, desc: 'Daily pickup and dropoff transportation' },
  { name: 'Hostel & Boarding Accommodation', category: 'OTHER' as FeeCategory, desc: 'Termly dormitory accommodation and feeding' },
  { name: 'School Uniforms & Sportswear', category: 'OTHER' as FeeCategory, desc: 'Standard uniform sets and physical education wear' },
  { name: 'Books & Stationery Package', category: 'OTHER' as FeeCategory, desc: 'Curriculum textbooks and exercise books' },
  { name: 'PTA Levy', category: 'MANDATORY' as FeeCategory, desc: 'Parent-Teacher Association fund' },
  { name: 'Music & Extracurricular Club', category: 'OPTIONAL' as FeeCategory, desc: 'Specialist club coaching and materials' },
];

export const FeesPage: React.FC = () => {
  const { role, currentUser } = useAuth();
  const { settings, schoolId } = useSchool();

  const [activeTab, setActiveTab] = useState<'payments' | 'structures' | 'statements' | 'debtors'>('payments');

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [parents, setParents] = useState<Parent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);

  // Record Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payStudentId, setPayStudentId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Receipt Modal
  const [viewingReceipt, setViewingReceipt] = useState<Payment | null>(null);
  const [receiptStudent, setReceiptStudent] = useState<Student | null>(null);

  // Statement Modal
  const [statementStudent, setStatementStudent] = useState<Student | null>(null);

  // Add / Edit Fee Structure Modal
  const [showStructureModal, setShowStructureModal] = useState(false);
  const [editingStructure, setEditingStructure] = useState<FeeStructure | null>(null);
  const [structClassId, setStructClassId] = useState('');
  const [structName, setStructName] = useState('');
  const [structAmount, setStructAmount] = useState('');
  const [structTerm, setStructTerm] = useState<Term>(settings.currentTerm);
  const [structCategory, setStructCategory] = useState<FeeCategory>('MANDATORY');
  const [structApplicableTo, setStructApplicableTo] = useState<FeeApplicableScope>('ALL');
  const [structAssignedStudentIds, setStructAssignedStudentIds] = useState<string[]>([]);
  const [structExcludedStudentIds, setStructExcludedStudentIds] = useState<string[]>([]);
  const [structDescription, setStructDescription] = useState('');
  const [structStudentSearch, setStructStudentSearch] = useState('');
  const [isSavingStructure, setIsSavingStructure] = useState(false);

  // Quick Manage Student Assignments Modal
  const [quickAssignStructure, setQuickAssignStructure] = useState<FeeStructure | null>(null);
  const [quickScope, setQuickScope] = useState<FeeApplicableScope>('ALL');
  const [quickAssignedIds, setQuickAssignedIds] = useState<string[]>([]);
  const [quickExcludedIds, setQuickExcludedIds] = useState<string[]>([]);
  const [quickStudentSearch, setQuickStudentSearch] = useState('');
  const [isSavingQuickAssign, setIsSavingQuickAssign] = useState(false);

  // Delete Structure Confirmation Modal
  const [deletingStructure, setDeletingStructure] = useState<FeeStructure | null>(null);
  const [isDeletingStructure, setIsDeletingStructure] = useState(false);

  // Search & Filter
  const [searchStudent, setSearchStudent] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('ALL');
  const [copiedSmsStudentId, setCopiedSmsStudentId] = useState<string | null>(null);

  const matchesTenant = (itemSchoolId?: string) => {
    return itemSchoolId ? itemSchoolId === schoolId : schoolId === 'bistoland';
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const cSnap = await getDocs(collection(db, 'classes'));
      const cList: SchoolClass[] = [];
      cSnap.forEach((d) => {
        const item = d.data() as SchoolClass;
        if (matchesTenant(item.schoolId)) cList.push(item);
      });
      setClasses(cList);
      if (cList.length > 0 && !structClassId) setStructClassId(cList[0].classId);

      const sSnap = await getDocs(collection(db, 'students'));
      const sList: Student[] = [];
      sSnap.forEach((d) => {
        const item = d.data() as Student;
        if (matchesTenant(item.schoolId)) sList.push(item);
      });
      setStudents(sList);
      if (sList.length > 0 && !payStudentId) setPayStudentId(sList[0].studentId);

      const pSnap = await getDocs(collection(db, 'parents'));
      const pList: Parent[] = [];
      pSnap.forEach((d) => {
        const item = d.data() as Parent;
        if (matchesTenant(item.schoolId)) pList.push(item);
      });
      setParents(pList);

      const paySnap = await getDocs(query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(150)));
      const payList: Payment[] = [];
      paySnap.forEach((d) => {
        const item = d.data() as Payment;
        if (matchesTenant(item.schoolId)) payList.push(item);
      });
      payList.sort((a, b) => (b.paymentDate > a.paymentDate ? 1 : -1));
      setPayments(payList);

      const structSnap = await getDocs(collection(db, 'feeStructures'));
      const stList: FeeStructure[] = [];
      structSnap.forEach((d) => {
        const item = d.data() as FeeStructure;
        if (matchesTenant(item.schoolId)) stList.push(item);
      });
      setStructures(stList);
    } catch (err) {
      console.error('Error fetching fees data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [schoolId]);

  const studentsMap = useMemo(() => new Map<string, Student>(students.map((s) => [s.studentId, s])), [students]);
  const classesMap = useMemo(() => new Map<string, SchoolClass>(classes.map((c) => [c.classId, c])), [classes]);
  const parentsMap = useMemo(() => new Map<string, Parent>(parents.map((p) => [p.parentId, p])), [parents]);

  // Students in currently selected modal class
  const modalClassStudents = useMemo(() => {
    if (!structClassId) return [];
    return students.filter((s) => s.classId === structClassId && s.status === 'ACTIVE');
  }, [students, structClassId]);

  // Filtered modal class students for search
  const filteredModalStudents = useMemo(() => {
    if (!structStudentSearch.trim()) return modalClassStudents;
    const q = structStudentSearch.toLowerCase().trim();
    return modalClassStudents.filter(
      (s) =>
        s.firstName.toLowerCase().includes(q) ||
        s.lastName.toLowerCase().includes(q) ||
        s.admissionNumber.toLowerCase().includes(q)
    );
  }, [modalClassStudents, structStudentSearch]);

  // Students for Quick Assign Modal
  const quickClassStudents = useMemo(() => {
    if (!quickAssignStructure) return [];
    return students.filter((s) => s.classId === quickAssignStructure.classId && s.status === 'ACTIVE');
  }, [students, quickAssignStructure]);

  const filteredQuickStudents = useMemo(() => {
    if (!quickStudentSearch.trim()) return quickClassStudents;
    const q = quickStudentSearch.toLowerCase().trim();
    return quickClassStudents.filter(
      (s) =>
        s.firstName.toLowerCase().includes(q) ||
        s.lastName.toLowerCase().includes(q) ||
        s.admissionNumber.toLowerCase().includes(q)
    );
  }, [quickClassStudents, quickStudentSearch]);

  // Calculate expected fee for a student based on their class and student assignments
  const getStudentExpectedFee = (student: Student) => {
    return calculateStudentExpectedFee(student, structures, settings.currentTerm);
  };

  // Calculate total paid by student for current term
  const getStudentTotalPaid = (studentId: string) => {
    return payments
      .filter(
        (p) =>
          p.studentId === studentId &&
          p.academicSession === settings.currentAcademicSession &&
          p.term === settings.currentTerm
      )
      .reduce((sum, item) => sum + item.amount, 0);
  };

  // Open modal to add new structure
  const handleOpenAddStructure = (preselectedClassId?: string) => {
    setEditingStructure(null);
    setStructClassId(preselectedClassId || (classes.length > 0 ? classes[0].classId : ''));
    setStructName('');
    setStructAmount('');
    setStructTerm(settings.currentTerm);
    setStructCategory('MANDATORY');
    setStructApplicableTo('ALL');
    setStructAssignedStudentIds([]);
    setStructExcludedStudentIds([]);
    setStructDescription('');
    setStructStudentSearch('');
    setShowStructureModal(true);
  };

  // Open modal to edit existing structure
  const handleOpenEditStructure = (struct: FeeStructure) => {
    setEditingStructure(struct);
    setStructClassId(struct.classId);
    setStructName(struct.name || struct.feeType || '');
    setStructAmount(struct.amount.toString());
    setStructTerm(struct.term as Term);
    setStructCategory(struct.category || 'MANDATORY');
    setStructApplicableTo(struct.applicableTo || (struct.assignedStudentIds?.length ? 'SPECIFIC_STUDENTS' : 'ALL'));
    setStructAssignedStudentIds(struct.assignedStudentIds || []);
    setStructExcludedStudentIds(struct.excludedStudentIds || []);
    setStructDescription(struct.description || '');
    setStructStudentSearch('');
    setShowStructureModal(true);
  };

  // Open quick student assignments modal
  const handleOpenQuickAssign = (struct: FeeStructure) => {
    setQuickAssignStructure(struct);
    setQuickScope(struct.applicableTo || (struct.assignedStudentIds?.length ? 'SPECIFIC_STUDENTS' : 'ALL'));
    setQuickAssignedIds(struct.assignedStudentIds || []);
    setQuickExcludedIds(struct.excludedStudentIds || []);
    setQuickStudentSearch('');
  };

  // Handle Save / Update Fee Structure
  const handleSaveStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(structAmount);
    if (!structClassId || !structName.trim() || isNaN(amt) || amt <= 0) {
      alert('Please enter a valid fee name and a positive amount.');
      return;
    }

    setIsSavingStructure(true);
    try {
      const targetSchoolId = editingStructure?.schoolId || schoolId || 'bistoland';
      const structId = editingStructure
        ? editingStructure.feeStructureId
        : `fee-${structClassId}-${structName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;

      const payload: any = {
        feeStructureId: structId,
        schoolId: targetSchoolId,
        classId: structClassId,
        academicSession: settings.currentAcademicSession,
        term: structTerm,
        name: structName.trim(),
        feeType: structName.trim(),
        amount: amt,
        category: structCategory || 'MANDATORY',
        applicableTo: structApplicableTo || 'ALL',
        assignedStudentIds: structApplicableTo === 'SPECIFIC_STUDENTS' ? structAssignedStudentIds : [],
        excludedStudentIds: structApplicableTo === 'EXCLUDE_STUDENTS' ? structExcludedStudentIds : [],
        active: true,
        updatedAt: serverTimestamp(),
      };

      if (structDescription.trim()) {
        payload.description = structDescription.trim();
      }

      if (!editingStructure) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, 'feeStructures', structId), payload, { merge: true });

      // Optimistic local state update
      const localUpdated: FeeStructure = {
        ...payload,
        createdAt: editingStructure?.createdAt || new Date(),
        updatedAt: new Date(),
      };

      setStructures((prev) => {
        const existingIdx = prev.findIndex((s) => s.feeStructureId === structId);
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = { ...next[existingIdx], ...localUpdated };
          return next;
        }
        return [...prev, localUpdated];
      });

      await logAudit(
        currentUser?.uid || 'admin',
        editingStructure ? 'FEE_STRUCTURE_UPDATED' : 'FEE_STRUCTURE_CREATED',
        'feeStructures',
        structId,
        `${editingStructure ? 'Updated' : 'Created'} fee structure "${structName}" (₦${amt.toLocaleString()}) for ${classesMap.get(structClassId)?.name || 'class'}`,
        targetSchoolId
      );

      setShowStructureModal(false);
      setEditingStructure(null);
      await fetchData();
    } catch (err: any) {
      console.error('Error saving fee structure:', err);
      alert(`Failed to save fee structure: ${err?.message || 'Please verify permissions.'}`);
    } finally {
      setIsSavingStructure(false);
    }
  };

  // Save Quick Assignments
  const handleSaveQuickAssign = async () => {
    if (!quickAssignStructure) return;

    setIsSavingQuickAssign(true);
    try {
      const targetSchoolId = quickAssignStructure.schoolId || schoolId || 'bistoland';
      const docRef = doc(db, 'feeStructures', quickAssignStructure.feeStructureId);

      const updates: any = {
        applicableTo: quickScope,
        assignedStudentIds: quickScope === 'SPECIFIC_STUDENTS' ? quickAssignedIds : [],
        excludedStudentIds: quickScope === 'EXCLUDE_STUDENTS' ? quickExcludedIds : [],
        updatedAt: serverTimestamp(),
      };

      await setDoc(docRef, updates, { merge: true });

      // Optimistic update
      setStructures((prev) =>
        prev.map((s) =>
          s.feeStructureId === quickAssignStructure.feeStructureId
            ? { ...s, ...updates, updatedAt: new Date() }
            : s
        )
      );

      await logAudit(
        currentUser?.uid || 'admin',
        'FEE_STRUCTURE_ASSIGNMENTS_UPDATED',
        'feeStructures',
        quickAssignStructure.feeStructureId,
        `Updated student assignments for fee "${quickAssignStructure.name}" in ${classesMap.get(quickAssignStructure.classId)?.name}`,
        targetSchoolId
      );

      setQuickAssignStructure(null);
      await fetchData();
    } catch (err: any) {
      console.error('Error saving student assignments:', err);
      alert(`Failed to update student assignments: ${err?.message || 'Please try again.'}`);
    } finally {
      setIsSavingQuickAssign(false);
    }
  };

  // Handle Delete Fee Structure
  const handleDeleteStructure = async () => {
    if (!deletingStructure) return;

    setIsDeletingStructure(true);
    try {
      const targetSchoolId = deletingStructure.schoolId || schoolId || 'bistoland';
      const structId = deletingStructure.feeStructureId;
      await deleteDoc(doc(db, 'feeStructures', structId));

      // Optimistic deletion
      setStructures((prev) => prev.filter((s) => s.feeStructureId !== structId));

      await logAudit(
        currentUser?.uid || 'admin',
        'FEE_STRUCTURE_DELETED',
        'feeStructures',
        structId,
        `Deleted fee tariff "${deletingStructure.name || deletingStructure.feeType}" (₦${deletingStructure.amount.toLocaleString()}) from ${classesMap.get(deletingStructure.classId)?.name}`,
        targetSchoolId
      );

      setDeletingStructure(null);
      await fetchData();
    } catch (err: any) {
      console.error('Error deleting fee structure:', err);
      alert(`Failed to delete fee structure: ${err?.message || 'Please check permissions.'}`);
    } finally {
      setIsDeletingStructure(false);
    }
  };

  // Handle Record Payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPayment) return;

    const amountNum = parseFloat(payAmount);
    if (!payStudentId || isNaN(amountNum) || amountNum <= 0) {
      setPaymentError('Please enter a valid amount.');
      return;
    }

    const trimmedRef = payRef.trim();

    // 1. Duplicate Reference Check
    if (trimmedRef) {
      const isDuplicateRef = payments.some(
        (p) => p.reference && p.reference.toLowerCase() === trimmedRef.toLowerCase()
      );
      if (isDuplicateRef) {
        setPaymentError(`Duplicate Transaction: A payment with reference "${trimmedRef}" has already been logged.`);
        return;
      }
    }

    // 2. Rapid Duplicate Click Check (same student, same amount, same date)
    const recentDuplicate = payments.find(
      (p) =>
        p.studentId === payStudentId &&
        p.amount === amountNum &&
        p.paymentDate === payDate &&
        p.term === settings.currentTerm
    );
    if (recentDuplicate) {
      const isRecent = recentDuplicate.createdAt && (Date.now() - new Date(recentDuplicate.createdAt.seconds ? recentDuplicate.createdAt.seconds * 1000 : recentDuplicate.createdAt).getTime() < 120000);
      if (isRecent) {
        setPaymentError(`Duplicate Warning: An identical payment of ₦${amountNum.toLocaleString()} for this pupil was just recorded a moment ago (Receipt: ${recentDuplicate.receiptNumber}). If this is a distinct payment, please provide a unique transaction reference or note.`);
        return;
      }
    }

    setIsSubmittingPayment(true);
    setPaymentError('');
    try {
      const selectedStudent = studentsMap.get(payStudentId);
      if (!selectedStudent) throw new Error('Student not found');

      const receiptNumber = generateReceiptNumber();
      const paymentId = `pay-${Date.now()}`;
      const targetSchoolId = selectedStudent.schoolId || schoolId || 'bistoland';

      const payload: any = {
        paymentId,
        schoolId: targetSchoolId,
        receiptNumber,
        studentId: payStudentId,
        classId: selectedStudent.classId,
        amount: amountNum,
        paymentMethod: payMethod,
        paymentDate: payDate,
        academicSession: settings.currentAcademicSession,
        term: settings.currentTerm,
        recordedBy: currentUser?.displayName || currentUser?.email || 'Bursar',
        reference: trimmedRef || undefined,
        notes: payNotes.trim() || undefined,
      };

      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
          delete payload[key];
        }
      });

      const newPayment: Payment = {
        ...payload,
        createdAt: new Date(),
      };

      await setDoc(doc(db, 'payments', paymentId), {
        ...payload,
        createdAt: serverTimestamp(),
      });

      await logAudit(
        currentUser?.uid || 'admin',
        'FEE_PAYMENT_RECORDED',
        'payments',
        paymentId,
        `Recorded ₦${amountNum.toLocaleString()} payment for ${selectedStudent.firstName} ${selectedStudent.lastName} (${receiptNumber})`,
        targetSchoolId
      );

      // Open receipt immediately
      setReceiptStudent(selectedStudent);
      setViewingReceipt(newPayment);

      setShowPaymentModal(false);
      setPayAmount('');
      setPayRef('');
      setPayNotes('');
      await fetchData();
    } catch (err: any) {
      console.error('Error recording payment:', err);
      setPaymentError(err.message || 'Failed to save payment record.');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Copy SMS Debt reminder template
  const copySmsReminder = (student: Student, balance: number) => {
    const p = student.parentIds?.[0] ? parentsMap.get(student.parentIds[0]) : null;
    const parentName = p ? `${p.relationship || 'Parent'} ${p.lastName}` : 'Parent';
    const message = `Dear ${parentName}, this is a gentle reminder that ${student.firstName} ${student.lastName} has an outstanding fee balance of ${formatNaira(balance)} for ${settings.currentTerm} (${settings.currentAcademicSession}). Kindly make payment soon to avoid disruptions. Thank you. — ${settings.schoolName}`;

    navigator.clipboard.writeText(message);
    setCopiedSmsStudentId(student.studentId);
    setTimeout(() => setCopiedSmsStudentId(null), 3000);
  };

  // Total collected calculation
  const totalRevenue = payments
    .filter((p) => p.academicSession === settings.currentAcademicSession)
    .reduce((sum, p) => sum + p.amount, 0);

  if (role !== 'ADMIN') {
    return (
      <div className="p-8 text-center max-w-md mx-auto bg-white rounded-2xl border border-slate-200 mt-12 shadow-sm">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-900">Bursary Access Restricted</h3>
        <p className="text-xs text-slate-500 mt-1">School fee collection and financial ledgers are restricted to authorized administrators and bursars.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            School Fees & Bursary
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            {settings.currentAcademicSession} • {settings.currentTerm} • Total Collected:{' '}
            <strong className="text-emerald-700 font-bold">{formatNaira(totalRevenue)}</strong>
          </p>
        </div>

        {role === 'ADMIN' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenAddStructure()}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Add Fee Tariff
            </Button>
            <Button
              id="record-payment-btn"
              variant="primary"
              size="sm"
              onClick={() => {
                setShowPaymentModal(true);
                setPaymentError('');
              }}
              leftIcon={<CreditCard className="w-4 h-4" />}
            >
              Record Payment
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto bg-white rounded-t-xl px-3">
        {[
          { id: 'payments', label: 'Payment Receipts' },
          { id: 'structures', label: 'Fee Structures & Other Fees' },
          { id: 'statements', label: 'Pupil Fee Statements' },
          { id: 'debtors', label: 'Debtors List (SMS Alerts)' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as any)}
            className={`px-4 py-3 text-xs sm:text-sm font-bold uppercase tracking-wider whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              activeTab === t.id
                ? 'border-emerald-700 text-emerald-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: PAYMENTS & RECEIPTS */}
      {activeTab === 'payments' && (
        <Card>
          <CardHeader
            title="Recent Fee Payments"
            subtitle={`${payments.length} transactions recorded`}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.print()}
                leftIcon={<Printer className="w-4 h-4" />}
              >
                Print Ledger
              </Button>
            }
          />
          <CardBody className="p-0">
            {loading ? (
              <div className="py-12 text-center text-xs text-slate-500">Loading payment ledger...</div>
            ) : payments.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No fee payments recorded yet. Click "Record Payment" above to log a transaction.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-xs">
                    <tr>
                      <th className="px-5 py-3">Receipt No</th>
                      <th className="px-5 py-3">Student Name</th>
                      <th className="px-5 py-3">Class</th>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Method</th>
                      <th className="px-5 py-3 text-right">Amount (₦)</th>
                      <th className="px-5 py-3 text-center">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((payment) => {
                      const student = studentsMap.get(payment.studentId);
                      const cls = classesMap.get(payment.classId);

                      return (
                        <tr key={payment.paymentId} className="hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-mono font-bold text-slate-800">
                            {payment.receiptNumber}
                          </td>
                          <td className="px-5 py-3 font-semibold text-slate-900">
                            {student ? `${student.firstName} ${student.lastName}` : 'Pupil'}
                            <span className="block text-[11px] text-slate-400 font-mono font-normal">
                              {student?.admissionNumber}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-slate-700">{cls?.name || 'Class'}</td>
                          <td className="px-5 py-3 text-slate-600">{formatDate(payment.paymentDate)}</td>
                          <td className="px-5 py-3 font-medium text-slate-700">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">
                              {payment.paymentMethod}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-emerald-800 text-base">
                            {formatNaira(payment.amount)}
                          </td>
                          <td className="px-5 py-3 text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setReceiptStudent(student || null);
                                setViewingReceipt(payment);
                              }}
                              leftIcon={<Receipt className="w-3.5 h-3.5" />}
                            >
                              View
                            </Button>
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
      )}

      {/* TAB 2: FEE STRUCTURES & OTHER FEES */}
      {activeTab === 'structures' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 bg-white p-4 border border-slate-200 rounded-xl shadow-2xs">
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                Class Fee Tariffs & Other Fees
                <span className="px-2 py-0.5 text-xs font-normal rounded-full bg-emerald-100 text-emerald-800">
                  {structures.length} Tariffs Defined
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Define mandatory tuition, development levies, exam dues, or other optional fees (bus, uniforms, hostel) with pupil-level assignment or exemption options.
              </p>
            </div>
            {role === 'ADMIN' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenAddStructure()}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Add Fee Tariff
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => {
              const classItems = structures.filter((s) => s.classId === cls.classId);
              const classStudents = students.filter((s) => s.classId === cls.classId && s.status === 'ACTIVE');
              
              // Standard compulsory base total
              const compulsoryTotal = classItems
                .filter((s) => s.category !== 'OPTIONAL' && s.applicableTo !== 'SPECIFIC_STUDENTS')
                .reduce((sum, item) => sum + item.amount, 0);

              return (
                <Card key={cls.classId} className="flex flex-col justify-between">
                  <div>
                    <CardHeader
                      title={cls.name}
                      subtitle={`Base Compulsory: ${formatNaira(compulsoryTotal)} per pupil (${classStudents.length} pupils enrolled)`}
                      action={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenAddStructure(cls.classId)}
                          leftIcon={<Plus className="w-3.5 h-3.5" />}
                        >
                          Add Item
                        </Button>
                      }
                    />
                    <CardBody className="p-0">
                      {classItems.length === 0 ? (
                        <div className="p-5 text-center">
                          <p className="text-xs text-slate-400 italic mb-2">No fee items defined for this class.</p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenAddStructure(cls.classId)}
                          >
                            Set Fee Tariff
                          </Button>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {classItems.map((item) => {
                            const isOptional = item.category === 'OPTIONAL' || item.category === 'OTHER' || item.category === 'ADDON';
                            const isSpecific = item.applicableTo === 'SPECIFIC_STUDENTS';
                            const isExcluded = item.applicableTo === 'EXCLUDE_STUDENTS';
                            const assignedCount = item.assignedStudentIds?.length || 0;
                            const excludedCount = item.excludedStudentIds?.length || 0;

                            return (
                              <div key={item.feeStructureId} className="p-3 sm:px-4 sm:py-3 hover:bg-slate-50/60 transition-colors">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-semibold text-slate-900 text-xs sm:text-sm">
                                        {item.name || item.feeType}
                                      </span>
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                        isOptional ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                                      }`}>
                                        {item.category || 'Compulsory'}
                                      </span>
                                    </div>

                                    {item.description && (
                                      <p className="text-[11px] text-slate-500 line-clamp-1">{item.description}</p>
                                    )}

                                    {/* Assignment Badge */}
                                    <div className="flex items-center gap-1.5 pt-0.5">
                                      {isSpecific ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenQuickAssign(item)}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 text-[10px] font-semibold transition-colors cursor-pointer"
                                        >
                                          <Users className="w-3 h-3" />
                                          Assigned to {assignedCount} / {classStudents.length} pupils (Others ₦0)
                                        </button>
                                      ) : isExcluded ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenQuickAssign(item)}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-700 hover:bg-purple-100 text-[10px] font-semibold transition-colors cursor-pointer"
                                        >
                                          <Users className="w-3 h-3" />
                                          All except {excludedCount} exempted pupils
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenQuickAssign(item)}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[10px] font-medium transition-colors cursor-pointer"
                                        >
                                          <Check className="w-3 h-3" />
                                          All {classStudents.length} pupils in class
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0 space-y-1">
                                    <span className="block font-bold text-slate-900 text-xs sm:text-sm">
                                      {formatNaira(item.amount)}
                                    </span>
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        title="Manage Student Assignments"
                                        onClick={() => handleOpenQuickAssign(item)}
                                        className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                                      >
                                        <Users className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Edit Fee Tariff"
                                        onClick={() => handleOpenEditStructure(item)}
                                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Delete Fee Tariff"
                                        onClick={() => setDeletingStructure(item)}
                                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardBody>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: STATEMENTS */}
      {activeTab === 'statements' && (
        <Card>
          <CardHeader
            title="Individual Pupil Fee Statements"
            subtitle="Look up account balance, itemized assessed tariffs, and print terminal clearing statements"
          />
          <CardBody className="p-5 space-y-4">
            <div className="max-w-md">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Pupil to View Statement
              </label>
              <select
                id="statement-student-select"
                value={searchStudent}
                onChange={(e) => setSearchStudent(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:ring-2 focus:ring-emerald-600"
              >
                <option value="">— Select Pupil —</option>
                {students.map((s) => (
                  <option key={s.studentId} value={s.studentId}>
                    {s.firstName} {s.lastName} ({s.admissionNumber}) • {classesMap.get(s.classId)?.name}
                  </option>
                ))}
              </select>
            </div>

            {searchStudent && (() => {
              const student = studentsMap.get(searchStudent);
              if (!student) return null;
              const expected = getStudentExpectedFee(student);
              const studentPayments = payments.filter((p) => p.studentId === student.studentId);
              const paid = studentPayments.reduce((sum, p) => sum + p.amount, 0);
              const balance = Math.max(0, expected - paid);
              const status = paid >= expected && expected > 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
              const itemizedList = getStudentItemizedFeeList(student, structures, settings.currentTerm);

              return (
                <div className="mt-4 p-5 bg-white border border-slate-200 rounded-xl space-y-5">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <h4 className="text-lg font-bold text-slate-900">
                        {student.firstName} {student.lastName}
                      </h4>
                      <p className="text-xs text-slate-500">
                        Admission: {student.admissionNumber} • Class: {classesMap.get(student.classId)?.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <PaymentStatusBadge status={status} />
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => setStatementStudent(student)} 
                        leftIcon={<Printer className="w-4 h-4" />}
                      >
                        Print Official Statement
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center text-xs">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block uppercase font-bold text-[10px]">Total Assessed Tariff</span>
                      <span className="text-sm sm:text-base font-bold text-slate-900">{formatNaira(expected)}</span>
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                      <span className="text-emerald-700 block uppercase font-bold text-[10px]">Total Paid</span>
                      <span className="text-sm sm:text-base font-bold text-emerald-800">{formatNaira(paid)}</span>
                    </div>
                    <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                      <span className="text-rose-700 block uppercase font-bold text-[10px]">Balance Due</span>
                      <span className="text-sm sm:text-base font-bold text-rose-700">{formatNaira(balance)}</span>
                    </div>
                  </div>

                  {/* Itemized Fee Tariff Schedule */}
                  <div className="space-y-2">
                    <h5 className="font-bold text-slate-800 text-xs uppercase flex items-center justify-between">
                      <span>Assessed Tariffs for {student.firstName}</span>
                      <span className="text-[11px] font-normal text-slate-500">
                        {itemizedList.filter(i => i.isApplicable).length} of {itemizedList.length} fee items applied
                      </span>
                    </h5>
                    <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                          <tr>
                            <th className="px-4 py-2">Fee Item</th>
                            <th className="px-4 py-2">Classification</th>
                            <th className="px-4 py-2">Applicability</th>
                            <th className="px-4 py-2 text-right">Assessed Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {itemizedList.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-4 text-center text-slate-400">
                                No fee structures defined for this class grade.
                              </td>
                            </tr>
                          ) : (
                            itemizedList.map(({ fee, isApplicable, effectiveAmount }) => (
                              <tr key={fee.feeStructureId} className={isApplicable ? 'bg-white' : 'bg-slate-50/60 text-slate-400'}>
                                <td className="px-4 py-2 font-medium text-slate-800">
                                  {fee.name || fee.feeType}
                                </td>
                                <td className="px-4 py-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    fee.category === 'OPTIONAL' || fee.category === 'OTHER' || fee.category === 'ADDON'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}>
                                    {fee.category || 'Compulsory'}
                                  </span>
                                </td>
                                <td className="px-4 py-2">
                                  {isApplicable ? (
                                    <span className="text-emerald-700 font-semibold">✓ Assigned</span>
                                  ) : (
                                    <span className="text-slate-400 italic">Not Assigned / Exempt</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right font-bold text-slate-900">
                                  {isApplicable ? formatNaira(effectiveAmount) : '₦0'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <h5 className="font-bold text-slate-800 text-xs uppercase pt-2">Payments Received</h5>
                  <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                        <tr>
                          <th className="px-4 py-2">Date</th>
                          <th className="px-4 py-2">Receipt No</th>
                          <th className="px-4 py-2">Method</th>
                          <th className="px-4 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {studentPayments.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-4 text-center text-slate-400">
                              No payments made yet.
                            </td>
                          </tr>
                        ) : (
                          studentPayments.map((p) => (
                            <tr key={p.paymentId}>
                              <td className="px-4 py-2 text-slate-700">{formatDate(p.paymentDate)}</td>
                              <td className="px-4 py-2 font-mono font-bold text-slate-800">{p.receiptNumber}</td>
                              <td className="px-4 py-2 text-slate-600">{p.paymentMethod}</td>
                              <td className="px-4 py-2 text-right font-bold text-emerald-800">{formatNaira(p.amount)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </CardBody>
        </Card>
      )}

      {/* TAB 4: DEBTORS LIST */}
      {activeTab === 'debtors' && (
        <Card>
          <CardHeader
            title="Debtors Directory & Fee Defaulters"
            subtitle="Pupils with outstanding fees based on individually assessed tariffs • Click SMS to copy reminder text"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => printDocumentElement('official-debtors-print-area', `Fee Defaulters Directory - ${settings.currentTerm}`)}
                leftIcon={<Printer className="w-4 h-4" />}
              >
                Print Debtors List
              </Button>
            }
          />
          <CardBody className="p-0">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-700">Filter by Class:</label>
              <select
                id="debtor-class-filter"
                value={selectedClassFilter}
                onChange={(e) => setSelectedClassFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
              >
                <option value="ALL">All Classes</option>
                {classes.map((c) => (
                  <option key={c.classId} value={c.classId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div id="official-debtors-print-area" className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-xs">
                  <tr>
                    <th className="px-5 py-3">Student Name</th>
                    <th className="px-5 py-3">Class</th>
                    <th className="px-5 py-3 text-right">Expected</th>
                    <th className="px-5 py-3 text-right">Paid</th>
                    <th className="px-5 py-3 text-right">Balance Due</th>
                    <th className="px-5 py-3">Parent Phone</th>
                    <th className="px-5 py-3 text-right">SMS Reminder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students
                    .filter((s) => s.status === 'ACTIVE')
                    .filter((s) => selectedClassFilter === 'ALL' || s.classId === selectedClassFilter)
                    .map((student) => {
                      const expected = getStudentExpectedFee(student);
                      const paid = getStudentTotalPaid(student.studentId);
                      const balance = Math.max(0, expected - paid);
                      if (balance <= 0) return null; // Not a debtor

                      const p = student.parentIds?.[0] ? parentsMap.get(student.parentIds[0]) : null;
                      const parentPhone = p?.phone || student.emergencyContactPhone || 'No Phone';
                      const isCopied = copiedSmsStudentId === student.studentId;

                      return (
                        <tr key={student.studentId} className="hover:bg-slate-50/50">
                          <td className="px-5 py-3 font-semibold text-slate-900">
                            {student.firstName} {student.lastName}
                            <span className="block text-[11px] text-slate-400 font-normal">
                              {student.admissionNumber}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-slate-700">
                            {classesMap.get(student.classId)?.name || 'Class'}
                          </td>
                          <td className="px-5 py-3 text-right font-medium text-slate-700">
                            {formatNaira(expected)}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-emerald-700">
                            {formatNaira(paid)}
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-rose-600 text-sm">
                            {formatNaira(balance)}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-600">
                            {parentPhone}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Button
                              size="sm"
                              variant={isCopied ? 'primary' : 'outline'}
                              onClick={() => copySmsReminder(student, balance)}
                              leftIcon={isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            >
                              {isCopied ? 'Copied!' : 'Copy SMS'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* RECORD PAYMENT MODAL */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title="Record Fee Payment"
        subtitle="Log student tuition / dues and generate an official receipt"
        maxWidth="md"
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          {paymentError && (
            <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg">
              {paymentError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Pupil *
            </label>
            <select
              id="pay-student-select"
              value={payStudentId}
              onChange={(e) => setPayStudentId(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:ring-2 focus:ring-emerald-600"
            >
              {students
                .filter((s) => s.status === 'ACTIVE')
                .map((s) => (
                  <option key={s.studentId} value={s.studentId}>
                    {s.firstName} {s.lastName} ({s.admissionNumber}) • {classesMap.get(s.classId)?.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="pay-amount-input"
              type="number"
              label="Amount Paid (₦) *"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
              placeholder="e.g. 50000"
            />
            <Select
              id="pay-method-select"
              label="Payment Channel *"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              options={[
                { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
                { value: 'POS', label: 'POS Terminal' },
                { value: 'CASH', label: 'Cash Payment' },
                { value: 'ONLINE', label: 'Online / Card' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="pay-date-input"
              type="date"
              label="Payment Date *"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              required
            />
            <Input
              id="pay-ref-input"
              label="Bank / POS Reference"
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              placeholder="e.g. GTB-TRF-982123"
            />
          </div>

          <Input
            id="pay-notes-input"
            label="Additional Notes / Remarks"
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
            placeholder="e.g. 1st installment for 1st term"
          />

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <Button variant="outline" type="button" onClick={() => setShowPaymentModal(false)} disabled={isSubmittingPayment}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmittingPayment}>
              Confirm & Generate Receipt
            </Button>
          </div>
        </form>
      </Modal>

      {/* ADD / EDIT FEE STRUCTURE ITEM MODAL */}
      <Modal
        isOpen={showStructureModal}
        onClose={() => {
          if (!isSavingStructure) {
            setShowStructureModal(false);
            setEditingStructure(null);
          }
        }}
        title={editingStructure ? "Edit Fee Tariff" : "Add Fee Tariff / Other Fees"}
        subtitle="Configure standard class tuition, exam dues, or assign optional add-on fees (bus, hostel, uniforms)"
        maxWidth="lg"
      >
        <form onSubmit={handleSaveStructure} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              id="struct-class-select"
              label="Class Grade *"
              value={structClassId}
              onChange={(e) => {
                setStructClassId(e.target.value);
                setStructAssignedStudentIds([]);
                setStructExcludedStudentIds([]);
              }}
              options={classes.map((c) => ({ value: c.classId, label: c.name }))}
              required
            />

            <Select
              id="struct-term-select"
              label="Term Applicable *"
              value={structTerm}
              onChange={(e) => setStructTerm(e.target.value as Term)}
              options={[
                { value: '1st Term', label: '1st Term' },
                { value: '2nd Term', label: '2nd Term' },
                { value: '3rd Term', label: '3rd Term' },
              ]}
            />
          </div>

          <div>
            <Input
              id="struct-name-input"
              label="Fee Tariff Name *"
              value={structName}
              onChange={(e) => setStructName(e.target.value)}
              required
              placeholder="e.g. Tuition Fee, School Bus, Boarding, Uniform, Exam Fee"
            />
            {/* Quick Presets */}
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-400">Quick Presets:</span>
              {COMMON_FEE_PRESETS.slice(0, 5).map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    setStructName(preset.name);
                    setStructCategory(preset.category);
                    if (preset.desc) setStructDescription(preset.desc);
                  }}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] transition-colors cursor-pointer"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="struct-amount-input"
              type="number"
              label="Amount per Pupil (₦) *"
              value={structAmount}
              onChange={(e) => setStructAmount(e.target.value)}
              required
              placeholder="e.g. 75000"
            />

            <Select
              id="struct-category-select"
              label="Fee Classification *"
              value={structCategory}
              onChange={(e) => setStructCategory(e.target.value as FeeCategory)}
              options={[
                { value: 'MANDATORY', label: 'Mandatory / Core Tuition' },
                { value: 'OTHER', label: 'Other Fee (Bus, Hostel, Uniforms)' },
                { value: 'OPTIONAL', label: 'Optional / Clubs / Extra' },
                { value: 'ADDON', label: 'Add-on Service' },
              ]}
            />
          </div>

          <Input
            id="struct-desc-input"
            label="Description / Purpose (Optional)"
            value={structDescription}
            onChange={(e) => setStructDescription(e.target.value)}
            placeholder="e.g. Covers transport for Monday - Friday pickup routes"
          />

          {/* Student Assignment & Applicability Rules */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-700" />
                Pupil Assignment & Applicability Options
              </label>
              <span className="text-[11px] text-slate-500 font-medium">
                {modalClassStudents.length} active pupils in this grade
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStructApplicableTo('ALL')}
                className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                  structApplicableTo === 'ALL'
                    ? 'border-emerald-600 bg-emerald-50/80 text-emerald-950 font-bold shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                    structApplicableTo === 'ALL' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'
                  }`}>
                    {structApplicableTo === 'ALL' && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span>All Pupils</span>
                </div>
                <p className="text-[10px] font-normal text-slate-500">Compulsory for every student in class</p>
              </button>

              <button
                type="button"
                onClick={() => setStructApplicableTo('SPECIFIC_STUDENTS')}
                className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                  structApplicableTo === 'SPECIFIC_STUDENTS'
                    ? 'border-blue-600 bg-blue-50/80 text-blue-950 font-bold shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                    structApplicableTo === 'SPECIFIC_STUDENTS' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'
                  }`}>
                    {structApplicableTo === 'SPECIFIC_STUDENTS' && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span>Selected Pupils Only</span>
                </div>
                <p className="text-[10px] font-normal text-slate-500">Other pupils are not assigned (₦0)</p>
              </button>

              <button
                type="button"
                onClick={() => setStructApplicableTo('EXCLUDE_STUDENTS')}
                className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                  structApplicableTo === 'EXCLUDE_STUDENTS'
                    ? 'border-purple-600 bg-purple-50/80 text-purple-950 font-bold shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                    structApplicableTo === 'EXCLUDE_STUDENTS' ? 'border-purple-600 bg-purple-600 text-white' : 'border-slate-300'
                  }`}>
                    {structApplicableTo === 'EXCLUDE_STUDENTS' && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span>All with Exemptions</span>
                </div>
                <p className="text-[10px] font-normal text-slate-500">All except exempted / waived pupils</p>
              </button>
            </div>

            {/* Checkbox selector when NOT assigned to ALL */}
            {structApplicableTo !== 'ALL' && (
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {structApplicableTo === 'SPECIFIC_STUDENTS'
                      ? `Select Pupils Assigned to this Fee (${structAssignedStudentIds.length} assigned):`
                      : `Select Pupils Exempted from this Fee (${structExcludedStudentIds.length} exempted):`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (structApplicableTo === 'SPECIFIC_STUDENTS') {
                          setStructAssignedStudentIds(modalClassStudents.map((s) => s.studentId));
                        } else {
                          setStructExcludedStudentIds(modalClassStudents.map((s) => s.studentId));
                        }
                      }}
                      className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (structApplicableTo === 'SPECIFIC_STUDENTS') {
                          setStructAssignedStudentIds([]);
                        } else {
                          setStructExcludedStudentIds([]);
                        }
                      }}
                      className="text-[11px] font-semibold text-rose-600 hover:underline cursor-pointer"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>

                {/* Filter pupils search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={structStudentSearch}
                    onChange={(e) => setStructStudentSearch(e.target.value)}
                    placeholder="Search pupil by name or admission number..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                  />
                </div>

                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 bg-white border border-slate-200 rounded-lg p-1">
                  {filteredModalStudents.length === 0 ? (
                    <p className="p-3 text-center text-xs text-slate-400 italic">No pupils found.</p>
                  ) : (
                    filteredModalStudents.map((st) => {
                      const isAssigned = structApplicableTo === 'SPECIFIC_STUDENTS'
                        ? structAssignedStudentIds.includes(st.studentId)
                        : structExcludedStudentIds.includes(st.studentId);

                      return (
                        <label
                          key={st.studentId}
                          className="flex items-center justify-between p-2 hover:bg-slate-50 rounded cursor-pointer text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (structApplicableTo === 'SPECIFIC_STUDENTS') {
                                  if (checked) {
                                    setStructAssignedStudentIds([...structAssignedStudentIds, st.studentId]);
                                  } else {
                                    setStructAssignedStudentIds(structAssignedStudentIds.filter((id) => id !== st.studentId));
                                  }
                                } else {
                                  if (checked) {
                                    setStructExcludedStudentIds([...structExcludedStudentIds, st.studentId]);
                                  } else {
                                    setStructExcludedStudentIds(structExcludedStudentIds.filter((id) => id !== st.studentId));
                                  }
                                }
                              }}
                              className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 border-slate-300"
                            />
                            <div>
                              <span className="font-semibold text-slate-900">
                                {st.firstName} {st.lastName}
                              </span>
                              <span className="text-[10px] text-slate-400 block font-mono">
                                {st.admissionNumber}
                              </span>
                            </div>
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            isAssigned
                              ? structApplicableTo === 'SPECIFIC_STUDENTS'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                              : 'text-slate-400'
                          }`}>
                            {isAssigned
                              ? structApplicableTo === 'SPECIFIC_STUDENTS'
                                ? 'Assigned'
                                : 'Exempted'
                              : 'Not selected'}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setShowStructureModal(false);
                setEditingStructure(null);
              }}
              disabled={isSavingStructure}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={isSavingStructure}>
              {editingStructure ? 'Save Changes' : 'Create Fee Tariff'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* QUICK MANAGE STUDENT ASSIGNMENTS MODAL */}
      <Modal
        isOpen={!!quickAssignStructure}
        onClose={() => !isSavingQuickAssign && setQuickAssignStructure(null)}
        title="Manage Pupil Fee Assignments"
        subtitle={`Fee: ${quickAssignStructure?.name || quickAssignStructure?.feeType} (₦${quickAssignStructure?.amount.toLocaleString()}) • Class: ${classesMap.get(quickAssignStructure?.classId || '')?.name}`}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700">Assignment Scope</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setQuickScope('ALL')}
                className={`p-2 rounded-lg border text-center text-xs cursor-pointer ${
                  quickScope === 'ALL'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                All Pupils
              </button>
              <button
                type="button"
                onClick={() => setQuickScope('SPECIFIC_STUDENTS')}
                className={`p-2 rounded-lg border text-center text-xs cursor-pointer ${
                  quickScope === 'SPECIFIC_STUDENTS'
                    ? 'border-blue-600 bg-blue-50 text-blue-950 font-bold'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                Selected Only
              </button>
              <button
                type="button"
                onClick={() => setQuickScope('EXCLUDE_STUDENTS')}
                className={`p-2 rounded-lg border text-center text-xs cursor-pointer ${
                  quickScope === 'EXCLUDE_STUDENTS'
                    ? 'border-purple-600 bg-purple-50 text-purple-950 font-bold'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                With Exemptions
              </button>
            </div>
          </div>

          {quickScope !== 'ALL' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">
                  {quickScope === 'SPECIFIC_STUDENTS'
                    ? `${quickAssignedIds.length} of ${quickClassStudents.length} pupils assigned`
                    : `${quickExcludedIds.length} of ${quickClassStudents.length} pupils exempted`}
                </span>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      if (quickScope === 'SPECIFIC_STUDENTS') {
                        setQuickAssignedIds(quickClassStudents.map((s) => s.studentId));
                      } else {
                        setQuickExcludedIds(quickClassStudents.map((s) => s.studentId));
                      }
                    }}
                    className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (quickScope === 'SPECIFIC_STUDENTS') {
                        setQuickAssignedIds([]);
                      } else {
                        setQuickExcludedIds([]);
                      }
                    }}
                    className="text-rose-600 font-semibold hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={quickStudentSearch}
                onChange={(e) => setQuickStudentSearch(e.target.value)}
                placeholder="Search pupil..."
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
              />

              <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 bg-white border border-slate-200 rounded-lg p-1">
                {filteredQuickStudents.map((st) => {
                  const isChecked = quickScope === 'SPECIFIC_STUDENTS'
                    ? quickAssignedIds.includes(st.studentId)
                    : quickExcludedIds.includes(st.studentId);

                  return (
                    <label key={st.studentId} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded cursor-pointer text-xs">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const val = e.target.checked;
                            if (quickScope === 'SPECIFIC_STUDENTS') {
                              setQuickAssignedIds(val ? [...quickAssignedIds, st.studentId] : quickAssignedIds.filter(id => id !== st.studentId));
                            } else {
                              setQuickExcludedIds(val ? [...quickExcludedIds, st.studentId] : quickExcludedIds.filter(id => id !== st.studentId));
                            }
                          }}
                          className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 border-slate-300"
                        />
                        <div>
                          <span className="font-semibold text-slate-900">{st.firstName} {st.lastName}</span>
                          <span className="text-[10px] text-slate-400 block font-mono">{st.admissionNumber}</span>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isChecked
                          ? quickScope === 'SPECIFIC_STUDENTS' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                          : 'text-slate-400'
                      }`}>
                        {isChecked ? (quickScope === 'SPECIFIC_STUDENTS' ? 'Assigned' : 'Exempted') : 'Not Selected'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" onClick={() => setQuickAssignStructure(null)} disabled={isSavingQuickAssign}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveQuickAssign} isLoading={isSavingQuickAssign}>
              Save Assignments
            </Button>
          </div>
        </div>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        isOpen={!!deletingStructure}
        onClose={() => !isDeletingStructure && setDeletingStructure(null)}
        title="Delete Fee Tariff"
        subtitle="Irreversible action warning"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800 space-y-1">
              <p className="font-bold">Are you sure you want to delete this fee item?</p>
              <p>
                Deleting <strong>"{deletingStructure?.name || deletingStructure?.feeType}"</strong> (₦{deletingStructure?.amount.toLocaleString()}) from{' '}
                <strong>{classesMap.get(deletingStructure?.classId || '')?.name}</strong> will remove it from future billing assessments and pupil balance calculations.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" onClick={() => setDeletingStructure(null)} disabled={isDeletingStructure}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteStructure} isLoading={isDeletingStructure}>
              Delete Fee Tariff
            </Button>
          </div>
        </div>
      </Modal>

      {/* OFFICIAL RECEIPT VIEW MODAL */}
      <ReceiptModal
        isOpen={!!viewingReceipt}
        onClose={() => {
          setViewingReceipt(null);
          setReceiptStudent(null);
        }}
        payment={viewingReceipt}
        student={receiptStudent}
        schoolClass={receiptStudent ? classesMap.get(receiptStudent.classId) : null}
        totalTariff={receiptStudent ? getStudentExpectedFee(receiptStudent) : undefined}
        balanceRemaining={
          receiptStudent
            ? Math.max(0, getStudentExpectedFee(receiptStudent) - getStudentTotalPaid(receiptStudent.studentId))
            : 0
        }
      />

      {/* OFFICIAL STATEMENT OF ACCOUNT MODAL */}
      <FeeStatementModal
        isOpen={!!statementStudent}
        onClose={() => setStatementStudent(null)}
        student={statementStudent}
        schoolClass={statementStudent ? classesMap.get(statementStudent.classId) : null}
        payments={statementStudent ? payments.filter((p) => p.studentId === statementStudent.studentId) : []}
        expectedFee={statementStudent ? getStudentExpectedFee(statementStudent) : 0}
        structures={structures}
      />
    </div>
  );
};
