/**
 * Telegram Bot Setup
 *
 * Main bot entry point using grammy.
 *
 * @module telegram/bot
 */

import { Bot } from 'grammy';
import { getGlobalStore } from '../core/global-store.js';
import { registerAllHandlers, registerInitHandlers, registerPathsHandlers, registerCallbackHandlers } from './handlers/index.js';
import { routeCommand } from './router.js';

// Unified Interactions System
import {
  handleFlowCallback,
  handleFlowTextInput,
} from '../interactions/index.js';

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

  // Register all command handlers
  registerAllHandlers();

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

    // Attach user to context for handlers
    (ctx as any).authorizedUser = user;

    await next();
  });

  // Handle unified flow callbacks first
  bot.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    // Try unified flow system first
    const handled = await handleFlowCallback(ctx, data);
    if (handled) return;

    // Fall through to existing handlers
    await next();
  });

  // Register callback-based handlers for inline keyboards
  registerInitHandlers(bot);
  registerPathsHandlers(bot);
  registerCallbackHandlers(bot);

  // Route all text messages through the command router
  bot.on('message:text', async (ctx) => {
    const user = (ctx as any).authorizedUser;
    if (!user) return;

    const text = ctx.message?.text;
    if (!text) return;

    // Check if unified flow system is waiting for text input
    if (!text.startsWith('/')) {
      const handledByFlow = await handleFlowTextInput(ctx, text);
      if (handledByFlow) return;
    }

    const result = await routeCommand(ctx, user);

    if (result) {
      // Skip reply if handler already sent messages
      if (result.skipReply) return;

      const options: any = {};
      if (result.parseMode) options.parse_mode = result.parseMode;
      if (result.keyboard) options.reply_markup = result.keyboard;

      await ctx.reply(result.response, options);
    }
  });

  console.log('Starting Telegram bot...');

  await bot.start({
    onStart: async (botInfo) => {
      console.log(`Bot started: @${botInfo.username}`);

      // Register commands with Telegram for autocomplete menu
      try {
        await bot!.api.setMyCommands([
          // Primary commands - most used
          { command: 'menu', description: 'Interactive menu (recommended)' },
          { command: 'start', description: 'Welcome and getting started' },
          { command: 'help', description: 'Show all available commands' },
          // Project management
          { command: 'projects', description: 'List all projects' },
          { command: 'switch', description: 'Set active project' },
          { command: 'status', description: 'Show project status' },
          // Core workflows
          { command: 'plan', description: 'Create autonomous project plan' },
          { command: 'run', description: 'Execute pending requirements' },
          { command: 'add', description: 'Add a new requirement' },
          { command: 'reqs', description: 'List all requirements' },
          // Monitoring
          { command: 'logs', description: 'View recent logs' },
          { command: 'stop', description: 'Stop running daemon' },
        ]);
        console.log('Bot commands registered with Telegram');
      } catch (error) {
        console.error('Failed to register commands:', error);
      }
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
    console.log('Telegram bot stopped');
  }
}
