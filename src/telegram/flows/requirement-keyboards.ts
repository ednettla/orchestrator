/**
 * Requirement Wizard Keyboard Builders
 *
 * Build inline keyboards for requirement wizard flow steps.
 *
 * @module telegram/flows/requirement-keyboards
 */

import { InlineKeyboard } from 'grammy';
import { createCallbackData } from '../types.js';

// ============================================================================
// Input Step
// ============================================================================

/**
 * Build keyboard for requirement input step
 */
export function buildRequirementInputKeyboard(projectName: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text('❌ Cancel', `reqwiz:cancel:${projectName}`);
  return keyboard;
}

/**
 * Build message for requirement input step
 */
export function buildRequirementInputMessage(projectName: string): string {
  return (
    `➕ *Add Requirement*\n\n` +
    `Project: \`${projectName}\`\n\n` +
    `What requirement do you want to add?\n` +
    `Send a message with your requirement.`
  );
}

// ============================================================================
// Added Step
// ============================================================================

/**
 * Build keyboard after requirement is added
 */
export function buildRequirementAddedKeyboard(projectName: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard
    .text('➕ Add Another', `reqwiz:add_another:${projectName}`)
    .text('📋 Requirements', createCallbackData({ action: 'reqs', projectName }))
    .row()
    .text('📊 Status', createCallbackData({ action: 'status', projectName }));
  return keyboard;
}

/**
 * Build message after requirement is added
 */
export function buildRequirementAddedMessage(requirement: string): string {
  // Truncate if very long
  const displayReq = requirement.length > 200 ? requirement.slice(0, 197) + '...' : requirement;

  return `✅ *Requirement Added*\n\n_${displayReq}_`;
}

// ============================================================================
// Error / Cancelled
// ============================================================================

/**
 * Build message for cancelled wizard
 */
export function buildRequirementCancelledMessage(): string {
  return `_Requirement input cancelled._`;
}

/**
 * Build error message
 */
export function buildRequirementErrorMessage(error: string): string {
  return `❌ *Error*\n\n${error}`;
}
