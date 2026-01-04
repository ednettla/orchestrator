import path from 'node:path';
import { select, input, confirm, editor } from '@inquirer/prompts';
import chalk from 'chalk';
import { sessionManager } from '../../core/session-manager.js';
import { PlanController } from '../../planning/plan-controller.js';
import {
  presentFullPlan,
  presentRequirements,
  presentRequirementDetails,
  presentArchitecturalDecisions,
  presentQuestions,
} from '../../planning/plan-presenter.js';
import { getDaemonStatus, stopDaemon, tailLogs } from '../daemon.js';
import { checkForUpdates, updateToLatest, getCurrentVersion } from '../updater.js';
import { initCommand } from './init.js';
import { planCommand } from './plan.js';
import { runCommand } from './run.js';
import { statusCommand } from './status.js';
import { addCommand } from './add.js';
import { listCommand } from './list.js';
import { configInteractive } from './config.js';
import type { Plan, PlannedRequirement } from '../../core/types.js';

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
  // Plan info
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

    // Get active plan
    context.activePlan = store.getActivePlan(session.id);

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

    if (context.activePlan) {
      const statusColor = getPlanStatusColor(context.activePlan.status);
      console.log(chalk.dim('  Plan:'), statusColor(context.activePlan.status), chalk.dim('-'), truncateGoal(context.activePlan.highLevelGoal, 40));
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

function truncateGoal(goal: string, maxLen: number): string {
  if (goal.length <= maxLen) return goal;
  return goal.substring(0, maxLen - 3) + '...';
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

// ============================================================================
// Plan Menu
// ============================================================================

async function showPlanMenu(context: MenuContext): Promise<'back' | 'exit'> {
  const plan = context.activePlan;

  if (!plan) {
    // No active plan - offer to create one
    const goal = await input({
      message: 'What would you like to build?',
      validate: (value) => value.length > 0 || 'Please describe your goal',
    });

    await planCommand(goal, {
      path: context.projectPath,
      dashboard: false,
      concurrency: '3',
    });
    return 'exit';
  }

  // Show plan status and build menu choices
  console.log();
  console.log(chalk.cyan.bold('  Current Plan'));
  console.log(chalk.dim('  ' + '─'.repeat(50)));
  console.log(chalk.dim('  Goal:'), plan.highLevelGoal);
  console.log(chalk.dim('  Status:'), getPlanStatusColor(plan.status)(plan.status));
  console.log(chalk.dim('  Requirements:'), plan.requirements.length);
  console.log();

  const choices: Array<{ name: string; value: string; disabled?: boolean }> = [];

  // View options
  choices.push({ name: 'View full plan', value: 'view' });
  choices.push({ name: 'View requirements', value: 'view_reqs' });
  choices.push({ name: 'View questions & answers', value: 'view_questions' });

  // Edit options (only for plans not yet executing)
  const canEdit = ['drafting', 'questioning', 'pending_approval', 'approved'].includes(plan.status);
  choices.push({ name: 'Edit requirements', value: 'edit_reqs', disabled: !canEdit });
  choices.push({ name: 'Edit questions', value: 'edit_questions', disabled: !canEdit || plan.questions.length === 0 });

  // Action options based on status
  if (plan.status === 'pending_approval') {
    choices.push({ name: chalk.green('Approve and execute'), value: 'approve' });
  } else if (plan.status === 'approved') {
    choices.push({ name: chalk.green('Execute plan'), value: 'execute' });
  } else if (plan.status === 'drafting' || plan.status === 'questioning') {
    choices.push({ name: 'Continue plan creation', value: 'continue' });
  }

  choices.push({ name: chalk.red('Reject plan'), value: 'reject', disabled: plan.status === 'executing' || plan.status === 'completed' });
  choices.push({ name: chalk.dim('Back to main menu'), value: 'back' });

  const action = await select({
    message: 'Plan actions:',
    choices,
  });

  console.log();

  switch (action) {
    case 'view':
      await viewFullPlan(context);
      break;

    case 'view_reqs':
      await viewRequirements(context);
      break;

    case 'view_questions':
      await viewQuestions(context);
      break;

    case 'edit_reqs':
      await editRequirements(context);
      break;

    case 'edit_questions':
      await editQuestions(context);
      break;

    case 'approve':
      await approvePlan(context);
      return 'exit';

    case 'execute':
      await executePlan(context);
      return 'exit';

    case 'continue':
      await planCommand(undefined, {
        path: context.projectPath,
        resume: true,
        dashboard: false,
        concurrency: '3',
      });
      return 'exit';

    case 'reject':
      await rejectPlan(context);
      return 'back';

    case 'back':
      return 'back';
  }

  // After action, show plan menu again
  return await showPlanMenu(context);
}

async function viewFullPlan(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  await sessionManager.initialize(context.projectPath);
  await sessionManager.resumeSession(context.projectPath);

  presentFullPlan(context.activePlan);

  sessionManager.close();

  await input({ message: chalk.dim('Press Enter to continue...') });
}

async function viewRequirements(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  presentRequirements(context.activePlan.requirements, context.activePlan.implementationOrder);
  presentRequirementDetails(context.activePlan.requirements);

  await input({ message: chalk.dim('Press Enter to continue...') });
}

async function viewQuestions(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  presentQuestions(context.activePlan.questions);

  await input({ message: chalk.dim('Press Enter to continue...') });
}

async function editRequirements(context: MenuContext): Promise<void> {
  if (!context.activePlan) return;

  const plan = context.activePlan;

  while (true) {
    console.log();
    console.log(chalk.cyan.bold('  Edit Requirements'));
    console.log(chalk.dim('  ' + '─'.repeat(50)));

    // Show requirements list
    plan.requirements.forEach((req, i) => {
      console.log(`  ${chalk.bold((i + 1).toString().padStart(2))}. ${req.title}`);
    });
    console.log();

    const choices = [
      { name: 'Edit a requirement', value: 'edit' },
      { name: 'Reorder requirements', value: 'reorder' },
      { name: 'Remove a requirement', value: 'remove' },
      { name: 'Add a new requirement', value: 'add' },
      { name: chalk.dim('Done editing'), value: 'done' },
    ];

    const action = await select({
      message: 'What would you like to do?',
      choices,
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

    // Refresh context
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
      req.title = await input({
        message: 'New title:',
        default: req.title,
      });
      break;

    case 'description':
      req.description = await editor({
        message: 'Edit description (opens editor):',
        default: req.description,
      });
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

  const description = await input({
    message: 'Description:',
  });

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

    // Show questions with answers
    plan.questions.forEach((q, i) => {
      const answered = q.answer ? chalk.green('✓') : chalk.dim('○');
      console.log(`  ${answered} ${chalk.bold((i + 1).toString())}. ${q.question}`);
      if (q.answer) {
        console.log(chalk.dim(`     → ${q.answer}`));
      }
    });
    console.log();

    const choices = plan.questions.map((q, i) => ({
      name: `${i + 1}. ${truncateGoal(q.question, 50)}`,
      value: i,
    })).concat([{ name: chalk.dim('Done editing'), value: -1 }]);

    const qIndex = await select({
      message: 'Select question to edit:',
      choices,
    });

    if (qIndex === -1) break;

    const question = plan.questions[qIndex]!;

    console.log();
    console.log(chalk.bold('Question:'), question.question);
    if (question.context) {
      console.log(chalk.dim('Context:'), question.context);
    }
    if (question.suggestedOptions && question.suggestedOptions.length > 0) {
      console.log(chalk.dim('Suggested options:'), question.suggestedOptions.join(', '));
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

  console.log(chalk.green('✓ Plan approved!'));

  const executeNow = await confirm({
    message: 'Execute the plan now?',
    default: true,
  });

  sessionManager.close();

  if (executeNow) {
    const background = await confirm({
      message: 'Run in background?',
      default: true,
    });

    await planCommand(undefined, {
      path: context.projectPath,
      resume: true,
      dashboard: !background,
      concurrency: '3',
      background,
    });
  }
}

async function executePlan(context: MenuContext): Promise<void> {
  const background = await confirm({
    message: 'Run in background?',
    default: true,
  });

  await planCommand(undefined, {
    path: context.projectPath,
    resume: true,
    dashboard: !background,
    concurrency: '3',
    background,
  });
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
        const result = await showPlanMenu(context);
        if (result === 'exit') return;
        break;
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
