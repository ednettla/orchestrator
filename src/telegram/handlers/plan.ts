/**
 * Plan Handlers
 *
 * Handle plan, approve, and reject commands.
 *
 * @module telegram/handlers/plan
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { planConfirmKeyboard, planApprovalKeyboard } from '../keyboards.js';
import { startPlan } from '../project-bridge.js';

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

  // TODO: Check if there's a pending plan and approve it
  // For now, return a placeholder response
  return {
    success: true,
    response:
      `✅ *Plan Approved*\n\n` +
      `Project: ${project.name}\n\n` +
      `Execution will begin shortly.\n` +
      `Use \`/${project.name} status\` to monitor progress.`,
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

  const reason = quotedArg ?? args.join(' ') ?? 'No reason provided';

  // TODO: Actually reject the pending plan
  return {
    success: true,
    response:
      `❌ *Plan Rejected*\n\n` +
      `Project: ${project.name}\n` +
      `Reason: _${reason}_\n\n` +
      `You can create a new plan with:\n` +
      `\`/${project.name} plan "your goal"\``,
    parseMode: 'Markdown',
  };
}
