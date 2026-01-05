/**
 * Safe Edit Message Utility
 *
 * Wrapper around ctx.editMessageText that handles common Telegram API errors gracefully.
 *
 * @module telegram/utils/safe-edit
 */

import type { Context } from 'grammy';

/**
 * Safely edit a message, handling common Telegram API errors gracefully.
 * Returns true if edit succeeded, false if it failed due to a non-critical error.
 */
export async function safeEditMessage(
  ctx: Context,
  text: string,
  options?: Parameters<Context['editMessageText']>[1]
): Promise<boolean> {
  try {
    await ctx.editMessageText(text, options);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Ignore "message is not modified" - content unchanged
    if (message.includes('message is not modified')) {
      return true;
    }

    // Ignore "message to edit not found" - message was deleted
    if (message.includes('message to edit not found') ||
        message.includes('MESSAGE_ID_INVALID')) {
      console.warn('[safeEditMessage] Message was deleted, cannot edit');
      return false;
    }

    // Ignore "message can't be edited" - too old or no permission
    if (message.includes("message can't be edited")) {
      console.warn('[safeEditMessage] Message cannot be edited');
      return false;
    }

    // Re-throw unexpected errors
    throw error;
  }
}
