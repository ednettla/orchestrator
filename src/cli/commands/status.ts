import path from 'node:path';
import chalk from 'chalk';
import { sessionManager, getTechStackDescription } from '../../core/session-manager.js';
import type { Task, Requirement } from '../../core/types.js';

interface StatusOptions {
  path: string;
  json: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    const store = sessionManager.getStore();

    // Get all data
    const requirements = store.getRequirementsBySession(session.id);
    const tasks = store.getTasksBySession(session.id);
    const checkpoint = store.getLatestCheckpoint(session.id);

    if (options.json) {
      // JSON output
      console.log(JSON.stringify({
        session: {
          id: session.id,
          projectName: session.projectName,
          projectPath: session.projectPath,
          techStack: session.techStack,
          currentPhase: session.currentPhase,
          status: session.status,
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
        },
        requirements: requirements.map((r: Requirement) => ({
          id: r.id,
          rawInput: r.rawInput,
          status: r.status,
          priority: r.priority,
        })),
        tasks: tasks.map((t: Task) => ({
          id: t.id,
          agentType: t.agentType,
          status: t.status,
          retryCount: t.retryCount,
        })),
        checkpoint: checkpoint ? {
          id: checkpoint.id,
          phase: checkpoint.phase,
          createdAt: checkpoint.createdAt.toISOString(),
        } : null,
      }, null, 2));
    } else {
      // Human-readable output
      console.log(chalk.bold('\n📊 Orchestrator - Session Status\n'));

      // Session info
      console.log(chalk.cyan('Session'));
      console.log(chalk.dim('─'.repeat(50)));
      console.log(`  ${chalk.dim('ID:')}           ${session.id}`);
      console.log(`  ${chalk.dim('Project:')}      ${session.projectName}`);
      console.log(`  ${chalk.dim('Path:')}         ${session.projectPath}`);
      console.log(`  ${chalk.dim('Tech Stack:')}   ${getTechStackDescription(session.techStack)}`);
      console.log(`  ${chalk.dim('Phase:')}        ${formatPhase(session.currentPhase)}`);
      console.log(`  ${chalk.dim('Status:')}       ${formatStatus(session.status)}`);
      console.log(`  ${chalk.dim('Created:')}      ${session.createdAt.toLocaleString()}`);
      console.log(`  ${chalk.dim('Updated:')}      ${session.updatedAt.toLocaleString()}`);

      // Requirements
      console.log(chalk.cyan('\nRequirements'));
      console.log(chalk.dim('─'.repeat(50)));
      if (requirements.length === 0) {
        console.log(chalk.dim('  No requirements yet'));
      } else {
        for (const req of requirements) {
          const statusIcon = getStatusIcon(req.status);
          const truncated = req.rawInput.length > 40
            ? req.rawInput.substring(0, 40) + '...'
            : req.rawInput;
          console.log(`  ${statusIcon} ${truncated}`);
          console.log(`    ${chalk.dim('ID:')} ${req.id} ${chalk.dim('Priority:')} ${req.priority}`);
        }
      }

      // Tasks
      console.log(chalk.cyan('\nTasks'));
      console.log(chalk.dim('─'.repeat(50)));
      if (tasks.length === 0) {
        console.log(chalk.dim('  No tasks yet'));
      } else {
        const tasksByAgent = groupTasksByAgent(tasks);
        for (const [agent, agentTasks] of Object.entries(tasksByAgent)) {
          const completed = agentTasks.filter((t: Task) => t.status === 'completed').length;
          const total = agentTasks.length;
          const latest = agentTasks[agentTasks.length - 1];
          console.log(`  ${formatAgentType(agent)}: ${completed}/${total} ${chalk.dim(`(${latest?.status})`)}`);
        }
      }

      // Checkpoint
      if (checkpoint) {
        console.log(chalk.cyan('\nLast Checkpoint'));
        console.log(chalk.dim('─'.repeat(50)));
        console.log(`  ${chalk.dim('ID:')}      ${checkpoint.id}`);
        console.log(`  ${chalk.dim('Phase:')}   ${checkpoint.phase}`);
        console.log(`  ${chalk.dim('Created:')} ${checkpoint.createdAt.toLocaleString()}`);
      }

      console.log();
    }

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

function formatPhase(phase: string): string {
  const colors: Record<string, typeof chalk.green> = {
    init: chalk.gray,
    planning: chalk.blue,
    architecting: chalk.cyan,
    coding: chalk.yellow,
    reviewing: chalk.magenta,
    testing: chalk.blue,
    completed: chalk.green,
    failed: chalk.red,
  };
  const color = colors[phase] ?? chalk.white;
  return color(phase);
}

function formatStatus(status: string): string {
  const colors: Record<string, typeof chalk.green> = {
    active: chalk.green,
    paused: chalk.yellow,
    completed: chalk.blue,
    failed: chalk.red,
  };
  const color = colors[status] ?? chalk.white;
  return color(status);
}

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    pending: chalk.gray('○'),
    in_progress: chalk.yellow('◐'),
    completed: chalk.green('●'),
    failed: chalk.red('✗'),
  };
  return icons[status] ?? chalk.gray('?');
}

function formatAgentType(agent: string): string {
  const colors: Record<string, typeof chalk.green> = {
    planner: chalk.blue,
    architect: chalk.cyan,
    coder: chalk.yellow,
    reviewer: chalk.magenta,
    tester: chalk.green,
  };
  const color = colors[agent] ?? chalk.white;
  return color(agent.charAt(0).toUpperCase() + agent.slice(1));
}

function groupTasksByAgent(tasks: Task[]): Record<string, Task[]> {
  return tasks.reduce((acc, task) => {
    const agent = task.agentType;
    if (!acc[agent]) {
      acc[agent] = [];
    }
    acc[agent].push(task);
    return acc;
  }, {} as Record<string, Task[]>);
}
