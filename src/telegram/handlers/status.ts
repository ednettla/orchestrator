/**
 * Status Handler
 *
 * Handle /<project> status command.
 *
 * @module telegram/handlers/status
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { projectActionsKeyboard } from '../keyboards.js';
import { getProjectStatus, getDaemonStatus } from '../project-bridge.js';

/**
 * Handle status command
 */
export async function statusHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Get project status
  const status = await getProjectStatus(project.path);
  const daemon = await getDaemonStatus(project.path);

  // Build status card
  const lines = [
    `━━━ *${project.name}* ━━━`,
    '',
    `*Phase:* ${getPhaseEmoji(status.phase)} ${status.phase}`,
    `*Daemon:* ${daemon.running ? '🟢 Running' : '⚪ Stopped'}`,
    '',
    '*Requirements:*',
    `  ⏳ Pending: ${status.requirements.pending}`,
    `  🔄 In Progress: ${status.requirements.inProgress}`,
    `  ✅ Completed: ${status.requirements.completed}`,
    `  ❌ Failed: ${status.requirements.failed}`,
  ];

  if (status.lastActivity) {
    lines.push('');
    lines.push(`_Last: ${status.lastActivity}_`);
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━');

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
    keyboard: projectActionsKeyboard(project.name),
  };
}

/**
 * Get emoji for project phase
 */
function getPhaseEmoji(phase: string): string {
  switch (phase) {
    case 'idle':
      return '⚪';
    case 'planning':
      return '📋';
    case 'architecting':
      return '🏗️';
    case 'coding':
      return '💻';
    case 'reviewing':
      return '🔍';
    case 'testing':
      return '🧪';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    default:
      return '❓';
  }
}
