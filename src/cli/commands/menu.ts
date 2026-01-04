import path from 'node:path';
import { select, input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { sessionManager } from '../../core/session-manager.js';
import { getDaemonStatus, stopDaemon, tailLogs } from '../daemon.js';
import { checkForUpdates, updateToLatest, getCurrentVersion } from '../updater.js';
import { initCommand } from './init.js';
import { planCommand } from './plan.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';
import { addCommand } from './add.js';
import { listCommand } from './list.js';
import { configInteractive } from './config.js';

interface MenuContext {
  hasProject: boolean;
  projectName?: string;
  projectPath: string;
  hasDaemon: boolean;
  daemonPid: number | undefined;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  failedCount: number;
}

async function getMenuContext(projectPath: string): Promise<MenuContext> {
  const context: MenuContext = {
    hasProject: false,
    projectPath,
    hasDaemon: false,
    daemonPid: undefined,
    pendingCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    failedCount: 0,
  };

  // Check daemon status
  const daemonStatus = getDaemonStatus(projectPath);
  if (daemonStatus.running) {
    context.hasDaemon = true;
    context.daemonPid = daemonStatus.pid;
  }

  // Try to load project
  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);
    context.hasProject = true;
    context.projectName = session.projectName;

    // Get requirement counts
    const store = sessionManager.getStore();
    const requirements = store.getRequirementsBySession(session.id);

    for (const req of requirements) {
      switch (req.status) {
        case 'pending':
          context.pendingCount++;
          break;
        case 'in_progress':
          context.inProgressCount++;
          break;
        case 'completed':
          context.completedCount++;
          break;
        case 'failed':
          context.failedCount++;
          break;
      }
    }

    sessionManager.close();
  } catch {
    // No project - that's fine
    sessionManager.close();
  }

  return context;
}

function printBanner(): void {
  console.log();
  console.log(chalk.cyan('  ╔═══════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.bold.white('           Orchestrator CLI                              ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.dim('     Multi-agent system for building web applications     ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚═══════════════════════════════════════════════════════════╝'));
  console.log();
}

function printContextInfo(context: MenuContext): void {
  if (context.hasProject) {
    console.log(chalk.dim('  Project:'), chalk.white(context.projectName));

    const statusParts: string[] = [];
    if (context.pendingCount > 0) {
      statusParts.push(chalk.yellow(`${context.pendingCount} pending`));
    }
    if (context.inProgressCount > 0) {
      statusParts.push(chalk.blue(`${context.inProgressCount} in progress`));
    }
    if (context.completedCount > 0) {
      statusParts.push(chalk.green(`${context.completedCount} completed`));
    }
    if (context.failedCount > 0) {
      statusParts.push(chalk.red(`${context.failedCount} failed`));
    }

    if (statusParts.length > 0) {
      console.log(chalk.dim('  Requirements:'), statusParts.join(chalk.dim(' | ')));
    }

    if (context.hasDaemon) {
      console.log(chalk.dim('  Daemon:'), chalk.green(`running (PID ${context.daemonPid})`));
    }
  } else {
    console.log(chalk.dim('  No project initialized in current directory'));
  }
  console.log();
}

interface MenuChoice {
  name: string;
  value: string;
  description?: string;
}

function buildMainMenuChoices(context: MenuContext): MenuChoice[] {
  const choices: MenuChoice[] = [];

  if (!context.hasProject) {
    choices.push({
      name: 'Start a new project',
      value: 'init',
      description: 'Initialize and set up a project',
    });
  }

  choices.push({
    name: 'Plan a project',
    value: 'plan',
    description: 'Create autonomous plan from a goal',
  });

  if (context.hasProject && (context.pendingCount > 0 || context.inProgressCount > 0)) {
    choices.push({
      name: `Run requirements ${chalk.dim(`(${context.pendingCount} pending)`)}`,
      value: 'run',
      description: 'Execute pending requirements',
    });
  } else {
    choices.push({
      name: 'Run requirements',
      value: 'run',
      description: 'Execute pending requirements',
    });
  }

  choices.push({
    name: 'View status',
    value: 'status',
    description: 'Check current progress',
  });

  choices.push({
    name: 'Manage requirements',
    value: 'requirements',
    description: 'Add, list, or modify requirements',
  });

  if (context.hasDaemon) {
    choices.push({
      name: 'View daemon logs',
      value: 'logs',
      description: 'Follow background process output',
    });
    choices.push({
      name: chalk.yellow('Stop daemon'),
      value: 'stop',
      description: 'Stop background process',
    });
  }

  choices.push({
    name: 'Configuration',
    value: 'config',
    description: 'Project and MCP settings',
  });

  choices.push({
    name: 'Update orchestrator',
    value: 'update',
    description: `Check for updates (v${getCurrentVersion()})`,
  });

  choices.push({
    name: chalk.dim('Exit'),
    value: 'exit',
  });

  return choices;
}

async function showRequirementsMenu(context: MenuContext): Promise<void> {
  const action = await select({
    message: 'Manage requirements:',
    choices: [
      { name: 'Add a new requirement', value: 'add' },
      { name: 'List all requirements', value: 'list' },
      { name: chalk.dim('Back to main menu'), value: 'back' },
    ],
  });

  switch (action) {
    case 'add': {
      const requirement = await input({
        message: 'Enter requirement:',
        validate: (value) => value.length > 0 || 'Requirement cannot be empty',
      });
      await addCommand(requirement, {
        path: context.projectPath,
        priority: '0',
      });
      break;
    }
    case 'list':
      await listCommand({
        path: context.projectPath,
        status: 'all',
        json: false,
      });
      break;
    case 'back':
      return;
  }

  // After action, show menu again
  await showRequirementsMenu(context);
}

async function showConfigMenu(context: MenuContext): Promise<void> {
  const action = await select({
    message: 'Configuration:',
    choices: [
      { name: 'Project settings', value: 'project', disabled: !context.hasProject },
      { name: 'MCP servers', value: 'mcp' },
      { name: chalk.dim('Back to main menu'), value: 'back' },
    ],
  });

  switch (action) {
    case 'project':
      await configInteractive({ path: context.projectPath });
      break;
    case 'mcp':
      console.log(chalk.dim('\nUse these commands for MCP management:'));
      console.log(chalk.white('  orchestrate mcp list     '), chalk.dim('# List configured servers'));
      console.log(chalk.white('  orchestrate mcp add <n>  '), chalk.dim('# Add a server'));
      console.log(chalk.white('  orchestrate mcp auth <n> '), chalk.dim('# Authorize a server'));
      console.log();
      break;
    case 'back':
      return;
  }
}

export async function mainMenuCommand(options: { path: string }): Promise<void> {
  const projectPath = path.resolve(options.path);

  printBanner();

  const context = await getMenuContext(projectPath);
  printContextInfo(context);

  while (true) {
    const choices = buildMainMenuChoices(context);

    const action = await select({
      message: 'What would you like to do?',
      choices: choices.map((c) => ({
        name: c.description ? `${c.name}  ${chalk.dim(c.description)}` : c.name,
        value: c.value,
      })),
    });

    console.log();

    switch (action) {
      case 'init':
        await initCommand({
          path: projectPath,
          interactive: true,
          claudeMd: true,
          cloud: true,
        });
        return;

      case 'plan': {
        const goal = await input({
          message: 'What would you like to build?',
          validate: (value) => value.length > 0 || 'Please describe your goal',
        });

        const background = await confirm({
          message: 'Run in background? (you can close the terminal)',
          default: true,
        });

        await planCommand(goal, {
          path: projectPath,
          dashboard: !background,
          concurrency: '3',
          background,
        });
        return;
      }

      case 'run': {
        const background = await confirm({
          message: 'Run in background?',
          default: false,
        });

        await runCommand(undefined, {
          path: projectPath,
          sequential: false,
          concurrency: '3',
          dashboard: !background,
          background,
        });
        return;
      }

      case 'status':
        await statusCommand({
          path: projectPath,
          json: false,
        });
        console.log();
        break;

      case 'requirements':
        await showRequirementsMenu(context);
        break;

      case 'logs':
        await tailLogs(projectPath, { lines: 50, follow: true });
        return;

      case 'stop': {
        const result = stopDaemon(projectPath);
        if (result.success) {
          console.log(chalk.green('Daemon stopped'));
          context.hasDaemon = false;
        } else {
          console.log(chalk.yellow(result.error ?? 'Failed to stop daemon'));
        }
        console.log();
        break;
      }

      case 'config':
        await showConfigMenu(context);
        break;

      case 'update': {
        console.log(chalk.cyan('Checking for updates...\n'));
        const info = await checkForUpdates();
        if (info.isOutdated) {
          console.log(chalk.yellow(`Updates available: ${info.commitsBehind} commits behind`));
          console.log(chalk.dim(`  Current: ${info.current}`));
          console.log(chalk.dim(`  Latest:  ${info.latest}\n`));

          const doUpdate = await confirm({
            message: 'Update now?',
            default: true,
          });

          if (doUpdate) {
            await updateToLatest();
          }
        } else {
          console.log(chalk.green('Already up to date!'));
          console.log(chalk.dim(`  Version: ${info.current}\n`));
        }
        break;
      }

      case 'exit':
        console.log(chalk.dim('Goodbye!\n'));
        return;
    }
  }
}
