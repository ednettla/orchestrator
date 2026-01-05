/**
 * Unified Action Handlers
 *
 * Executes flow actions for both CLI and Telegram.
 * Each action is platform-agnostic and works with the flow context.
 *
 * @module interactions/action-handlers
 */

import type { FlowContext } from './types.js';
import type { DaemonFlowContext } from './flows/daemon.js';
import type { RunFlowContext } from './flows/run.js';
import type { RequirementsFlowContext } from './flows/requirements.js';

// ============================================================================
// Action Handler Types
// ============================================================================

export interface ActionResult {
  /** Next step to navigate to */
  nextStep: string | null;
  /** Error message if action failed */
  error?: string;
}

export type ActionHandler<TContext extends FlowContext = FlowContext> = (
  ctx: TContext,
  platform: 'cli' | 'telegram'
) => Promise<ActionResult>;

// ============================================================================
// Daemon Actions
// ============================================================================

/**
 * Load recent logs into context
 */
export const loadLogsAction: ActionHandler<DaemonFlowContext> = async (ctx) => {
  try {
    const { getRecentLogs } = await import('../telegram/project-bridge.js');

    if (!ctx.projectPath) {
      return { nextStep: 'error', error: 'No project path' };
    }

    const logs = await getRecentLogs(ctx.projectPath, 30);
    ctx.logs = logs;

    return { nextStep: 'display_logs' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to load logs';
    return { nextStep: 'error' };
  }
};

/**
 * Follow logs (live streaming)
 * Note: For Telegram, this just refreshes logs since we can't stream
 */
export const followLogsAction: ActionHandler<DaemonFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    // Telegram can't stream, so just load recent logs
    return loadLogsAction(ctx, platform);
  }

  // CLI: Use tailLogs with follow mode
  try {
    const { tailLogs } = await import('../cli/daemon.js');

    if (!ctx.projectPath) {
      return { nextStep: 'error', error: 'No project path' };
    }

    // This blocks until Ctrl+C
    await tailLogs(ctx.projectPath, { lines: 30, follow: true });

    // After following, return to menu
    return { nextStep: 'menu' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to follow logs';
    return { nextStep: 'error' };
  }
};

/**
 * Stop the daemon
 */
export const stopDaemonAction: ActionHandler<DaemonFlowContext> = async (ctx) => {
  try {
    const { stopDaemon } = await import('../cli/daemon.js');

    if (!ctx.projectPath) {
      return { nextStep: 'error', error: 'No project path' };
    }

    const result = stopDaemon(ctx.projectPath);
    ctx.stopResult = result;

    // Update daemon status in context
    ctx.daemon = {
      running: false,
    };

    return { nextStep: 'stop_result' };
  } catch (error) {
    ctx.stopResult = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    return { nextStep: 'stop_result' };
  }
};

// ============================================================================
// Run Actions
// ============================================================================

/**
 * Start daemon in background mode
 */
export const startDaemonAction: ActionHandler<RunFlowContext> = async (ctx) => {
  try {
    const { spawnDaemon } = await import('../cli/daemon.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    const concurrency = ctx.concurrency ?? 3;
    const result = spawnDaemon(ctx.projectPath, 'run', ['-c', String(concurrency)]);

    if (!result.success) {
      return { nextStep: 'menu', error: result.error ?? 'Failed to start daemon' };
    }

    // Update daemon status in context
    const newDaemonStatus: { running: boolean; pid?: number } = {
      running: true,
    };
    if (result.pid !== undefined) {
      newDaemonStatus.pid = result.pid;
    }
    ctx.daemon = newDaemonStatus;

    return { nextStep: 'run_started' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'Failed to start daemon' };
  }
};

/**
 * Run in foreground mode
 */
export const runForegroundAction: ActionHandler<RunFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    // Telegram can't run in foreground, use background mode
    return startDaemonAction(ctx, platform);
  }

  // CLI: Run directly
  try {
    const { runCommand } = await import('../cli/commands/run.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    await runCommand(undefined, {
      path: ctx.projectPath,
      concurrency: String(ctx.concurrency ?? 3),
      background: false,
    });

    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'Run failed' };
  }
};

/**
 * Show status display
 */
export const showStatusAction: ActionHandler<RunFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    // Telegram handles this differently - just return to menu
    return { nextStep: 'menu' };
  }

  // CLI: Run status command
  try {
    const { statusCommand } = await import('../cli/commands/status.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    await statusCommand({ path: ctx.projectPath, json: false });
    console.log(); // Add spacing

    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'Status failed' };
  }
};

/**
 * View logs from run flow
 * Note: Unlike daemon flow, this displays logs inline and returns to menu
 * since run flow doesn't have display_logs/logs_actions steps
 */
export const viewLogsAction: ActionHandler<RunFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    // Telegram handles this via callback handlers
    return { nextStep: 'menu' };
  }

  // CLI: Display logs inline and return to menu
  try {
    const { getRecentLogs } = await import('../telegram/project-bridge.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    const logs = await getRecentLogs(ctx.projectPath, 30);

    console.log('\n' + '='.repeat(60));
    console.log('Recent Logs:');
    console.log('='.repeat(60));
    if (logs.length > 0) {
      console.log(logs.join('\n'));
    } else {
      console.log('No logs available');
    }
    console.log('='.repeat(60) + '\n');

    // Wait for user to acknowledge
    const { input } = await import('@inquirer/prompts');
    await input({ message: 'Press Enter to continue...' });

    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'Failed to load logs' };
  }
};

// ============================================================================
// Requirements Actions
// ============================================================================

/**
 * Add a new requirement
 */
export const addRequirementAction: ActionHandler<RequirementsFlowContext> = async (ctx) => {
  try {
    const { addRequirement } = await import('../telegram/project-bridge.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'add_error' };
    }

    const title = ctx.newRequirementTitle ?? '';
    const description = ctx.newRequirementDescription ?? '';
    const fullText = description ? `${title}\n\n${description}` : title;

    const result = await addRequirement(ctx.projectPath, fullText);

    if (!result.success) {
      ctx.error = result.error ?? result.output ?? 'Failed to add requirement';
      return { nextStep: 'add_error' };
    }

    // Update requirements count
    ctx.requirements.pending++;

    return { nextStep: 'add_success' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to add requirement';
    return { nextStep: 'add_error' };
  }
};

/**
 * List all requirements
 */
export const listRequirementsAction: ActionHandler<RequirementsFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    // Telegram handles this via callback handlers
    return { nextStep: 'menu' };
  }

  // CLI: Run list command
  try {
    const { listCommand } = await import('../cli/commands/list.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    await listCommand({
      path: ctx.projectPath,
      status: '', // Empty string shows all statuses
      json: false,
    });

    // Wait for user to acknowledge
    const { input } = await import('@inquirer/prompts');
    await input({ message: 'Press Enter to continue...' });

    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'List failed' };
  }
};

// ============================================================================
// Action Registry
// ============================================================================

type AnyContext = DaemonFlowContext | RunFlowContext | RequirementsFlowContext;

const actionRegistry: Record<string, ActionHandler<AnyContext>> = {
  // Daemon actions
  load_logs: loadLogsAction as ActionHandler<AnyContext>,
  follow_logs: followLogsAction as ActionHandler<AnyContext>,
  stop_daemon: stopDaemonAction as ActionHandler<AnyContext>,

  // Run actions
  start_daemon: startDaemonAction as ActionHandler<AnyContext>,
  run_foreground: runForegroundAction as ActionHandler<AnyContext>,
  show_status: showStatusAction as ActionHandler<AnyContext>,
  view_logs: viewLogsAction as ActionHandler<AnyContext>,

  // Requirements actions
  add_requirement: addRequirementAction as ActionHandler<AnyContext>,
  list_requirements: listRequirementsAction as ActionHandler<AnyContext>,
};

/**
 * Execute an action by name
 */
export async function executeAction<TContext extends FlowContext>(
  actionName: string,
  ctx: TContext,
  platform: 'cli' | 'telegram'
): Promise<ActionResult> {
  const handler = actionRegistry[actionName];

  if (!handler) {
    console.warn(`[ActionHandler] Unknown action: ${actionName}`);
    return { nextStep: 'menu', error: `Unknown action: ${actionName}` };
  }

  return handler(ctx as AnyContext, platform);
}

/**
 * Check if a step result is an action marker
 */
export function isActionMarker(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getActionName(result: string): string {
  return result.replace('action:', '');
}
