/**
 * Telegram Command Router
 *
 * Parse and route commands from Telegram messages.
 *
 * @module telegram/router
 */

import type { Context } from 'grammy';
import { getGlobalStore } from '../core/global-store.js';
import { getProjectRegistry } from '../core/project-registry.js';
import type { CommandContext, CommandDefinition, CommandResult } from './types.js';
import type { AuthorizedUser } from '../core/global-store.js';
import { hasRequiredRole } from './security.js';
import { sendTyping } from './utils/typing.js';
import { projectActionsKeyboard } from './keyboards.js';

// ============================================================================
// Command Registry
// ============================================================================

const commands = new Map<string, CommandDefinition>();

/**
 * Register a command handler
 */
export function registerCommand(definition: CommandDefinition): void {
  commands.set(definition.name.toLowerCase(), definition);
}

/**
 * Get all registered commands
 */
export function getCommands(): CommandDefinition[] {
  return Array.from(commands.values());
}

/**
 * Get command by name
 */
export function getCommand(name: string): CommandDefinition | undefined {
  return commands.get(name.toLowerCase());
}

// ============================================================================
// Command Parsing
// ============================================================================

interface ParsedCommand {
  command: string;
  projectName?: string | undefined;
  args: string[];
  quotedArg?: string | undefined;
}

/**
 * Parse a command message
 *
 * Supports formats:
 * - /command arg1 arg2
 * - /project subcommand arg1
 * - /project subcommand "quoted arg"
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();

  // Must start with /
  if (!trimmed.startsWith('/')) {
    return null;
  }

  // Remove leading /
  const content = trimmed.slice(1);

  // Check for quoted argument
  const quotedMatch = content.match(/"([^"]+)"/);
  const quotedArg = quotedMatch?.[1];

  // Remove quoted part for parsing
  const withoutQuoted = quotedArg
    ? content.replace(/"[^"]+"/g, '').trim()
    : content;

  // Split by whitespace
  const parts = withoutQuoted.split(/\s+/).filter(Boolean);

  const firstPart = parts[0];
  if (!firstPart) {
    return null;
  }

  const firstPartLower = firstPart.toLowerCase();

  // Check if first part is a project name
  const registry = getProjectRegistry();
  const project = registry.getProject(firstPartLower);

  if (project && parts.length > 1) {
    const secondPart = parts[1];
    if (!secondPart) {
      return null;
    }

    // Project-scoped command: /<project> <command> [args...]
    return {
      command: secondPart.toLowerCase(),
      projectName: project.name,
      args: parts.slice(2),
      quotedArg,
    };
  }

  // Global command: /<command> [args...]
  return {
    command: firstPartLower,
    projectName: undefined,
    args: parts.slice(1),
    quotedArg,
  };
}

// ============================================================================
// Command Routing
// ============================================================================

/**
 * Route a command to its handler
 */
export async function routeCommand(
  ctx: Context,
  user: AuthorizedUser
): Promise<CommandResult | null> {
  const text = ctx.message?.text;
  if (!text) return null;

  const parsed = parseCommand(text);
  if (!parsed) return null;

  // Find command handler
  const definition = getCommand(parsed.command);

  if (!definition) {
    // Check if it's a project name without a subcommand
    if (!parsed.projectName) {
      const registry = getProjectRegistry();
      const project = registry.getProject(parsed.command);

      if (project) {
        // Show project status as default with action buttons
        const card = formatProjectCard(project);
        return {
          success: true,
          response: card.text,
          parseMode: 'Markdown',
          keyboard: card.keyboard,
        };
      }
    }

    return {
      success: false,
      response: `Unknown command: /${parsed.command}\n\nUse /help to see available commands.`,
    };
  }

  // Check role requirement
  if (!hasRequiredRole(user.role, definition.requiredRole)) {
    return {
      success: false,
      response:
        `🚫 Permission denied.\n\n` +
        `This command requires ${definition.requiredRole} role or higher.\n` +
        `Your role: ${user.role}`,
    };
  }

  // Check project scope requirement
  if (definition.projectScoped && !parsed.projectName) {
    // Try to get active project from conversation state
    const store = getGlobalStore();
    const state = store.getConversationState(user.telegramId);

    if (state?.activeProject) {
      parsed.projectName = state.activeProject;
    } else {
      return {
        success: false,
        response:
          `This command requires a project.\n\n` +
          `Usage: /<project> ${parsed.command}\n` +
          `Or set an active project with /switch <project>`,
      };
    }
  }

  // Build command context
  const commandCtx: CommandContext = {
    ctx,
    command: parsed.command,
    projectName: parsed.projectName,
    args: parsed.args,
    quotedArg: parsed.quotedArg,
    user,
  };

  // Show typing indicator while processing
  await sendTyping(ctx);

  // Execute handler
  try {
    return await definition.handler(commandCtx);
  } catch (error) {
    console.error(`Command error (${parsed.command}):`, error);
    return {
      success: false,
      response: `❌ Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a project card for display
 */
function formatProjectCard(project: {
  name: string;
  path: string;
  alias?: string | null;
  status?: string;
}): { text: string; keyboard: ReturnType<typeof projectActionsKeyboard> } {
  const lines = [
    `━━━ *${project.name}* ━━━`,
    '',
    `📂 \`${project.path}\``,
  ];

  if (project.alias) {
    lines.push(`🏷 Alias: \`${project.alias}\``);
  }

  return {
    text: lines.join('\n'),
    keyboard: projectActionsKeyboard(project.name),
  };
}

// ============================================================================
// Built-in Commands
// ============================================================================

// These will be registered when handlers are created in Phase 3
// For now, just export the registration function

export function registerBuiltinCommands(): void {
  // Will be populated by handler modules
}
