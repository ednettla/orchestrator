/**
 * Main Menu Flow Tests
 *
 * Tests for the main navigation flow.
 *
 * @module interactions/__tests__/flows/main-menu.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mainMenuFlow, getSubFlowId } from '../../flows/main-menu.js';
import { createMockContext } from '../mocks/context.js';
import type { MainMenuContext } from '../../flows/main-menu.js';

// Mock external dependencies
vi.mock('../../../cli/commands/status.js', () => ({
  statusCommand: vi.fn(),
}));

vi.mock('../../../cli/updater.js', () => ({
  checkForUpdates: vi.fn(),
  updateToLatest: vi.fn(),
  getCurrentVersion: vi.fn(() => '0.1.0'),
}));

describe('mainMenuFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(mainMenuFlow.id).toBe('main-menu');
    });

    it('has correct first step', () => {
      expect(mainMenuFlow.firstStep).toBe('menu');
    });

    it('has all expected steps', () => {
      const stepIds = Object.keys(mainMenuFlow.steps);
      expect(stepIds).toContain('menu');
      expect(stepIds).toContain('show_status');
      expect(stepIds).toContain('status_continue');
      expect(stepIds).toContain('check_updates');
      expect(stepIds).toContain('update_current');
      expect(stepIds).toContain('update_available');
      expect(stepIds).toContain('do_update');
      expect(stepIds).toContain('update_complete');
      expect(stepIds).toContain('update_error');
    });
  });

  describe('menu step', () => {
    describe('interaction', () => {
      it('shows init option when no project', () => {
        const ctx = createMockContext({ hasProject: false }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        expect(interaction?.type).toBe('select');
        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'init')).toBe(true);
        }
      });

      it('hides init option when project exists', () => {
        const ctx = createMockContext({ hasProject: true }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'init')).toBe(false);
        }
      });

      it('shows daemon option when daemon running', () => {
        const ctx = createMockContext({
          daemon: { running: true, pid: 123 },
        }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'daemon')).toBe(true);
        }
      });

      it('hides daemon option when daemon not running', () => {
        const ctx = createMockContext({
          daemon: { running: false },
        }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'daemon')).toBe(false);
        }
      });

      it('shows pending count in run option', () => {
        const ctx = createMockContext({
          requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
        }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const runOption = interaction.options.find((o) => o.id === 'run');
          expect(runOption?.label).toContain('5 pending');
        }
      });

      it('shows project name in message when available', () => {
        const ctx = createMockContext({
          projectName: 'my-project',
        }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        expect(interaction?.message).toContain('my-project');
      });

      it('shows no project message when no project', () => {
        const ctx = createMockContext({
          hasProject: false,
          projectName: undefined,
        }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        expect(interaction?.message).toContain('No project');
      });

      it('shows plan status when plan exists', () => {
        const ctx = createMockContext({
          plan: {
            id: 'plan-1',
            sessionId: 'sess-1',
            highLevelGoal: 'Build app',
            status: 'pending_approval',
            requirements: [],
            questions: [],
            technicalContext: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }) as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const planOption = interaction.options.find((o) => o.id === 'plan');
          expect(planOption?.label).toContain('pending_approval');
        }
      });

      it('always shows exit option', () => {
        const ctx = createMockContext() as MainMenuContext;
        const interaction = mainMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'exit')).toBe(true);
        }
      });
    });

    describe('handler', () => {
      it('navigates to flow:init on init selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('init', ctx);
        expect(result).toBe('flow:init');
      });

      it('navigates to flow:plan on plan selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('plan', ctx);
        expect(result).toBe('flow:plan');
      });

      it('navigates to flow:run on run selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('run', ctx);
        expect(result).toBe('flow:run');
      });

      it('navigates to show_status on status selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('status', ctx);
        expect(result).toBe('show_status');
      });

      it('navigates to flow:requirements on requirements selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('requirements', ctx);
        expect(result).toBe('flow:requirements');
      });

      it('navigates to flow:daemon on daemon selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('daemon', ctx);
        expect(result).toBe('flow:daemon');
      });

      it('navigates to flow:config on config selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('config', ctx);
        expect(result).toBe('flow:config');
      });

      it('navigates to flow:secrets on secrets selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('secrets', ctx);
        expect(result).toBe('flow:secrets');
      });

      it('navigates to flow:projects on projects selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('projects', ctx);
        expect(result).toBe('flow:projects');
      });

      it('navigates to flow:telegram on telegram selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('telegram', ctx);
        expect(result).toBe('flow:telegram');
      });

      it('navigates to check_updates on update selection', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('update', ctx);
        expect(result).toBe('check_updates');
      });

      it('returns null on exit', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('exit', ctx);
        expect(result).toBeNull();
      });

      it('returns menu for unknown response', async () => {
        const ctx = createMockContext() as MainMenuContext;
        const result = await mainMenuFlow.steps.menu.handle('unknown', ctx);
        expect(result).toBe('menu');
      });

      it('sets selectedAction on context', async () => {
        const ctx = createMockContext() as MainMenuContext;
        await mainMenuFlow.steps.menu.handle('plan', ctx);
        expect(ctx.selectedAction).toBe('plan');
      });
    });
  });

  describe('show_status step', () => {
    it('returns progress interaction', () => {
      const ctx = createMockContext() as MainMenuContext;
      const interaction = mainMenuFlow.steps.show_status.interaction(ctx);

      expect(interaction?.type).toBe('progress');
      expect(interaction?.message).toContain('Loading');
    });
  });

  describe('status_continue step', () => {
    it('shows refresh and back options', () => {
      const ctx = createMockContext() as MainMenuContext;
      const interaction = mainMenuFlow.steps.status_continue.interaction(ctx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'menu')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'refresh')).toBe(true);
      }
    });

    it('navigates to show_status on refresh', async () => {
      const ctx = createMockContext() as MainMenuContext;
      const result = await mainMenuFlow.steps.status_continue.handle('refresh', ctx);
      expect(result).toBe('show_status');
    });

    it('navigates to menu on back', async () => {
      const ctx = createMockContext() as MainMenuContext;
      const result = await mainMenuFlow.steps.status_continue.handle('menu', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('check_updates step', () => {
    it('returns progress interaction', () => {
      const ctx = createMockContext() as MainMenuContext;
      const interaction = mainMenuFlow.steps.check_updates.interaction(ctx);

      expect(interaction?.type).toBe('progress');
      expect(interaction?.message).toContain('Checking');
    });
  });

  describe('update_current step', () => {
    it('returns display interaction', () => {
      const ctx = createMockContext({ updateInfo: { isOutdated: false, current: '0.1.0', latest: '0.1.0', commitsBehind: 0 } }) as MainMenuContext;
      const interaction = mainMenuFlow.steps.update_current.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('success');
    });

    it('navigates to menu on handle', async () => {
      const ctx = createMockContext() as MainMenuContext;
      const result = await mainMenuFlow.steps.update_current.handle('', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('update_available step', () => {
    it('returns confirm interaction with update info', () => {
      const ctx = createMockContext({
        updateInfo: { isOutdated: true, current: '0.1.0', latest: '0.2.0', commitsBehind: 5 },
      }) as MainMenuContext;
      const interaction = mainMenuFlow.steps.update_available.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.message).toContain('5 commits');
    });

    it('navigates to do_update on confirm', async () => {
      const ctx = createMockContext() as MainMenuContext;
      const result = await mainMenuFlow.steps.update_available.handle(true, ctx);
      expect(result).toBe('do_update');
    });

    it('navigates to menu on cancel', async () => {
      const ctx = createMockContext() as MainMenuContext;
      const result = await mainMenuFlow.steps.update_available.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('do_update step', () => {
    it('returns progress interaction', () => {
      const ctx = createMockContext() as MainMenuContext;
      const interaction = mainMenuFlow.steps.do_update.interaction(ctx);

      expect(interaction?.type).toBe('progress');
      expect(interaction?.message).toContain('Updating');
    });
  });

  describe('update_complete step', () => {
    it('returns display interaction', () => {
      const ctx = createMockContext() as MainMenuContext;
      const interaction = mainMenuFlow.steps.update_complete.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('success');
      expect(interaction?.message).toContain('Restart');
    });

    it('returns null to exit', async () => {
      const ctx = createMockContext() as MainMenuContext;
      const result = await mainMenuFlow.steps.update_complete.handle('', ctx);
      expect(result).toBeNull();
    });
  });

  describe('update_error step', () => {
    it('returns error display', () => {
      const ctx = createMockContext() as MainMenuContext;
      const interaction = mainMenuFlow.steps.update_error.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('error');
    });

    it('navigates to menu on handle', async () => {
      const ctx = createMockContext() as MainMenuContext;
      const result = await mainMenuFlow.steps.update_error.handle('', ctx);
      expect(result).toBe('menu');
    });
  });
});

describe('getSubFlowId', () => {
  it('extracts flow id from flow: prefix', () => {
    expect(getSubFlowId('flow:plan')).toBe('plan');
    expect(getSubFlowId('flow:run')).toBe('run');
    expect(getSubFlowId('flow:config')).toBe('config');
  });

  it('returns null for non-flow actions', () => {
    expect(getSubFlowId('action:do_something')).toBeNull();
    expect(getSubFlowId('menu')).toBeNull();
    expect(getSubFlowId('exit')).toBeNull();
  });
});
