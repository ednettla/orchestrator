/**
 * Project Bridge
 *
 * Interface between Telegram commands and orchestrator CLI.
 * Executes commands and retrieves project state.
 *
 * @module telegram/project-bridge
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectStatus, ProjectPhase, RequirementsSummary } from './types.js';

// ============================================================================
// Project Status
// ============================================================================

/**
 * Get project status from database
 */
export async function getProjectStatus(projectPath: string): Promise<ProjectStatus> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return {
      phase: 'idle',
      daemonRunning: false,
      requirements: {
        pending: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
      },
    };
  }

  try {
    // Dynamic import to avoid loading sqlite at module level
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    // Get session phase
    const session = db.prepare(`
      SELECT status, updated_at FROM sessions
      WHERE project_path = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(projectPath) as { status: string; updated_at: string } | undefined;

    // Get requirement counts
    const reqCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM requirements
      GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    db.close();

    const requirements: RequirementsSummary = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
    };

    for (const row of reqCounts) {
      switch (row.status) {
        case 'pending':
          requirements.pending = row.count;
          break;
        case 'in_progress':
          requirements.inProgress = row.count;
          break;
        case 'completed':
          requirements.completed = row.count;
          break;
        case 'failed':
          requirements.failed = row.count;
          break;
      }
    }

    return {
      phase: mapStatusToPhase(session?.status),
      daemonRunning: await isDaemonRunning(projectPath),
      requirements,
      lastActivity: session?.updated_at ? formatRelativeTime(session.updated_at) : undefined,
    };
  } catch {
    return {
      phase: 'idle',
      daemonRunning: false,
      requirements: {
        pending: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
      },
    };
  }
}

/**
 * Map session status to phase
 */
function mapStatusToPhase(status: string | undefined): ProjectPhase {
  if (!status) return 'idle';

  switch (status) {
    case 'planning':
    case 'pending_approval':
      return 'planning';
    case 'approved':
    case 'executing':
      return 'coding';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

// ============================================================================
// Daemon Status
// ============================================================================

interface DaemonStatusResult {
  running: boolean;
  pid?: number | undefined;
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(projectPath: string): Promise<DaemonStatusResult> {
  const pidFile = path.join(projectPath, '.orchestrator', 'daemon.pid');

  if (!existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pidStr = readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return { running: false };
    }

    // Check if process is running
    const running = await isProcessRunning(pid);
    return { running, pid: running ? pid : undefined };
  } catch {
    return { running: false };
  }
}

/**
 * Check if daemon is running
 */
async function isDaemonRunning(projectPath: string): Promise<boolean> {
  const status = await getDaemonStatus(projectPath);
  return status.running;
}

/**
 * Check if a process is running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Command Execution
// ============================================================================

interface CommandResult {
  success: boolean;
  output: string;
  error?: string | undefined;
}

/**
 * Execute an orchestrator command
 */
export async function executeCommand(
  projectPath: string,
  command: string,
  args: string[] = []
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn('orchestrate', [command, '-p', projectPath, ...args], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: stderr.trim() || undefined,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

/**
 * Start plan command in daemon mode
 */
export async function startPlan(
  projectPath: string,
  goal: string
): Promise<CommandResult> {
  return executeCommand(projectPath, 'plan', [goal, '--background']);
}

/**
 * Start run command in daemon mode
 */
export async function startRun(projectPath: string): Promise<CommandResult> {
  return executeCommand(projectPath, 'run', ['--background']);
}

/**
 * Stop daemon
 */
export async function stopDaemon(projectPath: string): Promise<CommandResult> {
  return executeCommand(projectPath, 'stop', []);
}

/**
 * Add a requirement
 */
export async function addRequirement(
  projectPath: string,
  requirement: string
): Promise<CommandResult> {
  return executeCommand(projectPath, 'add', [requirement]);
}

// ============================================================================
// Requirements
// ============================================================================

interface Requirement {
  id: string;
  title: string;
  status: string;
  priority: number;
  createdAt: string;
}

/**
 * Get requirements list
 */
export async function getRequirements(projectPath: string): Promise<Requirement[]> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return [];
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const rows = db.prepare(`
      SELECT id, title, status, priority, created_at
      FROM requirements
      ORDER BY priority DESC, created_at DESC
      LIMIT 50
    `).all() as Array<{
      id: string;
      title: string;
      status: string;
      priority: number;
      created_at: string;
    }>;

    db.close();

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Logs
// ============================================================================

/**
 * Get recent logs
 */
export async function getRecentLogs(
  projectPath: string,
  lines: number = 20
): Promise<string[]> {
  const logFile = path.join(projectPath, '.orchestrator', 'daemon.log');

  if (!existsSync(logFile)) {
    return [];
  }

  try {
    const content = readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format relative time
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
