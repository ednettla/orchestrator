/**
 * Worktrees Flow Tests
 *
 * Tests for the git worktree management flow.
 *
 * @module interactions/__tests__/flows/worktrees.test
 */

import { describe, it, expect } from 'vitest';
import {
  worktreesFlow,
  isWorktreesAction,
  getWorktreesAction,
  type WorktreesFlowContext,
} from '../../flows/worktrees.js';
import { createMockContext } from '../mocks/context.js';

describe('worktreesFlow', () => {
  describe('flow metadata', () => {
    it('has correct id and name', () => {
      expect(worktreesFlow.id).toBe('worktrees');
      expect(worktreesFlow.name).toBe('Git Worktrees');
    });

    it('starts at check_health step', () => {
      expect(worktreesFlow.firstStep).toBe('check_health');
    });
  });

  describe('check_health step', () => {
    it('shows progress indicator', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      const interaction = worktreesFlow.steps.check_health.interaction(ctx);

      expect(interaction.type).toBe('progress');
      expect(interaction.message).toContain('Checking');
    });

    it('triggers health check action', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      const result = await worktreesFlow.steps.check_health.handle(null, ctx);

      expect(result).toBe('action:check_worktree_health');
    });
  });

  describe('menu step', () => {
    it('shows warning when not a git repo', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = {
        isGitRepo: false,
        healthy: true,
        gitCount: 0,
        dbCount: 0,
        issueCount: 0,
        fixableCount: 0,
        issues: [],
      };

      const interaction = worktreesFlow.steps.menu.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('warning');
      expect(interaction.message).toContain('Not a git repository');
    });

    it('shows healthy status', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = {
        isGitRepo: true,
        healthy: true,
        gitCount: 0,
        dbCount: 0,
        issueCount: 0,
        fixableCount: 0,
        issues: [],
      };

      const interaction = worktreesFlow.steps.menu.interaction(ctx);

      expect(interaction.type).toBe('select');
      expect(interaction.message).toContain('healthy');
    });

    it('shows issues when unhealthy', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = {
        isGitRepo: true,
        healthy: false,
        gitCount: 2,
        dbCount: 1,
        issueCount: 2,
        fixableCount: 1,
        issues: [
          { description: 'Orphan worktree', autoFixable: true },
          { description: 'Missing branch', autoFixable: false },
        ],
      };

      const interaction = worktreesFlow.steps.menu.interaction(ctx);

      expect(interaction.type).toBe('select');
      expect(interaction.message).toContain('issue');
      expect(interaction.message).toContain('Orphan worktree');
    });

    it('shows repair option when fixable issues exist', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = {
        isGitRepo: true,
        healthy: false,
        gitCount: 1,
        dbCount: 0,
        issueCount: 1,
        fixableCount: 1,
        issues: [{ description: 'Fixable issue', autoFixable: true }],
      };

      const interaction = worktreesFlow.steps.menu.interaction(ctx);

      if (interaction.type === 'select') {
        const ids = interaction.options.map((o) => o.id);
        expect(ids).toContain('repair');
      }
    });

    it('disables details when no worktrees', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = {
        isGitRepo: true,
        healthy: true,
        gitCount: 0,
        dbCount: 0,
        issueCount: 0,
        fixableCount: 0,
        issues: [],
      };

      const interaction = worktreesFlow.steps.menu.interaction(ctx);

      if (interaction.type === 'select') {
        const detailsOpt = interaction.options.find((o) => o.id === 'details');
        expect(detailsOpt?.disabled).toBe(true);
      }
    });

    it('handles refresh', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = { isGitRepo: true, healthy: true, gitCount: 0, dbCount: 0, issueCount: 0, fixableCount: 0, issues: [] };

      const result = await worktreesFlow.steps.menu.handle('refresh', ctx);
      expect(result).toBe('check_health');
    });

    it('handles repair', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = { isGitRepo: true, healthy: true, gitCount: 0, dbCount: 0, issueCount: 0, fixableCount: 0, issues: [] };

      const result = await worktreesFlow.steps.menu.handle('repair', ctx);
      expect(result).toBe('action:repair_worktrees');
    });

    it('handles details', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = { isGitRepo: true, healthy: true, gitCount: 0, dbCount: 0, issueCount: 0, fixableCount: 0, issues: [] };

      const result = await worktreesFlow.steps.menu.handle('details', ctx);
      expect(result).toBe('action:view_worktree_details');
    });

    it('handles cleanup', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = { isGitRepo: true, healthy: true, gitCount: 0, dbCount: 0, issueCount: 0, fixableCount: 0, issues: [] };

      const result = await worktreesFlow.steps.menu.handle('cleanup', ctx);
      expect(result).toBe('confirm_cleanup');
    });

    it('handles back', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = { isGitRepo: true, healthy: true, gitCount: 0, dbCount: 0, issueCount: 0, fixableCount: 0, issues: [] };

      const result = await worktreesFlow.steps.menu.handle('back', ctx);
      expect(result).toBeNull();
    });

    it('returns null when not a git repo', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.worktreeHealth = { isGitRepo: false, healthy: true, gitCount: 0, dbCount: 0, issueCount: 0, fixableCount: 0, issues: [] };

      const result = await worktreesFlow.steps.menu.handle('refresh', ctx);
      expect(result).toBeNull();
    });
  });

  describe('confirm_cleanup step', () => {
    it('shows destructive confirmation', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      const interaction = worktreesFlow.steps.confirm_cleanup.interaction(ctx);

      expect(interaction.type).toBe('confirm');
      if (interaction.type === 'confirm') {
        expect(interaction.destructive).toBe(true);
        expect(interaction.message).toContain('Remove ALL');
      }
    });

    it('triggers cleanup action on confirm', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      const result = await worktreesFlow.steps.confirm_cleanup.handle(true, ctx);
      expect(result).toBe('action:full_worktree_cleanup');
    });

    it('returns to menu on cancel', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      const result = await worktreesFlow.steps.confirm_cleanup.handle(false, ctx);
      expect(result).toBe('menu');
    });
  });

  describe('show_result step', () => {
    it('shows result message', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.resultMessage = 'Repair completed';

      const interaction = worktreesFlow.steps.show_result.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('success');
      expect(interaction.message).toBe('Repair completed');
    });

    it('clears result and refreshes', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.resultMessage = 'Some result';

      const result = await worktreesFlow.steps.show_result.handle(null, ctx);

      expect(ctx.resultMessage).toBeUndefined();
      expect(result).toBe('check_health');
    });
  });

  describe('error step', () => {
    it('shows error message', () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.error = 'Something failed';

      const interaction = worktreesFlow.steps.error.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('error');
      expect(interaction.message).toBe('Something failed');
    });

    it('clears error and returns to menu', async () => {
      const ctx = createMockContext() as WorktreesFlowContext;
      ctx.error = 'Some error';

      const result = await worktreesFlow.steps.error.handle(null, ctx);

      expect(ctx.error).toBeUndefined();
      expect(result).toBe('menu');
    });
  });
});

describe('isWorktreesAction', () => {
  it('returns true for action markers', () => {
    expect(isWorktreesAction('action:check_health')).toBe(true);
    expect(isWorktreesAction('action:repair')).toBe(true);
  });

  it('returns false for non-action results', () => {
    expect(isWorktreesAction('menu')).toBe(false);
    expect(isWorktreesAction(null)).toBe(false);
  });
});

describe('getWorktreesAction', () => {
  it('extracts action name', () => {
    expect(getWorktreesAction('action:check_health')).toBe('check_health');
    expect(getWorktreesAction('action:repair')).toBe('repair');
  });
});
