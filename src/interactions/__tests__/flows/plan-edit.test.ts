/**
 * Plan Edit Flow Tests
 *
 * Tests for the plan editing flows (requirements and questions).
 *
 * @module interactions/__tests__/flows/plan-edit.test
 */

import { describe, it, expect } from 'vitest';
import { planEditReqsFlow, planEditQuestionsFlow } from '../../flows/plan-edit.js';
import type { PlanEditContext } from '../../flows/plan-edit.js';
import { createMockContext, createMockPlan } from '../mocks/context.js';

describe('planEditReqsFlow', () => {
  describe('flow metadata', () => {
    it('has correct id and name', () => {
      expect(planEditReqsFlow.id).toBe('plan-edit-reqs');
      expect(planEditReqsFlow.name).toBe('Edit Requirements');
    });

    it('starts at menu step', () => {
      expect(planEditReqsFlow.firstStep).toBe('menu');
    });
  });

  describe('menu step', () => {
    it('shows warning when no plan', () => {
      const ctx = createMockContext({ plan: null }) as PlanEditContext;
      const interaction = planEditReqsFlow.steps.menu.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.message).toContain('No active plan');
    });

    it('shows requirements list', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Feature A', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
            { title: 'Feature B', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 1 },
          ],
        }),
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.menu.interaction(ctx);

      expect(interaction.type).toBe('select');
      expect(interaction.message).toContain('Feature A');
      expect(interaction.message).toContain('Feature B');
    });

    it('shows edit options', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [{ title: 'Test', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 }],
        }),
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.menu.interaction(ctx);

      if (interaction.type === 'select') {
        const ids = interaction.options.map((o) => o.id);
        expect(ids).toContain('edit');
        expect(ids).toContain('reorder');
        expect(ids).toContain('remove');
        expect(ids).toContain('add');
        expect(ids).toContain('done');
      }
    });

    it('handles edit selection', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.menu.handle('edit', ctx);
      expect(result).toBe('select_req_edit');
    });

    it('handles reorder selection', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.menu.handle('reorder', ctx);
      expect(result).toBe('select_req_from');
    });

    it('handles remove selection', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.menu.handle('remove', ctx);
      expect(result).toBe('select_req_remove');
    });

    it('handles add selection', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.menu.handle('add', ctx);
      expect(result).toBe('add_title');
    });

    it('returns null on done', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.menu.handle('done', ctx);
      expect(result).toBeNull();
    });
  });

  describe('select_req_edit step', () => {
    it('shows requirement options', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
            { title: 'Req 2', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 1 },
          ],
        }),
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.select_req_edit.interaction(ctx);

      expect(interaction.type).toBe('select');
      if (interaction.type === 'select') {
        expect(interaction.options.some((o) => o.label.includes('Req 1'))).toBe(true);
        expect(interaction.options.some((o) => o.label.includes('Req 2'))).toBe(true);
        expect(interaction.options.some((o) => o.id === 'cancel')).toBe(true);
      }
    });

    it('handles cancel', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.select_req_edit.handle('cancel', ctx);
      expect(result).toBe('menu');
    });

    it('selects requirement by index', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
            { title: 'Req 2', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 1 },
          ],
        }),
      }) as PlanEditContext;

      const result = await planEditReqsFlow.steps.select_req_edit.handle('req_1', ctx);

      expect(ctx.selectedReqIndex).toBe(1);
      expect(result).toBe('select_field');
    });

    it('validates index bounds', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
          ],
        }),
      }) as PlanEditContext;

      // Index 5 is out of bounds (only 1 requirement)
      const result = await planEditReqsFlow.steps.select_req_edit.handle('req_5', ctx);
      expect(result).toBe('menu'); // Falls back to menu
      expect(ctx.selectedReqIndex).toBeUndefined();
    });

    it('validates negative index', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
          ],
        }),
      }) as PlanEditContext;

      const result = await planEditReqsFlow.steps.select_req_edit.handle('req_-1', ctx);
      expect(result).toBe('menu'); // Falls back to menu - regex won't match negative
    });
  });

  describe('select_field step', () => {
    it('shows field options', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Test Req', description: 'Test desc', estimatedComplexity: 'high' as const, technicalNotes: [], order: 0 },
          ],
        }),
        selectedReqIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.select_field.interaction(ctx);

      expect(interaction.type).toBe('select');
      if (interaction.type === 'select') {
        const ids = interaction.options.map((o) => o.id);
        expect(ids).toContain('title');
        expect(ids).toContain('description');
        expect(ids).toContain('complexity');
        expect(ids).toContain('notes');
        expect(ids).toContain('cancel');
      }
    });

    it('shows error if requirement not found', () => {
      const ctx = createMockContext({
        plan: createMockPlan({ requirements: [] }),
        selectedReqIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.select_field.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.message).toContain('not found');
    });

    it('navigates to correct edit step', async () => {
      const ctx = createMockContext() as PlanEditContext;

      expect(await planEditReqsFlow.steps.select_field.handle('title', ctx)).toBe('edit_title');
      expect(await planEditReqsFlow.steps.select_field.handle('description', ctx)).toBe('edit_description');
      expect(await planEditReqsFlow.steps.select_field.handle('complexity', ctx)).toBe('edit_complexity');
      expect(await planEditReqsFlow.steps.select_field.handle('notes', ctx)).toBe('edit_notes');
      expect(await planEditReqsFlow.steps.select_field.handle('cancel', ctx)).toBe('menu');
    });

    it('stores edit field in context', async () => {
      const ctx = createMockContext() as PlanEditContext;
      await planEditReqsFlow.steps.select_field.handle('title', ctx);
      expect(ctx.editField).toBe('title');
    });
  });

  describe('edit_title step', () => {
    it('shows input with current title as placeholder', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Current Title', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
          ],
        }),
        selectedReqIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.edit_title.interaction(ctx);

      expect(interaction.type).toBe('input');
      if (interaction.type === 'input') {
        expect(interaction.placeholder).toBe('Current Title');
      }
    });

    it('stores value and triggers action', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.edit_title.handle('New Title', ctx);

      expect(ctx.editValue).toBe('New Title');
      expect(result).toBe('action:update_req_field');
    });

    it('returns to menu on empty response', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.edit_title.handle('', ctx);
      expect(result).toBe('menu');
    });
  });

  describe('edit_complexity step', () => {
    it('shows complexity options', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Test', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 0 },
          ],
        }),
        selectedReqIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.edit_complexity.interaction(ctx);

      expect(interaction.type).toBe('select');
      if (interaction.type === 'select') {
        const labels = interaction.options.map((o) => o.label);
        expect(labels.some((l) => l.includes('Low'))).toBe(true);
        expect(labels.some((l) => l.includes('Medium') && l.includes('current'))).toBe(true);
        expect(labels.some((l) => l.includes('High'))).toBe(true);
      }
    });
  });

  describe('select_req_from step (reorder)', () => {
    it('validates bounds on selection', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
          ],
        }),
      }) as PlanEditContext;

      // Out of bounds
      const result = await planEditReqsFlow.steps.select_req_from.handle('req_99', ctx);
      expect(result).toBe('menu');
    });

    it('stores from index on valid selection', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
            { title: 'Req 2', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 1 },
          ],
        }),
      }) as PlanEditContext;

      const result = await planEditReqsFlow.steps.select_req_from.handle('req_0', ctx);
      expect(ctx.reorderFrom).toBe(0);
      expect(result).toBe('select_req_to');
    });
  });

  describe('select_req_to step (reorder)', () => {
    it('disables current position', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
            { title: 'Req 2', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 1 },
          ],
        }),
        reorderFrom: 0,
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.select_req_to.interaction(ctx);

      if (interaction.type === 'select') {
        const disabledOpt = interaction.options.find((o) => o.disabled);
        expect(disabledOpt?.id).toBe('req_0');
      }
    });

    it('rejects same position', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
            { title: 'Req 2', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 1 },
          ],
        }),
        reorderFrom: 0,
      }) as PlanEditContext;

      // Same as from position
      const result = await planEditReqsFlow.steps.select_req_to.handle('req_0', ctx);
      expect(result).toBe('menu');
    });

    it('accepts different position', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
            { title: 'Req 2', description: '', estimatedComplexity: 'medium' as const, technicalNotes: [], order: 1 },
          ],
        }),
        reorderFrom: 0,
      }) as PlanEditContext;

      const result = await planEditReqsFlow.steps.select_req_to.handle('req_1', ctx);
      expect(ctx.selectedReqIndex).toBe(1);
      expect(result).toBe('action:reorder_req');
    });
  });

  describe('select_req_remove step', () => {
    it('validates bounds', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
          ],
        }),
      }) as PlanEditContext;

      const result = await planEditReqsFlow.steps.select_req_remove.handle('req_99', ctx);
      expect(result).toBe('menu');
    });

    it('proceeds to confirm on valid selection', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Req 1', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
          ],
        }),
      }) as PlanEditContext;

      const result = await planEditReqsFlow.steps.select_req_remove.handle('req_0', ctx);
      expect(ctx.selectedReqIndex).toBe(0);
      expect(result).toBe('confirm_remove');
    });
  });

  describe('confirm_remove step', () => {
    it('shows destructive confirm', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          requirements: [
            { title: 'Delete Me', description: '', estimatedComplexity: 'low' as const, technicalNotes: [], order: 0 },
          ],
        }),
        selectedReqIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditReqsFlow.steps.confirm_remove.interaction(ctx);

      expect(interaction.type).toBe('confirm');
      if (interaction.type === 'confirm') {
        expect(interaction.destructive).toBe(true);
        expect(interaction.message).toContain('Delete Me');
      }
    });

    it('triggers action on confirm', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.confirm_remove.handle(true, ctx);
      expect(result).toBe('action:remove_req');
    });

    it('returns to menu on cancel', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditReqsFlow.steps.confirm_remove.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('add requirement steps', () => {
    it('add_title stores title and proceeds', async () => {
      const ctx = createMockContext() as PlanEditContext & { _newReqTitle?: string };
      const result = await planEditReqsFlow.steps.add_title.handle('New Requirement', ctx);

      expect(ctx._newReqTitle).toBe('New Requirement');
      expect(result).toBe('add_description');
    });

    it('add_description stores and proceeds', async () => {
      const ctx = createMockContext() as PlanEditContext & { _newReqDescription?: string };
      const result = await planEditReqsFlow.steps.add_description.handle('Some description', ctx);

      expect(ctx._newReqDescription).toBe('Some description');
      expect(result).toBe('add_complexity');
    });

    it('add_complexity triggers action', async () => {
      const ctx = createMockContext() as PlanEditContext & { _newReqComplexity?: string };
      const result = await planEditReqsFlow.steps.add_complexity.handle('high', ctx);

      expect(ctx._newReqComplexity).toBe('high');
      expect(result).toBe('action:add_plan_req');
    });
  });
});

describe('planEditQuestionsFlow', () => {
  describe('flow metadata', () => {
    it('has correct id and name', () => {
      expect(planEditQuestionsFlow.id).toBe('plan-edit-questions');
      expect(planEditQuestionsFlow.name).toBe('Edit Questions');
    });
  });

  describe('menu step', () => {
    it('shows warning when no questions', () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [] }),
      }) as PlanEditContext;

      const interaction = planEditQuestionsFlow.steps.menu.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.message).toContain('No questions');
    });

    it('shows questions with answers', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [
            { question: 'First question?', answer: 'Yes' },
            { question: 'Second question?', answer: undefined },
          ],
        }),
      }) as PlanEditContext;

      const interaction = planEditQuestionsFlow.steps.menu.interaction(ctx);

      expect(interaction.type).toBe('select');
      expect(interaction.message).toContain('First question?');
      expect(interaction.message).toContain('Second question?');
    });

    it('selects question by index', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [
            { question: 'Q1?' },
            { question: 'Q2?' },
          ],
        }),
      }) as PlanEditContext;

      const result = await planEditQuestionsFlow.steps.menu.handle('q_1', ctx);

      expect(ctx.selectedQuestionIndex).toBe(1);
      expect(result).toBe('show_question');
    });

    it('validates question index bounds', async () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [{ question: 'Only one?' }],
        }),
      }) as PlanEditContext;

      // Out of bounds
      const result = await planEditQuestionsFlow.steps.menu.handle('q_99', ctx);
      expect(result).toBe('menu');
    });

    it('returns null on done', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditQuestionsFlow.steps.menu.handle('done', ctx);
      expect(result).toBeNull();
    });
  });

  describe('show_question step', () => {
    it('shows question details', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [
            {
              question: 'What color?',
              context: 'Design decision',
              suggestedOptions: ['Red', 'Blue'],
              answer: 'Green',
            },
          ],
        }),
        selectedQuestionIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditQuestionsFlow.steps.show_question.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.message).toContain('What color?');
      expect(interaction.message).toContain('Design decision');
      expect(interaction.message).toContain('Red, Blue');
      expect(interaction.message).toContain('Green');
    });

    it('shows error if question not found', () => {
      const ctx = createMockContext({
        plan: createMockPlan({ questions: [] }),
        selectedQuestionIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditQuestionsFlow.steps.show_question.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.message).toContain('not found');
    });

    it('proceeds to edit_answer', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditQuestionsFlow.steps.show_question.handle(null, ctx);
      expect(result).toBe('edit_answer');
    });
  });

  describe('edit_answer step', () => {
    it('shows input with current answer as placeholder', () => {
      const ctx = createMockContext({
        plan: createMockPlan({
          questions: [{ question: 'Q?', answer: 'Current answer' }],
        }),
        selectedQuestionIndex: 0,
      }) as PlanEditContext;

      const interaction = planEditQuestionsFlow.steps.edit_answer.interaction(ctx);

      expect(interaction.type).toBe('input');
      if (interaction.type === 'input') {
        expect(interaction.placeholder).toBe('Current answer');
      }
    });

    it('stores answer and triggers action', async () => {
      const ctx = createMockContext() as PlanEditContext;
      const result = await planEditQuestionsFlow.steps.edit_answer.handle('New answer', ctx);

      expect(ctx.editValue).toBe('New answer');
      expect(result).toBe('action:update_question_answer');
    });
  });

  describe('edit_success step', () => {
    it('shows success message', () => {
      const ctx = createMockContext() as PlanEditContext;
      const interaction = planEditQuestionsFlow.steps.edit_success.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('success');
    });
  });

  describe('error step', () => {
    it('shows error message', () => {
      const ctx = createMockContext() as PlanEditContext;
      ctx.error = 'Something went wrong';

      const interaction = planEditQuestionsFlow.steps.error.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('error');
      expect(interaction.message).toContain('Something went wrong');
    });

    it('clears error and returns to menu', async () => {
      const ctx = createMockContext() as PlanEditContext;
      ctx.error = 'Some error';

      const result = await planEditQuestionsFlow.steps.error.handle(null, ctx);

      expect(ctx.error).toBeUndefined();
      expect(result).toBe('menu');
    });
  });
});
