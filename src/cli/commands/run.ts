import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { sessionManager } from '../../core/session-manager.js';
import { PipelineController } from '../../pipeline/controller.js';
import { ConcurrentRunner } from '../../pipeline/concurrent-runner.js';
import type { Requirement } from '../../core/types.js';

interface RunOptions {
  path: string;
  sequential?: boolean;
  concurrency?: string;
}

export async function runCommand(
  requirementOrId: string | undefined,
  options: RunOptions
): Promise<void> {
  const projectPath = path.resolve(options.path);
  const maxConcurrency = parseInt(options.concurrency ?? '3', 10);
  const sequential = options.sequential ?? false;

  console.log(chalk.bold('\n🚀 Orchestrator - Running Pipeline\n'));

  try {
    // Initialize and resume session
    const spinner = ora('Loading session...').start();
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    spinner.succeed(`Session loaded: ${session.projectName}`);

    console.log(chalk.dim('Session ID:'), session.id);
    console.log();

    const store = sessionManager.getStore();

    // Determine what to run
    let requirementsToRun: Requirement[] = [];

    if (requirementOrId) {
      // Check if it's an existing requirement ID (starts with valid characters)
      const existingReq = store.getRequirementsBySession(session.id)
        .find((r: Requirement) => r.id === requirementOrId || r.id.startsWith(requirementOrId));

      if (existingReq) {
        // Run existing requirement by ID
        console.log(chalk.cyan('📋 Running existing requirement:'), existingReq.id);
        requirementsToRun = [existingReq];
      } else {
        // It's a new requirement text - create and run it
        const newReq = store.createRequirement({
          sessionId: session.id,
          rawInput: requirementOrId,
        });
        console.log(chalk.cyan('📋 New requirement created:'), newReq.id);
        requirementsToRun = [newReq];
      }
    } else {
      // No argument - run all pending requirements
      const allReqs = store.getRequirementsBySession(session.id);
      requirementsToRun = allReqs.filter((r: Requirement) => r.status === 'pending');

      if (requirementsToRun.length === 0) {
        console.log(chalk.yellow('No pending requirements to run.'));
        console.log(chalk.dim('Use'), chalk.white('orchestrate add "requirement"'), chalk.dim('to add one.'));
        sessionManager.close();
        return;
      }

      console.log(chalk.cyan(`📋 Found ${requirementsToRun.length} pending requirement(s)`));
    }

    // Show what we're about to run
    console.log();
    for (const req of requirementsToRun) {
      const truncated = req.rawInput.length > 60
        ? req.rawInput.substring(0, 60) + '...'
        : req.rawInput;
      console.log(chalk.dim(`  • ${req.id.substring(0, 8)}`), truncated);
    }
    console.log();

    if (sequential || requirementsToRun.length === 1) {
      // Sequential execution - run one at a time
      console.log(chalk.dim('Mode:'), 'Sequential');
      console.log();

      for (const req of requirementsToRun) {
        console.log(chalk.cyan(`\n▶ Running: ${req.rawInput.substring(0, 50)}...`));
        const controller = new PipelineController(sessionManager);
        await controller.run(req.id);
        console.log(chalk.green(`✅ Completed: ${req.id.substring(0, 8)}`));
      }
    } else {
      // Concurrent execution with git worktrees
      console.log(chalk.dim('Mode:'), `Concurrent (max ${maxConcurrency} jobs)`);
      console.log();

      const runner = new ConcurrentRunner(sessionManager, maxConcurrency);
      await runner.runAll(requirementsToRun.map((r) => r.id));
    }

    console.log(chalk.green('\n✅ All requirements completed!\n'));

    sessionManager.close();
  } catch (error) {
    sessionManager.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
      if (error.stack) {
        console.error(chalk.dim(error.stack));
      }
    } else {
      console.error(chalk.red('\n❌ Unknown error occurred'));
    }
    process.exit(1);
  }
}
