/**
 * Requirements Flow
 *
 * Unified requirements management flow for CLI and Telegram.
 * Handles adding, listing, and managing requirements.
 *
 * @module interactions/flows/requirements
 */

import type { Flow, FlowContext, SelectOption } from '../types.js';

/**
 * Extended context for requirements flow
 */
export interface RequirementsFlowContext extends FlowContext {
  /** New requirement title */
  newRequirementTitle?: string;
  /** New requirement description */
  newRequirementDescription?: string;
  /** Selected action */
  selectedAction?: string;
  /** Error message if any */
  error?: string;
}

/**
 * Build requirements menu options based on context
 */
function buildRequirementsMenuOptions(ctx: RequirementsFlowContext): SelectOption[] {
  const options: SelectOption[] = [];
  const total =
    ctx.requirements.pending +
    ctx.requirements.inProgress +
    ctx.requirements.completed +
    ctx.requirements.failed;

  options.push({
    id: 'add',
    label: 'Add a new requirement',
    icon: '➕',
    description: 'Define what to build',
  });

  if (total > 0) {
    options.push({
      id: 'list',
      label: `List all requirements (${total})`,
      icon: '📋',
    });

    if (ctx.requirements.pending > 0) {
      options.push({
        id: 'run',
        label: `Run pending (${ctx.requirements.pending})`,
        icon: '▶️',
      });
    }
  }

  options.push({ id: 'back', label: 'Back to main menu', icon: '←' });

  return options;
}

/**
 * Requirements flow definition
 */
export const requirementsFlow: Flow<RequirementsFlowContext> = {
  id: 'requirements',
  name: 'Requirements Management',
  firstStep: 'menu',

  steps: {
    // ========================================================================
    // Requirements Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => ({
        type: 'select',
        message: 'Manage requirements',
        options: buildRequirementsMenuOptions(ctx),
      }),
      handle: async (response, ctx) => {
        ctx.selectedAction = response as string;

        switch (response) {
          case 'add':
            return 'add_title';
          case 'list':
            return 'action:list_requirements';
          case 'run':
            return 'flow:run'; // Navigate to run flow
          case 'back':
            return null;
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Add New Requirement
    // ========================================================================
    add_title: {
      id: 'add_title',
      interaction: () => ({
        type: 'input',
        message: 'What should be built?',
        placeholder: 'e.g., User authentication with OAuth',
        validate: (value) => (value.length > 0 ? null : 'Title is required'),
      }),
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') {
          return 'menu';
        }

        ctx.newRequirementTitle = response;
        return 'add_description';
      },
    },

    add_description: {
      id: 'add_description',
      interaction: (ctx) => ({
        type: 'input',
        message: 'Add more details (optional):',
        placeholder: 'Describe the requirement in more detail...',
        multiline: true,
      }),
      handle: async (response, ctx) => {
        if (response && typeof response === 'string') {
          ctx.newRequirementDescription = response;
        }
        return 'add_confirm';
      },
    },

    add_confirm: {
      id: 'add_confirm',
      interaction: (ctx) => ({
        type: 'confirm',
        message: `Add this requirement?\n\nTitle: ${ctx.newRequirementTitle ?? ''}\n${ctx.newRequirementDescription ? `Description: ${ctx.newRequirementDescription}` : ''}`,
        confirmLabel: 'Add',
        cancelLabel: 'Cancel',
      }),
      handle: async (response, ctx) => {
        if (response) {
          return 'action:add_requirement';
        }
        // Clear the draft
        delete ctx.newRequirementTitle;
        delete ctx.newRequirementDescription;
        return 'menu';
      },
    },

    // ========================================================================
    // After Adding
    // ========================================================================
    add_success: {
      id: 'add_success',
      interaction: () => ({
        type: 'display',
        message: 'Requirement added successfully!',
        format: 'success',
      }),
      handle: async () => 'add_next',
    },

    add_next: {
      id: 'add_next',
      interaction: (ctx) => ({
        type: 'select',
        message: 'What next?',
        options: [
          {
            id: 'add_another',
            label: 'Add another requirement',
            icon: '➕',
          },
          {
            id: 'run',
            label: `Run requirements (${ctx.requirements.pending + 1} pending)`,
            icon: '▶️',
          },
          {
            id: 'list',
            label: 'List all requirements',
            icon: '📋',
          },
          { id: 'menu', label: 'Back to menu', icon: '←' },
        ],
      }),
      handle: async (response, ctx) => {
        // Clear the draft
        delete ctx.newRequirementTitle;
        delete ctx.newRequirementDescription;

        switch (response) {
          case 'add_another':
            return 'add_title';
          case 'run':
            return 'flow:run';
          case 'list':
            return 'action:list_requirements';
          case 'menu':
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Error Handling
    // ========================================================================
    add_error: {
      id: 'add_error',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.error ?? 'Failed to add requirement',
        format: 'error',
      }),
      handle: async (_, ctx) => {
        delete ctx.error;
        return 'menu';
      },
    },
  },
};

/**
 * Check if a step result is an action marker
 */
export function isRequirementsAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getRequirementsAction(result: string): string {
  return result.replace('action:', '');
}
