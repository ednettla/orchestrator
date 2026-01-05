import path from 'node:path';
import chalk from 'chalk';
import { sessionManager } from '../../core/session-manager.js';
import { getDaemonStatus } from '../daemon.js';
import type { Plan } from '../../core/types.js';

// Unified Interactions System
import {
  FlowRunner,
  cliRenderer,
  createTuiRenderer,
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
  planMenuFlow,
  configFlow,
  mcpFlow,
  initFlow,
  worktreesFlow,
  secretsFlow,
  projectsFlow,
  telegramSettingsFlow,
  // Action handling
  executeAction,
  isActionMarker,
  getActionName,
  // Flow registry
  getFlow,
} from '../../interactions/index.js';
import type { MainMenuContext, DaemonFlowContext, RunFlowContext, RequirementsFlowContext, PlanFlowContext, ConfigFlowContext, InitFlowContext, WorktreesFlowContext, SecretsFlowContext, ProjectsFlowContext, TelegramSettingsFlowContext, Renderer } from '../../interactions/index.js';

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

  try {
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
      let navigated = false;
      if (actionResult.nextStep) {
        navigated = subRunner.navigateTo(actionResult.nextStep);
      }
      // Fall back to menu if navigation failed or no next step
      if (!navigated) {
        subRunner.navigateTo('menu');
      }

      // Refresh context after action
      const refreshed = await buildFlowContext(projectPath, createCliUser(), 'cli');
      subRunner.updateContext({ ...refreshed, ...ctx });
      continue;
    }

    // Check for flow markers - sub-flow wants to navigate to another sub-flow
    if (currentStepId.startsWith('flow:')) {
      const nestedFlowId = getSubFlowId(currentStepId);
      const ctx = subRunner.getContext();

      // Handle nested sub-flow
      switch (nestedFlowId) {
        case 'run':
          await runUnifiedSubFlow(runFlow, ctx as RunFlowContext, projectPath);
          break;
        case 'mcp':
          await runUnifiedSubFlow(mcpFlow, ctx as ConfigFlowContext, projectPath);
          break;
        case 'plan':
          await runUnifiedSubFlow(planMenuFlow, ctx as PlanFlowContext, projectPath);
          break;
        case 'worktrees':
          await runUnifiedSubFlow(worktreesFlow, ctx as WorktreesFlowContext, projectPath);
          break;
      }

      // After nested flow, refresh and go back to this flow's menu
      subRunner.navigateTo('menu');
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
  } catch (error) {
    // Handle Ctrl+C gracefully - just return to main menu
    if (error instanceof Error && error.name === 'ExitPromptError') {
      return;
    }
    // Re-throw other errors
    throw error;
  }
}

// ============================================================================
// TUI Menu (Full-screen mode)
// ============================================================================

async function runTuiMenu(
  renderer: Renderer,
  flowContext: MainMenuContext,
  projectPath: string,
  cleanup: () => void
): Promise<void> {
  const runner = new FlowRunner(mainMenuFlow, renderer, flowContext);

  try {
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

      // Check for sub-flow navigation
      const currentStepId = runner.getCurrentStepId();
      if (currentStepId.startsWith('flow:')) {
        const subFlowId = getSubFlowId(currentStepId);
        const ctx = runner.getContext() as MainMenuContext;

        // Route to unified flows
        switch (subFlowId) {
          case 'init':
            await runTuiSubFlow(initFlow, ctx as InitFlowContext, projectPath, renderer);
            break;
          case 'plan':
            await runTuiSubFlow(planMenuFlow, ctx as PlanFlowContext, projectPath, renderer);
            break;
          case 'run':
            await runTuiSubFlow(runFlow, ctx as RunFlowContext, projectPath, renderer);
            break;
          case 'requirements':
            await runTuiSubFlow(requirementsFlow, ctx as RequirementsFlowContext, projectPath, renderer);
            break;
          case 'daemon':
            await runTuiSubFlow(daemonFlow, ctx as DaemonFlowContext, projectPath, renderer);
            break;
          case 'config':
            await runTuiSubFlow(configFlow, ctx as ConfigFlowContext, projectPath, renderer);
            break;
          case 'secrets':
            await runTuiSubFlow(secretsFlow, ctx as SecretsFlowContext, projectPath, renderer);
            break;
          case 'projects':
            await runTuiSubFlow(projectsFlow, ctx as ProjectsFlowContext, projectPath, renderer);
            break;
          case 'telegram':
            await runTuiSubFlow(telegramSettingsFlow, ctx as TelegramSettingsFlowContext, projectPath, renderer);
            break;
        }

        // Navigate back to menu and refresh context
        runner.navigateTo('menu');
        const refreshed = await buildFlowContext(projectPath, createCliUser(), 'cli');
        runner.updateContext({ ...refreshed } as MainMenuContext);
        continue;
      }

      if (result.done) {
        break;
      }
    }
  } finally {
    cleanup();
  }
}

/**
 * Run a sub-flow with the TUI renderer
 */
async function runTuiSubFlow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flow: any,
  baseContext: MainMenuContext,
  projectPath: string,
  renderer: Renderer
): Promise<void> {
  const subRunner = new FlowRunner(flow, renderer, baseContext);

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

    // Check for action markers
    const currentStepId = subRunner.getCurrentStepId();
    if (isActionMarker(currentStepId)) {
      const actionName = getActionName(currentStepId);
      const ctx = subRunner.getContext();

      const actionResult = await executeAction(actionName, ctx, 'cli');

      // Navigate to the step returned by the action
      let navigated = false;
      if (actionResult.nextStep) {
        navigated = subRunner.navigateTo(actionResult.nextStep);
      }
      if (!navigated) {
        subRunner.navigateTo('menu');
      }

      // Refresh context after action
      const refreshed = await buildFlowContext(projectPath, createCliUser(), 'cli');
      subRunner.updateContext({ ...refreshed, ...ctx });
      continue;
    }

    // Check for nested flow markers
    if (currentStepId.startsWith('flow:')) {
      const nestedFlowId = getSubFlowId(currentStepId);
      const ctx = subRunner.getContext();

      switch (nestedFlowId) {
        case 'run':
          await runTuiSubFlow(runFlow, ctx as RunFlowContext, projectPath, renderer);
          break;
        case 'mcp':
          await runTuiSubFlow(mcpFlow, ctx as ConfigFlowContext, projectPath, renderer);
          break;
        case 'plan':
          await runTuiSubFlow(planMenuFlow, ctx as PlanFlowContext, projectPath, renderer);
          break;
        case 'worktrees':
          await runTuiSubFlow(worktreesFlow, ctx as WorktreesFlowContext, projectPath, renderer);
          break;
      }

      // After nested flow, refresh and go back to this flow's menu
      subRunner.navigateTo('menu');
      const refreshed = await buildFlowContext(projectPath, createCliUser(), 'cli');
      subRunner.updateContext({ ...refreshed, ...ctx });
      continue;
    }

    if (result.done) {
      break;
    }
  }
}

// ============================================================================
// Main Menu
// ============================================================================

export async function mainMenuCommand(options: { path: string; tui?: boolean }): Promise<void> {
  const projectPath = path.resolve(options.path);

  // Build flow context
  const baseContext = await buildFlowContext(projectPath, createCliUser(), 'cli');
  const flowContext: MainMenuContext = { ...baseContext };

  // Use TUI renderer if requested
  if (options.tui) {
    const { renderer, cleanup } = await createTuiRenderer(flowContext.projectName);
    await runTuiMenu(renderer, flowContext, projectPath, cleanup);
    return;
  }

  // Use classic CLI flow system
  flowPrintBanner();

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

  // Run flow loop with Ctrl+C handling
  try {
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
          // Use unified init flow
          await runUnifiedSubFlow(initFlow, ctx as InitFlowContext, projectPath);
          break;
        case 'plan':
          // Use unified plan flow
          await runUnifiedSubFlow(planMenuFlow, ctx as PlanFlowContext, projectPath);
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
          // Use unified config flow
          await runUnifiedSubFlow(configFlow, ctx as ConfigFlowContext, projectPath);
          break;
        case 'secrets':
          // Use unified secrets flow
          await runUnifiedSubFlow(secretsFlow, ctx as SecretsFlowContext, projectPath);
          break;
        case 'projects':
          // Use unified projects flow
          await runUnifiedSubFlow(projectsFlow, ctx as ProjectsFlowContext, projectPath);
          break;
        case 'telegram':
          // Use unified telegram settings flow
          await runUnifiedSubFlow(telegramSettingsFlow, ctx as TelegramSettingsFlowContext, projectPath);
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
  } catch (error) {
    // Handle Ctrl+C gracefully
    if (error instanceof Error && error.name === 'ExitPromptError') {
      console.log(chalk.dim('\nGoodbye!\n'));
      return;
    }
    // Re-throw other errors
    throw error;
  }
}
