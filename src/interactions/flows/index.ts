/**
 * Flow Definitions Index
 *
 * Exports all flow definitions for the unified interaction system.
 *
 * @module interactions/flows
 */

// Main Menu
export { mainMenuFlow, getSubFlowId } from './main-menu.js';
export type { MainMenuContext } from './main-menu.js';

// Plan
export {
  planMenuFlow,
  planWizardFlow,
  isPlanAction,
  getPlanAction,
} from './plan.js';
export type { PlanFlowContext } from './plan.js';

// Plan Edit
export { planEditReqsFlow, planEditQuestionsFlow } from './plan-edit.js';
export type { PlanEditContext } from './plan-edit.js';

// Run
export { runFlow, isRunAction, getRunAction } from './run.js';
export type { RunFlowContext, RunMode } from './run.js';

// Requirements
export {
  requirementsFlow,
  isRequirementsAction,
  getRequirementsAction,
} from './requirements.js';
export type { RequirementsFlowContext } from './requirements.js';

// Config
export {
  configFlow,
  mcpFlow,
  isConfigAction,
  getConfigAction,
} from './config.js';
export type { ConfigFlowContext } from './config.js';

// Init
export {
  initFlow,
  isInitAction,
  getInitAction,
} from './init.js';
export type { InitFlowContext } from './init.js';

// Daemon
export {
  daemonFlow,
  isDaemonAction,
  getDaemonAction,
} from './daemon.js';
export type { DaemonFlowContext } from './daemon.js';

// Worktrees
export {
  worktreesFlow,
  isWorktreesAction,
  getWorktreesAction,
} from './worktrees.js';
export type { WorktreesFlowContext, WorktreeHealth } from './worktrees.js';

// Secrets
export {
  secretsFlow,
  isSecretsAction,
  getSecretsAction,
} from './secrets.js';
export type { SecretsFlowContext } from './secrets.js';

// Projects
export {
  projectsFlow,
  isProjectsAction,
  getProjectsAction,
} from './projects.js';
export type { ProjectsFlowContext } from './projects.js';

// Telegram Settings
export {
  telegramSettingsFlow,
  isTelegramSettingsAction,
  getTelegramSettingsAction,
} from './telegram-settings.js';
export type { TelegramSettingsFlowContext } from './telegram-settings.js';

/**
 * Flow registry - maps flow IDs to flow definitions
 */
import { mainMenuFlow } from './main-menu.js';
import { planMenuFlow, planWizardFlow } from './plan.js';
import { planEditReqsFlow, planEditQuestionsFlow } from './plan-edit.js';
import { runFlow } from './run.js';
import { worktreesFlow } from './worktrees.js';
import { secretsFlow } from './secrets.js';
import { projectsFlow } from './projects.js';
import { telegramSettingsFlow } from './telegram-settings.js';
import { requirementsFlow } from './requirements.js';
import { configFlow, mcpFlow } from './config.js';
import { initFlow } from './init.js';
import { daemonFlow } from './daemon.js';
import type { Flow, FlowContext } from '../types.js';

export const flowRegistry: Record<string, Flow<FlowContext>> = {
  'main-menu': mainMenuFlow,
  'plan': planMenuFlow as Flow<FlowContext>,
  'plan-menu': planMenuFlow as Flow<FlowContext>,
  'plan-wizard': planWizardFlow as Flow<FlowContext>,
  'plan-edit-reqs': planEditReqsFlow as Flow<FlowContext>,
  'plan-edit-questions': planEditQuestionsFlow as Flow<FlowContext>,
  'run': runFlow as Flow<FlowContext>,
  'requirements': requirementsFlow as Flow<FlowContext>,
  'config': configFlow as Flow<FlowContext>,
  'mcp': mcpFlow as Flow<FlowContext>,
  'init': initFlow as Flow<FlowContext>,
  'daemon': daemonFlow as Flow<FlowContext>,
  'worktrees': worktreesFlow as Flow<FlowContext>,
  'secrets': secretsFlow as Flow<FlowContext>,
  'projects': projectsFlow as Flow<FlowContext>,
  'telegram': telegramSettingsFlow as Flow<FlowContext>,
};

/**
 * Get a flow by ID
 */
export function getFlow(flowId: string): Flow<FlowContext> | null {
  return flowRegistry[flowId] ?? null;
}
