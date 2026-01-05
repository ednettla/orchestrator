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
import { createProject } from '../project-bridge.js';

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
 */
export async function newProjectHandler(ctx: CommandContext): Promise<CommandResult> {
  const { args, quotedArg } = ctx;

  const projectName = quotedArg ?? args.join(' ');

  if (!projectName) {
    return {
      success: false,
      response:
        'Usage: `/new <project-name>`\n\n' +
        'Example: `/new my-awesome-app`\n\n' +
        'This will create a new directory and initialize the project.',
      parseMode: 'Markdown',
    };
  }

  // Validate project name
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(projectName)) {
    return {
      success: false,
      response:
        'Invalid project name.\n\n' +
        'Project names must:\n' +
        '• Start with a letter\n' +
        '• Contain only letters, numbers, hyphens, and underscores',
    };
  }

  // Check if project already exists
  const registry = getProjectRegistry();
  const existing = registry.getProject(projectName);

  if (existing) {
    return {
      success: false,
      response: `A project named \`${projectName}\` already exists.\n\nPath: \`${existing.path}\``,
      parseMode: 'Markdown',
    };
  }

  // Get the projects directory from global store
  const store = getGlobalStore();
  const basePath = store.getProjectsDirectory();

  // Create the project
  const result = await createProject(basePath, projectName);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to create project:\n${result.error}`,
    };
  }

  return {
    success: true,
    response:
      `✅ *Project Created*\n\n` +
      `Name: ${projectName}\n` +
      `Path: \`${result.projectPath}\`\n\n` +
      `Use \`/${projectName} status\` to check project status.\n` +
      `Use \`/${projectName} add \"requirement\"\` to add requirements.`,
    parseMode: 'Markdown',
  };
}
