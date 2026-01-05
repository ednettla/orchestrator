/**
 * Daemon Flow Tests
 *
 * Tests for the daemon controls flow.
 *
 * @module interactions/__tests__/flows/daemon.test
 */

import { describe, it, expect } from 'vitest';
import { daemonFlow, isDaemonAction, getDaemonAction } from '../../flows/daemon.js';
import { createMockContext } from '../mocks/context.js';
import type { DaemonFlowContext } from '../../flows/daemon.js';

describe('daemonFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(daemonFlow.id).toBe('daemon');
    });

    it('has correct first step', () => {
      expect(daemonFlow.firstStep).toBe('menu');
    });

    it('has all expected steps', () => {
      const stepIds = Object.keys(daemonFlow.steps);
      expect(stepIds).toContain('menu');
      expect(stepIds).toContain('loading_logs');
      expect(stepIds).toContain('display_logs');
      expect(stepIds).toContain('logs_actions');
      expect(stepIds).toContain('confirm_stop');
      expect(stepIds).toContain('stopping');
      expect(stepIds).toContain('stop_result');
      expect(stepIds).toContain('error');
    });
  });

  describe('menu step', () => {
    describe('interaction', () => {
      it('shows not running message when daemon not running', () => {
        const ctx = createMockContext({
          daemon: { running: false },
        }) as DaemonFlowContext;
        const interaction = daemonFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const notRunning = interaction.options.find((o) => o.id === 'not_running');
          expect(notRunning).toBeDefined();
          expect(notRunning?.disabled).toBe(true);
        }
      });

      it('shows daemon controls when running', () => {
        const ctx = createMockContext({
          daemon: { running: true, pid: 123, startedAt: new Date().toISOString() },
        }) as DaemonFlowContext;
        const interaction = daemonFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'view_logs')).toBe(true);
          expect(interaction.options.some((o) => o.id === 'follow_logs')).toBe(true);
          expect(interaction.options.some((o) => o.id === 'stop')).toBe(true);
        }
      });

      it('shows PID and uptime in message when running', () => {
        const startedAt = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
        const ctx = createMockContext({
          daemon: { running: true, pid: 12345, startedAt },
        }) as DaemonFlowContext;
        const interaction = daemonFlow.steps.menu.interaction(ctx);

        expect(interaction?.message).toContain('12345');
        expect(interaction?.message).toContain('1m');
      });

      it('shows PID in stop option description', () => {
        const ctx = createMockContext({
          daemon: { running: true, pid: 12345 },
        }) as DaemonFlowContext;
        const interaction = daemonFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const stopOption = interaction.options.find((o) => o.id === 'stop');
          expect(stopOption?.description).toContain('12345');
        }
      });

      it('always shows back option', () => {
        const ctx = createMockContext() as DaemonFlowContext;
        const interaction = daemonFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'back')).toBe(true);
        }
      });
    });

    describe('handler', () => {
      it('returns action:load_logs on view_logs', async () => {
        const ctx = createMockContext() as DaemonFlowContext;
        const result = await daemonFlow.steps.menu.handle('view_logs', ctx);
        expect(result).toBe('action:load_logs');
      });

      it('returns action:follow_logs on follow_logs', async () => {
        const ctx = createMockContext() as DaemonFlowContext;
        const result = await daemonFlow.steps.menu.handle('follow_logs', ctx);
        expect(result).toBe('action:follow_logs');
      });

      it('navigates to confirm_stop on stop', async () => {
        const ctx = createMockContext() as DaemonFlowContext;
        const result = await daemonFlow.steps.menu.handle('stop', ctx);
        expect(result).toBe('confirm_stop');
      });

      it('returns null on back', async () => {
        const ctx = createMockContext() as DaemonFlowContext;
        const result = await daemonFlow.steps.menu.handle('back', ctx);
        expect(result).toBeNull();
      });

      it('sets selectedAction on context', async () => {
        const ctx = createMockContext() as DaemonFlowContext;
        await daemonFlow.steps.menu.handle('view_logs', ctx);
        expect(ctx.selectedAction).toBe('view_logs');
      });
    });
  });

  describe('loading_logs step', () => {
    it('shows progress interaction', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const interaction = daemonFlow.steps.loading_logs.interaction(ctx);

      expect(interaction?.type).toBe('progress');
      expect(interaction?.message).toContain('Loading');
    });

    it('navigates to display_logs', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const result = await daemonFlow.steps.loading_logs.handle('', ctx);
      expect(result).toBe('display_logs');
    });
  });

  describe('display_logs step', () => {
    it('shows logs when available', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.logs = ['Line 1', 'Line 2', 'Line 3'];
      const interaction = daemonFlow.steps.display_logs.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('info');
      expect(interaction?.message).toContain('Line 1');
      expect(interaction?.message).toContain('Line 2');
    });

    it('shows no logs message when empty', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.logs = [];
      const interaction = daemonFlow.steps.display_logs.interaction(ctx);

      expect(interaction?.message).toContain('No logs');
    });

    it('limits to last 30 lines', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.logs = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
      const interaction = daemonFlow.steps.display_logs.interaction(ctx);

      expect(interaction?.message).not.toContain('Line 1\n');
      expect(interaction?.message).toContain('Line 21');
      expect(interaction?.message).toContain('Line 50');
    });

    it('navigates to logs_actions', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const result = await daemonFlow.steps.display_logs.handle('', ctx);
      expect(result).toBe('logs_actions');
    });
  });

  describe('logs_actions step', () => {
    it('shows refresh, follow, and back options', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const interaction = daemonFlow.steps.logs_actions.interaction(ctx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'refresh')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'follow')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'menu')).toBe(true);
      }
    });

    it('clears logs and returns action:load_logs on refresh', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.logs = ['some', 'logs'];
      const result = await daemonFlow.steps.logs_actions.handle('refresh', ctx);

      expect(ctx.logs).toBeUndefined();
      expect(result).toBe('action:load_logs');
    });

    it('returns action:follow_logs on follow', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const result = await daemonFlow.steps.logs_actions.handle('follow', ctx);
      expect(result).toBe('action:follow_logs');
    });

    it('clears logs and returns to menu', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.logs = ['some', 'logs'];
      const result = await daemonFlow.steps.logs_actions.handle('menu', ctx);

      expect(ctx.logs).toBeUndefined();
      expect(result).toBe('menu');
    });
  });

  describe('confirm_stop step', () => {
    it('shows PID in message', () => {
      const ctx = createMockContext({
        daemon: { running: true, pid: 12345 },
      }) as DaemonFlowContext;
      const interaction = daemonFlow.steps.confirm_stop.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.message).toContain('12345');
      expect(interaction?.destructive).toBe(true);
    });

    it('returns action:stop_daemon on confirm', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const result = await daemonFlow.steps.confirm_stop.handle(true, ctx);
      expect(result).toBe('action:stop_daemon');
    });

    it('returns to menu on cancel', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const result = await daemonFlow.steps.confirm_stop.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('stopping step', () => {
    it('shows progress interaction', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const interaction = daemonFlow.steps.stopping.interaction(ctx);

      expect(interaction?.type).toBe('progress');
      expect(interaction?.message).toContain('Stopping');
    });

    it('navigates to stop_result', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      const result = await daemonFlow.steps.stopping.handle('', ctx);
      expect(result).toBe('stop_result');
    });
  });

  describe('stop_result step', () => {
    it('shows success message on success', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.stopResult = { success: true };
      const interaction = daemonFlow.steps.stop_result.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('success');
    });

    it('shows error message on failure', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.stopResult = { success: false, error: 'Permission denied' };
      const interaction = daemonFlow.steps.stop_result.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('error');
      expect(interaction?.message).toContain('Permission denied');
    });

    it('clears stopResult and returns null (exits flow)', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.stopResult = { success: true };
      const result = await daemonFlow.steps.stop_result.handle('', ctx);

      expect(ctx.stopResult).toBeUndefined();
      expect(result).toBeNull();
    });
  });

  describe('error step', () => {
    it('displays error message', () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.error = 'Connection failed';
      const interaction = daemonFlow.steps.error.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('error');
      expect(interaction?.message).toContain('Connection failed');
    });

    it('clears error and returns to menu', async () => {
      const ctx = createMockContext() as DaemonFlowContext;
      ctx.error = 'Connection failed';
      const result = await daemonFlow.steps.error.handle('', ctx);

      expect(ctx.error).toBeUndefined();
      expect(result).toBe('menu');
    });
  });
});

describe('utility functions', () => {
  describe('isDaemonAction', () => {
    it('returns true for action markers', () => {
      expect(isDaemonAction('action:load_logs')).toBe(true);
      expect(isDaemonAction('action:stop_daemon')).toBe(true);
    });

    it('returns false for non-action markers', () => {
      expect(isDaemonAction('menu')).toBe(false);
      expect(isDaemonAction('flow:daemon')).toBe(false);
      expect(isDaemonAction(null)).toBe(false);
    });
  });

  describe('getDaemonAction', () => {
    it('extracts action name', () => {
      expect(getDaemonAction('action:load_logs')).toBe('load_logs');
      expect(getDaemonAction('action:stop_daemon')).toBe('stop_daemon');
    });
  });
});
