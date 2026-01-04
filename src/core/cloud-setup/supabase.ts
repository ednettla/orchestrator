import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { credentialManager } from '../credential-manager.js';

const SUPABASE_API_URL = 'https://api.supabase.com/v1';

export interface SupabaseProjectInfo {
  id: string;
  organizationId: string;
  name: string;
  region: string;
  createdAt: string;
}

export interface SupabaseCredentials {
  projectUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl: string;
  projectRef: string;
}

export interface SupabaseSetupResult {
  success: boolean;
  project?: SupabaseProjectInfo;
  credentials?: SupabaseCredentials;
  error?: string;
}

interface SupabaseOrganization {
  id: string;
  name: string;
}

interface SupabaseApiKey {
  name: string;
  api_key: string;
}

export class SupabaseSetup {
  private projectPath: string;
  private projectName: string;
  private accessToken: string | null = null;

  constructor(projectPath: string, projectName: string) {
    this.projectPath = projectPath;
    this.projectName = projectName;
  }

  /**
   * Check if we have a valid Supabase access token
   */
  async checkAuth(): Promise<{ authenticated: boolean; error?: string }> {
    await credentialManager.initialize();
    const credential = await credentialManager.getCredential('supabase-management', this.projectPath);

    if (!credential?.accessToken) {
      return { authenticated: false, error: 'No Supabase access token found' };
    }

    this.accessToken = credential.accessToken;

    // Verify token by listing organizations
    try {
      const response = await fetch(`${SUPABASE_API_URL}/organizations`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return { authenticated: false, error: 'Invalid Supabase access token' };
      }

      return { authenticated: true };
    } catch (error) {
      return { authenticated: false, error: 'Failed to verify Supabase token' };
    }
  }

  /**
   * Prompt user for Supabase access token
   */
  async authenticate(): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.cyan('\nSupabase Authentication'));
    console.log(chalk.dim('To create a Supabase project, you need an access token.'));
    console.log(chalk.dim('1. Go to https://supabase.com/dashboard/account/tokens'));
    console.log(chalk.dim('2. Create a new access token'));
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
      const response = await fetch(`${SUPABASE_API_URL}/organizations`, {
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
        'supabase-management',
        { accessToken: token },
        this.projectPath
      );

      console.log(chalk.green('  ✓ Authenticated with Supabase'));
      return true;
    } catch {
      console.log(chalk.red('  Failed to verify token.'));
      return false;
    }
  }

  /**
   * Get list of organizations
   */
  private async getOrganizations(): Promise<SupabaseOrganization[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_API_URL}/organizations`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get organizations: ${response.statusText}`);
    }

    return response.json() as Promise<SupabaseOrganization[]>;
  }

  /**
   * Create a new Supabase project
   */
  async createProject(region: string = 'us-east-1'): Promise<SupabaseProjectInfo> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    // Get organization ID
    const orgs = await this.getOrganizations();
    if (orgs.length === 0) {
      throw new Error('No Supabase organizations found. Create one at supabase.com first.');
    }

    // Use first organization (most users have only one)
    const orgId = orgs[0]!.id;

    // Generate a database password
    const dbPassword = this.generatePassword();

    // Create project
    const response = await fetch(`${SUPABASE_API_URL}/projects`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id: orgId,
        name: this.projectName,
        db_pass: dbPassword,
        region: region,
        plan: 'free',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create project: ${error}`);
    }

    const project = await response.json() as {
      id: string;
      organization_id: string;
      name: string;
      region: string;
      created_at: string;
    };

    return {
      id: project.id,
      organizationId: project.organization_id,
      name: project.name,
      region: project.region,
      createdAt: project.created_at,
    };
  }

  /**
   * Get project API keys and credentials
   */
  async getCredentials(projectRef: string): Promise<SupabaseCredentials> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    // Get API keys
    const keysResponse = await fetch(`${SUPABASE_API_URL}/projects/${projectRef}/api-keys`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!keysResponse.ok) {
      throw new Error(`Failed to get API keys: ${keysResponse.statusText}`);
    }

    const keys = await keysResponse.json() as SupabaseApiKey[];
    const anonKey = keys.find(k => k.name === 'anon')?.api_key ?? '';
    const serviceRoleKey = keys.find(k => k.name === 'service_role')?.api_key ?? '';

    // Build URLs
    const projectUrl = `https://${projectRef}.supabase.co`;
    const databaseUrl = `postgresql://postgres:[YOUR-PASSWORD]@db.${projectRef}.supabase.co:5432/postgres`;

    return {
      projectUrl,
      anonKey,
      serviceRoleKey,
      databaseUrl,
      projectRef,
    };
  }

  /**
   * Wait for project to be ready (creation is async)
   */
  async waitForProjectReady(projectRef: string, maxWaitMs: number = 120000): Promise<boolean> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const startTime = Date.now();
    const pollInterval = 5000;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await fetch(`${SUPABASE_API_URL}/projects/${projectRef}`, {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const project = await response.json() as { status: string };
          if (project.status === 'ACTIVE_HEALTHY') {
            return true;
          }
        }
      } catch {
        // Ignore errors during polling
      }

      await this.sleep(pollInterval);
      process.stdout.write(chalk.dim('.'));
    }

    return false;
  }

  /**
   * Full setup: authenticate, create project, get credentials
   */
  async setup(region: string = 'us-east-1'): Promise<SupabaseSetupResult> {
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
      console.log(chalk.blue('  Creating Supabase project...'));
      const project = await this.createProject(region);
      console.log(chalk.green(`  ✓ Project created: ${project.name}`));

      // Wait for project to be ready
      console.log(chalk.dim('  Waiting for project to be ready'));
      const ready = await this.waitForProjectReady(project.id);
      console.log(); // New line after dots

      if (!ready) {
        return {
          success: true,
          project,
          error: 'Project created but may still be initializing. Check Supabase dashboard.',
        };
      }

      // Get credentials
      console.log(chalk.blue('  Retrieving credentials...'));
      const credentials = await this.getCredentials(project.id);
      console.log(chalk.green('  ✓ Credentials retrieved'));

      // Store project credentials for MCP
      await credentialManager.setCredential(
        'supabase',
        {
          projectUrl: credentials.projectUrl,
          apiKey: credentials.anonKey,
          metadata: {
            serviceRoleKey: credentials.serviceRoleKey,
            projectRef: credentials.projectRef,
          },
        },
        this.projectPath
      );

      return {
        success: true,
        project,
        credentials,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Delete a Supabase project (for rollback)
   */
  async deleteProject(projectRef: string): Promise<void> {
    if (!this.accessToken) {
      const authStatus = await this.checkAuth();
      if (!authStatus.authenticated) {
        throw new Error('Not authenticated');
      }
    }

    const response = await fetch(`${SUPABASE_API_URL}/projects/${projectRef}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete project: ${response.statusText}`);
    }
  }

  private generatePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 32; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
