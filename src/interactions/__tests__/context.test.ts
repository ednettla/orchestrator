/**
 * Flow Context Builder Tests
 *
 * Tests for the context building functions.
 *
 * @module interactions/__tests__/context.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../core/session-manager.js', () => ({
  sessionManager: {
    initialize: vi.fn(),
    resumeSession: vi.fn(),
    getStore: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('../../cli/daemon.js', () => ({
  getDaemonStatus: vi.fn(),
}));

import {
  buildFlowContext,
  refreshFlowContext,
  createCliUser,
  createTelegramUser,
} from '../context.js';
import { sessionManager } from '../../core/session-manager.js';
import { getDaemonStatus } from '../../cli/daemon.js';
import type { UserContext } from '../types.js';

describe('buildFlowContext', () => {
  const mockUser: UserContext = {
    role: 'admin',
    displayName: 'Test User',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: daemon not running
    vi.mocked(getDaemonStatus).mockReturnValue({
      running: false,
    });
  });

  it('returns context with basic fields', async () => {
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('No project'));

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.projectPath).toBe('/test/path');
    expect(context.user).toBe(mockUser);
    expect(context.platform).toBe('cli');
  });

  it('defaults to no project', async () => {
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('No project'));

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.hasProject).toBe(false);
    expect(context.projectName).toBeUndefined();
    expect(context.sessionId).toBeUndefined();
  });

  it('defaults to empty requirements counts', async () => {
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('No project'));

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.requirements).toEqual({
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
    });
  });

  it('detects daemon with PID', async () => {
    vi.mocked(getDaemonStatus).mockReturnValue({
      running: true,
      pid: 12345,
    });
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('No project'));

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.daemon).toEqual({
      running: true,
      pid: 12345,
    });
  });

  it('detects daemon without PID', async () => {
    vi.mocked(getDaemonStatus).mockReturnValue({
      running: true,
    });
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('No project'));

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.daemon).toEqual({
      running: true,
    });
  });

  it('loads project state when available', async () => {
    const mockSession = {
      id: 'session-123',
      projectName: 'my-project',
      projectPath: '/test/path',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockStore = {
      getRequirementsBySession: vi.fn().mockReturnValue([]),
      getActivePlan: vi.fn().mockReturnValue(null),
    };

    vi.mocked(sessionManager.initialize).mockResolvedValue(undefined);
    vi.mocked(sessionManager.resumeSession).mockResolvedValue(mockSession);
    vi.mocked(sessionManager.getStore).mockReturnValue(mockStore as unknown as ReturnType<typeof sessionManager.getStore>);

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.hasProject).toBe(true);
    expect(context.projectName).toBe('my-project');
    expect(context.sessionId).toBe('session-123');
  });

  it('counts requirements by status', async () => {
    const mockSession = {
      id: 'session-123',
      projectName: 'my-project',
      projectPath: '/test/path',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRequirements = [
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
      { id: '3', status: 'in_progress' },
      { id: '4', status: 'completed' },
      { id: '5', status: 'completed' },
      { id: '6', status: 'completed' },
      { id: '7', status: 'failed' },
    ];

    const mockStore = {
      getRequirementsBySession: vi.fn().mockReturnValue(mockRequirements),
      getActivePlan: vi.fn().mockReturnValue(null),
    };

    vi.mocked(sessionManager.initialize).mockResolvedValue(undefined);
    vi.mocked(sessionManager.resumeSession).mockResolvedValue(mockSession);
    vi.mocked(sessionManager.getStore).mockReturnValue(mockStore as unknown as ReturnType<typeof sessionManager.getStore>);

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.requirements).toEqual({
      pending: 2,
      inProgress: 1,
      completed: 3,
      failed: 1,
    });
  });

  it('loads active plan', async () => {
    const mockSession = {
      id: 'session-123',
      projectName: 'my-project',
      projectPath: '/test/path',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockPlan = {
      id: 'plan-123',
      sessionId: 'session-123',
      status: 'pending_approval',
      highLevelGoal: 'Build something cool',
      requirements: [],
      questions: [],
    };

    const mockStore = {
      getRequirementsBySession: vi.fn().mockReturnValue([]),
      getActivePlan: vi.fn().mockReturnValue(mockPlan),
    };

    vi.mocked(sessionManager.initialize).mockResolvedValue(undefined);
    vi.mocked(sessionManager.resumeSession).mockResolvedValue(mockSession);
    vi.mocked(sessionManager.getStore).mockReturnValue(mockStore as unknown as ReturnType<typeof sessionManager.getStore>);

    const context = await buildFlowContext('/test/path', mockUser, 'cli');

    expect(context.plan).toBe(mockPlan);
  });

  it('closes session manager after success', async () => {
    const mockSession = {
      id: 'session-123',
      projectName: 'my-project',
      projectPath: '/test/path',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockStore = {
      getRequirementsBySession: vi.fn().mockReturnValue([]),
      getActivePlan: vi.fn().mockReturnValue(null),
    };

    vi.mocked(sessionManager.initialize).mockResolvedValue(undefined);
    vi.mocked(sessionManager.resumeSession).mockResolvedValue(mockSession);
    vi.mocked(sessionManager.getStore).mockReturnValue(mockStore as unknown as ReturnType<typeof sessionManager.getStore>);

    await buildFlowContext('/test/path', mockUser, 'cli');

    expect(sessionManager.close).toHaveBeenCalled();
  });

  it('closes session manager after error', async () => {
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('DB error'));

    await buildFlowContext('/test/path', mockUser, 'cli');

    expect(sessionManager.close).toHaveBeenCalled();
  });

  it('logs error in debug mode', async () => {
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';

    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('Test error'));

    await buildFlowContext('/test/path', mockUser, 'cli');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[FlowContext] Failed to load project state:',
      'Test error'
    );

    consoleSpy.mockRestore();
    process.env.DEBUG = originalDebug;
  });

  it('handles non-Error objects in catch', async () => {
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';

    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(sessionManager.initialize).mockRejectedValue('string error');

    await buildFlowContext('/test/path', mockUser, 'cli');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[FlowContext] Failed to load project state:',
      'string error'
    );

    consoleSpy.mockRestore();
    process.env.DEBUG = originalDebug;
  });

  it('works for telegram platform', async () => {
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('No project'));

    const telegramUser: UserContext = {
      role: 'operator',
      telegramId: 12345,
    };

    const context = await buildFlowContext('/test/path', telegramUser, 'telegram');

    expect(context.platform).toBe('telegram');
    expect(context.user.telegramId).toBe(12345);
  });
});

describe('refreshFlowContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDaemonStatus).mockReturnValue({ running: false });
  });

  it('returns same context if no projectPath', async () => {
    const context = {
      projectPath: null,
      hasProject: false,
      requirements: { pending: 0, inProgress: 0, completed: 0, failed: 0 },
      daemon: { running: false },
      user: { role: 'admin' as const },
      platform: 'cli' as const,
    };

    const result = await refreshFlowContext(context);

    expect(result).toBe(context);
    expect(sessionManager.initialize).not.toHaveBeenCalled();
  });

  it('rebuilds context with project path', async () => {
    vi.mocked(sessionManager.initialize).mockRejectedValue(new Error('No project'));

    const context = {
      projectPath: '/test/path',
      hasProject: false,
      requirements: { pending: 0, inProgress: 0, completed: 0, failed: 0 },
      daemon: { running: false },
      user: { role: 'admin' as const, displayName: 'Test' },
      platform: 'cli' as const,
    };

    const result = await refreshFlowContext(context);

    expect(result).not.toBe(context);
    expect(result.projectPath).toBe('/test/path');
    expect(result.user).toEqual(context.user);
    expect(result.platform).toBe('cli');
  });
});

describe('createCliUser', () => {
  it('creates admin user', () => {
    const user = createCliUser();

    expect(user.role).toBe('admin');
  });

  it('sets display name', () => {
    const user = createCliUser();

    expect(user.displayName).toBe('CLI User');
  });

  it('does not set telegramId', () => {
    const user = createCliUser();

    expect(user.telegramId).toBeUndefined();
  });
});

describe('createTelegramUser', () => {
  it('creates user with telegramId and role', () => {
    const user = createTelegramUser(12345, 'operator');

    expect(user.telegramId).toBe(12345);
    expect(user.role).toBe('operator');
  });

  it('sets display name when provided', () => {
    const user = createTelegramUser(12345, 'admin', 'johndoe');

    expect(user.displayName).toBe('johndoe');
  });

  it('does not set display name when undefined', () => {
    const user = createTelegramUser(12345, 'viewer');

    expect(user.displayName).toBeUndefined();
  });

  it('supports all role types', () => {
    expect(createTelegramUser(1, 'admin').role).toBe('admin');
    expect(createTelegramUser(2, 'operator').role).toBe('operator');
    expect(createTelegramUser(3, 'viewer').role).toBe('viewer');
  });
});
