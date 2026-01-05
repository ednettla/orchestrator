/**
 * Menu Command Handler
 *
 * Starts the unified interactive menu flow.
 *
 * @module telegram/handlers/menu
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { startMainMenuFlow } from '../../interactions/index.js';

/**
 * Handle /menu command - starts the unified interactive menu
 */
export async function menuHandler(ctx: CommandContext): Promise<CommandResult> {
  const registry = getProjectRegistry();
  const projects = registry.listProjects();

  // Get active project path (or first project, or cwd)
  let projectPath: string;

  if (ctx.projectName) {
    // Project specified in command
    const project = registry.getProject(ctx.projectName);
    if (project) {
      projectPath = project.path;
    } else {
      return {
        success: false,
        response: `Project not found: ${ctx.projectName}`,
      };
    }
  } else if (projects.length > 0 && projects[0]) {
    // Use first project
    projectPath = projects[0].path;
  } else {
    // No projects - use current working directory
    projectPath = process.cwd();
  }

  // Start the unified flow
  try {
    await startMainMenuFlow(ctx.ctx, projectPath, ctx.user.role);

    return {
      success: true,
      response: '',
      skipReply: true, // Flow handles its own messages
    };
  } catch (error) {
    return {
      success: false,
      response: `Failed to start menu: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
