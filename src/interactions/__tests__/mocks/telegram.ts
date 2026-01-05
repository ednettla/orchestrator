/**
 * Mock Grammy Context for Testing
 *
 * Creates mock Telegram bot context objects for testing flows.
 *
 * @module interactions/__tests__/mocks/telegram
 */

import type { Context } from 'grammy';
import { vi } from 'vitest';

/**
 * Extended mock context with test utilities
 */
export interface MockGrammyContext extends Context {
  /** Track all reply calls */
  replies: Array<{ text: string; options?: Record<string, unknown> }>;
  /** Track callback query answers */
  callbackAnswers: Array<{ text?: string }>;
  /** Override from.id for testing */
  _telegramId?: number;
  /** Override from.username for testing */
  _username?: string;
}

/**
 * Create a mock Grammy Context for testing
 *
 * @example
 * ```typescript
 * const ctx = createMockGrammyContext({ telegramId: 12345 });
 * await someHandler(ctx);
 * expect(ctx.replies[0].text).toContain('Welcome');
 * ```
 */
export function createMockGrammyContext(options?: {
  telegramId?: number;
  username?: string;
  messageId?: number;
  callbackData?: string;
  authorizedRole?: 'admin' | 'operator' | 'viewer';
}): MockGrammyContext {
  const telegramId = options?.telegramId ?? 12345;
  const username = options?.username ?? 'testuser';
  const messageId = options?.messageId ?? 1;
  const callbackData = options?.callbackData ?? '';

  const replies: Array<{ text: string; options?: Record<string, unknown> }> = [];
  const callbackAnswers: Array<{ text?: string }> = [];

  const mockContext = {
    // Telegram user info
    from: {
      id: telegramId,
      username,
      first_name: 'Test',
      last_name: 'User',
      is_bot: false,
      language_code: 'en',
    },

    // Callback query info (for button presses)
    callbackQuery: callbackData ? {
      id: 'callback-query-id',
      data: callbackData,
      from: {
        id: telegramId,
        username,
        first_name: 'Test',
        last_name: 'User',
        is_bot: false,
      },
      chat_instance: 'chat-instance',
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: telegramId,
          type: 'private' as const,
        },
      },
    } : undefined,

    // Message info (for text messages)
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: telegramId,
        type: 'private' as const,
      },
      from: {
        id: telegramId,
        username,
        first_name: 'Test',
        is_bot: false,
      },
    },

    // Reply method
    reply: vi.fn(async (text: string, opts?: Record<string, unknown>) => {
      replies.push({ text, options: opts });
      return {
        message_id: messageId + replies.length,
        date: Math.floor(Date.now() / 1000),
        chat: { id: telegramId, type: 'private' as const },
      };
    }),

    // Answer callback query
    answerCallbackQuery: vi.fn(async (opts?: { text?: string } | string) => {
      const text = typeof opts === 'string' ? opts : opts?.text;
      callbackAnswers.push({ text });
      return true;
    }),

    // Edit message (for updating inline keyboards)
    editMessageText: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),

    // Delete message
    deleteMessage: vi.fn(async () => true),

    // Test tracking
    replies,
    callbackAnswers,
    _telegramId: telegramId,
    _username: username,

    // Authorized user (set by middleware)
    authorizedUser: options?.authorizedRole ? { role: options.authorizedRole } : undefined,
  } as unknown as MockGrammyContext;

  return mockContext;
}

/**
 * Create a context without a from user (edge case)
 */
export function createContextWithoutUser(): Context {
  return {
    from: undefined,
    reply: vi.fn(),
    answerCallbackQuery: vi.fn(),
  } as unknown as Context;
}

/**
 * Create a context with a callback query
 */
export function createCallbackContext(
  callbackData: string,
  options?: {
    telegramId?: number;
    messageId?: number;
  }
): MockGrammyContext {
  return createMockGrammyContext({
    callbackData,
    telegramId: options?.telegramId ?? 12345,
    messageId: options?.messageId ?? 1,
  });
}
