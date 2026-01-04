import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { GitHubSetup, type GitHubRepoInfo } from './github.js';
import { SupabaseSetup, type SupabaseCredentials, type SupabaseProjectInfo } from './supabase.js';
import { VercelSetup, type VercelProjectInfo } from './vercel.js';
import type { StateStore } from '../../state/store.js';
import type { CloudService, CloudServiceLink } from '../types.js';

export interface CloudSetupConfig {
  github: boolean;
  supabase: boolean;
  vercel: boolean;
}

export interface PrerequisiteStatus {
  github: { ready: boolean; username?: string; error?: string };
  supabase: { ready: boolean; error?: string };
  vercel: { ready: boolean; username?: string; error?: string };
}

export interface CloudSetupResult {
  success: boolean;
  services: {
    github?: GitHubRepoInfo;
    supabase?: { project: SupabaseProjectInfo; credentials: SupabaseCredentials };
    vercel?: VercelProjectInfo;
  };
  errors: Array<{ service: string; error: string }>;
  links: CloudServiceLink[];
}

interface RollbackState {
  github?: GitHubRepoInfo;
  supabase?: SupabaseProjectInfo;
  vercel?: VercelProjectInfo;
}

export class CloudServicesSetup {
  private projectPath: string;
  private projectName: string;
  private sessionId: string;
  private store: StateStore;

  private githubSetup: GitHubSetup;
  private supabaseSetup: SupabaseSetup;
  private vercelSetup: VercelSetup;

  constructor(
    projectPath: string,
    projectName: string,
    sessionId: string,
    store: StateStore
  ) {
    this.projectPath = projectPath;
    this.projectName = projectName;
    this.sessionId = sessionId;
    this.store = store;

    this.githubSetup = new GitHubSetup(projectPath, projectName);
    this.supabaseSetup = new SupabaseSetup(projectPath, projectName);
    this.vercelSetup = new VercelSetup(projectPath, projectName);
  }

  /**
   * Interactive prompt and setup flow
   */
  async promptAndSetup(): Promise<CloudSetupResult | null> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log();
    console.log(chalk.cyan('Cloud Services Setup'));
    console.log(chalk.dim('Configure GitHub, Supabase, and Vercel for your project.'));
    console.log();

    // Ask if user wants to set up cloud services
    const wantsSetup = await this.askYesNo(rl, 'Would you like to set up cloud services?');

    if (!wantsSetup) {
      rl.close();
      console.log(chalk.dim('Skipping cloud services setup.'));
      return null;
    }

    // Ask which services to configure
    console.log();
    console.log(chalk.bold('Select services to configure:'));

    const config: CloudSetupConfig = {
      github: await this.askYesNo(rl, '  GitHub - Create repository with staging/production branches'),
      supabase: await this.askYesNo(rl, '  Supabase - Create database project'),
      vercel: await this.askYesNo(rl, '  Vercel - Create deployment project'),
    };

    rl.close();

    if (!config.github && !config.supabase && !config.vercel) {
      console.log(chalk.dim('No services selected.'));
      return null;
    }

    // Check prerequisites
    console.log();
    console.log(chalk.bold('Checking prerequisites...'));
    const prereqs = await this.checkPrerequisites(config);
    this.displayPrerequisiteStatus(prereqs, config);

    // Handle missing auth
    const authNeeded = await this.handleMissingAuth(prereqs, config);
    if (!authNeeded) {
      return null;
    }

    // Run setup
    console.log();
    console.log(chalk.bold('Setting up services...'));
    const result = await this.setupServices(config);

    // Display summary
    this.displaySummary(result);

    return result;
  }

  /**
   * Check prerequisites for selected services
   */
  async checkPrerequisites(config?: CloudSetupConfig): Promise<PrerequisiteStatus> {
    const status: PrerequisiteStatus = {
      github: { ready: false },
      supabase: { ready: false },
      vercel: { ready: false },
    };

    // Check GitHub if selected
    if (!config || config.github) {
      const ghStatus = await this.githubSetup.checkAuth();
      status.github = { ready: ghStatus.authenticated };
      if (ghStatus.username) status.github.username = ghStatus.username;
      if (ghStatus.error) status.github.error = ghStatus.error;
    }

    // Check Supabase if selected
    if (!config || config.supabase) {
      const sbStatus = await this.supabaseSetup.checkAuth();
      status.supabase = { ready: sbStatus.authenticated };
      if (sbStatus.error) status.supabase.error = sbStatus.error;
    }

    // Check Vercel if selected
    if (!config || config.vercel) {
      const vcStatus = await this.vercelSetup.checkAuth();
      status.vercel = { ready: vcStatus.authenticated };
      if (vcStatus.username) status.vercel.username = vcStatus.username;
      if (vcStatus.error) status.vercel.error = vcStatus.error;
    }

    return status;
  }

  /**
   * Run setup for selected services
   */
  async setupServices(config: CloudSetupConfig): Promise<CloudSetupResult> {
    const result: CloudSetupResult = {
      success: true,
      services: {},
      errors: [],
      links: [],
    };

    const rollbackState: RollbackState = {};

    try {
      // Step 1: GitHub (no dependencies)
      if (config.github) {
        console.log();
        console.log(chalk.cyan('GitHub'));
        const ghResult = await this.githubSetup.setup(true);

        if (ghResult.success && ghResult.repo) {
          result.services.github = ghResult.repo;
          rollbackState.github = ghResult.repo;

          // Store link
          const link = this.store.createCloudServiceLink({
            sessionId: this.sessionId,
            service: 'github',
            projectId: `${ghResult.repo.owner}/${ghResult.repo.name}`,
            projectName: ghResult.repo.name,
            projectUrl: ghResult.repo.url,
            environment: 'both',
            metadata: {
              owner: ghResult.repo.owner,
              sshUrl: ghResult.repo.sshUrl,
            },
          });
          result.links.push(link);
        } else {
          result.errors.push({ service: 'GitHub', error: ghResult.error ?? 'Unknown error' });
          result.success = false;
        }
      }

      // Step 2: Supabase (no dependencies)
      if (config.supabase) {
        console.log();
        console.log(chalk.cyan('Supabase'));
        const sbResult = await this.supabaseSetup.setup('us-east-1');

        if (sbResult.success && sbResult.project && sbResult.credentials) {
          result.services.supabase = {
            project: sbResult.project,
            credentials: sbResult.credentials,
          };
          rollbackState.supabase = sbResult.project;

          // Store link
          const link = this.store.createCloudServiceLink({
            sessionId: this.sessionId,
            service: 'supabase',
            projectId: sbResult.project.id,
            projectName: sbResult.project.name,
            projectUrl: sbResult.credentials.projectUrl,
            environment: 'both',
            metadata: {
              region: sbResult.project.region,
              projectRef: sbResult.credentials.projectRef,
            },
          });
          result.links.push(link);
        } else {
          result.errors.push({ service: 'Supabase', error: sbResult.error ?? 'Unknown error' });
          result.success = false;
        }
      }

      // Step 3: Vercel (depends on GitHub + Supabase)
      if (config.vercel) {
        console.log();
        console.log(chalk.cyan('Vercel'));

        const githubOwner = result.services.github?.owner;
        const githubRepo = result.services.github?.name;
        const supabaseCredentials = result.services.supabase?.credentials;

        const vcResult = await this.vercelSetup.setup(
          githubOwner,
          githubRepo,
          supabaseCredentials
        );

        if (vcResult.success && vcResult.project) {
          result.services.vercel = vcResult.project;
          rollbackState.vercel = vcResult.project;

          // Store link
          const link = this.store.createCloudServiceLink({
            sessionId: this.sessionId,
            service: 'vercel',
            projectId: vcResult.project.id,
            projectName: vcResult.project.name,
            projectUrl: vcResult.project.url,
            environment: 'both',
            metadata: {
              framework: vcResult.project.framework ?? 'nextjs',
              productionUrl: `https://${this.projectName}.vercel.app`,
              stagingUrl: `https://${this.projectName}-staging.vercel.app`,
            },
          });
          result.links.push(link);
        } else {
          result.errors.push({ service: 'Vercel', error: vcResult.error ?? 'Unknown error' });
          result.success = false;
        }
      }

      // Set GitHub secrets for Supabase if both are configured
      if (result.services.github && result.services.supabase) {
        console.log();
        console.log(chalk.blue('  Configuring GitHub secrets...'));
        try {
          await this.githubSetup.setSecrets({
            'SUPABASE_URL': result.services.supabase.credentials.projectUrl,
            'SUPABASE_ANON_KEY': result.services.supabase.credentials.anonKey,
            'SUPABASE_SERVICE_ROLE_KEY': result.services.supabase.credentials.serviceRoleKey,
          });
          console.log(chalk.green('  ✓ GitHub secrets configured'));
        } catch (error) {
          console.log(chalk.yellow('  ⚠ Could not set GitHub secrets'));
        }
      }

    } catch (error) {
      result.success = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ service: 'Setup', error: errorMsg });

      // Offer rollback
      await this.offerRollback(rollbackState);
    }

    return result;
  }

  /**
   * Display prerequisite status
   */
  private displayPrerequisiteStatus(status: PrerequisiteStatus, config: CloudSetupConfig): void {
    if (config.github) {
      if (status.github.ready) {
        console.log(chalk.green(`  ✓ GitHub CLI authenticated${status.github.username ? ` (${status.github.username})` : ''}`));
      } else {
        console.log(chalk.yellow(`  ⚠ GitHub: ${status.github.error}`));
      }
    }

    if (config.supabase) {
      if (status.supabase.ready) {
        console.log(chalk.green('  ✓ Supabase authenticated'));
      } else {
        console.log(chalk.yellow(`  ⚠ Supabase: ${status.supabase.error}`));
      }
    }

    if (config.vercel) {
      if (status.vercel.ready) {
        console.log(chalk.green(`  ✓ Vercel authenticated${status.vercel.username ? ` (${status.vercel.username})` : ''}`));
      } else {
        console.log(chalk.yellow(`  ⚠ Vercel: ${status.vercel.error}`));
      }
    }
  }

  /**
   * Handle missing authentication
   */
  private async handleMissingAuth(
    status: PrerequisiteStatus,
    config: CloudSetupConfig
  ): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let allAuthenticated = true;

    // Handle GitHub auth
    if (config.github && !status.github.ready) {
      console.log();
      console.log(chalk.yellow('GitHub requires authentication via the GitHub CLI.'));
      console.log(chalk.dim('Run: gh auth login'));
      const skip = await this.askYesNo(rl, 'Skip GitHub setup?');
      if (skip) {
        config.github = false;
      } else {
        allAuthenticated = false;
      }
    }

    // Handle Supabase auth
    if (config.supabase && !status.supabase.ready) {
      const authenticate = await this.askYesNo(
        rl,
        '\nSupabase requires authentication. Authenticate now?'
      );
      if (authenticate) {
        const success = await this.supabaseSetup.authenticate();
        if (!success) {
          config.supabase = false;
        }
      } else {
        config.supabase = false;
      }
    }

    // Handle Vercel auth
    if (config.vercel && !status.vercel.ready) {
      const authenticate = await this.askYesNo(
        rl,
        '\nVercel requires authentication. Authenticate now?'
      );
      if (authenticate) {
        const success = await this.vercelSetup.authenticate();
        if (!success) {
          config.vercel = false;
        }
      } else {
        config.vercel = false;
      }
    }

    rl.close();

    // Check if anything is still selected
    if (!config.github && !config.supabase && !config.vercel) {
      console.log(chalk.dim('No services to configure.'));
      return false;
    }

    return allAuthenticated || (config.github || config.supabase || config.vercel);
  }

  /**
   * Display setup summary
   */
  private displaySummary(result: CloudSetupResult): void {
    console.log();
    console.log(chalk.dim('─'.repeat(50)));
    console.log(chalk.bold('Cloud Services Summary'));
    console.log();

    if (result.services.github) {
      console.log(`  ${chalk.green('GitHub:')}   ${result.services.github.url}`);
    }

    if (result.services.supabase) {
      console.log(`  ${chalk.green('Supabase:')} ${result.services.supabase.credentials.projectUrl}`);
    }

    if (result.services.vercel) {
      console.log(`  ${chalk.green('Vercel:')}   ${result.services.vercel.url}`);
    }

    if (result.errors.length > 0) {
      console.log();
      console.log(chalk.yellow('Errors:'));
      for (const err of result.errors) {
        console.log(`  ${chalk.red(err.service)}: ${err.error}`);
      }
    }
  }

  /**
   * Offer to rollback created resources on failure
   */
  private async offerRollback(state: RollbackState): Promise<void> {
    const hasResources = state.github || state.supabase || state.vercel;
    if (!hasResources) return;

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log();
    console.log(chalk.yellow('Setup failed partway through.'));

    const resourceList = [
      state.github && 'GitHub repository',
      state.supabase && 'Supabase project',
      state.vercel && 'Vercel project',
    ].filter(Boolean).join(', ');

    console.log(chalk.dim(`Created resources: ${resourceList}`));

    const rollback = await this.askYesNo(rl, 'Would you like to rollback (delete) created resources?');
    rl.close();

    if (rollback) {
      console.log(chalk.blue('Rolling back...'));

      if (state.vercel) {
        try {
          await this.vercelSetup.deleteProject();
          console.log(chalk.dim('  Deleted Vercel project'));
        } catch {
          console.log(chalk.yellow('  Could not delete Vercel project'));
        }
      }

      if (state.supabase) {
        try {
          await this.supabaseSetup.deleteProject(state.supabase.id);
          console.log(chalk.dim('  Deleted Supabase project'));
        } catch {
          console.log(chalk.yellow('  Could not delete Supabase project'));
        }
      }

      if (state.github) {
        console.log(chalk.dim('  To delete GitHub repo, run: gh repo delete'));
      }
    }
  }

  /**
   * Helper to ask yes/no questions
   */
  private askYesNo(rl: ReturnType<typeof createInterface>, question: string): Promise<boolean> {
    return new Promise((resolve) => {
      rl.question(`${question} ${chalk.dim('(y/n)')} `, (answer) => {
        resolve(answer.toLowerCase().startsWith('y'));
      });
    });
  }
}

// Re-export types
export type { GitHubRepoInfo } from './github.js';
export type { SupabaseProjectInfo, SupabaseCredentials } from './supabase.js';
export type { VercelProjectInfo } from './vercel.js';
