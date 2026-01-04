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
import chalk from 'chalk';

// ============================================================================
// Daemon Manager
// ============================================================================

const DAEMON_PID_FILE = '.orchestrator/daemon.pid';
const DAEMON_LOG_FILE = '.orchestrator/logs/daemon.log';

export interface DaemonInfo {
  pid: number;
  command: string;
  args: string[];
  startedAt: Date;
  projectPath: string;
}

/**
 * Get paths for daemon files
 */
function getDaemonPaths(projectPath: string): { pidFile: string; logFile: string; logDir: string } {
  return {
    pidFile: path.join(projectPath, DAEMON_PID_FILE),
    logFile: path.join(projectPath, DAEMON_LOG_FILE),
    logDir: path.join(projectPath, '.orchestrator', 'logs'),
  };
}

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
 * Spawn the orchestrator as a background daemon
 */
export function spawnDaemon(
  projectPath: string,
  command: string,
  args: string[]
): { success: boolean; pid?: number; error?: string } {
  const paths = getDaemonPaths(projectPath);

  // Check if daemon is already running
  const existing = getDaemonStatus(projectPath);
  if (existing.running) {
    return {
      success: false,
      error: `Daemon already running (PID ${existing.pid}). Use 'orchestrate stop' first.`,
    };
  }

  // Ensure log directory exists
  if (!existsSync(paths.logDir)) {
    mkdirSync(paths.logDir, { recursive: true });
  }

  // Build the command to run
  // We spawn ourselves with the same command but without --background
  const filteredArgs = args.filter((arg) => arg !== '--background' && arg !== '-b');

  // Get the path to our CLI entry point
  const cliPath = process.argv[1];
  if (!cliPath) {
    return { success: false, error: 'Could not determine CLI path' };
  }

  // Open log file for writing (stdout and stderr will write directly to it)
  const logFd = openSync(paths.logFile, 'a');

  // Write startup header to log
  const startupLog = createWriteStream(paths.logFile, { flags: 'a' });
  const timestamp = new Date().toISOString();
  startupLog.write(`\n${'='.repeat(60)}\n`);
  startupLog.write(`Daemon started at ${timestamp}\n`);
  startupLog.write(`Command: orchestrate ${command} ${filteredArgs.join(' ')}\n`);
  startupLog.write(`${'='.repeat(60)}\n\n`);
  startupLog.end();

  // Spawn detached process with stdout/stderr going directly to log file
  const child: ChildProcess = spawn(process.execPath, [cliPath, command, ...filteredArgs], {
    cwd: projectPath,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      ORCHESTRATOR_DAEMON: 'true',
      FORCE_COLOR: '0', // Disable colors in log file
    },
  });

  if (!child.pid) {
    return { success: false, error: 'Failed to get process PID' };
  }

  // Save daemon info
  const daemonInfo: DaemonInfo = {
    pid: child.pid,
    command,
    args: filteredArgs,
    startedAt: new Date(),
    projectPath,
  };

  writeFileSync(paths.pidFile, JSON.stringify(daemonInfo, null, 2));

  // Detach from parent
  child.unref();

  return { success: true, pid: child.pid };
}

/**
 * Get daemon status
 */
export function getDaemonStatus(projectPath: string): {
  running: boolean;
  pid?: number;
  info?: DaemonInfo;
} {
  const paths = getDaemonPaths(projectPath);

  if (!existsSync(paths.pidFile)) {
    return { running: false };
  }

  try {
    const content = readFileSync(paths.pidFile, 'utf-8');
    const info = JSON.parse(content) as DaemonInfo;
    info.startedAt = new Date(info.startedAt);

    if (isProcessRunning(info.pid)) {
      return { running: true, pid: info.pid, info };
    } else {
      // Process not running, clean up stale PID file
      unlinkSync(paths.pidFile);
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

/**
 * Stop the daemon
 */
export function stopDaemon(projectPath: string): { success: boolean; error?: string } {
  const status = getDaemonStatus(projectPath);

  if (!status.running || !status.pid) {
    return { success: false, error: 'No daemon is running' };
  }

  try {
    // Send SIGTERM first for graceful shutdown
    process.kill(status.pid, 'SIGTERM');

    // Wait a bit and check if it's still running
    setTimeout(() => {
      if (isProcessRunning(status.pid!)) {
        // Force kill if still running
        process.kill(status.pid!, 'SIGKILL');
      }
    }, 5000);

    // Clean up PID file
    const paths = getDaemonPaths(projectPath);
    if (existsSync(paths.pidFile)) {
      unlinkSync(paths.pidFile);
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Tail the daemon log file
 */
export async function tailLogs(
  projectPath: string,
  options: { lines?: number; follow?: boolean } = {}
): Promise<void> {
  const paths = getDaemonPaths(projectPath);
  const { lines = 50, follow = false } = options;

  if (!existsSync(paths.logFile)) {
    console.log(chalk.yellow('No daemon logs found.'));
    return;
  }

  // Read last N lines
  const content = readFileSync(paths.logFile, 'utf-8');
  const allLines = content.split('\n');
  const lastLines = allLines.slice(-lines);
  console.log(lastLines.join('\n'));

  if (follow) {
    console.log(chalk.dim('\n--- Following log (Ctrl+C to stop) ---\n'));

    // Watch for new content
    let lastSize = 0;

    const watcher = watch(paths.logFile, (eventType) => {
      if (eventType === 'change') {
        const newContent = readFileSync(paths.logFile, 'utf-8');
        if (newContent.length > lastSize) {
          process.stdout.write(newContent.slice(lastSize));
          lastSize = newContent.length;
        }
      }
    });

    // Initialize lastSize
    lastSize = content.length;

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      watcher.close();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  }
}

/**
 * Print daemon status in a formatted way
 */
export function printDaemonStatus(projectPath: string): void {
  const status = getDaemonStatus(projectPath);

  if (!status.running) {
    console.log(chalk.dim('Daemon: ') + chalk.yellow('Not running'));
    return;
  }

  const info = status.info!;
  const elapsed = Date.now() - info.startedAt.getTime();
  const elapsedStr = formatElapsed(elapsed);

  console.log(chalk.dim('Daemon: ') + chalk.green('Running'));
  console.log(chalk.dim('  PID: ') + status.pid);
  console.log(chalk.dim('  Command: ') + `orchestrate ${info.command} ${info.args.join(' ')}`);
  console.log(chalk.dim('  Running for: ') + elapsedStr);
  console.log(chalk.dim('  Logs: ') + path.join(projectPath, DAEMON_LOG_FILE));
}

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
