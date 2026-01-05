/**
 * Config Flow Tests
 *
 * Tests for the configuration and MCP flows.
 *
 * @module interactions/__tests__/flows/config.test
 */

import { describe, it, expect } from 'vitest';
import { configFlow, mcpFlow, isConfigAction, getConfigAction } from '../../flows/config.js';
import { createMockContext } from '../mocks/context.js';
import type { ConfigFlowContext } from '../../flows/config.js';

describe('configFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(configFlow.id).toBe('config');
    });

    it('has correct first step', () => {
      expect(configFlow.firstStep).toBe('menu');
    });

    it('has menu step', () => {
      expect(configFlow.steps.menu).toBeDefined();
    });
  });

  describe('menu step', () => {
    describe('interaction', () => {
      it('shows project_settings when has project', () => {
        const ctx = createMockContext({ hasProject: true }) as ConfigFlowContext;
        const interaction = configFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'project_settings')).toBe(true);
        }
      });

      it('hides project_settings when no project', () => {
        const ctx = createMockContext({ hasProject: false }) as ConfigFlowContext;
        const interaction = configFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'project_settings')).toBe(false);
        }
      });

      it('always shows mcp_servers option', () => {
        const ctx = createMockContext() as ConfigFlowContext;
        const interaction = configFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'mcp_servers')).toBe(true);
        }
      });

      it('shows worktrees when has project', () => {
        const ctx = createMockContext({ hasProject: true }) as ConfigFlowContext;
        const interaction = configFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'worktrees')).toBe(true);
        }
      });

      it('hides worktrees when no project', () => {
        const ctx = createMockContext({ hasProject: false }) as ConfigFlowContext;
        const interaction = configFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'worktrees')).toBe(false);
        }
      });

      it('always shows back option', () => {
        const ctx = createMockContext() as ConfigFlowContext;
        const interaction = configFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'back')).toBe(true);
        }
      });
    });

    describe('handler', () => {
      it('returns action:project_settings on project_settings', async () => {
        const ctx = createMockContext() as ConfigFlowContext;
        const result = await configFlow.steps.menu.handle('project_settings', ctx);
        expect(result).toBe('action:project_settings');
      });

      it('returns flow:mcp on mcp_servers', async () => {
        const ctx = createMockContext() as ConfigFlowContext;
        const result = await configFlow.steps.menu.handle('mcp_servers', ctx);
        expect(result).toBe('flow:mcp');
      });

      it('returns flow:worktrees on worktrees', async () => {
        const ctx = createMockContext() as ConfigFlowContext;
        const result = await configFlow.steps.menu.handle('worktrees', ctx);
        expect(result).toBe('flow:worktrees');
      });

      it('returns null on back', async () => {
        const ctx = createMockContext() as ConfigFlowContext;
        const result = await configFlow.steps.menu.handle('back', ctx);
        expect(result).toBeNull();
      });

      it('sets selectedAction on context', async () => {
        const ctx = createMockContext() as ConfigFlowContext;
        await configFlow.steps.menu.handle('mcp_servers', ctx);
        expect(ctx.selectedAction).toBe('mcp_servers');
      });
    });
  });
});

describe('mcpFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(mcpFlow.id).toBe('mcp');
    });

    it('has correct first step', () => {
      expect(mcpFlow.firstStep).toBe('menu');
    });

    it('has all expected steps', () => {
      const stepIds = Object.keys(mcpFlow.steps);
      expect(stepIds).toContain('menu');
      expect(stepIds).toContain('add_name');
      expect(stepIds).toContain('add_transport');
      expect(stepIds).toContain('add_command');
      expect(stepIds).toContain('add_args');
      expect(stepIds).toContain('add_url');
      expect(stepIds).toContain('add_confirm');
    });
  });

  describe('menu step', () => {
    it('shows all MCP management options', () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const interaction = mcpFlow.steps.menu.interaction(ctx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'list')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'add')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'enable')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'remove')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'back')).toBe(true);
      }
    });

    it('returns action:list_mcp on list', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.menu.handle('list', ctx);
      expect(result).toBe('action:list_mcp');
    });

    it('navigates to add_name on add', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.menu.handle('add', ctx);
      expect(result).toBe('add_name');
    });

    it('returns action:toggle_mcp on enable', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.menu.handle('enable', ctx);
      expect(result).toBe('action:toggle_mcp');
    });

    it('returns action:remove_mcp on remove', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.menu.handle('remove', ctx);
      expect(result).toBe('action:remove_mcp');
    });

    it('returns null on back', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.menu.handle('back', ctx);
      expect(result).toBeNull();
    });
  });

  describe('add_name step', () => {
    it('shows input interaction', () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const interaction = mcpFlow.steps.add_name.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.placeholder).toContain('supabase');
    });

    it('sets name and navigates to add_transport', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_name.handle('my-server', ctx);

      expect(ctx.mcpServerName).toBe('my-server');
      expect(result).toBe('add_transport');
    });

    it('returns to menu on empty input', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_name.handle('', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('add_transport step', () => {
    it('shows transport options', () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const interaction = mcpFlow.steps.add_transport.interaction(ctx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'stdio')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'http')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'sse')).toBe(true);
      }
    });

    it('sets transport and navigates to add_command for stdio', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_transport.handle('stdio', ctx);

      expect(ctx.mcpTransport).toBe('stdio');
      expect(result).toBe('add_command');
    });

    it('sets transport and navigates to add_url for http', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_transport.handle('http', ctx);

      expect(ctx.mcpTransport).toBe('http');
      expect(result).toBe('add_url');
    });

    it('sets transport and navigates to add_url for sse', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_transport.handle('sse', ctx);

      expect(ctx.mcpTransport).toBe('sse');
      expect(result).toBe('add_url');
    });

    it('returns to menu on back', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_transport.handle('back', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('add_command step', () => {
    it('shows input with npx placeholder', () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const interaction = mcpFlow.steps.add_command.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.placeholder).toBe('npx');
    });

    it('sets command and navigates to add_args', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_command.handle('node', ctx);

      expect(ctx.mcpCommand).toBe('node');
      expect(result).toBe('add_args');
    });

    it('defaults to npx on empty input', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      await mcpFlow.steps.add_command.handle(null, ctx);
      expect(ctx.mcpCommand).toBe('npx');
    });
  });

  describe('add_args step', () => {
    it('shows input for arguments', () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const interaction = mcpFlow.steps.add_args.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.placeholder).toContain('supabase');
    });

    it('sets args and navigates to add_confirm', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_args.handle('-y @vercel/mcp-server', ctx);

      expect(ctx.mcpArgs).toBe('-y @vercel/mcp-server');
      expect(result).toBe('add_confirm');
    });

    it('defaults to empty string on null', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      await mcpFlow.steps.add_args.handle(null, ctx);
      expect(ctx.mcpArgs).toBe('');
    });
  });

  describe('add_url step', () => {
    it('shows input for URL', () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const interaction = mcpFlow.steps.add_url.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.placeholder).toContain('https://');
    });

    it('sets url and navigates to add_confirm', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_url.handle('https://api.example.com', ctx);

      expect(ctx.mcpUrl).toBe('https://api.example.com');
      expect(result).toBe('add_confirm');
    });

    it('returns to add_transport on empty input', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_url.handle('', ctx);
      expect(result).toBe('add_transport');
    });
  });

  describe('add_confirm step', () => {
    it('shows server name and transport in message', () => {
      const ctx = createMockContext() as ConfigFlowContext;
      ctx.mcpServerName = 'vercel';
      ctx.mcpTransport = 'stdio';
      const interaction = mcpFlow.steps.add_confirm.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.message).toContain('vercel');
      expect(interaction?.message).toContain('stdio');
    });

    it('returns action:add_mcp on confirm', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_confirm.handle(true, ctx);
      expect(result).toBe('action:add_mcp');
    });

    it('returns to menu on cancel', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await mcpFlow.steps.add_confirm.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });
});

describe('utility functions', () => {
  describe('isConfigAction', () => {
    it('returns true for action markers', () => {
      expect(isConfigAction('action:project_settings')).toBe(true);
      expect(isConfigAction('action:add_mcp')).toBe(true);
    });

    it('returns false for non-action markers', () => {
      expect(isConfigAction('menu')).toBe(false);
      expect(isConfigAction('flow:config')).toBe(false);
      expect(isConfigAction(null)).toBe(false);
    });
  });

  describe('getConfigAction', () => {
    it('extracts action name', () => {
      expect(getConfigAction('action:project_settings')).toBe('project_settings');
      expect(getConfigAction('action:add_mcp')).toBe('add_mcp');
    });
  });
});
