/**
 * Run Flow
 *
 * Unified run execution flow for CLI and Telegram.
 * Handles run mode selection, concurrency, and execution.
 *
 * @module interactions/flows/run
 */

import type { Flow, FlowContext, SelectOption } from '../types.js';

/**
 * Run modes
 */
export type RunMode = 'foreground' | 'background';

/**
 * Extended context for run flow
 */
export interface RunFlowContext extends FlowContext {
  /** Selected run mode */
  runMode?: RunMode;
  /** Selected concurrency level */
  concurrency?: number;
  /** Custom concurrency value */
  customConcurrency?: number;
  /** Selected action */
  selectedAction?: string;
}

/**
 * Build run menu options based on context
 */
function buildRunMenuOptions(ctx: RunFlowContext): SelectOption[] {
  const pendingCount = ctx.requirements.pending;
  const inProgressCount = ctx.requirements.inProgress;

  const options: SelectOption[] = [];

  if (pendingCount === 0 && inProgressCount === 0) {
    options.push({
      id: 'no_pending',
      label: 'No pending requirements',
      icon: '✓',
      disabled: true,
      disabledReason: 'Add requirements first',
    });
  } else {
    if (pendingCount > 0) {
      options.push({
        id: 'run_pending',
        label: `Run ${pendingCount} pending requirement${pendingCount > 1 ? 's' : ''}`,
        icon: '▶️',
        description: 'Start execution',
      });
    }

    if (inProgressCount > 0) {
      options.push({
        id: 'status',
        label: `${inProgressCount} in progress`,
        icon: '🔄',
        description: 'View current execution',
      });
    }
  }

  // Daemon controls if running
  if (ctx.daemon.running) {
    options.push({
      id: 'view_logs',
      label: 'View daemon logs',
      icon: '📝',
    });
    options.push({
      id: 'stop_daemon',
      label: 'Stop daemon',
      icon: '⏹',
    });
  }

  options.push({ id: 'back', label: 'Back to main menu', icon: '←' });

  return options;
}

/**
 * Run flow definition
 */
export const runFlow: Flow<RunFlowContext> = {
  id: 'run',
  name: 'Run Requirements',
  firstStep: 'menu',

  steps: {
    // ========================================================================
    // Run Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => ({
        type: 'select',
        message: 'Run requirements',
        options: buildRunMenuOptions(ctx),
      }),
      handle: async (response, ctx) => {
        ctx.selectedAction = response as string;

        switch (response) {
          case 'run_pending':
            return 'select_mode';
          case 'status':
            return 'action:show_status';
          case 'view_logs':
            return 'action:view_logs';
          case 'stop_daemon':
            return 'confirm_stop';
          case 'back':
            return null;
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Select Run Mode
    // ========================================================================
    select_mode: {
      id: 'select_mode',
      interaction: () => ({
        type: 'select',
        message: 'How would you like to run?',
        options: [
          {
            id: 'foreground',
            label: 'Foreground',
            icon: '📺',
            description: 'Watch progress in real-time',
          },
          {
            id: 'background',
            label: 'Background',
            icon: '🔄',
            description: 'Run as daemon, continue working',
          },
          { id: 'back', label: 'Cancel', icon: '←' },
        ],
      }),
      handle: async (response, ctx) => {
        if (response === 'back') {
          return 'menu';
        }

        ctx.runMode = response as RunMode;
        return 'select_concurrency';
      },
    },

    // ========================================================================
    // Select Concurrency
    // ========================================================================
    select_concurrency: {
      id: 'select_concurrency',
      interaction: () => ({
        type: 'select',
        message: 'How many requirements to run in parallel?',
        options: [
          {
            id: '1',
            label: '1 (Sequential)',
            description: 'Safer, easier to debug',
          },
          {
            id: '3',
            label: '3 (Recommended)',
            description: 'Good balance of speed and stability',
          },
          {
            id: '5',
            label: '5 (Fast)',
            description: 'More parallel execution',
          },
          {
            id: 'custom',
            label: 'Custom...',
            icon: '✏️',
          },
          { id: 'back', label: 'Back', icon: '←' },
        ],
      }),
      handle: async (response, ctx) => {
        if (response === 'back') {
          return 'select_mode';
        }

        if (response === 'custom') {
          return 'custom_concurrency';
        }

        ctx.concurrency = parseInt(response as string, 10);
        return 'confirm_run';
      },
    },

    // ========================================================================
    // Custom Concurrency
    // ========================================================================
    custom_concurrency: {
      id: 'custom_concurrency',
      interaction: () => ({
        type: 'input',
        message: 'Enter concurrency level (1-10):',
        placeholder: '3',
        validate: (value) => {
          const num = parseInt(value, 10);
          if (isNaN(num) || num < 1 || num > 10) {
            return 'Please enter a number between 1 and 10';
          }
          return null;
        },
      }),
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') {
          return 'select_concurrency';
        }

        ctx.concurrency = parseInt(response, 10);
        return 'confirm_run';
      },
    },

    // ========================================================================
    // Confirm Run
    // ========================================================================
    confirm_run: {
      id: 'confirm_run',
      interaction: (ctx) => ({
        type: 'confirm',
        message: `Start execution?\n\nMode: ${ctx.runMode === 'background' ? 'Background (daemon)' : 'Foreground'}\nConcurrency: ${ctx.concurrency ?? 3}\nPending: ${ctx.requirements.pending} requirements`,
        confirmLabel: 'Start',
        cancelLabel: 'Cancel',
      }),
      handle: async (response, ctx) => {
        if (response) {
          if (ctx.runMode === 'background') {
            return 'action:start_daemon';
          }
          return 'action:run_foreground';
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Stop Daemon
    // ========================================================================
    confirm_stop: {
      id: 'confirm_stop',
      interaction: (ctx) => ({
        type: 'confirm',
        message: `Stop the running daemon?\n\nPID: ${ctx.daemon.pid ?? 'unknown'}`,
        confirmLabel: 'Stop',
        cancelLabel: 'Cancel',
        destructive: true,
      }),
      handle: async (response) => {
        if (response) {
          return 'action:stop_daemon';
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Execution Started
    // ========================================================================
    run_started: {
      id: 'run_started',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.runMode === 'background'
          ? 'Daemon started! Use "View logs" to monitor progress.'
          : 'Execution started...',
        format: 'success',
      }),
      handle: async () => 'menu',
    },
  },
};

/**
 * Check if a step result is an action marker
 */
export function isRunAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getRunAction(result: string): string {
  return result.replace('action:', '');
}
