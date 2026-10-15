import React, { useState, useEffect } from 'react';
import { 
  GradingProfile, 
  AssessmentComponentConfig, 
  GradeBand, 
  GradingLevelCategory, 
  GradingCalculationMethod, 
  RoundingPolicy,
  Subject
} from '../../types';
import { 
  fetchGradingProfiles, 
  saveGradingProfile, 
  deleteGradingProfile, 
  seedDefaultGradingProfilesForSchool 
} from '../../services/gradingProfileService';
import { 
  validateGradingProfile, 
  DEFAULT_GRADING_PROFILES 
} from '../../services/assessmentEngine';
import { useSchool } from '../../contexts/SchoolContext';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Input, Select } from '../common/Input';
import { 
  Award, 
  Plus, 
  Trash2, 
  Save, 
  CheckCircle2, 
  AlertCircle, 
  Sliders, 
  Layers, 
  ShieldCheck, 
  HelpCircle,
  Copy,
  RotateCcw,
  Sparkles,
  Check,
  ChevronRight
} from 'lucide-react';
import { logAudit } from '../../utils/formatters';

export const GradingSettingsTab: React.FC = () => {
  const { schoolId } = useSchool();
  const { currentUser, isAtLeastAdmin } = useAuth();

  const [profiles, setProfiles] = useState<GradingProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setIsSaving] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Active Profile Form State
  const [activeProfile, setActiveProfile] = useState<GradingProfile | null>(null);

  // Load profiles on mount
  useEffect(() => {
    loadProfiles();
  }, [schoolId]);

  const loadProfiles = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const list = await fetchGradingProfiles(schoolId || 'default');
      setProfiles(list);
      if (list.length > 0) {
        // Select first or default
        const def = list.find(p => p.isDefault) || list[0];
        setSelectedProfileId(def.profileId);
        setActiveProfile(JSON.parse(JSON.stringify(def)));
      } else {
        setActiveProfile(null);
      }
    } catch (err: any) {
      console.error('Error loading grading profiles:', err);
      setStatusMsg({ type: 'error', text: 'Failed to load grading configurations.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProfile = (profileId: string) => {
    const found = profiles.find(p => p.profileId === profileId);
    if (found) {
      setSelectedProfileId(profileId);
      setActiveProfile(JSON.parse(JSON.stringify(found)));
      setStatusMsg(null);
    }
  };

  const handleCreateNewProfile = (baseCategory: GradingLevelCategory = 'CUSTOM') => {
    const template = DEFAULT_GRADING_PROFILES[baseCategory];
    const newId = `gp_${schoolId || 'default'}_${Date.now()}`;
    const newProf: GradingProfile = {
      ...template,
      profileId: newId,
      schoolId: schoolId || 'default',
      name: `New ${baseCategory} Grading Profile`,
      isDefault: profiles.length === 0,
      version: 1,
    };
    setActiveProfile(newProf);
    setSelectedProfileId(newId);
    setStatusMsg({ type: 'success', text: `Created new draft profile based on ${baseCategory} template.` });
  };

  // Component Management
  const handleAddComponent = () => {
    if (!activeProfile) return;
    const count = activeProfile.components.length + 1;
    const newComp: AssessmentComponentConfig = {
      id: `comp_${Date.now()}`,
      name: `Assessment Component ${count}`,
      maxScore: 20,
      weight: 20,
      optional: false,
    };
    setActiveProfile({
      ...activeProfile,
      components: [...activeProfile.components, newComp],
    });
  };

  const handleUpdateComponent = (index: number, field: keyof AssessmentComponentConfig, value: any) => {
    if (!activeProfile) return;
    const updated = [...activeProfile.components];
    updated[index] = { ...updated[index], [field]: value };
    setActiveProfile({ ...activeProfile, components: updated });
  };

  const handleRemoveComponent = (index: number) => {
    if (!activeProfile || activeProfile.components.length <= 1) return;
    const updated = activeProfile.components.filter((_, idx) => idx !== index);
    setActiveProfile({ ...activeProfile, components: updated });
  };

  // Grade Band Management
  const handleAddGradeBand = () => {
    if (!activeProfile) return;
    const newBand: GradeBand = {
      min: 0,
      max: 39,
      grade: 'F',
      remark: 'Fail',
      gradePoint: 0.0,
    };
    setActiveProfile({
      ...activeProfile,
      gradeBands: [...activeProfile.gradeBands, newBand],
    });
  };

  const handleUpdateGradeBand = (index: number, field: keyof GradeBand, value: any) => {
    if (!activeProfile) return;
    const updated = [...activeProfile.gradeBands];
    updated[index] = { ...updated[index], [field]: value };
    setActiveProfile({ ...activeProfile, gradeBands: updated });
  };

  const handleRemoveGradeBand = (index: number) => {
    if (!activeProfile || activeProfile.gradeBands.length <= 1) return;
    const updated = activeProfile.gradeBands.filter((_, idx) => idx !== index);
    setActiveProfile({ ...activeProfile, gradeBands: updated });
  };

  // Save with Validation
  const handleSave = async () => {
    if (!activeProfile) return;
    setIsSaving(true);
    setStatusMsg(null);

    const validation = validateGradingProfile(activeProfile);
    if (!validation.valid) {
      setStatusMsg({
        type: 'error',
        text: `Configuration Error: ${validation.errors.join(' ')}`,
      });
      setIsSaving(false);
      return;
    }

    try {
      const res = await saveGradingProfile(activeProfile);
      if (res.success) {
        await logAudit(
          currentUser?.uid || 'admin',
          'GRADING_PROFILE_UPDATED',
          'gradingProfiles',
          activeProfile.profileId,
          `Saved grading profile "${activeProfile.name}" (Version ${activeProfile.version})`,
          schoolId || 'default'
        );

        setStatusMsg({
          type: 'success',
          text: `Grading profile "${activeProfile.name}" successfully validated and activated!`,
        });
        await loadProfiles();
      } else {
        setStatusMsg({
          type: 'error',
          text: res.errors?.join(' ') || 'Failed to save grading profile.',
        });
      }
    } catch (err: any) {
      console.error('Error saving profile:', err);
      setStatusMsg({ type: 'error', text: err.message || 'Error saving grading profile.' });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete profile
  const handleDelete = async () => {
    if (!activeProfile) return;
    if (profiles.length <= 1) {
      setStatusMsg({ type: 'error', text: 'You must maintain at least one active grading profile.' });
      return;
    }
    if (!confirm(`Are you sure you want to delete profile "${activeProfile.name}"? This action cannot be undone.`)) {
      return;
    }

    setIsSaving(true);
    try {
      await deleteGradingProfile(activeProfile.profileId);
      await logAudit(
        currentUser?.uid || 'admin',
        'GRADING_PROFILE_DELETED',
        'gradingProfiles',
        activeProfile.profileId,
        `Deleted grading profile "${activeProfile.name}"`,
        schoolId || 'default'
      );
      setStatusMsg({ type: 'success', text: `Profile "${activeProfile.name}" removed.` });
      await loadProfiles();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to delete profile.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-slate-200">
        <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-700">Loading grading configurations...</p>
      </div>
    );
  }

  // Calculate live component stats
  const totalMaxScore = activeProfile?.components.reduce((sum, c) => sum + (Number(c.maxScore) || 0), 0) || 0;
  const totalWeight = activeProfile?.components.reduce((sum, c) => sum + (Number(c.weight) || 0), 0) || 0;

  return (
    <div className="space-y-6">
      {/* Top Banner & Profile Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
              <Award className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-slate-900">Grading & Report Card Settings</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Configure institutional assessment structures, continuous assessment weights, boundary cutoffs, and report layouts.
          </p>
        </div>

        {/* Profile Selector */}
        <div className="flex items-center gap-2">
          <select
            value={selectedProfileId}
            onChange={(e) => handleSelectProfile(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer min-w-[200px]"
          >
            {profiles.map((p) => (
              <option key={p.profileId} value={p.profileId}>
                {p.name} {p.isDefault ? '★ (Default)' : ''}
              </option>
            ))}
          </select>

          {isAtLeastAdmin && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCreateNewProfile('PRIMARY')}
                className="text-xs flex items-center gap-1"
                title="Create a new grading profile"
              >
                <Plus className="w-3.5 h-3.5" />
                New Profile
              </Button>
            </div>
          )}
        </div>
      </div>

      {statusMsg && (
        <div
          className={`p-4 rounded-xl text-xs font-medium flex items-center gap-2 border ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {activeProfile && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Config Column (Left 2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            {/* 1. Profile Identity & Level */}
            <Card>
              <CardHeader 
                title="Profile Identity & Level" 
                subtitle="Define education tier and profile designation" 
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    id="profile-name"
                    label="Profile Name"
                    value={activeProfile.name}
                    onChange={(e) => setActiveProfile({ ...activeProfile, name: e.target.value })}
                    placeholder="e.g. Primary School Standard (Basic 1-6)"
                    required
                  />

                  <Select
                    id="profile-level-category"
                    label="Educational Level Category"
                    value={activeProfile.levelCategory}
                    onChange={(e) => setActiveProfile({ ...activeProfile, levelCategory: e.target.value as any })}
                    options={[
                      { value: 'NURSERY', label: 'Early Years / Nursery / Kindergarten' },
                      { value: 'PRIMARY', label: 'Primary School (Basic 1-6)' },
                      { value: 'JSS', label: 'Junior Secondary School (JSS 1-3)' },
                      { value: 'SSS', label: 'Senior Secondary School (SSS 1-3 / WAEC)' },
                      { value: 'CUSTOM', label: 'Custom / School-Defined Level' },
                    ]}
                  />
                </div>

                <Input
                  id="profile-description"
                  label="Description / Purpose"
                  value={activeProfile.description || ''}
                  onChange={(e) => setActiveProfile({ ...activeProfile, description: e.target.value })}
                  placeholder="Notes explaining when this grading profile applies..."
                />

                <div className="flex items-center gap-4 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={activeProfile.isDefault || false}
                      onChange={(e) => setActiveProfile({ ...activeProfile, isDefault: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                    />
                    Set as School Default Profile (Fallback for all classes without specific profile)
                  </label>
                </div>
              </CardBody>
            </Card>

            {/* 2. Assessment Components (CA, Tests, Exams) */}
            <Card>
              <CardHeader 
                title="Assessment Components & Marks Breakdown" 
                subtitle="Continuous assessments, homework, projects, midterms, and terminal examinations" 
              />
              <CardBody className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="text-xs text-slate-600">
                    Calculation Mode:{' '}
                    <span className="font-bold text-slate-900">
                      {activeProfile.calculationMethod === 'SUM' ? 'Raw Sum of Components' : 'Weighted Percentage (%)'}
                    </span>
                    {' • '}
                    Total Max Score:{' '}
                    <span className="font-bold text-emerald-800">{totalMaxScore} marks</span>
                    {activeProfile.calculationMethod === 'WEIGHTED_PERCENTAGE' && (
                      <span className={`ml-2 font-bold ${Math.abs(totalWeight - 100) < 0.01 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        (Total Weight: {totalWeight}%)
                      </span>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddComponent}
                    className="text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Component
                  </Button>
                </div>

                <div className="space-y-3">
                  {activeProfile.components.map((comp, idx) => (
                    <div 
                      key={comp.id || idx}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-1">
                          <label className="text-[11px] font-semibold text-slate-600 mb-1 block">Component Name</label>
                          <input
                            type="text"
                            value={comp.name}
                            onChange={(e) => handleUpdateComponent(idx, 'name', e.target.value)}
                            placeholder="e.g. 1st CA Test"
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-slate-600 mb-1 block">Max Score (Marks)</label>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={comp.maxScore}
                            onChange={(e) => handleUpdateComponent(idx, 'maxScore', parseFloat(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-slate-600 mb-1 block">Weighting (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={comp.weight}
                            onChange={(e) => handleUpdateComponent(idx, 'weight', parseFloat(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-2 md:pt-0">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={comp.optional || false}
                            onChange={(e) => handleUpdateComponent(idx, 'optional', e.target.checked)}
                            className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300"
                          />
                          Optional
                        </label>
                        
                        <button
                          type="button"
                          onClick={() => handleRemoveComponent(idx)}
                          disabled={activeProfile.components.length <= 1}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-30 cursor-pointer"
                          title="Remove Component"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* 3. Grade Boundaries, Labels & Remarks */}
            <Card>
              <CardHeader 
                title="Grade Boundaries, Labels & Remarks" 
                subtitle="Define grade cutoffs, performance remarks, and optional grade points" 
              />
              <CardBody className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs text-slate-500">
                    Score bands must be contiguous and between 0 and 100.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddGradeBand}
                    className="text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Grade Band
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Min Score</th>
                        <th className="px-3 py-2">Max Score</th>
                        <th className="px-3 py-2">Grade Label</th>
                        <th className="px-3 py-2">Remark</th>
                        <th className="px-3 py-2">Grade Point</th>
                        <th className="px-3 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeProfile.gradeBands.map((band, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={band.min}
                              onChange={(e) => handleUpdateGradeBand(idx, 'min', parseFloat(e.target.value) || 0)}
                              className="w-16 px-2 py-1 text-xs border border-slate-300 rounded font-bold text-slate-800"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={band.max}
                              onChange={(e) => handleUpdateGradeBand(idx, 'max', parseFloat(e.target.value) || 0)}
                              className="w-16 px-2 py-1 text-xs border border-slate-300 rounded font-bold text-slate-800"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={band.grade}
                              onChange={(e) => handleUpdateGradeBand(idx, 'grade', e.target.value)}
                              placeholder="e.g. A"
                              className="w-16 px-2 py-1 text-xs border border-slate-300 rounded font-bold text-emerald-800 uppercase"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={band.remark}
                              onChange={(e) => handleUpdateGradeBand(idx, 'remark', e.target.value)}
                              placeholder="e.g. Distinction"
                              className="w-full px-2 py-1 text-xs border border-slate-300 rounded text-slate-700"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="10"
                              value={band.gradePoint !== undefined ? band.gradePoint : ''}
                              onChange={(e) => handleUpdateGradeBand(idx, 'gradePoint', e.target.value === '' ? undefined : parseFloat(e.target.value))}
                              placeholder="5.0"
                              className="w-16 px-2 py-1 text-xs border border-slate-300 rounded text-slate-800"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveGradeBand(idx)}
                              disabled={activeProfile.gradeBands.length <= 1}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded disabled:opacity-30 cursor-pointer"
                              title="Delete Band"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>

            {/* 4. Promotion Rules */}
            <Card>
              <CardHeader 
                title="Promotion & Academic Progress Rules" 
                subtitle="Automated or manual progression rules based on termly average" 
              />
              <CardBody className="space-y-4">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={activeProfile.promotionRule?.enabled || false}
                      onChange={(e) => setActiveProfile({
                        ...activeProfile,
                        promotionRule: {
                          enabled: e.target.checked,
                          minAverageScore: activeProfile.promotionRule?.minAverageScore || 50,
                          automaticVerdict: activeProfile.promotionRule?.automaticVerdict ?? true,
                          verdictPromotedLabel: activeProfile.promotionRule?.verdictPromotedLabel || 'PROMOTED TO NEXT CLASS',
                          verdictTrialLabel: activeProfile.promotionRule?.verdictTrialLabel || 'PROMOTED ON TRIAL',
                          verdictRepeatLabel: activeProfile.promotionRule?.verdictRepeatLabel || 'REPEAT CLASS',
                        }
                      })}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300"
                    />
                    Enable Automatic Promotion Determination on Report Cards
                  </label>
                </div>

                {activeProfile.promotionRule?.enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <Input
                      id="promo-min-average"
                      label="Minimum Passing Average Score (%)"
                      type="number"
                      min="1"
                      max="100"
                      value={activeProfile.promotionRule.minAverageScore}
                      onChange={(e) => setActiveProfile({
                        ...activeProfile,
                        promotionRule: {
                          ...activeProfile.promotionRule!,
                          minAverageScore: parseFloat(e.target.value) || 50,
                        }
                      })}
                    />

                    <Input
                      id="promo-verdict-promoted"
                      label="Promoted Verdict Label"
                      value={activeProfile.promotionRule.verdictPromotedLabel}
                      onChange={(e) => setActiveProfile({
                        ...activeProfile,
                        promotionRule: {
                          ...activeProfile.promotionRule!,
                          verdictPromotedLabel: e.target.value,
                        }
                      })}
                    />

                    <Input
                      id="promo-verdict-trial"
                      label="Trial Verdict Label"
                      value={activeProfile.promotionRule.verdictTrialLabel}
                      onChange={(e) => setActiveProfile({
                        ...activeProfile,
                        promotionRule: {
                          ...activeProfile.promotionRule!,
                          verdictTrialLabel: e.target.value,
                        }
                      })}
                    />

                    <Input
                      id="promo-verdict-repeat"
                      label="Repeat Verdict Label"
                      value={activeProfile.promotionRule.verdictRepeatLabel}
                      onChange={(e) => setActiveProfile({
                        ...activeProfile,
                        promotionRule: {
                          ...activeProfile.promotionRule!,
                          verdictRepeatLabel: e.target.value,
                        }
                      })}
                    />
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Settings Sidebar Column (Right 1 col) */}
          <div className="space-y-6">
            {/* Calculation & Integrity Settings */}
            <Card>
              <CardHeader title="Calculation & Rounding" subtitle="Mathematical computation engine" />
              <CardBody className="space-y-4">
                <Select
                  id="calc-method"
                  label="Calculation Method"
                  value={activeProfile.calculationMethod}
                  onChange={(e) => setActiveProfile({ ...activeProfile, calculationMethod: e.target.value as any })}
                  options={[
                    { value: 'SUM', label: 'Raw Sum of Assessment Scores' },
                    { value: 'WEIGHTED_PERCENTAGE', label: 'Weighted Percentage (Sum of Weights = 100%)' },
                  ]}
                />

                <Select
                  id="rounding-policy"
                  label="Rounding Policy"
                  value={activeProfile.roundingPolicy}
                  onChange={(e) => setActiveProfile({ ...activeProfile, roundingPolicy: e.target.value as any })}
                  options={[
                    { value: 'ROUND_HALF_UP_INTEGER', label: 'Nearest Whole Number (e.g. 74.5 -> 75)' },
                    { value: 'ROUND_HALF_UP_1DECIMAL', label: '1 Decimal Place (e.g. 74.55 -> 74.6)' },
                    { value: 'ROUND_HALF_UP_2DECIMAL', label: '2 Decimal Places (e.g. 74.555 -> 74.56)' },
                  ]}
                />

                <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="text-xs font-bold text-amber-900">Missing Scores Rule</span>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-amber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeProfile.treatMissingAsZero}
                      onChange={(e) => setActiveProfile({ ...activeProfile, treatMissingAsZero: e.target.checked })}
                      className="w-4 h-4 mt-0.5 text-amber-600 rounded border-amber-300 focus:ring-amber-500"
                    />
                    <span>
                      Automatically treat unentered/missing marks as zero.
                    </span>
                  </label>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    When unchecked (recommended), unentered marks are explicitly flagged as <strong>Incomplete (INC)</strong> to prevent premature publication.
                  </p>
                </div>
              </CardBody>
            </Card>

            {/* Report Card Visibility Toggles */}
            <Card>
              <CardHeader title="Report Card Display" subtitle="Configure which fields appear on pupil reports" />
              <CardBody className="space-y-3">
                {[
                  { key: 'showAttendance', label: 'Attendance Summary (Present / Absent)' },
                  { key: 'showPosition', label: 'Class Cohort Position / Rank' },
                  { key: 'showClassAverage', label: 'Class Overall Average' },
                  { key: 'showStudentAverage', label: 'Student Term Average' },
                  { key: 'showGradePoints', label: 'Grade Points / GPA' },
                  { key: 'showComponentBreakdown', label: 'Component Scores Breakdown (CA1, CA2, Exam)' },
                  { key: 'showPromotionStatus', label: 'Promotion Decision Badge' },
                  { key: 'showAffectiveTraits', label: 'Affective & Psychomotor Traits Table' },
                  { key: 'showTeacherRemarks', label: 'Teacher Remarks & Signature' },
                  { key: 'showPrincipalRemarks', label: 'Principal Stamp & Signature' },
                  { key: 'showNextTermDate', label: 'Next Term Resumption Date' },
                  { key: 'showOfficialSeal', label: 'Official Institutional Seal' },
                ].map((item) => (
                  <label key={item.key} className="flex items-center justify-between text-xs text-slate-700 cursor-pointer hover:bg-slate-50 p-1.5 rounded-lg">
                    <span>{item.label}</span>
                    <input
                      type="checkbox"
                      checked={(activeProfile.displaySettings as any)?.[item.key] !== false}
                      onChange={(e) => {
                        const cur = activeProfile.displaySettings || {
                          showAttendance: true,
                          showPosition: true,
                          showClassAverage: true,
                          showStudentAverage: true,
                          showGradePoints: true,
                          showComponentBreakdown: true,
                          showPromotionStatus: true,
                          showAffectiveTraits: true,
                          showTeacherRemarks: true,
                          showPrincipalRemarks: true,
                          showNextTermDate: true,
                          showOfficialSeal: true,
                        };
                        setActiveProfile({
                          ...activeProfile,
                          displaySettings: { ...cur, [item.key]: e.target.checked },
                        });
                      }}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300"
                    />
                  </label>
                ))}
              </CardBody>
            </Card>

            {/* Actions: Save & Delete */}
            <div className="space-y-3">
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 font-bold py-3 text-sm shadow-md"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save & Activate Profile
              </Button>

              {profiles.length > 1 && (
                <Button
                  variant="outline"
                  onClick={handleDelete}
                  disabled={saving}
                  className="w-full text-rose-700 border-rose-300 hover:bg-rose-50 flex items-center justify-center gap-1.5 text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete This Profile
                </Button>
              )}

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                <strong>Notice:</strong> Saved changes apply to future calculations. Previously published report cards retain an immutable snapshot of their grading standards.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
