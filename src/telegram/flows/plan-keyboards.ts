/**
 * Plan Wizard Keyboard Builders
 *
 * Build inline keyboards for plan wizard flow steps.
 *
 * @module telegram/flows/plan-keyboards
 */

import { InlineKeyboard } from 'grammy';
import type { ClarifyingQuestion } from '../../core/types.js';
import { QUESTION_CATEGORY_LABELS } from './types.js';

// ============================================================================
// Goal Input Keyboard
// ============================================================================

/**
 * Build keyboard for goal input step
 */
export function buildGoalInputKeyboard(projectName: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text('❌ Cancel', `planwiz:cancel:${projectName}`);
  return keyboard;
}

// ============================================================================
// Question Keyboards
// ============================================================================

/**
 * Build keyboard for a question with suggested options
 */
export function buildQuestionKeyboard(
  projectName: string,
  question: ClarifyingQuestion,
  questionIndex: number,
  totalQuestions: number
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Add suggested option buttons if available (max 4 per row, 2 per row is cleaner)
  if (question.suggestedOptions && question.suggestedOptions.length > 0) {
    for (let i = 0; i < question.suggestedOptions.length; i += 2) {
      const row: { text: string; callback_data: string }[] = [];

      for (let j = i; j < Math.min(i + 2, question.suggestedOptions.length); j++) {
        const option = question.suggestedOptions[j];
        if (!option) continue;

        // Truncate long options for button display
        const displayText = option.length > 25 ? option.slice(0, 22) + '...' : option;

        row.push({
          text: displayText,
          callback_data: `planwiz:answer:${projectName}:${question.id}:${j}`,
        });
      }

      keyboard.row(...row.map((r) => InlineKeyboard.text(r.text, r.callback_data)));
    }

    // Add row break before custom answer
    keyboard.row();
  }

  // Add "Custom answer..." button
  keyboard.text('✏️ Custom answer...', `planwiz:custom:${projectName}:${question.id}`);

  // Add navigation row
  keyboard.row();

  if (questionIndex > 0) {
    keyboard.text('← Back', `planwiz:prev:${projectName}`);
  }

  keyboard.text('Skip →', `planwiz:skip:${projectName}:${question.id}`);
  keyboard.text('❌ Cancel', `planwiz:cancel:${projectName}`);

  return keyboard;
}

/**
 * Build keyboard for custom answer input mode
 */
export function buildCustomAnswerKeyboard(projectName: string, questionId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text('← Back to options', `planwiz:back_options:${projectName}:${questionId}`);
  keyboard.text('❌ Cancel', `planwiz:cancel:${projectName}`);
  return keyboard;
}

// ============================================================================
// Plan Review Keyboards
// ============================================================================

/**
 * Build keyboard for plan review/approval
 */
export function buildPlanReviewKeyboard(projectName: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text('✅ Approve Plan', `planwiz:approve:${projectName}`);
  keyboard.text('❌ Reject', `planwiz:reject:${projectName}`);
  keyboard.row();
  keyboard.text('📄 View Details', `planwiz:details:${projectName}`);

  return keyboard;
}

/**
 * Build keyboard for generating state (with cancel option)
 */
export function buildGeneratingKeyboard(projectName: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text('❌ Cancel', `planwiz:cancel:${projectName}`);
  return keyboard;
}

// ============================================================================
// Message Builders
// ============================================================================

/**
 * Build message for goal input step
 */
export function buildGoalMessage(projectName: string): string {
  return (
    `🎯 *Start Planning - ${projectName}*\n\n` +
    `What would you like to build?\n\n` +
    `Send a message describing your goal.\n\n` +
    `_Example: "Build a task management app with team collaboration"_`
  );
}

/**
 * Build message for generating questions step
 */
export function buildGeneratingQuestionsMessage(projectName: string, goal: string): string {
  return (
    `⏳ *Analyzing Goal*\n\n` +
    `Project: ${projectName}\n` +
    `Goal: _${truncate(goal, 100)}_\n\n` +
    `Generating clarifying questions...`
  );
}

/**
 * Build message for a clarifying question
 */
export function buildQuestionMessage(
  projectName: string,
  question: ClarifyingQuestion,
  questionIndex: number,
  totalQuestions: number
): string {
  const categoryLabel = QUESTION_CATEGORY_LABELS[question.category] ?? question.category;

  let message =
    `❓ *Question ${questionIndex + 1}/${totalQuestions}* _[${categoryLabel}]_\n\n` +
    `${question.question}`;

  if (question.context) {
    message += `\n\n_Context: ${truncate(question.context, 150)}_`;
  }

  if (question.suggestedOptions && question.suggestedOptions.length > 0) {
    message += `\n\n_Select an option or provide a custom answer:_`;
  } else {
    message += `\n\n_Send your answer as a message:_`;
  }

  return message;
}

/**
 * Build message for custom answer input
 */
export function buildCustomAnswerMessage(
  projectName: string,
  question: ClarifyingQuestion,
  questionIndex: number,
  totalQuestions: number
): string {
  return (
    `✏️ *Custom Answer*\n\n` +
    `Question ${questionIndex + 1}/${totalQuestions}:\n` +
    `${question.question}\n\n` +
    `_Send your answer as a message:_`
  );
}

/**
 * Build message for generating plan step
 */
export function buildGeneratingPlanMessage(projectName: string): string {
  return (
    `⏳ *Generating Plan*\n\n` +
    `Project: ${projectName}\n\n` +
    `All questions answered. Now generating detailed plan...\n\n` +
    `_This may take a minute..._`
  );
}

/**
 * Build message for plan review step
 */
export function buildPlanReviewMessage(
  projectName: string,
  goal: string,
  overview: string,
  requirementCount: number
): string {
  return (
    `📋 *Plan Ready for Review*\n\n` +
    `Project: ${projectName}\n` +
    `Goal: _${truncate(goal, 80)}_\n\n` +
    `*Overview:*\n${truncate(overview, 300)}\n\n` +
    `*Requirements:* ${requirementCount} items\n\n` +
    `_Use the Mini App for full details._`
  );
}

/**
 * Build message for wizard cancellation
 */
export function buildCancelledMessage(): string {
  return `_Planning cancelled._`;
}

/**
 * Build message for wizard error
 */
export function buildErrorMessage(error: string): string {
  return `❌ *Planning Error*\n\n${truncate(error, 200)}`;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
