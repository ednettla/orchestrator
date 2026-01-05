/**
 * Telegram Renderer
 *
 * Renders interactions using Grammy InlineKeyboard and typing indicator.
 * Maps interaction primitives to Telegram-specific implementations.
 *
 * Unlike the CLI renderer, Telegram is asynchronous:
 * - select/input/confirm render a message and return null
 * - The actual response comes via callback_query or message handlers
 * - The FlowRunner handles this via session persistence
 *
 * @module interactions/renderers/telegram
 */

import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type {
  Renderer,
  SelectInteraction,
  InputInteraction,
  ConfirmInteraction,
  ProgressInteraction,
  DisplayInteraction,
  ProgressHandle,
} from '../types.js';

/**
 * Options for creating a Telegram renderer
 */
export interface TelegramRendererOptions {
  /** Grammy context */
  ctx: Context;
  /** Message ID to edit (for inline updates) */
  messageId?: number;
  /** Callback data prefix for this flow */
  callbackPrefix?: string;
}

/**
 * Create a Telegram renderer for a specific context
 *
 * @param options - Renderer options
 * @returns Renderer implementation
 */
export function createTelegramRenderer(options: TelegramRendererOptions): Renderer {
  const { ctx, messageId, callbackPrefix = 'flow' } = options;

  return {
    /**
     * Render select interaction as InlineKeyboard
     * Returns null - response comes via callback
     */
    async select(interaction: SelectInteraction): Promise<string | null> {
      const keyboard = new InlineKeyboard();

      for (const opt of interaction.options) {
        if (opt.disabled) {
          // Show disabled options with strikethrough or dimmed
          continue;
        }

        const label = opt.icon ? `${opt.icon} ${opt.label}` : opt.label;
        const callbackData = `${callbackPrefix}:${opt.id}`;

        keyboard.text(label, callbackData).row();
      }

      const text = formatMessage(interaction.message);

      if (messageId) {
        await editOrReply(ctx, messageId, text, keyboard);
      } else {
        await ctx.reply(text, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        });
      }

      // Response comes via callback_query
      return null;
    },

    /**
     * Render input interaction
     * Sends a prompt message, response comes via text message
     */
    async input(interaction: InputInteraction): Promise<string | null> {
      let text = formatMessage(interaction.message);

      if (interaction.placeholder) {
        text += `\n\n<i>Example: ${escapeHtml(interaction.placeholder)}</i>`;
      }

      if (interaction.multiline) {
        text += '\n\n<i>Send your response (multiple lines supported)</i>';
      } else {
        text += '\n\n<i>Send your response:</i>';
      }

      // Add cancel button
      const keyboard = new InlineKeyboard().text('❌ Cancel', `${callbackPrefix}:__cancel__`);

      await ctx.reply(text, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });

      // Response comes via message
      return null;
    },

    /**
     * Render confirm interaction as two-button keyboard
     */
    async confirm(interaction: ConfirmInteraction): Promise<boolean> {
      const keyboard = new InlineKeyboard()
        .text(interaction.confirmLabel ?? '✅ Yes', `${callbackPrefix}:__confirm__`)
        .text(interaction.cancelLabel ?? '❌ No', `${callbackPrefix}:__cancel__`);

      const text = interaction.destructive
        ? `⚠️ <b>Warning:</b> ${formatMessage(interaction.message)}`
        : formatMessage(interaction.message);

      if (messageId) {
        await editOrReply(ctx, messageId, text, keyboard);
      } else {
        await ctx.reply(text, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        });
      }

      // Response comes via callback_query
      return false;
    },

    /**
     * Start a typing indicator
     */
    progress(interaction: ProgressInteraction): ProgressHandle {
      let active = true;
      let intervalId: NodeJS.Timeout | null = null;

      // Send initial typing indicator
      const sendTyping = async () => {
        if (!active) return;
        try {
          await ctx.replyWithChatAction('typing');
        } catch {
          // Ignore errors - typing indicator is non-critical
        }
      };

      sendTyping();

      // Refresh every 4 seconds
      intervalId = setInterval(sendTyping, 4000);

      const stop = () => {
        active = false;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };

      return {
        update(_message: string): void {
          // Telegram typing indicator doesn't support custom messages
          // We just keep the typing indicator alive
          sendTyping();
        },

        async succeed(message?: string): Promise<void> {
          stop();
          const text = `✅ ${message ?? interaction.message}`;
          await ctx.reply(text, { parse_mode: 'HTML' });
        },

        async fail(message?: string): Promise<void> {
          stop();
          const text = `❌ ${message ?? interaction.message}`;
          await ctx.reply(text, { parse_mode: 'HTML' });
        },

        stop,
      };
    },

    /**
     * Display a message
     */
    async display(interaction: DisplayInteraction): Promise<void> {
      const emojiMap = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌',
      };

      const emoji = emojiMap[interaction.format ?? 'info'];
      const text = `${emoji} ${formatMessage(interaction.message)}`;

      await ctx.reply(text, { parse_mode: 'HTML' });
    },
  };
}

/**
 * Edit existing message or send new one
 */
async function editOrReply(
  ctx: Context,
  messageId: number,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  try {
    await ctx.api.editMessageText(ctx.chat!.id, messageId, text, {
      reply_markup: keyboard,
      parse_mode: 'HTML',
    });
  } catch {
    // If edit fails, send new message
    await ctx.reply(text, {
      reply_markup: keyboard,
      parse_mode: 'HTML',
    });
  }
}

/**
 * Format message for Telegram (escape HTML, handle newlines)
 */
function formatMessage(message: string): string {
  return escapeHtml(message);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Parse flow callback data
 *
 * Callback data format: "flow:optionId" or "flow:__special__"
 */
export function parseFlowCallback(
  data: string,
  prefix = 'flow'
): { isFlowCallback: boolean; optionId: string | null } {
  if (!data.startsWith(`${prefix}:`)) {
    return { isFlowCallback: false, optionId: null };
  }

  const optionId = data.substring(prefix.length + 1);
  return { isFlowCallback: true, optionId };
}

/**
 * Special callback IDs
 */
export const FlowCallbackIds = {
  CONFIRM: '__confirm__',
  CANCEL: '__cancel__',
  BACK: '__back__',
} as const;

/**
 * Check if callback is a special flow action
 */
export function isSpecialCallback(optionId: string): boolean {
  return optionId.startsWith('__') && optionId.endsWith('__');
}

/**
 * Map special callback to response value
 */
export function mapSpecialCallback(optionId: string): unknown {
  switch (optionId) {
    case FlowCallbackIds.CONFIRM:
      return true;
    case FlowCallbackIds.CANCEL:
      return null;
    case FlowCallbackIds.BACK:
      return 'back';
    default:
      return optionId;
  }
}
