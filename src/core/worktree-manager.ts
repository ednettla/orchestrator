import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import type { Worktree } from './types.js';
import type { StateStore } from '../state/store.js';

export interface MergeResult {
  success: boolean;
  conflictFiles?: string[];
  error?: string;
}

export interface WorktreeManager {
  create(sessionId: string, requirementId: string, slug: string): Promise<Worktree>;
  list(sessionId: string): Promise<Worktree[]>;
  merge(worktreeId: string, targetBranch?: string): Promise<MergeResult>;
  cleanup(worktreeId: string): Promise<void>;
  getPath(worktreeId: string): string | null;
  getWorktreeInfo(worktreeId: string): Worktree | null;
  isGitRepo(): Promise<boolean>;
  getCurrentBranch(): Promise<string>;
}

interface WorktreeManagerOptions {
  projectPath: string;
  store: StateStore;
}

export class GitWorktreeManager implements WorktreeManager {
  private projectPath: string;
  private store: StateStore;
  private worktreesDir: string;

  constructor(options: WorktreeManagerOptions) {
    this.projectPath = options.projectPath;
    this.store = options.store;
    this.worktreesDir = path.join(this.projectPath, '.orchestrator', 'worktrees');
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.execGit(['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(): Promise<string> {
    const result = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.trim();
  }

  async create(sessionId: string, requirementId: string, slug: string): Promise<Worktree> {
    // Create branch name from requirement ID and slug
    const branchName = `feature/${requirementId.substring(0, 8)}-${this.slugify(slug)}`;
    const worktreePath = path.join(this.worktreesDir, requirementId);

    // Ensure worktrees directory exists
    if (!existsSync(this.worktreesDir)) {
      mkdirSync(this.worktreesDir, { recursive: true });
    }

    // Check if we're in a git repo
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      throw new Error('Not a git repository. Initialize git first with: git init');
    }

    // Get current branch to use as base
    const baseBranch = await this.getCurrentBranch();

    // Create the worktree with a new branch
    try {
      await this.execGit([
        'worktree', 'add',
        '-b', branchName,
        worktreePath,
        baseBranch,
      ]);
    } catch (error) {
      // Branch might already exist, try without -b
      try {
        await this.execGit([
          'worktree', 'add',
          worktreePath,
          branchName,
        ]);
      } catch {
        throw new Error(`Failed to create worktree: ${error}`);
      }
    }

    // Store worktree info in database
    const worktree = this.store.createWorktree({
      sessionId,
      requirementId,
      branchName,
      worktreePath,
    });

    return worktree;
  }

  async list(sessionId: string): Promise<Worktree[]> {
    return this.store.getWorktreesBySession(sessionId);
  }

  async merge(worktreeId: string, targetBranch?: string): Promise<MergeResult> {
    const worktree = this.store.getWorktree(worktreeId);
    if (!worktree) {
      return {
        success: false,
        error: 'Worktree not found',
      };
    }

    // Ensure we're on the target branch
    const target = targetBranch ?? 'main';
    try {
      await this.execGit(['checkout', target]);
    } catch (error) {
      return {
        success: false,
        error: `Failed to checkout ${target}: ${error}`,
      };
    }

    // Merge the feature branch into target
    try {
      await this.execGit(['merge', worktree.branchName, '--no-ff', '-m',
        `Merge ${worktree.branchName} into ${target}`]);
    } catch (error) {
      // Check for merge conflicts
      const conflictFiles = await this.getConflictFiles();
      if (conflictFiles.length > 0) {
        // Abort the merge to leave repo in clean state
        await this.execGit(['merge', '--abort']).catch(() => {});

        return {
          success: false,
          conflictFiles,
          error: `Merge conflict in files: ${conflictFiles.join(', ')}`,
        };
      }

      return {
        success: false,
        error: `Merge failed: ${error}`,
      };
    }

    // Update worktree status
    this.store.updateWorktree(worktreeId, {
      status: 'merged',
      mergedAt: new Date(),
    });

    // Clean up the worktree
    await this.cleanup(worktreeId);

    return { success: true };
  }

  /**
   * Get list of files with merge conflicts
   */
  private async getConflictFiles(): Promise<string[]> {
    try {
      const result = await this.execGit(['diff', '--name-only', '--diff-filter=U']);
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get worktree info by ID
   */
  getWorktreeInfo(worktreeId: string): Worktree | null {
    return this.store.getWorktree(worktreeId);
  }

  async cleanup(worktreeId: string): Promise<void> {
    const worktree = this.store.getWorktree(worktreeId);
    if (!worktree) {
      throw new Error('Worktree not found');
    }

    // Remove git worktree
    try {
      await this.execGit(['worktree', 'remove', worktree.worktreePath, '--force']);
    } catch {
      // Worktree might already be removed, try to clean up directory manually
      if (existsSync(worktree.worktreePath)) {
        rmSync(worktree.worktreePath, { recursive: true, force: true });
      }
    }

    // Prune worktree references (non-critical, continue on failure)
    try {
      await this.execGit(['worktree', 'prune']);
    } catch {
      // Prune failure is non-critical - worktree is already removed
    }

    // Update status if not already merged
    if (worktree.status === 'active') {
      this.store.updateWorktree(worktreeId, { status: 'abandoned' });
    }
  }

  getPath(worktreeId: string): string | null {
    const worktree = this.store.getWorktree(worktreeId);
    return worktree?.worktreePath ?? null;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30);
  }

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

export function createWorktreeManager(projectPath: string, store: StateStore): WorktreeManager {
  return new GitWorktreeManager({ projectPath, store });
}
