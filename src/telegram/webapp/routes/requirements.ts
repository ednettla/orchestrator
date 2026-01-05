/**
 * Requirements API Routes
 *
 * Full CRUD operations for project requirements.
 *
 * @module webapp/routes/requirements
 */

import { Router, type Response } from 'express';
import { type AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { getProjectRegistry } from '../../../core/project-registry.js';
import { createStore } from '../../../state/store.js';
import type { Requirement, Task } from '../../../core/types.js';

// ============================================================================
// Router Factory
// ============================================================================

export function createRequirementsRouter(): Router {
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
  // List Requirements
  // --------------------------------------------------------------------------

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;
      const { status, sort = 'priority' } = req.query as { status?: string; sort?: string };

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

      // Get requirements
      let requirements = store.getRequirementsBySession(session.id);

      // Filter by status
      if (status && status !== 'all') {
        requirements = requirements.filter((r: Requirement) => r.status === status);
      }

      // Sort
      if (sort === 'priority') {
        requirements.sort((a: Requirement, b: Requirement) => b.priority - a.priority);
      } else if (sort === 'created') {
        requirements.sort((a: Requirement, b: Requirement) => b.createdAt.getTime() - a.createdAt.getTime());
      }

      store.close();

      res.json({
        success: true,
        requirements: requirements.map((r: Requirement) => ({
          id: r.id,
          rawInput: r.rawInput,
          status: r.status,
          priority: r.priority,
          structuredSpec: r.structuredSpec,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[API] Error listing requirements:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list requirements' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Get Single Requirement
  // --------------------------------------------------------------------------

  router.get('/:reqId', (req: AuthenticatedRequest, res: Response) => {
    try {
      const projectId = req.params.projectId as string;
      const reqId = req.params.reqId as string;

      const context = getProjectStore(projectId);
      if (!context) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const { store } = context;

      const requirement = store.getRequirement(reqId);
      if (!requirement) {
        res.status(404).json({
          success: false,
          error: { code: 'REQUIREMENT_NOT_FOUND', message: 'Requirement not found' },
        });
        store.close();
        return;
      }

      // Get related tasks
      const tasks = store.getTasksByRequirement(reqId);

      store.close();

      res.json({
        success: true,
        requirement: {
          id: requirement.id,
          rawInput: requirement.rawInput,
          status: requirement.status,
          priority: requirement.priority,
          structuredSpec: requirement.structuredSpec,
          createdAt: requirement.createdAt.toISOString(),
          updatedAt: requirement.updatedAt.toISOString(),
        },
        tasks: tasks.map((t: Task) => ({
          id: t.id,
          agentType: t.agentType,
          status: t.status,
          retryCount: t.retryCount,
          startedAt: t.startedAt?.toISOString() ?? null,
          completedAt: t.completedAt?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      console.error('[API] Error getting requirement:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get requirement' },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Create Requirement
  // --------------------------------------------------------------------------

  router.post(
    '/',
    requireRole('operator'),
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const { title, priority = 0 } = req.body as {
          title: string;
          priority?: number;
        };

        if (!title?.trim()) {
          res.status(400).json({
            success: false,
            error: { code: 'MISSING_TITLE', message: 'Requirement title is required' },
          });
          return;
        }

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

        // Create requirement
        const requirement = store.createRequirement({
          sessionId: session.id,
          rawInput: title.trim(),
          priority: Math.max(0, Math.min(10, priority)), // Clamp to 0-10
        });

        store.close();

        res.status(201).json({
          success: true,
          requirement: {
            id: requirement.id,
            rawInput: requirement.rawInput,
            status: requirement.status,
            priority: requirement.priority,
            createdAt: requirement.createdAt.toISOString(),
            updatedAt: requirement.updatedAt.toISOString(),
          },
        });
      } catch (error) {
        console.error('[API] Error creating requirement:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to create requirement' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Update Requirement
  // --------------------------------------------------------------------------

  router.put(
    '/:reqId',
    requireRole('operator'),
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const reqId = req.params.reqId as string;
        const { title, priority, status } = req.body as {
          title?: string;
          priority?: number;
          status?: string;
        };

        const context = getProjectStore(projectId);
        if (!context) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        const { store } = context;

        const requirement = store.getRequirement(reqId);
        if (!requirement) {
          res.status(404).json({
            success: false,
            error: { code: 'REQUIREMENT_NOT_FOUND', message: 'Requirement not found' },
          });
          store.close();
          return;
        }

        // Validate status if provided
        const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
        if (status && !validStatuses.includes(status)) {
          res.status(400).json({
            success: false,
            error: { code: 'INVALID_STATUS', message: `Status must be one of: ${validStatuses.join(', ')}` },
          });
          store.close();
          return;
        }

        // Build updates
        const updates: Record<string, unknown> = {};

        if (title !== undefined) {
          // Update rawInput (we can't change structured spec via API)
          // Note: This is a simplified update - full edit would need to re-run planner
          updates.rawInput = title.trim();
        }

        if (priority !== undefined) {
          updates.priority = Math.max(0, Math.min(10, priority));
        }

        if (status !== undefined) {
          updates.status = status;
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          // Use direct SQL update since store doesn't support rawInput update
          // For now, we'll only update priority and status through the store
          const storeUpdates: { priority?: number; status?: 'pending' | 'in_progress' | 'completed' | 'failed' } = {};
          if (updates.priority !== undefined) {
            storeUpdates.priority = updates.priority as number;
          }
          if (updates.status !== undefined) {
            storeUpdates.status = updates.status as 'pending' | 'in_progress' | 'completed' | 'failed';
          }
          if (Object.keys(storeUpdates).length > 0) {
            store.updateRequirement(reqId, storeUpdates);
          }
        }

        const updated = store.getRequirement(reqId);
        store.close();

        res.json({
          success: true,
          requirement: {
            id: updated!.id,
            rawInput: updated!.rawInput,
            status: updated!.status,
            priority: updated!.priority,
            structuredSpec: updated!.structuredSpec,
            createdAt: updated!.createdAt.toISOString(),
            updatedAt: updated!.updatedAt.toISOString(),
          },
        });
      } catch (error) {
        console.error('[API] Error updating requirement:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to update requirement' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Delete Requirement
  // --------------------------------------------------------------------------

  router.delete(
    '/:reqId',
    requireRole('admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const reqId = req.params.reqId as string;

        const context = getProjectStore(projectId);
        if (!context) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        const { store } = context;

        const requirement = store.getRequirement(reqId);
        if (!requirement) {
          res.status(404).json({
            success: false,
            error: { code: 'REQUIREMENT_NOT_FOUND', message: 'Requirement not found' },
          });
          store.close();
          return;
        }

        // Don't allow deleting in-progress requirements
        if (requirement.status === 'in_progress') {
          res.status(400).json({
            success: false,
            error: { code: 'CANNOT_DELETE', message: 'Cannot delete requirement that is in progress' },
          });
          store.close();
          return;
        }

        // Delete using project-bridge function
        store.close();

        const { deleteRequirement } = await import('../../project-bridge.js');
        const result = await deleteRequirement(context.project.path, reqId);

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: { code: 'DELETE_FAILED', message: result.error ?? 'Failed to delete requirement' },
          });
          return;
        }

        res.json({
          success: true,
          message: 'Requirement deleted',
        });
      } catch (error) {
        console.error('[API] Error deleting requirement:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to delete requirement' },
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Run Single Requirement
  // --------------------------------------------------------------------------

  router.post(
    '/:reqId/run',
    requireRole('operator'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = req.params.projectId as string;
        const reqId = req.params.reqId as string;

        const registry = getProjectRegistry();
        const project = registry.getProjectById(projectId) ?? registry.getProject(projectId);

        if (!project) {
          res.status(404).json({
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
          return;
        }

        // Import run functionality
        const { runRequirementFromApi } = await import('../../project-bridge.js');

        const result = await runRequirementFromApi(project.path, reqId);

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: { code: 'RUN_FAILED', message: result.error ?? 'Failed to start requirement' },
          });
          return;
        }

        res.json({
          success: true,
          message: 'Requirement execution started',
          jobId: result.jobId,
        });
      } catch (error) {
        console.error('[API] Error running requirement:', error);
        res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to run requirement' },
        });
      }
    }
  );

  return router;
}
