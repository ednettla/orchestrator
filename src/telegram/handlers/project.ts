/**
 * Project Handlers
 *
 * Handle /projects, /switch, and /new commands.
 *
 * @module telegram/handlers/project
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { getGlobalStore } from '../../core/global-store.js';
import { projectSelectionKeyboard } from '../keyboards.js';
import { startProjectWizard } from '../flows/project-wizard.js';

/**
 * Handle /projects command
 */
export async function projectsHandler(_ctx: CommandContext): Promise<CommandResult> {
  const registry = getProjectRegistry();
  const projects = registry.listProjects({ status: 'active', limit: 20 });

  if (projects.length === 0) {
    return {
      success: true,
      response:
        '📂 *No projects found*\n\n' +
        'Initialize a project with:\n' +
        '`orchestrate init /path/to/project`\n\n' +
        'Or create a new one with:\n' +
        '`/new myproject`',
      parseMode: 'Markdown',
    };
  }

  const lines = ['📂 *Projects*\n'];

  for (const project of projects) {
    const alias = project.alias ? ` _(${project.alias})_` : '';
    const stack = [
      project.techStack?.frontend,
      project.techStack?.backend,
      project.techStack?.database,
    ]
      .filter(Boolean)
      .join(' + ');

    lines.push(`• *${project.name}*${alias}`);
    if (stack) {
      lines.push(`  ${stack}`);
    }
    lines.push(`  \`${project.path}\``);
    lines.push('');
  }

  const keyboard = projectSelectionKeyboard(
    projects.map((p) => ({ name: p.name, alias: p.alias ?? undefined }))
  );

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
    keyboard,
  };
}

/**
 * Handle /switch command
 */
export async function switchHandler(ctx: CommandContext): Promise<CommandResult> {
  const { args, user } = ctx;

  if (args.length === 0) {
    // Show project picker
    const registry = getProjectRegistry();
    const projects = registry.listProjects({ status: 'active', limit: 10 });

    if (projects.length === 0) {
      return {
        success: false,
        response: 'No projects found. Create one with `/new <name>`',
        parseMode: 'Markdown',
      };
    }

    const keyboard = projectSelectionKeyboard(
      projects.map((p) => ({ name: p.name, alias: p.alias ?? undefined }))
    );

    return {
      success: true,
      response: 'Select a project to set as active:',
      keyboard,
    };
  }

  const projectName = args.join(' ');
  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: \`${projectName}\`\n\nUse /projects to see available projects.`,
      parseMode: 'Markdown',
    };
  }

  // Update conversation state
  const store = getGlobalStore();
  store.setConversationState(user.telegramId, {
    activeProject: project.name,
  });

  return {
    success: true,
    response:
      `✅ Active project set to *${project.name}*\n\n` +
      `You can now use commands without the project prefix:\n` +
      `• \`/status\` instead of \`/${project.name} status\`\n` +
      `• \`/plan "goal"\` instead of \`/${project.name} plan "goal"\``,
    parseMode: 'Markdown',
  };
}

/**
 * Handle /new command
 *
 * Starts an interactive wizard for project creation.
 */
export async function newProjectHandler(ctx: CommandContext): Promise<CommandResult> {
  const { args, quotedArg } = ctx;

  const rawName = quotedArg ?? args.join(' ');
  const projectName = rawName || undefined;

  // Start the wizard (it handles validation internally)
  await startProjectWizard(ctx.ctx, projectName);

  // Return empty result since wizard handles all responses
  return {
    success: true,
    response: '', // Wizard sends its own messages
    skipReply: true,
  };
}
