import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import type { SessionManager } from '../core/session-manager.js';
import type { Job } from '../core/types.js';
import type { StreamingOptions } from '../agents/invoker.js';
import { createWorktreeManager, WorktreeManager } from '../core/worktree-manager.js';
import { PipelineController } from './controller.js';
import { AgentMonitor } from '../agents/monitor.js';

interface RunningJob {
  job: Job;
  requirementId: string;
  worktreePath: string;
  promise: Promise<void>;
  controller: PipelineController;
}

interface ConcurrentRunnerOptions {
  maxConcurrency?: number;
  useWorktrees?: boolean;
  /** Shared agent monitor for real-time activity tracking */
  monitor?: AgentMonitor;
  /** Streaming options for agent output */
  streamingOptions?: StreamingOptions;
}

interface RequirementWithDeps {
  id: string;
  dependencies: string[];
}

export class ConcurrentRunner {
  private sessionManager: SessionManager;
  private maxConcurrency: number;
  private runningJobs: Map<string, RunningJob> = new Map();
  private worktreeManager: WorktreeManager | null = null;
  private useWorktrees: boolean = true;
  private monitor: AgentMonitor;
  private streamingOptions?: StreamingOptions;
  private worktreeIds: string[] = [];

  constructor(sessionManager: SessionManager, options: ConcurrentRunnerOptions | number = 3) {
    this.sessionManager = sessionManager;

    if (typeof options === 'number') {
      // Backwards compatibility
      this.maxConcurrency = options;
      this.monitor = new AgentMonitor();
    } else {
      this.maxConcurrency = options.maxConcurrency ?? 3;
      this.useWorktrees = options.useWorktrees ?? true;
      this.monitor = options.monitor ?? new AgentMonitor();
      if (options.streamingOptions) {
        this.streamingOptions = options.streamingOptions;
      }
    }
  }

  /**
   * Get the agent monitor for dashboard integration
   */
  getMonitor(): AgentMonitor {
    return this.monitor;
  }

  async runAll(requirementIds: string[]): Promise<void> {
    const store = this.sessionManager.getStore();
    const session = this.sessionManager.getCurrentSession();

    if (!session) {
      throw new Error('No active session');
    }

    // Check if git is available and we're in a repo
    this.worktreeManager = createWorktreeManager(session.projectPath, store);
    try {
      const isGitRepo = await this.worktreeManager.isGitRepo();
      this.useWorktrees = isGitRepo;
      if (!isGitRepo && this.maxConcurrency > 1) {
        const initialized = await this.promptInitGit(session.projectPath);
        if (initialized) {
          this.useWorktrees = true;
        } else {
          console.log(chalk.yellow('Running sequentially without git worktrees'));
          this.maxConcurrency = 1;
        }
      }
    } catch {
      this.useWorktrees = false;
      this.maxConcurrency = 1;
    }

    // Create a queue of requirement IDs
    const queue = [...requirementIds];
    const completedJobs: string[] = [];
    const failedJobs: Map<string, string> = new Map();

    // Set total jobs for progress tracking
    this.monitor.setTotalJobs(requirementIds.length);

    console.log(chalk.cyan(`Starting ${queue.length} job(s) with max concurrency: ${this.maxConcurrency}`));
    console.log();

    // Process jobs until all are done
    while (queue.length > 0 || this.runningJobs.size > 0) {
      // Start new jobs up to max concurrency
      while (queue.length > 0 && this.runningJobs.size < this.maxConcurrency) {
        const requirementId = queue.shift()!;
        await this.startJob(session.id, requirementId);
      }

      // Wait for any job to complete
      if (this.runningJobs.size > 0) {
        const { requirementId, success, error } = await this.waitForAnyJob();

        if (success) {
          completedJobs.push(requirementId);
          console.log(chalk.green(`  ✓ ${requirementId.substring(0, 8)} completed`));
        } else {
          failedJobs.set(requirementId, error ?? 'Unknown error');
          console.log(chalk.red(`  ✗ ${requirementId.substring(0, 8)} failed: ${error}`));
        }
      }
    }

    // Summary
    console.log();
    console.log(chalk.dim('─'.repeat(50)));
    console.log(
      chalk.dim('Results:'),
      chalk.green(`${completedJobs.length} completed`),
      failedJobs.size > 0 ? chalk.red(`, ${failedJobs.size} failed`) : ''
    );

    if (failedJobs.size > 0) {
      throw new Error(`${failedJobs.size} job(s) failed`);
    }
  }

  /**
   * Run requirements with dependency awareness.
   * Requirements are only started when all their dependencies have completed.
   */
  async runWithDependencies(requirements: RequirementWithDeps[]): Promise<void> {
    const store = this.sessionManager.getStore();
    const session = this.sessionManager.getCurrentSession();

    if (!session) {
      throw new Error('No active session');
    }

    // Check if git is available and we're in a repo
    this.worktreeManager = createWorktreeManager(session.projectPath, store);
    try {
      const isGitRepo = await this.worktreeManager.isGitRepo();
      if (!isGitRepo && this.useWorktrees && this.maxConcurrency > 1) {
        const initialized = await this.promptInitGit(session.projectPath);
        if (initialized) {
          this.useWorktrees = true;
        } else {
          console.log(chalk.yellow('Running sequentially without git worktrees'));
          this.maxConcurrency = 1;
          this.useWorktrees = false;
        }
      }
    } catch {
      this.useWorktrees = false;
      this.maxConcurrency = 1;
    }

    // Track completed requirements
    const completed = new Set<string>();
    const failed = new Set<string>();
    const pending = new Map<string, RequirementWithDeps>(
      requirements.map(r => [r.id, r])
    );

    // Set total jobs for progress tracking
    this.monitor.setTotalJobs(requirements.length);

    console.log(chalk.cyan(`Starting ${requirements.length} job(s) with dependency-aware scheduling`));
    console.log(chalk.dim(`Max concurrency: ${this.maxConcurrency}`));
    console.log();

    // Process jobs until all are done
    while (pending.size > 0 || this.runningJobs.size > 0) {
      // Find requirements whose dependencies are all satisfied
      const ready: RequirementWithDeps[] = [];
      for (const [id, req] of pending) {
        const depsComplete = req.dependencies.every(d => completed.has(d));
        const depsFailed = req.dependencies.some(d => failed.has(d));

        if (depsFailed) {
          // Skip this requirement - a dependency failed
          pending.delete(id);
          failed.add(id);
          console.log(chalk.red(`  ⊘ ${id.substring(0, 8)} skipped - dependency failed`));
          continue;
        }

        if (depsComplete) {
          ready.push(req);
        }
      }

      // Start ready jobs up to max concurrency
      while (ready.length > 0 && this.runningJobs.size < this.maxConcurrency) {
        const req = ready.shift()!;
        pending.delete(req.id);
        await this.startJob(session.id, req.id);
      }

      // If nothing is running and nothing is ready but there are pending items,
      // we have a circular dependency
      if (this.runningJobs.size === 0 && ready.length === 0 && pending.size > 0) {
        console.log(chalk.red('\nCircular dependency detected! Remaining requirements:'));
        for (const [id] of pending) {
          console.log(chalk.red(`  - ${id}`));
        }
        throw new Error('Circular dependency detected');
      }

      // Wait for any job to complete
      if (this.runningJobs.size > 0) {
        const result = await this.waitForAnyJob();

        if (result.success) {
          completed.add(result.requirementId);
          console.log(chalk.green(`  ✓ ${result.requirementId.substring(0, 8)} completed`));
        } else {
          failed.add(result.requirementId);
          console.log(chalk.red(`  ✗ ${result.requirementId.substring(0, 8)} failed: ${result.error}`));
        }
      }
    }

    // Summary
    console.log();
    console.log(chalk.dim('─'.repeat(50)));
    console.log(
      chalk.dim('Results:'),
      chalk.green(`${completed.size} completed`),
      failed.size > 0 ? chalk.red(`, ${failed.size} failed/skipped`) : ''
    );

    if (failed.size > 0) {
      throw new Error(`${failed.size} job(s) failed or were skipped`);
    }
  }

  private async startJob(sessionId: string, requirementId: string): Promise<void> {
    const store = this.sessionManager.getStore();
    const session = this.sessionManager.getCurrentSession();

    if (!session) {
      throw new Error('No active session');
    }

    const requirement = store.getRequirement(requirementId);
    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    let worktreePath = session.projectPath;
    let worktreeId: string | null = null;

    // Create worktree if git is available
    if (this.useWorktrees && this.worktreeManager) {
      try {
        const slug = requirement.rawInput.substring(0, 30);
        const worktree = await this.worktreeManager.create(sessionId, requirementId, slug);
        worktreePath = worktree.worktreePath;
        worktreeId = worktree.id;
        this.worktreeIds.push(worktree.id);
        console.log(chalk.dim(`  → Created worktree: ${worktree.branchName}`));
      } catch (error) {
        console.log(chalk.yellow(`  → Worktree creation failed, using main directory`));
      }
    }

    // Create job record
    const job = store.createJob({
      sessionId,
      requirementId,
      worktreeId,
    });

    // Update requirement status
    store.updateRequirement(requirementId, { status: 'in_progress' });

    // Update job as running
    store.updateJob(job.id, { status: 'running', startedAt: new Date() });

    // Run pipeline asynchronously
    // Skip global phase updates to avoid race conditions with concurrent jobs
    const controllerOptions: {
      workingPath: string;
      skipPhaseUpdates: boolean;
      monitor: AgentMonitor;
      streamingOptions?: StreamingOptions;
    } = {
      workingPath: worktreePath,
      skipPhaseUpdates: this.maxConcurrency > 1,
      monitor: this.monitor,
    };
    if (this.streamingOptions) {
      controllerOptions.streamingOptions = this.streamingOptions;
    }
    const controller = new PipelineController(this.sessionManager, controllerOptions);
    const promise = controller.run(requirementId)
      .then(() => {
        store.updateJob(job.id, {
          status: 'completed',
          completedAt: new Date(),
        });
        store.updateRequirement(requirementId, { status: 'completed' });
      })
      .catch((error) => {
        store.updateJob(job.id, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error.message,
        });
        store.updateRequirement(requirementId, { status: 'failed' });
        throw error;
      });

    const runningJob: RunningJob = {
      job,
      requirementId,
      worktreePath,
      promise,
      controller,
    };

    this.runningJobs.set(requirementId, runningJob);

    const truncated = requirement.rawInput.length > 40
      ? requirement.rawInput.substring(0, 40) + '...'
      : requirement.rawInput;
    console.log(chalk.blue(`  ▶ Started: ${requirementId.substring(0, 8)} - ${truncated}`));
  }

  private async waitForAnyJob(): Promise<{ requirementId: string; success: boolean; error?: string }> {
    // Create race between all running jobs
    const racePromises = Array.from(this.runningJobs.entries()).map(
      ([requirementId, runningJob]) =>
        runningJob.promise
          .then(() => ({ requirementId, success: true as const }))
          .catch((error: Error) => ({
            requirementId,
            success: false as const,
            error: error.message,
          }))
    );

    const result = await Promise.race(racePromises);
    this.runningJobs.delete(result.requirementId);

    return result;
  }

  getRunningJobs(): Job[] {
    return Array.from(this.runningJobs.values()).map((rj) => rj.job);
  }

  /**
   * Get all worktree IDs created during execution
   * Used for post-execution workflow (merge, test, deploy)
   */
  getWorktreeIds(): string[] {
    return [...this.worktreeIds];
  }

  async cancelAll(): Promise<void> {
    const store = this.sessionManager.getStore();

    // Kill all running agent processes
    const killPromises: Promise<void>[] = [];
    for (const [requirementId, runningJob] of this.runningJobs) {
      killPromises.push(runningJob.controller.killAll());
      store.updateJob(runningJob.job.id, {
        status: 'cancelled',
        completedAt: new Date(),
      });
      store.updateRequirement(requirementId, { status: 'failed' });
    }

    await Promise.all(killPromises);
    this.runningJobs.clear();

    // Reset monitor
    this.monitor.reset();
  }

  /**
   * Prompt the user to initialize a git repository for parallel execution.
   * Returns true if git was successfully initialized.
   */
  private async promptInitGit(projectPath: string): Promise<boolean> {
    console.log(chalk.yellow('\n⚠ Not a git repository'));
    console.log(chalk.dim('Parallel execution requires git worktrees.\n'));

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        chalk.bold('Initialize git repository? ') + chalk.dim('(Y/n) '),
        (response) => {
          resolve(response.trim().toLowerCase());
        }
      );
    });

    rl.close();

    if (answer === '' || answer === 'y' || answer === 'yes') {
      try {
        console.log(chalk.dim('\nInitializing git repository...'));
        execFileSync('git', ['init'], { cwd: projectPath, stdio: 'pipe' });

        console.log(chalk.dim('Staging files...'));
        execFileSync('git', ['add', '-A'], { cwd: projectPath, stdio: 'pipe' });

        console.log(chalk.dim('Creating initial commit...'));
        execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: projectPath, stdio: 'pipe' });

        console.log(chalk.green('✓ Git repository initialized\n'));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.log(chalk.red(`\n✗ Failed to initialize git: ${message}\n`));
        return false;
      }
    }

    console.log();
    return false;
  }
}
