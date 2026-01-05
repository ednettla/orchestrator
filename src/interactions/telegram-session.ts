/**
 * Telegram Flow Session Manager
 *
 * Manages active flow sessions for Telegram users.
 * Handles session persistence and response routing.
 *
 * @module interactions/telegram-session
 */

import type { Context } from 'grammy';
import { FlowRunner } from './runner.js';
import {
  createTelegramRenderer,
  parseFlowCallback,
  isSpecialCallback,
  mapSpecialCallback,
} from './renderers/telegram.js';
import { buildFlowContext, createTelegramUser } from './context.js';
import { mainMenuFlow, getSubFlowId } from './flows/main-menu.js';
import { getFlow } from './flows/index.js';
import { executeAction, isActionMarker, getActionName } from './action-handlers.js';
import type { Flow, FlowContext } from './types.js';
import type { MainMenuContext } from './flows/main-menu.js';

import { getProjectRegistry } from '../core/project-registry.js';
import { InlineKeyboard } from 'grammy';

/**
 * Active session with its runner
 */
interface ActiveSession {
  runner: FlowRunner<FlowContext>;
  lastMessageId?: number;
  expiresAt: Date;
  waitingForText: boolean;
}

/**
 * Session manager for Telegram flows
 */
class TelegramFlowSessionManager {
  private sessions = new Map<number, ActiveSession>();
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup every 5 minutes to prevent memory leaks
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Stop the cleanup interval (for testing/shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
  }

  /**
   * Start a new flow session for a user
   */
  async startSession(
    ctx: Context,
    flow: Flow<FlowContext>,
    projectPath: string,
    role: 'admin' | 'operator' | 'viewer'
  ): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Build context
    const user = createTelegramUser(telegramId, role, ctx.from?.username);
    const context = await buildFlowContext(projectPath, user, 'telegram');

    // Create renderer
    const renderer = createTelegramRenderer({ ctx });

    // Create runner
    const runner = new FlowRunner(flow, renderer, context);

    // Store session
    this.sessions.set(telegramId, {
      runner,
      expiresAt: new Date(Date.now() + this.SESSION_TIMEOUT_MS),
      waitingForText: false,
    });

    // Run first step
    await runner.runCurrentStep();

    // Check if current step expects text input
    this.updateWaitingForText(telegramId);
  }

  /**
   * Get active session for a user
   */
  getSession(telegramId: number): ActiveSession | null {
    const session = this.sessions.get(telegramId);

    if (!session) return null;

    // Check expiration
    if (session.expiresAt < new Date()) {
      this.sessions.delete(telegramId);
      return null;
    }

    return session;
  }

  /**
   * Handle callback query from inline keyboard
   */
  async handleCallback(ctx: Context, data: string): Promise<boolean> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return false;

    const session = this.getSession(telegramId);
    if (!session) return false;

    // Parse callback data
    const { isFlowCallback, optionId } = parseFlowCallback(data);
    if (!isFlowCallback || !optionId) return false;

    // Map special callbacks
    const response = isSpecialCallback(optionId)
      ? mapSpecialCallback(optionId)
      : optionId;

    // Handle response
    const result = await session.runner.handleResponse(response);

    if (result.done) {
      // Flow complete
      this.sessions.delete(telegramId);
      await ctx.answerCallbackQuery({ text: 'Done!' });
      return true;
    }

    // Check for sub-flow navigation - step handler returns 'flow:xyz'
    // which FlowRunner sets as currentStepId
    const currentStepId = session.runner.getCurrentStepId();
    if (currentStepId.startsWith('flow:')) {
      const subFlowId = getSubFlowId(currentStepId);
      const flowContext = session.runner.getContext() as MainMenuContext;

      // End the current flow session - sub-flow takes over
      this.sessions.delete(telegramId);

      // Delegate to appropriate Telegram handler/wizard
      await this.delegateToSubFlow(ctx, subFlowId, flowContext);
      return true;
    }

    // Refresh session timeout
    session.expiresAt = new Date(Date.now() + this.SESSION_TIMEOUT_MS);

    // Update renderer context for next step
    const rendererOptions: { ctx: Context; messageId?: number } = { ctx };
    const msgId = ctx.callbackQuery?.message?.message_id;
    if (msgId !== undefined) {
      rendererOptions.messageId = msgId;
    }
    session.runner = new FlowRunner(
      mainMenuFlow,
      createTelegramRenderer(rendererOptions),
      session.runner.getContext() as MainMenuContext
    );

    // Restore current step
    // Note: This is a simplified approach - in production we'd persist the step

    // Run next step
    await session.runner.runCurrentStep();

    // Update waiting for text
    this.updateWaitingForText(telegramId);

    // Answer callback
    await ctx.answerCallbackQuery();

    return true;
  }

  /**
   * Handle text message input
   */
  async handleTextInput(ctx: Context, text: string): Promise<boolean> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return false;

    const session = this.getSession(telegramId);
    if (!session || !session.waitingForText) return false;

    // Handle response
    const result = await session.runner.handleResponse(text);

    if (result.done) {
      // Flow complete
      this.sessions.delete(telegramId);
      return true;
    }

    // Refresh session timeout
    session.expiresAt = new Date(Date.now() + this.SESSION_TIMEOUT_MS);

    // Update renderer for next step
    session.runner = new FlowRunner(
      mainMenuFlow,
      createTelegramRenderer({ ctx }),
      session.runner.getContext() as MainMenuContext
    );

    // Run next step
    await session.runner.runCurrentStep();

    // Update waiting for text
    this.updateWaitingForText(telegramId);

    return true;
  }

  /**
   * Check if current step expects text input
   */
  private updateWaitingForText(telegramId: number): void {
    const session = this.sessions.get(telegramId);
    if (!session) return;

    const step = session.runner.getCurrentStep();
    if (!step) {
      session.waitingForText = false;
      return;
    }

    const interaction = step.interaction(session.runner.getContext());
    session.waitingForText = interaction?.type === 'input';
  }

  /**
   * Delegate to a sub-flow by starting a new FlowRunner session
   */
  private async delegateToSubFlow(
    ctx: Context,
    subFlowId: string | null,
    flowContext: MainMenuContext
  ): Promise<void> {
    if (!subFlowId) {
      await ctx.answerCallbackQuery({ text: 'Unknown flow' });
      return;
    }

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Get project info from context
    const projectPath = flowContext.projectPath;
    const projectName = flowContext.projectName;

    // Answer the callback query first
    await ctx.answerCallbackQuery();

    // Check if we have a unified flow for this
    const flow = getFlow(subFlowId);

    if (flow) {
      // Require project for most flows
      if (!projectPath && !['init', 'projects'].includes(subFlowId)) {
        await ctx.reply('❌ No project selected. Use /projects to select one.');
        return;
      }

      // Start a new session with this flow
      // Safely extract and validate role from context
      const rawRole = (ctx as unknown as { authorizedUser?: { role: string } }).authorizedUser?.role;
      const validRoles = ['admin', 'operator', 'viewer'] as const;
      const role: 'admin' | 'operator' | 'viewer' = validRoles.includes(rawRole as typeof validRoles[number])
        ? (rawRole as 'admin' | 'operator' | 'viewer')
        : 'viewer';
      await this.startSession(
        ctx,
        flow,
        projectPath ?? process.cwd(),
        role
      );
      return;
    }

    // Fallback to simple messages for flows without unified definitions
    switch (subFlowId) {
      case 'init': {
        const keyboard = new InlineKeyboard()
          .text('📂 Use /init <path>', 'noop')
          .row()
          .text('◀️ Back to Menu', 'flow:__back__');

        await ctx.reply(
          '🚀 *Initialize a Project*\n\n' +
            'Use the `/init` command with a path:\n' +
            '`/init /path/to/project`\n\n' +
            'Or use `/new <name>` to create a new project.',
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        break;
      }

      case 'secrets': {
        const keyboard = new InlineKeyboard()
          .text('◀️ Back to Menu', 'flow:__back__');

        await ctx.reply(
          `🔐 *Secrets Management*\n\n` +
            `Use CLI for secrets management:\n` +
            `\`orchestrate secrets\``,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        break;
      }

      case 'projects': {
        const registry = getProjectRegistry();
        const projects = registry.listProjects();

        if (projects.length === 0) {
          await ctx.reply(
            `📁 *No Projects*\n\n` +
              `Use \`/new <name>\` to create a project.`,
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const projectList = projects
          .slice(0, 10)
          .map((p) => `• ${p.name}${p.alias ? ` (${p.alias})` : ''}`)
          .join('\n');

        const keyboard = new InlineKeyboard()
          .text('◀️ Back to Menu', 'flow:__back__');

        await ctx.reply(
          `📁 *Projects* (${projects.length})\n\n` +
            `${projectList}` +
            (projects.length > 10 ? `\n_...and ${projects.length - 10} more_` : '') +
            `\n\nUse \`/switch <project>\` to change active project.`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        break;
      }

      case 'telegram': {
        const keyboard = new InlineKeyboard()
          .text('◀️ Back to Menu', 'flow:__back__');

        await ctx.reply(
          `🤖 *Telegram Bot*\n\n` +
            `Use CLI for bot management:\n` +
            `\`orchestrate telegram\``,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        break;
      }

      default: {
        await ctx.reply(
          `⚠️ Flow not yet implemented: \`${subFlowId}\`\n\n` +
            `Use the CLI for this feature.`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  }

  /**
   * End a session
   */
  endSession(telegramId: number): void {
    this.sessions.delete(telegramId);
  }

  /**
   * Check if user has active session
   */
  hasSession(telegramId: number): boolean {
    return this.getSession(telegramId) !== null;
  }

  /**
   * Cleanup expired sessions
   */
  cleanup(): void {
    const now = new Date();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
      }
    }
  }
}

/**
 * Singleton instance
 */
export const telegramFlowSessions = new TelegramFlowSessionManager();

/**
 * Start the main menu flow for a user
 */
export async function startMainMenuFlow(
  ctx: Context,
  projectPath: string,
  role: 'admin' | 'operator' | 'viewer'
): Promise<void> {
  await telegramFlowSessions.startSession(ctx, mainMenuFlow, projectPath, role);
}

/**
 * Handle flow callback query
 *
 * @returns true if handled, false if not a flow callback
 */
export async function handleFlowCallback(ctx: Context, data: string): Promise<boolean> {
  return telegramFlowSessions.handleCallback(ctx, data);
}

/**
 * Handle flow text input
 *
 * @returns true if handled by a flow, false otherwise
 */
export async function handleFlowTextInput(ctx: Context, text: string): Promise<boolean> {
  return telegramFlowSessions.handleTextInput(ctx, text);
}
