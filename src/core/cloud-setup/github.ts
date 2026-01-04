import { spawn } from 'node:child_process';
import chalk from 'chalk';

export interface GitHubRepoInfo {
  owner: string;
  name: string;
  url: string;
  sshUrl: string;
  httpsUrl: string;
}

export interface GitHubSetupResult {
  success: boolean;
  repo?: GitHubRepoInfo;
  error?: string;
}

export class GitHubSetup {
  private projectPath: string;
  private projectName: string;

  constructor(projectPath: string, projectName: string) {
    this.projectPath = projectPath;
    this.projectName = projectName;
  }

  /**
   * Check if GitHub CLI is installed and authenticated
   */
  async checkAuth(): Promise<{ authenticated: boolean; username?: string; error?: string }> {
    try {
      const result = await this.execCommand('gh', ['auth', 'status']);
      // Parse username from output
      const match = result.match(/Logged in to github\.com account (\S+)/i)
        || result.match(/Logged in to github\.com as (\S+)/i);
      const username = match?.[1]?.replace(/[()]/, '');
      if (username) {
        return { authenticated: true, username };
      }
      return { authenticated: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('not installed')) {
        return { authenticated: false, error: 'GitHub CLI (gh) is not installed' };
      }
      return { authenticated: false, error: 'Not authenticated with GitHub CLI' };
    }
  }

  /**
   * Check if git is initialized in the project
   */
  async isGitInitialized(): Promise<boolean> {
    try {
      await this.execCommand('git', ['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize git repository if not already initialized
   */
  async initGit(): Promise<void> {
    const isInit = await this.isGitInitialized();
    if (!isInit) {
      await this.execCommand('git', ['init']);
      await this.execCommand('git', ['add', '.']);
      await this.execCommand('git', ['commit', '-m', 'Initial commit']);
    }
  }

  /**
   * Create a new GitHub repository
   */
  async createRepo(isPrivate: boolean = true): Promise<GitHubRepoInfo> {
    // Ensure git is initialized
    await this.initGit();

    // Create repo and push
    const visibility = isPrivate ? '--private' : '--public';
    const args = ['repo', 'create', this.projectName, visibility, '--source=.', '--push'];

    try {
      await this.execCommand('gh', args);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('already exists')) {
        throw new Error(`Repository '${this.projectName}' already exists on GitHub`);
      }
      throw error;
    }

    // Get repo info
    const repoInfo = await this.getRepoInfo();
    return repoInfo;
  }

  /**
   * Get information about the current repo
   */
  async getRepoInfo(): Promise<GitHubRepoInfo> {
    const output = await this.execCommand('gh', ['repo', 'view', '--json', 'owner,name,url,sshUrl']);
    const data = JSON.parse(output);
    return {
      owner: data.owner.login,
      name: data.name,
      url: data.url,
      sshUrl: data.sshUrl,
      httpsUrl: `https://github.com/${data.owner.login}/${data.name}.git`,
    };
  }

  /**
   * Create staging branch and push to origin
   */
  async createStagingBranch(): Promise<void> {
    // Check if staging branch already exists
    try {
      await this.execCommand('git', ['rev-parse', '--verify', 'staging']);
      console.log(chalk.dim('  Staging branch already exists'));
      return;
    } catch {
      // Branch doesn't exist, create it
    }

    // Create and push staging branch
    await this.execCommand('git', ['checkout', '-b', 'staging']);
    await this.execCommand('git', ['push', '-u', 'origin', 'staging']);

    // Switch back to main
    await this.execCommand('git', ['checkout', 'main']);
  }

  /**
   * Set repository secrets
   */
  async setSecrets(secrets: Record<string, string>): Promise<void> {
    for (const [name, value] of Object.entries(secrets)) {
      await this.execCommand('gh', ['secret', 'set', name], value);
      console.log(chalk.dim(`  Set secret: ${name}`));
    }
  }

  /**
   * Set environment-specific secrets
   */
  async setEnvironmentSecrets(
    environment: string,
    secrets: Record<string, string>
  ): Promise<void> {
    for (const [name, value] of Object.entries(secrets)) {
      await this.execCommand('gh', ['secret', 'set', name, '--env', environment], value);
      console.log(chalk.dim(`  Set ${environment} secret: ${name}`));
    }
  }

  /**
   * Full setup: create repo, staging branch
   */
  async setup(isPrivate: boolean = true): Promise<GitHubSetupResult> {
    try {
      console.log(chalk.blue('  Creating GitHub repository...'));
      const repo = await this.createRepo(isPrivate);
      console.log(chalk.green(`  ✓ Repository created: ${repo.url}`));

      console.log(chalk.blue('  Creating staging branch...'));
      await this.createStagingBranch();
      console.log(chalk.green('  ✓ Staging branch created'));

      return { success: true, repo };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  private execCommand(command: string, args: string[], stdin?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
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

      if (stdin) {
        proc.stdin.write(stdin);
        proc.stdin.end();
      }

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout + stderr);
        } else {
          reject(new Error(stderr || stdout || `Command failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`${command} is not installed or not in PATH`));
        } else {
          reject(err);
        }
      });
    });
  }
}
