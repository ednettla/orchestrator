/**
 * Config Flow
 *
 * Unified configuration flow for CLI and Telegram.
 * Handles project settings, MCP servers, and worktrees.
 *
 * @module interactions/flows/config
 */

import type { Flow, FlowContext, SelectOption } from '../types.js';

/**
 * Extended context for config flow
 */
export interface ConfigFlowContext extends FlowContext {
  /** Selected action */
  selectedAction?: string;
}

/**
 * Build config menu options based on context
 */
function buildConfigMenuOptions(ctx: ConfigFlowContext): SelectOption[] {
  const options: SelectOption[] = [];

  if (ctx.hasProject) {
    options.push({
      id: 'project_settings',
      label: 'Project settings',
      icon: '⚙️',
      description: 'Edit project configuration',
    });
  }

  options.push({
    id: 'mcp_servers',
    label: 'MCP servers',
    icon: '🔌',
    description: 'Manage MCP integrations',
  });

  if (ctx.hasProject) {
    options.push({
      id: 'worktrees',
      label: 'Git worktrees',
      icon: '🌳',
      description: 'Manage parallel branches',
    });
  }

  options.push({ id: 'back', label: 'Back to main menu', icon: '←' });

  return options;
}

/**
 * Config flow definition
 */
export const configFlow: Flow<ConfigFlowContext> = {
  id: 'config',
  name: 'Configuration',
  firstStep: 'menu',

  steps: {
    // ========================================================================
    // Config Menu
    // ========================================================================
    menu: {
      id: 'menu',
      interaction: (ctx) => ({
        type: 'select',
        message: 'Configuration',
        options: buildConfigMenuOptions(ctx),
      }),
      handle: async (response, ctx) => {
        ctx.selectedAction = response as string;

        switch (response) {
          case 'project_settings':
            return 'action:project_settings';
          case 'mcp_servers':
            return 'flow:mcp'; // Navigate to MCP flow
          case 'worktrees':
            return 'flow:worktrees'; // Navigate to worktrees flow
          case 'back':
            return null;
          default:
            return 'menu';
        }
      },
    },
  },
};

/**
 * MCP servers flow definition
 */
export const mcpFlow: Flow<ConfigFlowContext> = {
  id: 'mcp',
  name: 'MCP Servers',
  firstStep: 'menu',

  steps: {
    menu: {
      id: 'menu',
      interaction: () => ({
        type: 'select',
        message: 'MCP Servers',
        options: [
          { id: 'list', label: 'List servers', icon: '📋' },
          { id: 'add', label: 'Add a server', icon: '➕' },
          { id: 'enable', label: 'Enable/disable server', icon: '🔘' },
          { id: 'remove', label: 'Remove a server', icon: '🗑️' },
          { id: 'back', label: 'Back', icon: '←' },
        ],
      }),
      handle: async (response) => {
        switch (response) {
          case 'list':
            return 'action:list_mcp';
          case 'add':
            return 'add_name';
          case 'enable':
            return 'action:toggle_mcp';
          case 'remove':
            return 'action:remove_mcp';
          case 'back':
            return null;
          default:
            return 'menu';
        }
      },
    },

    // ========================================================================
    // Add MCP Server
    // ========================================================================
    add_name: {
      id: 'add_name',
      interaction: () => ({
        type: 'input',
        message: 'Server name:',
        placeholder: 'e.g., supabase, vercel',
        validate: (value) => (value.length > 0 ? null : 'Name is required'),
      }),
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') {
          return 'menu';
        }
        (ctx as any).mcpServerName = response;
        return 'add_transport';
      },
    },

    add_transport: {
      id: 'add_transport',
      interaction: () => ({
        type: 'select',
        message: 'Transport type:',
        options: [
          { id: 'stdio', label: 'stdio', description: 'Local process' },
          { id: 'http', label: 'http', description: 'HTTP endpoint' },
          { id: 'sse', label: 'sse', description: 'Server-sent events' },
          { id: 'back', label: 'Cancel', icon: '←' },
        ],
      }),
      handle: async (response, ctx) => {
        if (response === 'back') {
          return 'menu';
        }
        (ctx as any).mcpTransport = response;

        if (response === 'stdio') {
          return 'add_command';
        }
        return 'add_url';
      },
    },

    add_command: {
      id: 'add_command',
      interaction: () => ({
        type: 'input',
        message: 'Command to run:',
        placeholder: 'npx',
      }),
      handle: async (response, ctx) => {
        (ctx as any).mcpCommand = response ?? 'npx';
        return 'add_args';
      },
    },

    add_args: {
      id: 'add_args',
      interaction: () => ({
        type: 'input',
        message: 'Arguments (space-separated):',
        placeholder: '-y @supabase/mcp-server',
      }),
      handle: async (response, ctx) => {
        (ctx as any).mcpArgs = response ?? '';
        return 'add_confirm';
      },
    },

    add_url: {
      id: 'add_url',
      interaction: () => ({
        type: 'input',
        message: 'Server URL:',
        placeholder: 'https://...',
        validate: (value) => (value.length > 0 ? null : 'URL is required'),
      }),
      handle: async (response, ctx) => {
        if (!response || typeof response !== 'string') {
          return 'add_transport';
        }
        (ctx as any).mcpUrl = response;
        return 'add_confirm';
      },
    },

    add_confirm: {
      id: 'add_confirm',
      interaction: (ctx) => {
        const name = (ctx as any).mcpServerName;
        const transport = (ctx as any).mcpTransport;

        return {
          type: 'confirm',
          message: `Add MCP server "${name}" (${transport})?`,
          confirmLabel: 'Add',
          cancelLabel: 'Cancel',
        };
      },
      handle: async (response) => {
        if (response) {
          return 'action:add_mcp';
        }
        return 'menu';
      },
    },
  },
};

/**
 * Check if a step result is an action marker
 */
export function isConfigAction(result: string | null): boolean {
  return result !== null && result.startsWith('action:');
}

/**
 * Get action name from action marker
 */
export function getConfigAction(result: string): string {
  return result.replace('action:', '');
}
