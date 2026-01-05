/**
 * Typing Indicator Utility
 *
 * Shows "typing..." indicator while processing requests.
 *
 * @module telegram/utils/typing
 */

import type { Context } from 'grammy';

/**
 * Send typing indicator to chat
 * The indicator auto-expires after ~5 seconds
 */
export async function sendTyping(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithChatAction('typing');
  } catch {
    // Ignore errors - typing indicator is non-critical
  }
}

/**
 * Keep typing indicator alive during long operations
 * Refreshes every 4 seconds until the operation completes
 *
 * @returns cleanup function to stop the typing indicator
 */
export function keepTyping(ctx: Context): () => void {
  let active = true;

  const refresh = async () => {
    if (!active) return;
    try {
      await ctx.replyWithChatAction('typing');
    } catch {
      // Ignore errors
    }
  };

  // Send initial typing indicator
  refresh();

  // Refresh every 4 seconds (before the 5-second expiry)
  const interval = setInterval(refresh, 4000);

  // Return cleanup function
  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Execute an async operation while showing typing indicator
 * Automatically handles cleanup when operation completes
 */
export async function withTyping<T>(ctx: Context, operation: () => Promise<T>): Promise<T> {
  const stopTyping = keepTyping(ctx);
  try {
    return await operation();
  } finally {
    stopTyping();
  }
}
