/**
 * Init Flow
 *
 * Unified initialization flow for CLI and Telegram.
 * Handles project initialization and optional planning.
 *
 * @module interactions/flows/init
 */

import type { Flow, FlowContext } from '../types.js';

/**
 * Extended context for init flow
 */
export interface InitFlowContext extends FlowContext {
  /** Whether init was successful */
  initSuccess?: boolean;
  /** MCP servers enabled */
  mcpServers?: string[];
  /** Error message if any */
  error?: string;
}

/**
 * Init flow definition
 */
export const initFlow: Flow<InitFlowContext> = {
  id: 'init',
  name: 'Initialize Project',
  firstStep: 'init',

  steps: {
    // ========================================================================
    // Init Step
    // ========================================================================
    init: {
      id: 'init',
      interaction: () => ({
        type: 'progress',
        message: 'Initializing project...',
      }),
      handle: async () => 'action:init_project',
    },

    // ========================================================================
    // Init Complete
    // ========================================================================
    init_complete: {
      id: 'init_complete',
      interaction: (ctx) => {
        const lines: string[] = ['Project initialized successfully!'];

        if (ctx.mcpServers && ctx.mcpServers.length > 0) {
          lines.push(`MCP Servers: ${ctx.mcpServers.join(', ')}`);
        }

        return {
          type: 'display',
          message: lines.join('\n'),
          format: 'success',
        };
      },
      handle: async () => 'ask_plan',
    },

    // ========================================================================
    // Ask to Start Planning
    // ========================================================================
    ask_plan: {
      id: 'ask_plan',
      interaction: () => ({
        type: 'confirm',
        message: 'Would you like to start planning a project?',
        confirmLabel: 'Yes, start planning',
        cancelLabel: 'No, return to menu',
      }),
      handle: async (response) => {
        if (response) {
          return 'flow:plan';
        }
        return null; // Return to main menu
      },
    },

    // ========================================================================
    // Error State
    // ========================================================================
    error: {
      id: 'error',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.error ?? 'Failed to initialize project',
        format: 'error',
      }),
      handle: async (_, ctx) => {
        delete ctx.error;
        return null; // Return to main menu
      },
    },
  },
};

/**
 * Check if a step result is an action marker
 */
export function isInitAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getInitAction(result: string): string {
  return result.replace('action:', '');
}
