import React, { useState, useEffect } from 'react';
import { 
  collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, query, where 
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { Subject, Teacher } from '../../types';
import { Button } from '../common/Button';
import { Input, Select } from '../common/Input';
import { Card, CardBody } from '../common/Card';
import { Modal } from '../common/Modal';
import { 
  Plus, Edit2, Trash2, Search, BookOpen, CheckCircle2, 
  Sparkles, Check, AlertCircle, RefreshCw, X
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchool } from '../../contexts/SchoolContext';
import { logAudit } from '../../utils/formatters';
import { 
  STANDARD_CURRICULUM_SUBJECTS, 
  seedStandardCurriculumForSchool 
} from '../../services/schoolService';

export { STANDARD_CURRICULUM_SUBJECTS };

const CATEGORIES = [
  'All',
  'Core',
  'Sciences',
  'Humanities',
  'Commercial',
  'Languages',
  'Vocational',
  'General',
];

interface SubjectsManagementProps {
  onSubjectsUpdated?: () => void;
}

export const SubjectsManagement: React.FC<SubjectsManagementProps> = ({ onSubjectsUpdated }) => {
  const { role, currentUser, isSuperAdmin } = useAuth();
  const { schoolId } = useSchool();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('Core');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete State
  const [deletingSubject, setDeletingSubject] = useState<Subject | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Quick Seed State
  const [seeding, setSeeding] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState('');

  const matchesTenant = (itemSchoolId?: string) => {
    const cleanSchool = (schoolId || '').trim().toLowerCase();
    if (!cleanSchool) return isSuperAdmin;
    return (itemSchoolId || '').trim().toLowerCase() === cleanSchool;
  };

  const fetchSubjectsAndTeachers = async () => {
    const cleanSchool = (schoolId || '').trim().toLowerCase();
    if (!cleanSchool && !isSuperAdmin) {
      setSubjects([]);
      setTeachers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const sQuery = cleanSchool
        ? query(collection(db, 'subjects'), where('schoolId', '==', cleanSchool))
        : collection(db, 'subjects');
      const sSnap = await getDocs(sQuery);
      const sList: Subject[] = [];
      sSnap.forEach((d) => {
        const item = d.data() as Subject;
        if (matchesTenant(item.schoolId)) {
          sList.push(item);
        }
      });
      // Sort alphabetically by name
      sList.sort((a, b) => a.name.localeCompare(b.name));
      setSubjects(sList);

      const tQuery = cleanSchool
        ? query(collection(db, 'teachers'), where('schoolId', '==', cleanSchool))
        : collection(db, 'teachers');
      const tSnap = await getDocs(tQuery);
      const tList: Teacher[] = [];
      tSnap.forEach((d) => {
        const item = d.data() as Teacher;
        if (matchesTenant(item.schoolId)) {
          tList.push(item);
        }
      });
      setTeachers(tList);
    } catch (err) {
      console.error('Error fetching subjects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjectsAndTeachers();
  }, [schoolId]);

  const openAddModal = () => {
    setEditingSubject(null);
    setName('');
    setCode('');
    setCategory('Core');
    setDescription('');
    setActive(true);
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (sub: Subject) => {
    setEditingSubject(sub);
    setName(sub.name);
    setCode(sub.code || '');
    setCategory(sub.category || 'Core');
    setDescription(sub.description || '');
    setActive(sub.active ?? true);
    setFormError('');
    setShowModal(true);
  };

  // Helper to auto-suggest subject code when typing name
  const handleNameChange = (val: string) => {
    setName(val);
    if (!editingSubject && !code) {
      // Auto-generate a clean 3-letter code
      const clean = val.replace(/[^a-zA-Z]/g, '').toUpperCase();
      if (clean.length >= 3) {
        setCode(clean.substring(0, 3));
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Subject name is required.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const targetSchoolId = (editingSubject?.schoolId || schoolId || '').trim().toLowerCase();
      if (!targetSchoolId || (targetSchoolId === 'default' && !isSuperAdmin && !editingSubject?.schoolId)) {
        throw new Error('Cannot save subject: No verified school context available.');
      }
      const cleanSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const subId = editingSubject?.subjectId || `sub-${targetSchoolId}-${cleanSlug}`;
      const docRef = doc(db, 'subjects', subId);

      const payload: Partial<Subject> = {
        subjectId: subId,
        schoolId: targetSchoolId,
        name: name.trim(),
        code: code.trim().toUpperCase() || undefined,
        category: category || 'Core',
        description: description.trim() || undefined,
        active,
        updatedAt: serverTimestamp(),
      };

      const docData: any = { ...payload };
      if (!editingSubject) {
        docData.createdAt = serverTimestamp();
      }

      // Strip undefined
      Object.keys(docData).forEach((k) => {
        if (docData[k] === undefined) delete docData[k];
      });

      await setDoc(docRef, docData, { merge: true });

      await logAudit(
        currentUser?.uid || 'admin',
        editingSubject ? 'SUBJECT_UPDATED' : 'SUBJECT_CREATED',
        'subjects',
        subId,
        `${editingSubject ? 'Updated' : 'Created'} subject ${name} (${subId})`,
        targetSchoolId
      );

      setShowModal(false);
      await fetchSubjectsAndTeachers();
      if (onSubjectsUpdated) onSubjectsUpdated();
    } catch (err: any) {
      console.error('Error saving subject:', err);
      setFormError(err.message || 'Failed to save subject.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (sub: Subject) => {
    if (role !== 'ADMIN') return;
    try {
      const docRef = doc(db, 'subjects', sub.subjectId);
      const newStatus = !sub.active;
      await setDoc(docRef, { active: newStatus, updatedAt: serverTimestamp() }, { merge: true });

      setSubjects(prev => prev.map(s => s.subjectId === sub.subjectId ? { ...s, active: newStatus } : s));

      await logAudit(
        currentUser?.uid || 'admin',
        'SUBJECT_UPDATED',
        'subjects',
        sub.subjectId,
        `Toggled subject ${sub.name} to ${newStatus ? 'active' : 'inactive'}`,
        sub.schoolId || schoolId || ''
      );
    } catch (err) {
      console.error('Error toggling subject status:', err);
    }
  };

  const handleDeleteSubject = async () => {
    if (!deletingSubject) return;
    setDeleteLoading(true);
    try {
      await deleteDoc(doc(db, 'subjects', deletingSubject.subjectId));

      await logAudit(
        currentUser?.uid || 'admin',
        'SUBJECT_DELETED',
        'subjects',
        deletingSubject.subjectId,
        `Deleted subject ${deletingSubject.name}`,
        deletingSubject.schoolId || schoolId || ''
      );

      setDeletingSubject(null);
      await fetchSubjectsAndTeachers();
      if (onSubjectsUpdated) onSubjectsUpdated();
    } catch (err) {
      console.error('Error deleting subject:', err);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSeedStandardCurriculum = async () => {
    setSeeding(true);
    setSeedSuccess('');
    try {
      const targetSchoolId = (schoolId || '').trim().toLowerCase();
      if (!targetSchoolId || (targetSchoolId === 'default' && !isSuperAdmin)) {
        throw new Error('Cannot seed curriculum: No verified school context available.');
      }
      const result = await seedStandardCurriculumForSchool(targetSchoolId);

      await logAudit(
        currentUser?.uid || 'admin',
        'SUBJECT_SEEDED',
        'subjects',
        'batch',
        `Seeded ${result.count} standard curriculum subjects`,
        targetSchoolId
      );

      setSeedSuccess(`Successfully loaded ${result.count} standard curriculum subjects.`);
      await fetchSubjectsAndTeachers();
      if (onSubjectsUpdated) onSubjectsUpdated();
      setTimeout(() => setSeedSuccess(''), 4000);
    } catch (err: any) {
      console.error('Error seeding subjects:', err);
      alert(err.message || 'Failed to load standard curriculum subjects.');
    } finally {
      setSeeding(false);
    }
  };

  // Find teachers teaching each subject
  const getTeachersForSubject = (sub: Subject) => {
    return teachers.filter(t => 
      t.subjects && (t.subjects.includes(sub.subjectId) || t.subjects.includes(sub.name))
    );
  };

  // Filtered list
  const filteredSubjects = subjects.filter(s => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || s.name.toLowerCase().includes(q) || (s.code && s.code.toLowerCase().includes(q));
    const matchesCat = selectedCategory === 'All' || s.category === selectedCategory;
    const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? s.active !== false : s.active === false);
    return matchesSearch && matchesCat && matchesStatus;
  });

  return (
    <div className="space-y-4">
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-700" />
            Curriculum Subjects ({subjects.length})
          </h3>
          <p className="text-xs text-slate-500">
            Define subjects for grade assessments, homework assignments, and teacher allocations.
          </p>
        </div>

        {role === 'ADMIN' && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedStandardCurriculum}
              isLoading={seeding}
              leftIcon={<Sparkles className="w-3.5 h-3.5 text-amber-600" />}
            >
              Load Standard Curriculum
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={openAddModal}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Add New Subject
            </Button>
          </div>
        )}
      </div>

      {seedSuccess && (
        <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{seedSuccess}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search subject name or code (e.g. Mathematics, MTH)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Pills & Status Filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                  statusFilter === st 
                    ? 'bg-white text-slate-900 shadow-xs' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'ALL' ? 'All' : st === 'ACTIVE' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20"
          >
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>
                {cat === 'All' ? 'All Categories' : cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
          Loading subjects...
        </div>
      ) : subjects.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardBody className="py-12 text-center flex flex-col items-center justify-center max-w-md mx-auto">
            <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 mb-3">
              <BookOpen className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-slate-900">No Subjects Added Yet</h4>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              Get started by loading the standard Nigerian curriculum subjects or add custom academic subjects for your school.
            </p>
            {role === 'ADMIN' && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSeedStandardCurriculum}
                  isLoading={seeding}
                  leftIcon={<Sparkles className="w-4 h-4 text-amber-600" />}
                >
                  Load Standard Subjects
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={openAddModal}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  Add Custom Subject
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      ) : filteredSubjects.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500">
          No subjects matching your filter criteria. Try clearing search or category filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredSubjects.map((sub) => {
            const assignedTeachers = getTeachersForSubject(sub);
            const isActive = sub.active !== false;

            return (
              <Card 
                key={sub.subjectId} 
                className={`transition-all hover:border-slate-300 ${!isActive ? 'opacity-70 bg-slate-50/70' : 'bg-white'}`}
              >
                <CardBody className="p-4 flex flex-col justify-between h-full">
                  <div>
                    {/* Badges Header */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sub.code && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                            {sub.code}
                          </span>
                        )}
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                          {sub.category || 'General'}
                        </span>
                      </div>

                      {role === 'ADMIN' ? (
                        <button
                          onClick={() => handleToggleStatus(sub)}
                          title={`Click to mark as ${isActive ? 'Inactive' : 'Active'}`}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            isActive 
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' 
                              : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                          }`}
                        >
                          {isActive ? 'Active' : 'Inactive'}
                        </button>
                      ) : (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </div>

                    {/* Subject Name */}
                    <h4 className="text-sm font-bold text-slate-900 mt-2.5 line-clamp-1" title={sub.name}>
                      {sub.name}
                    </h4>

                    {/* Description */}
                    {sub.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {sub.description}
                      </p>
                    )}

                    {/* Teachers Count */}
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
                      <span className="text-slate-400">Teachers:</span>
                      {assignedTeachers.length > 0 ? (
                        <span className="font-medium text-slate-800 line-clamp-1">
                          {assignedTeachers.map(t => `${t.firstName} ${t.lastName}`).join(', ')}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">None assigned yet</span>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar for Admin */}
                  {role === 'ADMIN' && (
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditModal(sub)}
                        leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeletingSubject(sub)}
                        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Subject Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingSubject ? 'Edit Curriculum Subject' : 'Add New Subject'}
        subtitle="Define subject name, abbreviation code, and academic category"
        maxWidth="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <Input
            id="subject-name"
            label="Subject Name *"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            placeholder="e.g. Mathematics, English Language, Physics"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="subject-code"
              label="Subject Code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. MTH, ENG, PHY"
              helperText="Short 3-4 letter code"
            />

            <Select
              id="subject-category"
              label="Curriculum Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[
                { value: 'Core', label: 'Core / General' },
                { value: 'Sciences', label: 'Sciences & Technology' },
                { value: 'Humanities', label: 'Humanities & Arts' },
                { value: 'Commercial', label: 'Commercial & Business' },
                { value: 'Languages', label: 'Languages' },
                { value: 'Vocational', label: 'Vocational & Technical' },
                { value: 'General', label: 'General / Elective' },
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Description / Notes (Optional)
            </label>
            <textarea
              id="subject-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of syllabus or grade levels covered..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="subject-active-toggle"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
            <label htmlFor="subject-active-toggle" className="text-xs font-medium text-slate-700 cursor-pointer">
              Active (Available for grade entry, teacher assignments, and homework)
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <Button variant="outline" type="button" onClick={() => setShowModal(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saving}>
              {editingSubject ? 'Save Changes' : 'Create Subject'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingSubject}
        onClose={() => setDeletingSubject(null)}
        title="Delete Subject"
        subtitle="Are you sure you want to remove this subject from the school curriculum?"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            You are about to delete <span className="font-bold text-slate-900">{deletingSubject?.name}</span>. 
            If teachers or past examination results reference this subject, consider marking it as <strong>Inactive</strong> instead so historical records are preserved.
          </p>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button 
              variant="outline" 
              onClick={() => setDeletingSubject(null)} 
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={handleDeleteSubject}
              isLoading={deleteLoading}
            >
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
