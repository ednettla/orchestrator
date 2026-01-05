/**
 * Requirements Flow Tests
 *
 * Tests for the requirements management flow.
 *
 * @module interactions/__tests__/flows/requirements.test
 */

import { describe, it, expect } from 'vitest';
import { requirementsFlow, isRequirementsAction, getRequirementsAction } from '../../flows/requirements.js';
import { createMockContext } from '../mocks/context.js';
import type { RequirementsFlowContext } from '../../flows/requirements.js';

describe('requirementsFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(requirementsFlow.id).toBe('requirements');
    });

    it('has correct first step', () => {
      expect(requirementsFlow.firstStep).toBe('menu');
    });

    it('has all expected steps', () => {
      const stepIds = Object.keys(requirementsFlow.steps);
      expect(stepIds).toContain('menu');
      expect(stepIds).toContain('add_title');
      expect(stepIds).toContain('add_description');
      expect(stepIds).toContain('add_confirm');
      expect(stepIds).toContain('add_success');
      expect(stepIds).toContain('add_next');
      expect(stepIds).toContain('add_error');
    });
  });

  describe('menu step', () => {
    describe('interaction', () => {
      it('always shows add option', () => {
        const ctx = createMockContext() as RequirementsFlowContext;
        const interaction = requirementsFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'add')).toBe(true);
        }
      });

      it('shows list option when requirements exist', () => {
        const ctx = createMockContext({
          requirements: { pending: 2, inProgress: 1, completed: 3, failed: 0 },
        }) as RequirementsFlowContext;
        const interaction = requirementsFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const listOption = interaction.options.find((o) => o.id === 'list');
          expect(listOption).toBeDefined();
          expect(listOption?.label).toContain('6');
        }
      });

      it('hides list option when no requirements', () => {
        const ctx = createMockContext({
          requirements: { pending: 0, inProgress: 0, completed: 0, failed: 0 },
        }) as RequirementsFlowContext;
        const interaction = requirementsFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'list')).toBe(false);
        }
      });

      it('shows run option when pending requirements exist', () => {
        const ctx = createMockContext({
          requirements: { pending: 3, inProgress: 0, completed: 0, failed: 0 },
        }) as RequirementsFlowContext;
        const interaction = requirementsFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const runOption = interaction.options.find((o) => o.id === 'run');
          expect(runOption).toBeDefined();
          expect(runOption?.label).toContain('3');
        }
      });

      it('hides run option when no pending requirements', () => {
        const ctx = createMockContext({
          requirements: { pending: 0, inProgress: 1, completed: 2, failed: 0 },
        }) as RequirementsFlowContext;
        const interaction = requirementsFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'run')).toBe(false);
        }
      });

      it('always shows back option', () => {
        const ctx = createMockContext() as RequirementsFlowContext;
        const interaction = requirementsFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'back')).toBe(true);
        }
      });
    });

    describe('handler', () => {
      it('navigates to add_title on add', async () => {
        const ctx = createMockContext() as RequirementsFlowContext;
        const result = await requirementsFlow.steps.menu.handle('add', ctx);
        expect(result).toBe('add_title');
      });

      it('returns action:list_requirements on list', async () => {
        const ctx = createMockContext() as RequirementsFlowContext;
        const result = await requirementsFlow.steps.menu.handle('list', ctx);
        expect(result).toBe('action:list_requirements');
      });

      it('returns flow:run on run', async () => {
        const ctx = createMockContext() as RequirementsFlowContext;
        const result = await requirementsFlow.steps.menu.handle('run', ctx);
        expect(result).toBe('flow:run');
      });

      it('returns null on back', async () => {
        const ctx = createMockContext() as RequirementsFlowContext;
        const result = await requirementsFlow.steps.menu.handle('back', ctx);
        expect(result).toBeNull();
      });

      it('sets selectedAction on context', async () => {
        const ctx = createMockContext() as RequirementsFlowContext;
        await requirementsFlow.steps.menu.handle('add', ctx);
        expect(ctx.selectedAction).toBe('add');
      });
    });
  });

  describe('add_title step', () => {
    it('shows input interaction', () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const interaction = requirementsFlow.steps.add_title.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.message).toContain('built');
    });

    it('sets title and navigates to add_description', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_title.handle('User auth', ctx);

      expect(ctx.newRequirementTitle).toBe('User auth');
      expect(result).toBe('add_description');
    });

    it('returns to menu on empty input', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_title.handle('', ctx);
      expect(result).toBe('menu');
    });

    it('returns to menu on null input', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_title.handle(null, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('add_description step', () => {
    it('shows multiline input interaction', () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const interaction = requirementsFlow.steps.add_description.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.multiline).toBe(true);
    });

    it('sets description and navigates to add_confirm', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_description.handle('More details...', ctx);

      expect(ctx.newRequirementDescription).toBe('More details...');
      expect(result).toBe('add_confirm');
    });

    it('navigates to add_confirm even with empty description', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_description.handle('', ctx);
      expect(result).toBe('add_confirm');
    });
  });

  describe('add_confirm step', () => {
    it('shows title in confirmation', () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.newRequirementTitle = 'User authentication';
      const interaction = requirementsFlow.steps.add_confirm.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.message).toContain('User authentication');
    });

    it('shows description in confirmation when present', () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.newRequirementTitle = 'User auth';
      ctx.newRequirementDescription = 'With OAuth';
      const interaction = requirementsFlow.steps.add_confirm.interaction(ctx);

      expect(interaction?.message).toContain('With OAuth');
    });

    it('returns action:add_requirement on confirm', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.newRequirementTitle = 'Test';
      const result = await requirementsFlow.steps.add_confirm.handle(true, ctx);
      expect(result).toBe('action:add_requirement');
    });

    it('clears draft and returns to menu on cancel', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.newRequirementTitle = 'Test';
      ctx.newRequirementDescription = 'Description';
      const result = await requirementsFlow.steps.add_confirm.handle(false, ctx);

      expect(ctx.newRequirementTitle).toBeUndefined();
      expect(ctx.newRequirementDescription).toBeUndefined();
      expect(result).toBe('menu');
    });
  });

  describe('add_success step', () => {
    it('shows success message', () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const interaction = requirementsFlow.steps.add_success.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('success');
    });

    it('navigates to add_next', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_success.handle('', ctx);
      expect(result).toBe('add_next');
    });
  });

  describe('add_next step', () => {
    it('shows follow-up options', () => {
      const ctx = createMockContext({
        requirements: { pending: 3, inProgress: 0, completed: 0, failed: 0 },
      }) as RequirementsFlowContext;
      const interaction = requirementsFlow.steps.add_next.interaction(ctx);

      if (interaction?.type === 'select') {
        expect(interaction.options.some((o) => o.id === 'add_another')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'run')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'list')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'menu')).toBe(true);
      }
    });

    it('shows updated pending count in run option', () => {
      const ctx = createMockContext({
        requirements: { pending: 4, inProgress: 0, completed: 0, failed: 0 },
      }) as RequirementsFlowContext;
      const interaction = requirementsFlow.steps.add_next.interaction(ctx);

      if (interaction?.type === 'select') {
        const runOption = interaction.options.find((o) => o.id === 'run');
        expect(runOption?.label).toContain('5'); // pending + 1
      }
    });

    it('clears draft on any selection', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.newRequirementTitle = 'Test';
      ctx.newRequirementDescription = 'Description';

      await requirementsFlow.steps.add_next.handle('menu', ctx);

      expect(ctx.newRequirementTitle).toBeUndefined();
      expect(ctx.newRequirementDescription).toBeUndefined();
    });

    it('navigates to add_title on add_another', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_next.handle('add_another', ctx);
      expect(result).toBe('add_title');
    });

    it('returns flow:run on run', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_next.handle('run', ctx);
      expect(result).toBe('flow:run');
    });

    it('returns action:list_requirements on list', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_next.handle('list', ctx);
      expect(result).toBe('action:list_requirements');
    });

    it('returns to menu on menu', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await requirementsFlow.steps.add_next.handle('menu', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('add_error step', () => {
    it('shows error message', () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.error = 'Database error';
      const interaction = requirementsFlow.steps.add_error.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('error');
      expect(interaction?.message).toContain('Database error');
    });

    it('clears error and returns to menu', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.error = 'Database error';
      const result = await requirementsFlow.steps.add_error.handle('', ctx);

      expect(ctx.error).toBeUndefined();
      expect(result).toBe('menu');
    });
  });
});

describe('utility functions', () => {
  describe('isRequirementsAction', () => {
    it('returns true for action markers', () => {
      expect(isRequirementsAction('action:add_requirement')).toBe(true);
      expect(isRequirementsAction('action:list_requirements')).toBe(true);
    });

    it('returns false for non-action markers', () => {
      expect(isRequirementsAction('menu')).toBe(false);
      expect(isRequirementsAction('flow:requirements')).toBe(false);
      expect(isRequirementsAction(null)).toBe(false);
    });
  });

  describe('getRequirementsAction', () => {
    it('extracts action name', () => {
      expect(getRequirementsAction('action:add_requirement')).toBe('add_requirement');
      expect(getRequirementsAction('action:list_requirements')).toBe('list_requirements');
    });
  });
});
