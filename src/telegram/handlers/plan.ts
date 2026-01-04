/**
 * Plan Handlers
 *
 * Handle plan, approve, reject, and answer commands.
 *
 * @module telegram/handlers/plan
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { planConfirmKeyboard } from '../keyboards.js';
import {
  startPlan,
  approvePlanFromApi,
  rejectPlanFromApi,
  answerPlanQuestionFromApi,
} from '../project-bridge.js';
import { createStore } from '../../state/store.js';
import type { ClarifyingQuestion } from '../../core/types.js';

/**
 * Handle plan command
 */
export async function planHandler(ctx: CommandContext): Promise<CommandResult> {
  const { projectName, quotedArg, args } = ctx;

  if (!projectName) {
    return {
      success: false,
      response: 'Project name required.',
    };
  }

  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  // Get goal from quoted arg or remaining args
  const goal = quotedArg ?? args.join(' ');

  if (!goal) {
    return {
      success: true,
      response:
        `🎯 *Start Planning*\n\n` +
        `Project: ${project.name}\n\n` +
        `Usage: \`/${project.name} plan "your goal"\`\n\n` +
        `Example:\n` +
        `\`/${project.name} plan "Build a user authentication system"\``,
      parseMode: 'Markdown',
      keyboard: planConfirmKeyboard(project.name),
    };
  }

  // Start planning in daemon mode
  const result = await startPlan(project.path, goal);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to start planning:\n\`\`\`\n${result.error ?? result.output}\n\`\`\``,
      parseMode: 'Markdown',
    };
  }

  return {
    success: true,
    response:
      `🚀 *Planning Started*\n\n` +
      `Project: ${project.name}\n` +
      `Goal: _${goal}_\n\n` +
      `The planner is now working on your goal.\n` +
      `You'll receive a notification when the plan is ready for approval.\n\n` +
      `Use \`/${project.name} status\` to check progress.`,
    parseMode: 'Markdown',
  };
}

/**
 * Handle approve command
 */
export async function approveHandler(ctx: CommandContext): Promise<CommandResult> {
  const { projectName } = ctx;

  if (!projectName) {
    return {
      success: false,
      response: 'Project name required.',
    };
  }

  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  // Check for pending questions
  const store = createStore(project.path);
  const session = store.getSessionByPath(project.path);

  if (!session) {
    store.close();
    return {
      success: false,
      response: `Project not initialized: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  const plan = store.getActivePlan(session.id);
  store.close();

  if (!plan) {
    return {
      success: false,
      response:
        `No pending plan to approve.\n\n` +
        `Start a new plan with:\n` +
        `\`/${project.name} plan "your goal"\``,
      parseMode: 'Markdown',
    };
  }

  // Check for unanswered questions
  const unanswered = plan.questions.filter((q: ClarifyingQuestion) => !q.answer);
  if (unanswered.length > 0) {
    return {
      success: false,
      response:
        `Cannot approve: ${unanswered.length} question(s) unanswered.\n\n` +
        `Use \`/${project.name} questions\` to see pending questions.\n` +
        `Use \`/${project.name} answer <id> "answer"\` to respond.`,
      parseMode: 'Markdown',
    };
  }

  // Approve the plan
  const result = await approvePlanFromApi(project.path);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to approve plan:\n${result.error ?? 'Unknown error'}`,
    };
  }

  return {
    success: true,
    response:
      `✅ *Plan Approved*\n\n` +
      `Project: ${project.name}\n\n` +
      `Execution will begin shortly.\n` +
      `Use \`/${project.name} run\` to start or \`/${project.name} status\` to monitor.`,
    parseMode: 'Markdown',
  };
}

/**
 * Handle reject command
 */
export async function rejectHandler(ctx: CommandContext): Promise<CommandResult> {
  const { projectName, quotedArg, args } = ctx;

  if (!projectName) {
    return {
      success: false,
      response: 'Project name required.',
    };
  }

  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  const reason = quotedArg ?? args.join(' ') ?? undefined;

  // Reject the plan
  const result = await rejectPlanFromApi(project.path, reason);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to reject plan:\n${result.error ?? 'Unknown error'}`,
    };
  }

  return {
    success: true,
    response:
      `❌ *Plan Rejected*\n\n` +
      `Project: ${project.name}\n` +
      (reason ? `Reason: _${reason}_\n\n` : '\n') +
      `You can create a new plan with:\n` +
      `\`/${project.name} plan "your goal"\``,
    parseMode: 'Markdown',
  };
}

/**
 * Handle answer command
 */
export async function answerHandler(ctx: CommandContext): Promise<CommandResult> {
  const { projectName, args, quotedArg } = ctx;

  if (!projectName) {
    return {
      success: false,
      response: 'Project name required.',
    };
  }

  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  // Parse: answer <qid> "answer"
  const questionId = args[0];
  const answer = quotedArg ?? args.slice(1).join(' ');

  if (!questionId || !answer) {
    return {
      success: false,
      response:
        `Usage: \`/${project.name} answer <id> "your answer"\`\n\n` +
        `Use \`/${project.name} questions\` to see pending questions.`,
      parseMode: 'Markdown',
    };
  }

  // Submit the answer
  const result = await answerPlanQuestionFromApi(project.path, questionId, answer);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to submit answer:\n${result.error ?? 'Unknown error'}`,
    };
  }

  const remaining = result.remainingQuestions ?? 0;

  if (remaining > 0) {
    return {
      success: true,
      response:
        `✅ *Answer Submitted*\n\n` +
        `${remaining} question(s) remaining.\n\n` +
        `Use \`/${project.name} questions\` to see next question.`,
      parseMode: 'Markdown',
    };
  }

  return {
    success: true,
    response:
      `✅ *Answer Submitted*\n\n` +
      `All questions answered!\n\n` +
      `Use \`/${project.name} approve\` to approve the plan.`,
    parseMode: 'Markdown',
  };
}

/**
 * Handle questions command - show pending questions
 */
export async function questionsHandler(ctx: CommandContext): Promise<CommandResult> {
  const { projectName } = ctx;

  if (!projectName) {
    return {
      success: false,
      response: 'Project name required.',
    };
  }

  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  // Get the active plan
  const store = createStore(project.path);
  const session = store.getSessionByPath(project.path);

  if (!session) {
    store.close();
    return {
      success: false,
      response: `Project not initialized: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  const plan = store.getActivePlan(session.id);
  store.close();

  if (!plan) {
    return {
      success: true,
      response:
        `No active plan.\n\n` +
        `Start a new plan with:\n` +
        `\`/${project.name} plan "your goal"\``,
      parseMode: 'Markdown',
    };
  }

  const questions = plan.questions;
  const unanswered = questions.filter((q: ClarifyingQuestion) => !q.answer);

  if (unanswered.length === 0) {
    const answered = questions.filter((q: ClarifyingQuestion) => q.answer);
    if (answered.length > 0) {
      return {
        success: true,
        response:
          `✅ *All Questions Answered*\n\n` +
          `${answered.length} question(s) answered.\n\n` +
          `Use \`/${project.name} approve\` to approve the plan.`,
        parseMode: 'Markdown',
      };
    }

    return {
      success: true,
      response:
        `No questions for this plan.\n\n` +
        `Use \`/${project.name} approve\` to approve or \`/${project.name} reject\` to reject.`,
      parseMode: 'Markdown',
    };
  }

  // Format questions
  const lines = [`❓ *Pending Questions* (${unanswered.length})\n`];

  for (let i = 0; i < unanswered.length && i < 5; i++) {
    const q = unanswered[i];
    if (!q) continue;
    lines.push(`*${i + 1}. ${q.question}*`);
    lines.push(`   ID: \`${q.id}\``);
    if (q.context) {
      lines.push(`   _${truncate(q.context, 60)}_`);
    }
    lines.push('');
  }

  if (unanswered.length > 5) {
    lines.push(`_...and ${unanswered.length - 5} more_\n`);
  }

  lines.push(`Answer with:\n\`/${project.name} answer <id> "your answer"\``);

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
  };
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
