/**
 * Projects Flow
 *
 * Unified project registry management flow for CLI.
 * This flow delegates to the CLI interactive command.
 * Not available in Telegram.
 *
 * @module interactions/flows/projects
 */

import type { Flow, FlowContext } from '../types.js';

/**
 * Extended context for projects flow
 */
export interface ProjectsFlowContext extends FlowContext {
  /** Error message if any */
  error?: string;
}

/**
 * Projects flow definition
 */
export const projectsFlow: Flow<ProjectsFlowContext> = {
  id: 'projects',
  name: 'Project Registry',
  firstStep: 'check_platform',

  steps: {
    // ========================================================================
    // Platform Check
    // ========================================================================
    check_platform: {
      id: 'check_platform',
      interaction: () => ({
        type: 'progress',
        message: 'Loading project registry...',
      }),
      handle: async () => 'action:run_projects_interactive',
    },

    // ========================================================================
    // CLI Only Message (for Telegram)
    // ========================================================================
    cli_only: {
      id: 'cli_only',
      interaction: () => ({
        type: 'display',
        message: 'Project registry is only available in CLI.\n\nRun: orchestrate projects',
        format: 'warning',
      }),
      handle: async () => null,
    },

    // ========================================================================
    // Error State
    // ========================================================================
    error: {
      id: 'error',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.error ?? 'An error occurred',
        format: 'error',
      }),
      handle: async (_, ctx) => {
        delete ctx.error;
        return null;
      },
    },
  },
};

/**
 * Check if a step result is an action marker
 */
export function isProjectsAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getProjectsAction(result: string): string {
  return result.replace('action:', '');
}
