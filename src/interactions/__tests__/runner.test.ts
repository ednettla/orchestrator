/**
 * FlowRunner Unit Tests
 *
 * Tests for the core flow execution engine.
 *
 * @module interactions/__tests__/runner.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlowRunner, runFlowCli } from '../runner.js';
import { createMockRenderer, type MockRenderer } from './mocks/renderer.js';
import { createMockContext } from './mocks/context.js';
import {
  createSingleStepFlow,
  createLinearFlow,
  createMixedInteractionFlow,
  createEmptyFlow,
  createNullInteractionFlow,
  createFlowWithOnBack,
  createConditionalFlow,
} from './mocks/flow.js';
import type { FlowContext } from '../types.js';

describe('FlowRunner', () => {
  let renderer: MockRenderer;
  let ctx: FlowContext;

  beforeEach(() => {
    renderer = createMockRenderer();
    ctx = createMockContext();
  });

  describe('constructor', () => {
    it('initializes with correct first step', () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      expect(runner.getCurrentStepId()).toBe('step1');
    });

    it('stores the provided context', () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      expect(runner.getContext()).toBe(ctx);
    });
  });

  describe('getContext', () => {
    it('returns current context', () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const result = runner.getContext();

      expect(result).toBe(ctx);
      expect(result.projectPath).toBe('/test/project');
    });
  });

  describe('updateContext', () => {
    it('merges partial updates into context', () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      runner.updateContext({ projectName: 'updated-name' });

      expect(runner.getContext().projectName).toBe('updated-name');
      expect(runner.getContext().projectPath).toBe('/test/project'); // Unchanged
    });

    it('overwrites existing values', () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      runner.updateContext({
        requirements: { pending: 5, inProgress: 1, completed: 0, failed: 0 },
      });

      expect(runner.getContext().requirements.pending).toBe(5);
    });
  });

  describe('getCurrentStepId', () => {
    it('returns the current step ID', () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);

      expect(runner.getCurrentStepId()).toBe('step1');
    });
  });

  describe('getCurrentStep', () => {
    it('returns the current step definition', () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const step = runner.getCurrentStep();

      expect(step).not.toBeNull();
      expect(step?.id).toBe('step1');
    });

    it('returns null for nonexistent step', () => {
      const flow = createEmptyFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const step = runner.getCurrentStep();

      expect(step).toBeNull();
    });
  });

  describe('canGoBack', () => {
    it('returns false when no history', () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      expect(runner.canGoBack()).toBe(false);
    });

    it('returns true after navigating forward', async () => {
      const flow = createLinearFlow(3);
      renderer.selectResponses = ['next'];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('next');

      expect(runner.canGoBack()).toBe(true);
    });
  });

  describe('runCurrentStep', () => {
    it('renders select interaction', async () => {
      const flow = createSingleStepFlow();
      renderer.selectResponses = ['opt1'];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();

      expect(renderer.callCounts.select).toBe(1);
      expect(renderer.displayedMessages).toContain('Test message');
    });

    it('renders input interaction', async () => {
      const flow = createMixedInteractionFlow();
      renderer.selectResponses = ['input'];
      renderer.inputResponses = ['test input'];
      const runner = new FlowRunner(flow, renderer, ctx);

      // First select
      await runner.runCurrentStep();
      await runner.handleResponse('input');

      // Now at input step
      await runner.runCurrentStep();

      expect(renderer.callCounts.input).toBe(1);
      expect(renderer.displayedMessages).toContain('Enter some text');
    });

    it('renders confirm interaction', async () => {
      const flow = createMixedInteractionFlow();
      renderer.selectResponses = ['confirm'];
      renderer.confirmResponses = [true];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('confirm');
      await runner.runCurrentStep();

      expect(renderer.callCounts.confirm).toBe(1);
      expect(renderer.displayedMessages).toContain('Are you sure?');
    });

    it('renders progress interaction', async () => {
      const flow = createMixedInteractionFlow();
      renderer.selectResponses = ['progress'];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('progress');
      const response = await runner.runCurrentStep();

      expect(renderer.callCounts.progress).toBe(1);
      expect(renderer.progressMessages).toContain('Loading...');
      expect(response).toHaveProperty('update');
    });

    it('renders display interaction', async () => {
      const flow = createMixedInteractionFlow();
      renderer.selectResponses = ['display'];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('display');
      await runner.runCurrentStep();

      expect(renderer.callCounts.display).toBe(1);
      expect(renderer.displayedMessages).toContain('This is a message');
    });

    it('returns null for null interaction', async () => {
      const flow = createNullInteractionFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const response = await runner.runCurrentStep();

      expect(response).toBeNull();
    });

    it('returns null for nonexistent step', async () => {
      const flow = createEmptyFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const response = await runner.runCurrentStep();

      expect(response).toBeNull();
    });
  });

  describe('handleResponse', () => {
    it('advances to next step on valid response', async () => {
      const flow = createLinearFlow(3);
      renderer.selectResponses = ['next', 'next'];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      const result = await runner.handleResponse('next');

      expect(result.done).toBe(false);
      expect(runner.getCurrentStepId()).toBe('step2');
    });

    it('returns done=true when handler returns null', async () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const result = await runner.handleResponse('any');

      expect(result.done).toBe(true);
    });

    it('handles "back" response', async () => {
      const flow = createLinearFlow(3);
      renderer.selectResponses = ['next', 'back'];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('next');
      expect(runner.getCurrentStepId()).toBe('step2');

      const result = await runner.handleResponse('back');

      expect(result.done).toBe(false);
      expect(runner.getCurrentStepId()).toBe('step1');
    });

    it('handles "__back__" response (Telegram format)', async () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('next');

      const result = await runner.handleResponse('__back__');

      expect(result.done).toBe(false);
      expect(runner.getCurrentStepId()).toBe('step1');
    });

    it('exits flow when going back with no history', async () => {
      const flow = createSingleStepFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const result = await runner.handleResponse('back');

      expect(result.done).toBe(true);
    });

    it('calls onBack hook when going back', async () => {
      const flow = createFlowWithOnBack();
      const typedCtx = ctx as FlowContext & { cleanupCalled?: boolean };
      const runner = new FlowRunner(flow, renderer, typedCtx);

      // Navigate forward to step2
      await runner.handleResponse('next');
      expect(runner.getCurrentStepId()).toBe('step2');

      // Go back - should call onBack on step1
      await runner.handleResponse('back');

      expect(typedCtx.cleanupCalled).toBe(true);
    });

    it('updates step history on forward navigation', async () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.handleResponse('next');
      await runner.handleResponse('next');

      expect(runner.canGoBack()).toBe(true);
      expect(runner.getCurrentStepId()).toBe('step3');
    });

    it('returns error when step handler throws', async () => {
      const flow = createSingleStepFlow({
        handle: async () => {
          throw new Error('Handler error');
        },
      });
      const runner = new FlowRunner(flow, renderer, ctx);

      const result = await runner.handleResponse('any');

      expect(result.done).toBe(false);
      expect(result.error).toBe('Handler error');
    });

    it('returns error for nonexistent current step', async () => {
      const flow = createEmptyFlow();
      const runner = new FlowRunner(flow, renderer, ctx);

      const result = await runner.handleResponse('any');

      expect(result.done).toBe(true);
      expect(result.error).toBe('No current step');
    });
  });

  describe('navigateTo', () => {
    it('navigates to existing step', () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);

      const result = runner.navigateTo('step3');

      expect(result).toBe(true);
      expect(runner.getCurrentStepId()).toBe('step3');
    });

    it('returns false for nonexistent step', () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = runner.navigateTo('nonexistent');

      expect(result).toBe(false);
      expect(runner.getCurrentStepId()).toBe('step1'); // Unchanged
      consoleSpy.mockRestore();
    });

    it('adds current step to history', () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);

      runner.navigateTo('step3');

      expect(runner.canGoBack()).toBe(true);
    });
  });

  describe('toSession / fromSession', () => {
    it('serializes current state', () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);
      runner.navigateTo('step2');

      const session = runner.toSession();

      expect(session.flowId).toBe('linear-flow');
      expect(session.currentStepId).toBe('step2');
      expect(session.stepHistory).toContain('step1');
      expect(session.context).toBe(ctx);
      expect(session.startedAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
    });

    it('restores state from session', () => {
      const flow = createLinearFlow(3);
      const runner = new FlowRunner(flow, renderer, ctx);
      runner.navigateTo('step2');

      const session = runner.toSession();
      const restored = FlowRunner.fromSession(session, flow, renderer);

      expect(restored.getCurrentStepId()).toBe('step2');
      expect(restored.canGoBack()).toBe(true);
      expect(restored.getContext()).toEqual(ctx);
    });

    it('round-trips correctly', () => {
      const flow = createLinearFlow(5);
      const runner = new FlowRunner(flow, renderer, ctx);
      runner.navigateTo('step2');
      runner.navigateTo('step3');
      runner.navigateTo('step4');

      const session = runner.toSession();
      const restored = FlowRunner.fromSession(session, flow, renderer);

      expect(restored.getCurrentStepId()).toBe(runner.getCurrentStepId());
      expect(restored.canGoBack()).toBe(runner.canGoBack());
    });
  });

  describe('conditional options', () => {
    it('shows project options when has project', () => {
      const flow = createConditionalFlow();
      const projectCtx = createMockContext({ hasProject: true });
      const runner = new FlowRunner(flow, renderer, projectCtx);

      const step = runner.getCurrentStep();
      const interaction = step?.interaction(projectCtx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'project')).toBe(true);
      }
    });

    it('hides project options when no project', () => {
      const flow = createConditionalFlow();
      const noProjectCtx = createMockContext({ hasProject: false });
      const runner = new FlowRunner(flow, renderer, noProjectCtx);

      const step = runner.getCurrentStep();
      const interaction = step?.interaction(noProjectCtx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'project')).toBe(false);
      }
    });

    it('shows daemon options when daemon running', () => {
      const flow = createConditionalFlow();
      const daemonCtx = createMockContext({
        daemon: { running: true, pid: 123 },
      });
      const runner = new FlowRunner(flow, renderer, daemonCtx);

      const step = runner.getCurrentStep();
      const interaction = step?.interaction(daemonCtx);

      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'daemon')).toBe(true);
      }
    });

    it('shows run option with pending count', () => {
      const flow = createConditionalFlow();
      const reqCtx = createMockContext({
        requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
      });
      const runner = new FlowRunner(flow, renderer, reqCtx);

      const step = runner.getCurrentStep();
      const interaction = step?.interaction(reqCtx);

      if (interaction?.type === 'select') {
        const runOption = interaction.options.find((o) => o.id === 'run');
        expect(runOption).toBeDefined();
        expect(runOption?.label).toContain('5 pending');
      }
    });
  });

  describe('progress handle in handlers', () => {
    it('passes progress handle to step handler', async () => {
      const flow = createMixedInteractionFlow();
      renderer.selectResponses = ['progress'];
      const runner = new FlowRunner(flow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('progress');
      const response = await runner.runCurrentStep();
      await runner.handleResponse(response);

      // The handler called succeed
      expect(renderer.progressMessages).toContain('✓ Done!');
    });
  });
});

describe('runFlowCli', () => {
  it('runs flow to completion', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['opt1'];
    const ctx = createMockContext();
    const flow = createSingleStepFlow();

    const result = await runFlowCli(flow, renderer, ctx);

    expect(result).toBe(ctx);
    expect(renderer.callCounts.select).toBe(1);
  });

  it('handles multi-step flow', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['next', 'next', 'next'];
    const ctx = createMockContext();
    const flow = createLinearFlow(3);

    await runFlowCli(flow, renderer, ctx);

    expect(renderer.callCounts.select).toBe(3);
  });

  it('handles back navigation in loop', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['next', 'back', 'next', 'next', 'next'];
    const ctx = createMockContext();
    const flow = createLinearFlow(3);

    await runFlowCli(flow, renderer, ctx);

    expect(renderer.callCounts.select).toBe(5);
  });
});
