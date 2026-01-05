/**
 * Telegram Session Manager Tests
 *
 * Tests for the TelegramFlowSessionManager and related functions.
 *
 * @module interactions/__tests__/telegram-session.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockGrammyContext, createContextWithoutUser, createCallbackContext } from './mocks/telegram.js';
import { createMockContext } from './mocks/context.js';
import { createSingleStepFlow, createLinearFlow } from './mocks/flow.js';

// Mock dependencies before importing the module under test
vi.mock('../context.js', () => ({
  buildFlowContext: vi.fn(),
  createTelegramUser: vi.fn(),
}));

vi.mock('../renderers/telegram.js', () => ({
  createTelegramRenderer: vi.fn(),
  parseFlowCallback: vi.fn(),
  isSpecialCallback: vi.fn(),
  mapSpecialCallback: vi.fn(),
}));

vi.mock('../flows/main-menu.js', () => ({
  mainMenuFlow: {
    id: 'main-menu',
    name: 'Main Menu',
    firstStep: 'menu',
    steps: {
      menu: {
        id: 'menu',
        interaction: () => ({
          type: 'select',
          message: 'What would you like to do?',
          options: [{ id: 'exit', label: 'Exit' }],
        }),
        handle: async () => null,
      },
    },
  },
  getSubFlowId: vi.fn(),
}));

vi.mock('../flows/index.js', () => ({
  getFlow: vi.fn(),
}));

vi.mock('../../core/project-registry.js', () => ({
  getProjectRegistry: vi.fn(() => ({
    listProjects: vi.fn(() => []),
  })),
}));

// Import after mocks are set up
import {
  telegramFlowSessions,
  startMainMenuFlow,
  handleFlowCallback,
  handleFlowTextInput,
} from '../telegram-session.js';
import { buildFlowContext, createTelegramUser } from '../context.js';
import {
  createTelegramRenderer,
  parseFlowCallback,
  isSpecialCallback,
  mapSpecialCallback,
} from '../renderers/telegram.js';
import { mainMenuFlow, getSubFlowId } from '../flows/main-menu.js';
import { getFlow } from '../flows/index.js';

describe('TelegramFlowSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telegramFlowSessions.destroy(); // Clean up sessions and stop interval

    // Setup default mocks
    vi.mocked(createTelegramUser).mockReturnValue({
      role: 'admin',
      telegramId: 12345,
      displayName: 'testuser',
    });

    vi.mocked(buildFlowContext).mockResolvedValue(createMockContext({
      platform: 'telegram',
      user: { role: 'admin', telegramId: 12345 },
    }));

    vi.mocked(createTelegramRenderer).mockReturnValue({
      select: vi.fn().mockResolvedValue(null),
      input: vi.fn().mockResolvedValue(null),
      confirm: vi.fn().mockResolvedValue(false),
      progress: vi.fn().mockReturnValue({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() }),
      display: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    telegramFlowSessions.destroy();
  });

  describe('startSession', () => {
    it('creates a session for a valid user', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });
      const flow = createSingleStepFlow();

      await telegramFlowSessions.startSession(ctx, flow, '/test/project', 'admin');

      expect(telegramFlowSessions.hasSession(12345)).toBe(true);
    });

    it('returns early if no telegram ID', async () => {
      const ctx = createContextWithoutUser();
      const flow = createSingleStepFlow();

      await telegramFlowSessions.startSession(ctx, flow, '/test/project', 'admin');

      expect(vi.mocked(buildFlowContext)).not.toHaveBeenCalled();
    });

    it('builds context with correct parameters', async () => {
      const ctx = createMockGrammyContext({ telegramId: 99999, username: 'testuser' });
      const flow = createSingleStepFlow();

      await telegramFlowSessions.startSession(ctx, flow, '/my/project', 'operator');

      expect(createTelegramUser).toHaveBeenCalledWith(99999, 'operator', 'testuser');
      expect(buildFlowContext).toHaveBeenCalledWith(
        '/my/project',
        expect.objectContaining({ role: 'admin', telegramId: 12345 }),
        'telegram'
      );
    });

    it('creates a telegram renderer', async () => {
      const ctx = createMockGrammyContext();
      const flow = createSingleStepFlow();

      await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');

      expect(createTelegramRenderer).toHaveBeenCalledWith({ ctx });
    });

    it('runs the first step of the flow', async () => {
      const ctx = createMockGrammyContext();
      const mockRenderer = {
        select: vi.fn().mockResolvedValue(null),
        input: vi.fn().mockResolvedValue(null),
        confirm: vi.fn().mockResolvedValue(false),
        progress: vi.fn().mockReturnValue({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() }),
        display: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(createTelegramRenderer).mockReturnValue(mockRenderer);

      const flow = createSingleStepFlow();
      await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');

      expect(mockRenderer.select).toHaveBeenCalled();
    });
  });

  describe('getSession', () => {
    it('returns null for non-existent session', () => {
      const session = telegramFlowSessions.getSession(99999);
      expect(session).toBeNull();
    });

    it('returns session for existing user', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      const session = telegramFlowSessions.getSession(12345);
      expect(session).not.toBeNull();
      expect(session?.runner).toBeDefined();
    });

    it('removes and returns null for expired session', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      // Access internal session and expire it
      const session = telegramFlowSessions.getSession(12345);
      if (session) {
        session.expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago
      }

      // Should return null now
      const result = telegramFlowSessions.getSession(12345);
      expect(result).toBeNull();
      expect(telegramFlowSessions.hasSession(12345)).toBe(false);
    });
  });

  describe('handleCallback', () => {
    beforeEach(() => {
      vi.mocked(parseFlowCallback).mockReturnValue({
        isFlowCallback: true,
        optionId: 'exit',
      });
      vi.mocked(isSpecialCallback).mockReturnValue(false);
    });

    it('returns false if no telegram ID', async () => {
      const ctx = createContextWithoutUser();
      const result = await telegramFlowSessions.handleCallback(ctx, 'flow:exit');
      expect(result).toBe(false);
    });

    it('returns false if no active session', async () => {
      const ctx = createMockGrammyContext({ telegramId: 99999 });
      const result = await telegramFlowSessions.handleCallback(ctx, 'flow:exit');
      expect(result).toBe(false);
    });

    it('returns false for non-flow callback', async () => {
      vi.mocked(parseFlowCallback).mockReturnValue({
        isFlowCallback: false,
        optionId: null,
      });

      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      const result = await telegramFlowSessions.handleCallback(ctx, 'other:data');
      expect(result).toBe(false);
    });

    it('handles flow callback and advances flow', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345, callbackData: 'flow:exit' });

      // Create a flow where the response ends the flow
      const flow = {
        id: 'test-flow',
        name: 'Test',
        firstStep: 'menu',
        steps: {
          menu: {
            id: 'menu',
            interaction: () => ({
              type: 'select' as const,
              message: 'Choose:',
              options: [{ id: 'exit', label: 'Exit' }],
            }),
            handle: async () => null, // Ends flow
          },
        },
      };

      await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');
      const result = await telegramFlowSessions.handleCallback(ctx, 'flow:exit');

      expect(result).toBe(true);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Done!' });
      expect(telegramFlowSessions.hasSession(12345)).toBe(false);
    });

    it('maps special callbacks before handling', async () => {
      vi.mocked(isSpecialCallback).mockReturnValue(true);
      vi.mocked(mapSpecialCallback).mockReturnValue('back');

      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      await telegramFlowSessions.handleCallback(ctx, 'flow:__back__');

      expect(mapSpecialCallback).toHaveBeenCalledWith('exit');
    });

    it('refreshes session timeout on callback', async () => {
      vi.mocked(parseFlowCallback).mockReturnValue({
        isFlowCallback: true,
        optionId: 'next',
      });

      const ctx = createMockGrammyContext({ telegramId: 12345, messageId: 5 });

      // Flow that continues (doesn't end)
      const flow = {
        id: 'test-flow',
        name: 'Test',
        firstStep: 'step1',
        steps: {
          step1: {
            id: 'step1',
            interaction: () => ({
              type: 'select' as const,
              message: 'Choose:',
              options: [{ id: 'next', label: 'Next' }],
            }),
            handle: async () => 'step2',
          },
          step2: {
            id: 'step2',
            interaction: () => ({
              type: 'select' as const,
              message: 'Step 2:',
              options: [{ id: 'exit', label: 'Exit' }],
            }),
            handle: async () => null,
          },
        },
      };

      await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');

      const sessionBefore = telegramFlowSessions.getSession(12345);
      const expiryBefore = sessionBefore?.expiresAt;

      // Small delay to ensure time difference
      await new Promise((r) => setTimeout(r, 10));

      await telegramFlowSessions.handleCallback(ctx, 'flow:next');

      const sessionAfter = telegramFlowSessions.getSession(12345);
      expect(sessionAfter?.expiresAt.getTime()).toBeGreaterThan(expiryBefore?.getTime() ?? 0);
    });

    it('answers callback query on success', async () => {
      vi.mocked(parseFlowCallback).mockReturnValue({
        isFlowCallback: true,
        optionId: 'next',
      });

      const ctx = createMockGrammyContext({ telegramId: 12345 });

      const flow = {
        id: 'test',
        name: 'Test',
        firstStep: 'step1',
        steps: {
          step1: {
            id: 'step1',
            interaction: () => ({
              type: 'select' as const,
              message: 'Choose:',
              options: [{ id: 'next', label: 'Next' }],
            }),
            handle: async () => 'step2',
          },
          step2: {
            id: 'step2',
            interaction: () => ({
              type: 'select' as const,
              message: 'Step 2:',
              options: [],
            }),
            handle: async () => null,
          },
        },
      };

      await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');
      await telegramFlowSessions.handleCallback(ctx, 'flow:next');

      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe('handleTextInput', () => {
    it('returns false if no telegram ID', async () => {
      const ctx = createContextWithoutUser();
      const result = await telegramFlowSessions.handleTextInput(ctx, 'hello');
      expect(result).toBe(false);
    });

    it('returns false if no active session', async () => {
      const ctx = createMockGrammyContext({ telegramId: 99999 });
      const result = await telegramFlowSessions.handleTextInput(ctx, 'hello');
      expect(result).toBe(false);
    });

    it('returns false if not waiting for text', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });

      // Flow with select interaction (not input)
      const flow = {
        id: 'test',
        name: 'Test',
        firstStep: 'menu',
        steps: {
          menu: {
            id: 'menu',
            interaction: () => ({
              type: 'select' as const,
              message: 'Choose:',
              options: [],
            }),
            handle: async () => null,
          },
        },
      };

      await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');
      const result = await telegramFlowSessions.handleTextInput(ctx, 'hello');

      expect(result).toBe(false);
    });

    it('processes text input when waiting for text', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });

      // Flow with input interaction
      const flow = {
        id: 'test',
        name: 'Test',
        firstStep: 'input',
        steps: {
          input: {
            id: 'input',
            interaction: () => ({
              type: 'input' as const,
              message: 'Enter text:',
            }),
            handle: async () => null, // Ends flow
          },
        },
      };

      await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');
      const result = await telegramFlowSessions.handleTextInput(ctx, 'my input');

      expect(result).toBe(true);
      expect(telegramFlowSessions.hasSession(12345)).toBe(false); // Flow ended
    });
  });

  describe('endSession', () => {
    it('removes session for user', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      expect(telegramFlowSessions.hasSession(12345)).toBe(true);

      telegramFlowSessions.endSession(12345);

      expect(telegramFlowSessions.hasSession(12345)).toBe(false);
    });

    it('does nothing for non-existent session', () => {
      // Should not throw
      telegramFlowSessions.endSession(99999);
    });
  });

  describe('hasSession', () => {
    it('returns false for no session', () => {
      expect(telegramFlowSessions.hasSession(99999)).toBe(false);
    });

    it('returns true for active session', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      expect(telegramFlowSessions.hasSession(12345)).toBe(true);
    });

    it('returns false for expired session', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      // Expire the session
      const session = telegramFlowSessions.getSession(12345);
      if (session) {
        session.expiresAt = new Date(0);
      }

      expect(telegramFlowSessions.hasSession(12345)).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('removes expired sessions', async () => {
      const ctx1 = createMockGrammyContext({ telegramId: 111 });
      const ctx2 = createMockGrammyContext({ telegramId: 222 });
      const ctx3 = createMockGrammyContext({ telegramId: 333 });

      await telegramFlowSessions.startSession(ctx1, createSingleStepFlow(), '/test', 'admin');
      await telegramFlowSessions.startSession(ctx2, createSingleStepFlow(), '/test', 'admin');
      await telegramFlowSessions.startSession(ctx3, createSingleStepFlow(), '/test', 'admin');

      // Expire sessions 111 and 333
      const session1 = telegramFlowSessions.getSession(111);
      const session3 = telegramFlowSessions.getSession(333);
      if (session1) session1.expiresAt = new Date(0);
      if (session3) session3.expiresAt = new Date(0);

      telegramFlowSessions.cleanup();

      expect(telegramFlowSessions.hasSession(111)).toBe(false);
      expect(telegramFlowSessions.hasSession(222)).toBe(true);
      expect(telegramFlowSessions.hasSession(333)).toBe(false);
    });

    it('keeps non-expired sessions', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });
      await telegramFlowSessions.startSession(ctx, createSingleStepFlow(), '/test', 'admin');

      telegramFlowSessions.cleanup();

      expect(telegramFlowSessions.hasSession(12345)).toBe(true);
    });
  });

  describe('destroy', () => {
    it('clears all sessions', async () => {
      const ctx1 = createMockGrammyContext({ telegramId: 111 });
      const ctx2 = createMockGrammyContext({ telegramId: 222 });

      await telegramFlowSessions.startSession(ctx1, createSingleStepFlow(), '/test', 'admin');
      await telegramFlowSessions.startSession(ctx2, createSingleStepFlow(), '/test', 'admin');

      telegramFlowSessions.destroy();

      expect(telegramFlowSessions.hasSession(111)).toBe(false);
      expect(telegramFlowSessions.hasSession(222)).toBe(false);
    });
  });
});

describe('exported functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telegramFlowSessions.destroy();

    vi.mocked(createTelegramUser).mockReturnValue({
      role: 'admin',
      telegramId: 12345,
    });

    vi.mocked(buildFlowContext).mockResolvedValue(createMockContext({
      platform: 'telegram',
    }));

    vi.mocked(createTelegramRenderer).mockReturnValue({
      select: vi.fn().mockResolvedValue(null),
      input: vi.fn().mockResolvedValue(null),
      confirm: vi.fn().mockResolvedValue(false),
      progress: vi.fn().mockReturnValue({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() }),
      display: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    telegramFlowSessions.destroy();
  });

  describe('startMainMenuFlow', () => {
    it('starts a session with the main menu flow', async () => {
      const ctx = createMockGrammyContext({ telegramId: 12345 });

      await startMainMenuFlow(ctx, '/test/project', 'admin');

      expect(telegramFlowSessions.hasSession(12345)).toBe(true);
    });
  });

  describe('handleFlowCallback', () => {
    it('delegates to session manager', async () => {
      vi.mocked(parseFlowCallback).mockReturnValue({
        isFlowCallback: false,
        optionId: null,
      });

      const ctx = createMockGrammyContext({ telegramId: 12345 });
      const result = await handleFlowCallback(ctx, 'some:data');

      expect(result).toBe(false);
    });
  });

  describe('handleFlowTextInput', () => {
    it('delegates to session manager', async () => {
      const ctx = createMockGrammyContext({ telegramId: 99999 });
      const result = await handleFlowTextInput(ctx, 'hello');

      expect(result).toBe(false);
    });
  });
});

describe('sub-flow delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telegramFlowSessions.destroy();

    vi.mocked(createTelegramUser).mockReturnValue({
      role: 'admin',
      telegramId: 12345,
    });

    vi.mocked(buildFlowContext).mockResolvedValue(createMockContext({
      platform: 'telegram',
      projectPath: '/test/project',
    }));

    vi.mocked(createTelegramRenderer).mockReturnValue({
      select: vi.fn().mockResolvedValue(null),
      input: vi.fn().mockResolvedValue(null),
      confirm: vi.fn().mockResolvedValue(false),
      progress: vi.fn().mockReturnValue({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() }),
      display: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    telegramFlowSessions.destroy();
  });

  it('handles flow: step prefix by delegating to sub-flow', async () => {
    vi.mocked(parseFlowCallback).mockReturnValue({
      isFlowCallback: true,
      optionId: 'plan',
    });
    vi.mocked(isSpecialCallback).mockReturnValue(false);
    vi.mocked(getSubFlowId).mockReturnValue('plan');
    vi.mocked(getFlow).mockReturnValue(createSingleStepFlow());

    const ctx = createMockGrammyContext({ telegramId: 12345 });

    // Flow that navigates to a sub-flow
    const flow = {
      id: 'main',
      name: 'Main',
      firstStep: 'menu',
      steps: {
        menu: {
          id: 'menu',
          interaction: () => ({
            type: 'select' as const,
            message: 'Choose:',
            options: [{ id: 'plan', label: 'Plan' }],
          }),
          handle: async () => 'flow:plan', // Navigate to sub-flow
        },
      },
    };

    await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');
    await telegramFlowSessions.handleCallback(ctx, 'flow:plan');

    // Should have answered the callback query
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it('shows error when no project selected for project-requiring flow', async () => {
    vi.mocked(parseFlowCallback).mockReturnValue({
      isFlowCallback: true,
      optionId: 'plan',
    });
    vi.mocked(isSpecialCallback).mockReturnValue(false);
    vi.mocked(getSubFlowId).mockReturnValue('plan');
    vi.mocked(getFlow).mockReturnValue(createSingleStepFlow());
    vi.mocked(buildFlowContext).mockResolvedValue(createMockContext({
      platform: 'telegram',
      projectPath: null, // No project
    }));

    const ctx = createMockGrammyContext({ telegramId: 12345 });

    const flow = {
      id: 'main',
      name: 'Main',
      firstStep: 'menu',
      steps: {
        menu: {
          id: 'menu',
          interaction: () => ({
            type: 'select' as const,
            message: 'Choose:',
            options: [{ id: 'plan', label: 'Plan' }],
          }),
          handle: async () => 'flow:plan',
        },
      },
    };

    await telegramFlowSessions.startSession(ctx, flow, '/test', 'admin');
    await telegramFlowSessions.handleCallback(ctx, 'flow:plan');

    expect(ctx.reply).toHaveBeenCalledWith('❌ No project selected. Use /projects to select one.');
  });
});
