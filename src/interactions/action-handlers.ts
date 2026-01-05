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
import type { PlanFlowContext } from './flows/plan.js';
import type { PlanEditContext } from './flows/plan-edit.js';
import type { ConfigFlowContext } from './flows/config.js';
import type { InitFlowContext } from './flows/init.js';
import type { WorktreesFlowContext, WorktreeHealth } from './flows/worktrees.js';
import type { SecretsFlowContext } from './flows/secrets.js';
import type { ProjectsFlowContext } from './flows/projects.js';
import type { TelegramSettingsFlowContext } from './flows/telegram-settings.js';

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
// Plan Actions
// ============================================================================

/**
 * Create a new plan from goal
 */
export const createPlanAction: ActionHandler<PlanFlowContext> = async (ctx, platform) => {
  try {
    const { startPlanFromApi } = await import('../telegram/project-bridge.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project selected';
      return { nextStep: 'error' };
    }

    const goal = ctx.planGoal;
    if (!goal) {
      ctx.error = 'No goal provided';
      return { nextStep: 'error' };
    }

    const result = await startPlanFromApi(ctx.projectPath, goal);

    if (!result.success) {
      ctx.error = result.error ?? 'Failed to create plan';
      return { nextStep: 'error' };
    }

    // Plan created - refresh context and show questions or plan
    // The plan data should be reloaded by the caller
    return { nextStep: 'menu' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to create plan';
    return { nextStep: 'error' };
  }
};

/**
 * Resume an existing plan
 */
export const resumePlanAction: ActionHandler<PlanFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    // For Telegram, just return to menu - the plan state is already loaded
    return { nextStep: 'menu' };
  }

  // CLI: Run the plan command with --resume
  try {
    const { planCommand } = await import('../cli/commands/plan.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    await planCommand(undefined, { path: ctx.projectPath, resume: true });
    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'Resume failed' };
  }
};

/**
 * Approve the plan
 */
export const approvePlanAction: ActionHandler<PlanFlowContext> = async (ctx) => {
  try {
    const { approvePlanFromApi } = await import('../telegram/project-bridge.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project selected';
      return { nextStep: 'error' };
    }

    const result = await approvePlanFromApi(ctx.projectPath);

    if (!result.success) {
      ctx.error = result.error ?? 'Failed to approve plan';
      return { nextStep: 'error' };
    }

    // Plan approved - return to menu with success
    return { nextStep: 'menu' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to approve plan';
    return { nextStep: 'error' };
  }
};

/**
 * Execute the plan (run requirements)
 */
export const executePlanAction: ActionHandler<PlanFlowContext> = async (ctx) => {
  try {
    const { spawnDaemon } = await import('../cli/daemon.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project selected';
      return { nextStep: 'error' };
    }

    // Start daemon to execute requirements
    const result = spawnDaemon(ctx.projectPath, 'run', ['-c', '3']);

    if (!result.success) {
      ctx.error = result.error ?? 'Failed to start execution';
      return { nextStep: 'error' };
    }

    return { nextStep: 'menu' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to execute plan';
    return { nextStep: 'error' };
  }
};

/**
 * Reject the plan
 */
export const rejectPlanAction: ActionHandler<PlanFlowContext> = async (ctx) => {
  try {
    const { rejectPlanFromApi } = await import('../telegram/project-bridge.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project selected';
      return { nextStep: 'error' };
    }

    const result = await rejectPlanFromApi(ctx.projectPath, 'Rejected via menu');

    if (!result.success) {
      ctx.error = result.error ?? 'Failed to reject plan';
      return { nextStep: 'error' };
    }

    return { nextStep: 'menu' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to reject plan';
    return { nextStep: 'error' };
  }
};

// ============================================================================
// Init Actions
// ============================================================================

/**
 * Initialize a project
 */
export const initProjectAction: ActionHandler<InitFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'error', error: 'Use CLI to initialize projects' };
  }

  try {
    const { initCommand } = await import('../cli/commands/init.js');
    const { mcpConfigManager } = await import('../core/mcp-config-manager.js');

    if (!ctx.projectPath) {
      return { nextStep: 'error', error: 'No project path' };
    }

    await initCommand({
      path: ctx.projectPath,
      interactive: true,
      claudeMd: true,
      cloud: true,
    });

    // Check if init was successful by looking for MCP config
    try {
      const mcpConfig = await mcpConfigManager.getMergedConfig(ctx.projectPath);
      const enabledServers = Object.entries(mcpConfig.mcpServers)
        .filter(([, config]) => config.enabled)
        .map(([name]) => name);

      ctx.mcpServers = enabledServers;
      ctx.initSuccess = true;
    } catch {
      // Project may not have MCP but still be initialized
      ctx.initSuccess = true;
    }

    return { nextStep: 'init_complete' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Init failed';
    return { nextStep: 'error' };
  }
};

// ============================================================================
// Worktree Actions
// ============================================================================

/**
 * Check worktree health and populate context
 */
export const checkWorktreeHealthAction: ActionHandler<WorktreesFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'error', error: 'Worktree management is CLI-only' };
  }

  try {
    const { sessionManager } = await import('../core/session-manager.js');
    const { createWorktreeHealthChecker } = await import('../core/worktree-health.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    const session = await sessionManager.resumeSession(ctx.projectPath);
    const store = sessionManager.getStore();
    const checker = createWorktreeHealthChecker(ctx.projectPath, store);

    const health = await checker.checkHealth(session.id);

    // Store health data in context
    ctx.worktreeHealth = {
      isGitRepo: health.isGitRepo,
      healthy: health.healthy,
      gitCount: health.gitWorktrees.length - 1, // Exclude main worktree
      dbCount: health.dbWorktrees.filter(w => w.status === 'active').length,
      issueCount: health.issues.length,
      fixableCount: health.issues.filter(i => i.autoFixable).length,
      issues: health.issues.map(i => ({
        description: i.description,
        autoFixable: i.autoFixable,
      })),
    };

    sessionManager.close();
    return { nextStep: 'menu' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to check worktree health';
    return { nextStep: 'error' };
  }
};

/**
 * Repair worktree issues
 */
export const repairWorktreesAction: ActionHandler<WorktreesFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'error', error: 'Worktree management is CLI-only' };
  }

  try {
    const { sessionManager } = await import('../core/session-manager.js');
    const { createWorktreeHealthChecker } = await import('../core/worktree-health.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    const session = await sessionManager.resumeSession(ctx.projectPath);
    const store = sessionManager.getStore();
    const checker = createWorktreeHealthChecker(ctx.projectPath, store);

    // Re-check health to get current issues
    const health = await checker.checkHealth(session.id);
    const fixableIssues = health.issues.filter(i => i.autoFixable);

    if (fixableIssues.length === 0) {
      ctx.resultMessage = 'No auto-fixable issues found.';
      sessionManager.close();
      return { nextStep: 'show_result' };
    }

    // Perform repairs
    const result = await checker.repair(fixableIssues);
    sessionManager.close();

    // Build result message
    const lines: string[] = [`Repaired ${result.fixed.length} issue(s):`];
    for (const fixed of result.fixed) {
      lines.push(`  ✓ ${fixed}`);
    }
    for (const failed of result.failed) {
      lines.push(`  ✗ ${failed.issue}: ${failed.error}`);
    }

    ctx.resultMessage = lines.join('\n');
    return { nextStep: 'show_result' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to repair worktrees';
    return { nextStep: 'error' };
  }
};

/**
 * View worktree details
 */
export const viewWorktreeDetailsAction: ActionHandler<WorktreesFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'error', error: 'Worktree management is CLI-only' };
  }

  try {
    const { sessionManager } = await import('../core/session-manager.js');
    const { createWorktreeHealthChecker } = await import('../core/worktree-health.js');
    const { input } = await import('@inquirer/prompts');
    const chalk = (await import('chalk')).default;

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    const session = await sessionManager.resumeSession(ctx.projectPath);
    const store = sessionManager.getStore();
    const checker = createWorktreeHealthChecker(ctx.projectPath, store);

    const health = await checker.checkHealth(session.id);

    // Display git worktrees
    console.log(chalk.cyan('\n  Git Worktrees:\n'));
    for (const wt of health.gitWorktrees) {
      const isMain = wt.path === process.cwd() || wt.branch === 'main' || wt.branch === 'master';
      if (isMain) {
        console.log(chalk.dim(`  ${wt.branch} (main worktree)`));
      } else {
        let status = '';
        if (wt.locked) status += chalk.red(' [locked]');
        if (wt.prunable) status += chalk.yellow(' [orphaned]');
        console.log(`  ${chalk.blue(wt.branch)}${status}`);
        console.log(chalk.dim(`    Path: ${wt.path}`));
      }
    }

    // Display DB entries
    console.log(chalk.cyan('\n  Database Entries:\n'));
    for (const wt of health.dbWorktrees) {
      let statusColor = chalk.white;
      if (wt.status === 'active') statusColor = chalk.green;
      if (wt.status === 'merged') statusColor = chalk.blue;
      if (wt.status === 'abandoned') statusColor = chalk.dim;

      console.log(`  ${wt.branchName} ${statusColor(`(${wt.status})`)}`);
      console.log(chalk.dim(`    Created: ${wt.createdAt.toLocaleString()}`));
      if (wt.mergedAt) {
        console.log(chalk.dim(`    Merged: ${wt.mergedAt.toLocaleString()}`));
      }
    }

    console.log();
    await input({ message: chalk.dim('Press Enter to continue...') });

    sessionManager.close();
    return { nextStep: 'menu' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to view worktree details';
    return { nextStep: 'error' };
  }
};

/**
 * Full worktree cleanup
 */
export const fullWorktreeCleanupAction: ActionHandler<WorktreesFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'error', error: 'Worktree management is CLI-only' };
  }

  try {
    const { sessionManager } = await import('../core/session-manager.js');
    const { createWorktreeHealthChecker } = await import('../core/worktree-health.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    const session = await sessionManager.resumeSession(ctx.projectPath);
    const store = sessionManager.getStore();
    const checker = createWorktreeHealthChecker(ctx.projectPath, store);

    const result = await checker.fullCleanup(session.id);
    sessionManager.close();

    // Build result message
    const lines: string[] = ['Full cleanup completed:'];
    for (const fixed of result.fixed) {
      lines.push(`  ✓ ${fixed}`);
    }
    for (const failed of result.failed) {
      lines.push(`  ✗ ${failed.issue}: ${failed.error}`);
    }

    if (result.success) {
      lines.push('\n✓ Full cleanup complete!');
    } else {
      lines.push('\n⚠ Cleanup completed with some errors.');
    }

    ctx.resultMessage = lines.join('\n');
    return { nextStep: 'show_result' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to cleanup worktrees';
    return { nextStep: 'error' };
  }
};

// ============================================================================
// Secrets Actions
// ============================================================================

/**
 * Run secrets interactive CLI
 */
export const runSecretsInteractiveAction: ActionHandler<SecretsFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'cli_only' };
  }

  try {
    const { interactiveCommand } = await import('../cli/commands/secrets.js');
    await interactiveCommand({ path: ctx.projectPath ?? process.cwd() });
    return { nextStep: null };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to run secrets manager';
    return { nextStep: 'error' };
  }
};

// ============================================================================
// Projects Actions
// ============================================================================

/**
 * Run projects interactive CLI
 */
export const runProjectsInteractiveAction: ActionHandler<ProjectsFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'cli_only' };
  }

  try {
    const { interactiveCommand } = await import('../cli/commands/projects.js');
    await interactiveCommand();
    return { nextStep: null };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to run project registry';
    return { nextStep: 'error' };
  }
};

// ============================================================================
// Telegram Settings Actions
// ============================================================================

/**
 * Run telegram settings interactive CLI
 */
export const runTelegramInteractiveAction: ActionHandler<TelegramSettingsFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'cli_only' };
  }

  try {
    const { interactiveCommand } = await import('../cli/commands/telegram.js');
    await interactiveCommand();
    return { nextStep: null };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to run telegram settings';
    return { nextStep: 'error' };
  }
};

// ============================================================================
// Config Actions
// ============================================================================

/**
 * Show project settings (CLI only)
 */
export const projectSettingsAction: ActionHandler<ConfigFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    // Telegram doesn't support interactive config editing
    return { nextStep: 'menu', error: 'Use CLI for project settings' };
  }

  try {
    const { configInteractive } = await import('../cli/commands/config.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    await configInteractive({ path: ctx.projectPath });
    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'Config failed' };
  }
};

/**
 * List MCP servers
 */
export const listMcpAction: ActionHandler<ConfigFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'menu', error: 'Use CLI for MCP management' };
  }

  try {
    const { mcpListCommand } = await import('../cli/commands/mcp.js');

    if (!ctx.projectPath) {
      return { nextStep: 'menu', error: 'No project path' };
    }

    await mcpListCommand({ path: ctx.projectPath, global: false });

    const { input } = await import('@inquirer/prompts');
    await input({ message: 'Press Enter to continue...' });

    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'List failed' };
  }
};

/**
 * Add MCP server - directly uses mcpConfigManager
 */
export const addMcpAction: ActionHandler<ConfigFlowContext> = async (ctx) => {
  try {
    const { mcpConfigManager } = await import('../core/mcp-config-manager.js');
    const path = await import('node:path');

    // Get MCP config from context
    const name = ctx.mcpServerName;
    const transport = ctx.mcpTransport;
    const command = ctx.mcpCommand;
    const args = ctx.mcpArgs;
    const url = ctx.mcpUrl;

    if (!name || !transport || !ctx.projectPath) {
      return { nextStep: 'menu', error: 'Missing server configuration' };
    }

    const projectPath = path.resolve(ctx.projectPath);

    // Build server config based on transport type
    const serverConfig: {
      type: 'stdio' | 'http' | 'sse';
      command?: string;
      args?: string[];
      url?: string;
      enabled?: boolean;
    } = {
      type: transport,
      enabled: true,
    };

    if (transport === 'stdio') {
      serverConfig.command = command ?? 'npx';
      serverConfig.args = args?.split(' ').filter(Boolean) ?? [];
    } else if (url) {
      serverConfig.url = url;
    }

    await mcpConfigManager.addServer(name, serverConfig, projectPath);

    // Clear wizard state
    delete ctx.mcpServerName;
    delete ctx.mcpTransport;
    delete ctx.mcpCommand;
    delete ctx.mcpArgs;
    delete ctx.mcpUrl;

    return { nextStep: 'menu' };
  } catch (error) {
    return { nextStep: 'menu', error: error instanceof Error ? error.message : 'Add failed' };
  }
};

/**
 * Toggle MCP server - CLI only, uses enable/disable commands
 */
export const toggleMcpAction: ActionHandler<ConfigFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'menu', error: 'Use CLI for MCP management' };
  }

  // For now, just return to menu - toggle needs interactive selection
  return { nextStep: 'menu', error: 'Use "orchestrate mcp enable/disable <name>" command' };
};

/**
 * Remove MCP server - CLI only
 */
export const removeMcpAction: ActionHandler<ConfigFlowContext> = async (ctx, platform) => {
  if (platform === 'telegram') {
    return { nextStep: 'menu', error: 'Use CLI for MCP management' };
  }

  // For now, just return to menu - remove needs interactive selection
  return { nextStep: 'menu', error: 'Use "orchestrate mcp remove <name>" command' };
};

// ============================================================================
// Plan Edit Actions
// ============================================================================

/**
 * Update a field on a plan requirement
 */
export const updateReqFieldAction: ActionHandler<PlanEditContext> = async (ctx) => {
  try {
    const { sessionManager } = await import('../core/session-manager.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    // Initialize session
    await sessionManager.initialize(ctx.projectPath);
    await sessionManager.resumeSession(ctx.projectPath);

    const store = sessionManager.getStore();
    const session = sessionManager.getCurrentSession();
    if (!session) {
      ctx.error = 'No active session';
      return { nextStep: 'error' };
    }

    const plan = store.getActivePlan(session.id);
    if (!plan) {
      ctx.error = 'No active plan';
      return { nextStep: 'error' };
    }

    const reqIndex = ctx.selectedReqIndex ?? 0;
    const field = ctx.editField;
    const value = ctx.editValue;

    if (reqIndex >= plan.requirements.length) {
      ctx.error = 'Requirement not found';
      return { nextStep: 'error' };
    }

    // Clone requirements array and update the field
    const requirements = [...plan.requirements];
    const original = requirements[reqIndex];

    if (!original) {
      ctx.error = 'Requirement not found';
      return { nextStep: 'error' };
    }

    const updated = {
      id: original.id,
      title: field === 'title' && value ? value : original.title,
      description: field === 'description' && value ? value : original.description,
      userStories: original.userStories,
      acceptanceCriteria: original.acceptanceCriteria,
      technicalNotes: field === 'notes'
        ? (value ? value.split('\n').filter(Boolean) : original.technicalNotes)
        : original.technicalNotes,
      estimatedComplexity: field === 'complexity' && value
        ? (value as 'low' | 'medium' | 'high')
        : original.estimatedComplexity,
      dependencies: original.dependencies,
      priority: original.priority,
      rationale: original.rationale,
    };

    requirements[reqIndex] = updated;
    store.updatePlan(plan.id, { requirements });

    // Update context plan
    ctx.plan = store.getPlan(plan.id);

    // Clear edit state
    delete ctx.selectedReqIndex;
    delete ctx.editField;
    delete ctx.editValue;

    return { nextStep: 'edit_success' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to update requirement';
    return { nextStep: 'error' };
  }
};

/**
 * Reorder a requirement in the plan
 */
export const reorderReqAction: ActionHandler<PlanEditContext> = async (ctx) => {
  try {
    const { sessionManager } = await import('../core/session-manager.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    await sessionManager.resumeSession(ctx.projectPath);

    const store = sessionManager.getStore();
    const session = sessionManager.getCurrentSession();
    if (!session) {
      ctx.error = 'No active session';
      return { nextStep: 'error' };
    }

    const plan = store.getActivePlan(session.id);
    if (!plan) {
      ctx.error = 'No active plan';
      return { nextStep: 'error' };
    }

    const fromIndex = ctx.reorderFrom ?? 0;
    const toIndex = ctx.selectedReqIndex ?? 0;

    if (fromIndex >= plan.requirements.length || toIndex >= plan.requirements.length) {
      ctx.error = 'Invalid position';
      return { nextStep: 'error' };
    }

    // Clone and reorder requirements
    const requirements = [...plan.requirements];
    const moved = requirements[fromIndex];
    if (!moved) {
      ctx.error = 'Source requirement not found';
      return { nextStep: 'error' };
    }
    requirements.splice(fromIndex, 1);
    requirements.splice(toIndex, 0, moved);

    // Update implementation order too
    const implementationOrder = requirements.map(r => r.id);

    store.updatePlan(plan.id, { requirements, implementationOrder });

    // Update context plan
    ctx.plan = store.getPlan(plan.id);

    // Clear reorder state
    delete ctx.reorderFrom;
    delete ctx.selectedReqIndex;

    return { nextStep: 'edit_success' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to reorder requirements';
    return { nextStep: 'error' };
  }
};

/**
 * Remove a requirement from the plan
 */
export const removeReqAction: ActionHandler<PlanEditContext> = async (ctx) => {
  try {
    const { sessionManager } = await import('../core/session-manager.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    await sessionManager.resumeSession(ctx.projectPath);

    const store = sessionManager.getStore();
    const session = sessionManager.getCurrentSession();
    if (!session) {
      ctx.error = 'No active session';
      return { nextStep: 'error' };
    }

    const plan = store.getActivePlan(session.id);
    if (!plan) {
      ctx.error = 'No active plan';
      return { nextStep: 'error' };
    }

    const reqIndex = ctx.selectedReqIndex ?? 0;

    if (reqIndex >= plan.requirements.length) {
      ctx.error = 'Requirement not found';
      return { nextStep: 'error' };
    }

    // Clone and remove requirement
    const requirements = [...plan.requirements];
    const toRemove = requirements[reqIndex];
    if (!toRemove) {
      ctx.error = 'Requirement not found';
      return { nextStep: 'error' };
    }
    const removedId = toRemove.id;
    requirements.splice(reqIndex, 1);

    // Update implementation order
    const implementationOrder = plan.implementationOrder.filter(id => id !== removedId);

    store.updatePlan(plan.id, { requirements, implementationOrder });

    // Update context plan
    ctx.plan = store.getPlan(plan.id);

    // Clear state
    delete ctx.selectedReqIndex;

    return { nextStep: 'edit_success' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to remove requirement';
    return { nextStep: 'error' };
  }
};

/**
 * Add a new requirement to the plan
 */
export const addPlanReqAction: ActionHandler<PlanEditContext> = async (ctx) => {
  try {
    const { sessionManager } = await import('../core/session-manager.js');
    const { nanoid } = await import('nanoid');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    await sessionManager.resumeSession(ctx.projectPath);

    const store = sessionManager.getStore();
    const session = sessionManager.getCurrentSession();
    if (!session) {
      ctx.error = 'No active session';
      return { nextStep: 'error' };
    }

    const plan = store.getActivePlan(session.id);
    if (!plan) {
      ctx.error = 'No active plan';
      return { nextStep: 'error' };
    }

    // Get new requirement data from context
    const newReq = ctx as { _newReqTitle?: string; _newReqDescription?: string; _newReqComplexity?: string };
    const title = newReq._newReqTitle ?? 'New Requirement';
    const description = newReq._newReqDescription ?? '';
    const complexity = (newReq._newReqComplexity ?? 'medium') as 'low' | 'medium' | 'high';

    // Create new requirement
    const newRequirement = {
      id: nanoid(8),
      title,
      description,
      userStories: [],
      acceptanceCriteria: [],
      technicalNotes: [],
      estimatedComplexity: complexity,
      dependencies: [],
      priority: plan.requirements.length,
      rationale: '',
    };

    // Add to requirements array
    const requirements = [...plan.requirements, newRequirement];
    const implementationOrder = [...plan.implementationOrder, newRequirement.id];

    store.updatePlan(plan.id, { requirements, implementationOrder });

    // Update context plan
    ctx.plan = store.getPlan(plan.id);

    // Clear wizard state
    delete newReq._newReqTitle;
    delete newReq._newReqDescription;
    delete newReq._newReqComplexity;

    return { nextStep: 'edit_success' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to add requirement';
    return { nextStep: 'error' };
  }
};

/**
 * Update an answer to a plan question
 */
export const updateQuestionAnswerAction: ActionHandler<PlanEditContext> = async (ctx) => {
  try {
    const { sessionManager } = await import('../core/session-manager.js');

    if (!ctx.projectPath) {
      ctx.error = 'No project path';
      return { nextStep: 'error' };
    }

    await sessionManager.initialize(ctx.projectPath);
    await sessionManager.resumeSession(ctx.projectPath);

    const store = sessionManager.getStore();
    const session = sessionManager.getCurrentSession();
    if (!session) {
      ctx.error = 'No active session';
      return { nextStep: 'error' };
    }

    const plan = store.getActivePlan(session.id);
    if (!plan) {
      ctx.error = 'No active plan';
      return { nextStep: 'error' };
    }

    const questionIndex = ctx.selectedQuestionIndex ?? 0;
    const answer = ctx.editValue;

    if (questionIndex >= plan.questions.length) {
      ctx.error = 'Question not found';
      return { nextStep: 'error' };
    }

    // Clone questions array and update answer
    const questions = [...plan.questions];
    const original = questions[questionIndex];
    if (!original) {
      ctx.error = 'Question not found';
      return { nextStep: 'error' };
    }

    // Build updated question with explicit property assignment
    const updatedQuestion: typeof original = {
      id: original.id,
      category: original.category,
      question: original.question,
      context: original.context,
      answer: answer ?? '',
      answeredAt: new Date(),
    };
    if (original.suggestedOptions) {
      updatedQuestion.suggestedOptions = original.suggestedOptions;
    }
    questions[questionIndex] = updatedQuestion;

    store.updatePlan(plan.id, { questions });

    // Update context plan
    ctx.plan = store.getPlan(plan.id);

    // Clear edit state
    delete ctx.selectedQuestionIndex;
    delete ctx.editValue;

    return { nextStep: 'edit_success' };
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : 'Failed to update answer';
    return { nextStep: 'error' };
  }
};

// ============================================================================
// Action Registry
// ============================================================================

type AnyContext = DaemonFlowContext | RunFlowContext | RequirementsFlowContext | PlanFlowContext | PlanEditContext | ConfigFlowContext | WorktreesFlowContext | SecretsFlowContext | ProjectsFlowContext | TelegramSettingsFlowContext;

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

  // Plan actions
  create_plan: createPlanAction as ActionHandler<AnyContext>,
  resume_plan: resumePlanAction as ActionHandler<AnyContext>,
  approve_plan: approvePlanAction as ActionHandler<AnyContext>,
  execute_plan: executePlanAction as ActionHandler<AnyContext>,
  reject_plan: rejectPlanAction as ActionHandler<AnyContext>,

  // Config actions
  project_settings: projectSettingsAction as ActionHandler<AnyContext>,
  list_mcp: listMcpAction as ActionHandler<AnyContext>,
  add_mcp: addMcpAction as ActionHandler<AnyContext>,
  toggle_mcp: toggleMcpAction as ActionHandler<AnyContext>,
  remove_mcp: removeMcpAction as ActionHandler<AnyContext>,

  // Init actions
  init_project: initProjectAction as ActionHandler<AnyContext>,

  // Plan edit actions
  update_req_field: updateReqFieldAction as ActionHandler<AnyContext>,
  reorder_req: reorderReqAction as ActionHandler<AnyContext>,
  remove_req: removeReqAction as ActionHandler<AnyContext>,
  add_plan_req: addPlanReqAction as ActionHandler<AnyContext>,
  update_question_answer: updateQuestionAnswerAction as ActionHandler<AnyContext>,

  // Worktree actions
  check_worktree_health: checkWorktreeHealthAction as ActionHandler<AnyContext>,
  repair_worktrees: repairWorktreesAction as ActionHandler<AnyContext>,
  view_worktree_details: viewWorktreeDetailsAction as ActionHandler<AnyContext>,
  full_worktree_cleanup: fullWorktreeCleanupAction as ActionHandler<AnyContext>,

  // Secrets actions
  run_secrets_interactive: runSecretsInteractiveAction as ActionHandler<AnyContext>,

  // Projects actions
  run_projects_interactive: runProjectsInteractiveAction as ActionHandler<AnyContext>,

  // Telegram settings actions
  run_telegram_interactive: runTelegramInteractiveAction as ActionHandler<AnyContext>,
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
