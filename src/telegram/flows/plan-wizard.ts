/**
 * Plan Wizard Flow
 *
 * Interactive wizard for creating and managing plans in Telegram.
 * Handles goal input, clarifying questions with inline keyboards, and plan approval.
 *
 * @module telegram/flows/plan-wizard
 */

import type { Context } from 'grammy';
import { getGlobalStore } from '../../core/global-store.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { createStore } from '../../state/store.js';
import { safeEditMessage } from '../utils/safe-edit.js';
import {
  type PlanWizardState,
  createInitialPlanWizardState,
} from './types.js';
import {
  buildGoalInputKeyboard,
  buildQuestionKeyboard,
  buildCustomAnswerKeyboard,
  buildPlanReviewKeyboard,
  buildGeneratingKeyboard,
  buildGoalMessage,
  buildGeneratingQuestionsMessage,
  buildQuestionMessage,
  buildCustomAnswerMessage,
  buildGeneratingPlanMessage,
  buildPlanReviewMessage,
  buildCancelledMessage,
  buildErrorMessage,
} from './plan-keyboards.js';
import {
  startPlanFromApi,
  answerPlanQuestionFromApi,
  approvePlanFromApi,
  rejectPlanFromApi,
} from '../project-bridge.js';
import type { ClarifyingQuestion, Plan } from '../../core/types.js';

// ============================================================================
// State Management
// ============================================================================

const WIZARD_STATE_TYPE = 'plan_wizard';
const WIZARD_TIMEOUT_HOURS = 0.5; // 30 minutes

/**
 * Get wizard state for a user
 */
function getWizardState(telegramId: number): PlanWizardState | null {
  const store = getGlobalStore();
  const state = store.getConversationState(telegramId);

  if (!state || state.pendingConfirmationType !== WIZARD_STATE_TYPE) {
    return null;
  }

  return state.pendingConfirmationData as PlanWizardState | null;
}

/**
 * Save wizard state for a user
 */
function saveWizardState(telegramId: number, wizardState: PlanWizardState): void {
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
 * Start the plan wizard for a project
 */
export async function startPlanWizard(
  ctx: Context,
  projectName: string,
  initialGoal?: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    await ctx.reply(`Project not found: \`${projectName}\``, { parse_mode: 'Markdown' });
    return;
  }

  // Check for existing wizard
  const existingState = getWizardState(telegramId);
  if (existingState) {
    // If same project, offer to continue
    if (existingState.projectName === projectName) {
      const keyboard = (await import('grammy')).InlineKeyboard;
      const resumeKeyboard = new keyboard()
        .text('Continue', `planwiz:resume:${projectName}`)
        .text('Start New', `planwiz:restart:${projectName}`);

      await ctx.reply(
        `You have an active planning session for *${projectName}*.\n\n` +
          `Continue where you left off or start fresh?`,
        { parse_mode: 'Markdown', reply_markup: resumeKeyboard }
      );
      return;
    }

    // Different project - clear old state
    clearWizardState(telegramId);
  }

  // Initialize new wizard state
  const state = createInitialPlanWizardState(projectName, project.path);

  // If goal provided, skip to generating
  if (initialGoal) {
    state.step = 'generating_questions';
    state.goal = initialGoal;
    saveWizardState(telegramId, state);

    // Send generating message and start plan
    const msg = await ctx.reply(
      buildGeneratingQuestionsMessage(projectName, initialGoal),
      {
        parse_mode: 'Markdown',
        reply_markup: buildGeneratingKeyboard(projectName),
      }
    );

    state.messageId = msg.message_id;
    saveWizardState(telegramId, state);

    // Start the plan (this triggers question generation)
    await startPlanGeneration(ctx, state);
  } else {
    // Show goal input prompt
    saveWizardState(telegramId, state);

    const msg = await ctx.reply(buildGoalMessage(projectName), {
      parse_mode: 'Markdown',
      reply_markup: buildGoalInputKeyboard(projectName),
    });

    state.messageId = msg.message_id;
    saveWizardState(telegramId, state);
  }
}

// ============================================================================
// Text Input Handler
// ============================================================================

/**
 * Handle text input for the plan wizard
 * Returns true if input was handled
 */
export async function handlePlanWizardTextInput(
  ctx: Context,
  text: string
): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const state = getWizardState(telegramId);
  if (!state) return false;

  if (state.step === 'goal') {
    // Goal input
    state.goal = text;
    state.step = 'generating_questions';
    saveWizardState(telegramId, state);

    // Update message to show generating
    if (state.messageId) {
      await safeEditMessage(
        ctx,
        buildGeneratingQuestionsMessage(state.projectName, text),
        { parse_mode: 'Markdown', reply_markup: buildGeneratingKeyboard(state.projectName) }
      );
    }

    // Start plan generation
    await startPlanGeneration(ctx, state);
    return true;
  }

  if (state.step === 'answering' && state.currentQuestionId) {
    // Custom answer input
    await submitAnswer(ctx, state, state.currentQuestionId, text);
    return true;
  }

  return false;
}

// ============================================================================
// Callback Handler
// ============================================================================

/**
 * Handle callback queries for the plan wizard (planwiz:*)
 */
export async function handlePlanWizardCallback(
  ctx: Context,
  data: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return;
  }

  // Parse callback: planwiz:action:projectName:...extra
  const parts = data.split(':');
  const action = parts[1];
  const projectName = parts[2];

  const state = getWizardState(telegramId);

  // Handle stateless actions
  if (action === 'resume' && state) {
    await ctx.answerCallbackQuery({ text: 'Resuming...' });
    await showCurrentStep(ctx, state);
    return;
  }

  if (action === 'restart') {
    clearWizardState(telegramId);
    await ctx.answerCallbackQuery({ text: 'Starting fresh...' });
    await startPlanWizard(ctx, projectName ?? '');
    return;
  }

  if (!state) {
    await ctx.answerCallbackQuery({ text: 'Session expired. Use /plan to start again.' });
    return;
  }

  // Verify project matches
  if (projectName && state.projectName !== projectName) {
    await ctx.answerCallbackQuery({ text: 'Wrong project context' });
    return;
  }

  await ctx.answerCallbackQuery();

  switch (action) {
    case 'answer': {
      // Answer with suggested option: planwiz:answer:project:questionId:optionIndex
      const questionId = parts[3];
      const optionIndex = parseInt(parts[4] ?? '0', 10);
      if (questionId) {
        await submitSuggestedAnswer(ctx, state, questionId, optionIndex);
      }
      break;
    }

    case 'custom': {
      // Switch to custom answer mode: planwiz:custom:project:questionId
      const questionId = parts[3];
      if (questionId) {
        state.step = 'answering';
        state.currentQuestionId = questionId;
        saveWizardState(telegramId, state);
        await showCustomAnswerPrompt(ctx, state, questionId);
      }
      break;
    }

    case 'back_options': {
      // Go back to question options: planwiz:back_options:project:questionId
      state.step = 'questions';
      state.currentQuestionId = undefined;
      saveWizardState(telegramId, state);
      await showCurrentQuestion(ctx, state);
      break;
    }

    case 'skip': {
      // Skip question with empty answer: planwiz:skip:project:questionId
      const questionId = parts[3];
      if (questionId) {
        await submitAnswer(ctx, state, questionId, '');
      }
      break;
    }

    case 'prev': {
      // Go to previous question
      if (state.currentQuestionIndex > 0) {
        state.currentQuestionIndex--;
        saveWizardState(telegramId, state);
        await showCurrentQuestion(ctx, state);
      }
      break;
    }

    case 'approve': {
      await handleApprove(ctx, state);
      break;
    }

    case 'reject': {
      await handleReject(ctx, state);
      break;
    }

    case 'details': {
      await ctx.answerCallbackQuery({ text: 'Open Mini App for full details' });
      break;
    }

    case 'cancel': {
      clearWizardState(telegramId);
      await safeEditMessage(ctx, buildCancelledMessage(), { parse_mode: 'Markdown' });
      break;
    }

    default:
      console.warn(`[PlanWizard] Unknown action: ${action}`);
  }
}

// ============================================================================
// Plan Generation
// ============================================================================

/**
 * Start plan generation (creates plan and generates questions)
 */
async function startPlanGeneration(ctx: Context, state: PlanWizardState): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !state.goal) return;

  try {
    // Start the plan via API (this triggers question generation)
    const result = await startPlanFromApi(state.projectPath, state.goal);

    if (!result.success) {
      await safeEditMessage(
        ctx,
        buildErrorMessage(result.error ?? 'Failed to start planning'),
        { parse_mode: 'Markdown' }
      );
      clearWizardState(telegramId);
      return;
    }

    // Poll for plan status and questions
    await pollForQuestions(ctx, state);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await safeEditMessage(ctx, buildErrorMessage(msg), { parse_mode: 'Markdown' });
    clearWizardState(telegramId);
  }
}

/**
 * Poll for questions to be generated
 */
async function pollForQuestions(ctx: Context, state: PlanWizardState): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const maxAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check if wizard was cancelled
    const currentState = getWizardState(telegramId);
    if (!currentState || currentState.step !== 'generating_questions') {
      return;
    }

    // Get plan from store
    const store = createStore(state.projectPath);
    const session = store.getSessionByPath(state.projectPath);

    if (!session) {
      store.close();
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    const plan = store.getActivePlan(session.id);
    store.close();

    if (!plan) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    // Store plan ID
    state.planId = plan.id;
    saveWizardState(telegramId, state);

    // Check if questions are ready
    if (plan.questions && plan.questions.length > 0) {
      state.step = 'questions';
      state.currentQuestionIndex = 0;
      saveWizardState(telegramId, state);

      await showCurrentQuestion(ctx, state);
      return;
    }

    // Check if plan is already in pending_approval (no questions needed)
    if (plan.status === 'pending_approval') {
      state.step = 'review';
      saveWizardState(telegramId, state);

      await showPlanReview(ctx, state, plan);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout - show message
  await safeEditMessage(
    ctx,
    buildErrorMessage('Planning is taking longer than expected. Check back with `/status`.'),
    { parse_mode: 'Markdown' }
  );
}

// ============================================================================
// Question Display
// ============================================================================

/**
 * Show the current step based on state
 */
async function showCurrentStep(ctx: Context, state: PlanWizardState): Promise<void> {
  switch (state.step) {
    case 'goal':
      await safeEditMessage(ctx, buildGoalMessage(state.projectName), {
        parse_mode: 'Markdown',
        reply_markup: buildGoalInputKeyboard(state.projectName),
      });
      break;

    case 'generating_questions':
      await safeEditMessage(
        ctx,
        buildGeneratingQuestionsMessage(state.projectName, state.goal ?? ''),
        { parse_mode: 'Markdown', reply_markup: buildGeneratingKeyboard(state.projectName) }
      );
      break;

    case 'questions':
      await showCurrentQuestion(ctx, state);
      break;

    case 'answering':
      if (state.currentQuestionId) {
        await showCustomAnswerPrompt(ctx, state, state.currentQuestionId);
      }
      break;

    case 'generating_plan':
      await safeEditMessage(ctx, buildGeneratingPlanMessage(state.projectName), {
        parse_mode: 'Markdown',
        reply_markup: buildGeneratingKeyboard(state.projectName),
      });
      break;

    case 'review': {
      const store = createStore(state.projectPath);
      const session = store.getSessionByPath(state.projectPath);
      const plan = session ? store.getActivePlan(session.id) : null;
      store.close();

      if (plan) {
        await showPlanReview(ctx, state, plan);
      }
      break;
    }
  }
}

/**
 * Show the current question
 */
async function showCurrentQuestion(ctx: Context, state: PlanWizardState): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Get plan and questions from store
  const store = createStore(state.projectPath);
  const session = store.getSessionByPath(state.projectPath);
  const plan = session ? store.getActivePlan(session.id) : null;
  store.close();

  if (!plan || !plan.questions || plan.questions.length === 0) {
    await safeEditMessage(
      ctx,
      buildErrorMessage('No questions found. Try starting a new plan.'),
      { parse_mode: 'Markdown' }
    );
    clearWizardState(telegramId);
    return;
  }

  // Find first unanswered question
  const unansweredQuestions = plan.questions.filter((q: ClarifyingQuestion) => !q.answer);

  if (unansweredQuestions.length === 0) {
    // All questions answered - move to plan generation
    state.step = 'generating_plan';
    saveWizardState(telegramId, state);

    await safeEditMessage(ctx, buildGeneratingPlanMessage(state.projectName), {
      parse_mode: 'Markdown',
      reply_markup: buildGeneratingKeyboard(state.projectName),
    });

    // Poll for plan completion
    await pollForPlanCompletion(ctx, state);
    return;
  }

  const question = unansweredQuestions[0];
  if (!question) return;

  // Find index in original list for progress display
  const questionIndex = plan.questions.findIndex((q: ClarifyingQuestion) => q.id === question.id);
  state.currentQuestionIndex = questionIndex;
  saveWizardState(telegramId, state);

  await safeEditMessage(
    ctx,
    buildQuestionMessage(state.projectName, question, questionIndex, plan.questions.length),
    {
      parse_mode: 'Markdown',
      reply_markup: buildQuestionKeyboard(state.projectName, question, questionIndex, plan.questions.length),
    }
  );
}

/**
 * Show custom answer prompt
 */
async function showCustomAnswerPrompt(
  ctx: Context,
  state: PlanWizardState,
  questionId: string
): Promise<void> {
  // Get question from store
  const store = createStore(state.projectPath);
  const session = store.getSessionByPath(state.projectPath);
  const plan = session ? store.getActivePlan(session.id) : null;
  store.close();

  if (!plan) return;

  const question = plan.questions.find((q: ClarifyingQuestion) => q.id === questionId);
  if (!question) return;

  const questionIndex = plan.questions.findIndex((q: ClarifyingQuestion) => q.id === questionId);

  await safeEditMessage(
    ctx,
    buildCustomAnswerMessage(state.projectName, question, questionIndex, plan.questions.length),
    {
      parse_mode: 'Markdown',
      reply_markup: buildCustomAnswerKeyboard(state.projectName, questionId),
    }
  );
}

// ============================================================================
// Answer Submission
// ============================================================================

/**
 * Submit a suggested option as answer
 */
async function submitSuggestedAnswer(
  ctx: Context,
  state: PlanWizardState,
  questionId: string,
  optionIndex: number
): Promise<void> {
  // Get question to find the option text
  const store = createStore(state.projectPath);
  const session = store.getSessionByPath(state.projectPath);
  const plan = session ? store.getActivePlan(session.id) : null;
  store.close();

  if (!plan) return;

  const question = plan.questions.find((q: ClarifyingQuestion) => q.id === questionId);
  if (!question || !question.suggestedOptions) return;

  const answer = question.suggestedOptions[optionIndex];
  if (!answer) return;

  await submitAnswer(ctx, state, questionId, answer);
}

/**
 * Submit an answer (text or selected option)
 */
async function submitAnswer(
  ctx: Context,
  state: PlanWizardState,
  questionId: string,
  answer: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const result = await answerPlanQuestionFromApi(state.projectPath, questionId, answer);

    if (!result.success) {
      await safeEditMessage(
        ctx,
        buildErrorMessage(result.error ?? 'Failed to submit answer'),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Clear answering state
    state.step = 'questions';
    state.currentQuestionId = undefined;
    saveWizardState(telegramId, state);

    // Move to next question or plan review
    await showCurrentQuestion(ctx, state);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await safeEditMessage(ctx, buildErrorMessage(msg), { parse_mode: 'Markdown' });
  }
}

// ============================================================================
// Plan Completion
// ============================================================================

/**
 * Poll for plan generation completion
 */
async function pollForPlanCompletion(ctx: Context, state: PlanWizardState): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const maxAttempts = 60; // 60 attempts * 2 seconds = 120 seconds max
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check if wizard was cancelled
    const currentState = getWizardState(telegramId);
    if (!currentState || currentState.step !== 'generating_plan') {
      return;
    }

    // Get plan from store
    const store = createStore(state.projectPath);
    const session = store.getSessionByPath(state.projectPath);
    const plan = session ? store.getActivePlan(session.id) : null;
    store.close();

    if (!plan) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    // Check if plan is ready for approval
    if (plan.status === 'pending_approval') {
      state.step = 'review';
      saveWizardState(telegramId, state);

      await showPlanReview(ctx, state, plan);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout
  await safeEditMessage(
    ctx,
    buildErrorMessage('Plan generation is taking longer than expected. Check back with `/status`.'),
    { parse_mode: 'Markdown' }
  );
}

/**
 * Show plan review
 */
async function showPlanReview(ctx: Context, state: PlanWizardState, plan: Plan): Promise<void> {
  await safeEditMessage(
    ctx,
    buildPlanReviewMessage(
      state.projectName,
      plan.highLevelGoal,
      plan.overview ?? 'No overview available',
      plan.requirements?.length ?? 0
    ),
    {
      parse_mode: 'Markdown',
      reply_markup: buildPlanReviewKeyboard(state.projectName),
    }
  );
}

// ============================================================================
// Plan Approval/Rejection
// ============================================================================

/**
 * Handle plan approval
 */
async function handleApprove(ctx: Context, state: PlanWizardState): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const result = await approvePlanFromApi(state.projectPath);

    if (!result.success) {
      await safeEditMessage(
        ctx,
        buildErrorMessage(result.error ?? 'Failed to approve plan'),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    clearWizardState(telegramId);

    await safeEditMessage(
      ctx,
      `✅ *Plan Approved!*\n\n` +
        `Project: ${state.projectName}\n\n` +
        `Use \`/${state.projectName} run\` to start execution.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await safeEditMessage(ctx, buildErrorMessage(msg), { parse_mode: 'Markdown' });
  }
}

/**
 * Handle plan rejection
 */
async function handleReject(ctx: Context, state: PlanWizardState): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const result = await rejectPlanFromApi(state.projectPath);

    if (!result.success) {
      await safeEditMessage(
        ctx,
        buildErrorMessage(result.error ?? 'Failed to reject plan'),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    clearWizardState(telegramId);

    await safeEditMessage(
      ctx,
      `❌ *Plan Rejected*\n\n` +
        `Project: ${state.projectName}\n\n` +
        `Start a new plan with \`/${state.projectName} plan "new goal"\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await safeEditMessage(ctx, buildErrorMessage(msg), { parse_mode: 'Markdown' });
  }
}
