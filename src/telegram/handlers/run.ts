/**
 * Run Handlers
 *
 * Handle run, stop, resume, and refresh commands.
 *
 * @module telegram/handlers/run
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import {
  stopConfirmKeyboard,
  daemonRunningKeyboard,
  runStartedKeyboard,
  requirementAddedKeyboard,
  projectActionsKeyboard,
} from '../keyboards.js';
import { startRun, stopDaemon, getProjectStatus, getDaemonStatus, resumeSession, refreshClaudeMd } from '../project-bridge.js';

/**
 * Handle run command
 */
export async function runHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Check if daemon is already running
  const daemonStatus = await getDaemonStatus(project.path);
  if (daemonStatus.running) {
    return {
      success: false,
      response:
        `⚠️ Daemon is already running for ${project.name}\n\n` +
        `PID: ${daemonStatus.pid}`,
      parseMode: 'Markdown',
      keyboard: daemonRunningKeyboard(project.name),
    };
  }

  // Check if there are pending requirements
  const status = await getProjectStatus(project.path);
  if (status.requirements.pending === 0 && status.requirements.inProgress === 0) {
    return {
      success: false,
      response: `⚠️ No pending requirements to run`,
      parseMode: 'Markdown',
      keyboard: requirementAddedKeyboard(project.name),
    };
  }

  // Start run in daemon mode
  const result = await startRun(project.path);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to start:\n\`\`\`\n${result.error ?? result.output}\n\`\`\``,
      parseMode: 'Markdown',
    };
  }

  return {
    success: true,
    response:
      `▶️ *Execution Started*\n\n` +
      `Project: ${project.name}\n` +
      `Pending: ${status.requirements.pending} requirements\n\n` +
      `The daemon is now running in the background.`,
    parseMode: 'Markdown',
    keyboard: runStartedKeyboard(project.name),
  };
}

/**
 * Handle stop command
 */
export async function stopHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Check if daemon is running
  const daemonStatus = await getDaemonStatus(project.path);
  if (!daemonStatus.running) {
    return {
      success: true,
      response: `⚪ No daemon running for ${project.name}`,
    };
  }

  // Check if --force or confirmation provided
  const force = args.includes('--force') || args.includes('-f');

  if (!force) {
    return {
      success: true,
      response:
        `⚠️ *Stop Daemon?*\n\n` +
        `Project: ${project.name}\n` +
        `PID: ${daemonStatus.pid}\n\n` +
        `This will interrupt any running jobs.`,
      keyboard: stopConfirmKeyboard(project.name),
    };
  }

  // Stop the daemon
  const result = await stopDaemon(project.path);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to stop daemon:\n${result.error ?? result.output}`,
    };
  }

  return {
    success: true,
    response: `⏹ Daemon stopped for ${project.name}`,
  };
}

/**
 * Handle resume command - resume interrupted session
 */
export async function resumeHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Check if daemon is already running
  const daemonStatus = await getDaemonStatus(project.path);
  if (daemonStatus.running) {
    return {
      success: false,
      response: `⚠️ Daemon is already running for ${project.name}`,
      parseMode: 'Markdown',
      keyboard: daemonRunningKeyboard(project.name),
    };
  }

  // Resume session
  const result = await resumeSession(project.path);

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to resume:\n${result.error ?? result.output}`,
    };
  }

  return {
    success: true,
    response:
      `🔄 *Session Resumed*\n\n` +
      `Project: ${project.name}\n\n` +
      `The daemon is resuming interrupted work.`,
    parseMode: 'Markdown',
    keyboard: runStartedKeyboard(project.name),
  };
}

/**
 * Handle refresh command - regenerate CLAUDE.md
 */
export async function refreshHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Parse options
  const injectSecrets = args.includes('--secrets');
  const env = args.find((a) => a.startsWith('--env='))?.split('=')[1] ?? 'development';

  // Refresh CLAUDE.md
  const result = await refreshClaudeMd(project.path, { injectSecrets, env });

  if (!result.success) {
    return {
      success: false,
      response: `❌ Failed to refresh:\n${result.error ?? result.output}`,
    };
  }

  return {
    success: true,
    response:
      `✅ *CLAUDE.md Regenerated*\n\n` +
      `Project: ${project.name}\n` +
      (injectSecrets ? `Environment: ${env}\n` : '') +
      `\nThe project context has been updated.`,
    parseMode: 'Markdown',
    keyboard: projectActionsKeyboard(project.name),
  };
}
