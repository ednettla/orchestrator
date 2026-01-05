/**
 * Requirements Handlers
 *
 * Handle add, edit, priority, delete, and reqs commands.
 *
 * @module telegram/handlers/requirements
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { requirementsListKeyboard, requirementAddedKeyboard } from '../keyboards.js';
import {
  addRequirement,
  getRequirements,
  getRequirement,
  updateRequirementText,
  updateRequirementPriority,
  deleteRequirement,
} from '../project-bridge.js';
import { startRequirementWizard } from '../flows/requirement-wizard.js';

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

  // If no requirement provided, start the wizard
  if (!requirement) {
    // Start wizard - ctx.ctx is the grammy context
    await startRequirementWizard(ctx.ctx, project.name);
    return {
      success: true,
      response: '',
      skipReply: true,
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
      `_${requirement}_`,
    parseMode: 'Markdown',
    keyboard: requirementAddedKeyboard(project.name),
  };
}

/**
 * Handle edit command
 */
export async function editHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Parse: edit <id> "new text"
  const reqId = args[0];
  const newText = quotedArg ?? args.slice(1).join(' ');

  if (!reqId || !newText) {
    return {
      success: false,
      response:
        `Usage: \`/${project.name} edit <id> "new text"\`\n\n` +
        `Example:\n` +
        `\`/${project.name} edit abc123 "Updated requirement text"\``,
      parseMode: 'Markdown',
    };
  }

  // Check if requirement exists
  const req = await getRequirement(project.path, reqId);
  if (!req) {
    return {
      success: false,
      response: `Requirement not found: \`${reqId}\``,
      parseMode: 'Markdown',
    };
  }

  // Update the requirement
  const result = await updateRequirementText(project.path, reqId, newText);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to update requirement:\n${result.error ?? 'Unknown error'}`,
    };
  }

  return {
    success: true,
    response:
      `✅ *Requirement Updated*\n\n` +
      `ID: \`${reqId}\`\n` +
      `New text: _${newText}_`,
    parseMode: 'Markdown',
  };
}

/**
 * Handle priority command
 */
export async function priorityHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Parse: priority <id> <0-10>
  const reqId = args[0];
  const priorityStr = args[1];

  if (!reqId || !priorityStr) {
    return {
      success: false,
      response:
        `Usage: \`/${project.name} priority <id> <0-10>\`\n\n` +
        `Priority levels:\n` +
        `  0-3: Low\n` +
        `  4-6: Medium\n` +
        `  7-9: High\n` +
        `  10: Critical`,
      parseMode: 'Markdown',
    };
  }

  const priority = parseInt(priorityStr, 10);
  if (isNaN(priority) || priority < 0 || priority > 10) {
    return {
      success: false,
      response: `Invalid priority: \`${priorityStr}\`. Must be 0-10.`,
      parseMode: 'Markdown',
    };
  }

  // Check if requirement exists
  const req = await getRequirement(project.path, reqId);
  if (!req) {
    return {
      success: false,
      response: `Requirement not found: \`${reqId}\``,
      parseMode: 'Markdown',
    };
  }

  // Update the priority
  const result = await updateRequirementPriority(project.path, reqId, priority);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to update priority:\n${result.error ?? 'Unknown error'}`,
    };
  }

  const priorityLabel = getPriorityLabel(priority);

  return {
    success: true,
    response:
      `✅ *Priority Updated*\n\n` +
      `ID: \`${reqId}\`\n` +
      `Priority: ${priority} (${priorityLabel})`,
    parseMode: 'Markdown',
  };
}

/**
 * Handle delete command
 */
export async function deleteHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Parse: delete <id> [--force]
  const reqId = args[0];
  const force = args.includes('--force') || args.includes('-f');

  if (!reqId) {
    return {
      success: false,
      response:
        `Usage: \`/${project.name} delete <id>\`\n\n` +
        `Add \`--force\` to skip confirmation:\n` +
        `\`/${project.name} delete <id> --force\``,
      parseMode: 'Markdown',
    };
  }

  // Check if requirement exists
  const req = await getRequirement(project.path, reqId);
  if (!req) {
    return {
      success: false,
      response: `Requirement not found: \`${reqId}\``,
      parseMode: 'Markdown',
    };
  }

  // If not forced, show confirmation message
  if (!force) {
    return {
      success: true,
      response:
        `⚠️ *Delete Requirement?*\n\n` +
        `ID: \`${reqId}\`\n` +
        `Text: _${truncate(req.title, 50)}_\n\n` +
        `To confirm, run:\n` +
        `\`/${project.name} delete ${reqId} --force\``,
      parseMode: 'Markdown',
    };
  }

  // Delete the requirement
  const result = await deleteRequirement(project.path, reqId);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to delete requirement:\n${result.error ?? 'Unknown error'}`,
    };
  }

  return {
    success: true,
    response:
      `✅ *Requirement Deleted*\n\n` +
      `ID: \`${reqId}\``,
    parseMode: 'Markdown',
  };
}

/**
 * Get priority label
 */
function getPriorityLabel(priority: number): string {
  if (priority <= 3) return 'Low';
  if (priority <= 6) return 'Medium';
  if (priority <= 9) return 'High';
  return 'Critical';
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
