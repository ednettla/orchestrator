/**
 * Start and Help Handlers
 *
 * Handle /start, /help, and /webapp commands.
 *
 * @module telegram/handlers/start
 */

import { InlineKeyboard } from 'grammy';
import type { CommandContext, CommandResult } from '../types.js';
import { getHelpText } from './index.js';
import { getRoleEmoji } from '../security.js';
import { getGlobalStore } from '../../core/global-store.js';

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

/**
 * Handle /webapp command - opens the Mini App
 */
export async function webappHandler(_ctx: CommandContext): Promise<CommandResult> {
  const store = getGlobalStore();
  const webappConfig = store.getWebAppConfig();

  if (!webappConfig.enabled) {
    return {
      success: false,
      response: '❌ WebApp is not enabled.\n\nRun `orchestrate telegram config webapp_enabled true` on the server.',
    };
  }

  const baseUrl = webappConfig.baseUrl ?? `http://localhost:${webappConfig.port}`;

  // For HTTPS URLs, we can use the WebApp button
  if (baseUrl.startsWith('https://')) {
    const keyboard = new InlineKeyboard().webApp('🚀 Open Mini App', baseUrl);

    return {
      success: true,
      response: '📱 *Orchestrator Mini App*\n\nTap the button below to open:',
      parseMode: 'Markdown',
      keyboard,
    };
  }

  // For HTTP (local dev), just show the URL
  return {
    success: true,
    response:
      `📱 *Orchestrator Mini App*\n\n` +
      `The Mini App is running at:\n${baseUrl}\n\n` +
      `⚠️ *Note:* Telegram requires HTTPS for inline WebApp buttons.\n` +
      `Set up HTTPS with: \`orchestrate telegram setup-https\``,
    parseMode: 'Markdown',
  };
}
