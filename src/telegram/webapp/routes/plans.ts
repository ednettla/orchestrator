/**
 * Plans API Routes
 *
 * API for viewing and managing project plans, including Q&A flow.
 *
 * @module webapp/routes/plans
 */

import { Router, type Response } from 'express';
import { type AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { getProjectRegistry } from '../../../core/project-registry.js';
import { createStore } from '../../../state/store.js';
import type { Plan, ClarifyingQuestion } from '../../../core/types.js';

// ============================================================================
// Router Factory
// ============================================================================

export function createPlansRouter(): Router {
  const router = Router({ mergeParams: true }); // mergeParams to access :projectId

  // Helper to get project store
  const getProjectStore = (projectId: string) => {
    const registry = getProjectRegistry();
    // Try UUID lookup first, then fall back to name/alias
    const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);
    if (!project) return null;
    return { store: createStore(project.path), project };
  };

  // --------------------------------------------------------------------------
  // List Plans
  // --------------------------------------------------------------------------

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;

      const context = getProjectStore(projectId);
      if (!context) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const { store, project } = context;

      // Get session
      const session = store.getSessionByPath(project.path);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Project not initialized' },
        });
        store.close();
        return;
      }

      // Get all plans for this session
      const plans = store.getPlansBySession(session.id);
      const activePlan = store.getActivePlan(session.id);

      store.close();

      res.json({
        success: true,
        plans: plans.map((p: Plan) => ({
          id: p.id,
          status: p.status,
          highLevelGoal: p.highLevelGoal,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        activePlan: activePlan ? {
          id: activePlan.id,
          status: activePlan.status,
          highLevelGoal: activePlan.highLevelGoal,
        } : null,
      });
    } catch (error) {
      console.error('[API] Error listing plans:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list plans' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Get Active Plan
  // --------------------------------------------------------------------------

  router.get('/active', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;

      const context = getProjectStore(projectId);
      if (!context) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const { store, project } = context;

      // Get session - if no session, project not initialized
      const session = store.getSessionByPath(project.path);
      if (!session) {
        store.close();
        // Return gracefully - no plan available yet
        res.json({
          success: true,
          plan: null,
          hasActivePlan: false,
          hasPendingQuestions: false,
          pendingQuestions: [],
        });
        return;
      }

      // Get active plan
      const plan = store.getActivePlan(session.id);

      store.close();

      if (!plan) {
        res.json({
          success: true,
          plan: null,
          hasActivePlan: false,
          hasPendingQuestions: false,
          pendingQuestions: [],
        });
        return;
      }

      // Check for pending questions (unanswered means no answer set)
      const pendingQuestions = plan.questions.filter(
        (q: ClarifyingQuestion) => !q.answer
      );

      res.json({
        success: true,
        plan: {
          id: plan.id,
          status: plan.status,
          highLevelGoal: plan.highLevelGoal,
          overview: plan.overview,
          questions: plan.questions,
          requirements: plan.requirements,
          architecturalDecisions: plan.architecturalDecisions,
          implementationOrder: plan.implementationOrder,
          assumptions: plan.assumptions,
          outOfScope: plan.outOfScope,
          risks: plan.risks,
          createdAt: plan.createdAt.toISOString(),
          updatedAt: plan.updatedAt.toISOString(),
        },
        hasActivePlan: true,
        hasPendingQuestions: pendingQuestions.length > 0,
        pendingQuestions,
      });
    } catch (error) {
      console.error('[API] Error getting active plan:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get active plan' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Start New Plan
  // --------------------------------------------------------------------------

  router.post(
    '/',
    requireRole('operator'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const { goal } = req.body as { goal?: string };

        if (!goal?.trim()) {
          res.status(400).json({
            success: false,
            error: { code: 'MISSING_GOAL', message: 'Goal is required to start planning' },
          });
          return;
        }

        const registry = getProjectRegistry();
        const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);

        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        // Import plan functionality
        const { startPlanFromApi } = await import('../../project-bridge.js');

        const result = await startPlanFromApi(project.path, goal.trim());

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: { code: 'PLAN_FAILED', message: result.error ?? 'Failed to start plan' },
          });
          return;
        }

        res.json({
          success: true,
          message: 'Plan generation started',
          jobId: result.jobId,
        });
      } catch (error) {
        console.error('[API] Error starting plan:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to start plan' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Answer Plan Question
  // --------------------------------------------------------------------------

  router.post(
    '/answer',
    requireRole('operator'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const { questionId, answer } = req.body as {
          questionId: string;
          answer: string;
        };

        if (!questionId || !answer?.trim()) {
          res.status(400).json({
            success: false,
            error: { code: 'MISSING_FIELDS', message: 'questionId and answer are required' },
          });
          return;
        }

        const registry = getProjectRegistry();
        const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);

        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        // Import answer functionality
        const { answerPlanQuestionFromApi } = await import('../../project-bridge.js');

        const result = await answerPlanQuestionFromApi(project.path, questionId, answer.trim());

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: { code: 'ANSWER_FAILED', message: result.error ?? 'Failed to submit answer' },
          });
          return;
        }

        res.json({
          success: true,
          message: 'Answer submitted',
          remainingQuestions: result.remainingQuestions ?? 0,
        });
      } catch (error) {
        console.error('[API] Error answering question:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to submit answer' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Approve Plan
  // --------------------------------------------------------------------------

  router.post(
    '/approve',
    requireRole('operator'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;

        const registry = getProjectRegistry();
        const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);

        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        // Import approve functionality
        const { approvePlanFromApi } = await import('../../project-bridge.js');

        const result = await approvePlanFromApi(project.path);

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: { code: 'APPROVE_FAILED', message: result.error ?? 'Failed to approve plan' },
          });
          return;
        }

        res.json({
          success: true,
          message: 'Plan approved',
        });
      } catch (error) {
        console.error('[API] Error approving plan:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to approve plan' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Reject Plan
  // --------------------------------------------------------------------------

  router.post(
    '/reject',
    requireRole('operator'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const { reason } = req.body as { reason?: string };

        const registry = getProjectRegistry();
        const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);

        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        // Import reject functionality
        const { rejectPlanFromApi } = await import('../../project-bridge.js');

        const result = await rejectPlanFromApi(project.path, reason);

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: { code: 'REJECT_FAILED', message: result.error ?? 'Failed to reject plan' },
          });
          return;
        }

        res.json({
          success: true,
          message: 'Plan rejected',
        });
      } catch (error) {
        console.error('[API] Error rejecting plan:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to reject plan' },
        });
      }
    }
  );

  return router;
}
