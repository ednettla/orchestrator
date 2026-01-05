/**
 * Telegram Renderer Tests
 *
 * Tests for the Telegram renderer implementation.
 *
 * @module interactions/__tests__/renderers/telegram.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createTelegramRenderer,
  parseFlowCallback,
  isSpecialCallback,
  mapSpecialCallback,
  FlowCallbackIds,
} from '../../renderers/telegram.js';
import { createMockGrammyContext } from '../mocks/telegram.js';
import type { Renderer } from '../../types.js';

describe('createTelegramRenderer', () => {
  let ctx: ReturnType<typeof createMockGrammyContext>;
  let renderer: Renderer;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createMockGrammyContext({ telegramId: 12345 });
    renderer = createTelegramRenderer({ ctx });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('select', () => {
    it('renders options as inline keyboard', async () => {
      const result = await renderer.select({
        message: 'Choose an option:',
        options: [
          { id: 'opt1', label: 'Option 1' },
          { id: 'opt2', label: 'Option 2' },
        ],
      });

      expect(result).toBeNull(); // Response comes via callback
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Choose an option:'),
        expect.objectContaining({
          reply_markup: expect.anything(),
          parse_mode: 'HTML',
        })
      );
    });

    it('includes icons in button labels', async () => {
      await renderer.select({
        message: 'Choose:',
        options: [{ id: 'save', label: 'Save', icon: '💾' }],
      });

      // The keyboard is passed to reply - we check it was called
      expect(ctx.reply).toHaveBeenCalled();
    });

    it('skips disabled options', async () => {
      await renderer.select({
        message: 'Choose:',
        options: [
          { id: 'opt1', label: 'Enabled' },
          { id: 'opt2', label: 'Disabled', disabled: true },
        ],
      });

      // Should still call reply, just without the disabled option in keyboard
      expect(ctx.reply).toHaveBeenCalled();
    });

    it('uses callback prefix in button data', async () => {
      const customRenderer = createTelegramRenderer({
        ctx,
        callbackPrefix: 'custom',
      });

      await customRenderer.select({
        message: 'Choose:',
        options: [{ id: 'test', label: 'Test' }],
      });

      expect(ctx.reply).toHaveBeenCalled();
    });

    it('edits message if messageId is provided', async () => {
      const mockApi = {
        editMessageText: vi.fn().mockResolvedValue(true),
      };
      ctx.api = mockApi as unknown as typeof ctx.api;
      ctx.chat = { id: 12345, type: 'private' } as typeof ctx.chat;

      const editorRenderer = createTelegramRenderer({
        ctx,
        messageId: 100,
      });

      await editorRenderer.select({
        message: 'Updated message',
        options: [{ id: 'opt', label: 'Option' }],
      });

      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        12345,
        100,
        expect.stringContaining('Updated message'),
        expect.objectContaining({
          reply_markup: expect.anything(),
          parse_mode: 'HTML',
        })
      );
    });

    it('falls back to reply if edit fails', async () => {
      const mockApi = {
        editMessageText: vi.fn().mockRejectedValue(new Error('Edit failed')),
      };
      ctx.api = mockApi as unknown as typeof ctx.api;
      ctx.chat = { id: 12345, type: 'private' } as typeof ctx.chat;

      const editorRenderer = createTelegramRenderer({
        ctx,
        messageId: 100,
      });

      await editorRenderer.select({
        message: 'Fallback message',
        options: [{ id: 'opt', label: 'Option' }],
      });

      expect(ctx.reply).toHaveBeenCalled();
    });

    it('escapes HTML characters in message', async () => {
      await renderer.select({
        message: '<script>alert("xss")</script>',
        options: [{ id: 'opt', label: 'Option' }],
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('&lt;script&gt;'),
        expect.anything()
      );
    });
  });

  describe('input', () => {
    it('renders input prompt with placeholder', async () => {
      const result = await renderer.input({
        message: 'Enter your name:',
        placeholder: 'John Doe',
      });

      expect(result).toBeNull();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Enter your name:'),
        expect.anything()
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Example: John Doe'),
        expect.anything()
      );
    });

    it('shows multiline hint', async () => {
      await renderer.input({
        message: 'Enter description:',
        multiline: true,
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('multiple lines supported'),
        expect.anything()
      );
    });

    it('shows single line prompt by default', async () => {
      await renderer.input({
        message: 'Enter value:',
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Send your response:'),
        expect.anything()
      );
    });

    it('includes cancel button', async () => {
      await renderer.input({
        message: 'Enter value:',
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          reply_markup: expect.anything(),
        })
      );
    });
  });

  describe('confirm', () => {
    it('renders confirm dialog with two buttons', async () => {
      const result = await renderer.confirm({
        message: 'Are you sure?',
      });

      expect(result).toBe(false); // Response comes via callback
      expect(ctx.reply).toHaveBeenCalled();
    });

    it('uses custom button labels', async () => {
      await renderer.confirm({
        message: 'Delete file?',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep',
      });

      expect(ctx.reply).toHaveBeenCalled();
    });

    it('shows warning for destructive actions', async () => {
      await renderer.confirm({
        message: 'This will delete everything.',
        destructive: true,
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Warning'),
        expect.anything()
      );
    });

    it('edits message if messageId is provided', async () => {
      const mockApi = {
        editMessageText: vi.fn().mockResolvedValue(true),
      };
      ctx.api = mockApi as unknown as typeof ctx.api;
      ctx.chat = { id: 12345, type: 'private' } as typeof ctx.chat;

      const editorRenderer = createTelegramRenderer({
        ctx,
        messageId: 100,
      });

      await editorRenderer.confirm({
        message: 'Confirm?',
      });

      expect(mockApi.editMessageText).toHaveBeenCalled();
    });
  });

  describe('progress', () => {
    it('returns a progress handle', () => {
      const handle = renderer.progress({
        message: 'Loading...',
      });

      expect(handle).toBeDefined();
      expect(typeof handle.update).toBe('function');
      expect(typeof handle.succeed).toBe('function');
      expect(typeof handle.fail).toBe('function');
      expect(typeof handle.stop).toBe('function');
    });

    it('sends typing indicator immediately', async () => {
      ctx.replyWithChatAction = vi.fn().mockResolvedValue(true);

      renderer.progress({
        message: 'Processing...',
      });

      // Allow async operations to complete
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.replyWithChatAction).toHaveBeenCalledWith('typing');
    });

    it('refreshes typing indicator every 4 seconds', async () => {
      ctx.replyWithChatAction = vi.fn().mockResolvedValue(true);

      const handle = renderer.progress({
        message: 'Processing...',
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.replyWithChatAction).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4000);
      expect(ctx.replyWithChatAction).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(4000);
      expect(ctx.replyWithChatAction).toHaveBeenCalledTimes(3);

      handle.stop();
    });

    it('stops typing on stop()', async () => {
      ctx.replyWithChatAction = vi.fn().mockResolvedValue(true);

      const handle = renderer.progress({
        message: 'Processing...',
      });

      await vi.advanceTimersByTimeAsync(0);
      handle.stop();

      const callsBefore = (ctx.replyWithChatAction as ReturnType<typeof vi.fn>).mock.calls.length;

      await vi.advanceTimersByTimeAsync(4000);

      // Should not have made new calls
      expect(ctx.replyWithChatAction).toHaveBeenCalledTimes(callsBefore);
    });

    it('sends success message on succeed()', async () => {
      ctx.replyWithChatAction = vi.fn().mockResolvedValue(true);

      const handle = renderer.progress({
        message: 'Processing...',
      });

      await handle.succeed('Done!');

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Done!'),
        expect.anything()
      );
    });

    it('uses default message if succeed called without argument', async () => {
      ctx.replyWithChatAction = vi.fn().mockResolvedValue(true);

      const handle = renderer.progress({
        message: 'Processing...',
      });

      await handle.succeed();

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Processing...'),
        expect.anything()
      );
    });

    it('sends fail message on fail()', async () => {
      ctx.replyWithChatAction = vi.fn().mockResolvedValue(true);

      const handle = renderer.progress({
        message: 'Processing...',
      });

      await handle.fail('Error occurred');

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Error occurred'),
        expect.anything()
      );
    });

    it('update triggers typing indicator', async () => {
      ctx.replyWithChatAction = vi.fn().mockResolvedValue(true);

      const handle = renderer.progress({
        message: 'Loading...',
      });

      await vi.advanceTimersByTimeAsync(0);
      const callsBefore = (ctx.replyWithChatAction as ReturnType<typeof vi.fn>).mock.calls.length;

      handle.update('Still loading...');
      await vi.advanceTimersByTimeAsync(0);

      expect((ctx.replyWithChatAction as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);

      handle.stop();
    });

    it('ignores errors from typing indicator', async () => {
      ctx.replyWithChatAction = vi.fn().mockRejectedValue(new Error('Network error'));

      // Should not throw
      const handle = renderer.progress({
        message: 'Loading...',
      });

      await vi.advanceTimersByTimeAsync(0);

      handle.stop();
    });
  });

  describe('display', () => {
    it('displays info message with emoji', async () => {
      await renderer.display({
        message: 'Info message',
        format: 'info',
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('ℹ️'),
        expect.anything()
      );
    });

    it('displays success message with emoji', async () => {
      await renderer.display({
        message: 'Success!',
        format: 'success',
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅'),
        expect.anything()
      );
    });

    it('displays warning message with emoji', async () => {
      await renderer.display({
        message: 'Warning!',
        format: 'warning',
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('⚠️'),
        expect.anything()
      );
    });

    it('displays error message with emoji', async () => {
      await renderer.display({
        message: 'Error occurred',
        format: 'error',
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('❌'),
        expect.anything()
      );
    });

    it('defaults to info format', async () => {
      await renderer.display({
        message: 'Default message',
      });

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('ℹ️'),
        expect.anything()
      );
    });
  });
});

describe('parseFlowCallback', () => {
  it('parses valid flow callback', () => {
    const result = parseFlowCallback('flow:option1');

    expect(result.isFlowCallback).toBe(true);
    expect(result.optionId).toBe('option1');
  });

  it('parses callback with custom prefix', () => {
    const result = parseFlowCallback('custom:myOption', 'custom');

    expect(result.isFlowCallback).toBe(true);
    expect(result.optionId).toBe('myOption');
  });

  it('returns false for non-flow callback', () => {
    const result = parseFlowCallback('other:data');

    expect(result.isFlowCallback).toBe(false);
    expect(result.optionId).toBeNull();
  });

  it('handles empty option ID', () => {
    const result = parseFlowCallback('flow:');

    expect(result.isFlowCallback).toBe(true);
    expect(result.optionId).toBe('');
  });

  it('handles callback with colons in option ID', () => {
    const result = parseFlowCallback('flow:option:with:colons');

    expect(result.isFlowCallback).toBe(true);
    expect(result.optionId).toBe('option:with:colons');
  });

  it('handles different prefixes', () => {
    expect(parseFlowCallback('menu:action', 'menu').isFlowCallback).toBe(true);
    expect(parseFlowCallback('flow:action', 'menu').isFlowCallback).toBe(false);
  });
});

describe('isSpecialCallback', () => {
  it('returns true for special callbacks', () => {
    expect(isSpecialCallback('__confirm__')).toBe(true);
    expect(isSpecialCallback('__cancel__')).toBe(true);
    expect(isSpecialCallback('__back__')).toBe(true);
    expect(isSpecialCallback('__anything__')).toBe(true);
  });

  it('returns false for regular callbacks', () => {
    expect(isSpecialCallback('option1')).toBe(false);
    expect(isSpecialCallback('save')).toBe(false);
    expect(isSpecialCallback('__partial')).toBe(false);
    expect(isSpecialCallback('partial__')).toBe(false);
  });
});

describe('mapSpecialCallback', () => {
  it('maps confirm to true', () => {
    expect(mapSpecialCallback(FlowCallbackIds.CONFIRM)).toBe(true);
  });

  it('maps cancel to null', () => {
    expect(mapSpecialCallback(FlowCallbackIds.CANCEL)).toBeNull();
  });

  it('maps back to "back"', () => {
    expect(mapSpecialCallback(FlowCallbackIds.BACK)).toBe('back');
  });

  it('returns original value for unknown special callback', () => {
    expect(mapSpecialCallback('__unknown__')).toBe('__unknown__');
  });
});

describe('FlowCallbackIds', () => {
  it('has correct values', () => {
    expect(FlowCallbackIds.CONFIRM).toBe('__confirm__');
    expect(FlowCallbackIds.CANCEL).toBe('__cancel__');
    expect(FlowCallbackIds.BACK).toBe('__back__');
  });
});
