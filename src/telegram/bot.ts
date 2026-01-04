/**
 * Telegram Bot Setup
 *
 * Main bot entry point using grammy.
 *
 * @module telegram/bot
 */

import { Bot } from 'grammy';
import { getGlobalStore } from '../core/global-store.js';

let bot: Bot | null = null;

/**
 * Start the Telegram bot
 */
export async function startBot(): Promise<void> {
  const store = getGlobalStore();
  const config = store.getConfig();

  if (!config.botToken) {
    throw new Error('Bot token not configured. Run: orchestrate telegram setup');
  }

  bot = new Bot(config.botToken);

  // Basic error handler
  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  // Auth middleware - check if user is authorized
  bot.use(async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const user = store.getUser(telegramId);
    if (!user) {
      await ctx.reply('❌ Unauthorized. Contact admin for access.');
      return;
    }

    // Update last active timestamp
    store.touchUser(telegramId);

    await next();
  });

  // /start command
  bot.command('start', async (ctx) => {
    const user = store.getUser(ctx.from?.id ?? 0);
    await ctx.reply(
      `👋 Welcome${user ? `, ${user.displayName}` : ''}!\n\n` +
      `Use /help to see available commands.`
    );
  });

  // /help command
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📚 *Orchestrator Commands*\n\n` +
      `*Global Commands*\n` +
      `/help - Show this help\n` +
      `/projects - List all projects\n` +
      `/switch <name> - Set active project\n\n` +
      `*Project Commands*\n` +
      `/<project> status - Show project status\n` +
      `/<project> plan "goal" - Start autonomous planning\n` +
      `/<project> run - Run pending requirements\n` +
      `/<project> stop - Stop running daemon\n` +
      `/<project> logs - Show recent logs\n\n` +
      `More commands coming soon!`,
      { parse_mode: 'Markdown' }
    );
  });

  // /projects command
  bot.command('projects', async (ctx) => {
    const { getProjectRegistry } = await import('../core/project-registry.js');
    const registry = getProjectRegistry();
    const projects = registry.listProjects({ status: 'active', limit: 10 });

    if (projects.length === 0) {
      await ctx.reply('No projects found. Initialize a project with `orchestrate init`.');
      return;
    }

    const list = projects
      .map((p, i) => `${i + 1}. *${p.name}*${p.alias ? ` (${p.alias})` : ''}\n   ${p.path}`)
      .join('\n\n');

    await ctx.reply(
      `📂 *Projects*\n\n${list}`,
      { parse_mode: 'Markdown' }
    );
  });

  console.log('Starting Telegram bot...');
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot started: @${botInfo.username}`);
    },
  });
}

/**
 * Stop the Telegram bot
 */
export async function stopBot(): Promise<void> {
  if (bot) {
    await bot.stop();
    bot = null;
  }
}
