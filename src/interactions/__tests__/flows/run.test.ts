/**
 * Run Flow Tests
 *
 * Tests for the run execution flow.
 *
 * @module interactions/__tests__/flows/run.test
 */

import { describe, it, expect } from 'vitest';
import { runFlow, isRunAction, getRunAction } from '../../flows/run.js';
import { createMockContext } from '../mocks/context.js';
import type { RunFlowContext } from '../../flows/run.js';

describe('runFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(runFlow.id).toBe('run');
    });

    it('has correct first step', () => {
      expect(runFlow.firstStep).toBe('menu');
    });

    it('has all expected steps', () => {
      const stepIds = Object.keys(runFlow.steps);
      expect(stepIds).toContain('menu');
      expect(stepIds).toContain('select_mode');
      expect(stepIds).toContain('select_concurrency');
      expect(stepIds).toContain('custom_concurrency');
      expect(stepIds).toContain('confirm_run');
      expect(stepIds).toContain('confirm_stop');
      expect(stepIds).toContain('run_started');
      expect(stepIds).toContain('stop_result');
      expect(stepIds).toContain('error');
    });
  });

  describe('menu step', () => {
    describe('interaction', () => {
      it('shows disabled option when no pending requirements', () => {
        const ctx = createMockContext({
          requirements: { pending: 0, inProgress: 0, completed: 0, failed: 0 },
        }) as RunFlowContext;
        const interaction = runFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'no_pending' && o.disabled)).toBe(true);
        }
      });

      it('shows run option with pending count', () => {
        const ctx = createMockContext({
          requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
        }) as RunFlowContext;
        const interaction = runFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const runOption = interaction.options.find((o) => o.id === 'run_pending');
          expect(runOption).toBeDefined();
          expect(runOption?.label).toContain('5');
        }
      });

      it('shows status option when in progress', () => {
        const ctx = createMockContext({
          requirements: { pending: 0, inProgress: 3, completed: 0, failed: 0 },
        }) as RunFlowContext;
        const interaction = runFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const statusOption = interaction.options.find((o) => o.id === 'status');
          expect(statusOption).toBeDefined();
          expect(statusOption?.label).toContain('3');
        }
      });

      it('shows daemon controls when daemon running', () => {
        const ctx = createMockContext({
          daemon: { running: true, pid: 123 },
        }) as RunFlowContext;
        const interaction = runFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'view_logs')).toBe(true);
          expect(interaction.options.some((o) => o.id === 'stop_daemon')).toBe(true);
        }
      });

      it('hides daemon controls when not running', () => {
        const ctx = createMockContext({
          daemon: { running: false },
        }) as RunFlowContext;
        const interaction = runFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'view_logs')).toBe(false);
          expect(interaction.options.some((o) => o.id === 'stop_daemon')).toBe(false);
        }
      });

      it('always shows back option', () => {
        const ctx = createMockContext() as RunFlowContext;
        const interaction = runFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'back')).toBe(true);
        }
      });
    });

    describe('handler', () => {
      it('navigates to select_mode on run_pending', async () => {
        const ctx = createMockContext() as RunFlowContext;
        const result = await runFlow.steps.menu.handle('run_pending', ctx);
        expect(result).toBe('select_mode');
      });

      it('returns action:show_status on status', async () => {
        const ctx = createMockContext() as RunFlowContext;
        const result = await runFlow.steps.menu.handle('status', ctx);
        expect(result).toBe('action:show_status');
      });

      it('returns action:view_logs on view_logs', async () => {
        const ctx = createMockContext() as RunFlowContext;
        const result = await runFlow.steps.menu.handle('view_logs', ctx);
        expect(result).toBe('action:view_logs');
      });

      it('navigates to confirm_stop on stop_daemon', async () => {
        const ctx = createMockContext() as RunFlowContext;
        const result = await runFlow.steps.menu.handle('stop_daemon', ctx);
        expect(result).toBe('confirm_stop');
      });

      it('returns null on back', async () => {
        const ctx = createMockContext() as RunFlowContext;
        const result = await runFlow.steps.menu.handle('back', ctx);
        expect(result).toBeNull();
      });

      it('sets selectedAction on context', async () => {
        const ctx = createMockContext() as RunFlowContext;
        await runFlow.steps.menu.handle('run_pending', ctx);
        expect(ctx.selectedAction).toBe('run_pending');
      });
    });
  });

  describe('select_mode step', () => {
    it('shows foreground and background options', () => {
      const ctx = createMockContext() as RunFlowContext;
      const interaction = runFlow.steps.select_mode.interaction(ctx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'foreground')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'background')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'back')).toBe(true);
      }
    });

    it('sets runMode and navigates to select_concurrency', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.select_mode.handle('foreground', ctx);

      expect(ctx.runMode).toBe('foreground');
      expect(result).toBe('select_concurrency');
    });

    it('returns to menu on back', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.select_mode.handle('back', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('select_concurrency step', () => {
    it('shows concurrency options', () => {
      const ctx = createMockContext() as RunFlowContext;
      const interaction = runFlow.steps.select_concurrency.interaction(ctx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === '1')).toBe(true);
        expect(interaction.options.some((o) => o.id === '3')).toBe(true);
        expect(interaction.options.some((o) => o.id === '5')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'custom')).toBe(true);
      }
    });

    it('sets concurrency and navigates to confirm_run', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.select_concurrency.handle('3', ctx);

      expect(ctx.concurrency).toBe(3);
      expect(result).toBe('confirm_run');
    });

    it('navigates to custom_concurrency on custom', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.select_concurrency.handle('custom', ctx);
      expect(result).toBe('custom_concurrency');
    });

    it('returns to select_mode on back', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.select_concurrency.handle('back', ctx);
      expect(result).toBe('select_mode');
    });
  });

  describe('custom_concurrency step', () => {
    it('shows input for concurrency', () => {
      const ctx = createMockContext() as RunFlowContext;
      const interaction = runFlow.steps.custom_concurrency.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.message).toContain('1-10');
    });

    it('sets concurrency and navigates to confirm_run', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.custom_concurrency.handle('7', ctx);

      expect(ctx.concurrency).toBe(7);
      expect(result).toBe('confirm_run');
    });

    it('returns to select_concurrency on empty input', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.custom_concurrency.handle('', ctx);
      expect(result).toBe('select_concurrency');
    });

    it('returns to select_concurrency on null input', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.custom_concurrency.handle(null, ctx);
      expect(result).toBe('select_concurrency');
    });
  });

  describe('confirm_run step', () => {
    it('shows run configuration in message', () => {
      const ctx = createMockContext({
        requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
      }) as RunFlowContext;
      ctx.runMode = 'background';
      ctx.concurrency = 3;
      const interaction = runFlow.steps.confirm_run.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.message).toContain('Background');
      expect(interaction?.message).toContain('3');
      expect(interaction?.message).toContain('5');
    });

    it('returns action:start_daemon for background mode', async () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.runMode = 'background';
      const result = await runFlow.steps.confirm_run.handle(true, ctx);
      expect(result).toBe('action:start_daemon');
    });

    it('returns action:run_foreground for foreground mode', async () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.runMode = 'foreground';
      const result = await runFlow.steps.confirm_run.handle(true, ctx);
      expect(result).toBe('action:run_foreground');
    });

    it('returns to menu on cancel', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.confirm_run.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('confirm_stop step', () => {
    it('shows PID in message', () => {
      const ctx = createMockContext({
        daemon: { running: true, pid: 12345 },
      }) as RunFlowContext;
      const interaction = runFlow.steps.confirm_stop.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.message).toContain('12345');
      expect(interaction?.destructive).toBe(true);
    });

    it('returns action:stop_daemon on confirm', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.confirm_stop.handle(true, ctx);
      expect(result).toBe('action:stop_daemon');
    });

    it('returns to menu on cancel', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.confirm_stop.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('run_started step', () => {
    it('shows daemon started message for background', () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.runMode = 'background';
      const interaction = runFlow.steps.run_started.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('success');
      expect(interaction?.message).toContain('Daemon');
    });

    it('shows execution started message for foreground', () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.runMode = 'foreground';
      const interaction = runFlow.steps.run_started.interaction(ctx);

      expect(interaction?.message).toContain('Execution started');
    });

    it('returns to menu', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await runFlow.steps.run_started.handle('', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('stop_result step', () => {
    it('shows success message on success', () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.stopResult = { success: true };
      const interaction = runFlow.steps.stop_result.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('success');
    });

    it('shows error message on failure', () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.stopResult = { success: false, error: 'Process not found' };
      const interaction = runFlow.steps.stop_result.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('error');
      expect(interaction?.message).toContain('Process not found');
    });

    it('clears stopResult and returns to menu', async () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.stopResult = { success: true };
      const result = await runFlow.steps.stop_result.handle('', ctx);

      expect(ctx.stopResult).toBeUndefined();
      expect(result).toBe('menu');
    });
  });

  describe('error step', () => {
    it('displays error message', () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.error = 'Failed to start';
      const interaction = runFlow.steps.error.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('error');
      expect(interaction?.message).toContain('Failed to start');
    });

    it('clears error and returns to menu', async () => {
      const ctx = createMockContext() as RunFlowContext;
      ctx.error = 'Failed to start';
      const result = await runFlow.steps.error.handle('', ctx);

      expect(ctx.error).toBeUndefined();
      expect(result).toBe('menu');
    });
  });
});

describe('utility functions', () => {
  describe('isRunAction', () => {
    it('returns true for action markers', () => {
      expect(isRunAction('action:start_daemon')).toBe(true);
      expect(isRunAction('action:run_foreground')).toBe(true);
    });

    it('returns false for non-action markers', () => {
      expect(isRunAction('menu')).toBe(false);
      expect(isRunAction('flow:run')).toBe(false);
      expect(isRunAction(null)).toBe(false);
    });
  });

  describe('getRunAction', () => {
    it('extracts action name', () => {
      expect(getRunAction('action:start_daemon')).toBe('start_daemon');
      expect(getRunAction('action:run_foreground')).toBe('run_foreground');
    });
  });
});
