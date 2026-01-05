import path from 'node:path';
import { select, input, confirm, editor } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { sessionManager } from '../../core/session-manager.js';
import { PlanController } from '../../planning/plan-controller.js';
import {
  presentFullPlan,
  presentRequirements,
  presentRequirementDetails,
  presentQuestions,
} from '../../planning/plan-presenter.js';
import { getDaemonStatus, stopDaemon, tailLogs, spawnDaemon } from '../daemon.js';
import { checkForUpdates, updateToLatest, getCurrentVersion } from '../updater.js';
import { initCommand } from './init.js';
import { planCommand } from './plan.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';
import { addCommand } from './add.js';
import { listCommand } from './list.js';
import { configInteractive } from './config.js';
import { mcpConfigManager } from '../../core/mcp-config-manager.js';
import { credentialManager } from '../../core/credential-manager.js';
import { authFlowManager } from '../../core/auth-flow-manager.js';
import { createWorktreeHealthChecker, type WorktreeIssue } from '../../core/worktree-health.js';
import type { Plan, PlannedRequirement } from '../../core/types.js';
import type { MCPServerConfig, MCPTransportType, MCPAuthType } from '../../core/mcp-types.js';
import { interactiveCommand as secretsInteractive } from './secrets.js';
import { interactiveCommand as projectsInteractive } from './projects.js';
import { interactiveCommand as telegramInteractive } from './telegram.js';

// Unified Interactions System
import {
  FlowRunner,
  cliRenderer,
  buildFlowContext,
  createCliUser,
  mainMenuFlow,
  getSubFlowId,
  printBanner as flowPrintBanner,
  printContextInfo as flowPrintContextInfo,
  // Unified flows
  daemonFlow,
  runFlow,
  requirementsFlow,
  // Action handling
  executeAction,
  isActionMarker,
  getActionName,
  // Flow registry
  getFlow,
} from '../../interactions/index.js';
import type { MainMenuContext, DaemonFlowContext, RunFlowContext, RequirementsFlowContext } from '../../interactions/index.js';

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
  activePlan: Plan | null;
  sessionId: string | null;
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
    activePlan: null,
    sessionId: null,
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
    context.sessionId = session.id;

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

    context.activePlan = store.getActivePlan(session.id);
    sessionManager.close();
  } catch {
    sessionManager.close();
  }

  return context;
}

async function refreshContext(context: MenuContext): Promise<void> {
  const fresh = await getMenuContext(context.projectPath);
  Object.assign(context, fresh);
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
    if (context.pendingCount > 0) statusParts.push(chalk.yellow(`${context.pendingCount} pending`));
    if (context.inProgressCount > 0) statusParts.push(chalk.blue(`${context.inProgressCount} in progress`));
    if (context.completedCount > 0) statusParts.push(chalk.green(`${context.completedCount} completed`));
    if (context.failedCount > 0) statusParts.push(chalk.red(`${context.failedCount} failed`));

    if (statusParts.length > 0) {
      console.log(chalk.dim('  Requirements:'), statusParts.join(chalk.dim(' | ')));
    }

    if (context.hasDaemon) {
      console.log(chalk.dim('  Daemon:'), chalk.green(`running (PID ${context.daemonPid})`));
    }

    if (context.activePlan) {
      const statusColor = getPlanStatusColor(context.activePlan.status);
      console.log(chalk.dim('  Plan:'), statusColor(context.activePlan.status), chalk.dim('-'), truncateText(context.activePlan.highLevelGoal, 40));
    }
  } else {
    console.log(chalk.dim('  No project initialized in current directory'));
  }
  console.log();
}

function getPlanStatusColor(status: string): (text: string) => string {
  switch (status) {
    case 'drafting':
    case 'questioning':
      return chalk.yellow;
    case 'pending_approval':
      return chalk.blue;
    case 'approved':
    case 'executing':
      return chalk.cyan;
    case 'completed':
      return chalk.green;
    case 'rejected':
      return chalk.red;
    default:
      return chalk.white;
  }
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
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

  if (context.activePlan) {
    const statusColor = getPlanStatusColor(context.activePlan.status);
    choices.push({
      name: `Manage plan ${statusColor(`(${context.activePlan.status})`)}`,
      value: 'plan',
      description: 'View, edit, or execute your plan',
    });
  } else {
    choices.push({
      name: 'Plan a project',
      value: 'plan',
      description: 'Create autonomous plan from a goal',
    });
  }

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
      name: 'Daemon controls',
      value: 'daemon',
      description: 'View logs, stop background process',
    });
  }

  choices.push({
    name: 'Configuration',
    value: 'config',
    description: 'Project and MCP settings',
  });

  // Global settings menus
  choices.push({
    name: 'Secrets management',
    value: 'secrets',
    description: 'Manage environment secrets (dev/staging/prod)',
  });

  choices.push({
    name: 'Project registry',
    value: 'projects',
    description: 'Manage global project registry',
  });

  choices.push({
    name: 'Telegram bot',
    value: 'telegram',
    description: 'Bot control and user management',
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

// ============================================================================
// Requirements Menu
// ============================================================================

async function showRequirementsMenu(context: MenuContext): Promise<void> {
  while (true) {
    // Refresh counts
    await refreshContext(context);

    const choices = [
      { name: 'Add a new requirement', value: 'add' },
      { name: 'List all requirements', value: 'list' },
    ];

    if (context.pendingCount > 0) {
      choices.push({ name: `Run pending (${context.pendingCount})`, value: 'run' });
    }

    choices.push({ name: chalk.dim('Back to main menu'), value: 'back' });

    const action = await select({
      message: 'Manage requirements:',
      choices,
    });

    if (action === 'back') return;

    console.log();

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
        await refreshContext(context);
        break;
      }
      case 'list':
        await listCommand({
          path: context.projectPath,
          status: 'all',
          json: false,
        });
        await input({ message: chalk.dim('Press Enter to continue...') });
        break;
      case 'run':
        await showRunMenu(context);
        return; // Return to main menu after run
    }
  }
}

// ============================================================================
// Run Menu
// ============================================================================

async function showRunMenu(context: MenuContext): Promise<void> {
  console.log();
  console.log(chalk.cyan.bold('  Run Options'));
  console.log(chalk.dim('  ' + '─'.repeat(50)));

  const runMode = await select({
    message: 'How would you like to run?',
    choices: [
      { name: 'Foreground (watch progress)', value: 'foreground', description: 'See live output' },
      { name: 'Background (daemon)', value: 'background', description: 'Run detached, safe to close terminal' },
      { name: chalk.dim('Cancel'), value: 'cancel' },
    ],
  });

  if (runMode === 'cancel') return;

  const concurrency = await select({
    message: 'Concurrency level:',
    choices: [
      { name: '1 (sequential)', value: '1' },
      { name: '3 (default)', value: '3' },
      { name: '5 (parallel)', value: '5' },
      { name: 'Custom...', value: 'custom' },
    ],
  });

  let concurrencyValue = concurrency;
  if (concurrency === 'custom') {
    concurrencyValue = await input({
      message: 'Enter concurrency (1-10):',
      default: '3',
      validate: (v) => {
        const n = parseInt(v, 10);
        return (n >= 1 && n <= 10) || 'Must be between 1 and 10';
      },
    });
  }

  console.log();

  if (runMode === 'background') {
    const result = spawnDaemon(context.projectPath, 'run', [
      '-p', context.projectPath,
      '--concurrency', concurrencyValue,
    ]);

    if (result.success) {
      console.log(chalk.green(`✓ Started in background (PID ${result.pid})`));
      console.log(chalk.dim('\nYou can safely close this terminal.'));
      console.log(chalk.dim('Use "Daemon controls" from main menu to view logs or stop.\n'));
      context.hasDaemon = true;
      context.daemonPid = result.pid;
    } else {
      console.log(chalk.red(`✗ Failed to start: ${result.error}`));
    }
    await input({ message: chalk.dim('Press Enter to continue...') });
  } else {
    // Foreground run
    console.log(chalk.cyan('Running requirements...\n'));
    await runCommand(undefined, {
      path: context.projectPath,
      sequential: concurrencyValue === '1',
      concurrency: concurrencyValue,
      dashboard: true,
      background: false,
    });
    console.log();
    await refreshContext(context);
    await input({ message: chalk.dim('Press Enter to continue...') });
  }
}

// ============================================================================
// Daemon Menu
// ============================================================================

async function showDaemonMenu(context: MenuContext): Promise<void> {
  while (context.hasDaemon) {
    await refreshContext(context);

    if (!context.hasDaemon) {
      console.log(chalk.dim('Daemon is no longer running.'));
      return;
    }

    const action = await select({
      message: `Daemon controls (PID ${context.daemonPid}):`,
      choices: [
        { name: 'View recent logs', value: 'logs' },
        { name: 'Follow logs (live)', value: 'follow' },
        { name: chalk.yellow('Stop daemon'), value: 'stop' },
        { name: chalk.dim('Back to main menu'), value: 'back' },
      ],
    });

    if (action === 'back') return;

    console.log();

    switch (action) {
      case 'logs':
        await tailLogs(context.projectPath, { lines: 30, follow: false });
        await input({ message: chalk.dim('Press Enter to continue...') });
        break;
      case 'follow':
        console.log(chalk.dim('Following logs (Ctrl+C to stop)...\n'));
        await tailLogs(context.projectPath, { lines: 20, follow: true });
        break;
      case 'stop': {
        const confirmStop = await confirm({
          message: 'Stop the background daemon?',
          default: true,
        });
        if (confirmStop) {
          const result = stopDaemon(context.projectPath);
          if (result.success) {
            console.log(chalk.green('✓ Daemon stopped'));
            context.hasDaemon = false;
          } else {
            console.log(chalk.yellow(result.error ?? 'Failed to stop daemon'));
          }
        }
        break;
      }
    }
  }
}

// ============================================================================
// Config Menu
// ============================================================================

async function showConfigMenu(context: MenuContext): Promise<void> {
  while (true) {
    const action = await select({
      message: 'Configuration:',
      choices: [
        { name: 'Project settings', value: 'project', disabled: !context.hasProject ? '(no project)' : false },
        { name: 'MCP servers', value: 'mcp' },
        { name: 'Git worktrees', value: 'worktrees', disabled: !context.hasProject ? '(no project)' : false },
        { name: chalk.dim('Back to main menu'), value: 'back' },
      ],
    });

    if (action === 'back') return;

    console.log();

    switch (action) {
      case 'project':
        await configInteractive({ path: context.projectPath });
        break;
      case 'mcp':
        await showMcpMenu(context);
        break;
      case 'worktrees':
        await showWorktreeMenu(context);
        break;
    }
  }
}

// ============================================================================
// MCP Menu (fully interactive)
// ============================================================================

async function showMcpMenu(context: MenuContext): Promise<void> {
  while (true) {
    console.log();
    console.log(chalk.cyan.bold('  MCP Server Configuration'));
    console.log(chalk.dim('  ' + '─'.repeat(50)));

    // Load and display servers
    await credentialManager.initialize();
    const config = await mcpConfigManager.getMergedConfig(context.projectPath);
    const servers = Object.entries(config.mcpServers);

    if (servers.length === 0) {
      console.log(chalk.dim('  No MCP servers configured.'));
    } else {
      for (const [name, server] of servers) {
        const enabled = server.enabled !== false;
        const authRequired = server.requiresAuth ?? false;

        let status = enabled ? chalk.green('●') : chalk.dim('○');
        let authStatus = '';

        if (authRequired) {
          const hasCredentials = await credentialManager.hasCredential(
            name,
            server.scope === 'project' ? context.projectPath : undefined
          );
          authStatus = hasCredentials ? chalk.green(' ✓') : chalk.yellow(' ⚠');
        }

        console.log(`  ${status} ${name}${authStatus}  ${chalk.dim(server.type)}`);
      }
    }
    console.log();

    const choices = [
      { name: 'Add a server', value: 'add' },
    ];

    if (servers.length > 0) {
      choices.push({ name: 'Authorize a server', value: 'auth' });
      choices.push({ name: 'Enable/disable a server', value: 'toggle' });
      choices.push({ name: 'Remove a server', value: 'remove' });
    }

    choices.push({ name: chalk.dim('Back'), value: 'back' });

    const action = await select({
      message: 'MCP actions:',
      choices,
    });

    if (action === 'back') return;

    console.log();

    switch (action) {
      case 'add':
        await addMcpServer(context);
        break;
      case 'auth':
        await authMcpServer(context);
        break;
      case 'toggle':
        await toggleMcpServer(context);
        break;
      case 'remove':
        await removeMcpServer(context);
        break;
    }
  }
}

async function addMcpServer(context: MenuContext): Promise<void> {
  const name = await input({
    message: 'Server name:',
    validate: (v) => v.length > 0 || 'Name is required',
  });

  const transportType = await select({
    message: 'Transport type:',
    choices: [
      { name: 'stdio (local process)', value: 'stdio' },
      { name: 'http (REST API)', value: 'http' },
      { name: 'sse (Server-Sent Events)', value: 'sse' },
    ],
  }) as MCPTransportType;

  const serverConfig: MCPServerConfig = {
    type: transportType,
    enabled: true,
  };

  if (transportType === 'stdio') {
    serverConfig.command = await input({
      message: 'Command to run:',
      default: 'npx',
    });
    const argsStr = await input({
      message: 'Arguments (space-separated):',
    });
    if (argsStr) {
      serverConfig.args = argsStr.split(' ').filter(Boolean);
    }
  } else {
    serverConfig.url = await input({
      message: 'Server URL:',
      validate: (v) => v.length > 0 || 'URL is required',
    });
  }

  const requiresAuth = await confirm({
    message: 'Requires authentication?',
    default: false,
  });

  if (requiresAuth) {
    serverConfig.requiresAuth = true;
    serverConfig.authType = await select({
      message: 'Auth type:',
      choices: [
        { name: 'API Key', value: 'api_key' },
        { name: 'OAuth', value: 'oauth' },
        { name: 'Token', value: 'token' },
      ],
    }) as MCPAuthType;
  }

  const description = await input({
    message: 'Description (optional):',
  });
  if (description) {
    serverConfig.description = description;
  }

  const scope = await select({
    message: 'Scope:',
    choices: [
      { name: 'This project only', value: 'project' },
      { name: 'Global (all projects)', value: 'global' },
    ],
  });

  await mcpConfigManager.addServer(
    name,
    serverConfig,
    scope === 'project' ? context.projectPath : undefined
  );

  console.log(chalk.green(`\n✓ Server "${name}" added!`));

  if (requiresAuth) {
    const authNow = await confirm({
      message: 'Authorize now?',
      default: true,
    });
    if (authNow) {
      await doMcpAuth(name, serverConfig, context);
    }
  }
}

async function authMcpServer(context: MenuContext): Promise<void> {
  const config = await mcpConfigManager.getMergedConfig(context.projectPath);
  const servers = Object.entries(config.mcpServers).filter(([, s]) => s.requiresAuth);

  if (servers.length === 0) {
    console.log(chalk.dim('No servers require authentication.'));
    return;
  }

  const serverName = await select({
    message: 'Select server to authorize:',
    choices: servers.map(([name]) => ({ name, value: name }))
      .concat([{ name: chalk.dim('Cancel'), value: '' }]),
  });

  if (!serverName) return;

  const serverConfig = config.mcpServers[serverName]!;
  await doMcpAuth(serverName, serverConfig, context);
}

async function doMcpAuth(name: string, serverConfig: MCPServerConfig, context: MenuContext): Promise<void> {
  try {
    console.log(chalk.cyan(`\nStarting ${serverConfig.authType ?? 'token'} authorization flow...`));

    const credential = await authFlowManager.authorize(name, serverConfig, context.projectPath);

    await credentialManager.setCredential(
      name,
      credential,
      serverConfig.scope === 'project' ? context.projectPath : undefined
    );

    console.log(chalk.green(`✓ Server "${name}" authorized!`));
  } catch (error) {
    console.log(chalk.red(`✗ Authorization failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}

async function toggleMcpServer(context: MenuContext): Promise<void> {
  const config = await mcpConfigManager.getMergedConfig(context.projectPath);
  const servers = Object.entries(config.mcpServers);

  const serverName = await select({
    message: 'Select server:',
    choices: servers.map(([name, s]) => ({
      name: `${s.enabled !== false ? chalk.green('●') : chalk.dim('○')} ${name}`,
      value: name,
    })).concat([{ name: chalk.dim('Cancel'), value: '' }]),
  });

  if (!serverName) return;

  const server = config.mcpServers[serverName]!;
  const currentlyEnabled = server.enabled !== false;

  const newState = await select({
    message: `Server "${serverName}" is ${currentlyEnabled ? 'enabled' : 'disabled'}:`,
    choices: [
      { name: 'Enable', value: true, disabled: currentlyEnabled ? 'Already enabled' : false },
      { name: 'Disable', value: false, disabled: !currentlyEnabled ? 'Already disabled' : false },
    ],
  });

  await mcpConfigManager.setServerEnabled(serverName, newState, context.projectPath);
  console.log(chalk.green(`✓ Server "${serverName}" ${newState ? 'enabled' : 'disabled'}`));
}

async function removeMcpServer(context: MenuContext): Promise<void> {
  const config = await mcpConfigManager.getMergedConfig(context.projectPath);
  const servers = Object.keys(config.mcpServers);

  const serverName = await select({
    message: 'Select server to remove:',
    choices: servers.map((name) => ({ name, value: name }))
      .concat([{ name: chalk.dim('Cancel'), value: '' }]),
  });

  if (!serverName) return;

  const confirmRemove = await confirm({
    message: `Remove "${serverName}"? This cannot be undone.`,
    default: false,
  });

  if (!confirmRemove) return;

  await credentialManager.removeCredential(serverName, context.projectPath);
  await mcpConfigManager.removeServer(serverName, context.projectPath);

  console.log(chalk.green(`✓ Server "${serverName}" removed`));
}

// ============================================================================
// Worktree Menu
// ============================================================================

async function showWorktreeMenu(context: MenuContext): Promise<void> {
  while (true) {
    console.log();
    console.log(chalk.cyan.bold('  Git Worktree Health'));
    console.log(chalk.dim('  ' + '─'.repeat(50)));

    // Run health check
    await sessionManager.initialize(context.projectPath);
    const session = await sessionManager.resumeSession(context.projectPath);
    const store = sessionManager.getStore();
    const checker = createWorktreeHealthChecker(context.projectPath, store);

    const spinner = ora('  Checking worktree health...').start();
    const health = await checker.checkHealth(session.id);
    spinner.stop();

    if (!health.isGitRepo) {
      console.log(chalk.dim('  Not a git repository. Worktrees not available.'));
      sessionManager.close();

      await select({
        message: '',
        choices: [{ name: 'Back', value: 'back' }],
      });
      return;
    }

    // Display status
    const gitCount = health.gitWorktrees.length - 1; // Exclude main worktree
    const dbCount = health.dbWorktrees.filter(w => w.status === 'active').length;
    const issueCount = health.issues.length;

    console.log(chalk.dim('  Git worktrees:'), gitCount === 0 ? chalk.green('0 (clean)') : chalk.yellow(String(gitCount)));
    console.log(chalk.dim('  DB entries (active):'), dbCount);

    if (health.healthy) {
      console.log(chalk.green('\n  ✓ Worktrees are healthy'));
    } else {
      console.log(chalk.red(`\n  ⚠ Found ${issueCount} issue(s):`));
      for (const issue of health.issues) {
        const icon = issue.autoFixable ? chalk.yellow('⚡') : chalk.red('✗');
        console.log(`    ${icon} ${issue.description}`);
      }
    }
    console.log();

    // Build choices
    const choices: Array<{ name: string; value: string; disabled?: boolean | string }> = [];

    choices.push({
      name: 'Refresh status',
      value: 'refresh',
    });

    if (!health.healthy) {
      choices.push({
        name: chalk.yellow('Auto-repair issues'),
        value: 'repair',
        disabled: health.issues.filter(i => i.autoFixable).length === 0 ? 'No auto-fixable issues' : false,
      });
    }

    choices.push({
      name: 'View worktree details',
      value: 'details',
      disabled: gitCount === 0 && dbCount === 0 ? 'No worktrees' : false,
    });

    choices.push({
      name: chalk.red('Full cleanup (remove all worktrees)'),
      value: 'cleanup',
      disabled: gitCount === 0 && dbCount === 0 ? 'No worktrees' : false,
    });

    choices.push({
      name: chalk.dim('Back to configuration'),
      value: 'back',
    });

    const action = await select({
      message: 'Worktree actions:',
      choices,
    });

    if (action === 'back') {
      sessionManager.close();
      return;
    }

    switch (action) {
      case 'refresh':
        // Just loop to refresh
        break;

      case 'repair':
        await repairWorktrees(checker, health.issues, session.id);
        break;

      case 'details':
        await showWorktreeDetails(health, store, session.id);
        break;

      case 'cleanup':
        await fullWorktreeCleanup(checker, session.id);
        break;
    }

    sessionManager.close();
  }
}

async function repairWorktrees(
  checker: ReturnType<typeof createWorktreeHealthChecker>,
  issues: WorktreeIssue[],
  sessionId: string
): Promise<void> {
  const fixableIssues = issues.filter(i => i.autoFixable);

  if (fixableIssues.length === 0) {
    console.log(chalk.dim('\n  No auto-fixable issues found.'));
    return;
  }

  console.log(chalk.cyan(`\n  Repairing ${fixableIssues.length} issue(s)...\n`));

  const result = await checker.repair(fixableIssues);

  for (const fixed of result.fixed) {
    console.log(chalk.green(`  ✓ ${fixed}`));
  }

  for (const failed of result.failed) {
    console.log(chalk.red(`  ✗ ${failed.issue}: ${failed.error}`));
  }

  if (result.success) {
    console.log(chalk.green('\n  ✓ All issues repaired!'));
  } else {
    console.log(chalk.yellow('\n  ⚠ Some issues could not be repaired.'));
  }

  console.log();
  await input({ message: chalk.dim('Press Enter to continue...') });
}

async function showWorktreeDetails(
  health: Awaited<ReturnType<ReturnType<typeof createWorktreeHealthChecker>['checkHealth']>>,
  store: ReturnType<typeof sessionManager.getStore>,
  sessionId: string
): Promise<void> {
  console.log(chalk.cyan('\n  Git Worktrees:\n'));

  for (const wt of health.gitWorktrees) {
    const isMain = wt.path === process.cwd() || wt.branch === 'main' || wt.branch === 'master';

    if (isMain) {
      console.log(chalk.dim(`  ${wt.branch} (main worktree)`));
    } else {
      let status = '';
      if (wt.locked) status += chalk.red(' [locked]');
      if (wt.prunable) status += chalk.yellow(' [orphaned]');

      console.log(`  ${chalk.blue(wt.branch)}${status}`);
      console.log(chalk.dim(`    Path: ${wt.path}`));
    }
  }

  console.log(chalk.cyan('\n  Database Entries:\n'));

  for (const wt of health.dbWorktrees) {
    let statusColor = chalk.white;
    if (wt.status === 'active') statusColor = chalk.green;
    if (wt.status === 'merged') statusColor = chalk.blue;
    if (wt.status === 'abandoned') statusColor = chalk.dim;

    console.log(`  ${wt.branchName} ${statusColor(`(${wt.status})`)}`);
    console.log(chalk.dim(`    Created: ${wt.createdAt.toLocaleString()}`));
    if (wt.mergedAt) {
      console.log(chalk.dim(`    Merged: ${wt.mergedAt.toLocaleString()}`));
    }
  }

  console.log();
  await input({ message: chalk.dim('Press Enter to continue...') });
}

async function fullWorktreeCleanup(
  checker: ReturnType<typeof createWorktreeHealthChecker>,
  sessionId: string
): Promise<void> {
  console.log(chalk.red('\n  ⚠️  Full Worktree Cleanup'));
  console.log(chalk.dim('  This will remove ALL worktrees and reset to a clean state.'));
  console.log(chalk.dim('  Feature branches will be deleted.'));
  console.log();

  const confirmCleanup = await confirm({
    message: 'Are you sure you want to proceed?',
    default: false,
  });

  if (!confirmCleanup) {
    console.log(chalk.dim('\n  Cleanup cancelled.'));
    return;
  }

  console.log(chalk.cyan('\n  Cleaning up...\n'));

  const result = await checker.fullCleanup(sessionId);

  for (const fixed of result.fixed) {
    console.log(chalk.green(`  ✓ ${fixed}`));
  }

  for (const failed of result.failed) {
    console.log(chalk.red(`  ✗ ${failed.issue}: ${failed.error}`));
  }

  if (result.success) {
    console.log(chalk.green('\n  ✓ Full cleanup complete!'));
  } else {
    console.log(chalk.yellow('\n  ⚠ Cleanup completed with some errors.'));
  }

  console.log();
  await input({ message: chalk.dim('Press Enter to continue...') });
}

// ============================================================================
// Plan Menu
// ============================================================================

async function showPlanMenu(context: MenuContext): Promise<void> {
  if (!context.activePlan) {
    // No active plan - offer to create one
    const goal = await input({
      message: 'What would you like to build?',
      validate: (value) => value.length > 0 || 'Please describe your goal',
    });

    console.log(chalk.cyan('\nCreating plan...\n'));
    await planCommand(goal, {
      path: context.projectPath,
      dashboard: false,
      concurrency: '3',
    });

    await refreshContext(context);
    return;
  }

  while (context.activePlan) {
    const plan = context.activePlan;

    console.log();
    console.log(chalk.cyan.bold('  Current Plan'));
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log(chalk.dim('  Goal:'), plan.highLevelGoal);
    console.log(chalk.dim('  Status:'), getPlanStatusColor(plan.status)(plan.status));
    console.log(chalk.dim('  Requirements:'), plan.requirements.length);
    console.log();

    const choices: Array<{ name: string; value: string; disabled?: boolean | string }> = [];

    // View options
    choices.push({ name: 'View full plan', value: 'view' });
    choices.push({ name: 'View requirements', value: 'view_reqs' });
    choices.push({ name: 'View questions & answers', value: 'view_questions' });

    // Edit options
    const canEdit = ['drafting', 'questioning', 'pending_approval', 'approved'].includes(plan.status);
    choices.push({ name: 'Edit requirements', value: 'edit_reqs', disabled: !canEdit ? 'Plan is executing' : false });
    choices.push({ name: 'Edit questions', value: 'edit_questions', disabled: (!canEdit || plan.questions.length === 0) ? 'Not available' : false });

    // Action options based on status
    if (plan.status === 'pending_approval') {
      choices.push({ name: chalk.green('Approve and execute'), value: 'approve' });
    } else if (plan.status === 'approved') {
      choices.push({ name: chalk.green('Execute plan'), value: 'execute' });
    } else if (plan.status === 'drafting' || plan.status === 'questioning') {
      choices.push({ name: 'Continue plan creation', value: 'continue' });
    }

    const canReject = !['executing', 'completed'].includes(plan.status);
    choices.push({ name: chalk.red('Reject plan'), value: 'reject', disabled: !canReject ? 'Cannot reject' : false });
    choices.push({ name: chalk.dim('Back to main menu'), value: 'back' });

    const action = await select({
      message: 'Plan actions:',
      choices,
    });

    if (action === 'back') return;

    console.log();

    switch (action) {
      case 'view':
        presentFullPlan(plan);
        await input({ message: chalk.dim('Press Enter to continue...') });
        break;

      case 'view_reqs':
        presentRequirements(plan.requirements, plan.implementationOrder);
        presentRequirementDetails(plan.requirements);
        await input({ message: chalk.dim('Press Enter to continue...') });
        break;

      case 'view_questions':
        presentQuestions(plan.questions);
        await input({ message: chalk.dim('Press Enter to continue...') });
        break;

      case 'edit_reqs':
        await editRequirements(context);
        break;

      case 'edit_questions':
        await editQuestions(context);
        break;

      case 'approve':
        await approvePlan(context);
        await refreshContext(context);
        break;

      case 'execute':
        await executePlan(context);
        await refreshContext(context);
        break;

      case 'continue':
        await planCommand(undefined, {
          path: context.projectPath,
          resume: true,
          dashboard: false,
          concurrency: '3',
        });
        await refreshContext(context);
        break;

      case 'reject':
        await rejectPlan(context);
        await refreshContext(context);
        return; // Return to main menu after rejecting
    }

    // Refresh plan state
    await refreshContext(context);
  }
}

async function editRequirements(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  const plan = context.activePlan;

  while (true) {
    console.log();
    console.log(chalk.cyan.bold('  Edit Requirements'));
    console.log(chalk.dim('  ' + '─'.repeat(50)));

    plan.requirements.forEach((req, i) => {
      console.log(`  ${chalk.bold((i + 1).toString().padStart(2))}. ${req.title}`);
    });
    console.log();

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Edit a requirement', value: 'edit' },
        { name: 'Reorder requirements', value: 'reorder' },
        { name: 'Remove a requirement', value: 'remove' },
        { name: 'Add a new requirement', value: 'add' },
        { name: chalk.dim('Done editing'), value: 'done' },
      ],
    });

    if (action === 'done') break;

    await sessionManager.initialize(context.projectPath);
    await sessionManager.resumeSession(context.projectPath);
    const store = sessionManager.getStore();

    switch (action) {
      case 'edit': {
        const reqIndex = await selectRequirement(plan.requirements, 'Select requirement to edit:');
        if (reqIndex >= 0) {
          const req = plan.requirements[reqIndex]!;
          const updated = await editSingleRequirement(req);
          plan.requirements[reqIndex] = updated;
          store.updatePlan(plan.id, { requirements: plan.requirements });
          console.log(chalk.green('✓ Requirement updated'));
        }
        break;
      }

      case 'reorder': {
        const fromIndex = await selectRequirement(plan.requirements, 'Select requirement to move:');
        if (fromIndex >= 0) {
          const toIndex = await selectRequirement(plan.requirements, 'Move to position:', fromIndex);
          if (toIndex >= 0 && toIndex !== fromIndex) {
            const [moved] = plan.requirements.splice(fromIndex, 1);
            plan.requirements.splice(toIndex, 0, moved!);
            plan.implementationOrder = plan.requirements.map(r => r.id);
            store.updatePlan(plan.id, {
              requirements: plan.requirements,
              implementationOrder: plan.implementationOrder,
            });
            console.log(chalk.green('✓ Requirements reordered'));
          }
        }
        break;
      }

      case 'remove': {
        const reqIndex = await selectRequirement(plan.requirements, 'Select requirement to remove:');
        if (reqIndex >= 0) {
          const req = plan.requirements[reqIndex]!;
          const confirmRemove = await confirm({
            message: `Remove "${req.title}"?`,
            default: false,
          });
          if (confirmRemove) {
            plan.requirements.splice(reqIndex, 1);
            plan.implementationOrder = plan.implementationOrder.filter(id => id !== req.id);
            store.updatePlan(plan.id, {
              requirements: plan.requirements,
              implementationOrder: plan.implementationOrder,
            });
            console.log(chalk.green('✓ Requirement removed'));
          }
        }
        break;
      }

      case 'add': {
        const newReq = await createNewRequirement(plan.requirements.length);
        plan.requirements.push(newReq);
        plan.implementationOrder.push(newReq.id);
        store.updatePlan(plan.id, {
          requirements: plan.requirements,
          implementationOrder: plan.implementationOrder,
        });
        console.log(chalk.green('✓ Requirement added'));
        break;
      }
    }

    sessionManager.close();
    context.activePlan = plan;
  }
}

async function selectRequirement(requirements: PlannedRequirement[], message: string, excludeIndex = -1): Promise<number> {
  const choices = requirements
    .map((req, i) => ({
      name: `${i + 1}. ${req.title}`,
      value: i,
      disabled: i === excludeIndex,
    }))
    .concat([{ name: chalk.dim('Cancel'), value: -1, disabled: false }]);

  return await select({ message, choices });
}

async function editSingleRequirement(req: PlannedRequirement): Promise<PlannedRequirement> {
  const field = await select({
    message: 'What would you like to edit?',
    choices: [
      { name: 'Title', value: 'title' },
      { name: 'Description', value: 'description' },
      { name: 'Complexity', value: 'complexity' },
      { name: 'Technical notes', value: 'notes' },
    ],
  });

  switch (field) {
    case 'title':
      req.title = await input({ message: 'New title:', default: req.title });
      break;
    case 'description':
      req.description = await editor({ message: 'Edit description:', default: req.description });
      break;
    case 'complexity':
      req.estimatedComplexity = await select({
        message: 'Complexity:',
        choices: [
          { name: 'Low', value: 'low' as const },
          { name: 'Medium', value: 'medium' as const },
          { name: 'High', value: 'high' as const },
        ],
        default: req.estimatedComplexity,
      });
      break;
    case 'notes':
      const notesStr = await editor({
        message: 'Edit technical notes (one per line):',
        default: req.technicalNotes.join('\n'),
      });
      req.technicalNotes = notesStr.split('\n').filter(n => n.trim());
      break;
  }

  return req;
}

async function createNewRequirement(existingCount: number): Promise<PlannedRequirement> {
  const title = await input({
    message: 'Requirement title:',
    validate: (v) => v.length > 0 || 'Title is required',
  });

  const description = await input({ message: 'Description:' });

  const complexity = await select({
    message: 'Estimated complexity:',
    choices: [
      { name: 'Low', value: 'low' as const },
      { name: 'Medium', value: 'medium' as const },
      { name: 'High', value: 'high' as const },
    ],
  });

  return {
    id: `req_${Date.now()}`,
    title,
    description,
    userStories: [],
    acceptanceCriteria: [],
    technicalNotes: [],
    estimatedComplexity: complexity,
    dependencies: [],
    priority: existingCount + 1,
    rationale: '',
  };
}

async function editQuestions(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  const plan = context.activePlan;

  while (true) {
    console.log();
    console.log(chalk.cyan.bold('  Edit Question Answers'));
    console.log(chalk.dim('  ' + '─'.repeat(50)));

    plan.questions.forEach((q, i) => {
      const answered = q.answer ? chalk.green('✓') : chalk.dim('○');
      console.log(`  ${answered} ${chalk.bold((i + 1).toString())}. ${truncateText(q.question, 50)}`);
      if (q.answer) {
        console.log(chalk.dim(`     → ${truncateText(q.answer, 45)}`));
      }
    });
    console.log();

    const choices = plan.questions.map((q, i) => ({
      name: `${i + 1}. ${truncateText(q.question, 50)}`,
      value: i,
    })).concat([{ name: chalk.dim('Done editing'), value: -1 }]);

    const qIndex = await select({ message: 'Select question to edit:', choices });

    if (qIndex === -1) break;

    const question = plan.questions[qIndex]!;

    console.log();
    console.log(chalk.bold('Question:'), question.question);
    if (question.context) {
      console.log(chalk.dim('Context:'), question.context);
    }
    if (question.suggestedOptions?.length) {
      console.log(chalk.dim('Suggested:'), question.suggestedOptions.join(', '));
    }
    console.log();

    const newAnswer = await input({
      message: 'Your answer:',
      default: question.answer ?? '',
    });

    await sessionManager.initialize(context.projectPath);
    await sessionManager.resumeSession(context.projectPath);
    const store = sessionManager.getStore();

    question.answer = newAnswer;
    question.answeredAt = new Date();
    store.updatePlan(plan.id, { questions: plan.questions });

    sessionManager.close();

    console.log(chalk.green('✓ Answer updated'));
  }
}

async function approvePlan(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  await sessionManager.initialize(context.projectPath);
  await sessionManager.resumeSession(context.projectPath);

  const controller = new PlanController(sessionManager);
  controller.approvePlan(context.activePlan.id);

  sessionManager.close();

  console.log(chalk.green('✓ Plan approved!'));

  const executeNow = await confirm({
    message: 'Execute the plan now?',
    default: true,
  });

  if (executeNow) {
    await executePlan(context);
  }
}

async function executePlan(context: MenuContext): Promise<void> {
  const runMode = await select({
    message: 'How would you like to run?',
    choices: [
      { name: 'Foreground (watch progress)', value: 'foreground' },
      { name: 'Background (daemon)', value: 'background' },
    ],
  });

  const concurrency = await select({
    message: 'Concurrency level:',
    choices: [
      { name: '1 (sequential)', value: '1' },
      { name: '3 (default)', value: '3' },
      { name: '5 (parallel)', value: '5' },
    ],
  });

  console.log();

  if (runMode === 'background') {
    const result = spawnDaemon(context.projectPath, 'plan', [
      '--resume',
      '-p', context.projectPath,
      '--concurrency', concurrency,
    ]);

    if (result.success) {
      console.log(chalk.green(`✓ Started in background (PID ${result.pid})`));
      console.log(chalk.dim('\nYou can safely close this terminal.'));
      console.log(chalk.dim('Use "Daemon controls" from main menu to view logs or stop.\n'));
      context.hasDaemon = true;
      context.daemonPid = result.pid;
    } else {
      console.log(chalk.red(`✗ Failed to start: ${result.error}`));
    }
    await input({ message: chalk.dim('Press Enter to continue...') });
  } else {
    console.log(chalk.cyan('Executing plan...\n'));
    await planCommand(undefined, {
      path: context.projectPath,
      resume: true,
      dashboard: true,
      concurrency,
    });
    await input({ message: chalk.dim('Press Enter to continue...') });
  }
}

async function rejectPlan(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  const confirmReject = await confirm({
    message: 'Are you sure you want to reject this plan?',
    default: false,
  });

  if (!confirmReject) return;

  await sessionManager.initialize(context.projectPath);
  await sessionManager.resumeSession(context.projectPath);
  const store = sessionManager.getStore();

  store.updatePlan(context.activePlan.id, { status: 'rejected' });
  context.activePlan = null;

  sessionManager.close();

  console.log(chalk.yellow('Plan rejected'));
}

// ============================================================================
// Init Flow (stay in menu after)
// ============================================================================

async function runInitFlow(context: MenuContext): Promise<void> {
  await initCommand({
    path: context.projectPath,
    interactive: true,
    claudeMd: true,
    cloud: true,
  });

  // Refresh context after init
  await refreshContext(context);

  if (context.hasProject) {
    console.log(chalk.green('\n✓ Project initialized successfully!\n'));

    // Show MCP server status
    try {
      const mcpConfig = await mcpConfigManager.getMergedConfig(context.projectPath);
      const enabledServers = Object.entries(mcpConfig.mcpServers)
        .filter(([_, config]) => config.enabled)
        .map(([name]) => name);

      if (enabledServers.length > 0) {
        console.log(chalk.dim('  MCP Servers:'), enabledServers.join(', '));
      }
    } catch {
      // MCP status is non-critical
    }

    const startBuilding = await confirm({
      message: 'Would you like to start planning a project?',
      default: true,
    });

    if (startBuilding) {
      await showPlanMenu(context);
    }
  }
}

// ============================================================================
// Unified Flow Runner Helper
// ============================================================================

/**
 * Run a unified sub-flow with action handling
 *
 * @param flow - The flow definition to run
 * @param baseContext - The current context to pass to the flow
 * @param projectPath - The project path for refreshing context
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runUnifiedSubFlow(
  flow: any,
  baseContext: MainMenuContext,
  projectPath: string
): Promise<void> {
  // Create a new runner with the sub-flow
  const subRunner = new FlowRunner(
    flow,
    cliRenderer,
    baseContext
  );

  while (true) {
    const response = await subRunner.runCurrentStep();

    // Handle cancellation
    if (response === null) {
      const step = subRunner.getCurrentStep();
      const interaction = step?.interaction(subRunner.getContext());

      if (interaction?.type === 'display') {
        const result = await subRunner.handleResponse(null);
        if (result.done) break;
        continue;
      }

      // User cancelled - return to main menu
      break;
    }

    // Handle progress interaction
    if (response && typeof response === 'object' && 'update' in response) {
      const result = await subRunner.handleResponse(response);
      if (result.done) break;
      continue;
    }

    // Handle response
    const result = await subRunner.handleResponse(response);

    // Check for action markers - the step handler returns 'action:xyz' as "next step"
    // which FlowRunner sets as currentStepId
    const currentStepId = subRunner.getCurrentStepId();
    if (isActionMarker(currentStepId)) {
      const actionName = getActionName(currentStepId);
      const ctx = subRunner.getContext();
      const actionResult = await executeAction(actionName, ctx, 'cli');

      if (actionResult.error) {
        console.error(chalk.red(`\nError: ${actionResult.error}\n`));
      }

      // Navigate to the step returned by the action
      if (actionResult.nextStep) {
        subRunner.navigateTo(actionResult.nextStep);
      } else {
        // No next step from action - go back to menu
        subRunner.navigateTo('menu');
      }

      // Refresh context after action
      const refreshed = await buildFlowContext(projectPath, createCliUser(), 'cli');
      subRunner.updateContext({ ...refreshed, ...ctx });
      continue;
    }

    if (result.done) {
      break;
    }

    if (result.error) {
      console.error(chalk.red(`\nError: ${result.error}\n`));
    }
  }
}

// ============================================================================
// Main Menu
// ============================================================================

export async function mainMenuCommand(options: { path: string }): Promise<void> {
  const projectPath = path.resolve(options.path);

  // Use new unified flow system
  flowPrintBanner();

  // Build flow context
  const baseContext = await buildFlowContext(projectPath, createCliUser(), 'cli');
  const flowContext: MainMenuContext = { ...baseContext };

  // Print context info
  const contextInfo: Parameters<typeof flowPrintContextInfo>[0] = {
    hasProject: flowContext.hasProject,
    requirements: flowContext.requirements,
    daemon: flowContext.daemon,
  };
  if (flowContext.projectName !== undefined) {
    contextInfo.projectName = flowContext.projectName;
  }
  if (flowContext.plan) {
    contextInfo.plan = {
      status: flowContext.plan.status,
      highLevelGoal: flowContext.plan.highLevelGoal,
    };
  }
  flowPrintContextInfo(contextInfo);

  // Also get old context for existing handlers
  const oldContext = await getMenuContext(projectPath);

  // Create flow runner
  const runner = new FlowRunner(mainMenuFlow, cliRenderer, flowContext);

  // Run flow loop
  while (true) {
    const response = await runner.runCurrentStep();

    // Handle cancellation
    if (response === null) {
      const step = runner.getCurrentStep();
      const interaction = step?.interaction(runner.getContext());

      if (interaction?.type === 'display') {
        const result = await runner.handleResponse(null);
        if (result.done) break;
        continue;
      }

      // User cancelled
      console.log(chalk.dim('\nGoodbye!\n'));
      break;
    }

    // Handle progress interaction
    if (response && typeof response === 'object' && 'update' in response) {
      const result = await runner.handleResponse(response);
      if (result.done) break;
      continue;
    }

    // Handle response
    const result = await runner.handleResponse(response);

    // Check for sub-flow navigation - step handler returns 'flow:xyz'
    // which FlowRunner sets as currentStepId
    const currentStepId = runner.getCurrentStepId();
    if (currentStepId.startsWith('flow:')) {
      const subFlowId = getSubFlowId(currentStepId);
      const ctx = runner.getContext() as MainMenuContext;
      await refreshContext(oldContext);

      // Route to unified flows or existing handlers
      switch (subFlowId) {
        case 'init':
          await runInitFlow(oldContext);
          break;
        case 'plan':
          // Plan still uses old handler (complex wizard with many states)
          await showPlanMenu(oldContext);
          break;
        case 'run':
          // Use unified run flow
          await runUnifiedSubFlow(runFlow, ctx as RunFlowContext, projectPath);
          break;
        case 'requirements':
          // Use unified requirements flow
          await runUnifiedSubFlow(requirementsFlow, ctx as RequirementsFlowContext, projectPath);
          break;
        case 'daemon':
          // Use unified daemon flow
          await runUnifiedSubFlow(daemonFlow, ctx as DaemonFlowContext, projectPath);
          break;
        case 'config':
          await showConfigMenu(oldContext);
          break;
        case 'secrets':
          await secretsInteractive({ path: oldContext.projectPath });
          break;
        case 'projects':
          await projectsInteractive();
          break;
        case 'telegram':
          await telegramInteractive();
          break;
      }

      // Navigate back to menu and refresh context
      runner.navigateTo('menu');
      const refreshed = await buildFlowContext(projectPath, createCliUser(), 'cli');
      runner.updateContext({ ...refreshed } as MainMenuContext);
      continue;
    }

    if (result.done) {
      console.log(chalk.dim('\nGoodbye!\n'));
      break;
    }

    if (result.error) {
      console.error(chalk.red(`\nError: ${result.error}\n`));
    }
  }
}
