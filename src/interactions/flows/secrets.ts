/**
 * Secrets Flow
 *
 * Unified secrets management flow for CLI.
 * This flow delegates to the CLI interactive command.
 * Not available in Telegram for security.
 *
 * @module interactions/flows/secrets
 */

import type { Flow, FlowContext } from '../types.js';

/**
 * Extended context for secrets flow
 */
export interface SecretsFlowContext extends FlowContext {
  /** Error message if any */
  error?: string;
}

/**
 * Secrets flow definition
 */
export const secretsFlow: Flow<SecretsFlowContext> = {
  id: 'secrets',
  name: 'Secrets Management',
  firstStep: 'check_platform',

  steps: {
    // ========================================================================
    // Platform Check
    // ========================================================================
    check_platform: {
      id: 'check_platform',
      interaction: () => ({
        type: 'progress',
        message: 'Loading secrets manager...',
      }),
      handle: async () => 'action:run_secrets_interactive',
    },

    // ========================================================================
    // CLI Only Message (for Telegram)
    // ========================================================================
    cli_only: {
      id: 'cli_only',
      interaction: () => ({
        type: 'display',
        message: 'Secrets management is only available in CLI for security.\n\nRun: orchestrate secrets',
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
export function isSecretsAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getSecretsAction(result: string): string {
  return result.replace('action:', '');
}
