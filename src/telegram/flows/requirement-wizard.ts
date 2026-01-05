/**
 * Requirement Wizard Flow
 *
 * Interactive wizard for adding requirements in Telegram.
 * Simple 2-step flow: input requirement text → confirm added.
 *
 * @module telegram/flows/requirement-wizard
 */

import type { Context } from 'grammy';
import { getGlobalStore } from '../../core/global-store.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { safeEditMessage } from '../utils/safe-edit.js';
import { sendTyping } from '../utils/typing.js';
import {
  type RequirementWizardState,
  createInitialRequirementWizardState,
} from './types.js';
import {
  buildRequirementInputKeyboard,
  buildRequirementAddedKeyboard,
  buildRequirementInputMessage,
  buildRequirementAddedMessage,
  buildRequirementCancelledMessage,
  buildRequirementErrorMessage,
} from './requirement-keyboards.js';
import { addRequirement } from '../project-bridge.js';

// ============================================================================
// State Management
// ============================================================================

const WIZARD_STATE_TYPE = 'requirement_wizard';
const WIZARD_TIMEOUT_HOURS = 0.5; // 30 minutes

/**
 * Get wizard state for a user
 */
function getWizardState(telegramId: number): RequirementWizardState | null {
  const store = getGlobalStore();
  const state = store.getConversationState(telegramId);

  if (!state || state.pendingConfirmationType !== WIZARD_STATE_TYPE) {
    return null;
  }

  return state.pendingConfirmationData as RequirementWizardState | null;
}

/**
 * Save wizard state for a user
 */
function saveWizardState(telegramId: number, wizardState: RequirementWizardState): void {
  const store = getGlobalStore();
  const existingState = store.getConversationState(telegramId);

  store.setConversationState(telegramId, {
    activeProject: existingState?.activeProject ?? null,
    pendingConfirmationType: WIZARD_STATE_TYPE,
    pendingConfirmationData: wizardState as unknown as Record<string, unknown>,
    expiresInHours: WIZARD_TIMEOUT_HOURS,
  });
}

/**
 * Clear wizard state for a user
 */
function clearWizardState(telegramId: number): void {
  const store = getGlobalStore();
  store.clearPendingConfirmation(telegramId);
}

// ============================================================================
// Wizard Entry Point
// ============================================================================

/**
 * Start the requirement wizard for a project
 */
export async function startRequirementWizard(
  ctx: Context,
  projectName: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Get project info
  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    await ctx.reply(`Project not found: \`${projectName}\``, { parse_mode: 'Markdown' });
    return;
  }

  // Create initial state
  const state = createInitialRequirementWizardState(projectName, project.path);

  // Send input prompt
  const msg = await ctx.reply(buildRequirementInputMessage(projectName), {
    parse_mode: 'Markdown',
    reply_markup: buildRequirementInputKeyboard(projectName),
  });

  state.messageId = msg.message_id;
  saveWizardState(telegramId, state);
}

// ============================================================================
// Text Input Handler
// ============================================================================

/**
 * Handle text input for the requirement wizard
 * Returns true if input was handled
 */
export async function handleRequirementWizardTextInput(
  ctx: Context,
  text: string
): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const state = getWizardState(telegramId);
  if (!state) return false;

  if (state.step === 'input') {
    // User sent the requirement text
    await sendTyping(ctx);

    // Add the requirement
    const result = await addRequirement(state.projectPath, text);

    if (!result.success) {
      await safeEditMessage(
        ctx,
        buildRequirementErrorMessage(result.error ?? 'Failed to add requirement'),
        { parse_mode: 'Markdown' }
      );
      clearWizardState(telegramId);
      return true;
    }

    // Update state to added
    state.step = 'added';
    saveWizardState(telegramId, state);

    // Show success with follow-up actions
    if (state.messageId) {
      await safeEditMessage(ctx, buildRequirementAddedMessage(text), {
        parse_mode: 'Markdown',
        reply_markup: buildRequirementAddedKeyboard(state.projectName),
      });
    } else {
      await ctx.reply(buildRequirementAddedMessage(text), {
        parse_mode: 'Markdown',
        reply_markup: buildRequirementAddedKeyboard(state.projectName),
      });
    }

    // Clear state after showing result (user can click buttons for next action)
    clearWizardState(telegramId);
    return true;
  }

  return false;
}

// ============================================================================
// Callback Handler
// ============================================================================

/**
 * Handle callback queries for the requirement wizard (reqwiz:*)
 */
export async function handleRequirementWizardCallback(
  ctx: Context,
  data: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return;
  }

  // Parse callback: reqwiz:action:projectName
  const parts = data.split(':');
  const action = parts[1];
  const projectName = parts[2];

  await ctx.answerCallbackQuery();

  switch (action) {
    case 'cancel':
      await handleCancel(ctx, telegramId);
      break;

    case 'add_another':
      // Clear any existing state and start fresh
      clearWizardState(telegramId);
      if (projectName) {
        await startRequirementWizard(ctx, projectName);
      }
      break;

    default:
      console.warn(`[RequirementWizard] Unknown action: ${action}`);
  }
}

// ============================================================================
// Cancel Handler
// ============================================================================

/**
 * Handle wizard cancellation
 */
async function handleCancel(ctx: Context, telegramId: number): Promise<void> {
  clearWizardState(telegramId);
  await safeEditMessage(ctx, buildRequirementCancelledMessage(), {
    parse_mode: 'Markdown',
  });
}
