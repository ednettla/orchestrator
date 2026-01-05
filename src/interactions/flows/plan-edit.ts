/**
 * Plan Edit Flows
 *
 * Flows for editing plan requirements and questions.
 * Used by both CLI and Telegram.
 *
 * @module interactions/flows/plan-edit
 */

import type { Flow, FlowContext, SelectOption } from '../types.js';
import type { PlannedRequirement, ClarifyingQuestion } from '../../core/types.js';

/**
 * Extended context for plan edit flows
 */
export interface PlanEditContext extends FlowContext {
  /** Selected requirement index */
  selectedReqIndex?: number;
  /** Selected question index */
  selectedQuestionIndex?: number;
  /** Field being edited */
  editField?: 'title' | 'description' | 'complexity' | 'notes';
  /** New value for edited field */
  editValue?: string;
  /** Reorder: from index */
  reorderFrom?: number;
  /** Error message */
  error?: string;
}

// ============================================================================
// Edit Requirements Flow
// ============================================================================

/**
 * Build requirement selection options
 */
function buildReqSelectionOptions(ctx: PlanEditContext, excludeIndex = -1): SelectOption[] {
  const plan = ctx.plan;
  if (!plan) return [{ id: 'back', label: 'Back', icon: '←' }];

  const options: SelectOption[] = plan.requirements.map((req, i) => ({
    id: `req_${i}`,
    label: `${i + 1}. ${req.title}`,
    disabled: i === excludeIndex,
    disabledReason: 'Current position',
  }));

  options.push({ id: 'cancel', label: 'Cancel', icon: '←' });

  return options;
}

/**
 * Edit requirements flow
 */
export const planEditReqsFlow: Flow<PlanEditContext> = {
  id: 'plan-edit-reqs',
  name: 'Edit Requirements',
  firstStep: 'menu',

  steps: {
    // ========================================================================
    // Edit Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => {
        const plan = ctx.plan;
        if (!plan) {
          return {
            type: 'display',
            message: 'No active plan',
            format: 'warning',
          };
        }

        // Show current requirements
        const reqList = plan.requirements
          .map((r, i) => `${i + 1}. ${r.title}`)
          .join('\n');

        return {
          type: 'select',
          message: `Requirements:\n${reqList}\n\nWhat would you like to do?`,
          options: [
            { id: 'edit', label: 'Edit a requirement', icon: '✏️' },
            { id: 'reorder', label: 'Reorder requirements', icon: '↕️' },
            { id: 'remove', label: 'Remove a requirement', icon: '🗑️' },
            { id: 'add', label: 'Add a new requirement', icon: '➕' },
            { id: 'done', label: 'Done editing', icon: '✓' },
          ],
        };
      },
      handle: async (response) => {
        switch (response) {
          case 'edit':
            return 'select_req_edit';
          case 'reorder':
            return 'select_req_from';
          case 'remove':
            return 'select_req_remove';
          case 'add':
            return 'add_title';
          case 'done':
            return null;
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Edit Requirement
    // ========================================================================
    select_req_edit: {
      id: 'select_req_edit',
      interaction: (ctx) => ({
        type: 'select',
        message: 'Select requirement to edit:',
        options: buildReqSelectionOptions(ctx),
      }),
      handle: async (response, ctx) => {
        if (response === 'cancel') return 'menu';

        const match = (response as string).match(/^req_(\d+)$/);
        if (match?.[1]) {
          const index = parseInt(match[1], 10);
          // Bounds check to prevent array out of bounds
          if (ctx.plan && index >= 0 && index < ctx.plan.requirements.length) {
            ctx.selectedReqIndex = index;
            return 'select_field';
          }
        }
        return 'menu';
      },
    },

    select_field: {
      id: 'select_field',
      interaction: (ctx) => {
        const plan = ctx.plan;
        const idx = ctx.selectedReqIndex ?? 0;
        const req = plan?.requirements[idx];

        if (!req) {
          return {
            type: 'display',
            message: 'Requirement not found',
            format: 'error',
          };
        }

        return {
          type: 'select',
          message: `Editing: ${req.title}\n\nWhat would you like to edit?`,
          options: [
            { id: 'title', label: 'Title', description: req.title },
            { id: 'description', label: 'Description' },
            { id: 'complexity', label: 'Complexity', description: req.estimatedComplexity },
            { id: 'notes', label: 'Technical notes' },
            { id: 'cancel', label: 'Cancel', icon: '←' },
          ],
        };
      },
      handle: async (response, ctx) => {
        if (response === 'cancel') return 'menu';

        ctx.editField = response as 'title' | 'description' | 'complexity' | 'notes';

        switch (response) {
          case 'title':
            return 'edit_title';
          case 'description':
            return 'edit_description';
          case 'complexity':
            return 'edit_complexity';
          case 'notes':
            return 'edit_notes';
          default:
            return 'menu';
        }
      },
    },

    edit_title: {
      id: 'edit_title',
      interaction: (ctx) => {
        const req = ctx.plan?.requirements[ctx.selectedReqIndex ?? 0];
        return {
          type: 'input',
          message: 'New title:',
          placeholder: req?.title ?? '',
        };
      },
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') return 'menu';

        ctx.editValue = response;
        return 'action:update_req_field';
      },
    },

    edit_description: {
      id: 'edit_description',
      interaction: (ctx) => {
        const req = ctx.plan?.requirements[ctx.selectedReqIndex ?? 0];
        return {
          type: 'input',
          message: 'New description:',
          placeholder: req?.description ?? '',
          multiline: true,
        };
      },
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') return 'menu';

        ctx.editValue = response;
        return 'action:update_req_field';
      },
    },

    edit_complexity: {
      id: 'edit_complexity',
      interaction: (ctx) => {
        const req = ctx.plan?.requirements[ctx.selectedReqIndex ?? 0];
        const currentComplexity = req?.estimatedComplexity;
        return {
          type: 'select',
          message: 'Select complexity:',
          options: [
            { id: 'low', label: currentComplexity === 'low' ? 'Low (current)' : 'Low' },
            { id: 'medium', label: currentComplexity === 'medium' ? 'Medium (current)' : 'Medium' },
            { id: 'high', label: currentComplexity === 'high' ? 'High (current)' : 'High' },
          ],
        };
      },
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') return 'menu';

        ctx.editValue = response;
        return 'action:update_req_field';
      },
    },

    edit_notes: {
      id: 'edit_notes',
      interaction: (ctx) => {
        const req = ctx.plan?.requirements[ctx.selectedReqIndex ?? 0];
        const currentNotes = req?.technicalNotes?.join('\n') ?? '';
        return {
          type: 'input',
          message: 'Technical notes (one per line):',
          placeholder: currentNotes,
          multiline: true,
        };
      },
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') return 'menu';

        ctx.editValue = response;
        return 'action:update_req_field';
      },
    },

    // ========================================================================
    // Reorder Requirements
    // ========================================================================
    select_req_from: {
      id: 'select_req_from',
      interaction: (ctx) => ({
        type: 'select',
        message: 'Select requirement to move:',
        options: buildReqSelectionOptions(ctx),
      }),
      handle: async (response, ctx) => {
        if (response === 'cancel') return 'menu';

        const match = (response as string).match(/^req_(\d+)$/);
        if (match?.[1]) {
          const index = parseInt(match[1], 10);
          // Bounds check
          if (ctx.plan && index >= 0 && index < ctx.plan.requirements.length) {
            ctx.reorderFrom = index;
            return 'select_req_to';
          }
        }
        return 'menu';
      },
    },

    select_req_to: {
      id: 'select_req_to',
      interaction: (ctx) => ({
        type: 'select',
        message: 'Move to position:',
        options: buildReqSelectionOptions(ctx, ctx.reorderFrom ?? -1),
      }),
      handle: async (response, ctx) => {
        if (response === 'cancel') return 'menu';

        const match = (response as string).match(/^req_(\d+)$/);
        if (match?.[1]) {
          const index = parseInt(match[1], 10);
          // Bounds check and ensure not same as from index
          if (ctx.plan && index >= 0 && index < ctx.plan.requirements.length && index !== ctx.reorderFrom) {
            ctx.selectedReqIndex = index;
            return 'action:reorder_req';
          }
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Remove Requirement
    // ========================================================================
    select_req_remove: {
      id: 'select_req_remove',
      interaction: (ctx) => ({
        type: 'select',
        message: 'Select requirement to remove:',
        options: buildReqSelectionOptions(ctx),
      }),
      handle: async (response, ctx) => {
        if (response === 'cancel') return 'menu';

        const match = (response as string).match(/^req_(\d+)$/);
        if (match?.[1]) {
          const index = parseInt(match[1], 10);
          // Bounds check to prevent array out of bounds
          if (ctx.plan && index >= 0 && index < ctx.plan.requirements.length) {
            ctx.selectedReqIndex = index;
            return 'confirm_remove';
          }
        }
        return 'menu';
      },
    },

    confirm_remove: {
      id: 'confirm_remove',
      interaction: (ctx) => {
        const req = ctx.plan?.requirements[ctx.selectedReqIndex ?? 0];
        return {
          type: 'confirm',
          message: `Remove "${req?.title ?? 'this requirement'}"?`,
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
          destructive: true,
        };
      },
      handle: async (response) => {
        if (response) {
          return 'action:remove_req';
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Add Requirement
    // ========================================================================
    add_title: {
      id: 'add_title',
      interaction: () => ({
        type: 'input',
        message: 'Requirement title:',
        placeholder: 'Enter a title for the new requirement',
        validate: (v) => (v.length > 0 ? null : 'Title is required'),
      }),
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') return 'menu';

        // Store title temporarily
        (ctx as { _newReqTitle?: string })._newReqTitle = response;
        return 'add_description';
      },
    },

    add_description: {
      id: 'add_description',
      interaction: () => ({
        type: 'input',
        message: 'Description (optional):',
        placeholder: 'Describe what this requirement should accomplish',
      }),
      handle: async (response, ctx) => {
        (ctx as { _newReqDescription?: string })._newReqDescription = response as string ?? '';
        return 'add_complexity';
      },
    },

    add_complexity: {
      id: 'add_complexity',
      interaction: () => ({
        type: 'select',
        message: 'Estimated complexity:',
        options: [
          { id: 'low', label: 'Low' },
          { id: 'medium', label: 'Medium' },
          { id: 'high', label: 'High' },
        ],
      }),
      handle: async (response, ctx) => {
        (ctx as { _newReqComplexity?: string })._newReqComplexity = response as string ?? 'medium';
        return 'action:add_plan_req';
      },
    },

    // ========================================================================
    // Success/Error States
    // ========================================================================
    edit_success: {
      id: 'edit_success',
      interaction: () => ({
        type: 'display',
        message: 'Requirement updated successfully',
        format: 'success',
      }),
      handle: async () => 'menu',
    },

    error: {
      id: 'error',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.error ?? 'An error occurred',
        format: 'error',
      }),
      handle: async (_, ctx) => {
        delete ctx.error;
        return 'menu';
      },
    },
  },
};

// ============================================================================
// Edit Questions Flow
// ============================================================================

/**
 * Build question selection options
 */
function buildQuestionOptions(ctx: PlanEditContext): SelectOption[] {
  const plan = ctx.plan;
  if (!plan || plan.questions.length === 0) {
    return [{ id: 'back', label: 'Back', icon: '←' }];
  }

  const options: SelectOption[] = plan.questions.map((q, i) => {
    const answered = q.answer ? '✓' : '○';
    const preview = q.question.length > 40 ? q.question.substring(0, 40) + '...' : q.question;
    return {
      id: `q_${i}`,
      label: `${answered} ${i + 1}. ${preview}`,
    };
  });

  options.push({ id: 'done', label: 'Done editing', icon: '✓' });

  return options;
}

/**
 * Edit questions flow
 */
export const planEditQuestionsFlow: Flow<PlanEditContext> = {
  id: 'plan-edit-questions',
  name: 'Edit Questions',
  firstStep: 'menu',

  steps: {
    menu: {
      id: 'menu',
      interaction: (ctx) => {
        const plan = ctx.plan;
        if (!plan || plan.questions.length === 0) {
          return {
            type: 'display',
            message: 'No questions to edit',
            format: 'warning',
          };
        }

        // Show questions with answers
        const qList = plan.questions
          .map((q, i) => {
            const answered = q.answer ? '✓' : '○';
            const answerPreview = q.answer
              ? `\n   → ${q.answer.length > 40 ? q.answer.substring(0, 40) + '...' : q.answer}`
              : '';
            return `${answered} ${i + 1}. ${q.question}${answerPreview}`;
          })
          .join('\n');

        return {
          type: 'select',
          message: `Questions & Answers:\n${qList}\n\nSelect question to edit:`,
          options: buildQuestionOptions(ctx),
        };
      },
      handle: async (response, ctx) => {
        if (response === 'done') return null;

        const match = (response as string).match(/^q_(\d+)$/);
        if (match?.[1]) {
          const index = parseInt(match[1], 10);
          // Bounds check to prevent array out of bounds
          if (ctx.plan && index >= 0 && index < ctx.plan.questions.length) {
            ctx.selectedQuestionIndex = index;
            return 'show_question';
          }
        }
        return 'menu';
      },
    },

    show_question: {
      id: 'show_question',
      interaction: (ctx) => {
        const plan = ctx.plan;
        const idx = ctx.selectedQuestionIndex ?? 0;
        const question = plan?.questions[idx];

        if (!question) {
          return {
            type: 'display',
            message: 'Question not found',
            format: 'error',
          };
        }

        let message = `Question: ${question.question}`;
        if (question.context) {
          message += `\n\nContext: ${question.context}`;
        }
        if (question.suggestedOptions?.length) {
          message += `\n\nSuggested: ${question.suggestedOptions.join(', ')}`;
        }
        if (question.answer) {
          message += `\n\nCurrent answer: ${question.answer}`;
        }

        return {
          type: 'display',
          message,
          format: 'info',
        };
      },
      handle: async () => 'edit_answer',
    },

    edit_answer: {
      id: 'edit_answer',
      interaction: (ctx) => {
        const question = ctx.plan?.questions[ctx.selectedQuestionIndex ?? 0];
        return {
          type: 'input',
          message: 'Your answer:',
          placeholder: question?.answer ?? 'Enter your answer',
        };
      },
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') return 'menu';

        ctx.editValue = response;
        return 'action:update_question_answer';
      },
    },

    edit_success: {
      id: 'edit_success',
      interaction: () => ({
        type: 'display',
        message: 'Answer updated successfully',
        format: 'success',
      }),
      handle: async () => 'menu',
    },

    error: {
      id: 'error',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.error ?? 'An error occurred',
        format: 'error',
      }),
      handle: async (_, ctx) => {
        delete ctx.error;
        return 'menu';
      },
    },
  },
};
