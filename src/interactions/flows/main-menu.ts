/**
 * Main Menu Flow
 *
 * The primary navigation flow for orchestrator.
 * Single source of truth for both CLI and Telegram menus.
 *
 * @module interactions/flows/main-menu
 */

import type { Flow, FlowContext, SelectOption, ProgressHandle } from '../types.js';
import { statusCommand } from '../../cli/commands/status.js';
import { checkForUpdates, updateToLatest, getCurrentVersion } from '../../cli/updater.js';

/**
 * Extended context for main menu
 */
export interface MainMenuContext extends FlowContext {
  /** Selected action from menu */
  selectedAction?: string;
  /** Update info from check */
  updateInfo?: {
    isOutdated: boolean;
    commitsBehind: number;
    current: string;
    latest: string;
  };
}

/**
 * Build the main menu options based on current context
 */
function buildMainMenuOptions(ctx: MainMenuContext): SelectOption[] {
  const options: SelectOption[] = [];

  // Init (only if no project)
  if (!ctx.hasProject) {
    options.push({
      id: 'init',
      label: 'Start a new project',
      icon: '🚀',
      description: 'Initialize and set up a project',
    });
  }

  // Plan
  if (ctx.plan) {
    options.push({
      id: 'plan',
      label: `Manage plan (${ctx.plan.status})`,
      icon: '📋',
      description: 'View, edit, or execute your plan',
    });
  } else {
    options.push({
      id: 'plan',
      label: 'Plan a project',
      icon: '📋',
      description: 'Create autonomous plan from a goal',
    });
  }

  // Run
  const pendingCount = ctx.requirements.pending;
  options.push({
    id: 'run',
    label: pendingCount > 0 ? `Run requirements (${pendingCount} pending)` : 'Run requirements',
    icon: '▶️',
    description: 'Execute pending requirements',
  });

  // Status
  options.push({
    id: 'status',
    label: 'View status',
    icon: '📊',
    description: 'Check current progress',
  });

  // Requirements
  options.push({
    id: 'requirements',
    label: 'Manage requirements',
    icon: '📝',
    description: 'Add, list, or modify requirements',
  });

  // Daemon (only if running)
  if (ctx.daemon.running) {
    options.push({
      id: 'daemon',
      label: 'Daemon controls',
      icon: '⚙️',
      description: 'View logs, stop background process',
    });
  }

  // Config
  options.push({
    id: 'config',
    label: 'Configuration',
    icon: '🔧',
    description: 'Project and MCP settings',
  });

  // Secrets
  options.push({
    id: 'secrets',
    label: 'Secrets management',
    icon: '🔐',
    description: 'Manage environment secrets (dev/staging/prod)',
  });

  // Projects
  options.push({
    id: 'projects',
    label: 'Project registry',
    icon: '📁',
    description: 'Manage global project registry',
  });

  // Telegram
  options.push({
    id: 'telegram',
    label: 'Telegram bot',
    icon: '🤖',
    description: 'Bot control and user management',
  });

  // Update
  options.push({
    id: 'update',
    label: 'Update orchestrator',
    icon: '⬆️',
    description: `Check for updates (v${getCurrentVersion()})`,
  });

  // Exit
  options.push({
    id: 'exit',
    label: 'Exit',
    icon: '👋',
  });

  return options;
}

/**
 * Main menu flow definition
 *
 * This is the single source of truth for the main menu.
 * Both CLI and Telegram render from this definition.
 */
export const mainMenuFlow: Flow<MainMenuContext> = {
  id: 'main-menu',
  name: 'Main Menu',
  firstStep: 'menu',

  steps: {
    // ========================================================================
    // Main Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => ({
        type: 'select',
        message: 'What would you like to do?',
        options: buildMainMenuOptions(ctx),
      }),
      handle: async (response, ctx) => {
        ctx.selectedAction = response as string;

        switch (response) {
          case 'init':
            return 'flow:init'; // Navigate to init flow
          case 'plan':
            return 'flow:plan'; // Navigate to plan flow
          case 'run':
            return 'flow:run'; // Navigate to run flow
          case 'status':
            return 'show_status';
          case 'requirements':
            return 'flow:requirements'; // Navigate to requirements flow
          case 'daemon':
            return 'flow:daemon'; // Navigate to daemon flow
          case 'config':
            return 'flow:config'; // Navigate to config flow
          case 'secrets':
            return 'flow:secrets'; // Navigate to secrets flow
          case 'projects':
            return 'flow:projects'; // Navigate to projects flow
          case 'telegram':
            return 'flow:telegram'; // Navigate to telegram flow
          case 'update':
            return 'check_updates';
          case 'exit':
            return null; // Exit flow
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Status Display
    // ========================================================================
    show_status: {
      id: 'show_status',
      interaction: (ctx) => ({
        type: 'progress',
        message: 'Loading status...',
      }),
      handle: async (response, ctx) => {
        const handle = response as ProgressHandle;
        try {
          // Run the status command
          if (ctx.projectPath) {
            handle.stop(); // Stop spinner before command output
            await statusCommand({ path: ctx.projectPath, json: false });
            console.log(); // Add spacing
          } else {
            handle.stop();
            console.log('No project initialized');
          }
          return 'status_continue';
        } catch (error) {
          handle.fail(error instanceof Error ? error.message : 'Failed to load status');
          return 'menu';
        }
      },
    },

    status_continue: {
      id: 'status_continue',
      interaction: () => ({
        type: 'select',
        message: 'What next?',
        options: [
          { id: 'menu', label: 'Back to menu', icon: '←' },
          { id: 'refresh', label: 'Refresh status', icon: '🔄' },
        ],
      }),
      handle: async (response) => {
        if (response === 'refresh') {
          return 'show_status';
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Update Check
    // ========================================================================
    check_updates: {
      id: 'check_updates',
      interaction: () => ({
        type: 'progress',
        message: 'Checking for updates...',
      }),
      handle: async (response, ctx) => {
        const handle = response as ProgressHandle;
        try {
          const info = await checkForUpdates();
          ctx.updateInfo = info;

          if (info.isOutdated) {
            handle.succeed(`Updates available: ${info.commitsBehind} commits behind`);
            return 'update_available';
          }
          handle.succeed('Already up to date!');
          return 'update_current';
        } catch (error) {
          handle.fail('Failed to check for updates');
          return 'update_error';
        }
      },
    },

    update_current: {
      id: 'update_current',
      interaction: (ctx) => ({
        type: 'display',
        message: `Already up to date! Version: ${ctx.updateInfo?.current ?? 'unknown'}`,
        format: 'success',
      }),
      handle: async () => 'menu',
    },

    update_available: {
      id: 'update_available',
      interaction: (ctx) => ({
        type: 'confirm',
        message: `Updates available: ${ctx.updateInfo?.commitsBehind ?? 0} commits behind\n` +
          `Current: ${ctx.updateInfo?.current ?? 'unknown'}\n` +
          `Latest: ${ctx.updateInfo?.latest ?? 'unknown'}\n\n` +
          `Update now?`,
        confirmLabel: 'Update',
        cancelLabel: 'Later',
      }),
      handle: async (response) => {
        if (response) {
          return 'do_update';
        }
        return 'menu';
      },
    },

    do_update: {
      id: 'do_update',
      interaction: () => ({
        type: 'progress',
        message: 'Updating orchestrator...',
      }),
      handle: async (response) => {
        const handle = response as ProgressHandle;
        try {
          await updateToLatest();
          handle.succeed('Update complete!');
          return 'update_complete';
        } catch (error) {
          handle.fail(error instanceof Error ? error.message : 'Update failed');
          return 'update_error';
        }
      },
    },

    update_complete: {
      id: 'update_complete',
      interaction: () => ({
        type: 'display',
        message: 'Update complete! Restart orchestrate to use the new version.',
        format: 'success',
      }),
      handle: async () => null, // Exit to force restart
    },

    update_error: {
      id: 'update_error',
      interaction: () => ({
        type: 'display',
        message: 'Failed to check for updates. Please try again later.',
        format: 'error',
      }),
      handle: async () => 'menu',
    },
  },
};

/**
 * Get sub-flow ID from action
 *
 * When the main menu navigates to a sub-flow (e.g., 'flow:plan'),
 * this extracts the flow name.
 */
export function getSubFlowId(action: string): string | null {
  if (action.startsWith('flow:')) {
    return action.substring(5);
  }
  return null;
}
