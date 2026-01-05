/**
 * Unified Interaction System
 *
 * Single source of truth for CLI and Telegram menus.
 * Define interactions once, render to both platforms.
 *
 * @module interactions
 */

// Types
export type {
  SelectOption,
  SelectInteraction,
  InputInteraction,
  ConfirmInteraction,
  ProgressInteraction,
  DisplayInteraction,
  Interaction,
  RequirementsCounts,
  DaemonStatus,
  UserContext,
  FlowContext,
  FlowStep,
  Flow,
  ProgressHandle,
  Renderer,
  FlowSession,
} from './types.js';

// Context
export {
  buildFlowContext,
  refreshFlowContext,
  createCliUser,
  createTelegramUser,
} from './context.js';

// Runner
export { FlowRunner, runFlowCli } from './runner.js';
export type { StepResult } from './runner.js';

// CLI Renderer
export {
  cliRenderer,
  waitForEnter,
  printHeader,
  printBanner,
  printContextInfo,
} from './renderers/cli.js';

// Telegram Renderer
export {
  createTelegramRenderer,
  parseFlowCallback,
  isSpecialCallback,
  mapSpecialCallback,
  FlowCallbackIds,
} from './renderers/telegram.js';
export type { TelegramRendererOptions } from './renderers/telegram.js';

// Telegram Session Management
export {
  telegramFlowSessions,
  startMainMenuFlow,
  handleFlowCallback,
  handleFlowTextInput,
} from './telegram-session.js';

// Flows
export { mainMenuFlow, getSubFlowId } from './flows/main-menu.js';
export type { MainMenuContext } from './flows/main-menu.js';
