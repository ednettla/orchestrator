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

// Daemon
export {
  daemonFlow,
  isDaemonAction,
  getDaemonAction,
} from './daemon.js';
export type { DaemonFlowContext } from './daemon.js';

/**
 * Flow registry - maps flow IDs to flow definitions
 */
import { mainMenuFlow } from './main-menu.js';
import { planMenuFlow, planWizardFlow } from './plan.js';
import { runFlow } from './run.js';
import { requirementsFlow } from './requirements.js';
import { configFlow, mcpFlow } from './config.js';
import { daemonFlow } from './daemon.js';
import type { Flow, FlowContext } from '../types.js';

export const flowRegistry: Record<string, Flow<FlowContext>> = {
  'main-menu': mainMenuFlow,
  'plan': planMenuFlow as Flow<FlowContext>,
  'plan-menu': planMenuFlow as Flow<FlowContext>,
  'plan-wizard': planWizardFlow as Flow<FlowContext>,
  'run': runFlow as Flow<FlowContext>,
  'requirements': requirementsFlow as Flow<FlowContext>,
  'config': configFlow as Flow<FlowContext>,
  'mcp': mcpFlow as Flow<FlowContext>,
  'daemon': daemonFlow as Flow<FlowContext>,
};

/**
 * Get a flow by ID
 */
export function getFlow(flowId: string): Flow<FlowContext> | null {
  return flowRegistry[flowId] ?? null;
}
