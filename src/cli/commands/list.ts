import path from 'node:path';
import chalk from 'chalk';
import { sessionManager } from '../../core/session-manager.js';
import type { Requirement } from '../../core/types.js';

interface ListOptions {
  path: string;
  status: string;
  json: boolean;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    const store = sessionManager.getStore();

    const allReqs = store.getRequirementsBySession(session.id);

    // Filter by status if specified
    let requirements = allReqs;
    if (options.status && options.status !== 'all') {
      requirements = allReqs.filter((r: Requirement) => r.status === options.status);
    }

    if (options.json) {
      console.log(JSON.stringify(requirements.map((r: Requirement) => ({
        id: r.id,
        requirement: r.rawInput,
        status: r.status,
        priority: r.priority,
        createdAt: r.createdAt.toISOString(),
      })), null, 2));
    } else {
      console.log(chalk.bold('\n📋 Requirements\n'));

      if (requirements.length === 0) {
        console.log(chalk.dim('No requirements found.'));
        console.log(chalk.dim('Use'), chalk.white('orchestrate add "requirement"'), chalk.dim('to add one.'));
      } else {
        // Group by status
        const pending = requirements.filter((r: Requirement) => r.status === 'pending');
        const inProgress = requirements.filter((r: Requirement) => r.status === 'in_progress');
        const completed = requirements.filter((r: Requirement) => r.status === 'completed');
        const failed = requirements.filter((r: Requirement) => r.status === 'failed');

        if (inProgress.length > 0) {
          console.log(chalk.yellow('● In Progress'));
          for (const req of inProgress) {
            printRequirement(req);
          }
          console.log();
        }

        if (pending.length > 0) {
          console.log(chalk.blue('○ Pending'));
          for (const req of pending) {
            printRequirement(req);
          }
          console.log();
        }

        if (completed.length > 0) {
          console.log(chalk.green('✓ Completed'));
          for (const req of completed) {
            printRequirement(req);
          }
          console.log();
        }

        if (failed.length > 0) {
          console.log(chalk.red('✗ Failed'));
          for (const req of failed) {
            printRequirement(req);
          }
          console.log();
        }

        // Summary
        console.log(chalk.dim('─'.repeat(50)));
        console.log(
          chalk.dim('Total:'),
          `${pending.length} pending, ${inProgress.length} running, ${completed.length} done, ${failed.length} failed`
        );
      }
    }

    sessionManager.close();
  } catch (error) {
    sessionManager.close();
    if (error instanceof Error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
    }
    process.exit(1);
  }
}

function printRequirement(req: Requirement): void {
  const truncated = req.rawInput.length > 50
    ? req.rawInput.substring(0, 50) + '...'
    : req.rawInput;

  console.log(`  ${chalk.dim(req.id.substring(0, 8))} ${truncated}`);

  if (req.priority > 0) {
    console.log(`    ${chalk.dim('Priority:')} ${req.priority}`);
  }
}
