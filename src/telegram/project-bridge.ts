/**
 * Project Bridge
 *
 * Interface between Telegram commands and orchestrator CLI.
 * Executes commands and retrieves project state.
 *
 * @module telegram/project-bridge
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
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
  args: string[] = [],
  timeoutMs: number = 60000
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn('orchestrate', [command, '-p', projectPath, ...args], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout.trim(),
          error: `Command timed out after ${timeoutMs / 1000}s`,
        });
      }
    }, timeoutMs);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: code === 0,
          output: stdout.trim(),
          error: stderr.trim() || undefined,
        });
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          output: '',
          error: err.message,
        });
      }
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
 * Get a single requirement by ID
 */
export async function getRequirement(
  projectPath: string,
  requirementId: string
): Promise<Requirement | null> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return null;
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const row = db.prepare(`
      SELECT id, title, raw_input, status, priority, created_at
      FROM requirements
      WHERE id = ?
    `).get(requirementId) as {
      id: string;
      title: string;
      raw_input: string;
      status: string;
      priority: number;
      created_at: string;
    } | undefined;

    db.close();

    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

/**
 * Update requirement text
 */
export async function updateRequirementText(
  projectPath: string,
  requirementId: string,
  newText: string
): Promise<CommandResult> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return { success: false, output: '', error: 'Project not initialized' };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    const result = db.prepare(`
      UPDATE requirements
      SET title = ?, raw_input = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newText, newText, requirementId);

    if (result.changes === 0) {
      return { success: false, output: '', error: 'Requirement not found' };
    }

    return { success: true, output: 'Updated' };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    db.close();
  }
}

/**
 * Update requirement priority
 */
export async function updateRequirementPriority(
  projectPath: string,
  requirementId: string,
  priority: number
): Promise<CommandResult> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return { success: false, output: '', error: 'Project not initialized' };
  }

  // Validate priority range
  if (priority < 0 || priority > 10) {
    return { success: false, output: '', error: 'Priority must be between 0 and 10' };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    const result = db.prepare(`
      UPDATE requirements
      SET priority = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(priority, requirementId);

    if (result.changes === 0) {
      return { success: false, output: '', error: 'Requirement not found' };
    }

    return { success: true, output: 'Updated' };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    db.close();
  }
}

/**
 * Delete requirement
 */
export async function deleteRequirement(
  projectPath: string,
  requirementId: string
): Promise<CommandResult> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return { success: false, output: '', error: 'Project not initialized' };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    // First check if requirement exists and is not in_progress
    const req = db.prepare(`
      SELECT status FROM requirements WHERE id = ?
    `).get(requirementId) as { status: string } | undefined;

    if (!req) {
      return { success: false, output: '', error: 'Requirement not found' };
    }

    if (req.status === 'in_progress') {
      return { success: false, output: '', error: 'Cannot delete in-progress requirement' };
    }

    // Use transaction to ensure both deletes succeed or fail together
    const deleteInTransaction = db.transaction(() => {
      // Delete associated tasks first
      db.prepare(`DELETE FROM tasks WHERE requirement_id = ?`).run(requirementId);
      // Delete the requirement
      return db.prepare(`DELETE FROM requirements WHERE id = ?`).run(requirementId);
    });

    const result = deleteInTransaction();

    if (result.changes === 0) {
      return { success: false, output: '', error: 'Requirement not found' };
    }

    return { success: true, output: 'Deleted' };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    db.close();
  }
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

// ============================================================================
// WebApp API Bridge Functions
// ============================================================================

interface ApiResult {
  success: boolean;
  error?: string;
  jobId?: string;
  project?: Record<string, unknown>;
  remainingQuestions?: number;
}

/**
 * Initialize a project from allowed path (for WebApp API)
 */
export async function initProjectFromApi(options: {
  path: string;
  name?: string;
  techStack?: Record<string, string>;
}): Promise<ApiResult> {
  try {
    const args = [];
    if (options.name) {
      args.push('--name', options.name);
    }

    const result = await executeCommand(options.path, 'init', args);

    if (!result.success) {
      return { success: false, error: result.error ?? result.output };
    }

    return {
      success: true,
      project: {
        path: options.path,
        name: options.name ?? path.basename(options.path),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create a new project with just a name (for WebApp API)
 * Creates directory in the configured projects directory and initializes
 */
export async function createProjectSimple(name: string): Promise<ApiResult> {
  try {
    const { getGlobalStore } = await import('../core/global-store.js');
    const store = getGlobalStore();
    const projectsDir = store.getProjectsDirectory();
    const projectPath = path.join(projectsDir, name);

    // Ensure projects directory exists
    await fs.mkdir(projectsDir, { recursive: true });

    // Check if project directory already exists
    try {
      await fs.access(projectPath);
      return { success: false, error: `Project "${name}" already exists` };
    } catch {
      // Directory doesn't exist, which is what we want
    }

    // Create the project directory
    await fs.mkdir(projectPath, { recursive: true });

    // Initialize the project
    return initProjectFromApi({ path: projectPath, name });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Run a single requirement (for WebApp API)
 */
export async function runRequirementFromApi(
  projectPath: string,
  requirementId: string
): Promise<ApiResult> {
  try {
    const result = await executeCommand(projectPath, 'run', [
      '--requirement',
      requirementId,
      '--background',
    ]);

    if (!result.success) {
      return { success: false, error: result.error ?? result.output };
    }

    return {
      success: true,
      jobId: `run-${requirementId}-${Date.now()}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Start planning process (for WebApp API)
 *
 * Creates a plan and starts question generation in the background.
 * The caller should poll for questions via getPlanStatus.
 */
export async function startPlanFromApi(projectPath: string, goal: string): Promise<ApiResult> {
  try {
    // Import SessionManager and PlanController dynamically
    const { sessionManager } = await import('../core/session-manager.js');
    const { PlanController } = await import('../planning/plan-controller.js');

    // Initialize and resume session
    await sessionManager.initialize(projectPath);
    await sessionManager.resumeSession(projectPath);

    const controller = new PlanController(sessionManager);

    // Check for existing active plan
    const existingPlan = controller.getActivePlan();
    if (existingPlan) {
      // Return existing plan - let the caller decide what to do
      return {
        success: true,
        jobId: existingPlan.id,
      };
    }

    // Create new plan
    const plan = await controller.createPlan(goal);

    // Start generating questions in the background (fire and forget)
    // This runs async without blocking the response
    controller.generateQuestions(plan.id).catch((error) => {
      console.error('[PlanWizard] Question generation failed:', error);
    });

    return {
      success: true,
      jobId: plan.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Answer a plan question (for WebApp API)
 */
export async function answerPlanQuestionFromApi(
  projectPath: string,
  questionId: string,
  answer: string
): Promise<ApiResult> {
  // Store answer in the database
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return { success: false, error: 'Project not initialized' };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    // Update the plan artifact with the answer
    const session = db.prepare(`
      SELECT id FROM sessions
      WHERE project_path = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(projectPath) as { id: string } | undefined;

    if (!session) {
      return { success: false, error: 'No active session' };
    }

    const artifact = db.prepare(`
      SELECT content FROM artifacts
      WHERE session_id = ? AND type = 'plan'
    `).get(session.id) as { content: string } | undefined;

    if (!artifact) {
      return { success: false, error: 'No active plan' };
    }

    let planData: Record<string, unknown>;
    try {
      planData = JSON.parse(artifact.content);
    } catch {
      return { success: false, error: 'Invalid plan data' };
    }

    const questions = (planData.clarifyingQuestions as Array<{ id: string; answered?: boolean; answer?: string }>) ?? [];

    // Find and answer the question
    let answered = false;
    for (const q of questions) {
      if (q.id === questionId && !q.answered) {
        q.answered = true;
        q.answer = answer;
        answered = true;
        break;
      }
    }

    if (!answered) {
      return { success: false, error: 'Question not found or already answered' };
    }

    // Update the plan
    planData.clarifyingQuestions = questions;
    db.prepare(`
      UPDATE artifacts
      SET content = ?, updated_at = datetime('now')
      WHERE session_id = ? AND type = 'plan'
    `).run(JSON.stringify(planData), session.id);

    const remaining = questions.filter((q) => !q.answered).length;

    return {
      success: true,
      remainingQuestions: remaining,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    db.close();
  }
}

/**
 * Approve a plan (for WebApp API)
 */
export async function approvePlanFromApi(projectPath: string): Promise<ApiResult> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return { success: false, error: 'Project not initialized' };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    // Update session status to approved
    const result = db.prepare(`
      UPDATE sessions
      SET status = 'approved', updated_at = datetime('now')
      WHERE project_path = ?
      AND status = 'pending_approval'
    `).run(projectPath);

    if (result.changes === 0) {
      return { success: false, error: 'No pending plan to approve' };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    db.close();
  }
}

/**
 * Reject a plan (for WebApp API)
 */
export async function rejectPlanFromApi(
  projectPath: string,
  reason?: string
): Promise<ApiResult> {
  const dbPath = path.join(projectPath, '.orchestrator', 'orchestrator.db');

  if (!existsSync(dbPath)) {
    return { success: false, error: 'Project not initialized' };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    // Update session status to idle (rejected)
    const result = db.prepare(`
      UPDATE sessions
      SET status = 'idle', updated_at = datetime('now')
      WHERE project_path = ?
      AND status = 'pending_approval'
    `).run(projectPath);

    // Optionally store rejection reason in plan artifact
    if (reason) {
      const session = db.prepare(`
        SELECT id FROM sessions
        WHERE project_path = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(projectPath) as { id: string } | undefined;

      if (session) {
        const artifact = db.prepare(`
          SELECT content FROM artifacts
          WHERE session_id = ? AND type = 'plan'
        `).get(session.id) as { content: string } | undefined;

        if (artifact) {
          try {
            const planData = JSON.parse(artifact.content);
            planData.rejectionReason = reason;
            planData.status = 'rejected';

            db.prepare(`
              UPDATE artifacts
              SET content = ?, updated_at = datetime('now')
              WHERE session_id = ? AND type = 'plan'
            `).run(JSON.stringify(planData), session.id);
          } catch {
            // Ignore JSON parse errors for rejection reason storage
          }
        }
      }
    }

    if (result.changes === 0) {
      return { success: false, error: 'No pending plan to reject' };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    db.close();
  }
}

// ============================================================================
// Design System API Functions
// ============================================================================

/**
 * Run design audit (for WebApp API and Telegram)
 */
export async function runDesignAuditFromApi(projectPath: string): Promise<ApiResult> {
  try {
    const result = await executeCommand(projectPath, 'design', ['audit', '--background']);

    if (!result.success) {
      return { success: false, error: result.error ?? result.output };
    }

    return {
      success: true,
      jobId: `design-audit-${Date.now()}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate design system tokens (for WebApp API and Telegram)
 */
export async function generateDesignSystemFromApi(projectPath: string): Promise<ApiResult> {
  try {
    const result = await executeCommand(projectPath, 'design', ['generate', '--background']);

    if (!result.success) {
      return { success: false, error: result.error ?? result.output };
    }

    return {
      success: true,
      jobId: `design-generate-${Date.now()}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Resume interrupted session (for Telegram bot)
 */
export async function resumeSession(projectPath: string): Promise<CommandResult> {
  return executeCommand(projectPath, 'resume', ['--background']);
}

/**
 * Refresh CLAUDE.md (for Telegram bot)
 */
export async function refreshClaudeMd(
  projectPath: string,
  options: { injectSecrets?: boolean; env?: string }
): Promise<CommandResult> {
  const args: string[] = [];
  if (options.injectSecrets) {
    args.push('--inject-secrets');
    if (options.env) {
      args.push(`--env=${options.env}`);
    }
  }
  return executeCommand(projectPath, 'refresh', args);
}

// ============================================================================
// Project Creation
// ============================================================================

interface CreateProjectResult extends CommandResult {
  projectPath?: string;
}

/**
 * Create a new project from Telegram
 * Creates directory and initializes orchestrator
 */
export async function createProject(
  basePath: string,
  projectName: string
): Promise<CreateProjectResult> {
  const projectPath = path.join(basePath, projectName);

  // Ensure base directory exists
  try {
    mkdirSync(basePath, { recursive: true });
  } catch {
    // Ignore if already exists
  }

  // Check if project directory already exists
  if (existsSync(projectPath)) {
    return {
      success: false,
      output: '',
      error: `Directory already exists: ${projectPath}`,
    };
  }

  // Create project directory
  try {
    mkdirSync(projectPath, { recursive: true });
  } catch (err) {
    return {
      success: false,
      output: '',
      error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }

  // Initialize project (non-interactive mode for Telegram)
  const initResult = await executeCommand(projectPath, 'init', [
    '--name', projectName,
    '--no-interactive',
    '--no-cloud',
  ]);

  if (!initResult.success) {
    return {
      success: false,
      output: initResult.output,
      error: initResult.error ?? 'Initialization failed',
    };
  }

  return {
    success: true,
    output: initResult.output,
    projectPath,
  };
}
