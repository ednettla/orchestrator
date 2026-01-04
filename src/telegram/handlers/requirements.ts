/**
 * Requirements Handlers
 *
 * Handle add and reqs commands.
 *
 * @module telegram/handlers/requirements
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { requirementsListKeyboard } from '../keyboards.js';
import { addRequirement, getRequirements } from '../project-bridge.js';

/**
 * Handle add command
 */
export async function addHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Get requirement from quoted arg or remaining args
  const requirement = quotedArg ?? args.join(' ');

  if (!requirement) {
    return {
      success: false,
      response:
        `Usage: \`/${project.name} add "requirement"\`\n\n` +
        `Example:\n` +
        `\`/${project.name} add "Add user login with email/password"\``,
      parseMode: 'Markdown',
    };
  }

  // Add the requirement
  const result = await addRequirement(project.path, requirement);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to add requirement:\n${result.error ?? result.output}`,
    };
  }

  return {
    success: true,
    response:
      `✅ *Requirement Added*\n\n` +
      `_${requirement}_\n\n` +
      `Use \`/${project.name} run\` to start execution.`,
    parseMode: 'Markdown',
  };
}

/**
 * Handle reqs command
 */
export async function reqsHandler(ctx: CommandContext): Promise<CommandResult> {
  const { projectName, args } = ctx;

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

  // Get filter from args
  const filter = args[0]?.toLowerCase();

  // Get requirements
  const allReqs = await getRequirements(project.path);

  if (allReqs.length === 0) {
    return {
      success: true,
      response:
        `📋 *No Requirements*\n\n` +
        `Project: ${project.name}\n\n` +
        `Add requirements with:\n` +
        `\`/${project.name} add "your requirement"\``,
      parseMode: 'Markdown',
    };
  }

  // Filter if specified
  let requirements = allReqs;
  if (filter && ['pending', 'in_progress', 'completed', 'failed'].includes(filter)) {
    const statusMap: Record<string, string> = {
      pending: 'pending',
      in_progress: 'in_progress',
      progress: 'in_progress',
      completed: 'completed',
      done: 'completed',
      failed: 'failed',
    };
    const targetStatus = statusMap[filter];
    requirements = allReqs.filter((r) => r.status === targetStatus);
  }

  if (requirements.length === 0) {
    return {
      success: true,
      response: `No ${filter ?? ''} requirements found.`,
    };
  }

  // Build response
  const lines = [`📋 *Requirements* (${requirements.length})\n`];

  const grouped = {
    in_progress: requirements.filter((r) => r.status === 'in_progress'),
    pending: requirements.filter((r) => r.status === 'pending'),
    completed: requirements.filter((r) => r.status === 'completed'),
    failed: requirements.filter((r) => r.status === 'failed'),
  };

  if (grouped.in_progress.length > 0) {
    lines.push('*🔄 In Progress*');
    for (const req of grouped.in_progress.slice(0, 3)) {
      lines.push(`  • ${truncate(req.title, 40)}`);
    }
    if (grouped.in_progress.length > 3) {
      lines.push(`  _...and ${grouped.in_progress.length - 3} more_`);
    }
    lines.push('');
  }

  if (grouped.pending.length > 0) {
    lines.push('*⏳ Pending*');
    for (const req of grouped.pending.slice(0, 5)) {
      lines.push(`  • ${truncate(req.title, 40)}`);
    }
    if (grouped.pending.length > 5) {
      lines.push(`  _...and ${grouped.pending.length - 5} more_`);
    }
    lines.push('');
  }

  if (grouped.completed.length > 0) {
    lines.push(`*✅ Completed* (${grouped.completed.length})`);
    lines.push('');
  }

  if (grouped.failed.length > 0) {
    lines.push('*❌ Failed*');
    for (const req of grouped.failed.slice(0, 3)) {
      lines.push(`  • ${truncate(req.title, 40)}`);
    }
    lines.push('');
  }

  const keyboard = requirementsListKeyboard(
    project.name,
    requirements.slice(0, 5).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
    }))
  );

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
    keyboard,
  };
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
