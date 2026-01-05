/**
 * Daemon Flow
 *
 * Unified daemon controls flow for CLI and Telegram.
 * Handles viewing logs, stopping the daemon, and status display.
 *
 * @module interactions/flows/daemon
 */

import type { Flow, FlowContext, SelectOption } from '../types.js';

/**
 * Extended context for daemon flow
 */
export interface DaemonFlowContext extends FlowContext {
  /** Selected action */
  selectedAction?: string;
  /** Loaded log lines */
  logs?: string[];
  /** Error message if any */
  error?: string;
  /** Stop result */
  stopResult?: { success: boolean; error?: string };
}

/**
 * Format elapsed time
 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Build daemon menu options based on context
 */
function buildDaemonMenuOptions(ctx: DaemonFlowContext): SelectOption[] {
  const options: SelectOption[] = [];

  if (!ctx.daemon.running) {
    options.push({
      id: 'not_running',
      label: 'Daemon not running',
      icon: '⚪',
      disabled: true,
      disabledReason: 'Use Run to start',
    });
  } else {
    options.push({
      id: 'view_logs',
      label: 'View recent logs',
      icon: '📋',
      description: 'Show last 30 log lines',
    });

    options.push({
      id: 'follow_logs',
      label: 'Follow logs (live)',
      icon: '📺',
      description: 'Stream logs in real-time',
    });

    options.push({
      id: 'stop',
      label: 'Stop daemon',
      icon: '⏹',
      description: `PID: ${ctx.daemon.pid ?? 'unknown'}`,
    });
  }

  options.push({ id: 'back', label: 'Back to main menu', icon: '←' });

  return options;
}

/**
 * Daemon flow definition
 */
export const daemonFlow: Flow<DaemonFlowContext> = {
  id: 'daemon',
  name: 'Daemon Controls',
  firstStep: 'menu',

  steps: {
    // ========================================================================
    // Daemon Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => {
        const uptime = ctx.daemon.startedAt
          ? formatElapsed(Date.now() - new Date(ctx.daemon.startedAt).getTime())
          : 'unknown';

        return {
          type: 'select',
          message: ctx.daemon.running
            ? `Daemon Controls (PID: ${ctx.daemon.pid}, uptime: ${uptime})`
            : 'Daemon Controls',
          options: buildDaemonMenuOptions(ctx),
        };
      },
      handle: async (response, ctx) => {
        ctx.selectedAction = response as string;

        switch (response) {
          case 'view_logs':
            return 'action:load_logs';
          case 'follow_logs':
            return 'action:follow_logs';
          case 'stop':
            return 'confirm_stop';
          case 'back':
            return null;
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // View Logs
    // ========================================================================
    loading_logs: {
      id: 'loading_logs',
      interaction: () => ({
        type: 'progress',
        message: 'Loading logs...',
      }),
      handle: async () => 'display_logs',
    },

    display_logs: {
      id: 'display_logs',
      interaction: (ctx) => {
        const logs = ctx.logs ?? [];
        const logText = logs.length > 0
          ? logs.slice(-30).join('\n')
          : 'No logs available';

        return {
          type: 'display',
          message: logText,
          format: 'info',
        };
      },
      handle: async () => 'logs_actions',
    },

    logs_actions: {
      id: 'logs_actions',
      interaction: () => ({
        type: 'select',
        message: 'What next?',
        options: [
          { id: 'refresh', label: 'Refresh logs', icon: '🔄' },
          { id: 'follow', label: 'Follow logs (live)', icon: '📺' },
          { id: 'menu', label: 'Back to daemon menu', icon: '←' },
        ],
      }),
      handle: async (response, ctx) => {
        switch (response) {
          case 'refresh':
            delete ctx.logs;
            return 'action:load_logs';
          case 'follow':
            return 'action:follow_logs';
          case 'menu':
          default:
            delete ctx.logs;
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Stop Daemon
    // ========================================================================
    confirm_stop: {
      id: 'confirm_stop',
      interaction: (ctx) => ({
        type: 'confirm',
        message: `Stop the running daemon?\n\nPID: ${ctx.daemon.pid ?? 'unknown'}\n\nThis will interrupt any running jobs.`,
        confirmLabel: 'Stop',
        cancelLabel: 'Cancel',
        destructive: true,
      }),
      handle: async (response) => {
        if (response) {
          return 'action:stop_daemon';
        }
        return 'menu';
      },
    },

    stopping: {
      id: 'stopping',
      interaction: () => ({
        type: 'progress',
        message: 'Stopping daemon...',
      }),
      handle: async () => 'stop_result',
    },

    stop_result: {
      id: 'stop_result',
      interaction: (ctx) => {
        const result = ctx.stopResult;
        if (result?.success) {
          return {
            type: 'display',
            message: 'Daemon stopped successfully.',
            format: 'success',
          };
        }
        return {
          type: 'display',
          message: `Failed to stop daemon: ${result?.error ?? 'Unknown error'}`,
          format: 'error',
        };
      },
      handle: async (_, ctx) => {
        delete ctx.stopResult;
        // Return to main menu since daemon is stopped
        return null;
      },
    },

    // ========================================================================
    // Error Handling
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
export function isDaemonAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getDaemonAction(result: string): string {
  return result.replace('action:', '');
}
