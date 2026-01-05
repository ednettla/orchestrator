/**
 * Interactive Flow Types
 *
 * Type definitions for wizard-style flows in Telegram.
 *
 * @module telegram/flows/types
 */

// ============================================================================
// Tech Stack Options
// ============================================================================

export const TECH_STACK_OPTIONS = {
  frontend: [
    { id: 'react', label: 'React' },
    { id: 'vue', label: 'Vue' },
    { id: 'svelte', label: 'Svelte' },
    { id: 'nextjs', label: 'Next.js' },
    { id: 'none', label: 'None' },
  ],
  backend: [
    { id: 'node', label: 'Node.js' },
    { id: 'python', label: 'Python' },
    { id: 'go', label: 'Go' },
    { id: 'rust', label: 'Rust' },
    { id: 'none', label: 'None' },
  ],
  database: [
    { id: 'postgres', label: 'PostgreSQL' },
    { id: 'mysql', label: 'MySQL' },
    { id: 'mongodb', label: 'MongoDB' },
    { id: 'sqlite', label: 'SQLite' },
    { id: 'none', label: 'None' },
  ],
  styling: [
    { id: 'tailwind', label: 'Tailwind' },
    { id: 'css-modules', label: 'CSS Modules' },
    { id: 'styled-components', label: 'Styled Components' },
    { id: 'none', label: 'None' },
  ],
  testing: [
    { id: 'jest', label: 'Jest' },
    { id: 'vitest', label: 'Vitest' },
    { id: 'playwright', label: 'Playwright' },
    { id: 'none', label: 'None' },
  ],
} as const;

export type TechCategory = keyof typeof TECH_STACK_OPTIONS;

export const TECH_CATEGORIES: TechCategory[] = [
  'frontend',
  'backend',
  'database',
  'styling',
  'testing',
];

export const TECH_CATEGORY_LABELS: Record<TechCategory, string> = {
  frontend: 'Frontend Framework',
  backend: 'Backend Framework',
  database: 'Database',
  styling: 'Styling',
  testing: 'Testing',
};

// ============================================================================
// Cloud Services
// ============================================================================

export const CLOUD_SERVICES = [
  { id: 'github', label: 'GitHub' },
  { id: 'supabase', label: 'Supabase' },
  { id: 'vercel', label: 'Vercel' },
] as const;

export type CloudServiceId = (typeof CLOUD_SERVICES)[number]['id'];

// ============================================================================
// Wizard State
// ============================================================================

export type WizardStep =
  | 'name'
  | 'tech_frontend'
  | 'tech_backend'
  | 'tech_database'
  | 'tech_styling'
  | 'tech_testing'
  | 'cloud_services'
  | 'build_goal'
  | 'confirm';

export interface TechStackSelection {
  frontend: string[];
  backend: string[];
  database: string[];
  styling: string[];
  testing: string[];
}

export interface CloudServicesSelection {
  github: boolean;
  supabase: boolean;
  vercel: boolean;
}

export interface ProjectWizardState {
  step: WizardStep;
  projectName: string;
  techStack: TechStackSelection;
  cloudServices: CloudServicesSelection;
  buildGoal: string;
  messageId?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create initial wizard state
 */
export function createInitialWizardState(projectName?: string): ProjectWizardState {
  return {
    step: projectName ? 'tech_frontend' : 'name',
    projectName: projectName ?? '',
    techStack: {
      frontend: [],
      backend: [],
      database: [],
      styling: [],
      testing: [],
    },
    cloudServices: {
      github: false,
      supabase: false,
      vercel: false,
    },
    buildGoal: '',
  };
}

/**
 * Get the next step in the wizard flow
 */
export function getNextStep(currentStep: WizardStep): WizardStep | null {
  const steps: WizardStep[] = [
    'name',
    'tech_frontend',
    'tech_backend',
    'tech_database',
    'tech_styling',
    'tech_testing',
    'cloud_services',
    'build_goal',
    'confirm',
  ];

  const currentIndex = steps.indexOf(currentStep);
  if (currentIndex === -1 || currentIndex === steps.length - 1) {
    return null;
  }
  const nextStep = steps[currentIndex + 1];
  return nextStep ?? null;
}

/**
 * Get the previous step in the wizard flow
 */
export function getPreviousStep(currentStep: WizardStep): WizardStep | null {
  const steps: WizardStep[] = [
    'name',
    'tech_frontend',
    'tech_backend',
    'tech_database',
    'tech_styling',
    'tech_testing',
    'cloud_services',
    'build_goal',
    'confirm',
  ];

  const currentIndex = steps.indexOf(currentStep);
  if (currentIndex <= 0) {
    return null;
  }
  const prevStep = steps[currentIndex - 1];
  return prevStep ?? null;
}

/**
 * Get tech category from step name
 */
export function getTechCategoryFromStep(step: WizardStep): TechCategory | null {
  if (step.startsWith('tech_')) {
    const category = step.replace('tech_', '') as TechCategory;
    if (TECH_CATEGORIES.includes(category)) {
      return category;
    }
  }
  return null;
}

/**
 * Get step progress (current step number / total steps)
 */
export function getStepProgress(step: WizardStep): { current: number; total: number } {
  // Group steps for user-facing progress
  // 1. Name
  // 2. Tech Stack (all 5 categories)
  // 3. Cloud Services
  // 4. Build Goal
  // 5. Confirm

  if (step === 'name') return { current: 1, total: 5 };
  if (step.startsWith('tech_')) return { current: 2, total: 5 };
  if (step === 'cloud_services') return { current: 3, total: 5 };
  if (step === 'build_goal') return { current: 4, total: 5 };
  if (step === 'confirm') return { current: 5, total: 5 };

  return { current: 1, total: 5 };
}

// ============================================================================
// Plan Wizard State
// ============================================================================

export type PlanWizardStep =
  | 'goal'
  | 'generating_questions'
  | 'questions'
  | 'answering'
  | 'generating_plan'
  | 'review';

export interface PlanWizardState {
  step: PlanWizardStep;
  projectPath: string;
  projectName: string;
  planId?: string | undefined;
  goal?: string | undefined;
  currentQuestionIndex: number;
  currentQuestionId?: string | undefined;
  messageId?: number | undefined;
}

/**
 * Create initial plan wizard state
 */
export function createInitialPlanWizardState(projectName: string, projectPath: string): PlanWizardState {
  return {
    step: 'goal',
    projectPath,
    projectName,
    currentQuestionIndex: 0,
  };
}

/**
 * Question category labels for display
 */
export const QUESTION_CATEGORY_LABELS: Record<string, string> = {
  scope: 'Scope',
  technical: 'Technical',
  ux: 'UX',
  integration: 'Integration',
  priority: 'Priority',
  constraints: 'Constraints',
};

// ============================================================================
// Requirement Wizard State
// ============================================================================

export type RequirementWizardStep = 'input' | 'added';

export interface RequirementWizardState {
  step: RequirementWizardStep;
  projectPath: string;
  projectName: string;
  messageId?: number | undefined;
}

/**
 * Create initial requirement wizard state
 */
export function createInitialRequirementWizardState(
  projectName: string,
  projectPath: string
): RequirementWizardState {
  return {
    step: 'input',
    projectPath,
    projectName,
  };
}
