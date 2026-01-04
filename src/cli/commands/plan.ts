import path from 'node:path';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { sessionManager } from '../../core/session-manager.js';
import { PlanController } from '../../planning/plan-controller.js';
import {
  presentPlanHeader,
  presentQuestions,
  presentFullPlan,
  presentApprovalPrompt,
} from '../../planning/plan-presenter.js';
import { ConcurrentRunner } from '../../pipeline/concurrent-runner.js';
import { StreamingDisplay } from '../streaming-display.js';
import { AgentMonitor } from '../../agents/monitor.js';
import { renderDashboard } from '../../ui/dashboard.js';
import { createDesignController } from '../../design/design-controller.js';
import type { StreamingOptions } from '../../agents/invoker.js';

interface PlanOptions {
  path: string;
  resume?: boolean;
  dashboard?: boolean;
  concurrency?: string;
}

export async function planCommand(goal: string | undefined, options: PlanOptions): Promise<void> {
  const projectPath = path.resolve(options.path);

  console.log(chalk.bold('\n🎯 Project Planning\n'));

  try {
    await sessionManager.initialize(projectPath);
    const session = await sessionManager.resumeSession(projectPath);

    const controller = new PlanController(sessionManager);

    // Check for existing active plan
    let plan = controller.getActivePlan();

    if (plan && options.resume) {
      console.log(chalk.yellow('Resuming existing plan...'));
    } else if (plan && !options.resume) {
      console.log(chalk.yellow('An active plan already exists.'));
      console.log(chalk.dim(`Goal: ${plan.highLevelGoal}`));
      console.log(chalk.dim(`Status: ${plan.status}`));
      console.log();
      console.log('Use --resume to continue with this plan, or complete/reject it first.');
      sessionManager.close();
      return;
    } else if (!goal) {
      // No plan and no goal provided
      console.log(chalk.red('No active plan found. Please provide a goal.'));
      console.log(chalk.dim('Usage: orchestrate plan "Your project goal"'));
      sessionManager.close();
      return;
    } else {
      // Create new plan
      console.log(chalk.dim('Creating plan for:'), goal);
      console.log();
      plan = await controller.createPlan(goal);
    }

    // Handle based on plan status
    switch (plan.status) {
      case 'drafting':
        // Generate questions
        await runQuestionPhase(controller, plan.id, options);
        break;

      case 'questioning':
        // Continue Q&A
        await runQuestionPhase(controller, plan.id, options);
        break;

      case 'pending_approval':
        // Show plan and get approval
        await runApprovalPhase(controller, plan.id, options);
        break;

      case 'approved':
        // Execute the plan
        await executePlan(controller, plan.id, options);
        break;

      case 'executing':
        console.log(chalk.yellow('Plan is currently being executed.'));
        console.log('Use orchestrate status to check progress.');
        break;

      case 'completed':
        console.log(chalk.green('Plan has been completed.'));
        break;

      case 'rejected':
        console.log(chalk.red('Plan was rejected. Create a new plan.'));
        break;
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

async function runQuestionPhase(controller: PlanController, planId: string, options: PlanOptions): Promise<void> {
  let plan = controller.getPlan(planId);
  if (!plan) throw new Error('Plan not found');

  // Generate questions if needed
  if (plan.questions.length === 0) {
    console.log(chalk.cyan('Generating clarifying questions...\n'));

    // Use streaming display instead of spinner
    const display = new StreamingDisplay();
    const questions = await controller.generateQuestions(planId, {
      stream: true,
      onMessage: (msg) => display.display(msg),
    });

    console.log(chalk.green(`\nGenerated ${questions.length} questions\n`));
    plan = controller.getPlan(planId)!;
  }

  // Display questions
  presentQuestions(plan.questions);

  // Interactive Q&A
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const unansweredQuestions = plan.questions.filter(q => !q.answer);

  if (unansweredQuestions.length === 0) {
    console.log(chalk.green('All questions answered!\n'));
    rl.close();
    await generateAndReviewPlan(controller, planId, options);
    return;
  }

  console.log(chalk.bold('\nPlease answer the following questions:\n'));

  for (const question of unansweredQuestions) {
    const answer = await askQuestion(rl, question.question, question.suggestedOptions);
    controller.answerQuestion(planId, question.id, answer);
    console.log();
  }

  rl.close();

  // Generate the plan
  await generateAndReviewPlan(controller, planId, options);
}

async function generateAndReviewPlan(controller: PlanController, planId: string, options: PlanOptions): Promise<void> {
  console.log(chalk.cyan('\nGenerating implementation plan...\n'));

  // Use streaming display instead of spinner
  const display = new StreamingDisplay();
  await controller.generatePlan(planId, {
    stream: true,
    onMessage: (msg) => display.display(msg),
  });

  console.log(chalk.green('\nPlan generated!\n'));

  await runApprovalPhase(controller, planId, options);
}

async function runApprovalPhase(controller: PlanController, planId: string, options: PlanOptions): Promise<void> {
  const plan = controller.getPlan(planId);
  if (!plan) throw new Error('Plan not found');

  // Display the full plan
  presentFullPlan(plan);
  presentApprovalPrompt();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const choice = await new Promise<string>((resolve) => {
    rl.question(chalk.bold('  Your choice: '), (answer) => {
      resolve(answer.toLowerCase().trim());
    });
  });

  rl.close();

  switch (choice) {
    case 'a':
    case 'approve':
      console.log(chalk.green('\n✅ Plan approved!\n'));
      controller.approvePlan(planId);
      await executePlan(controller, planId, options);
      break;

    case 'e':
    case 'edit':
      console.log(chalk.yellow('\nPlan editing is not yet implemented.'));
      console.log('You can manually modify the plan in the database or reject and start over.\n');
      break;

    case 'r':
    case 'reject':
      console.log(chalk.red('\n❌ Plan rejected.\n'));
      controller.rejectPlan(planId);
      break;

    case 's':
    case 'save':
      console.log(chalk.blue('\n💾 Plan saved.\n'));
      console.log('Run orchestrate plan --resume to continue later.');
      break;

    default:
      console.log(chalk.yellow('\nUnknown choice. Plan saved for later.\n'));
  }
}

async function executePlan(controller: PlanController, planId: string, options: PlanOptions): Promise<void> {
  const plan = controller.getPlan(planId);
  if (!plan) throw new Error('Plan not found');

  const useDashboard = options.dashboard ?? false;
  const maxConcurrency = parseInt(options.concurrency ?? '3', 10);

  const session = sessionManager.getCurrentSession();
  if (!session) throw new Error('No active session');

  // Generate design system if needed (before any requirements execute)
  const designController = createDesignController(sessionManager);
  if (designController.hasFrontend(session.techStack)) {
    const hasDesignSystem = await designController.hasDesignSystem(session.projectPath);

    if (!hasDesignSystem) {
      console.log(chalk.cyan('🎨 Generating design system...\n'));

      const result = await designController.generateDesignSystem(session.projectPath, session.techStack);

      if (result.success) {
        console.log(chalk.green('✓ Design system created'));
        console.log(chalk.dim(`  Components: ${result.components.join(', ')}`));
        console.log(chalk.dim(`  Files: ${result.filesCreated.length} created\n`));

        // Store design system info in session
        const designSystemInfo = designController.createDefaultDesignSystemInfo(session.techStack);
        designSystemInfo.availableComponents = result.components;
        sessionManager.updateDesignSystem(designSystemInfo);
      } else {
        console.log(chalk.yellow('⚠ Design system generation failed, continuing without...'));
        console.log(chalk.dim(`  Error: ${result.error}\n`));
      }
    } else {
      // Get existing design system info
      const existingInfo = await designController.getDesignSystemInfo(session.projectPath, session.techStack);
      if (existingInfo) {
        console.log(chalk.dim(`Using existing design system (${existingInfo.availableComponents.length} components)\n`));
        sessionManager.updateDesignSystem(existingInfo);
      }
    }
  }

  console.log(chalk.cyan('Converting plan to requirements...\n'));

  const requirementIds = await controller.convertToRequirements(planId);

  console.log(chalk.green(`Created ${requirementIds.length} requirements\n`));

  // Show what was created
  const store = sessionManager.getStore();
  for (const reqId of requirementIds) {
    const req = store.getRequirement(reqId);
    if (req) {
      console.log(chalk.dim(`  ${reqId.substring(0, 8)}`), req.rawInput.substring(0, 50) + '...');
    }
  }

  console.log();
  console.log(chalk.bold(`Starting concurrent execution (max ${maxConcurrency} jobs)...\n`));

  // Get requirements with their dependencies for dependency-aware execution
  const requirementsWithDeps = plan.requirements.map(pr => ({
    id: requirementIds[plan.implementationOrder.indexOf(pr.id)] || '',
    plannedId: pr.id,
    dependencies: pr.dependencies,
  })).filter(r => r.id);

  // Map planned dependencies to actual requirement IDs
  const plannedToActual = new Map<string, string>();
  for (let i = 0; i < plan.implementationOrder.length; i++) {
    const plannedId = plan.implementationOrder[i];
    const actualId = requirementIds[i];
    if (plannedId && actualId) {
      plannedToActual.set(plannedId, actualId);
    }
  }

  const mappedRequirements = requirementsWithDeps.map(r => ({
    id: r.id,
    dependencies: r.dependencies.map(d => plannedToActual.get(d) || '').filter(Boolean),
  }));

  // Create monitor and streaming display
  const monitor = new AgentMonitor();
  const streamingDisplay = new StreamingDisplay();

  // Set up streaming options
  const streamingOptions: StreamingOptions = {
    stream: true,
    onMessage: (msg) => {
      if (!useDashboard) {
        streamingDisplay.display(msg);
      }
    },
  };

  // Show dashboard if requested
  if (useDashboard) {
    renderDashboard(store, session, monitor);
  }

  // Create concurrent runner and execute
  const runner = new ConcurrentRunner(sessionManager, {
    maxConcurrency,
    useWorktrees: true,
    monitor,
    streamingOptions,
  });

  try {
    await runner.runWithDependencies(mappedRequirements);

    // Update plan status
    store.updatePlan(planId, { status: 'completed' });

    if (!useDashboard) {
      console.log(chalk.green('\n✅ Plan execution completed!\n'));
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Plan execution failed:'), error instanceof Error ? error.message : error);
    throw error;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function askQuestion(rl: ReturnType<typeof createInterface>, question: string, options?: string[]): Promise<string> {
  return new Promise((resolve) => {
    let prompt = chalk.bold(`  ${question}`);
    if (options && options.length > 0) {
      prompt += chalk.dim(` (${options.join('/')})`);
    }
    prompt += '\n  > ';

    rl.question(prompt, (answer) => {
      resolve(answer.trim() || (options?.[0] ?? ''));
    });
  });
}

