/**
 * Init Flow Tests
 *
 * Tests for the project initialization flow.
 *
 * @module interactions/__tests__/flows/init.test
 */

import { describe, it, expect } from 'vitest';
import {
  initFlow,
  isInitAction,
  getInitAction,
  type InitFlowContext,
} from '../../flows/init.js';
import { createMockContext } from '../mocks/context.js';

describe('initFlow', () => {
  describe('flow metadata', () => {
    it('has correct id and name', () => {
      expect(initFlow.id).toBe('init');
      expect(initFlow.name).toBe('Initialize Project');
    });

    it('starts at init step', () => {
      expect(initFlow.firstStep).toBe('init');
    });
  });

  describe('init step', () => {
    it('shows progress indicator', () => {
      const ctx = createMockContext() as InitFlowContext;
      const interaction = initFlow.steps.init.interaction(ctx);

      expect(interaction.type).toBe('progress');
      expect(interaction.message).toContain('Initializing');
    });

    it('triggers init action', async () => {
      const ctx = createMockContext() as InitFlowContext;
      const result = await initFlow.steps.init.handle(null, ctx);

      expect(result).toBe('action:init_project');
    });
  });

  describe('init_complete step', () => {
    it('shows success message', () => {
      const ctx = createMockContext() as InitFlowContext;
      const interaction = initFlow.steps.init_complete.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('success');
      expect(interaction.message).toContain('initialized successfully');
    });

    it('shows MCP servers if enabled', () => {
      const ctx = createMockContext() as InitFlowContext;
      ctx.mcpServers = ['supabase', 'vercel'];

      const interaction = initFlow.steps.init_complete.interaction(ctx);

      expect(interaction.message).toContain('supabase');
      expect(interaction.message).toContain('vercel');
    });

    it('proceeds to ask_plan', async () => {
      const ctx = createMockContext() as InitFlowContext;
      const result = await initFlow.steps.init_complete.handle(null, ctx);

      expect(result).toBe('ask_plan');
    });
  });

  describe('ask_plan step', () => {
    it('shows confirmation prompt', () => {
      const ctx = createMockContext() as InitFlowContext;
      const interaction = initFlow.steps.ask_plan.interaction(ctx);

      expect(interaction.type).toBe('confirm');
      expect(interaction.message).toContain('planning');
    });

    it('navigates to plan flow on confirm', async () => {
      const ctx = createMockContext() as InitFlowContext;
      const result = await initFlow.steps.ask_plan.handle(true, ctx);

      expect(result).toBe('flow:plan');
    });

    it('returns null on cancel', async () => {
      const ctx = createMockContext() as InitFlowContext;
      const result = await initFlow.steps.ask_plan.handle(false, ctx);

      expect(result).toBeNull();
    });
  });

  describe('error step', () => {
    it('shows error message', () => {
      const ctx = createMockContext() as InitFlowContext;
      ctx.error = 'Init failed';

      const interaction = initFlow.steps.error.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('error');
      expect(interaction.message).toBe('Init failed');
    });

    it('clears error and exits', async () => {
      const ctx = createMockContext() as InitFlowContext;
      ctx.error = 'Some error';

      const result = await initFlow.steps.error.handle(null, ctx);

      expect(ctx.error).toBeUndefined();
      expect(result).toBeNull();
    });
  });
});

describe('isInitAction', () => {
  it('returns true for action markers', () => {
    expect(isInitAction('action:init_project')).toBe(true);
  });

  it('returns false for non-action results', () => {
    expect(isInitAction('menu')).toBe(false);
    expect(isInitAction(null)).toBe(false);
  });
});

describe('getInitAction', () => {
  it('extracts action name', () => {
    expect(getInitAction('action:init_project')).toBe('init_project');
  });
});
