/**
 * Vercel Deployer
 *
 * Handles deployment to Vercel via Git-based deployments.
 * Staging deployments push to a staging branch (preview URL).
 * Production deployments push to main (production URL).
 *
 * @module vercel-deployer
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { sessionManager } from './session-manager.js';

export interface DeployResult {
  success: boolean;
  url?: string;
  error?: string;
  branch?: string;
}

export class VercelDeployer {
  private projectPath: string;
  private projectName: string;

  constructor(projectPath: string, projectName?: string) {
    this.projectPath = projectPath;
    this.projectName = projectName ?? path.basename(projectPath);
  }

  /**
   * Deploy to staging (preview URL)
   * Pushes current HEAD to 'staging' branch which triggers Vercel preview deployment
   */
  async deployStaging(): Promise<DeployResult> {
    try {
      // Ensure we have changes committed
      const status = await this.execGit(['status', '--porcelain']);
      if (status.trim()) {
        return {
          success: false,
          error: 'Uncommitted changes detected. Commit all changes before deploying.',
        };
      }

      // Create or update staging branch from main
      try {
        // Delete local staging branch if it exists (to reset it)
        await this.execGit(['branch', '-D', 'staging']).catch(() => {});

        // Create staging from current HEAD (which should be main after merges)
        await this.execGit(['checkout', '-b', 'staging']);

        // Push staging branch to remote (force to ensure it matches main)
        await this.execGit(['push', 'origin', 'staging', '--force']);

        // Switch back to main
        await this.execGit(['checkout', 'main']);
      } catch (error) {
        // Switch back to main even if there's an error
        await this.execGit(['checkout', 'main']).catch(() => {});

        return {
          success: false,
          error: `Failed to push staging branch: ${error}`,
        };
      }

      // Construct staging URL
      const stagingUrl = this.getStagingUrl();

      return {
        success: true,
        url: stagingUrl,
        branch: 'staging',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Deploy to production
   * Pushes to main branch which triggers Vercel production deployment
   */
  async deployProduction(): Promise<DeployResult> {
    try {
      // Ensure we're on main
      const currentBranch = await this.getCurrentBranch();
      if (currentBranch !== 'main') {
        await this.execGit(['checkout', 'main']);
      }

      // Push to remote main
      await this.execGit(['push', 'origin', 'main']);

      // Construct production URL
      const productionUrl = this.getProductionUrl();

      return {
        success: true,
        url: productionUrl,
        branch: 'main',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the staging (preview) URL for the project
   */
  getStagingUrl(): string {
    // Vercel preview URLs use the pattern: [project]-[branch]-[team].vercel.app
    // For simplicity, we'll use the common pattern
    const sanitizedName = this.sanitizeProjectName(this.projectName);
    return `https://${sanitizedName}-staging.vercel.app`;
  }

  /**
   * Get the production URL for the project
   */
  getProductionUrl(): string {
    const sanitizedName = this.sanitizeProjectName(this.projectName);
    return `https://${sanitizedName}.vercel.app`;
  }

  /**
   * Check if remote origin is configured
   */
  async hasRemote(): Promise<boolean> {
    try {
      const remotes = await this.execGit(['remote', '-v']);
      return remotes.includes('origin');
    } catch {
      return false;
    }
  }

  /**
   * Get current branch name
   */
  private async getCurrentBranch(): Promise<string> {
    const result = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.trim();
  }

  /**
   * Sanitize project name for URL
   */
  private sanitizeProjectName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
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
 * Factory function to create a VercelDeployer
 */
export function createVercelDeployer(projectPath: string, projectName?: string): VercelDeployer {
  return new VercelDeployer(projectPath, projectName);
}
