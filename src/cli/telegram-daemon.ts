/**
 * Telegram Bot Daemon Manager
 *
 * Manages the Telegram bot as a background daemon process.
 * Uses global paths (~/.orchestrator/) since the bot is not project-specific.
 *
 * @module cli/telegram-daemon
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  createWriteStream,
  watch,
  openSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

// ============================================================================
// Constants
// ============================================================================

const ORCHESTRATOR_DIR = path.join(os.homedir(), '.orchestrator');
const TELEGRAM_PID_FILE = path.join(ORCHESTRATOR_DIR, 'telegram.pid');
const TELEGRAM_LOG_DIR = path.join(ORCHESTRATOR_DIR, 'logs');
const TELEGRAM_LOG_FILE = path.join(TELEGRAM_LOG_DIR, 'telegram.log');

// ============================================================================
// Types
// ============================================================================

export interface TelegramDaemonInfo {
  pid: number;
  startedAt: Date;
  version: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a process is running by PID
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format elapsed time
 */
export function formatElapsed(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// ============================================================================
// Daemon Management
// ============================================================================

/**
 * Spawn the Telegram bot as a background daemon
 */
export function spawnTelegramDaemon(): { success: boolean; pid?: number; error?: string } {
  // Check if daemon is already running
  const existing = getTelegramDaemonStatus();
  if (existing.running) {
    return {
      success: false,
      error: `Telegram bot already running (PID ${existing.info?.pid}). Use 'orchestrate telegram stop' first.`,
    };
  }

  // Ensure directories exist
  if (!existsSync(ORCHESTRATOR_DIR)) {
    mkdirSync(ORCHESTRATOR_DIR, { recursive: true });
  }
  if (!existsSync(TELEGRAM_LOG_DIR)) {
    mkdirSync(TELEGRAM_LOG_DIR, { recursive: true });
  }

  // Get the path to our CLI entry point
  const cliPath = process.argv[1];
  if (!cliPath) {
    return { success: false, error: 'Could not determine CLI path' };
  }

  // Open log file for writing
  const logFd = openSync(TELEGRAM_LOG_FILE, 'a');

  // Write startup header to log
  const startupLog = createWriteStream(TELEGRAM_LOG_FILE, { flags: 'a' });
  const timestamp = new Date().toISOString();
  startupLog.write(`\n${'='.repeat(60)}\n`);
  startupLog.write(`Telegram bot daemon started at ${timestamp}\n`);
  startupLog.write(`${'='.repeat(60)}\n\n`);
  startupLog.end();

  // Spawn detached process with --foreground flag (since daemon handles backgrounding)
  const child: ChildProcess = spawn(
    process.execPath,
    [cliPath, 'telegram', 'start', '--foreground'],
    {
      cwd: os.homedir(),
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        ORCHESTRATOR_DAEMON: 'true',
        FORCE_COLOR: '0', // Disable colors in log file
      },
    }
  );

  if (!child.pid) {
    return { success: false, error: 'Failed to get process PID' };
  }

  // Get version from package.json
  let version = 'unknown';
  try {
    const pkgPath = path.join(path.dirname(cliPath), '..', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
      version = pkg.version ?? 'unknown';
    }
  } catch {
    // Ignore version detection errors
  }

  // Save daemon info
  const daemonInfo: TelegramDaemonInfo = {
    pid: child.pid,
    startedAt: new Date(),
    version,
  };

  writeFileSync(TELEGRAM_PID_FILE, JSON.stringify(daemonInfo, null, 2));

  // Detach from parent
  child.unref();

  return { success: true, pid: child.pid };
}

/**
 * Get Telegram daemon status
 */
export function getTelegramDaemonStatus(): {
  running: boolean;
  info?: TelegramDaemonInfo;
} {
  if (!existsSync(TELEGRAM_PID_FILE)) {
    return { running: false };
  }

  try {
    const content = readFileSync(TELEGRAM_PID_FILE, 'utf-8');
    const info = JSON.parse(content) as TelegramDaemonInfo;
    info.startedAt = new Date(info.startedAt);

    if (isProcessRunning(info.pid)) {
      return { running: true, info };
    } else {
      // Process not running, clean up stale PID file
      unlinkSync(TELEGRAM_PID_FILE);
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

/**
 * Stop the Telegram daemon
 */
export function stopTelegramDaemon(): { success: boolean; error?: string } {
  const status = getTelegramDaemonStatus();

  if (!status.running || !status.info) {
    return { success: false, error: 'Telegram bot is not running' };
  }

  try {
    // Send SIGTERM first for graceful shutdown
    process.kill(status.info.pid, 'SIGTERM');

    // Wait a bit and check if it's still running
    setTimeout(() => {
      if (isProcessRunning(status.info!.pid)) {
        // Force kill if still running
        try {
          process.kill(status.info!.pid, 'SIGKILL');
        } catch {
          // Process may have already exited
        }
      }
    }, 5000);

    // Clean up PID file
    if (existsSync(TELEGRAM_PID_FILE)) {
      unlinkSync(TELEGRAM_PID_FILE);
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Tail the Telegram bot log file
 */
export async function tailTelegramLogs(
  options: { lines?: number; follow?: boolean } = {}
): Promise<void> {
  const { lines = 50, follow = false } = options;

  if (!existsSync(TELEGRAM_LOG_FILE)) {
    console.log(chalk.yellow('No Telegram bot logs found.'));
    console.log(chalk.dim(`Log file: ${TELEGRAM_LOG_FILE}`));
    return;
  }

  // Read last N lines
  const content = readFileSync(TELEGRAM_LOG_FILE, 'utf-8');
  const allLines = content.split('\n');
  const lastLines = allLines.slice(-lines);
  console.log(lastLines.join('\n'));

  if (follow) {
    console.log(chalk.dim('\n--- Following log (Ctrl+C to stop) ---\n'));

    // Watch for new content
    let lastSize = content.length;

    const watcher = watch(TELEGRAM_LOG_FILE, (eventType) => {
      if (eventType === 'change') {
        try {
          const newContent = readFileSync(TELEGRAM_LOG_FILE, 'utf-8');
          if (newContent.length > lastSize) {
            process.stdout.write(newContent.slice(lastSize));
            lastSize = newContent.length;
          }
        } catch {
          // File may have been rotated
        }
      }
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      watcher.close();
      console.log(chalk.dim('\nStopped following logs.'));
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  }
}

/**
 * Print Telegram daemon status in a formatted way
 */
export function printTelegramDaemonStatus(): void {
  const status = getTelegramDaemonStatus();

  if (!status.running) {
    console.log(chalk.dim('Status: ') + chalk.yellow('Not running'));
    return;
  }

  const info = status.info!;
  const elapsedStr = formatElapsed(info.startedAt);

  console.log(chalk.dim('Status: ') + chalk.green('Running'));
  console.log(chalk.dim('  PID: ') + info.pid);
  console.log(chalk.dim('  Version: ') + info.version);
  console.log(chalk.dim('  Running for: ') + elapsedStr);
  console.log(chalk.dim('  Logs: ') + TELEGRAM_LOG_FILE);
}
