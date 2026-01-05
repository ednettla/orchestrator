/**
 * Mock Context Factory for Testing
 *
 * Creates FlowContext objects with sensible defaults for testing.
 *
 * @module interactions/__tests__/mocks/context
 */

import type { FlowContext, UserContext, RequirementsCounts, DaemonStatus, Plan } from '../../types.js';

/**
 * Default requirements counts (all zeros)
 */
export const defaultRequirements: RequirementsCounts = {
  pending: 0,
  inProgress: 0,
  completed: 0,
  failed: 0,
};

/**
 * Default daemon status (not running)
 */
export const defaultDaemon: DaemonStatus = {
  running: false,
};

/**
 * Default user context (admin role)
 */
export const defaultUser: UserContext = {
  role: 'admin',
  displayName: 'Test User',
};

/**
 * Create a mock FlowContext with sensible defaults
 *
 * @example
 * ```typescript
 * // Minimal context
 * const ctx = createMockContext();
 *
 * // Context with project
 * const ctx = createMockContext({ hasProject: true, projectName: 'my-project' });
 *
 * // Context with pending requirements
 * const ctx = createMockContext({
 *   requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 }
 * });
 *
 * // Context with running daemon
 * const ctx = createMockContext({
 *   daemon: { running: true, pid: 12345 }
 * });
 * ```
 */
export function createMockContext(overrides?: Partial<FlowContext>): FlowContext {
  return {
    projectPath: '/test/project',
    projectName: 'test-project',
    sessionId: 'test-session-id',
    hasProject: true,
    plan: null,
    requirements: { ...defaultRequirements },
    daemon: { ...defaultDaemon },
    user: { ...defaultUser },
    platform: 'cli',
    ...overrides,
  };
}

/**
 * Create a context for a project that doesn't exist yet
 */
export function createNoProjectContext(overrides?: Partial<FlowContext>): FlowContext {
  return createMockContext({
    projectPath: null,
    projectName: undefined,
    sessionId: undefined,
    hasProject: false,
    ...overrides,
  });
}

/**
 * Create a context with pending requirements
 */
export function createContextWithRequirements(
  counts: Partial<RequirementsCounts>,
  overrides?: Partial<FlowContext>
): FlowContext {
  return createMockContext({
    requirements: {
      ...defaultRequirements,
      ...counts,
    },
    ...overrides,
  });
}

/**
 * Create a context with a running daemon
 */
export function createContextWithDaemon(
  pid = 12345,
  overrides?: Partial<FlowContext>
): FlowContext {
  return createMockContext({
    daemon: {
      running: true,
      pid,
      startedAt: new Date().toISOString(),
    },
    ...overrides,
  });
}

/**
 * Create a mock Plan object
 */
export function createMockPlan(overrides?: Partial<Plan>): Plan {
  return {
    id: 'test-plan-id',
    sessionId: 'test-session-id',
    highLevelGoal: 'Build a test application',
    status: 'pending_approval',
    requirements: [],
    questions: [], // Used by plan flow for clarifying questions
    clarifyingQuestions: [],
    technicalContext: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Plan;
}

/**
 * Create a context with an active plan
 */
export function createContextWithPlan(
  planOverrides?: Partial<Plan>,
  contextOverrides?: Partial<FlowContext>
): FlowContext {
  return createMockContext({
    plan: createMockPlan(planOverrides),
    ...contextOverrides,
  });
}

/**
 * Create a Telegram context
 */
export function createTelegramContext(
  telegramId = 12345,
  overrides?: Partial<FlowContext>
): FlowContext {
  return createMockContext({
    platform: 'telegram',
    user: {
      ...defaultUser,
      telegramId,
    },
    ...overrides,
  });
}

/**
 * Create context with specific user role
 */
export function createContextWithRole(
  role: 'admin' | 'operator' | 'viewer',
  overrides?: Partial<FlowContext>
): FlowContext {
  return createMockContext({
    user: {
      ...defaultUser,
      role,
    },
    ...overrides,
  });
}
