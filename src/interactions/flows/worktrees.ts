/**
 * Worktrees Flow
 *
 * Unified git worktree health management flow for CLI and Telegram.
 *
 * @module interactions/flows/worktrees
 */

import type { Flow, FlowContext, SelectOption } from '../types.js';

/**
 * Worktree health information stored in context
 */
export interface WorktreeHealth {
  isGitRepo: boolean;
  healthy: boolean;
  gitCount: number;
  dbCount: number;
  issueCount: number;
  fixableCount: number;
  issues: Array<{ description: string; autoFixable: boolean }>;
}

/**
 * Extended context for worktrees flow
 */
export interface WorktreesFlowContext extends FlowContext {
  /** Worktree health data */
  worktreeHealth?: WorktreeHealth;
  /** Result message from last action */
  resultMessage?: string;
  /** Error message if any */
  error?: string;
}

/**
 * Build worktree menu options based on health
 */
function buildWorktreeMenuOptions(ctx: WorktreesFlowContext): SelectOption[] {
  const health = ctx.worktreeHealth;
  const options: SelectOption[] = [];

  options.push({
    id: 'refresh',
    label: 'Refresh status',
    icon: '🔄',
  });

  if (health && !health.healthy && health.fixableCount > 0) {
    options.push({
      id: 'repair',
      label: 'Auto-repair issues',
      icon: '⚡',
      description: `${health.fixableCount} fixable`,
    });
  }

  const hasWorktrees = health && (health.gitCount > 0 || health.dbCount > 0);

  options.push({
    id: 'details',
    label: 'View worktree details',
    icon: '📋',
    disabled: !hasWorktrees,
    disabledReason: 'No worktrees',
  });

  options.push({
    id: 'cleanup',
    label: 'Full cleanup',
    icon: '🗑️',
    description: 'Remove all worktrees',
    disabled: !hasWorktrees,
    disabledReason: 'No worktrees',
  });

  options.push({
    id: 'back',
    label: 'Back to configuration',
    icon: '←',
  });

  return options;
}

/**
 * Format health status for display
 */
function formatHealthStatus(ctx: WorktreesFlowContext): string {
  const health = ctx.worktreeHealth;

  if (!health) {
    return 'Checking worktree health...';
  }

  if (!health.isGitRepo) {
    return 'Not a git repository. Worktrees not available.';
  }

  const lines: string[] = [
    `Git worktrees: ${health.gitCount === 0 ? '0 (clean)' : health.gitCount}`,
    `DB entries (active): ${health.dbCount}`,
  ];

  if (health.healthy) {
    lines.push('\n✓ Worktrees are healthy');
  } else {
    lines.push(`\n⚠ Found ${health.issueCount} issue(s):`);
    for (const issue of health.issues) {
      const icon = issue.autoFixable ? '⚡' : '✗';
      lines.push(`  ${icon} ${issue.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Worktrees flow definition
 */
export const worktreesFlow: Flow<WorktreesFlowContext> = {
  id: 'worktrees',
  name: 'Git Worktrees',
  firstStep: 'check_health',

  steps: {
    // ========================================================================
    // Check Health (entry point)
    // ========================================================================
    check_health: {
      id: 'check_health',
      interaction: () => ({
        type: 'progress',
        message: 'Checking worktree health...',
      }),
      handle: async () => 'action:check_worktree_health',
    },

    // ========================================================================
    // Main Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => {
        const health = ctx.worktreeHealth;

        if (health && !health.isGitRepo) {
          return {
            type: 'display',
            message: 'Not a git repository. Worktrees not available.',
            format: 'warning',
          };
        }

        return {
          type: 'select',
          message: formatHealthStatus(ctx),
          options: buildWorktreeMenuOptions(ctx),
        };
      },
      handle: async (response, ctx) => {
        const health = ctx.worktreeHealth;

        // If not a git repo, just go back
        if (health && !health.isGitRepo) {
          return null;
        }

        switch (response) {
          case 'refresh':
            return 'check_health';
          case 'repair':
            return 'action:repair_worktrees';
          case 'details':
            return 'action:view_worktree_details';
          case 'cleanup':
            return 'confirm_cleanup';
          case 'back':
            return null;
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Confirm Full Cleanup
    // ========================================================================
    confirm_cleanup: {
      id: 'confirm_cleanup',
      interaction: () => ({
        type: 'confirm',
        message: 'Remove ALL worktrees and reset to clean state?\nFeature branches will be deleted.',
        confirmLabel: 'Yes, cleanup',
        cancelLabel: 'Cancel',
        destructive: true,
      }),
      handle: async (response) => {
        if (response) {
          return 'action:full_worktree_cleanup';
        }
        return 'menu';
      },
    },

    // ========================================================================
    // Result Display
    // ========================================================================
    show_result: {
      id: 'show_result',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.resultMessage ?? 'Operation completed',
        format: 'success',
      }),
      handle: async (_, ctx) => {
        delete ctx.resultMessage;
        return 'check_health'; // Refresh health after operation
      },
    },

    // ========================================================================
    // Error State
    // ========================================================================
    error: {
      id: 'error',
      interaction: (ctx) => ({
        type: 'display',
        message: ctx.error ?? 'An error occurred',
        format: 'error',
      }),
      handle: async (_, ctx) => {
        delete ctx.error;
        return 'menu';
      },
    },
  },
};

/**
 * Check if a step result is an action marker
 */
export function isWorktreesAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getWorktreesAction(result: string): string {
  return result.replace('action:', '');
}
