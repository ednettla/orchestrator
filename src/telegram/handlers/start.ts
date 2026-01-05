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

  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .text('Open Menu', 'menu:back')
    .row()
    .text('List Projects', 'switch_project');

  const response = [
    `Welcome, *${user.displayName}*! ${roleEmoji}`,
    '',
    'I help you manage Orchestrator projects remotely.',
    '',
    '*Get Started:*',
    '`/menu` - Interactive menu with all options',
    '`/projects` - List your projects',
    '',
    '*Quick Commands:*',
    '`/plan` - Create autonomous project plan',
    '`/run` - Execute pending requirements',
    '`/status` - Check project status',
    '',
    '_Tip: Use /menu for the best experience!_',
  ].join('\n');

  return {
    success: true,
    response,
    parseMode: 'Markdown',
    keyboard,
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
