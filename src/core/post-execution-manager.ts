/**
 * Post-Execution Manager
 *
 * Orchestrates the post-build workflow:
 * 1. Sequential merge of all worktrees back to main
 * 2. Full E2E acceptance criteria testing
 * 3. Auto-deploy staging to Vercel
 * 4. User approval for production deployment
 *
 * @module post-execution-manager
 */

import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import type { StateStore } from '../state/store.js';
import type { SessionManager } from './session-manager.js';
import { createWorktreeManager, type WorktreeManager, type MergeResult as WorktreeMergeResult } from './worktree-manager.js';
import { createVercelDeployer, type DeployResult, type VercelDeployer } from './vercel-deployer.js';
import { createAcceptanceTestRunner, type TestResults, type AcceptanceTestRunner } from './acceptance-test-runner.js';

// ============================================================================
// Types
// ============================================================================

export interface MergeResult {
  success: boolean;
  mergedWorktrees: string[];
  errors: Array<{ worktree: string; error: string }>;
}

export interface PostExecutionResult {
  mergeSuccess: boolean;
  mergedWorktrees: string[];
  mergeErrors: Array<{ worktree: string; error: string }>;
  testSuccess: boolean;
  testResults?: TestResults | undefined;
  stagingDeployed: boolean;
  stagingUrl?: string | undefined;
  productionApproved: boolean;
  productionDeployed: boolean;
  productionUrl?: string | undefined;
  skipped?: boolean | undefined;
  skipReason?: string | undefined;
}

// ============================================================================
// Post-Execution Manager
// ============================================================================

export class PostExecutionManager {
  private projectPath: string;
  private sessionId: string;
  private store: StateStore;
  private sessionManager: SessionManager;
  private worktreeManager: WorktreeManager;
  private vercelDeployer: VercelDeployer;
  private testRunner: AcceptanceTestRunner;

  constructor(
    projectPath: string,
    sessionId: string,
    store: StateStore,
    sessionManager: SessionManager
  ) {
    this.projectPath = projectPath;
    this.sessionId = sessionId;
    this.store = store;
    this.sessionManager = sessionManager;
    this.worktreeManager = createWorktreeManager(projectPath, store);
    this.vercelDeployer = createVercelDeployer(
      projectPath,
      sessionManager.getCurrentSession()?.projectName
    );
    this.testRunner = createAcceptanceTestRunner(projectPath, store, sessionManager);
  }

  /**
   * Run the complete post-execution workflow
   */
  async runPostExecution(worktreeIds: string[]): Promise<PostExecutionResult> {
    const result: PostExecutionResult = {
      mergeSuccess: false,
      mergedWorktrees: [],
      mergeErrors: [],
      testSuccess: false,
      stagingDeployed: false,
      productionApproved: false,
      productionDeployed: false,
    };

    // Check if we have a remote configured
    const hasRemote = await this.vercelDeployer.hasRemote();
    if (!hasRemote) {
      result.skipped = true;
      result.skipReason = 'No git remote configured. Skipping deployment.';
      console.log(chalk.yellow('\n  No git remote configured. Skipping deployment workflow.'));
      return result;
    }

    // Phase 1: Merge worktrees
    console.log(chalk.bold('\n  Phase 1: Merging Worktrees\n'));
    const mergeResult = await this.mergeWorktrees(worktreeIds);
    result.mergeSuccess = mergeResult.success;
    result.mergedWorktrees = mergeResult.mergedWorktrees;
    result.mergeErrors = mergeResult.errors;

    if (!mergeResult.success) {
      console.log(chalk.red('\n  Merge failed. Stopping post-execution workflow.'));
      return result;
    }

    console.log(chalk.green(`\n  ✓ Merged ${mergeResult.mergedWorktrees.length} worktrees\n`));

    // Phase 2: Run acceptance tests
    console.log(chalk.bold('  Phase 2: Running Acceptance Tests\n'));
    const requirementIds = await this.getRequirementIds(worktreeIds);
    const testResults = await this.runAcceptanceTests(requirementIds);
    result.testSuccess = testResults.passed;
    result.testResults = testResults;

    if (!testResults.passed) {
      console.log(chalk.red(`\n  Tests failed (${testResults.failedCount}/${testResults.total})`));
      console.log(chalk.dim('  Fix failing tests before deployment.\n'));
      return result;
    }

    console.log(chalk.green(`\n  ✓ All tests passed (${testResults.passedCount}/${testResults.total})\n`));

    // Phase 3: Deploy to staging
    console.log(chalk.bold('  Phase 3: Deploying to Staging\n'));
    const stagingResult = await this.deployToStaging();
    result.stagingDeployed = stagingResult.success;
    result.stagingUrl = stagingResult.url;

    if (!stagingResult.success) {
      console.log(chalk.yellow(`\n  Staging deployment failed: ${stagingResult.error}`));
      console.log(chalk.dim('  You can deploy manually later.\n'));
      // Continue to ask about production anyway
    } else {
      console.log(chalk.green(`\n  ✓ Staging deployed: ${stagingResult.url}\n`));
    }

    // Phase 4: Production approval
    console.log(chalk.bold('  Phase 4: Production Deployment\n'));
    const approved = await this.promptProductionApproval();
    result.productionApproved = approved;

    if (!approved) {
      console.log(chalk.dim('\n  Production deployment skipped.\n'));
      return result;
    }

    // Phase 5: Deploy to production
    const productionResult = await this.deployToProduction();
    result.productionDeployed = productionResult.success;
    result.productionUrl = productionResult.url;

    if (productionResult.success) {
      console.log(chalk.green(`\n  ✓ Production deployed: ${productionResult.url}\n`));
    } else {
      console.log(chalk.red(`\n  Production deployment failed: ${productionResult.error}\n`));
    }

    return result;
  }

  /**
   * Merge all worktrees sequentially back to main
   */
  async mergeWorktrees(worktreeIds: string[]): Promise<MergeResult> {
    const result: MergeResult = {
      success: true,
      mergedWorktrees: [],
      errors: [],
    };

    for (const worktreeId of worktreeIds) {
      const worktree = this.store.getWorktree(worktreeId);
      if (!worktree) {
        result.errors.push({
          worktree: worktreeId,
          error: 'Worktree not found',
        });
        continue;
      }

      // Skip already merged worktrees
      if (worktree.status === 'merged') {
        result.mergedWorktrees.push(worktreeId);
        continue;
      }

      const spinner = ora(`  Merging ${worktree.branchName}...`).start();

      const mergeResult = await this.worktreeManager.merge(worktreeId, 'main');

      if (mergeResult.success) {
        result.mergedWorktrees.push(worktreeId);
        spinner.succeed(`  Merged ${worktree.branchName}`);
      } else {
        const errorMessage = mergeResult.error ?? 'Unknown error';
        result.errors.push({
          worktree: worktreeId,
          error: errorMessage,
        });
        result.success = false;
        spinner.fail(`  Failed to merge ${worktree.branchName}`);
        console.log(chalk.dim(`    Error: ${errorMessage}`));

        // Stop on first conflict
        if (mergeResult.conflictFiles && mergeResult.conflictFiles.length > 0) {
          console.log(chalk.yellow('\n    Conflict files:'));
          for (const file of mergeResult.conflictFiles) {
            console.log(chalk.dim(`      - ${file}`));
          }
          console.log(chalk.yellow('    Resolve conflicts and run again.'));
          break;
        }
      }
    }

    return result;
  }

  /**
   * Run acceptance tests for the given requirements
   */
  async runAcceptanceTests(requirementIds: string[]): Promise<TestResults> {
    const spinner = ora('  Running acceptance tests...').start();

    try {
      const results = await this.testRunner.runTests(requirementIds);
      spinner.stop();

      // Display test results
      for (const req of results.requirements) {
        const status = req.allPassed ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${status} ${req.name}`);

        for (const criterion of req.criteria) {
          const critStatus = criterion.passed ? chalk.green('  ✓') : chalk.red('  ✗');
          console.log(`    ${critStatus} ${criterion.description}`);
          if (criterion.error) {
            console.log(chalk.dim(`      Error: ${criterion.error}`));
          }
        }
      }

      return results;
    } catch (error) {
      spinner.fail('  Acceptance tests failed');
      return {
        passed: false,
        total: 0,
        passedCount: 0,
        failedCount: 0,
        requirements: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Deploy to staging (Vercel preview)
   */
  async deployToStaging(): Promise<DeployResult> {
    const spinner = ora('  Deploying to staging...').start();

    try {
      const result = await this.vercelDeployer.deployStaging();
      if (result.success) {
        spinner.succeed('  Deployed to staging');
      } else {
        spinner.fail('  Staging deployment failed');
      }
      return result;
    } catch (error) {
      spinner.fail('  Staging deployment failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Prompt user for production deployment approval
   */
  async promptProductionApproval(): Promise<boolean> {
    console.log(chalk.yellow('\n  ⚠️  Production Deployment'));
    console.log(chalk.dim('  This will deploy to the live production URL.'));
    console.log(chalk.dim('  All tests have passed and staging is ready.\n'));

    try {
      return await confirm({
        message: '  Deploy to production?',
        default: false, // Safe default - require explicit yes
      });
    } catch {
      // User cancelled (Ctrl+C)
      return false;
    }
  }

  /**
   * Deploy to production
   */
  async deployToProduction(): Promise<DeployResult> {
    const spinner = ora('  Deploying to production...').start();

    try {
      const result = await this.vercelDeployer.deployProduction();
      if (result.success) {
        spinner.succeed('  Deployed to production');
      } else {
        spinner.fail('  Production deployment failed');
      }
      return result;
    } catch (error) {
      spinner.fail('  Production deployment failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get requirement IDs from worktree IDs
   */
  private async getRequirementIds(worktreeIds: string[]): Promise<string[]> {
    const requirementIds: string[] = [];

    for (const worktreeId of worktreeIds) {
      const worktree = this.store.getWorktree(worktreeId);
      if (worktree?.requirementId) {
        requirementIds.push(worktree.requirementId);
      }
    }

    return requirementIds;
  }
}

/**
 * Factory function to create a PostExecutionManager
 */
export function createPostExecutionManager(
  projectPath: string,
  sessionId: string,
  store: StateStore,
  sessionManager: SessionManager
): PostExecutionManager {
  return new PostExecutionManager(projectPath, sessionId, store, sessionManager);
}

/**
 * Display a summary of post-execution results
 */
export function displayPostExecutionSummary(result: PostExecutionResult): void {
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.bold('Post-Build Summary\n'));

  if (result.skipped) {
    console.log(chalk.yellow(`  Skipped: ${result.skipReason}`));
    return;
  }

  // Merge status
  if (result.mergeSuccess) {
    console.log(chalk.green(`  ✓ Merged ${result.mergedWorktrees.length} worktrees`));
  } else {
    console.log(chalk.red(`  ✗ Merge failed`));
    for (const err of result.mergeErrors) {
      console.log(chalk.dim(`    ${err.worktree}: ${err.error}`));
    }
  }

  // Test status
  if (result.testResults) {
    const { passedCount, total } = result.testResults;
    if (result.testSuccess) {
      console.log(chalk.green(`  ✓ Tests passed (${passedCount}/${total})`));
    } else {
      console.log(chalk.red(`  ✗ Tests failed (${passedCount}/${total} passed)`));
    }
  }

  // Staging status
  if (result.stagingDeployed) {
    console.log(chalk.green(`  ✓ Staging: ${result.stagingUrl}`));
  } else if (result.mergeSuccess && result.testSuccess) {
    console.log(chalk.yellow(`  ⚠ Staging: Not deployed`));
  }

  // Production status
  if (result.productionDeployed) {
    console.log(chalk.green(`  ✓ Production: ${result.productionUrl}`));
  } else if (result.productionApproved) {
    console.log(chalk.red(`  ✗ Production: Deployment failed`));
  } else if (result.stagingDeployed) {
    console.log(chalk.dim(`  ○ Production: Awaiting approval`));
  }

  console.log();
}
