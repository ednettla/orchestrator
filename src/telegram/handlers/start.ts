/**
 * Start and Help Handlers
 *
 * Handle /start and /help commands.
 *
 * @module telegram/handlers/start
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getHelpText } from './index.js';
import { getRoleEmoji } from '../security.js';

/**
 * Handle /start command
 */
export async function startHandler(ctx: CommandContext): Promise<CommandResult> {
  const { user } = ctx;
  const roleEmoji = getRoleEmoji(user.role);

  const response = [
    `👋 Welcome, *${user.displayName}*!`,
    '',
    `${roleEmoji} Role: ${user.role}`,
    '',
    'I can help you manage your Orchestrator projects remotely.',
    '',
    '*Quick Start:*',
    '• `/projects` - List your projects',
    '• `/<project> status` - Check project status',
    '• `/<project> plan "goal"` - Start planning',
    '',
    'Use /help for all available commands.',
  ].join('\n');

  return {
    success: true,
    response,
    parseMode: 'Markdown',
  };
}

/**
 * Handle /help command
 */
export async function helpHandler(_ctx: CommandContext): Promise<CommandResult> {
  return {
    success: true,
    response: getHelpText(),
    parseMode: 'Markdown',
  };
}
