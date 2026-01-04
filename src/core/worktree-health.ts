/**
 * Worktree Health Checker
 *
 * Diagnoses and repairs git worktree issues that can cause
 * concurrency failures during plan execution.
 *
 * Common issues:
 * - Orphaned worktrees (directory deleted, git still tracks)
 * - Stale database entries (DB has records, git doesn't)
 * - Locked worktrees (previous crash left locks)
 * - Abandoned worktrees (never cleaned up)
 *
 * @module worktree-health
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { StateStore } from '../state/store.js';
import type { Worktree } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface GitWorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  locked: boolean;
  prunable: boolean;
}

export interface WorktreeIssue {
  type: 'orphaned_git' | 'stale_db' | 'locked' | 'missing_dir' | 'abandoned';
  description: string;
  worktreePath?: string | undefined;
  branchName?: string | undefined;
  dbId?: string | undefined;
  autoFixable: boolean;
}

export interface HealthCheckResult {
  healthy: boolean;
  gitWorktrees: GitWorktreeInfo[];
  dbWorktrees: Worktree[];
  issues: WorktreeIssue[];
  isGitRepo: boolean;
}

export interface RepairResult {
  success: boolean;
  fixed: string[];
  failed: Array<{ issue: string; error: string }>;
}

// ============================================================================
// Worktree Health Checker
// ============================================================================

export class WorktreeHealthChecker {
  private projectPath: string;
  private store: StateStore;

  constructor(projectPath: string, store: StateStore) {
    this.projectPath = projectPath;
    this.store = store;
  }

  /**
   * Run a full health check on worktrees
   */
  async checkHealth(sessionId: string): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      healthy: true,
      gitWorktrees: [],
      dbWorktrees: [],
      issues: [],
      isGitRepo: false,
    };

    // Check if we're in a git repo
    result.isGitRepo = await this.isGitRepo();
    if (!result.isGitRepo) {
      return result;
    }

    // Get git worktrees
    result.gitWorktrees = await this.listGitWorktrees();

    // Get database worktrees
    result.dbWorktrees = this.store.getWorktreesBySession(sessionId);

    // Check for issues
    result.issues = await this.findIssues(result.gitWorktrees, result.dbWorktrees);
    result.healthy = result.issues.length === 0;

    return result;
  }

  /**
   * Find all worktree issues
   */
  private async findIssues(gitWorktrees: GitWorktreeInfo[], dbWorktrees: Worktree[]): Promise<WorktreeIssue[]> {
    const issues: WorktreeIssue[] = [];

    // Map git worktrees by path for quick lookup
    const gitByPath = new Map(gitWorktrees.map(w => [w.path, w]));

    // Map db worktrees by path for quick lookup
    const dbByPath = new Map(dbWorktrees.map(w => [w.worktreePath, w]));

    // Check for locked worktrees
    for (const gitWt of gitWorktrees) {
      if (gitWt.locked) {
        issues.push({
          type: 'locked',
          description: `Worktree is locked: ${gitWt.branch}`,
          worktreePath: gitWt.path,
          branchName: gitWt.branch,
          autoFixable: true,
        });
      }

      // Check for prunable (orphaned) worktrees
      if (gitWt.prunable) {
        issues.push({
          type: 'orphaned_git',
          description: `Orphaned worktree (directory missing): ${gitWt.branch}`,
          worktreePath: gitWt.path,
          branchName: gitWt.branch,
          autoFixable: true,
        });
      }
    }

    // Check for stale database entries (DB has it, git doesn't)
    for (const dbWt of dbWorktrees) {
      if (dbWt.status === 'active') {
        const gitWt = gitByPath.get(dbWt.worktreePath);

        if (!gitWt) {
          // Git doesn't know about this worktree
          issues.push({
            type: 'stale_db',
            description: `Database entry has no corresponding git worktree: ${dbWt.branchName}`,
            worktreePath: dbWt.worktreePath,
            branchName: dbWt.branchName,
            dbId: dbWt.id,
            autoFixable: true,
          });
        } else if (!existsSync(dbWt.worktreePath)) {
          // Directory doesn't exist
          issues.push({
            type: 'missing_dir',
            description: `Worktree directory missing: ${dbWt.worktreePath}`,
            worktreePath: dbWt.worktreePath,
            branchName: dbWt.branchName,
            dbId: dbWt.id,
            autoFixable: true,
          });
        }
      }
    }

    // Check for abandoned worktrees (older than 1 day, still active)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const dbWt of dbWorktrees) {
      if (dbWt.status === 'active' && dbWt.createdAt < oneDayAgo) {
        issues.push({
          type: 'abandoned',
          description: `Worktree appears abandoned (>24h old): ${dbWt.branchName}`,
          worktreePath: dbWt.worktreePath,
          branchName: dbWt.branchName,
          dbId: dbWt.id,
          autoFixable: true,
        });
      }
    }

    return issues;
  }

  /**
   * Repair all auto-fixable issues
   */
  async repair(issues: WorktreeIssue[]): Promise<RepairResult> {
    const result: RepairResult = {
      success: true,
      fixed: [],
      failed: [],
    };

    for (const issue of issues) {
      if (!issue.autoFixable) continue;

      try {
        switch (issue.type) {
          case 'orphaned_git':
            // Prune orphaned worktrees
            await this.execGit(['worktree', 'prune']);
            result.fixed.push(`Pruned orphaned worktree: ${issue.branchName}`);
            break;

          case 'locked':
            // Unlock and remove the worktree
            if (issue.worktreePath) {
              await this.execGit(['worktree', 'unlock', issue.worktreePath]).catch(() => {});
              await this.execGit(['worktree', 'remove', '--force', issue.worktreePath]).catch(() => {});
              result.fixed.push(`Unlocked and removed: ${issue.branchName}`);
            }
            break;

          case 'stale_db':
          case 'missing_dir':
            // Update database to mark as abandoned
            if (issue.dbId) {
              this.store.updateWorktree(issue.dbId, { status: 'abandoned' });
              result.fixed.push(`Marked as abandoned in DB: ${issue.branchName}`);
            }
            break;

          case 'abandoned':
            // Clean up abandoned worktree
            if (issue.worktreePath && issue.dbId) {
              // Try to remove from git
              await this.execGit(['worktree', 'remove', '--force', issue.worktreePath]).catch(() => {});

              // Remove directory if it still exists
              if (existsSync(issue.worktreePath)) {
                rmSync(issue.worktreePath, { recursive: true, force: true });
              }

              // Update database
              this.store.updateWorktree(issue.dbId, { status: 'abandoned' });

              result.fixed.push(`Cleaned up abandoned worktree: ${issue.branchName}`);
            }
            break;
        }
      } catch (error) {
        result.success = false;
        result.failed.push({
          issue: issue.description,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Final prune to clean up any loose references
    await this.execGit(['worktree', 'prune']).catch(() => {});

    return result;
  }

  /**
   * Full cleanup - removes all worktrees and resets to clean state
   */
  async fullCleanup(sessionId: string): Promise<RepairResult> {
    const result: RepairResult = {
      success: true,
      fixed: [],
      failed: [],
    };

    try {
      // Get all worktrees from git
      const gitWorktrees = await this.listGitWorktrees();

      // Remove all worktrees except the main one
      for (const wt of gitWorktrees) {
        // Skip the main worktree (it's the project root)
        if (wt.path === this.projectPath) continue;

        try {
          // Unlock if locked
          if (wt.locked) {
            await this.execGit(['worktree', 'unlock', wt.path]).catch(() => {});
          }

          // Remove the worktree
          await this.execGit(['worktree', 'remove', '--force', wt.path]).catch(() => {});

          // Also remove the directory if it exists
          if (existsSync(wt.path)) {
            rmSync(wt.path, { recursive: true, force: true });
          }

          result.fixed.push(`Removed worktree: ${wt.branch}`);
        } catch (error) {
          result.failed.push({
            issue: `Remove ${wt.branch}`,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Prune any orphaned references
      await this.execGit(['worktree', 'prune']);

      // Mark all database worktrees as abandoned
      const dbWorktrees = this.store.getWorktreesBySession(sessionId);
      for (const dbWt of dbWorktrees) {
        if (dbWt.status === 'active') {
          this.store.updateWorktree(dbWt.id, { status: 'abandoned' });
        }
      }

      // Clean up .orchestrator/worktrees directory
      const worktreesDir = path.join(this.projectPath, '.orchestrator', 'worktrees');
      if (existsSync(worktreesDir)) {
        const entries = readdirSync(worktreesDir);
        for (const entry of entries) {
          const entryPath = path.join(worktreesDir, entry);
          rmSync(entryPath, { recursive: true, force: true });
          result.fixed.push(`Removed directory: ${entry}`);
        }
      }

      // Clean up orphaned feature branches
      const branches = await this.listFeatureBranches();
      for (const branch of branches) {
        try {
          await this.execGit(['branch', '-D', branch]);
          result.fixed.push(`Deleted branch: ${branch}`);
        } catch {
          // Branch deletion failure is non-critical
        }
      }

    } catch (error) {
      result.success = false;
      result.failed.push({
        issue: 'Full cleanup',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  /**
   * List all feature/* branches that might be orphaned
   */
  private async listFeatureBranches(): Promise<string[]> {
    try {
      const output = await this.execGit(['branch', '--list', 'feature/*']);
      return output
        .split('\n')
        .map(b => b.trim().replace(/^\*?\s*/, ''))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * List git worktrees
   */
  private async listGitWorktrees(): Promise<GitWorktreeInfo[]> {
    try {
      const output = await this.execGit(['worktree', 'list', '--porcelain']);
      return this.parseWorktreeList(output);
    } catch {
      return [];
    }
  }

  /**
   * Parse git worktree list --porcelain output
   */
  private parseWorktreeList(output: string): GitWorktreeInfo[] {
    const worktrees: GitWorktreeInfo[] = [];
    const blocks = output.trim().split('\n\n');

    for (const block of blocks) {
      if (!block.trim()) continue;

      const lines = block.split('\n');
      const info: Partial<GitWorktreeInfo> = {
        locked: false,
        prunable: false,
      };

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          info.path = line.substring(9);
        } else if (line.startsWith('HEAD ')) {
          info.commit = line.substring(5);
        } else if (line.startsWith('branch ')) {
          info.branch = line.substring(7).replace('refs/heads/', '');
        } else if (line === 'locked') {
          info.locked = true;
        } else if (line.startsWith('locked ')) {
          info.locked = true;
        } else if (line === 'prunable') {
          info.prunable = true;
        } else if (line.startsWith('prunable ')) {
          info.prunable = true;
        } else if (line === 'detached') {
          info.branch = 'detached';
        }
      }

      if (info.path) {
        worktrees.push({
          path: info.path,
          branch: info.branch ?? 'unknown',
          commit: info.commit ?? '',
          locked: info.locked ?? false,
          prunable: info.prunable ?? false,
        });
      }
    }

    return worktrees;
  }

  /**
   * Check if we're in a git repo
   */
  private async isGitRepo(): Promise<boolean> {
    try {
      await this.execGit(['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a git command
   */
  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: this.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Git command failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
}

/**
 * Factory function
 */
export function createWorktreeHealthChecker(projectPath: string, store: StateStore): WorktreeHealthChecker {
  return new WorktreeHealthChecker(projectPath, store);
}
