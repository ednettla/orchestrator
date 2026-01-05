/**
 * Init Handler
 *
 * Handles remote project initialization from allowed paths.
 *
 * @module telegram/handlers/init
 */

import type { Context } from 'grammy';
import { getGlobalStore } from '../../core/global-store.js';
import { getAllowedPathsManager } from '../../core/allowed-paths.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { initProjectFromApi } from '../project-bridge.js';
import { safeEditMessage } from '../utils/safe-edit.js';

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register init-related commands
 */
export function registerInitHandlers(bot: {
  command: (command: string, handler: (ctx: Context) => Promise<void>) => void;
  callbackQuery: (
    trigger: RegExp | string,
    handler: (ctx: Context) => Promise<void>
  ) => void;
}): void {
  // /init command - list allowed paths or start init
  bot.command('init', handleInitCommand);

  // Callback for path selection
  bot.callbackQuery(/^init:path:(.+)$/, handlePathSelection);

  // Callback to confirm init
  bot.callbackQuery(/^init:confirm:(.+)$/, handleInitConfirm);

  // Callback to cancel init
  bot.callbackQuery('init:cancel', handleInitCancel);
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Handle /init command - show allowed paths for initialization
 */
async function handleInitCommand(ctx: Context): Promise<void> {
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user || user.role !== 'admin') {
    await ctx.reply('❌ Only admins can initialize projects.');
    return;
  }

  const pathsManager = getAllowedPathsManager();
  const paths = pathsManager.listPaths();

  if (paths.length === 0) {
    await ctx.reply(
      '📁 *No Allowed Paths*\n\n' +
        'No project paths have been configured.\n' +
        'Add paths with: `/paths add <path>`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Check which paths already have projects
  const registry = getProjectRegistry();
  const existingProjects = new Set(
    registry.listProjects({ limit: 100 }).map((p) => p.path)
  );

  // Build inline keyboard with available paths
  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard();

  let availableCount = 0;
  for (const path of paths) {
    const isInitialized = existingProjects.has(path.path);
    if (!isInitialized) {
      const label = path.description ?? path.path.split('/').pop() ?? path.path;
      keyboard.text(`📁 ${label}`, `init:path:${path.id}`).row();
      availableCount++;
    }
  }

  if (availableCount === 0) {
    await ctx.reply(
      '✓ All allowed paths are already initialized.\n\n' +
        'Add more paths with: `/paths add <path>`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  keyboard.text('❌ Cancel', 'init:cancel');

  await ctx.reply(
    '🚀 *Initialize Project*\n\n' +
      'Select a path to initialize:\n\n' +
      '_Projects will be set up with Orchestrator._',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

/**
 * Handle path selection callback
 */
async function handlePathSelection(ctx: Context): Promise<void> {
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user || user.role !== 'admin') {
    await ctx.answerCallbackQuery({ text: 'Only admins can initialize projects' });
    return;
  }

  // Extract path ID from callback data
  const match = (ctx.callbackQuery as { data?: string })?.data?.match(/^init:path:(.+)$/);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Invalid path' });
    return;
  }

  const pathId = match[1];
  const pathsManager = getAllowedPathsManager();
  const pathInfo = pathsManager.listPaths().find((p) => p.id === pathId);

  if (!pathInfo) {
    await ctx.answerCallbackQuery({ text: 'Path not found' });
    return;
  }

  // Ask for confirmation
  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .text('✓ Initialize', `init:confirm:${pathId}`)
    .text('❌ Cancel', 'init:cancel');

  await safeEditMessage(ctx,
    '📁 *Initialize Project*\n\n' +
      `Path: \`${pathInfo.path}\`\n` +
      (pathInfo.description ? `Description: ${pathInfo.description}\n` : '') +
      '\nThis will:\n' +
      '• Create `.orchestrator/` directory\n' +
      '• Initialize project database\n' +
      '• Generate CLAUDE.md\n\n' +
      '_Proceed with initialization?_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );

  await ctx.answerCallbackQuery();
}

/**
 * Handle init confirmation
 */
async function handleInitConfirm(ctx: Context): Promise<void> {
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user || user.role !== 'admin') {
    await ctx.answerCallbackQuery({ text: 'Only admins can initialize projects' });
    return;
  }

  // Extract path ID
  const match = (ctx.callbackQuery as { data?: string })?.data?.match(/^init:confirm:(.+)$/);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Invalid path' });
    return;
  }

  const pathId = match[1];
  const pathsManager = getAllowedPathsManager();
  const pathInfo = pathsManager.listPaths().find((p) => p.id === pathId);

  if (!pathInfo) {
    await ctx.answerCallbackQuery({ text: 'Path not found' });
    return;
  }

  // Update message to show progress
  await safeEditMessage(ctx,
    '⏳ *Initializing Project*\n\n' +
      `Path: \`${pathInfo.path}\`\n\n` +
      '_Please wait..._',
    { parse_mode: 'Markdown' }
  );

  await ctx.answerCallbackQuery();

  try {
    // Run initialization
    const result = await initProjectFromApi({ path: pathInfo.path });

    if (result.success) {
      const projectName = pathInfo.path.split('/').pop() ?? 'project';
      await safeEditMessage(ctx,
        '✅ *Project Initialized!*\n\n' +
          `Path: \`${pathInfo.path}\`\n\n` +
          `You can now use \`/${projectName}\` commands:\n` +
          `• \`/${projectName} status\` - View status\n` +
          `• \`/${projectName} add "requirement"\` - Add requirement\n` +
          `• \`/${projectName} plan\` - Generate plan`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeEditMessage(ctx,
        '❌ *Initialization Failed*\n\n' +
          `Path: \`${pathInfo.path}\`\n` +
          `Error: ${result.error ?? 'Unknown error'}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await safeEditMessage(ctx,
      '❌ *Initialization Failed*\n\n' +
        `Path: \`${pathInfo.path}\`\n` +
        `Error: ${errorMsg}`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle init cancellation
 */
async function handleInitCancel(ctx: Context): Promise<void> {
  await safeEditMessage(ctx, '_Initialization cancelled._', {
    parse_mode: 'Markdown',
  });
  await ctx.answerCallbackQuery();
}
