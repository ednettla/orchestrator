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
import { registerInitHandlers, registerPathsHandlers } from './handlers/index.js';

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

  // Register callback-based handlers for init and paths
  registerInitHandlers(bot);
  registerPathsHandlers(bot);

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
