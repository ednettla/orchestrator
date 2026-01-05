/**
 * Plan Flow
 *
 * Unified plan management flow for CLI and Telegram.
 * Handles plan creation, viewing, editing, and execution.
 *
 * @module interactions/flows/plan
 */

import type { Flow, FlowContext, SelectOption } from '../types.js';
import type { Plan, ClarifyingQuestion } from '../../core/types.js';

/**
 * Extended context for plan flow
 */
export interface PlanFlowContext extends FlowContext {
  /** Goal for new plan */
  planGoal?: string;
  /** Current question index */
  questionIndex?: number;
  /** Answers collected so far */
  answers?: Map<string, string>;
  /** Selected action in menu */
  selectedAction?: string;
  /** Error message if any */
  error?: string;
}

/**
 * Build plan menu options based on current plan state
 */
function buildPlanMenuOptions(ctx: PlanFlowContext): SelectOption[] {
  const options: SelectOption[] = [];
  const plan = ctx.plan;

  if (!plan) {
    // No plan - only option is to create one
    return [
      { id: 'create', label: 'Create a new plan', icon: '📋' },
      { id: 'back', label: 'Back to main menu', icon: '←' },
    ];
  }

  // View options
  options.push({ id: 'view', label: 'View full plan', icon: '📖' });
  options.push({ id: 'view_reqs', label: 'View requirements', icon: '📝' });
  options.push({
    id: 'view_questions',
    label: 'View questions & answers',
    icon: '❓',
  });

  // Edit options
  const canEdit = ['drafting', 'questioning', 'pending_approval', 'approved'].includes(plan.status);

  options.push({
    id: 'edit_reqs',
    label: 'Edit requirements',
    icon: '✏️',
    disabled: !canEdit,
    disabledReason: 'Plan is executing',
  });

  options.push({
    id: 'edit_questions',
    label: 'Edit questions',
    icon: '✏️',
    disabled: !canEdit || plan.questions.length === 0,
    disabledReason: 'Not available',
  });

  // Action options based on status
  if (plan.status === 'pending_approval') {
    options.push({
      id: 'approve',
      label: 'Approve and execute',
      icon: '✅',
      description: 'Start building the project',
    });
  } else if (plan.status === 'approved') {
    options.push({
      id: 'execute',
      label: 'Execute plan',
      icon: '▶️',
      description: 'Start building the project',
    });
  } else if (plan.status === 'drafting' || plan.status === 'questioning') {
    options.push({
      id: 'continue',
      label: 'Continue plan creation',
      icon: '▶️',
    });
  }

  // Reject option
  const canReject = !['executing', 'completed'].includes(plan.status);
  options.push({
    id: 'reject',
    label: 'Reject plan',
    icon: '❌',
    disabled: !canReject,
    disabledReason: 'Cannot reject',
  });

  options.push({ id: 'back', label: 'Back to main menu', icon: '←' });

  return options;
}

/**
 * Plan menu flow definition
 */
export const planMenuFlow: Flow<PlanFlowContext> = {
  id: 'plan-menu',
  name: 'Plan Menu',
  firstStep: 'menu',

  steps: {
    // ========================================================================
    // Main Plan Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => ({
        type: 'select',
        message: ctx.plan
          ? `Plan: ${ctx.plan.highLevelGoal}\nStatus: ${ctx.plan.status}\nRequirements: ${ctx.plan.requirements.length}`
          : 'No active plan',
        options: buildPlanMenuOptions(ctx),
      }),
      handle: async (response, ctx) => {
        ctx.selectedAction = response as string;

        switch (response) {
          case 'create':
            return 'create_goal';
          case 'view':
            return 'view_plan';
          case 'view_reqs':
            return 'view_requirements';
          case 'view_questions':
            return 'view_questions';
          case 'edit_reqs':
            return 'flow:plan-edit-reqs'; // Navigate to edit requirements flow
          case 'edit_questions':
            return 'flow:plan-edit-questions'; // Navigate to edit questions flow
          case 'approve':
            return 'confirm_approve';
          case 'execute':
            return 'confirm_execute';
          case 'continue':
            return 'action:resume_plan'; // Action marker for external handling
          case 'reject':
            return 'confirm_reject';
          case 'back':
            return null;
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Create New Plan
    // ========================================================================
    create_goal: {
      id: 'create_goal',
      interaction: (ctx) => ({
        type: 'input',
        message: `What would you like to build for ${ctx.projectName ?? 'your project'}?`,
        placeholder: 'Describe your project goal...',
        validate: (value) => (value.length > 0 ? null : 'Please describe your goal'),
      }),
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') {
          return 'menu';
        }
        ctx.planGoal = response;
        return 'action:create_plan'; // Action marker for external handling
      },
    },

    // ========================================================================
    // View Plan Details
    // ========================================================================
    view_plan: {
      id: 'view_plan',
      interaction: (ctx) => {
        if (!ctx.plan) {
          return {
            type: 'display',
            message: 'No active plan',
            format: 'warning',
          };
        }

        const lines: string[] = [
          `Goal: ${ctx.plan.highLevelGoal}`,
          `Status: ${ctx.plan.status}`,
          `Requirements: ${ctx.plan.requirements.length}`,
          `Questions: ${ctx.plan.questions.length}`,
          '',
          'Requirements:',
          ...ctx.plan.requirements.map(
            (r, i) => `  ${i + 1}. ${r.title} (${r.estimatedComplexity})`
          ),
        ];

        return {
          type: 'display',
          message: lines.join('\n'),
          format: 'info',
        };
      },
      handle: async () => 'view_plan_continue',
    },

    view_plan_continue: {
      id: 'view_plan_continue',
      interaction: () => ({
        type: 'select',
        message: 'What next?',
        options: [
          { id: 'menu', label: 'Back to plan menu', icon: '←' },
        ],
      }),
      handle: async (response) => (response === 'menu' ? 'menu' : 'menu'),
    },

    view_requirements: {
      id: 'view_requirements',
      interaction: (ctx) => {
        if (!ctx.plan) {
          return {
            type: 'display',
            message: 'No active plan',
            format: 'warning',
          };
        }

        const lines = ctx.plan.requirements.map((r, i) => {
          const deps = r.dependencies.length > 0 ? ` (depends on: ${r.dependencies.join(', ')})` : '';
          return `${i + 1}. ${r.title}\n   ${r.description}${deps}`;
        });

        return {
          type: 'display',
          message: lines.join('\n\n'),
          format: 'info',
        };
      },
      handle: async () => 'view_plan_continue',
    },

    view_questions: {
      id: 'view_questions',
      interaction: (ctx) => {
        if (!ctx.plan || ctx.plan.questions.length === 0) {
          return {
            type: 'display',
            message: 'No questions',
            format: 'warning',
          };
        }

        const lines = ctx.plan.questions.map((q, i) => {
          const answer = q.answer ?? 'Not answered';
          return `Q${i + 1}: ${q.question}\nA: ${answer}`;
        });

        return {
          type: 'display',
          message: lines.join('\n\n'),
          format: 'info',
        };
      },
      handle: async () => 'view_plan_continue',
    },

    // ========================================================================
    // Approve Plan
    // ========================================================================
    confirm_approve: {
      id: 'confirm_approve',
      interaction: (ctx) => ({
        type: 'confirm',
        message: `Approve plan and start execution?\n\nThis will begin building: ${ctx.plan?.highLevelGoal ?? 'the project'}`,
        confirmLabel: 'Approve',
        cancelLabel: 'Cancel',
      }),
      handle: async (response) => {
        if (response) {
          return 'action:approve_plan';
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Execute Plan
    // ========================================================================
    confirm_execute: {
      id: 'confirm_execute',
      interaction: () => ({
        type: 'confirm',
        message: 'Start executing the approved plan?',
        confirmLabel: 'Start',
        cancelLabel: 'Cancel',
      }),
      handle: async (response) => {
        if (response) {
          return 'action:execute_plan';
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Reject Plan
    // ========================================================================
    confirm_reject: {
      id: 'confirm_reject',
      interaction: (ctx) => ({
        type: 'confirm',
        message: `Are you sure you want to reject this plan?\n\nGoal: ${ctx.plan?.highLevelGoal ?? 'Unknown'}`,
        confirmLabel: 'Reject',
        cancelLabel: 'Cancel',
        destructive: true,
      }),
      handle: async (response) => {
        if (response) {
          return 'action:reject_plan';
        }
        return 'menu';
      },
    },
  },
};

/**
 * Plan wizard flow for answering questions
 */
export const planWizardFlow: Flow<PlanFlowContext> = {
  id: 'plan-wizard',
  name: 'Plan Wizard',
  firstStep: 'question',

  steps: {
    question: {
      id: 'question',
      interaction: (ctx) => {
        const plan = ctx.plan;
        if (!plan || !plan.questions.length) {
          return null;
        }

        const idx = ctx.questionIndex ?? 0;
        const question = plan.questions[idx];

        if (!question) {
          return null;
        }

        const options: SelectOption[] = [];

        // Add suggested options
        if (question.suggestedOptions) {
          question.suggestedOptions.forEach((opt, i) => {
            options.push({ id: `opt_${i}`, label: opt });
          });
        }

        // Add custom and skip options
        options.push({ id: 'custom', label: 'Type custom answer...', icon: '✏️' });
        options.push({ id: 'skip', label: 'Skip', icon: '⏭️' });

        return {
          type: 'select',
          message: `Question ${idx + 1}/${plan.questions.length}:\n\n${question.question}`,
          options,
        };
      },
      handle: async (response, ctx) => {
        const plan = ctx.plan;
        if (!plan) return null;

        const idx = ctx.questionIndex ?? 0;

        if (response === 'custom') {
          return 'custom_answer';
        }

        if (response === 'skip') {
          // Move to next question
          if (idx + 1 < plan.questions.length) {
            ctx.questionIndex = idx + 1;
            return 'question';
          }
          return 'questions_complete';
        }

        // Selected an option
        if (typeof response === 'string' && response.startsWith('opt_')) {
          const optIdx = parseInt(response.replace('opt_', ''), 10);
          const question = plan.questions[idx];
          const answer = question?.suggestedOptions?.[optIdx];

          if (answer) {
            ctx.answers = ctx.answers ?? new Map();
            ctx.answers.set(question!.id, answer);
          }

          // Move to next question
          if (idx + 1 < plan.questions.length) {
            ctx.questionIndex = idx + 1;
            return 'question';
          }
          return 'questions_complete';
        }

        return 'question';
      },
    },

    custom_answer: {
      id: 'custom_answer',
      interaction: (ctx) => {
        const plan = ctx.plan;
        const idx = ctx.questionIndex ?? 0;
        const question = plan?.questions[idx];

        return {
          type: 'input',
          message: question?.question ?? 'Your answer:',
          placeholder: 'Type your answer...',
        };
      },
      handle: async (response, ctx) => {
        const plan = ctx.plan;
        if (!plan) return null;

        const idx = ctx.questionIndex ?? 0;
        const question = plan.questions[idx];

        if (response && typeof response === 'string' && question) {
          ctx.answers = ctx.answers ?? new Map();
          ctx.answers.set(question.id, response);
        }

        // Move to next question
        if (idx + 1 < plan.questions.length) {
          ctx.questionIndex = idx + 1;
          return 'question';
        }
        return 'questions_complete';
      },
    },

    questions_complete: {
      id: 'questions_complete',
      interaction: () => ({
        type: 'display',
        message: 'All questions answered! Generating plan...',
        format: 'success',
      }),
      handle: async () => 'action:generate_plan',
    },
  },
};

/**
 * Check if a step result is an action marker
 */
export function isPlanAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getPlanAction(result: string): string {
  return result.replace('action:', '');
}
