/**
 * Flow Context Builder
 *
 * Builds the FlowContext from project state.
 * Extracted from CLI menu.ts getMenuContext pattern.
 *
 * @module interactions/context
 */

import { sessionManager } from '../core/session-manager.js';
import { getDaemonStatus } from '../cli/daemon.js';
import type { FlowContext, RequirementsCounts, DaemonStatus, UserContext } from './types.js';

/**
 * Build a FlowContext from the current project state
 *
 * @param projectPath - Path to the project directory
 * @param user - User context (role, telegramId, etc.)
 * @param platform - Platform identifier ('cli' or 'telegram')
 * @returns FlowContext with current state
 */
export async function buildFlowContext(
  projectPath: string,
  user: UserContext,
  platform: 'cli' | 'telegram'
): Promise<FlowContext> {
  const context: FlowContext = {
    projectPath,
    hasProject: false,
    requirements: {
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
    },
    daemon: {
      running: false,
    },
    user,
    platform,
  };

  // Check daemon status
  const daemonStatus = getDaemonStatus(projectPath);
  if (daemonStatus.running && daemonStatus.pid !== undefined) {
    context.daemon = {
      running: true,
      pid: daemonStatus.pid,
    };
  } else if (daemonStatus.running) {
    context.daemon = {
      running: true,
    };
  }

  // Try to load project state
  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    const store = sessionManager.getStore();

    context.hasProject = true;
    context.projectName = session.projectName;
    context.sessionId = session.id;

    // Count requirements by status
    const requirements = store.getRequirementsBySession(session.id);
    for (const req of requirements) {
      switch (req.status) {
        case 'pending':
          context.requirements.pending++;
          break;
        case 'in_progress':
          context.requirements.inProgress++;
          break;
        case 'completed':
          context.requirements.completed++;
          break;
        case 'failed':
          context.requirements.failed++;
          break;
      }
    }

    // Get active plan
    context.plan = store.getActivePlan(session.id);

    sessionManager.close();
  } catch (error) {
    // Project not initialized or database error - log for debugging
    if (process.env.DEBUG) {
      console.debug('[FlowContext] Failed to load project state:', error instanceof Error ? error.message : error);
    }
    sessionManager.close();
  }

  return context;
}

/**
 * Refresh an existing FlowContext with latest state
 *
 * @param context - Existing context to refresh
 * @returns Updated context
 */
export async function refreshFlowContext(context: FlowContext): Promise<FlowContext> {
  if (!context.projectPath) {
    return context;
  }

  return buildFlowContext(context.projectPath, context.user, context.platform);
}

/**
 * Create a minimal CLI user context
 */
export function createCliUser(): UserContext {
  return {
    role: 'admin',
    displayName: 'CLI User',
  };
}

/**
 * Create a Telegram user context
 */
export function createTelegramUser(
  telegramId: number,
  role: 'admin' | 'operator' | 'viewer',
  displayName?: string
): UserContext {
  const user: UserContext = {
    role,
    telegramId,
  };
  if (displayName !== undefined) {
    user.displayName = displayName;
  }
  return user;
}
