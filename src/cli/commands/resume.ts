import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { sessionManager, getTechStackDescription } from '../../core/session-manager.js';
import { PipelineController } from '../../pipeline/controller.js';
import type { Requirement } from '../../core/types.js';

interface ResumeOptions {
  path: string;
}

export async function resumeCommand(options: ResumeOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold('\n🔄 Orchestrator - Resuming Session\n'));

  try {
    // Initialize and resume session
    const spinner = ora('Loading session...').start();
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    spinner.succeed('Session resumed');

    console.log(chalk.dim('Session ID:'), session.id);
    console.log(chalk.dim('Project:'), session.projectName);
    console.log(chalk.dim('Tech Stack:'), getTechStackDescription(session.techStack));
    console.log(chalk.dim('Current Phase:'), session.currentPhase);
    console.log(chalk.dim('Status:'), session.status);
    console.log();

    // Get pending requirements
    const store = sessionManager.getStore();
    const requirements = store.getRequirementsBySession(session.id);
    const pendingReqs = requirements.filter((r: Requirement) => r.status !== 'completed');

    if (pendingReqs.length === 0) {
      console.log(chalk.yellow('No pending requirements to process.'));
      console.log(chalk.dim('Use'), chalk.white('orchestrate run "requirement"'), chalk.dim('to add a new one.'));
      sessionManager.close();
      return;
    }

    console.log(chalk.cyan(`📋 Found ${pendingReqs.length} pending requirement(s)`));

    // Resume pipeline from last checkpoint
    const checkpoint = store.getLatestCheckpoint(session.id);
    if (checkpoint) {
      console.log(chalk.dim('Resuming from checkpoint:'), checkpoint.id);
      console.log(chalk.dim('Phase:'), checkpoint.phase);
    }

    // Run the pipeline for each pending requirement
    const controller = new PipelineController(sessionManager);

    for (const req of pendingReqs) {
      console.log(chalk.cyan(`\n📋 Processing: ${req.rawInput.substring(0, 50)}...`));
      await controller.run(req.id);
    }

    console.log(chalk.green('\n✅ All requirements processed!\n'));

    sessionManager.close();
  } catch (error) {
    sessionManager.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    } else {
      console.error(chalk.red('\n❌ Unknown error occurred'));
    }
    process.exit(1);
  }
}
