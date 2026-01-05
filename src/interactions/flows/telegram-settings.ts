/**
 * Telegram Settings Flow
 *
 * Unified telegram bot settings flow for CLI.
 * This flow delegates to the CLI interactive command.
 * NOT available in Telegram - you can't control the bot from inside the bot.
 *
 * @module interactions/flows/telegram-settings
 */

import type { Flow, FlowContext } from '../types.js';

/**
 * Extended context for telegram settings flow
 */
export interface TelegramSettingsFlowContext extends FlowContext {
  /** Error message if any */
  error?: string;
}

/**
 * Telegram settings flow definition
 */
export const telegramSettingsFlow: Flow<TelegramSettingsFlowContext> = {
  id: 'telegram-settings',
  name: 'Telegram Bot Settings',
  firstStep: 'check_platform',

  steps: {
    // ========================================================================
    // Platform Check
    // ========================================================================
    check_platform: {
      id: 'check_platform',
      interaction: () => ({
        type: 'progress',
        message: 'Loading telegram settings...',
      }),
      handle: async () => 'action:run_telegram_interactive',
    },

    // ========================================================================
    // CLI Only Message (for Telegram)
    // ========================================================================
    cli_only: {
      id: 'cli_only',
      interaction: () => ({
        type: 'display',
        message: 'Telegram bot settings cannot be accessed from within Telegram.\n\nRun: orchestrate telegram',
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
export function isTelegramSettingsAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getTelegramSettingsAction(result: string): string {
  return result.replace('action:', '');
}
