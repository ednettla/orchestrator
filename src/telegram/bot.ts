/**
 * Telegram Bot Setup
 *
 * Main bot entry point using grammy.
 * Also starts the WebApp Express server for Mini App support.
 *
 * @module telegram/bot
 */

import { Bot } from 'grammy';
import { getGlobalStore } from '../core/global-store.js';
import { createWebAppServer, type WebAppServer } from './webapp/server.js';
import { registerAllHandlers, registerInitHandlers, registerPathsHandlers, registerCallbackHandlers } from './handlers/index.js';
import { routeCommand } from './router.js';
import { handleWizardTextInput } from './flows/project-wizard.js';
import { handlePlanWizardTextInput } from './flows/plan-wizard.js';
import { handleRequirementWizardTextInput } from './flows/requirement-wizard.js';

// Unified Interactions System
import {
  handleFlowCallback,
  handleFlowTextInput,
} from '../interactions/index.js';

let bot: Bot | null = null;
let webappServer: WebAppServer | null = null;

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

    // Check if wizard is waiting for text input
    if (!text.startsWith('/')) {
      // Check unified flow system first
      const handledByFlow = await handleFlowTextInput(ctx, text);
      if (handledByFlow) return;

      // Check project wizard first
      const handledByProjectWizard = await handleWizardTextInput(ctx, text);
      if (handledByProjectWizard) return;

      // Check requirement wizard
      const handledByRequirementWizard = await handleRequirementWizardTextInput(ctx, text);
      if (handledByRequirementWizard) return;

      // Check plan wizard
      const handledByPlanWizard = await handlePlanWizardTextInput(ctx, text);
      if (handledByPlanWizard) return;
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

  // Start WebApp server if enabled
  const webappConfig = store.getWebAppConfig();
  if (webappConfig.enabled) {
    try {
      webappServer = createWebAppServer({ port: webappConfig.port });
      await webappServer.start();
      console.log(`WebApp server started on port ${webappConfig.port}`);
    } catch (error) {
      console.error('Failed to start WebApp server:', error);
      // Continue anyway - bot can work without webapp
    }
  }

  await bot.start({
    onStart: async (botInfo) => {
      console.log(`Bot started: @${botInfo.username}`);

      // Register commands with Telegram for autocomplete menu
      try {
        await bot!.api.setMyCommands([
          { command: 'start', description: 'Welcome and getting started' },
          { command: 'help', description: 'Show all available commands' },
          { command: 'webapp', description: 'Open the Mini App' },
          { command: 'projects', description: 'List all projects' },
          { command: 'switch', description: 'Set active project' },
          { command: 'new', description: 'Create a new project' },
          { command: 'init', description: 'Initialize an existing directory' },
          { command: 'paths', description: 'Manage allowed project paths' },
          { command: 'status', description: 'Show project status' },
          { command: 'plan', description: 'Create autonomous project plan' },
          { command: 'design', description: 'Manage design system' },
          { command: 'run', description: 'Execute pending requirements' },
          { command: 'add', description: 'Add a new requirement' },
          { command: 'reqs', description: 'List all requirements' },
          { command: 'logs', description: 'View recent logs' },
          { command: 'stop', description: 'Stop running daemon' },
        ]);
        console.log('Bot commands registered with Telegram');
      } catch (error) {
        console.error('Failed to register commands:', error);
      }

      if (webappConfig.enabled && webappServer) {
        const baseUrl = webappConfig.baseUrl ?? `http://localhost:${webappConfig.port}`;
        console.log(`WebApp available at: ${baseUrl}`);

        // Set menu button to open WebApp (requires HTTPS URL)
        if (baseUrl.startsWith('https://')) {
          try {
            await bot!.api.setChatMenuButton({
              menu_button: {
                type: 'web_app',
                text: 'Open App',
                web_app: { url: baseUrl },
              },
            });
            console.log('Menu button configured for WebApp');
          } catch (error) {
            console.error('Failed to set menu button:', error);
          }
        } else {
          console.log('Menu button requires HTTPS. Set webapp_base_url to enable.');
        }
      }
    },
  });
}

/**
 * Stop the Telegram bot and WebApp server
 */
export async function stopBot(): Promise<void> {
  // Stop WebApp server first
  if (webappServer) {
    try {
      await webappServer.stop();
      webappServer = null;
      console.log('WebApp server stopped');
    } catch (error) {
      console.error('Error stopping WebApp server:', error);
    }
  }

  // Stop bot
  if (bot) {
    await bot.stop();
    bot = null;
    console.log('Telegram bot stopped');
  }
}

/**
 * Get the WebApp server instance (for use by handlers)
 */
export function getWebAppServer(): WebAppServer | null {
  return webappServer;
}
