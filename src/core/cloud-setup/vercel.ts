import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { credentialManager } from '../credential-manager.js';

const VERCEL_API_URL = 'https://api.vercel.com';

export interface VercelProjectInfo {
  id: string;
  name: string;
  accountId: string;
  framework: string | null;
  url: string;
}

export interface VercelSetupResult {
  success: boolean;
  project?: VercelProjectInfo;
  error?: string;
}

interface VercelGitConfig {
  type: 'github';
  repo: string;
  productionBranch: string;
}

export class VercelSetup {
  private projectPath: string;
  private projectName: string;
  private accessToken: string | null = null;

  constructor(projectPath: string, projectName: string) {
    this.projectPath = projectPath;
    this.projectName = projectName;
  }

  /**
   * Check if we have a valid Vercel access token
   */
  async checkAuth(): Promise<{ authenticated: boolean; username?: string; error?: string }> {
    await credentialManager.initialize();
    const credential = await credentialManager.getCredential('vercel', this.projectPath);

    if (!credential?.accessToken) {
      return { authenticated: false, error: 'No Vercel access token found' };
    }

    this.accessToken = credential.accessToken;

    // Verify token by getting user info
    try {
      const response = await fetch(`${VERCEL_API_URL}/v2/user`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return { authenticated: false, error: 'Invalid Vercel access token' };
      }

      const data = await response.json() as { user: { username: string } };
      return { authenticated: true, username: data.user.username };
    } catch (error) {
      return { authenticated: false, error: 'Failed to verify Vercel token' };
    }
  }

  /**
   * Prompt user for Vercel access token
   */
  async authenticate(): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.cyan('\nVercel Authentication'));
    console.log(chalk.dim('To create a Vercel project, you need an access token.'));
    console.log(chalk.dim('1. Go to https://vercel.com/account/tokens'));
    console.log(chalk.dim('2. Create a new token'));
    console.log(chalk.dim('3. Paste it below'));
    console.log();

    const token = await new Promise<string>((resolve) => {
      rl.question(chalk.bold('  Access Token: '), (answer) => {
        resolve(answer.trim());
      });
    });

    rl.close();

    if (!token) {
      return false;
    }

    // Verify token
    try {
      const response = await fetch(`${VERCEL_API_URL}/v2/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(chalk.red('  Invalid token. Please try again.'));
        return false;
      }

      // Store token
      this.accessToken = token;
      await credentialManager.setCredential(
        'vercel',
        { accessToken: token },
        this.projectPath
      );

      console.log(chalk.green('  ✓ Authenticated with Vercel'));
      return true;
    } catch {
      console.log(chalk.red('  Failed to verify token.'));
      return false;
    }
  }

  /**
   * Create a new Vercel project
   */
  async createProject(framework: string = 'nextjs'): Promise<VercelProjectInfo> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${VERCEL_API_URL}/v9/projects`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: this.projectName,
        framework: framework,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      if (error.includes('already exists')) {
        throw new Error(`Project '${this.projectName}' already exists on Vercel`);
      }
      throw new Error(`Failed to create project: ${error}`);
    }

    const project = await response.json() as {
      id: string;
      name: string;
      accountId: string;
      framework: string | null;
    };

    return {
      id: project.id,
      name: project.name,
      accountId: project.accountId,
      framework: project.framework,
      url: `https://vercel.com/${project.accountId}/${project.name}`,
    };
  }

  /**
   * Link project to GitHub repository
   */
  async linkGitHub(owner: string, repo: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const gitConfig: VercelGitConfig = {
      type: 'github',
      repo: `${owner}/${repo}`,
      productionBranch: 'main',
    };

    const response = await fetch(`${VERCEL_API_URL}/v9/projects/${this.projectName}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gitRepository: gitConfig,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to link GitHub: ${error}`);
    }
  }

  /**
   * Set environment variables
   */
  async setEnvVars(
    vars: Record<string, string>,
    targets: Array<'production' | 'preview' | 'development'> = ['production', 'preview']
  ): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const envVars = Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      type: 'encrypted',
      target: targets,
    }));

    for (const envVar of envVars) {
      const response = await fetch(`${VERCEL_API_URL}/v10/projects/${this.projectName}/env`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envVar),
      });

      if (!response.ok) {
        // Try to update if it already exists
        const updateResponse = await fetch(
          `${VERCEL_API_URL}/v10/projects/${this.projectName}/env/${envVar.key}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              value: envVar.value,
              target: envVar.target,
            }),
          }
        );

        if (!updateResponse.ok) {
          console.log(chalk.yellow(`  Warning: Could not set env var ${envVar.key}`));
        }
      }
    }
  }

  /**
   * Get the Vercel project URL for a specific branch
   */
  getDeploymentUrl(branch: string = 'main'): string {
    if (branch === 'main') {
      return `https://${this.projectName}.vercel.app`;
    }
    return `https://${this.projectName}-${branch}.vercel.app`;
  }

  /**
   * Full setup: authenticate, create project, link GitHub, set env vars
   */
  async setup(
    githubOwner?: string,
    githubRepo?: string,
    supabaseCredentials?: {
      projectUrl: string;
      anonKey: string;
      serviceRoleKey: string;
      databaseUrl: string;
    },
    framework: string = 'nextjs'
  ): Promise<VercelSetupResult> {
    try {
      // Check/establish auth
      const authStatus = await this.checkAuth();
      if (!authStatus.authenticated) {
        const authenticated = await this.authenticate();
        if (!authenticated) {
          return { success: false, error: 'Authentication failed' };
        }
      }

      // Create project
      console.log(chalk.blue('  Creating Vercel project...'));
      const project = await this.createProject(framework);
      console.log(chalk.green(`  ✓ Project created: ${project.name}`));

      // Link to GitHub if provided
      if (githubOwner && githubRepo) {
        console.log(chalk.blue('  Linking to GitHub...'));
        try {
          await this.linkGitHub(githubOwner, githubRepo);
          console.log(chalk.green(`  ✓ Linked to ${githubOwner}/${githubRepo}`));
        } catch (error) {
          // GitHub linking may fail if Vercel doesn't have access to the repo
          console.log(chalk.yellow(`  ⚠ Could not auto-link GitHub. Link manually in Vercel dashboard.`));
        }
      }

      // Set Supabase environment variables if provided
      if (supabaseCredentials) {
        console.log(chalk.blue('  Configuring environment variables...'));
        await this.setEnvVars({
          'NEXT_PUBLIC_SUPABASE_URL': supabaseCredentials.projectUrl,
          'NEXT_PUBLIC_SUPABASE_ANON_KEY': supabaseCredentials.anonKey,
          'SUPABASE_SERVICE_ROLE_KEY': supabaseCredentials.serviceRoleKey,
          'DATABASE_URL': supabaseCredentials.databaseUrl,
        });
        console.log(chalk.green('  ✓ Environment variables configured'));
      }

      return { success: true, project };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Delete a Vercel project (for rollback)
   */
  async deleteProject(): Promise<void> {
    if (!this.accessToken) {
      const authStatus = await this.checkAuth();
      if (!authStatus.authenticated) {
        throw new Error('Not authenticated');
      }
    }

    const response = await fetch(`${VERCEL_API_URL}/v9/projects/${this.projectName}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete project: ${response.statusText}`);
    }
  }
}
