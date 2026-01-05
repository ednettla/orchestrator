/**
 * Plan Flow Tests
 *
 * Tests for plan menu and wizard flows.
 *
 * @module interactions/__tests__/flows/plan.test
 */

import { describe, it, expect } from 'vitest';
import { planMenuFlow, planWizardFlow, isPlanAction, getPlanAction } from '../../flows/plan.js';
import { createMockContext, createMockPlan } from '../mocks/context.js';
import type { PlanFlowContext } from '../../flows/plan.js';

describe('planMenuFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(planMenuFlow.id).toBe('plan-menu');
    });

    it('has correct first step', () => {
      expect(planMenuFlow.firstStep).toBe('menu');
    });

    it('has all expected steps', () => {
      const stepIds = Object.keys(planMenuFlow.steps);
      expect(stepIds).toContain('menu');
      expect(stepIds).toContain('create_goal');
      expect(stepIds).toContain('view_plan');
      expect(stepIds).toContain('view_plan_continue');
      expect(stepIds).toContain('view_requirements');
      expect(stepIds).toContain('view_questions');
      expect(stepIds).toContain('confirm_approve');
      expect(stepIds).toContain('confirm_execute');
      expect(stepIds).toContain('confirm_reject');
      expect(stepIds).toContain('error');
    });
  });

  describe('menu step', () => {
    describe('interaction', () => {
      it('shows create option when no plan', () => {
        const ctx = createMockContext({ plan: null }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        expect(interaction?.type).toBe('select');
        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'create')).toBe(true);
          expect(interaction.options.some((o) => o.id === 'view')).toBe(false);
        }
      });

      it('shows plan management options when plan exists', () => {
        const ctx = createMockContext({
          plan: createMockPlan({ status: 'pending_approval' }),
        }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'view')).toBe(true);
          expect(interaction.options.some((o) => o.id === 'view_reqs')).toBe(true);
          expect(interaction.options.some((o) => o.id === 'view_questions')).toBe(true);
        }
      });

      it('shows approve option for pending_approval status', () => {
        const ctx = createMockContext({
          plan: createMockPlan({ status: 'pending_approval' }),
        }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'approve')).toBe(true);
        }
      });

      it('shows execute option for approved status', () => {
        const ctx = createMockContext({
          plan: createMockPlan({ status: 'approved' }),
        }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'execute')).toBe(true);
        }
      });

      it('shows continue option for drafting status', () => {
        const ctx = createMockContext({
          plan: createMockPlan({ status: 'drafting' }),
        }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          expect(interaction.options.some((o) => o.id === 'continue')).toBe(true);
        }
      });

      it('disables edit when executing', () => {
        const ctx = createMockContext({
          plan: createMockPlan({ status: 'executing' }),
        }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const editOption = interaction.options.find((o) => o.id === 'edit_reqs');
          expect(editOption?.disabled).toBe(true);
        }
      });

      it('disables reject when executing', () => {
        const ctx = createMockContext({
          plan: createMockPlan({ status: 'executing' }),
        }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        if (interaction?.type === 'select') {
          const rejectOption = interaction.options.find((o) => o.id === 'reject');
          expect(rejectOption?.disabled).toBe(true);
        }
      });

      it('shows plan info in message', () => {
        const ctx = createMockContext({
          plan: createMockPlan({
            highLevelGoal: 'Build an app',
            status: 'pending_approval',
            requirements: [{ id: 'r1', title: 'Req 1' }] as any,
          }),
        }) as PlanFlowContext;
        const interaction = planMenuFlow.steps.menu.interaction(ctx);

        expect(interaction?.message).toContain('Build an app');
        expect(interaction?.message).toContain('pending_approval');
        expect(interaction?.message).toContain('1');
      });
    });

    describe('handler', () => {
      it('navigates to create_goal on create', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('create', ctx);
        expect(result).toBe('create_goal');
      });

      it('navigates to view_plan on view', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('view', ctx);
        expect(result).toBe('view_plan');
      });

      it('navigates to flow:plan-edit-reqs on edit_reqs', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('edit_reqs', ctx);
        expect(result).toBe('flow:plan-edit-reqs');
      });

      it('returns action:resume_plan on continue', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('continue', ctx);
        expect(result).toBe('action:resume_plan');
      });

      it('navigates to confirm_approve on approve', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('approve', ctx);
        expect(result).toBe('confirm_approve');
      });

      it('navigates to confirm_execute on execute', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('execute', ctx);
        expect(result).toBe('confirm_execute');
      });

      it('navigates to confirm_reject on reject', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('reject', ctx);
        expect(result).toBe('confirm_reject');
      });

      it('returns null on back', async () => {
        const ctx = createMockContext() as PlanFlowContext;
        const result = await planMenuFlow.steps.menu.handle('back', ctx);
        expect(result).toBeNull();
      });
    });
  });

  describe('create_goal step', () => {
    it('returns input interaction', () => {
      const ctx = createMockContext({ projectName: 'my-app' }) as PlanFlowContext;
      const interaction = planMenuFlow.steps.create_goal.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.message).toContain('my-app');
    });

    it('returns action:create_plan with valid goal', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planMenuFlow.steps.create_goal.handle('Build an app', ctx);
      expect(result).toBe('action:create_plan');
      expect(ctx.planGoal).toBe('Build an app');
    });

    it('returns menu on empty input', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planMenuFlow.steps.create_goal.handle('', ctx);
      expect(result).toBe('menu');
    });

    it('returns menu on null input', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planMenuFlow.steps.create_goal.handle(null, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('view_plan step', () => {
    it('shows warning when no plan', () => {
      const ctx = createMockContext({ plan: null }) as PlanFlowContext;
      const interaction = planMenuFlow.steps.view_plan.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('warning');
    });

    it('shows plan details when plan exists', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          highLevelGoal: 'Build app',
          requirements: [
            { id: 'r1', title: 'Auth', estimatedComplexity: 'medium' },
            { id: 'r2', title: 'Dashboard', estimatedComplexity: 'high' },
          ] as any,
          questions: [],
        }),
      }) as PlanFlowContext;
      const interaction = planMenuFlow.steps.view_plan.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.message).toContain('Build app');
      expect(interaction?.message).toContain('Auth');
      expect(interaction?.message).toContain('Dashboard');
    });

    it('navigates to view_plan_continue', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planMenuFlow.steps.view_plan.handle('', ctx);
      expect(result).toBe('view_plan_continue');
    });
  });

  describe('confirm_approve step', () => {
    it('returns confirm interaction', () => {
      const ctx = createMockContext({
        plan: createMockPlan({ highLevelGoal: 'Build app' }),
      }) as PlanFlowContext;
      const interaction = planMenuFlow.steps.confirm_approve.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.message).toContain('Build app');
    });

    it('returns action:approve_plan on confirm', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planMenuFlow.steps.confirm_approve.handle(true, ctx);
      expect(result).toBe('action:approve_plan');
    });

    it('returns menu on cancel', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planMenuFlow.steps.confirm_approve.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('confirm_reject step', () => {
    it('returns confirm interaction with destructive flag', () => {
      const ctx = createMockContext({
        plan: createMockPlan(),
      }) as PlanFlowContext;
      const interaction = planMenuFlow.steps.confirm_reject.interaction(ctx);

      expect(interaction?.type).toBe('confirm');
      expect(interaction?.destructive).toBe(true);
    });

    it('returns action:reject_plan on confirm', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planMenuFlow.steps.confirm_reject.handle(true, ctx);
      expect(result).toBe('action:reject_plan');
    });
  });

  describe('error step', () => {
    it('displays error message', () => {
      const ctx = createMockContext() as PlanFlowContext;
      ctx.error = 'Something went wrong';
      const interaction = planMenuFlow.steps.error.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('error');
      expect(interaction?.message).toContain('Something went wrong');
    });

    it('clears error and returns to menu', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      ctx.error = 'Something went wrong';
      const result = await planMenuFlow.steps.error.handle('', ctx);

      expect(result).toBe('menu');
      expect(ctx.error).toBeUndefined();
    });
  });
});

describe('planWizardFlow', () => {
  describe('structure', () => {
    it('has correct flow id', () => {
      expect(planWizardFlow.id).toBe('plan-wizard');
    });

    it('has correct first step', () => {
      expect(planWizardFlow.firstStep).toBe('question');
    });
  });

  describe('question step', () => {
    it('returns null when no plan', () => {
      const ctx = createMockContext({ plan: null }) as PlanFlowContext;
      const interaction = planWizardFlow.steps.question.interaction(ctx);
      expect(interaction).toBeNull();
    });

    it('returns null when no questions', () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [] }),
      }) as PlanFlowContext;
      const interaction = planWizardFlow.steps.question.interaction(ctx);
      expect(interaction).toBeNull();
    });

    it('shows current question with options', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [
            { id: 'q1', question: 'What auth method?', suggestedOptions: ['OAuth', 'JWT', 'Basic'] },
          ],
        }),
        questionIndex: 0,
      }) as PlanFlowContext;
      const interaction = planWizardFlow.steps.question.interaction(ctx);

      expect(interaction?.type).toBe('select');
      if (interaction?.type === 'select') {
        expect(interaction.message).toContain('What auth method?');
        expect(interaction.options.some((o) => o.label === 'OAuth')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'custom')).toBe(true);
        expect(interaction.options.some((o) => o.id === 'skip')).toBe(true);
      }
    });

    it('shows question number in message', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [
            { id: 'q1', question: 'Q1' },
            { id: 'q2', question: 'Q2' },
          ],
        }),
        questionIndex: 1,
      }) as PlanFlowContext;
      const interaction = planWizardFlow.steps.question.interaction(ctx);

      expect(interaction?.message).toContain('2/2');
    });

    it('navigates to custom_answer on custom', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [{ id: 'q1', question: 'Q1' }] }),
        questionIndex: 0,
      }) as PlanFlowContext;
      const result = await planWizardFlow.steps.question.handle('custom', ctx);
      expect(result).toBe('custom_answer');
    });

    it('advances to next question on skip', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [{ id: 'q1', question: 'Q1' }, { id: 'q2', question: 'Q2' }],
        }),
        questionIndex: 0,
      }) as PlanFlowContext;
      const result = await planWizardFlow.steps.question.handle('skip', ctx);

      expect(result).toBe('question');
      expect(ctx.questionIndex).toBe(1);
    });

    it('completes on skip of last question', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [{ id: 'q1', question: 'Q1' }] }),
        questionIndex: 0,
      }) as PlanFlowContext;
      const result = await planWizardFlow.steps.question.handle('skip', ctx);
      expect(result).toBe('questions_complete');
    });

    it('records answer when selecting option', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [{ id: 'q1', question: 'Q1', suggestedOptions: ['A', 'B'] }],
        }),
        questionIndex: 0,
      }) as PlanFlowContext;
      await planWizardFlow.steps.question.handle('opt_0', ctx);

      expect(ctx.answers?.get('q1')).toBe('A');
    });
  });

  describe('custom_answer step', () => {
    it('shows question in input', () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [{ id: 'q1', question: 'Custom question?' }] }),
        questionIndex: 0,
      }) as PlanFlowContext;
      const interaction = planWizardFlow.steps.custom_answer.interaction(ctx);

      expect(interaction?.type).toBe('input');
      expect(interaction?.message).toContain('Custom question?');
    });

    it('records custom answer', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [{ id: 'q1', question: 'Q1' }] }),
        questionIndex: 0,
      }) as PlanFlowContext;
      await planWizardFlow.steps.custom_answer.handle('My custom answer', ctx);

      expect(ctx.answers?.get('q1')).toBe('My custom answer');
    });

    it('advances to next question', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [{ id: 'q1', question: 'Q1' }, { id: 'q2', question: 'Q2' }],
        }),
        questionIndex: 0,
      }) as PlanFlowContext;
      const result = await planWizardFlow.steps.custom_answer.handle('Answer', ctx);

      expect(result).toBe('question');
      expect(ctx.questionIndex).toBe(1);
    });

    it('completes on last question', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [{ id: 'q1', question: 'Q1' }] }),
        questionIndex: 0,
      }) as PlanFlowContext;
      const result = await planWizardFlow.steps.custom_answer.handle('Answer', ctx);
      expect(result).toBe('questions_complete');
    });
  });

  describe('questions_complete step', () => {
    it('shows success message', () => {
      const ctx = createMockContext() as PlanFlowContext;
      const interaction = planWizardFlow.steps.questions_complete.interaction(ctx);

      expect(interaction?.type).toBe('display');
      expect(interaction?.format).toBe('success');
    });

    it('returns action:generate_plan', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await planWizardFlow.steps.questions_complete.handle('', ctx);
      expect(result).toBe('action:generate_plan');
    });
  });
});

describe('utility functions', () => {
  describe('isPlanAction', () => {
    it('returns true for action markers', () => {
      expect(isPlanAction('action:create_plan')).toBe(true);
      expect(isPlanAction('action:approve_plan')).toBe(true);
    });

    it('returns false for non-action markers', () => {
      expect(isPlanAction('menu')).toBe(false);
      expect(isPlanAction('flow:plan')).toBe(false);
      expect(isPlanAction(null)).toBe(false);
    });
  });

  describe('getPlanAction', () => {
    it('extracts action name', () => {
      expect(getPlanAction('action:create_plan')).toBe('create_plan');
      expect(getPlanAction('action:approve_plan')).toBe('approve_plan');
    });
  });
});
