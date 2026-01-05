/**
 * Paths Handler
 *
 * Admin commands to manage allowed project paths.
 *
 * @module telegram/handlers/paths
 */

import type { Context } from 'grammy';
import { getGlobalStore } from '../../core/global-store.js';
import { getAllowedPathsManager } from '../../core/allowed-paths.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeEditMessage } from '../utils/safe-edit.js';

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register paths-related commands
 */
export function registerPathsHandlers(bot: {
  command: (command: string, handler: (ctx: Context) => Promise<void>) => void;
  callbackQuery: (
    trigger: RegExp | string,
    handler: (ctx: Context) => Promise<void>
  ) => void;
}): void {
  // /paths command - list or manage allowed paths
  bot.command('paths', handlePathsCommand);

  // Callback for path removal
  bot.callbackQuery(/^paths:remove:(.+)$/, handlePathRemove);

  // Callback to confirm removal
  bot.callbackQuery(/^paths:confirm-remove:(.+)$/, handlePathConfirmRemove);

  // Callback to cancel
  bot.callbackQuery('paths:cancel', handlePathsCancel);
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Handle /paths command - list paths or add/remove
 */
async function handlePathsCommand(ctx: Context): Promise<void> {
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user || user.role !== 'admin') {
    await ctx.reply('Only admins can manage allowed paths.');
    return;
  }

  const text = ctx.message?.text ?? '';
  const parts = text.split(/\s+/).slice(1); // Remove /paths
  const subCommand = parts[0]?.toLowerCase();

  if (!subCommand) {
    // List paths
    await showPathsList(ctx);
    return;
  }

  if (subCommand === 'add') {
    await handlePathAdd(ctx, parts.slice(1).join(' '));
    return;
  }

  if (subCommand === 'remove') {
    const pathArg = parts.slice(1).join(' ');
    if (!pathArg) {
      await ctx.reply('Usage: `/paths remove <path or id>`', { parse_mode: 'Markdown' });
      return;
    }
    await showRemoveConfirmation(ctx, pathArg);
    return;
  }

  await ctx.reply(
    '*Paths Commands*\n\n' +
      '`/paths` - List allowed paths\n' +
      '`/paths add <path>` - Add allowed path\n' +
      '`/paths remove <path>` - Remove path',
    { parse_mode: 'Markdown' }
  );
}

/**
 * Show the list of allowed paths
 */
async function showPathsList(ctx: Context): Promise<void> {
  const pathsManager = getAllowedPathsManager();
  const paths = pathsManager.listPaths();

  if (paths.length === 0) {
    await ctx.reply(
      '*Allowed Paths*\n\n' +
        '_No paths configured._\n\n' +
        'Add paths with:\n' +
        '`/paths add /path/to/project`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Build path list
  const pathList = paths
    .map((p, i) => {
      const desc = p.description ? ` - ${p.description}` : '';
      return `${i + 1}. \`${p.path}\`${desc}`;
    })
    .join('\n');

  // Build inline keyboard for removal
  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard();

  for (const p of paths) {
    const label = p.path.split('/').pop() ?? p.path;
    keyboard.text(`Remove ${label}`, `paths:remove:${p.id}`).row();
  }

  await ctx.reply(
    '*Allowed Paths*\n\n' +
      `${pathList}\n\n` +
      '_Select to remove or use:_\n' +
      '`/paths add <path>`',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

/**
 * Handle adding a new path
 */
async function handlePathAdd(ctx: Context, pathArg: string): Promise<void> {
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user || user.role !== 'admin') {
    await ctx.reply('Only admins can add paths.');
    return;
  }

  if (!pathArg) {
    await ctx.reply('Usage: `/paths add /path/to/project`', { parse_mode: 'Markdown' });
    return;
  }

  // Parse path and optional description
  let pathValue = pathArg;
  let description: string | undefined;

  // Check for description in quotes: /paths add /path "description"
  const descMatch = pathArg.match(/"([^"]+)"/);
  if (descMatch) {
    description = descMatch[1];
    pathValue = pathArg.replace(/"[^"]+"/g, '').trim();
  }

  // Resolve to absolute path
  const absolutePath = resolve(pathValue);

  // Check if path exists
  if (!existsSync(absolutePath)) {
    await ctx.reply(
      `Path does not exist: \`${absolutePath}\`\n\n` +
        '_Create the directory first, then try again._',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Add path
  const pathsManager = getAllowedPathsManager();

  try {
    const result = pathsManager.addPath(absolutePath, user.telegramId, description);

    await ctx.reply(
      `*Path Added*\n\n` +
        `Path: \`${result.path}\`\n` +
        (description ? `Description: ${description}\n` : '') +
        `\nProjects can now be initialized here with /init`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.reply(`Failed to add path: ${msg}`);
  }
}

/**
 * Show confirmation for path removal
 */
async function showRemoveConfirmation(ctx: Context, pathArg: string): Promise<void> {
  const pathsManager = getAllowedPathsManager();
  const paths = pathsManager.listPaths();

  // Find path by id or path string
  const found = paths.find((p) => p.id === pathArg || p.path === pathArg);

  if (!found) {
    await ctx.reply(`Path not found: \`${pathArg}\``, { parse_mode: 'Markdown' });
    return;
  }

  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .text('Confirm Remove', `paths:confirm-remove:${found.id}`)
    .text('Cancel', 'paths:cancel');

  await ctx.reply(
    `*Remove Path?*\n\n` + `\`${found.path}\`\n\n` + '_This will not delete any files._',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

// ============================================================================
// Callback Handlers
// ============================================================================

/**
 * Handle path remove button click
 */
async function handlePathRemove(ctx: Context): Promise<void> {
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user || user.role !== 'admin') {
    await ctx.answerCallbackQuery({ text: 'Only admins can remove paths' });
    return;
  }

  const match = (ctx.callbackQuery as { data?: string })?.data?.match(/^paths:remove:(.+)$/);
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

  // Show confirmation
  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .text('Confirm Remove', `paths:confirm-remove:${pathId}`)
    .text('Cancel', 'paths:cancel');

  await safeEditMessage(ctx,
    `*Remove Path?*\n\n` +
      `\`${pathInfo.path}\`\n` +
      (pathInfo.description ? `${pathInfo.description}\n` : '') +
      `\n_This will not delete any files._`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );

  await ctx.answerCallbackQuery();
}

/**
 * Handle confirmed path removal
 */
async function handlePathConfirmRemove(ctx: Context): Promise<void> {
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user || user.role !== 'admin') {
    await ctx.answerCallbackQuery({ text: 'Only admins can remove paths' });
    return;
  }

  const match = (ctx.callbackQuery as { data?: string })?.data?.match(
    /^paths:confirm-remove:(.+)$/
  );
  const pathId = match?.[1];
  if (!pathId) {
    await ctx.answerCallbackQuery({ text: 'Invalid path' });
    return;
  }

  const pathsManager = getAllowedPathsManager();
  const pathInfo = pathsManager.listPaths().find((p) => p.id === pathId);

  if (!pathInfo) {
    await ctx.answerCallbackQuery({ text: 'Path already removed' });
    await safeEditMessage(ctx, '_Path already removed._', { parse_mode: 'Markdown' });
    return;
  }

  try {
    pathsManager.removePath(pathId);

    await safeEditMessage(ctx,
      `*Path Removed*\n\n` +
        `\`${pathInfo.path}\`\n\n` +
        `_Use /paths to see remaining paths._`,
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCallbackQuery({ text: 'Path removed' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.answerCallbackQuery({ text: `Failed: ${msg}` });
  }
}

/**
 * Handle cancel action
 */
async function handlePathsCancel(ctx: Context): Promise<void> {
  await safeEditMessage(ctx, '_Operation cancelled._', { parse_mode: 'Markdown' });
  await ctx.answerCallbackQuery();
}
