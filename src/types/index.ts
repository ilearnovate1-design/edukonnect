export type UserRole = 'ADMIN' | 'TEACHER' | 'PARENT' | 'SUPER_ADMIN';

export type UserApprovalStatus = 'PENDING_SETUP' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface AppUser {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
  active: boolean;
  approvalStatus?: UserApprovalStatus;
  schoolId?: string;
  isSuperAdmin?: boolean;
  parentId?: string;
  teacherId?: string;
  assignedClassIds?: string[];
  createdAt: any;
  updatedAt: any;
}

export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'TRANSFERRED';

export interface Student {
  studentId: string;
  schoolId?: string;
  admissionNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: 'Male' | 'Female' | 'Other';
  dateOfBirth?: string; // YYYY-MM-DD
  classId: string;
  admissionDate: string; // YYYY-MM-DD
  photoUrl?: string;
  status: StudentStatus;
  parentIds: string[];
  parentEmails?: string[];
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactEmail?: string;
  notes?: string;
  createdAt: any;
  updatedAt: any;
}

export interface Parent {
  parentId: string;
  schoolId?: string;
  userId?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address?: string;
  relationship?: string; // Father, Mother, Guardian
  occupation?: string;
  tempPassword?: string; // Default password for initial login
  createdAt: any;
  updatedAt: any;
}

export interface Teacher {
  teacherId: string;
  schoolId?: string;
  userId?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  employeeId?: string;
  assignedClassIds: string[];
  subjects: string[];
  status: 'ACTIVE' | 'INACTIVE';
  tempPassword?: string; // Default password for initial login
  createdAt: any;
  updatedAt: any;
}

export interface SchoolClass {
  classId: string;
  schoolId?: string;
  name: string; // e.g. "Primary 5"
  level?: string; // e.g. "Primary"
  section?: string; // e.g. "A" or "Gold"
  classTeacherId?: string;
  academicSession: string;
  createdAt: any;
  updatedAt: any;
}

export interface Subject {
  subjectId: string;
  schoolId?: string;
  name: string; // e.g. "Mathematics"
  code?: string; // e.g. "MTH"
  category?: string; // e.g. "Core", "Sciences", "Humanities", "Commercial", "Languages", "Vocational"
  description?: string;
  active: boolean;
  createdAt: any;
  updatedAt: any;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE';
export type Term = '1st Term' | '2nd Term' | '3rd Term' | 'First Term' | 'Second Term' | 'Third Term' | string;

export interface AttendanceRecord {
  attendanceId: string; // YYYY-MM-DD_studentId
  schoolId?: string;
  studentId: string;
  classId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  timeIn?: any;
  timeOut?: any;
  markedBy: string;
  createdAt: any;
  updatedAt: any;
}

export type FeeCategory = 'MANDATORY' | 'OPTIONAL' | 'ADDON' | 'OTHER';
export type FeeApplicableScope = 'ALL' | 'SPECIFIC_STUDENTS' | 'EXCLUDE_STUDENTS';

export interface FeeStructure {
  feeStructureId: string;
  schoolId?: string;
  name?: string;
  classId: string;
  academicSession: string;
  term: string;
  feeType: string;
  amount: number;
  description?: string;
  category?: FeeCategory;
  applicableTo?: FeeApplicableScope;
  assignedStudentIds?: string[];
  excludedStudentIds?: string[];
  active: boolean;
  createdAt: any;
  updatedAt: any;
}

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'POS' | 'OTHER';

export interface Payment {
  paymentId: string;
  schoolId?: string;
  receiptNumber?: string;
  studentId: string;
  classId?: string;
  amount: number;
  paymentDate: string; // YYYY-MM-DD
  term: string;
  academicSession: string;
  paymentMethod: PaymentMethod;
  reference?: string;
  notes?: string;
  recordedBy: string;
  createdAt: any;
}

export interface Result {
  resultId: string;
  schoolId?: string;
  studentId: string;
  classId: string;
  subjectId: string;
  teacherId?: string;
  academicSession: string;
  term: string;
  caScore: number;
  examScore: number;
  totalScore: number;
  grade: string;
  remark?: string;
  teacherComment?: string;
  status: 'DRAFT' | 'PUBLISHED';
  createdAt: any;
  updatedAt: any;
}

export interface Assignment {
  assignmentId: string;
  schoolId?: string;
  title: string;
  description: string;
  classId: string;
  subjectId?: string;
  teacherId: string;
  dueDate: string; // YYYY-MM-DD
  attachmentUrl?: string;
  attachmentName?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  createdAt: any;
  updatedAt: any;
}

export interface Submission {
  submissionId: string;
  schoolId?: string;
  assignmentId: string;
  studentId: string;
  answerText?: string;
  fileUrl?: string;
  fileName?: string;
  submittedAt?: any;
  status: 'NOT_SUBMITTED' | 'SUBMITTED' | 'GRADED';
  teacherComment?: string;
  score?: number;
  createdAt: any;
  updatedAt: any;
}

export type AudienceType = 'ALL' | 'TEACHERS' | 'PARENTS' | 'CLASS_SPECIFIC';
export type AnnouncementAudience = AudienceType;

export interface Announcement {
  announcementId: string;
  schoolId?: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  classId?: string;
  postedBy?: string;
  publishedAt?: any;
  expiresAt?: any;
  createdBy?: string;
  createdAt: any;
}

export interface AppNotification {
  notificationId: string;
  schoolId?: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: any;
}

export interface GradingScaleItem {
  min: number;
  max: number;
  grade: string;
  remark: string;
}

export interface AffectiveTraitConfig {
  id: string;
  trait: string;
  category?: 'affective' | 'psychomotor';
  defaultScore: number; // 1 to 5
}

export interface ReportTemplateSettings {
  principalName: string;
  principalTitle: string;
  officialSealText: string;
  teacherTitle: string;
  defaultTeacherName?: string;
  
  // Principal remarks by average score bracket
  principalRemarkDistinction: string; // >= 80
  principalRemarkCredit: string; // 65-79
  principalRemarkPass: string; // 50-64
  principalRemarkTrial: string; // < 50

  // Teacher appraisal remarks by average score bracket
  teacherAppraisalDistinction: string; // >= 80
  teacherAppraisalCredit: string; // 65-79
  teacherAppraisalPass: string; // 50-64
  teacherAppraisalTrial: string; // < 50

  // Verdict labels
  verdictDistinction: string; // e.g. "PASSED WITH HIGH DISTINCTION"
  verdictCredit: string; // e.g. "PASSED WITH CREDIT"
  verdictPass: string; // e.g. "PASSED"
  verdictTrial: string; // e.g. "PROMOTED ON TRIAL"

  // Affective & psychomotor rating scale & traits
  ratingScaleDescription: string; // e.g. "(5: Excellent | 4: Good | 3: Fair | 2: Poor | 1: Very Poor)"
  affectiveTraits: AffectiveTraitConfig[];

  // Clearance and notes
  clearanceNotice: string;
  showAttendanceSummary?: boolean;
  showOfficialSeal?: boolean;
}

export interface StudentEvaluation {
  evaluationId: string; // studentId_term_session
  schoolId?: string;
  studentId: string;
  term: string;
  academicSession: string;
  teacherRemark?: string;
  principalRemark?: string;
  teacherName?: string;
  verdict?: string;
  affectiveScores?: Record<string, number>; // trait or traitId -> score (1-5)
  updatedBy?: string;
  updatedAt?: any;
}

export interface SchoolSettings {
  schoolId?: string;
  schoolName: string;
  slug?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  website?: string;
  currentAcademicSession: string; // e.g. "2026/2027"
  currentTerm: string; // e.g. "First Term"
  nextTermResumptionDate?: string;
  timeZone?: string;
  currency?: string;
  gradingScale: GradingScaleItem[];
  reportTemplate?: ReportTemplateSettings;
  createdAt?: any;
  updatedAt?: any;
}

export interface SchoolTenant extends SchoolSettings {
  schoolId: string;
  slug: string;
  status: 'ACTIVE' | 'INACTIVE';
  customDomain?: string;
  adminEmails?: string[];
}

export interface AuditLog {
  auditId?: string;
  logId?: string;
  schoolId?: string;
  userId: string;
  action: string;
  entityType?: string;
  collectionName?: string;
  entityId?: string;
  documentId?: string;
  description?: string;
  details?: string;
  timestamp?: any;
  createdAt?: any;
}

export interface UsagePricing {
  firestoreReadPerMillion: number;
  firestoreWritePerMillion: number;
  firestoreDeletePerMillion: number;
  storagePerGB: number;
  bandwidthPerGB: number;
  exchangeRate: number; // NGN per USD
}

export interface PlatformUsage {
  date: string; // YYYY-MM-DD
  totalSchools: number;
  activeSchools: number;
  totalStudents: number;
  totalUsers: number;
  firestoreReads: number;
  firestoreWrites: number;
  firestoreDeletes: number;
  storageBytes: number;
  appActivity: {
    studentsAdded: number;
    attendanceRecords: number;
    paymentsRecorded: number;
    resultsPublished: number;
    assignmentsCreated: number;
    announcementsPublished: number;
  };
  updatedAt: any;
}

export interface SchoolUsageStats {
  schoolId: string;
  schoolName: string;
  students: number;
  users: number;
  reads: number;
  writes: number;
  storageBytes: number;
  estimatedCost: number;
  status: 'HEALTHY' | 'WATCH' | 'HIGH' | 'CRITICAL';
  lastUpdated: any;
}

