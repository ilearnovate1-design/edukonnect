# Implementation Plan: Configurable Termly Report Card & Grading System in EduKonnect

## 1. Codebase Audit Summary
- **Current Results Engine (`src/pages/results/ResultsPage.tsx`)**: Hardcoded 30% CA and 70% Exam scoring with static 70/60/50/45/40 grade bands in `formatters.ts`. Lacks custom assessment components (quizzes, projects, mid-term tests) and multi-level profiles.
- **Current Report Card (`src/components/results/ReportCardModal.tsx`)**: Displays single total with hardcoded CA/Exam columns. Good foundation for affective traits and principal remarks in `StudentEvaluation`.
- **Data Structures (`src/types/index.ts`)**: `Result` currently only has `caScore`, `examScore`, `totalScore`, `grade`, and binary `DRAFT` | `PUBLISHED` status. Needs dynamic component scores, workflow statuses (`DRAFT`, `SUBMITTED`, `APPROVED`, `PUBLISHED`), profile snapshots, and audit trail.
- **Tenant & Security Rules (`firestore.rules`)**: `results` collection currently permits teachers to write `PUBLISHED` directly. Needs permission hardening so only `ADMIN` can approve and publish, while teachers can save `DRAFT` or `SUBMITTED`. Needs a new `gradingProfiles` collection rule.
- **Multi-Tenant Integrity**: All queries and documents must strictly isolate data by `schoolId`.

---

## 2. Key Architecture & Phased Implementation

### Phase 1: Data Model & TypeScript Interfaces (`src/types/index.ts`)
- Define `AssessmentComponentConfig`: `id`, `name`, `maxScore`, `weight`, `optional`.
- Define `GradeBand`: `min`, `max`, `grade`, `remark`, `gradePoint`.
- Define `GradingProfile`:
  - `profileId`, `schoolId`, `name`, `levelCategory` (`NURSERY` | `PRIMARY` | `JSS` | `SSS` | `CUSTOM`).
  - `calculationMethod` (`SUM` | `WEIGHTED_PERCENTAGE`).
  - `treatMissingAsZero`: boolean (must be explicit).
  - `roundingPolicy` (`ROUND_HALF_UP_INTEGER` | `ROUND_HALF_UP_1DECIMAL` | `ROUND_HALF_UP_2DECIMAL`).
  - `components`: `AssessmentComponentConfig[]`.
  - `gradeBands`: `GradeBand[]`.
  - `subjectOverrides`: Record<string, string>.
  - `promotionRule`: minimum overall average, required pass subjects.
  - `displaySettings`: toggle class rank, student average, class average, grade points, promotion status.
  - `version`: number.
- Extend `Result` interface:
  - `componentScores`: `Record<string, number | null>`.
  - `gradingProfileId`: string.
  - `gradingProfileSnapshot`: frozen snapshot of rules used during calculation.
  - `status`: `'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PUBLISHED'`.
  - `submittedBy`, `submittedAt`, `approvedBy`, `approvedAt`, `publishedBy`, `publishedAt`.
  - `auditHistory`: historical log of adjustments.
  - Backward compatibility: maintain getters/fallback for legacy `caScore` and `examScore`.

### Phase 2: Central Assessment Calculation Engine (`src/services/assessmentEngine.ts`) & Unit Tests
- `validateComponentScores(scores, components)`: checks boundaries and flags out-of-range or missing scores.
- `calculateSubjectResult(scores, profile)`:
  - Handles missing marks according to `profile.treatMissingAsZero`.
  - Computes raw sum or weighted percentage.
  - Applies deterministic rounding.
  - Evaluates grade, remark, and grade points according to grade bands.
- `calculateStudentTermSummary(results, profile, classResults)`:
  - Overall student average, total marks scored, total possible.
  - Class average for each subject and cohort ranking/position.
  - Promotion eligibility evaluation.
- Comprehensive test suite (`scripts/test-assessment-engine.ts`) testing boundary conditions, rounding policies, missing values, weighted calculations, and invalid marks.

### Phase 3: School Administrator "Grading & Report Card Settings" (`src/pages/settings/GradingSettingsTab.tsx`)
- Configurable profiles for Nursery, Primary, JSS, SSS, and Custom arms.
- Dynamic editor for components (e.g. 1st CA: 10, 2nd CA: 10, Mid-term: 20, Exam: 60).
- Calculation mode toggle: Raw Sum vs Weighted Percentage.
- Grade boundary editor with live visual overlap and gap validation.
- Affective & psychomotor rating scale config.
- Report card layout and visibility toggles (rank, averages, signatures, resumption date).
- Promotion rules editor with automated and manual override choices.
- Seed editable default profiles for Nursery, Primary, JSS, and SSS.

### Phase 4: Enhanced Results Workflow (`src/pages/results/ResultsPage.tsx`)
- Session, Term, Class, Subject selection.
- Automatic or manual selection of the appropriate grading profile based on class level.
- Dynamic score input grid adapting to the active profile's configured components.
- Real-time client calculation with missing/invalid value indicators.
- CSV / Template import & export for bulk marks entry.
- 4-stage workflow:
  - Teacher: Save `DRAFT` or `SUBMIT FOR APPROVAL`.
  - Admin: Review Class Results, see validation warnings, `APPROVE & PUBLISH`.
  - Controlled edit/correction dialog for published records with audit logging.
- Class Broadsheet Summary view for teachers and administrators to review all subjects at once.

### Phase 5: High-Fidelity Report Card Output (`src/components/results/ReportCardModal.tsx`)
- Adapt report card table to display configured assessment components dynamically.
- Display student average, class average, class rank (if enabled).
- Professional print stylesheet and iframe-based PDF generation (100% A4 portrait print compatibility).
- Include school branding, student profile details, affective/psychomotor evaluation, teacher & principal remarks, and resumption date.
- Explicit indicator for incomplete results.

### Phase 6: Multi-Tenant Security Rules & Verification
- Update `firestore.rules` for `gradingProfiles` and restrict `PUBLISHED` result state writes to `ADMIN`.
- Run automated unit tests, lint checks, and production compilation (`npm run lint`, `npm run build`).
- Verify tenant isolation across all queries.
