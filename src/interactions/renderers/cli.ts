/**
 * CLI Renderer
 *
 * Renders interactions using inquirer prompts and ora spinner.
 * Maps interaction primitives to CLI-specific implementations.
 *
 * @module interactions/renderers/cli
 */

import { select, input, confirm, editor } from '@inquirer/prompts';
import ora from 'ora';
import chalk from 'chalk';
import type {
  Renderer,
  SelectInteraction,
  InputInteraction,
  ConfirmInteraction,
  ProgressInteraction,
  DisplayInteraction,
  ProgressHandle,
} from '../types.js';

/**
 * CLI renderer implementation
 *
 * Uses:
 * - @inquirer/prompts for select, input, confirm, editor
 * - ora for progress spinners
 * - chalk for colored output
 */
export const cliRenderer: Renderer = {
  /**
   * Render select interaction with arrow key navigation
   */
  async select(interaction: SelectInteraction): Promise<string | null> {
    const choices = interaction.options.map((opt) => {
      // Build display name with icon and description
      let name = '';

      if (opt.icon) {
        name += `${opt.icon} `;
      }

      name += opt.label;

      if (opt.description && !opt.disabled) {
        name += `  ${chalk.dim(opt.description)}`;
      }

      if (opt.disabled && opt.disabledReason) {
        name = chalk.dim(`${opt.icon ?? ''} ${opt.label} (${opt.disabledReason})`);
      }

      return {
        name,
        value: opt.id,
        disabled: opt.disabled ? (opt.disabledReason ?? true) : false,
      };
    });

    try {
      return await select({
        message: interaction.message,
        choices,
      });
    } catch {
      // User cancelled (Ctrl+C)
      return null;
    }
  },

  /**
   * Render input interaction
   * Uses editor for multiline, input for single line
   */
  async input(interaction: InputInteraction): Promise<string | null> {
    try {
      if (interaction.multiline) {
        const editorConfig: { message: string; default?: string } = {
          message: interaction.message,
        };
        if (interaction.placeholder !== undefined) {
          editorConfig.default = interaction.placeholder;
        }
        return await editor(editorConfig);
      }

      const inputConfig: {
        message: string;
        default?: string;
        validate?: (value: string) => string | true;
      } = {
        message: interaction.message,
      };
      if (interaction.placeholder !== undefined) {
        inputConfig.default = interaction.placeholder;
      }
      if (interaction.validate) {
        inputConfig.validate = (value) => interaction.validate!(value) ?? true;
      }
      return await input(inputConfig);
    } catch {
      // User cancelled
      return null;
    }
  },

  /**
   * Render confirm interaction
   */
  async confirm(interaction: ConfirmInteraction): Promise<boolean> {
    try {
      const message = interaction.destructive
        ? chalk.red(interaction.message)
        : interaction.message;

      return await confirm({
        message,
        default: !interaction.destructive,
      });
    } catch {
      // User cancelled
      return false;
    }
  },

  /**
   * Start a progress spinner
   */
  progress(interaction: ProgressInteraction): ProgressHandle {
    const spinner = ora(interaction.message).start();

    return {
      update(message: string): void {
        spinner.text = message;
      },

      succeed(message?: string): void {
        spinner.succeed(message ?? interaction.message);
      },

      fail(message?: string): void {
        spinner.fail(message ?? interaction.message);
      },

      stop(): void {
        spinner.stop();
      },
    };
  },

  /**
   * Display a message with appropriate styling
   */
  async display(interaction: DisplayInteraction): Promise<void> {
    const prefixMap = {
      info: chalk.blue('i'),
      success: chalk.green('✓'),
      warning: chalk.yellow('⚠'),
      error: chalk.red('✗'),
    };

    const colorMap = {
      info: chalk.white,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
    };

    const format = interaction.format ?? 'info';
    const prefix = prefixMap[format];
    const color = colorMap[format];

    console.log(`${prefix} ${color(interaction.message)}`);
  },
};

/**
 * Display a "Press Enter to continue" prompt
 * Common pattern in CLI menus
 */
export async function waitForEnter(message = 'Press Enter to continue...'): Promise<void> {
  try {
    await input({ message: chalk.dim(message) });
  } catch {
    // Ignore cancellation
  }
}

/**
 * Print a section header
 */
export function printHeader(title: string): void {
  console.log();
  console.log(chalk.cyan.bold(`  ${title}`));
  console.log(chalk.dim('  ' + '─'.repeat(50)));
}

/**
 * Print the orchestrator banner
 */
export function printBanner(): void {
  console.log();
  console.log(chalk.cyan('  ╔═══════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.bold.white('           Orchestrator CLI                              ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.dim('     Multi-agent system for building web applications     ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚═══════════════════════════════════════════════════════════╝'));
  console.log();
}

/**
 * Print context info (project, requirements, daemon, plan)
 */
export function printContextInfo(ctx: {
  hasProject: boolean;
  projectName?: string;
  requirements: { pending: number; inProgress: number; completed: number; failed: number };
  daemon: { running: boolean; pid?: number };
  plan?: { status: string; highLevelGoal: string } | null;
}): void {
  if (ctx.hasProject) {
    console.log(chalk.dim('  Project:'), chalk.white(ctx.projectName));

    const statusParts: string[] = [];
    if (ctx.requirements.pending > 0) {
      statusParts.push(chalk.yellow(`${ctx.requirements.pending} pending`));
    }
    if (ctx.requirements.inProgress > 0) {
      statusParts.push(chalk.blue(`${ctx.requirements.inProgress} in progress`));
    }
    if (ctx.requirements.completed > 0) {
      statusParts.push(chalk.green(`${ctx.requirements.completed} completed`));
    }
    if (ctx.requirements.failed > 0) {
      statusParts.push(chalk.red(`${ctx.requirements.failed} failed`));
    }

    if (statusParts.length > 0) {
      console.log(chalk.dim('  Requirements:'), statusParts.join(chalk.dim(' | ')));
    }

    if (ctx.daemon.running) {
      console.log(chalk.dim('  Daemon:'), chalk.green(`running (PID ${ctx.daemon.pid})`));
    }

    if (ctx.plan) {
      const statusColor = getPlanStatusColor(ctx.plan.status);
      const goal = truncateText(ctx.plan.highLevelGoal, 40);
      console.log(chalk.dim('  Plan:'), statusColor(ctx.plan.status), chalk.dim('-'), goal);
    }
  } else {
    console.log(chalk.dim('  No project initialized in current directory'));
  }
  console.log();
}

/**
 * Get chalk color function for plan status
 */
function getPlanStatusColor(status: string): (text: string) => string {
  switch (status) {
    case 'drafting':
    case 'questioning':
      return chalk.yellow;
    case 'pending_approval':
      return chalk.blue;
    case 'approved':
    case 'executing':
      return chalk.cyan;
    case 'completed':
      return chalk.green;
    case 'rejected':
      return chalk.red;
    default:
      return chalk.white;
  }
}

/**
 * Truncate text with ellipsis
 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}
