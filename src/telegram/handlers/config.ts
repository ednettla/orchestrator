/**
 * Config Handlers
 *
 * Handle config, mcp, and secrets commands.
 *
 * @module telegram/handlers/config
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { createSecretsManager } from '../../core/secrets-manager.js';
import { configMenuKeyboard } from '../keyboards.js';

/**
 * Handle config command
 */
export async function configHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Build config summary
  const lines = [
    `⚙️ *Configuration*\n`,
    `*Project:* ${project.name}`,
    `*Path:* \`${project.path}\``,
    '',
  ];

  // Tech stack
  if (project.techStack) {
    lines.push('*Tech Stack:*');
    if (project.techStack.frontend) {
      lines.push(`  • Frontend: ${project.techStack.frontend}`);
    }
    if (project.techStack.backend) {
      lines.push(`  • Backend: ${project.techStack.backend}`);
    }
    if (project.techStack.database) {
      lines.push(`  • Database: ${project.techStack.database}`);
    }
    lines.push('');
  }

  // Cloud services
  if (project.cloudServices) {
    lines.push('*Cloud Services:*');
    if (project.cloudServices.github) {
      lines.push(`  • GitHub: ${project.cloudServices.github}`);
    }
    if (project.cloudServices.supabase) {
      lines.push(`  • Supabase: ${project.cloudServices.supabase}`);
    }
    if (project.cloudServices.vercel) {
      lines.push(`  • Vercel: ${project.cloudServices.vercel}`);
    }
    lines.push('');
  }

  // Secrets summary
  try {
    const secrets = createSecretsManager(project.path);
    const counts = secrets.getSecretCounts();
    lines.push('*Secrets:*');
    lines.push(`  • Development: ${counts.development}`);
    lines.push(`  • Staging: ${counts.staging}`);
    lines.push(`  • Production: ${counts.production}`);
  } catch {
    // Ignore if secrets manager fails
  }

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
    keyboard: configMenuKeyboard(project.name),
  };
}

/**
 * Handle mcp command
 */
export async function mcpHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // TODO: Get actual MCP config
  // For now, return placeholder
  const lines = [
    `🔌 *MCP Servers*\n`,
    `*Project:* ${project.name}\n`,
    '*Enabled:*',
    '  • claude-in-chrome',
    '',
    '*Available:*',
    '  • supabase',
    '  • vercel',
    '',
    'Manage MCP servers on the server with:',
    '`orchestrate mcp list`',
    '`orchestrate mcp enable <server>`',
  ];

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
  };
}

/**
 * Handle secrets command
 */
export async function secretsHandler(ctx: CommandContext): Promise<CommandResult> {
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

  // Get environment filter
  const envFilter = args[0]?.toLowerCase();
  const validEnvs = ['development', 'staging', 'production'];

  if (envFilter && !validEnvs.includes(envFilter)) {
    return {
      success: false,
      response:
        `Invalid environment: \`${envFilter}\`\n\n` +
        `Valid environments: development, staging, production`,
      parseMode: 'Markdown',
    };
  }

  try {
    const secrets = createSecretsManager(project.path);
    const lines = [`🔐 *Secrets*\n`, `*Project:* ${project.name}\n`];

    const environments = envFilter
      ? [envFilter as 'development' | 'staging' | 'production']
      : validEnvs as Array<'development' | 'staging' | 'production'>;

    for (const env of environments) {
      const keys = secrets.listSecretKeys(env);

      if (keys.length === 0) {
        lines.push(`*${env}:* _(empty)_`);
      } else {
        lines.push(`*${env}:*`);
        for (const key of keys.slice(0, 10)) {
          const def = secrets.getSecretDefinition(env, key);
          const service = def?.service ? ` [${def.service}]` : '';
          lines.push(`  • ${key}${service}`);
        }
        if (keys.length > 10) {
          lines.push(`  _...and ${keys.length - 10} more_`);
        }
      }
      lines.push('');
    }

    lines.push('_Values hidden. Manage secrets on server with:_');
    lines.push('`orchestrate secrets list`');

    return {
      success: true,
      response: lines.join('\n'),
      parseMode: 'Markdown',
    };
  } catch (error) {
    return {
      success: false,
      response: `Failed to load secrets: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
